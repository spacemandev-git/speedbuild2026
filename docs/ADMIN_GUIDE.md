# Admin Guide — Running the Estate

Operational guide for the organizers who stand up and run the Speed Build 2026 "Estate" server.
It covers bootstrapping the box, provisioning claimants, driving the show from the admin dashboard,
handling reveals and the Executor's Mercy, and troubleshooting. Pair it with the authoritative
[architecture contract](ARCHITECTURE.md) — this guide is the operator's how-to; that document is the
source of truth for exact layouts, ports, and byte formats.

---

## 1. The shape of the system

One bare-metal Ubuntu 24.04 server ("Sunburst") runs everything as isolated **Incus** tenants on a
private bridge (`10.61.0.0/24`):

| Tenant | Internal IP | Runs |
|---|---|---|
| `admin` | 10.61.0.10 | **Admin dashboard** (:3000 → host :8080), asciinema recording server (:4000) |
| `challenges` | 10.61.0.20 | **surfpool** (Solana test validator, :8899/:8900), **executor-api** (:8700–:8710) |
| `inference` | 10.61.0.30 | **llama-server** — the shared AI model (:8080). *Not exposed to the LAN.* |
| `p01`…`pNN` | 10.61.0.101+ | One isolated box per claimant (SSH proxied to host port `2200+N`) |
| host | 10.61.0.1 | **host-agent** — the provisioning API (:7000) |

Three services matter to you as an operator:

- **host-agent** (host, `:7000`) — provisions, reveals to, and manages participant boxes. Bearer
  auth with `SB_HOST_AGENT_TOKEN`.
- **executor-api** (challenges) — the game backend: on-chain watchers, x402 endpoints, Pay.sh ledger
  nodes, the deterministic combo generator, and the admin surface on `:8710` (bearer
  `SB_ADMIN_TOKEN`), including the live event SSE feed.
- **admin-dashboard** (admin, reached at `http://<host-lan-ip>:8080`) — your control room. It proxies
  both of the above server-side; you log in with `SB_ADMIN_TOKEN`.

What the outside (venue LAN) can reach: the dashboard (`:8080`), the asciinema server (`:4000`),
surfpool RPC/WS (`:8899`/`:8900`, for organizer laptops), and each claimant's SSH port. **Inference is
never LAN-exposed.**

---

## 2. Before the show — configuration

### 2.1 Secrets and config

Bootstrap copies `config/speedbuild.env.example` to `config/speedbuild.env` on first run and stops
until you fill three required secrets:

```sh
openssl rand -hex 32   # run three times
```

Set in `config/speedbuild.env`:

- `SB_ESTATE_SECRET` — HMAC seed for **every** deterministic unlock code. Keep it identical across the
  whole event and secret; anyone with it can compute every lock.
- `SB_ADMIN_TOKEN` — dashboard login **and** executor-api admin bearer.
- `SB_HOST_AGENT_TOKEN` — host-agent bearer.

Keep all three private. They are the entire security boundary.

### 2.2 Key config knobs

The full list is documented inline in `config/speedbuild.env.example`. The ones you actually tune:

| Key | Default | Notes |
|---|---|---|
| `SB_PARTICIPANT_COUNT` | 30 | How many participant boxes a full run provisions. |
| `SB_TENANT_MODE` | `container` | `container` is the validated default. Use `vm` **only** with a dedicated non-bonded SR-IOV NIC and console/BMC recovery (see §2.4). |
| `SB_SRIOV_ENABLE` | 0 | Leave 0 unless you are deliberately doing VF passthrough. |
| `SB_MODEL_HF_REPO` / `SB_MODEL_QUANT` / `SB_MODEL_ALIAS` | Qwen3.6-35B-A3B / Q8_0 / `qwen3.6` | The shared model. Swappable; only one large model should be resident (CPU inference is memory-bandwidth-bound). |
| `SB_LLAMA_PARALLEL` | 8 | Concurrent request slots. Total context (`SB_LLAMA_CTX_TOTAL`) is split across slots. |
| `SB_SMOKE_TEST` | 0 | `1` = 2 participants, tiny model, small limits, container mode, SR-IOV skipped. |

### 2.3 Smoke test first

**Always do a smoke run before a real deployment.** Set `SB_SMOKE_TEST=1` and bootstrap on any
Ubuntu 24.04 machine (a cloud VM is fine). It exercises the *entire* pipeline — zones, model,
surfpool, deploy scripts, provisioning, recording — with a tiny model and 2 participants. Everything
except scale is identical to production.

### 2.4 SR-IOV / VM mode (only if you know you need it)

Container mode needs none of this. If you are running `vm` mode for line-rate VF passthrough:
`SB_SRIOV_ENABLE=1`, `SB_SRIOV_PF` set to a **dedicated, non-bonded** NIC port, and BIOS
IOMMU/ACS/SR-IOV/AER on. Creating VFs on a bonded management port can drop host connectivity — do this
only with out-of-band/console recovery available. The `host/12-sriov.sh` step may require a reboot;
see §3.2.

---

## 3. Bootstrapping the server

### 3.1 Run it

As root, from the repo root on a fresh Ubuntu 24.04 box:

```sh
sudo ./bootstrap.sh
```

Bootstrap runs six idempotent, re-runnable stages: base packages → Incus + ZFS + bridge →
(SR-IOV, if enabled) → zones (`admin`/`challenges`/`inference`) → participant template → host-agent →
deploy challenges. Each stage is safe to re-run; a completed stage records a marker and is skipped.

On success it prints a summary:

```
Dashboard:     http://<host-lan-ip>:8080
Asciinema:     http://<host-lan-ip>:4000
Surfpool RPC:  http://<host-lan-ip>:8899
Participant SSH ports: <first>-<last>
```

### 3.2 If it asks you to reboot (SR-IOV only)

When `SB_SRIOV_ENABLE=1` changes the kernel cmdline or installs a new kernel, bootstrap writes a
reboot marker, prints instructions, and exits cleanly. Reboot, then resume from that stage:

```sh
sudo ./bootstrap.sh --from 12-sriov
```

`--from <stage>` resumes at any stage by name if you ever need to re-run a portion.

### 3.3 Verify it came up

```sh
# From the host — zone health (Incus + systemd + TCP), needs the host-agent token:
curl -sS -H "Authorization: Bearer $SB_HOST_AGENT_TOKEN" http://10.61.0.1:7000/zones | jq

# Surfpool validator health:
curl -sS -X POST -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' \
  http://10.61.0.20:8899 | jq

# Inference server health (from the host, over the bridge):
curl -sS http://10.61.0.30:8080/health | jq
```

Then open the dashboard at `http://<host-lan-ip>:8080` and log in with `SB_ADMIN_TOKEN`.

---

## 4. Provisioning claimants

Provisioning a participant does a lot in one call: copies the golden `p-template` box, assigns a
static IP and an SSH proxy port, sets a random `claimant` password (and your optional SSH key),
generates a funded Solana keypair, assigns a private inference API key, writes `CLAIM_NUMBER` /
`ESTATE_API_KEY` into the box, registers the claimant with executor-api (which triggers on-chain
funding + `init_claim`), and provisions an asciinema stream token.

### From the dashboard (normal path)

**Participants** page → **Provision**. The table then shows name, IP, SSH port, status, revealed
rooms, and wallet balances. Open a participant's drawer for credentials, a live terminal embed, and
per-participant actions.

### From the host-agent API (scripting / bulk)

```sh
# Provision the next free participant (optionally pin a name and/or install an SSH key):
curl -sS -X POST \
  -H "Authorization: Bearer $SB_HOST_AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"p01","authorizedKey":"ssh-ed25519 AAAA..."}' \
  http://10.61.0.1:7000/participants | jq

# List everyone (state merged with live Incus status):
curl -sS -H "Authorization: Bearer $SB_HOST_AGENT_TOKEN" \
  http://10.61.0.1:7000/participants | jq
```

The response for a new participant includes the SSH port and generated password — this is what you
hand the claimant at check-in. To bulk-provision a full field, loop the `POST /participants` call
`SB_PARTICIPANT_COUNT` times with empty bodies.

> Provisioning is **idempotent per identity**: a `reset` (below) rebuilds a box while preserving its
> claim number, keys, and revealed rooms.

---

## 5. Running the show — the dashboard

Log in at `http://<host-lan-ip>:8080` with `SB_ADMIN_TOKEN`. Pages:

- **Overview** — zone health cards, surfpool slot/health, inference `/health` + `/slots`, and the live
  **event feed** (SSE). This is your at-a-glance heartbeat.
- **Participants** — the provision button, the participant table, and per-participant drawers
  (credentials, live terminal, reveal/suspend/reset actions).
- **Live Wall** — a grid of every active claimant's live terminal, for the broadcast.
- **Challenges** — the claimant × room status matrix, **reveal-to-all**, the **Executor's Mercy**
  button, and room-specific panels (Room 3 reconstruction attempts, Room 5 scoreboard).
- **Recordings** — the asciinema library with embedded replays.

The browser only ever talks to the dashboard and the asciinema server; all privileged calls to
host-agent and executor-api happen server-side with the tokens injected.

### The event feed

Every consequential event streams live (`room1.proven`, `room2.fee-kept`, `room3.trap-settled`,
`room4.presented`, `room5.route-complete`, `combo.reveal`, `mercy.granted`, …). This is both your
operational monitor and the raw material for the broadcast Ledger Wall / Executor Feed. The last 50
events are replayed on connect, then live updates follow. Room 1/2 **rejection** diagnostics are
admin-only here — the public surface never says why a claimant failed.

---

## 6. Reveals

A room's brief and its live parameters stay sealed until you reveal it. Reveal pushes the room's
content into the claimant's box (`~/estate/rooms/<room>/`) and unseals its clause endpoint.

```sh
# Reveal one room to one participant:
curl -sS -X POST \
  -H "Authorization: Bearer $SB_HOST_AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"room":"room1"}' \
  http://10.61.0.1:7000/participants/p01/reveal
```

For "everyone at once," use **reveal-to-all** on the dashboard's Challenges page. Reveal in the order
the show runs the rooms; a sealed room returns `404` from its clause endpoint, so revealing is what
"opens the door."

---

## 7. The Executor's Mercy

Because every unlock code is deterministic (`HMAC_SHA256(SB_ESTATE_SECRET, claim ‖ room)`), you can
release a stuck claimant's *correct* combination or deed without anyone guessing. Mercy is a real,
priced, on-screen event — not a quiet backdoor:

- Trigger it from the **Challenges** page (per-claimant; for Room 3, it hands the claimant their
  correct key fragment so the group is never blocked by one laptop).
- It emits a `mercy.granted` event and is announced/priced against the burning pot by the Actuary.

Use it deliberately — it keeps the show moving without becoming a production embarrassment, but it is
meant to *cost* the pot, so it stays a genuine decision on camera.

---

## 8. Participant lifecycle operations

All available from the participant drawer or the host-agent API:

| Action | API | Effect |
|---|---|---|
| Suspend | `POST /participants/:name/suspend` | Stops the box (frees CPU/RAM; identity kept). |
| Resume | `POST /participants/:name/resume` | Starts a suspended box. |
| Reset | `POST /participants/:name/reset` | Rebuilds from template but **re-applies** IP, keys, and reveals. Use when a box is wedged. |
| Delete | `DELETE /participants/:name` | Destroys the box and releases its inference API key. |

```sh
curl -sS -X POST -H "Authorization: Bearer $SB_HOST_AGENT_TOKEN" \
  http://10.61.0.1:7000/participants/p01/reset
```

Reset is your go-to recovery: a claimant who has corrupted their environment gets a clean box back
with the same identity and the same rooms already revealed.

---

## 9. Recordings

- Sessions record to the self-hosted **asciinema server** in the `admin` tenant (`:4000`), with a
  local `.cast` fallback written inside each box (`/var/log/sessions`). Recording is **fail-open**:
  if the relay or recorder can't start, the claimant still gets a working shell — a broken relay can
  never block a login.
- The **Live Wall** and per-participant terminal embeds are live asciinema streams, provisioned per
  box at creation time.
- **Two cautions:** the asciinema server grants admin to the *first* user created (setup creates
  `estate-admin` before any participant — don't create users out of order), and the server's admin
  panel port (`4002`) is **unauthenticated — never publish it** to the LAN. Only `:4000` is meant to
  be reachable.

---

## 10. Troubleshooting

| Symptom | Where to look / what to do |
|---|---|
| A zone is down | `GET /zones` (host-agent) or the Overview cards. Then `incus list` and `incus exec <zone> systemctl status <svc>` on the host. |
| surfpool not healthy after reboot | The `--db` state file should persist; if not, the deploy scripts are idempotent — re-run `host/50-deploy-challenges.sh` (or `sudo ./bootstrap.sh --from 50-deploy-challenges`). |
| Model missing / inference 503 | The model download (`zones/inference/download-model.sh`) needs internet at setup time and lands in the host-mounted `SB_MODELS_DIR` (survives rebuilds). Re-run inference setup if the GGUF is absent. |
| SPL programs missing on the surfnet | Deploy step `00-ensure-spl.ts` loads bundled `.so` dumps under `--offline`; if it was skipped, re-run the deploy. |
| Inference feels slow | Expected under concurrency — CPU inference yields a few tok/s per user at 5–10 concurrent. Check `SB_LLAMA_PARALLEL` and slot usage on Overview; the quant is config-swappable if you need to trade quality for speed. |
| Claimant can't log in | Their box may be suspended (resume it) or wedged (reset it). Recording failures never block login, so that's not the cause. |
| A clause endpoint returns 404 | The room isn't revealed to that claimant yet. Reveal it. |

**General recovery principle:** every bootstrap stage and every deploy script is idempotent and
re-runnable. When in doubt, re-run the relevant stage with `sudo ./bootstrap.sh --from <stage>` rather
than hand-patching a zone.

---

## 11. Security checklist

- `SB_ESTATE_SECRET`, `SB_ADMIN_TOKEN`, `SB_HOST_AGENT_TOKEN` stay secret. Rotating `SB_ESTATE_SECRET`
  changes **every** unlock code — never change it mid-event.
- Inference (`:8080`) is not LAN-exposed. Keep it that way.
- The asciinema admin port (`:4002`) is unauthenticated — never publish it.
- Everything is a private Solana test network with a token you mint (`SCRIP`). Nothing touches
  mainnet; the on-screen prize burn is production-side, not a real transfer. Worst case a claimant
  "loses" `SCRIP` you minted.
- host-agent validates every input against `[a-z0-9-]` and never passes raw input to a shell — keep
  it that way if you extend it.

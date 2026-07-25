# Admin Guide — Running the Bureau

Operational guide for deploying and running the Speed Build 2026 Bureau server. It covers
bootstrapping, provisioning operatives, dashboard control, reveals, manual override, recordings,
and recovery. Pair it with the authoritative [architecture contract](ARCHITECTURE.md), which is
the source of truth for layouts, ports, APIs, and byte formats.

## 1. The shape of the system

One bare-metal Ubuntu 24.04 server, Sunburst, runs isolated Incus tenants on the private
`10.61.0.0/24` bridge:

| Tenant | Internal IP | Runs |
|---|---|---|
| `admin` | `10.61.0.10` | Admin dashboard (`:3000` → host `:8080`), asciinema server (`:4000`) |
| `challenges` | `10.61.0.20` | surfpool (`:8899`/`:8900`), bureau-api (`:8700`–`:8710`) |
| `p01`…`pNN` | `10.61.0.101+` | One isolated box per operative, SSH proxied to host port `2200+N` |
| host | `10.61.0.1` | host-agent provisioning API (`:7000`) |

Three services matter operationally:

- **host-agent** on `:7000` provisions, reveals to, and manages participant boxes. It uses bearer
  `SB_HOST_AGENT_TOKEN`.
- **bureau-api** provides on-chain watchers, x402 resources and facilitators, Room 5 ledger nodes,
  deterministic result generation, and the `:8710` admin surface. It runs as
  `bureau-api.service`; admin calls use bearer `SB_ADMIN_TOKEN`.
- **admin-dashboard** is reached at `http://<host-lan-ip>:8080`. It proxies host-agent and
  bureau-api server-side; login uses `SB_ADMIN_TOKEN`.

The venue LAN can reach the dashboard (`:8080`), asciinema (`:4000`), surfpool RPC/WS
(`:8899`/`:8900`, for organizer laptops), and participant SSH ports.

## 2. Before the event — configuration

### 2.1 Secrets and config

Bootstrap copies `config/speedbuild.env.example` to `config/speedbuild.env` on first run and stops
until all three required secrets are set:

```sh
openssl rand -hex 32   # run three times
```

Set:

- `SB_BUREAU_SECRET` — HMAC seed for every deterministic challenge result and lock assignment.
  Keep it fixed and private for the full event.
- `SB_ADMIN_TOKEN` — dashboard login and bureau-api admin bearer.
- `SB_HOST_AGENT_TOKEN` — host-agent bearer.

These three values form the administrative security boundary.

### 2.2 Key config knobs

The full list is documented in `config/speedbuild.env.example`.

| Key | Default | Notes |
|---|---|---|
| `SB_PARTICIPANT_COUNT` | `30` | Number of participant boxes provisioned by a full run. |
| `SB_OPERATIVE_POOL` | `24` | Number of operative IDs whose codes are generated in advance; minimum `16`. |
| `SB_TENANT_MODE` | `container` | Validated default. Use `vm` only with a dedicated non-bonded SR-IOV NIC and console/BMC recovery. |
| `SB_SRIOV_ENABLE` | `0` | Leave disabled unless intentionally using VF passthrough. |
| `SUNBURST_OR_KEY` | blank | Shared OpenRouter key for participant OpenCode access to GPT 5.6 Sol. |
| `SB_SMOKE_TEST` | `0` | `1` provisions two participants with small limits, container mode, and no SR-IOV. |

`SB_OPERATIVE_POOL` is independent of provisioning. Codes are generated for
`OPERATIVE-01`…`OPERATIVE-NN` the night before. Assign IDs at check-in; unused IDs become
reserves.

### 2.3 Smoke test first

Run a smoke deployment before production. Set `SB_SMOKE_TEST=1` and bootstrap on Ubuntu 24.04.
The smoke run exercises zones, surfpool, deployment, provisioning, and recording with two
participants. Everything except scale follows the production flow.

### 2.4 SR-IOV / VM mode

Container mode needs no SR-IOV setup. For `vm` mode with line-rate VF passthrough, set
`SB_SRIOV_ENABLE=1`, point `SB_SRIOV_PF` at a dedicated non-bonded NIC, and ensure
IOMMU/ACS/SR-IOV/AER plus out-of-band or console recovery are available. Creating VFs on a bonded
management port can drop host connectivity. `host/12-sriov.sh` may require the reboot flow in
§3.2.

## 3. Bootstrapping the server

### 3.1 Run it

From the repository root on a fresh Ubuntu 24.04 host:

```sh
sudo ./bootstrap.sh
```

Bootstrap runs idempotent, re-runnable stages: base packages; Incus, ZFS, and bridge; optional
SR-IOV; `admin`/`challenges` zones; participant template; host-agent; and challenge deployment.
Completed stages record markers and are skipped.

Successful bootstrap prints:

```text
Dashboard:     http://<host-lan-ip>:8080
Asciinema:     http://<host-lan-ip>:4000
Surfpool RPC:  http://<host-lan-ip>:8899
Participant SSH ports: <first>-<last>
```

### 3.2 Reboot and resume for SR-IOV

When `SB_SRIOV_ENABLE=1` changes the kernel command line or installs a kernel, bootstrap writes a
reboot marker and exits cleanly. Reboot and resume:

```sh
sudo ./bootstrap.sh --from 12-sriov
```

Use `--from <stage>` to rerun from any named stage.

### 3.3 Verify services

```sh
# Zone health from the host:
curl -sS -H "Authorization: Bearer $SB_HOST_AGENT_TOKEN" \
  http://10.61.0.1:7000/zones | jq

# surfpool health:
curl -sS -X POST -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' \
  http://10.61.0.20:8899 | jq

# bureau-api health:
curl -sS -H "Authorization: Bearer $SB_ADMIN_TOKEN" \
  http://10.61.0.20:8710/health | jq
```

Open `http://<host-lan-ip>:8080` and log in with `SB_ADMIN_TOKEN`.

## 4. Provisioning operatives

Provisioning copies the `p-template` box, assigns a static IP and SSH proxy port, sets a random
`operative` password and optional SSH key, generates and funds a Solana keypair, writes
`OPERATIVE_ID`, `SOLANA_KEYPAIR`, and the configured `SUNBURST_OR_KEY`, registers the operative
with bureau-api, calls `init_operative`, and provisions an asciinema stream token.

### Dashboard path

On **Participants**, select **Provision**. The table shows name, operative ID, IP, SSH port,
status, revealed rooms, and wallet balances. Open a participant drawer for credentials, live
terminal, and per-participant actions.

### Host-agent API path

```sh
# Provision the next free participant, optionally pinning a box name and SSH key:
curl -sS -X POST \
  -H "Authorization: Bearer $SB_HOST_AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"p01","authorizedKey":"ssh-ed25519 AAAA..."}' \
  http://10.61.0.1:7000/participants | jq

# List state merged with live Incus status:
curl -sS -H "Authorization: Bearer $SB_HOST_AGENT_TOKEN" \
  http://10.61.0.1:7000/participants | jq
```

The creation response includes the SSH port and generated password for check-in. Bulk-provision
by calling `POST /participants` `SB_PARTICIPANT_COUNT` times with empty bodies.

Provisioning is idempotent per identity. A reset rebuilds the box while preserving its operative
ID, keys, and revealed rooms.

### Bureau state paths

The deployment and recovery paths are:

| Data | Path |
|---|---|
| Operative registry | `/var/lib/bureau/operatives.json` |
| Bureau deployer keypair | `/var/lib/bureau/deployer.json` |
| bureau-api SQLite state | `/var/lib/bureau-api/state.sqlite` |
| Registry IDL | `/opt/packages/bureau-registry/target/idl/bureau_registry.json` |

The operative registry uses top-level key `operatives`.

## 5. Running the event — dashboard

Log in at `http://<host-lan-ip>:8080` with `SB_ADMIN_TOKEN`.

- **Overview** — zone health, surfpool slot/health, operative count, and the live SSE event feed.
- **Participants** — provision button, participant table, and drawers for credentials, terminal,
  reveal, suspend, and reset.
- **Live Wall** — every active operative terminal for production monitoring.
- **Challenges** — operative × room status matrix; reveal-to-all; manual override; Room 3
  reconstruction attempts; Room 5 scoreboard; and a **LOCKS** panel listing every lock, assigned
  group, and live operative, with the live code revealed only on request. It also provides
  force-complete per operative and mark-room-complete controls.
- **Recordings** — asciinema library and embedded replays.

The browser talks only to the dashboard and asciinema. Privileged host-agent and bureau-api calls
are server-side with bearer tokens injected there.

### Event feed

Consequential events stream through `GET /events`, including `operative.registered`,
`room1.verified`, `room1.rejected`, `room2.fee-kept`, `room3.trap-settled`, `room4.presented`,
`room5.route-complete`, `combo.reveal`, `room.revealed`, `override.granted`,
`override.completed`, and `room.completed`.

The latest 50 events replay on connection before live updates. Room 1 and Room 2 rejection details
are admin-only; the public surface does not explain a failed attempt.

## 6. Reveals

Brief content and live parameters stay unavailable until reveal. Reveal pushes
`~/bureau/rooms/<room>/BRIEF.md` into the participant box and enables
`GET /brief/:room?operative=`.

```sh
curl -sS -X POST \
  -H "Authorization: Bearer $SB_HOST_AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"room":"room1"}' \
  http://10.61.0.1:7000/participants/p01/reveal
```

For a simultaneous release, use **reveal-to-all** on **Challenges**. Reveal rooms in event order.
Before reveal, the operative's `/brief` request returns `404`.

## 7. Manual override

Verification gates the reveal of a value, never its existence. Every code exists from the moment
it is generated the night before, whether or not anyone earns it. The system decides when it is
shown, not whether it is real. A marshal can therefore short-circuit any gate at any time without
breaking anything downstream.

### Route 1 — system side

The **Challenges** page can display all lock assignments, reveal any live lock code at any time,
issue any well-formed operative ID a valid challenge result on demand, force-complete one room for
one operative, and mark a whole room complete. None of these actions depends on normal challenge
state.

The `:8710` API uses bearer `SB_ADMIN_TOKEN`:

```http
GET /locks
POST /override {"operativeId":"OPERATIVE-07","room":"room2"}
POST /force-complete {"operativeId":"OPERATIVE-07","room":"room2"}
POST /rooms/room2/complete
```

- `GET /locks` returns `{pool, locks:[{room,lock,members,liveOperative,liveCode}]}` and reproduces
  the night-before lock sheet.
- `POST /override` returns the correct combo or fragment for any well-formed operative ID,
  regardless of registration or progress, and emits `override.granted`.
- `POST /force-complete` records the operative's room completion, returns the unlock, and emits
  `override.completed`.
- `POST /rooms/:room/complete` writes whole-room completion and emits `room.completed`.

### Route 2 — physical side

Every physical lock requires a master key, known reset code, or documented bypass that works with
no system or venue network. The route must be tested and documented before the event day. Lock
bypass is a required props/purchasing item, not an optional software task.

## 8. Participant lifecycle

All actions are available in the participant drawer and through host-agent:

| Action | API | Effect |
|---|---|---|
| Suspend | `POST /participants/:name/suspend` | Stops the box while retaining identity. |
| Resume | `POST /participants/:name/resume` | Starts a suspended box. |
| Reset | `POST /participants/:name/reset` | Rebuilds from the template and reapplies IP, keys, identity, and reveals. |
| Delete | `DELETE /participants/:name` | Destroys the box and removes its stored identity. |

```sh
curl -sS -X POST -H "Authorization: Bearer $SB_HOST_AGENT_TOKEN" \
  http://10.61.0.1:7000/participants/p01/reset
```

Reset is the standard recovery for a damaged participant environment.

## 9. Recordings

- Interactive sessions stream to the self-hosted asciinema server in `admin` on `:4000`, with a
  local `.cast` fallback at `/var/log/sessions` inside each box.
- Recording is fail-open. If the relay or recorder fails, the operative still receives a shell.
- The **Live Wall** and participant terminal embeds use streams provisioned when each box is
  created.
- asciinema grants admin to the first user created. Setup must create `bureau-admin` before any
  participant account.
- The asciinema admin panel on `:4002` is unauthenticated and must never be published to the LAN.
  Only `:4000` is intended for venue access.

## 10. Troubleshooting

| Symptom | Where to look / action |
|---|---|
| A zone is down | Check `GET /zones` or Overview, then `incus list` and `incus exec <zone> systemctl status <svc>`. |
| surfpool is unhealthy after reboot | Verify the `--db` state file. If necessary rerun `host/50-deploy-challenges.sh` or `sudo ./bootstrap.sh --from 50-deploy-challenges`; deployment programs are idempotent. |
| bureau-api is down | In `challenges`, inspect `systemctl status bureau-api.service` and `/var/lib/bureau-api/state.sqlite`; then rerun the challenge deployment stage if needed. |
| SPL programs missing | `00-ensure-spl.ts` loads bundled `.so` files in offline mode. Rerun deployment if it was skipped. |
| OpenCode cannot reach its model | Verify `SUNBURST_OR_KEY` is configured and participant boxes have outbound network access. |
| Operative cannot log in | Resume a suspended box or reset a damaged one. Recording failure does not block login. |
| `/brief/:room?operative=` returns `404` | The room has not been revealed to that operative. Reveal it. |
| Room 1 registration state is missing | Compare `/var/lib/bureau/operatives.json`, bureau-api `GET /state`, the `VerificationRecord`, and deployment logs for `init_operative`. |
| Room 4 presentation fails | Check the IDL path, `ClearanceRecord` freshness and `presented` flag, then review `room4.presented` or rejection diagnostics. |

Every bootstrap stage and deployment program is idempotent and re-runnable. Prefer
`sudo ./bootstrap.sh --from <stage>` over manual changes inside a tenant.

## 11. Security checklist

- Keep `SB_BUREAU_SECRET`, `SB_ADMIN_TOKEN`, and `SB_HOST_AGENT_TOKEN` private. Rotating
  `SB_BUREAU_SECRET` changes every code and lock assignment; never rotate it during the event.
- Do not expose the unauthenticated asciinema admin port `:4002`.
- Solana devnet and the pre-funded custom `CRED` token prevent mainnet and real-money exposure.
- Keep host-agent input validation restricted to `[a-z0-9-]`; never pass unvalidated input to a
  shell.
- Restrict read access to `/var/lib/bureau/deployer.json`, `/var/lib/bureau/operatives.json`, and
  `/var/lib/bureau-api/state.sqlite`.

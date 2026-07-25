# Speedbuild — Sunburst Architecture

Single-entrypoint bootstrap for the Speed Build 2026 ("The Bureau") competition on one bare-metal
Ubuntu 24.04 "Sunburst" box (AMD EPYC 9555P 64C/128T, 1.15 TB DDR5, 6.4 TB NVMe, no GPU,
Intel E2100 IPU NIC). This document is the **contract**: file layout, network plan, config keys,
API shapes, and per-component specs. Builder tasks implement exactly what is written here.

## 1. Tenants (Incus)

Host runs **Incus 7.0 LTS** (Zabbly `lts-7.0` repo), ZFS storage pool, one managed bridge.

**Tenant mode (`SB_TENANT_MODE`, default `container`)**: the validated, default operating mode is
Incus **system containers** — this is what the Speed Build 2026 host runs (its two NICs are a
single LACP management bond with no dedicated SR-IOV port or out-of-band recovery, so VF
passthrough is not safe there). `vm` mode (`--vm`, `images:ubuntu/24.04/cloud`, incus-agent for
exec/file-push) makes every tenant a VM so each can receive an SR-IOV VF by real PCIe/VFIO
passthrough (§1a); enable it **only** with `SB_SRIOV_ENABLE=1`, `SB_SRIOV_PF` set to a *dedicated
non-bonded* NIC port, and console/BMC recovery available. `SB_SMOKE_TEST=1` additionally forces
container mode and small-scale resources regardless. All programs branch via helpers in
`host/lib.sh`, never inline.

| Instance | Name | Mgmt IP (eth0) | Limits (default) | Runs |
|---|---|---|---|---|
| bridge | `sbbr0` | 10.61.0.1/24 (host gw) | — | host-agent listens here |
| VM | `admin` | 10.61.0.10 | 8 CPU / 24 GiB | admin-dashboard (:3000), asciinema-server (:4000, docker) |
| VM | `challenges` | 10.61.0.20 | 12 CPU / 64 GiB | surfpool (:8899/:8900), bureau-api (:8700/:8701/:8702/:8703/:8710) |
| VM | `p01`…`pNN` | 10.61.0.101+ (p01=101) | 4 CPU / 8 GiB / 30 GiB disk | sshd, participant env |
| VM | `p-template` | DHCP (stopped) | participant profile | golden image for `incus copy` |

VM memory is effectively reserved: defaults sum to ≈328 GiB for 30 participants, leaving
headroom for host + ZFS ARC (cap ARC in host tuning). `security.nesting` is a container-mode-only
concern (VMs run Docker natively).

### 1a. SR-IOV / VF data plane

Every tenant gets two NICs:
- **eth0 (mgmt/data-internal)**: Incus managed bridge `sbbr0` exactly as before — provisioning,
  inter-zone APIs, recording streams, SSH proxies. The internal 10.61.0.0/24 plan is unchanged.
- **eth1 (VF, line rate)**: an SR-IOV VF of the E2100 PF (`SB_SRIOV_PF`), attached via an Incus
  `nic` device `nictype=sriov parent=$SB_SRIOV_PF` on the shared profile `sb-vf` — Incus
  allocates a free VF per instance and, for VMs, passes it through via VFIO (IOMMU required).
  Guest-side: eth1 is DHCP-enabled with `use-routes: false` (cloud-init) so the default route
  stays on the mgmt bridge; the venue leaf-switch fabric owns eth1 addressing.

Host enablement (`host/12-sriov.sh`, gated by `SB_SRIOV_ENABLE=1`), verified specifics:
- **Kernel**: ensure HWE `linux-generic-hwe-24.04` (≥6.14; idpf is immature on GA 6.8). If a newer
  kernel was just installed, that counts as the reboot below.
- **IOMMU**: AMD-Vi is default-on — do NOT pass `amd_iommu=on` (invalid on current kernels). Add
  only `iommu=pt` to `GRUB_CMDLINE_LINUX_DEFAULT`, `update-grub`. BIOS must have IOMMU/ACS/SR-IOV/AER
  on (document; can't set from OS).
- **Reboot-and-resume**: if GRUB cmdline or kernel changed, write marker
  `/var/lib/speedbuild/markers/needs-reboot`, print instructions, exit 0 (bootstrap stops cleanly);
  operator reboots and reruns `sudo ./bootstrap.sh --from 12-sriov`.
- **idpf**: auto-probes by PCI ID; apply the documented IPU init workaround once
  (`modprobe -r idpf && modprobe idpf`) if the PF netdev is missing after boot.
- **Capability probe (the E2100 unknown)**: `echo 2 > /sys/class/net/$SB_SRIOV_PF/device/sriov_numvfs`;
  if it errors or `dmesg` shows `SR-IOV is not supported on this device`, HARD FAIL with a message
  naming the cause (IPU control-plane/`cp_init.cfg` must advertise `VIRTCHNL2_CAP_SRIOV`; Intel
  MEV-ts/IMC config, vendor territory). Read `TotalVFs` from `lspci -vvv` and refuse if
  `SB_SRIOV_VF_COUNT` exceeds it.
- **VF count persistence**: netplan `virtual-function-count` on the PF is primary; also install a
  systemd oneshot `sriov-vfs.service` (`BindsTo` the PF device) as the ordering-proof fallback.
- **IOMMU-group viability check**: for a sample VF, confirm its `/sys/kernel/iommu_groups/*/devices`
  group isn't shared with unrelated functions (the known "group N is not viable" VM failure). Warn
  loudly if shared — VMs will fail to start; containers wouldn't.
- Absent PF: hard fail in production; skip+warn when `SB_SMOKE_TEST=1`.

**VM guest dual-NIC determinism**: the `sb-vf` and zone/participant profiles set
`cloud-init.network-config` matching by MAC — eth0 (bridge, fixed `hwaddr`) is DHCP WITH default
route + Incus DNS; the VF NIC is DHCP with `use-routes:false, use-dns:false` (or static from the
fabric). Fixed `hwaddr` on every device so the netplan `match:` is stable across VM PCI reordering.

**Host proxy devices (LAN exposure):**
- `admin` :3000 → host :8080 (dashboard), `admin` :4000 → host :4000 (asciinema ws/player)
- `challenges` :8899/:8900 → host :8899/:8900 (surfpool RPC/WS, for organizer laptops)
- `pNN` :22 → host :(SB_SSH_PORT_BASE+N), e.g. p01 → 2201

Participants reach `challenges` directly via its bridge IP (all containers share `sbbr0`).

## 2. Repo layout & task ownership

```
bootstrap.sh                  # single entrypoint (root, fresh Ubuntu 24.04)
config/speedbuild.env.example # all config keys (copied to config/speedbuild.env)
host/                         # host-side bash: 00-base, 10-incus, 20-zones, 30-participant-template,
                              #   40-host-agent, 50-deploy-challenges, lib.sh
zones/participant/            # runs INSIDE p-template: setup.sh, rec-shell, opencode config
zones/challenges/             # runs INSIDE challenges: setup.sh, surfpool.service, deploy programs
zones/admin/                  # runs INSIDE admin: setup.sh, asciinema docker-compose, dashboard service
packages/bureau-registry/     # Anchor program (Rooms 1 & 4)
packages/bureau-api/          # Bun/TS backend (watchers, x402, ledger nodes, shamir, combos, SSE)
packages/host-agent/          # Bun/TS HTTP API on the HOST (incus provisioning)
packages/admin-dashboard/     # SvelteKit (Svelte 5 runes) + Bun
packages/challenges-content/  # per-room briefs + starter files pushed to participants on reveal
```

Each `packages/*` dir is standalone (own `package.json`, `tsconfig.json`, `bun.lock` — no root
workspace). Root `package.json` is minimal/private. TS strict everywhere, Bun runtime.

## 3. Config contract — `config/speedbuild.env`

KEY=VALUE, sourced by bash, parsed by Bun services. Keys (defaults in parens):

```
SB_PARTICIPANT_COUNT (30)        SB_SSH_PORT_BASE (2200)
SB_OPERATIVE_POOL (24, min 16)
SB_BRIDGE_NAME (sbbr0)           SB_SUBNET_PREFIX (10.61.0)
SB_BUREAU_SECRET (hex, required) SB_ADMIN_TOKEN (required)     SB_HOST_AGENT_TOKEN (required)
SB_ZPOOL_SIZE (2000GiB)          SUNBURST_OR_KEY (OpenRouter key)
SB_CHAL_CPUS (12)   SB_CHAL_MEM (64GiB)
SB_ADMIN_CPUS (8)   SB_ADMIN_MEM (24GiB)
SB_PART_CPUS (4)    SB_PART_MEM (8GiB)   SB_PART_DISK (30GiB)
SB_TENANT_MODE (vm) # vm | container; container forced when SB_SMOKE_TEST=1
SB_SRIOV_ENABLE (1) # 0 disables all SR-IOV/IOMMU steps and the sb-vf profile
SB_SRIOV_PF ()      # host netdev name of the E2100 PF, e.g. enp1s0f0 (required when enabled)
SB_SRIOV_VF_COUNT (40)
SB_SMOKE_TEST (0)   # 1 = 2 participants, small limits, container mode, SR-IOV skipped
```

Derived IP/port constants live in `host/lib.sh` (bash) and are duplicated as literals in each
package's `config.ts` (no shared package; this doc is the source of truth).

## 4. Bootstrap flow (`bootstrap.sh`)

Run as root from repo root on fresh Ubuntu 24.04. Steps (each `host/NN-*.sh` is idempotent,
re-runnable, `set -euo pipefail`):

1. `00-base.sh` — apt base packages (curl, git, jq, zfsutils-linux, build tools), install bun on
   host, sysctl (fs.inotify limits up).
2. `10-incus.sh` — Zabbly repo (`lts-7.0`), install incus, `incus admin init --preseed` (ZFS pool
   `sbpool`, bridge `sbbr0` 10.61.0.1/24), create profiles (incl. `sb-vf` when SR-IOV enabled).
2a. `12-sriov.sh` — IOMMU kernel cmdline + GRUB (reboot-and-resume flow), persistent VF creation
   on `SB_SRIOV_PF`, verification. No-op when `SB_SRIOV_ENABLE=0`.
3. `20-zones.sh` — launch `admin`/`challenges` with static IPs
   (`incus config device override <c> eth0 ipv4.address=…`), push the matching `zones/<name>/`
   dir + needed `packages/*` dirs into the container (`incus file push -r`), run its `setup.sh`
   via `incus exec`, add proxy devices.
4. `30-participant-template.sh` — launch `p-template`, push `zones/participant/`, run setup.sh,
   stop container.
5. `40-host-agent.sh` — install `packages/host-agent` to `/opt/speedbuild/host-agent`, systemd
   unit `sb-host-agent.service`, listens on 10.61.0.1:7000.
6. `50-deploy-challenges.sh` — wait for surfpool health, then `incus exec challenges` the deploy
   programs (§7). Prints final summary (URLs, tokens, next steps).

## 5. Participant environment (`zones/participant/setup.sh`, run inside p-template)

- User `operative` (sudo-less), shell = `/usr/local/bin/rec-shell`.
- Install: build-essential, git, jq, curl, node 22 (via apt/nodesource) **and bun**, Rust
  (rustup, stable), Solana CLI (Agave), Anchor via avm, `spl-token` CLI, Pay.sh CLI
  (`npm i -g @solana/pay`), asciinema **3.2.x static binary** (NOT the apt 2.x package),
  OpenCode (`curl -fsSL https://opencode.ai/install | bash` to /usr/local/bin).
- Solana CLI default: `solana config set -u http://10.61.0.20:8899`.
- `rec-shell` (fail-open bash wrapper, per research): non-interactive/SFTP passthrough; guards
  `$ASCIINEMA_SESSION`; interactive → `exec asciinema session -o /var/log/sessions/$USER-<ts>.cast -r -c "/bin/bash -l"`,
  falling back to plain bash. asciinema server URL config → `http://10.61.0.10:4000`.
- OpenCode global config `/home/operative/.config/opencode/opencode.json`:
  provider `openrouter`, runtime key token `{env:SUNBURST_OR_KEY}`, default model
  `openai/gpt-5.6-sol`, and selectable alternative `z-ai/glm-5.2`.
- `~/.bureau-env` and the login environment contain `OPERATIVE_ID`, `SOLANA_KEYPAIR`, and,
  when configured, `SUNBURST_OR_KEY` values filled at provision time by host-agent.
- `~/bureau/` dir with README; challenge briefs appear at `~/bureau/rooms/<roomN>/` on reveal.

## 6. OpenCode model access

Participant OpenCode sessions use OpenRouter over the network. The host-agent copies the shared
`SUNBURST_OR_KEY` into each box at provision or reset time. GPT 5.6 Sol is the default model and
GLM 5.2 remains selectable in OpenCode.

## 7. Challenges zone (`zones/challenges/`)

- `setup.sh`: rust + Solana CLI + anchor + bun + surfpool v1.5.0 Linux binary (GitHub release
  tarball) + `@solana/pay` CLI (for local testing).
- `surfpool.service`: `surfpool start --no-tui --no-studio --host 0.0.0.0 --port 8899
  --ws-port 8900 --offline --db /var/lib/surfpool/state.sqlite --surfnet-id bureau`,
  `Restart=on-failure`. (NOT `--daemon` — known crash.)
- `deploy/` (Bun programs, run in order by `50-deploy-challenges.sh`):
  1. `00-ensure-spl.ts` — verify SPL Token / ATA / Memo programs exist on the surfnet; if
     missing, load bundled `.so` dumps via `surfnet_setAccount`/`surfnet_writeProgram`
     (dumps fetched from mainnet during bootstrap while internet is available).
  2. `10-mint-cred.ts` — create `CRED` SPL mint (6 decimals), authority = Bureau deployer
     keypair `/var/lib/bureau/deployer.json`.
  3. `20-deploy-registry.ts` — `anchor build` (if needed) + deploy `bureau_registry`, then
     `initialize(authority)`.
  4. `30-fund-and-seed.ts` — reads operative registry from bureau-api admin (or a JSON arg):
     per operative `surfnet_setAccount` (SOL) + `surfnet_setTokenAccount` (CRED), create
     clearance ATAs, `init_operative` per operative, `init_operative_holdings` per operative.
- bureau-api installed to `/opt/packages/bureau-api`, systemd `bureau-api.service` (bun).
- Persistent paths: operative registry `/var/lib/bureau/operatives.json` (top-level key
  `operatives`), deployer keypair `/var/lib/bureau/deployer.json`, bureau-api database
  `/var/lib/bureau-api/state.sqlite`, and registry IDL
  `/opt/packages/bureau-registry/target/idl/bureau_registry.json`.

## 8. `bureau_registry` Anchor program (`packages/bureau-registry`)

Anchor (workspace pinned to installed anchor-cli 1.1.2), program name `bureau_registry`.

Accounts (field order = exact byte layout after the 8-byte discriminator; briefs depend on it):

- `Config` — seeds `["config"]`: `{ authority: Pubkey, code_window_slots: u64 }` (default 4500).
- `VerificationRecord` — seeds `["claim", lowercase(operative_id)]`:
  `{ verifier: Pubkey /*8..40*/, status: u8 /*40; 0=UNVERIFIED, 1=VERIFIED*/, clearance_nonce: u64 /*41..49 LE*/, clearance_ata: Pubkey /*49..81*/ }`
- `OperativeHoldings` — seeds `["holdings", operative_id]`:
  `{ registrar_key: Pubkey /*8..40*/, codes_minted: u8 /*40*/ }`
- `ClearanceRecord` — seeds `["deed", operative_id]`:
  `{ operative: String(≤16), clearance_code: [u8;8], issued_slot: u64, presented: bool }`

Instructions:
- `initialize(code_window_slots: u64)` — creates Config, authority = signer.
- `init_operative(operative_id: String≤16, clearance_nonce: u64)` — authority only; `clearance_ata`
  passed as account; status=`UNVERIFIED`, verifier=authority.
- `mark_verified(operative_id: String)` — authority only; sets status=1.
- `init_operative_holdings(operative_id: String≤16, registrar_key: Pubkey)` — authority only.
- `mint_code(operative_id: String, memo_hash: [u8;32])` — permissionless. Requires:
  (a) `remaining_accounts[0].key == holdings.registrar_key` else error `RegistrarMissing`;
  (b) via Instructions sysvar: same tx contains an SPL Memo (`MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr`)
  instruction whose data == lowercase-hex(memo_hash) else `MemoMissing`;
  (c) existing clearance record must have `presented == false` (re-mint allowed) else
  `CodeAlreadyPresented`.
  Sets `clearance_code` = first 8 chars of base58(sha256(operative_id ‖ memo_hash ‖ issued_slot_le)),
  `issued_slot` = Clock::slot, `presented=false`.
- `present_code(operative_id: String, code: String)` — authority only; checks code match
  (`CodeMismatch`), freshness `clock.slot - issued_slot <= config.code_window_slots`
  (`CodeStale`), `presented == false` (`CodeAlreadyPresented`); sets presented=true.
- `set_code_window(code_window_slots: u64)` — authority only; updates the allowed presentation
  window in Config.

## 9. `bureau-api` (`packages/bureau-api`, Bun + Hono + bun:sqlite)

One process, multiple listeners:

| Port | Surface |
|---|---|
| 8700 | Public: `GET /brief/:room?operative=`; Room 2 `/component/:operative`, `/authorize/:operative`; Room 3 `/fragment/:operative`, `/reconstruct/*`; Room 4 `POST /code/present` |
| 8701 | Honest x402 facilitator (`/verify`, `/settle`, `/supported`) — `@x402/svm` + `@x402/core`, RPC → `http://127.0.0.1:8899` |
| 8702 | FAC-A trap facilitator: settles for real, but flags the operative's fragment as poisoned |
| 8703 | Room 5 ledger nodes: `/node/start?operative=`, `/node/:id?operative=` — x402-v2 402 challenges payable by Pay.sh (`pay curl` with `--local`) |
| 8710 | Admin, bearer `SB_ADMIN_TOKEN`: `POST /operatives`, `POST /reveal`, `POST /override`, `POST /force-complete`, `POST /rooms/:room/complete`, `GET /locks`, `GET /state`, `GET /events`, `GET /health` |

`GET /brief/:room?operative=` returns `404` until the room is revealed to that operative.

Core services:
- **Combos**: `HMAC_SHA256(SB_BUREAU_SECRET, operative_id ‖ room_id)` → 4-digit (`mod 10000`),
  base58-truncated fragments, flash seconds. `SB_OPERATIVE_POOL` defaults to 24 and rejects values
  below 16; derivation runs for `OPERATIVE-01`…`OPERATIVE-NN` regardless of registration. IDs are
  assigned at check-in and unused IDs remain available to reserves.
- **Lock assignments**: Room 1 has four locks with groups
  `4(k-1)+1..4k`; Room 2 has four locks with groups `3(k-1)+1..3k`. For room `R` and lock `k`,
  `liveIndex = hmac(secret, "lock:<R>:<k>", "live").readUIntBE(0,4) % groupSize`; live code is
  `fourDigit(liveOperativeId, room, secret)`. Every operative still receives an individual code after
  verification; only the selected member's code opens the group's physical lock.
- **Room 1 watcher**: WS `accountSubscribe` per clearance ATA + `getTransaction` (checks sender,
  `amount == 1000 + nonce % 9000` base units, memo == first 16 hex of
  sha256(utf8(operative) ‖ nonce_LE)); on match calls `mark_verified` and emits reveal event.
- **Room 2**: x402 v2 402s with `extra.memoRequired`; Hop A settled-without-memo → 200 SEALED +
  `carry` nonce_B; Hop B amount `4000 + nonce_B % 6000` to a derived recipient.
- **Room 3**: Shamir GF(256) k=4 n=6, per-share CRC byte; poison shares for two configured
  operatives and FAC-A settlements; SHA-256 counter-mode XOR share encryption; group console:
  3 attempts, Lagrange reconstruction, hash == target.
- **Room 4**: far-terminal endpoint — reads ClearanceRecord PDA, calls `present_code`.
- **Room 5**: 7 content-addressed nodes, 2 decoys with hints, per-operative traversal state, final
  score → flash_seconds + signed token, scoreboard event.
- All state in sqlite `/var/lib/bureau-api/state.sqlite`; every consequential event also inserted
  into `events` and pushed on SSE for the dashboard feed and event log.

Admin endpoint semantics:

- `POST /operatives {operativeId, pubkey}` registers an operative.
- `POST /reveal {operativeId|"all", room}` reveals one room to one operative or all operatives.
- `POST /override {operativeId, room}` returns the correct result for any well-formed operative ID
  matching `/^[A-Za-z0-9-]{1,16}$/`, regardless of registration or state, and emits
  `override.granted`.
- `POST /force-complete {operativeId, room}` writes per-operative completion, returns the result,
  emits `override.completed`, and calls `markRoom1Verified` for a registered Room 1 operative.
- `POST /rooms/:room/complete` writes global completion using sentinel operative ID `"*"` and
  emits `room.completed`.
- `GET /locks` returns `{pool, locks:[{room,lock,members,liveOperative,liveCode}]}` at any time.
- `GET /state` includes `roomsComplete: string[]` and `locks`.

Verification gates the reveal of a value, never the value's existence. Every deterministic value
exists after night-before generation, so any normal verification gate can be bypassed without
invalidating downstream state.

SQLite contract:

- `operatives`: `operative_id`, `pubkey`, `status` (`UNVERIFIED` or `VERIFIED`),
  `clearance_ata`, `clearance_nonce`, and per-room state columns.
- `room_state`: `(operative_id, room, key, value)`; operative ID `"*"` is reserved for whole-room
  completion and uses key `"complete"`.
- `events`: persisted event stream. Current names include `operative.registered`,
  `room1.verified`, `room1.rejected`, `room2.fee-kept`, `room3.trap-settled`,
  `room4.presented`, `room5.route-complete`, `combo.reveal`, `room.revealed`,
  `override.granted`, `override.completed`, and `room.completed`.

## 10. `host-agent` (`packages/host-agent`, Bun, runs on HOST, 10.61.0.1:7000)

Bearer auth `SB_HOST_AGENT_TOKEN`. State file `/var/lib/speedbuild/state.json`. Shells out to
`incus` (never exposes raw command input; all inputs validated `[a-z0-9-]`).

- `POST /participants` `{name?}` → next free `pNN`: `incus copy p-template pNN`, static IP
  `.100+N`, start, SSH proxy device `host:2200+N → :22`, set `operative` password (random) +
  authorized_key (optional input), generate Solana keypair (`@solana/kit`) → push to
  `/home/operative/.config/solana/id.json`, write `OPERATIVE_ID`, `SOLANA_KEYPAIR`, and the
  configured `SUNBURST_OR_KEY` into `/home/operative/.bureau-env`, register operative with
  bureau-api admin (`POST /operatives` — triggers funding + `init_operative`), provision
  asciinema stream token (best-effort; record failure in response), → returns full record.
- `GET /participants`, `GET /participants/:name` (merges state.json + live `incus list` status)
- `POST /participants/:name/reveal` `{room}` → `incus file push -r` of
  `packages/challenges-content/rooms/<room>/` → `/home/operative/bureau/rooms/<room>/` + call
  bureau-api reveal; records revealed set.
- `POST /participants/:name/(suspend|resume|reset)` — stop/start/`delete+recopy` (reset keeps
  identity: re-applies IP, keys, reveals).
- `DELETE /participants/:name`
- `GET /zones` — incus + `systemctl is-active` (via `incus exec`) health for both zones.
- `GET /health`

## 11. `admin-dashboard` (`packages/admin-dashboard`, SvelteKit, Svelte 5 runes, Bun)

Runs in `admin` container (:3000). Login = `SB_ADMIN_TOKEN` (cookie session). All upstream calls
happen server-side (SvelteKit endpoints proxy host-agent :7000 and bureau-api :8710 with
tokens); the browser talks only to the dashboard + asciinema-server (:4000 ws for live players).

Pages:
- **Overview** — zone health cards, surfpool slot/health, operative count, event feed (SSE).
- **Participants** — provision button, table (name, IP, SSH port, status, revealed rooms, wallet
  CRED/SOL balances via bureau-api), per-participant drawer: credentials, live terminal
  (asciinema-player ws embed), reveal/suspend/reset actions.
- **Live Wall** — grid of live players for all active participants.
- **Challenges** — per-room matrix (operative × room status from bureau-api), reveal-to-all,
  manual override, a LOCKS panel with every group and live code revealed on request,
  force-complete per operative, mark-room-complete, and room-specific panels for Room 3
  reconstruction attempts and the Room 5 scoreboard.
- **Recordings** — list from asciinema-server, embedded replays.

## 12. Recording pipeline

- asciinema-server self-hosted in `admin` via docker compose (`ghcr.io/asciinema/asciinema-server`
  + postgres 14), `STREAM_RECORDING=true`, port 4000.
- Participants stream via `asciinema session -r` (rec-shell). Local `.cast` always written to
  `/var/log/sessions` in the container as the fallback of record.
- **Provisioning (verified against asciinema-server source)**: the server container's Elixir
  release (`/opt/app/bin/asciinema rpc`) creates a user, registers a CLI install-id, and pre-creates an
  `unlisted` stream, returning `public_token`/`producer_token` (16 alnum chars each).
  `zones/admin/provision-stream.sh` wraps this; host-agent calls it per participant and pushes
  `~/.local/state/asciinema/install-id` + `~/.config/asciinema/stream-token` into the container.
  NOTE: the server grants admin to the FIRST user created — admin setup creates `bureau-admin`
  before any participant. The admin panel port 4002 is unauthenticated — never publish it.
- Live relay is gated per container: `rec-shell` streams with
  `asciinema session -r "$(cat ~/.config/asciinema/stream-token)"` only when that token file
  exists (dashboard embeds `ws://10.61.0.10:4000/ws/s/<public_token>`, known in advance). Without
  it, sessions record locally only — a broken relay can never block SSH logins.

## 13. Smoke test mode

`SB_SMOKE_TEST=1`: 2 participants and low limits — full pipeline testable on any Ubuntu 24.04 VM
(including nested-virt-capable cloud VM). Everything else identical.

## 14. Open risks (tracked)

1. asciinema token bulk provisioning (§12). 2. surfpool `--db` restart persistence (test; fallback:
re-run deployment programs; they are idempotent). 3. SPL programs under `--offline` (deploy step 00
handles). 4. Docker-in-Incus regressions for asciinema-server (pin Docker < 29 in admin zone).
5. Pay.sh custom-mint settlement (confirmed in source but untested end-to-end).

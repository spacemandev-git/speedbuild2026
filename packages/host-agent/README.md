# sb-host-agent

`sb-host-agent` is the host-side provisioning service for Speed Build 2026 and the Bureau game environment. It runs under Bun on the Ubuntu host, stores participant and operative identity state atomically, and invokes Incus exclusively through argv-based `Bun.spawn` calls.

The service listens on `10.61.0.1:7000`. On development machines where that bridge address is unavailable, it logs a warning and falls back to `0.0.0.0:7000`. Every endpoint requires `Authorization: Bearer $SB_HOST_AGENT_TOKEN`, including `/health`.

## API

| Method | Path | Body | Purpose |
|---|---|---|---|
| `GET` | `/health` | — | Process health |
| `GET` | `/zones` | — | Incus, systemd, and TCP health for both zones |
| `POST` | `/participants` | `{ "name"?: "p01", "authorizedKey"?: "ssh-ed25519 ..." }` | Provision the requested or next free participant |
| `GET` | `/participants` | — | List state merged with live Incus status |
| `GET` | `/participants/:name` | — | Get one participant and live status |
| `GET` | `/recordings/archive` | — | Download all available recordings as `bureau-recordings.tar` |
| `GET` | `/participants/:name/recordings` | — | List one participant's recordings |
| `GET` | `/participants/:name/recordings/archive` | — | Download one participant's recordings |
| `POST` | `/participants/:name/reveal` | `{ "room": "room1" }` | Push room content and notify bureau-api |
| `POST` | `/participants/:name/suspend` | — | Stop the participant container |
| `POST` | `/participants/:name/resume` | — | Start the participant container |
| `POST` | `/participants/:name/reset` | — | Rebuild while preserving identity and reveals |
| `DELETE` | `/participants/:name` | — | Delete the container and remove its stored identity |

Errors are JSON objects shaped as `{ "error": "...", "detail"?: "..." }`.

Provisioning assigns an `OPERATIVE-NN` id and configures the `operative` Unix user. Runtime values are written to `/home/operative/.bureau-env` as `OPERATIVE_ID`, `SOLANA_KEYPAIR`, and, when configured, `SUNBURST_OR_KEY`.

## Examples

```sh
curl -sS -H "Authorization: Bearer $SB_HOST_AGENT_TOKEN" \
  http://10.61.0.1:7000/health

curl -sS -X POST \
  -H "Authorization: Bearer $SB_HOST_AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}' \
  http://10.61.0.1:7000/participants

curl -sS -X POST \
  -H "Authorization: Bearer $SB_HOST_AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"room":"room1"}' \
  http://10.61.0.1:7000/participants/p01/reveal

curl -sS -X DELETE \
  -H "Authorization: Bearer $SB_HOST_AGENT_TOKEN" \
  http://10.61.0.1:7000/participants/p01
```

## Development

```sh
bun install
bun run typecheck
bun test
bun run dev
```

`SB_HOST_AGENT_TOKEN` and `SB_ADMIN_TOKEN` are required. The remaining values use the defaults in `src/config.ts`; `STATE_PATH`, `CONTENT_DIR`, and `SB_HOST_LAN_HINT` are useful local overrides.

Production installation and the `sb-host-agent.service` systemd unit are created by the repository host scripts. The unit reads the Speedbuild environment file and runs this package from `/opt/speedbuild/host-agent`.

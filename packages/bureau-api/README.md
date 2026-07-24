# bureau-api

`bureau-api` is the Bun, Hono, and SQLite backend for Speed Build 2026. It serves room APIs,
verifies Solana activity, settles x402 payments, persists room state, and exposes authenticated
administration and event-stream endpoints.

## Services and ports

| Port | Service | Endpoints |
|---:|---|---|
| 8700 | Public room API | `GET /brief/:room`, Room 2 `/component/:operative` and `/authorize/:operative`, Room 3 fragment/reconstruction routes, Room 4 `/code/present` |
| 8701 | x402 facilitator | `POST /verify`, `POST /settle`, `GET /supported` |
| 8702 | Room 3 trap facilitator | x402 settlement with trap-route accounting |
| 8703 | Room 5 API | `GET /node/start`, `GET /node/:id`, `GET /scoreboard` |
| 8710 | Admin API | operative registration, room reveals, manual overrides, state, SSE events, health |

The admin API requires a bearer token from `SB_ADMIN_TOKEN`.

## Configuration

Required:

- `SB_BUREAU_SECRET`
- `SB_ADMIN_TOKEN`

Optional paths:

- `BUREAU_DEPLOYER` defaults to `/var/lib/bureau/deployer.json`
- `CRED_MINT_PATH` or `CRED_MINT` defaults to `/var/lib/bureau/cred-mint.json`
- `DB_PATH` defaults to `/var/lib/bureau-api/state.sqlite`
- `BUREAU_IDL` defaults to `/opt/packages/bureau-registry/target/idl/bureau_registry.json`
- `OPERATIVES_PATH` defaults to `/var/lib/bureau/operatives.json`
- `DEPLOY_DIR` defaults to `/opt/zone/deploy`

RPC defaults are `http://127.0.0.1:8899` and `ws://127.0.0.1:8900`.

## Behavior

- Room 1 watches confirmed Solana transactions and verifies the exact operative signature,
  clearance account, amount, and memo before releasing an unlock.
- Room 2 verifies both x402 payment hops and persists completed hop state.
- Room 3 serves encrypted Shamir shares through self-settlement and trap-broker routes, then
  verifies four-share reconstruction attempts.
- Room 4 presents clearance codes through `bureau_registry`.
- Room 5 verifies paid route traversal, preserves responses for replay, and records scores.
- `GET /brief/:room?operative=<id>` returns reveal-gated public parameters.
- `GET /events` returns recent persisted events followed by live SSE updates.

## Development

```sh
bun install
bun run typecheck
bun test
SB_BUREAU_SECRET=x SB_ADMIN_TOKEN=y bun run src/index.ts
```

# executor-api

The Estate's Bun/TypeScript execution service. It watches Surfpool directly for Room 1 proof,
presents Room 4 deeds through `estate_registry`, stores operational state in SQLite, and streams
consequential events to the admin dashboard. Claimant self-reports are never treated as proof.

## Ports

| Port | Surface | Current scope |
|---:|---|---|
| 8700 | Public | Room routes (including Room 2 `/component/:claim` and `/authorize/:claim`), bonus `/tasks`, and reveal-gated `/clause/:room` parameters |
| 8701 | Honest facilitator | Real x402 v2 SVM `/verify`, `/settle`, `/supported` |
| 8702 | FAC-A trap facilitator | Real settlement plus Room 3 poison accounting on `/settle` |
| 8703 | Room 5 ledger | Paid `/node/start`, content-addressed `/node/:id`, and `/scoreboard` |
| 8710 | Admin | Bearer-authenticated registration, reveals, mercy, state, SSE, health |

Required environment variables are `SB_ESTATE_SECRET` and `SB_ADMIN_TOKEN`. RPC and websocket
defaults point at Surfpool on `127.0.0.1:8899` and `127.0.0.1:8900`.

## Room 5 — the Ledger Room

Room 5 maintains a seven-hop route for every team in the database. Node and decoy identifiers
are deterministic HMAC-derived content addresses, while traversal position, paid decoys,
idempotent responses, and the completed score are persisted in `room_state`. The default decoy
positions are 3 and 6; production may set a `room5` `config` value containing
`{"decoyPositions":[...]}` for a team (or `*`).

Every current node first returns an x402 v2 exact-SVM demand for 200 SCRIP. The Pay.sh client
submits its partially signed transaction in `X-PAYMENT`; the in-process facilitator verifies,
settles, and inspects it before the traversal advances. Replaying an already paid node returns
the persisted response without settlement. Future and otherwise out-of-order nodes do not
charge. `GET /scoreboard` is public and contains completed team runs.

## Bonus — the Stress Clause

`GET /tasks?claim=<claim>` lists six equal-weight duties and discovers the two transaction-based
duties from chain history. The remaining reports are filed at:

- `POST /tasks/decode-nonce` with `{claim, nonce}`
- `POST /tasks/slot-report` with `{claim, slot}`
- `POST /tasks/pda-derive` with `{claim, address}`
- `POST /tasks/balance-report` with `{claim, amount}`

Every report is checked against a fresh chain read; submitted values are never proof by
themselves. Progress is persisted after each first verified completion. All bonus routes remain
sealed until the `bonus` room has been revealed for that claimant.

## Public clause parameters

`GET /clause/:room?claim=<claim>` discloses the public RPC, websocket, SCRIP mint, and only the
room-specific parameters needed by that claimant. It returns 404 while the room is sealed. With
no claim it returns a generic, non-claimant subset only after the room has been revealed to at
least one claimant. Mint, program, and key material are loaded lazily; an estate that has not
been seeded returns the in-fiction 503 response instead of crashing process startup.

## Events

- `claimant.registered` — a claimant was recorded and the funding/seed script was attempted.
- `room.revealed` — a room clause was opened for a claimant.
- `room1.proven` — an exact claimant-signed tribute and memo were observed on-chain.
- `room1.rejected` — a claimant transfer reached the tribute ATA but did not satisfy the clause.
- `room2.rejected` — a gated, malformed, inexact, or unverifiable Room 2 submission was withheld; details remain admin-only.
- `room2.fee-kept` — Hop A settled without the required authorization memo, so the component remained sealed.
- `room2.hopA` — Hop A's exact fee and memo settled successfully.
- `room2.unsealed` — Hop B's computed amount reached the claimant's derived authorization vault.
- `room3.trap-settled` — FAC-A settled a real payment and marked the matched claimant's Room 3 route as poisoned.
- `room3.fragment-served` — a paid fragment was dispensed; poison and route diagnostics stay in admin data.
- `room3.share-submitted` — a CRC-valid fragment entered the reconstruction circle.
- `room3.pass` — four submitted fragments reconstructed the committed master key.
- `room3.fail` — a reconstruction missed the committed key and incurred the Actuary's assessment.
- `room3.exhausted` — the third failed reconstruction closed the round.
- `room4.presented` — the registry accepted a fresh bearer deed.
- `room5.decoy-paid` — a team paid a currently offered false ledger entry.
- `room5.route-complete` — a team completed its route and received a mercy-flash score.
- `bonus.task-complete` — one chain-verified Stress Clause duty was first satisfied.
- `bonus.progress` — persisted Stress Clause completion percentage changed.
- `combo.reveal` — a successful clause released its physical unlock/deed information.
- `mercy.granted` — production released a deterministic unlock through the priced override.

`GET /events` sends the latest 50 persisted events and then live SSE updates. Room 1 rejection
diagnostics live only in this bearer-protected admin surface; the public message gives no reason.

```sh
bun install
bun run typecheck
bun test
SB_ESTATE_SECRET=x SB_ADMIN_TOKEN=y bun run src/index.ts
```

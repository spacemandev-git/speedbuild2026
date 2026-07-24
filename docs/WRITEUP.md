# WRITEUP — Operator solutions for all five rooms

This spoiler document is the operator/reference solution for the challenge verifiers in
`packages/bureau-api/src/*` and the on-chain program in `packages/bureau-registry/`. It is not a
participant brief; see [PLAYERS_GUIDE.md](PLAYERS_GUIDE.md). Use it to run the event, diagnose a
failed attempt, or help a blocked operative.

Every required value is per-operative and served live by `/brief` or decoded from chain state.
There is no fixed answer key. These walkthroughs reproduce the exact computations expected by the
verifiers from an operative ID.

## Common ground

- **Network (CAIP-2):** `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`. Rooms 2, 3, and 5 and both
  facilitators use this exact x402 network ID; never use `localnet`.
- **RPC / WS:** `http://10.61.0.20:8899` / `ws://10.61.0.20:8900`.
- **Bureau API:** public `http://10.61.0.20:8700`; honest facilitator `:8701`; FAC-A trap
  facilitator `:8702`; ledger `:8703`; admin `:8710`.
- **SPL Memo program:** `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr`.
- **Registry program ID:** served as `programId` by `/brief/room1` and `/brief/room4`. A built
  value may be `B15pHuKQP2ay9Zx85JjpM1rSxy5e4Zd2J3MjLVkfsvSB`, but always read it live because
  `anchor keys sync` can regenerate the deployment keypair.
- **CRED mint / deployer:** served as `credMint`. Most fees land in the deployer's associated
  token account for the `CRED` mint.
- **Brief gate:** `GET /brief/:room?operative=X` returns `404` until the room is revealed to that
  operative. Every verifier rechecks reveal state.

The two most common failure modes are:

1. **Memo omitted.** Standard transfer and x402 recipes leave out the SPL Memo instruction. Every
   paying room that specifies a memo requires the transfer and memo in the same transaction.
2. **Status read instead of body.** HTTP `200` and a settled payment can still return
   `status:"SEALED"`. Parse the body.

## Room 1 — Operation (room1.ts) — decode plus memo-bound payment

**Goal:** change `VerificationRecord.status` from `0` (`UNVERIFIED`) to `1` (`VERIFIED`) by
sending the exact `CRED` clearance payment with the derived memo.

### 1. Pull parameters

```sh
curl "http://10.61.0.20:8700/brief/room1?operative=$OPERATIVE_ID"
```

The response includes `programId`, `rpcUrl`, and `credMint`.

### 2. Derive and decode the verification record

```text
recordPda = findProgramAddress(
  ["claim", utf8(lowercase(OPERATIVE_ID))],
  programId
)
```

Only the PDA seed lowercases the ID. Fetch the account and decode `VerificationRecord`:

| Offset | Field | Type |
|---|---|---|
| `0..8` | Anchor discriminator | ignore |
| `8..40` | `verifier` | pubkey |
| `40` | `status` | `u8` (`0`/`1`) |
| `41..49` | `clearance_nonce` | `u64`, little-endian |
| `49..81` | `clearance_ata` | pubkey |

### 3. Compute the payment

```text
amount (base units) = 1000 + (clearance_nonce mod 9000)
memo = sha256(
  utf8(OPERATIVE_ID) || clearance_nonce_as_8_bytes_LE
).hex[:16]
```

Verifier-matching gotchas:

- `amount` is an exact raw base-unit integer.
- The memo uses `OPERATIVE_ID` exactly as issued, not lowercased.
- The nonce uses eight raw little-endian bytes, not a hex string.
- Use the first 16 hex characters of the digest.

### 4. Send one transaction

Include:

- an SPL `transfer` or `transferChecked` of exactly `amount` `CRED` from the operative token
  account to `clearance_ata`, with the operative wallet as authority; and
- an SPL Memo instruction carrying the exact 16-character memo in the same transaction.

The operative wallet must sign.

`evaluateRoom1Transaction` requires the operative signature, correct destination and authority,
exact amount, and matching memo. `Room1Watcher` polls `clearance_ata`; on a match it calls
`mark_verified` and emits the Room 1 4-digit code. A near miss emits `room1.rejected` with the
expected and observed fields for operator diagnosis.

The difficult points are the unpublished layout, little-endian byte handling, raw bytes rather
than a printed hex string, and the memo omitted by standard SPL examples.

## Room 2 — Assembly (room2.ts) — hand-built x402 in two hops

**Goal:** complete two sequential x402 payments, including fields dropped by convenience clients.

### Hop A — component

```http
GET /component/$OPERATIVE_ID
```

The `402` `accepts[0]` entry includes:

- `scheme:"exact"`
- the fixed network ID
- `amount:"2500"`
- `asset:<CRED mint>`
- `payTo:<component owner>`
- `extra.feePayer:<deployer>`
- `extra.memoRequired:<nonceA>`

`nonceA` is:

```text
hmac(secret, operative, "room2:nonceA").hex[:16]
```

The server provides it as `memoRequired`; the operative does not need the secret.

Build the `X-PAYMENT` header manually:

- transfer exactly `2500` `CRED` to the component ATA;
- add an SPL Memo instruction equal to `nonceA` in the same transaction; and
- sign, serialize, and base64-encode the transaction in the x402 envelope.

`acceptedMatches` checks x402 version `2`, scheme, network, amount, asset, `payTo`, and
`extra.feePayer`.

The convenience-client trap is deliberate: `x402-fetch`/`x402-axios` can settle the transfer
without a memo. The service then emits `room2.fee-kept` and returns:

```json
{ "status": "SEALED", "carry": "<nonceB>" }
```

Hop A is not marked paid. Read the response body.

With the memo present, the service stores `hopA=PAID` and returns:

```json
{
  "status": "FEE ACCEPTED. AUTHORIZATION PENDING.",
  "nextBrief": "/authorize/$OPERATIVE_ID",
  "carry": "<nonceB>"
}
```

Carry `nonceB` into Hop B.

### Hop B — authorization

```http
GET /authorize/$OPERATIVE_ID
X-Carry: <nonceB>
```

The request fails with `403` unless Hop A is `PAID` and `X-Carry` matches. Its `402` advertises
`amount:"0"` and:

```text
extra.amountFormula = "4000 + (nonce_B mod 6000)"
```

Compute:

```text
amount = 4000 + (
  BigInt("0x" + nonceB) mod 6000
)
```

`nonceB` is 16 hex characters. Build another x402 v2 payment with the computed amount in
`accepted.amount`, the advertised per-operative vault owner as `payTo`, and the deployer as
`feePayer`. Settlement must reach that vault owner's ATA for the exact amount.

Success returns:

```json
{
  "status": "UNSEALED",
  "lockboxCombo": "<4 digits>",
  "component": "COMPONENT-N"
}
```

The main gotchas are that the advertised Hop B amount is deliberately `0`, the real price is a
formula over a carried nonce, and the first payment requires a memo that SDK paths omit.

## Room 3 — Trust (room3.ts) — Shamir reconstruction and facilitator choice

**Goal:** six operatives recover shares for a Shamir `k=4`, `n=6` reconstruction. FAC-A and two
configured poison records return CRC-valid values that do not lie on the target polynomial.

### 1. Request a fragment by self-settling

```http
GET /fragment/$OPERATIVE_ID
```

The `402` includes two accepted routes:

- FAC-A at `http://10.61.0.20:8702`, marked `integrity unverified`.
- A self-settlement route with no facilitator. Submit the settled transaction signature in
  `X-SETTLEMENT-SIGNATURE`.

FAC-A settles the payment but causes the API to serve `poison_share`. Self-settlement serves
`true_share` unless the operative ID is one of the two preconfigured poison records. Both wire
shares have valid local CRCs, so local checksum alone cannot distinguish them.

`evaluateSelfSettlement` accepts a succeeded transaction that:

- is signed by the operative wallet;
- contains exactly one transfer to the vault ATA, the deployer's `CRED` ATA;
- transfers exactly `1500` base units; and
- contains no other transfer to that vault.

Submit `tx.signature` in `X-SETTLEMENT-SIGNATURE`. Reusing a signature for another operative
returns `409`.

### 2. Decrypt the share

Response body:

```json
{ "encShare": "<hex>", "salt": "<hex>", "shareIndex": "<1..6>" }
```

Response header:

```text
X-PAYMENT-RESPONSE: base64({ "keyMaterial": "<hex>" })
```

The wire share is 33 bytes: 32 data bytes and one CRC8 byte. `xorWithKeystream` uses SHA-256
counter mode:

```text
block0 = sha256(keyMaterial || salt)
block1 = sha256(keyMaterial || salt || uint32be(1))
wire   = encShare XOR (block0 || block1)
```

The often-attempted one-block XOR recovers only bytes `0..31`; `block1` supplies byte `32`.
Validate the trailing byte with CRC-8 polynomial `0x07`:

```text
crc8(data) === wire[32]
```

### 3. Submit and reconstruct

```http
POST /reconstruct/submit
{"operative":"OPERATIVE-01","shareIndex":1,"share":"<33-byte wire hex>"}

POST /reconstruct/attempt
{"operatives":["OPERATIVE-01","OPERATIVE-02","OPERATIVE-03","OPERATIVE-04"]}
```

An attempt must select four distinct submitted operatives. The server performs Lagrange
interpolation over GF(256) and passes only when:

```text
sha256(recovered_master) === target_hash
```

A poison share is CRC-valid but reconstructs the wrong master. Exactly two of the six configured
records are poison, leaving one valid four-operative set among `C(6,4)=15`. The server enforces
three attempts; each failed attempt applies the configured `$250` penalty. On success, every
operative receives an individual 12-character Room 3 fragment.

The critical details are the FAC-A integrity flag, self-settlement, the second counter-mode block,
and the fact that a poison share passes every local check.

## Room 4 — Minesweeper (room4.ts) — mint and present a clearance code

**Goal:** mint a witnessed, memo-bound `ClearanceRecord`, read its fresh code from chain state,
and present it before the slot window expires. This challenge is per-operative.

### 1. Pull parameters and decode `OperativeHoldings`

```sh
curl "http://10.61.0.20:8700/brief/room4?operative=$OPERATIVE_ID"
```

The response contains `programId`, `operativeId`, `attemptSalt`, and `farTerminalUrl`.

Derive:

```text
holdingsPda = findProgramAddress(
  ["holdings", utf8(operative_id)],
  programId
)
```

Use the operative ID exactly as issued. Decode `OperativeHoldings`:

| Offset | Field | Type |
|---|---|---|
| `0..8` | Anchor discriminator | ignore |
| `8..40` | `registrar_key` | pubkey |
| `40` | `codes_minted` | `u8` |

### 2. Call `mint_code`

Compute:

```text
memo_hash = sha256(
  utf8(operative_id) || utf8(attempt_salt)
)
```

`mint_code` in `mint_code.rs` enforces:

- **Registrar account:** `remaining_accounts[0].key == holdings.registrar_key`. The account is
  not a signer; decode and pass it as the first remaining account.
- **Memo:** the same transaction contains an SPL Memo whose data is the 64-character lowercase
  hex encoding of `memo_hash`.
- **Instructions sysvar:** include
  `Sysvar1nstructions1111111111111111111111111`.
- **Accounts:** payer signer, holdings PDA, clearance-record PDA using the unchanged `"deed"`
  seed, instructions sysvar, system program, then `registrar_key`.
- **One-shot state:** an already-presented record cannot be reminted.

The program stores:

```text
clearance_code =
  bs58(sha256(operative_id || memo_hash || issued_slot_le))[..8]
```

`issued_slot_le` is the slot as a little-endian `u64`.

### 3. Decode and present

Decode `ClearanceRecord` in field order:

```text
operative: String (≤16)
clearance_code: [u8; 8]
issued_slot: u64
presented: bool
```

Submit:

```sh
curl -X POST http://10.61.0.20:8700/code/present \
  -H 'Content-Type: application/json' \
  -d '{"operative":"OPERATIVE-07","code":"7Gk9QpZ2"}'
```

The authority calls `present_code`, re-reads chain state, and checks:

- submitted code equals `clearance_code`;
- the operative ID matches;
- `current_slot - issued_slot <= code_window_slots`; and
- `presented == false`.

Success sets `presented=true` and returns `CROSSING CONFIRMED`. Mint and present without delay.
The code is an on-chain reference: it cannot be forged and cannot be presented twice.

The main gotchas are the first remaining account, memo scanning through the Instructions sysvar,
reading the code after minting rather than expecting it in an instruction return, little-endian
slot input to the code derivation, and the freshness window.

## Room 5 — Memory Path (room5.ts) — traverse seven paid nodes

**Goal:** follow a per-operative seven-hop, content-addressed route and avoid the two purchasable
decoys.

### Setup

```sh
curl "http://10.61.0.20:8700/brief/room5?operative=$OPERATIVE_ID"
pay setup
pay whoami
pay --local curl \
  "http://10.61.0.20:8703/node/start?operative=$OPERATIVE_ID"
```

`pay setup` creates an ephemeral, pre-funded sandbox wallet, so no funding step can block the
operative.

Each node is x402-gated for `200` `CRED` to the deployer ATA with deployer `feePayer`.
`pay --local` performs the 402→pay→retry cycle. The `?operative=` query is required on every
request. Route state and scoreboard rows are per-operative.

### Traversal

A hop response is:

```json
{
  "hop": 1,
  "next": "n_8f3a",
  "hint": "...",
  "decoy_of_next": "d_0c1d"
}
```

- Node IDs are HMAC-derived as `n_<4hex>`. `/node/1` does not exist; request the exact `next` ID.
- The server enforces order. A request for anything except the current position returns `409`.
- Decoys are at positions `{3,6}`.
- Near a decoy, the response includes `decoy_of_next` and a hint directing the operative to the
  real `n_` node.
- Paying a `d_` node returns `{"corrupted":true}`, increments `decoysPaid`, breaks the clean
  streak, and does not advance. The route remains recoverable by paying the real `n_` node.

The intended loop is:

```text
id = "start"
loop 7 times:
  resp = pay --local curl \
    "http://10.61.0.20:8703/node/<id>?operative=<operative>"
  if resp has flash_seconds: done
  id = resp.next
```

Never assign `resp.decoy_of_next` to `id`.

### Score

The seventh node returns:

```json
{ "hops_correct": "<0..7>", "flash_seconds": "<3..10>", "token": "<signed>" }
```

The verifier computes:

```text
hops_correct = 7 - decoysPaid - skipped
flash_seconds = clamp(3 + hops_correct, 3, 10)
```

A clean route is `7/7` and returns 10 seconds. The signed result is filed to the scoreboard:

```text
OPERATIVE-04 — ROUTE 6/7 — 9s
```

The route is unguessable and content-addressed; only the returned hint distinguishes the real next
node from its valid, payable decoy.

## Operator notes

- **Manual override:** use the bearer-authenticated admin endpoints:
  `POST /override {operativeId, room}` to return the correct result for any well-formed operative
  ID; `POST /force-complete {operativeId, room}` to record per-operative completion and return the
  result; and `POST /rooms/:room/complete` to complete a room globally. `GET /locks` is always
  available. See [ADMIN_GUIDE.md](ADMIN_GUIDE.md).
- **Locks (Rooms 1 and 2):** `lockAssignments` creates four Room 1 groups of four and four Room 2
  groups of three. For room `R`, lock `k`, live member index is
  `hmac(secret, "lock:<R>:<k>", "live").readUIntBE(0, 4) % groupSize`; the live code is
  `fourDigit(liveOperativeId, room, secret)`. `GET /locks` reproduces the complete night-before
  lock sheet at any time.
- **Pool derivation:** deterministic codes are generated with `SB_BUREAU_SECRET` across the full
  `SB_OPERATIVE_POOL`, `OPERATIVE-01` through `OPERATIVE-NN`, whether or not an ID is registered.
  Check-in assigns IDs; unused IDs remain available to reserves.
- **Diagnostics:** events such as `room1.rejected`, `room2.fee-kept`,
  `room3.trap-settled`, `room4.presented`, and route decoy diagnostics include exact mismatches
  such as expected versus observed amount, memo, or destination. Use the admin event feed to
  diagnose without exposing the solution.
- **Reproduction:** expected values can be reproduced with `combos.ts`,
  `room1.ts::deriveRoom1Requirements`, `room2.ts::room2Nonces/room2HopBAmount`, and
  `room5.ts::deriveRoom5Route`, using the operative ID and `SB_BUREAU_SECRET`.

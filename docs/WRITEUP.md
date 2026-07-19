# WRITEUP — How to solve each clause

*Spoiler document. This is the operator/reference solution for every room of The Estate,
written against the actual verifier code in `packages/executor-api/src/*` and the on-chain
program in `packages/estate-registry/`. It is not the claimant-facing brief — see
`docs/PLAYERS_GUIDE.md` for that. Read this to run the show, unblock a stuck team, or grade a
submission.*

Every value a claimant needs is **per-claimant** and **served live** from the clause endpoint
or decoded from the chain. Nothing here is a fixed answer key; the walkthroughs show the exact
computation the verifier expects, so you can reproduce any claimant's expected result from their
claim number.

---

## Common ground (every room)

- **Network (CAIP-2):** `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` — the single x402 network id used
  by rooms 2, 3, 5 and the facilitator. Never `localnet`.
- **RPC / WS:** `http://10.61.0.20:8899` / `ws://10.61.0.20:8900`.
- **Executor API (public):** `http://10.61.0.20:8700`. Ledger room: `:8703`. Facilitators:
  honest `:8701`, trap (FAC-A) `:8702`.
- **SPL Memo program:** `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr`.
- **Registry program id:** served as `programId` from `/clause/room1` and `/clause/room4`
  (built `B15pHuKQP2ay9Zx85JjpM1rSxy5e4Zd2J3MjLVkfsvSB`, but always read it live — the box
  regenerates the keypair via `anchor keys sync`).
- **SCRIP mint / deployer:** served as `scripMint`; the "estate's own ATA" that most fees land in
  is the deployer's associated token account for the SCRIP mint.
- **Clause gate:** `/clause/:room?claim=X` returns `404` until that room is *revealed* to that
  claimant. Every room verifier also re-checks the reveal.

Two failure modes that sink most attempts, across all rooms:

1. **Memo omitted.** The "standard" transfer/x402 recipe leaves out the SPL Memo instruction.
   Every paying room requires the transfer **and** its memo in the *same transaction*.
2. **Reading the status, not the body.** A `200` / settled payment can still say `SEALED` and the
   estate keeps the fee. Parse the response body.

---

## Clause I — The Reading Room (`room1.ts`) — decode + memo'd tribute

**Goal:** flip your `ClaimRecord.status` from `0` (UNPROVEN) to `1` (PROVEN) by sending an exact,
memorialized SCRIP tribute.

### 1. Pull params
```sh
curl "http://10.61.0.20:8700/clause/room1?claim=$CLAIM_NUMBER"   # -> programId, rpcUrl, scripMint
```

### 2. Derive the record PDA and decode it
```
recordPda = findProgramAddress(["claim", utf8(lowercase(CLAIM_NUMBER))], programId)
```
Note the **lowercase** — the on-chain seed is `claim_number.to_lowercase()` (`init_claim.rs`).
Fetch the account and decode by byte offset (`state.rs::ClaimRecord`):

| offset | field | type |
|---|---|---|
| 0..8 | anchor discriminator | ignore |
| 8..40 | `executor` | pubkey |
| 40 | `status` | u8 (0/1) |
| 41..49 | `probate_nonce` | **u64 little-endian** |
| 49..81 | `tribute_ata` | pubkey (where the tribute must land) |

### 3. Compute the tribute
```
amount (base units) = 1000 + (probate_nonce mod 9000)
memo = sha256( utf8(CLAIM_NUMBER) || probate_nonce_as_8_bytes_LE ).hex[:16]
```
Gotchas that match the verifier (`deriveRoom1Requirements`):
- `amount` is a raw base-unit integer, compared exactly (`amountMatches`).
- The memo hash consumes your **CLAIM_NUMBER exactly as issued** (not lowercased — only the PDA
  seed is lowercased) followed by the nonce as 8 **little-endian** bytes, then the **first 16 hex
  characters** of the digest.

### 4. Send one transaction: SCRIP transfer + memo
- SPL `transfer`/`transferChecked` of exactly `amount` SCRIP from **your** token account to
  `tribute_ata`, authority = your wallet.
- An SPL **Memo** instruction carrying the 16-char memo, **in the same transaction**.
- Your wallet must **sign** (`claimantSigned`).

`evaluateRoom1Transaction` requires all of: claimant signed, a transfer to `tribute_ata` with
your authority, `amount` exact, and the memo string present among the transaction's memo
instructions. The `Room1Watcher` polls the `tribute_ata` signatures; on a match it calls
`mark_proven` and emits the room-1 four-digit combo. A near-miss (right destination, wrong
amount/memo) emits a `room1.rejected` diagnostic on the executor feed — use it to debug a team.

**Why AI-resistant:** the layout is unlabeled (no IDL), endianness and "hash the bytes not the
hex string" are silent, and the standard SPL transfer snippet omits the memo.

---

## Clause II — The Vault Wing (`room2.ts`) — hand-built x402, two hops

**Goal:** two sequential x402 payments, each carrying data the convenience clients drop.

### Hop A — `GET /component/$CLAIM_NUMBER`
Returns `402` with `accepts[0]`:
- `scheme:"exact"`, `network`, `amount:"2500"`, `asset:` SCRIP mint, `payTo:` deployer (component
  owner), `extra.feePayer:` deployer, **`extra.memoRequired:` = `nonceA`**.

`nonceA` is `hmac(secret, claim, "room2:nonceA").hex[:16]` — you can't compute it, but it is
handed to you as `memoRequired`. Build the `X-PAYMENT` header **yourself**:
- Transfer `2500` SCRIP to the component ATA, **plus** an SPL Memo instruction whose data equals
  `nonceA`, same transaction, signed.
- The `X-PAYMENT` envelope's `accepted` block must match the requirement (`acceptedMatches`
  checks x402Version 2, scheme, network, amount, asset, payTo, `extra.feePayer`).

The trap (`x402-fetch`/`x402-axios`): they settle the transfer but attach **no memo**. The server
settles, sees `settlement.memo !== nonceA`, emits `room2.fee-kept`, and returns
`{status:"SEALED", ... , carry: nonceB}` — **fee kept, hop A NOT marked paid**. Read the body.

On success it stores `hopA=PAID` and returns:
```json
{ "status": "FEE ACCEPTED. AUTHORIZATION PENDING.", "nextClause": "/authorize/$CLAIM", "carry": "<nonceB>" }
```
**Carry `nonceB`.** You need it for the header *and* the hop-B amount.

### Hop B — `GET /authorize/$CLAIM_NUMBER` with header `X-Carry: <nonceB>`
Guards: `X-Carry` must equal `nonceB`, and `hopA` must be `PAID` (else 403).
The `402` here **advertises `amount:"0"`** with `extra.amountFormula:"4000 + (nonce_B mod 6000)"`.
This is deliberate: a naive client would pay `0` and fail. You must compute:
```
amount = 4000 + ( BigInt("0x" + nonceB) mod 6000 )      // nonceB is 16 hex chars
```
Then hand-build `X-PAYMENT` with `accepted.amount` = that computed value, `payTo` = the
advertised per-claimant vault **owner** (`room2VaultOwner`), `feePayer` = deployer. The transfer
must land in that vault's ATA (`settlement.destination === vault.ata`) for the computed amount.

Success → `{ "status":"UNSEALED", "lockboxCombo":"<4 digits>", "component":"COMPONENT-N" }` and the
room-2 combo is emitted.

**Why AI-resistant:** the price is a *formula over a carried nonce*, not a number; the advertised
amount is a lie (`0`); and both hops need a memo/carry the SDK path never sends.

---

## Clause III — The Séance Room (`room3.ts`) — Shamir + a trust decision

**Goal:** each of six claimants recovers a *true* 4-of-6 Shamir share; the team votes which four
to combine. Two players were bribed and hold poison shares that pass the checksum.

### 1. Get your fragment — **self-settle, do not use the broker**
`GET /fragment/$CLAIM` returns `402` with two `accepts`:
- `[0]` broker **FAC-A** (`facilitator: http://10.61.0.20:8702`, note *"integrity unverified"*).
- `[1]` self-settle: settle the transfer yourself, present the signature in header
  `X-SETTLEMENT-SIGNATURE`.

Paying through FAC-A (or being one of the two `bought`) yields the **poison** share:
`poisoned = bought || via === "trap"` → server serves `poison_share` (random bytes with a *valid*
CRC). Self-settling yields your `true_share`. There is no cryptographic way to tell which broker
is honest — the flag is the whole tell. **Self-settle.**

Self-settlement the verifier accepts (`evaluateSelfSettlement`): a **succeeded** transaction,
signed by you, with **exactly one** transfer to the vault ATA (deployer's SCRIP ATA),
`amount == 1500`, no other transfers to the vault. Submit `tx.signature` in
`X-SETTLEMENT-SIGNATURE`. (A signature already redeemed by another claim is rejected 409.)

### 2. Decrypt the share
Response body: `{ encShare (hex), salt (hex), shareIndex }`. Header `X-PAYMENT-RESPONSE` is
base64 JSON `{ "keyMaterial": "<hex>" }`. The wire share is **33 bytes** = 32 data + 1 CRC8. The
keystream is SHA-256 in counter mode (`xorWithKeystream`):
```
block0 = sha256( keyMaterial || salt )                       // covers wire bytes 0..31
block1 = sha256( keyMaterial || salt || uint32be(1) )        // covers wire byte 32
wire   = encShare XOR (block0 || block1)
```
The brief's one-liner `share = encShare XOR sha256(keyMaterial||salt)` only recovers the first 32
bytes; you need the counter=1 block for the trailing CRC byte. Verify with CRC-8 (poly `0x07`,
`crc8(data) === wire[32]`).

### 3. Submit and vote
```
POST /reconstruct/submit  { claimNumber, shareIndex, share: <33-byte wire hex> }
POST /reconstruct/attempt { claimNumbers: [<4 distinct participants>] }
```
`attempt` GF(256)-combines the four submitted shares (threshold 4) and passes iff
`sha256(recovered) === target_hash`. A poison share is CRC-valid but wrong data → wrong master →
hash mismatch. Only **3 attempts**; each failure costs the pot $250. Since exactly two of the six
are poisoned, the winning vote is *the four honest self-settlers* — the bribed players know who
they are, so honest coordination (not brute force over the 15 subsets) is the intended path. On
PASS every participant gets their 8-char room-3 fragment.

**Why AI-resistant:** the poison passes every local check; the correct move is a *social* trust
call the model cannot make, and the decrypt needs the counter-mode second block the "obvious"
XOR misses.

---

## Clause IV — The Burned Wing (`room4.ts` + `mint_deed.rs`/`present_deed.rs`) — bearer deed

**Goal:** mint a witnessed, memorialized team deed on-chain, then present its fresh code at the
far terminal before it goes stale. Team-scoped.

### 1. Params + read team holdings
```sh
curl "http://10.61.0.20:8700/clause/room4?claim=$CLAIM_NUMBER"   # -> programId, teamName, attemptSalt, farTerminalUrl
```
```
holdingsPda = findProgramAddress(["team", utf8(team_name)], programId)
```
Decode (`state.rs::TeamHoldings`): `8..40 registrar_key`, `40 deeds_minted`. You need the
`registrar_key` — the minting must be witnessed by it.

### 2. Call `mint_deed(team_name, memo_hash)`
```
memo_hash = sha256( utf8(team_name) || utf8(attempt_salt) )     // 32 bytes; attempt_salt from clause endpoint
```
The instruction (`mint_deed.rs`) enforces, in the **same transaction**:
- **Registrar witness:** pass the `registrar_key` as the **first `remaining_account`**; the program
  requires `registrar.key() == holdings.registrar_key` (`RegistrarMissing` otherwise).
- **Memorialization:** an SPL **Memo** instruction whose data is the **lowercase hex** (64 ASCII
  chars) of `memo_hash`; the program scans the Instructions sysvar for it (`MemoMissing`
  otherwise). Include the Instructions sysvar account (`Sysvar1nstructions1111111111111111111111111`).
- Accounts: `payer` (signer), `holdings` PDA, `deed` PDA (`["deed", team]`), instructions sysvar,
  system program, then `registrar_key` as remaining account.

The program computes and stores
`deed_code = bs58( sha256(team || memo_hash || issued_slot_le) )[..8]` (8 ASCII base58 chars) and
records `issued_slot`.

### 3. Read the deed code and present it — quickly
Decode `deed` PDA (`Deed`: `team` String, then `deed_code[8]`, `issued_slot u64`, `presented`
bool) to read the 8-char code. Then:
```sh
curl -X POST http://10.61.0.20:8700/deed/present -d '{"team":"<team>","code":"<8 chars>"}'
```
The far terminal is the config **authority**; `present_deed` re-derives everything from chain and
checks: `code == deed_code` (`CodeMismatch`), **freshness** `slot - issued_slot <= deed_window_slots`
(`DeedStale`), and not already presented (`DeedAlreadyPresented`, "one crossing"). Because of the
freshness window, mint and cross **without dawdling** — a slow crossing writes the deed off. The
code is not a secret (it can't be forged and can't be presented twice); it's a reference.

**Why AI-resistant:** the mint fails silently without the registrar remaining-account and the
memo-in-sysvar; the code is chain-derived (not returnable by the mint call); and the freshness
window turns latency into failure.

---

## Clause V — The Ledger Room (`room5.ts`) — traverse 7 paid, content-addressed nodes

**Goal:** walk a 7-hop route where each node id is only learned from the previous node's response,
avoiding two decoys. Team-scoped, uses the `pay` CLI on the estate's local rails.

### Setup
```sh
curl "http://10.61.0.20:8700/clause/room5?claim=$CLAIM_NUMBER"   # -> teamName, startUrl
pay setup                     # ephemeral wallet, pre-funded by the estate
pay --local curl "http://10.61.0.20:8703/node/start?team=<team>"
```
Every node is x402-gated: `200` SCRIP to the deployer ATA, `feePayer` = deployer. `pay --local`
runs the whole 402 → pay → retry cycle. The `?team=` query is required on every request.

### The traversal
A hop response is:
```json
{ "hop": N, "next": "n_xxxx", "hint": "...", "decoy_of_next": "d_yyyy" }   // decoy_of_next only near a decoy
```
- Node ids are HMAC-derived (`n_<4hex>`); **`/node/1` does not exist** — you must read `next` and
  request exactly that id. The server enforces order: requesting anything but the current position
  returns `409`.
- Decoys sit at positions **{3, 6}** by default. When the next position carries a decoy, the
  response includes `decoy_of_next` (the `d_...` id) and a hint telling you to take the `n_` entry
  and leave the `d_` imitation unpaid. **Always follow `next` (the `n_`), never `decoy_of_next`.**
- Paying a decoy returns `{"corrupted": true}`, increments `decoysPaid`, breaks your clean streak,
  and does **not** advance position (you can still recover by paying the real `n_` node) — but your
  score is docked.

Automate it — the intended solution is a small loop:
```
id = "start"
loop 7 times:
  resp = pay --local curl "http://10.61.0.20:8703/node/<id>?team=<team>"
  if resp has flash_seconds: done (final node)
  id = resp.next            # NEVER resp.decoy_of_next
```

### Score
The 7th node returns `{ hops_correct, flash_seconds, token }` with
`hops_correct = 7 - decoysPaid - skipped` and `flash_seconds = clamp(3 + hops_correct, 3..10)`. A
clean run = 7/7 → 10-second look at the vault. The `token` is filed to the scoreboard.

**Why AI-resistant:** the route is content-addressed (no guessable ids), and each decoy is a
*plausible, purchasable* sibling — only the natural-language hint disambiguates it.

---

## The Stress Clause / Bonus (`bonus.ts`) — six small self-verifying duties

**Goal:** the accessible round. Six independent tasks, each worth 1/6, partial credit banks.
`GET /tasks?claim=$CLAIM` lists them and **auto-verifies** the two chain-scan tasks on each poll.

| Task | How to satisfy | Verifier |
|---|---|---|
| `transfer-tribute-echo` | Send **exactly 42** SCRIP base units to the **deployer ATA**, memo = your `CLAIM_NUMBER`, same tx. | Auto-detected on `GET /tasks` (reuses room-1 evaluator with amount 42, memo = claim). |
| `memo-ping` | Any claimant-**signed** tx carrying memo `stress:<CLAIM_NUMBER>`. | Auto-detected on `GET /tasks`. |
| `decode-nonce` | `POST /tasks/decode-nonce {claim, nonce}` — `nonce` = `probate_nonce` as a decimal string. | Compared to the on-chain `ClaimRecord`. |
| `slot-report` | `POST /tasks/slot-report {claim, slot}` — current slot **within 30**. | `|reported - current| <= 30`. |
| `pda-derive` | `POST /tasks/pda-derive {claim, address}` — your `ClaimRecord` PDA (base58). | Compared to `["claim", lowercase(claim)]` PDA. |
| `balance-report` | `POST /tasks/balance-report {claim, amount}` — exact SCRIP balance, base units, as a string. | Summed from parsed token accounts. |

Every duty reuses rails walked in rooms 1–5. Bank what you can; completion is one of two score
axes (the other is your on-camera pulse, which the estate scores theatrically, not via the API).

---

## Operator notes

- **Unblocking (Executor's Mercy):** the admin/ops console can release a claimant's correct combo
  or deed directly — see `docs/ADMIN_GUIDE.md`. Combos are deterministic:
  `fourDigit(claim, room, secret)` (rooms 1/2), `fragment(claim, "room3", 8, secret)` (room 3),
  the on-chain `deed_code` (room 4), the room-5 `token`. All derive from `SB_ESTATE_SECRET`.
- **Diagnostics:** every room emits `*.rejected` / `fee-kept` / `decoy-paid` events on the
  executor feed with the exact mismatch (expected vs. observed amount, memo, destination). That is
  the fastest way to tell a team *why* a submission bounced without explaining the puzzle.
- **Reproduce any expected value** offline with the pure functions in `combos.ts`,
  `room1.ts::deriveRoom1Requirements`, `room2.ts::room2Nonces/room2HopBAmount`, and
  `room5.ts::deriveRoom5Route`, given the claim/team and `SB_ESTATE_SECRET`.

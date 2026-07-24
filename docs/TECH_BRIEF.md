CLASSIFICATION: TECHNICAL TEAM ONLY
REF: BUREAU/SB2026/TECH-BRIEF-V2

# SPEED BUILD 2026 — THE BUREAU

This document covers the software that runs the five coding challenges, generates unlock codes,
verifies completion, and supports the marshal dashboard. Physical staging, game rules,
eliminations, and props are specified separately in the format bible, ref
`BUREAU/SB2026/FORMAT-BIBLE`.

## Shared Infrastructure

### Scope and protocols

The five challenges use three protocols: Solana ×2, x402 ×2, and Pay.sh ×1.

| Room | Display name | Protocol | Technical output |
|---|---|---|---|
| 1 | Room 1 — Operation | Solana | Per-operative 4-digit code |
| 2 | Room 2 — Assembly | x402 | Per-operative 4-digit code |
| 3 | Room 3 — Trust | x402 | Per-operative 12-character fragment |
| 4 | Room 4 — Minesweeper | Solana | Per-operative 8-character clearance code |
| 5 | Room 5 — Memory Path | Pay.sh | Per-operative route score, flash duration, and signed token |

Each challenge targets 30–45 minutes for a developer who has not used the protocol before.
Internet access is permitted throughout.

The four AI-resistance levers remain:

1. **Unlabeled on-chain or on-wire data.** Participants decode custom account layouts and HTTP
   402 bodies from byte hints; no challenge schema is published.
2. **Non-standard protocol use.** Convenience SDK paths visibly fail where a hand-built memo,
   self-settlement, or traversal program is required.
3. **Cross-step state chaining.** A value read in one step is required to construct the next.
4. **Trust and decoy decisions.** Wrong but plausible routes produce valid-looking output that
   fails verification.

### Runtime services

Everything runs on Solana devnet with a custom `CRED` SPL mint, pre-funded participant wallets,
one hosted backend, and one web console. No challenge touches mainnet or real funds.
All x402 surfaces use network ID
`solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`.

- The Bureau console serves per-room briefs, live verification state, result reveals, the Room 3
  reconstruction console, the Room 5 scoreboard, the event log, and the marshal dashboard.
- `packages/bureau-api` runs as `bureau-api.service`. Its public listener is `:8700`; the honest
  x402 facilitator is `:8701`, the deliberately compromised FAC-A facilitator is `:8702`, Room 5
  ledger nodes are on `:8703`, and the bearer-authenticated admin API is on `:8710`.
- `packages/bureau-registry` contains the `bureau_registry` Anchor program for Rooms 1 and 4.
  Its challenge instructions are `init_operative`, `mark_verified`,
  `init_operative_holdings`, `mint_code`, `present_code`, and `set_code_window`.
- The watcher architecture verifies completion by reading chain state or settled payments, never
  by accepting an operative assertion.

Public routes are:

- `GET /brief/:room?operative=`; returns `404` until that room is revealed to that operative.
- Room 2: `GET /component/:operative` and `GET /authorize/:operative`.
- Room 3: `GET /fragment/:operative`, plus `/reconstruct/*`.
- Room 4: `POST /code/present` with `{"operative","code"}`.
- Room 5: `GET /node/:id?operative=` on `:8703`.

### Identity, pool, and pre-event generation

Each participant receives an operative ID such as `OPERATIVE-07`, a named devnet keypair,
pre-funded SOL for fees, and pre-funded `CRED`. Every verifier binds the operative ID to that
public key.

`SB_OPERATIVE_POOL` controls the pre-generated ID pool. Its default is 24 and its minimum is 16.
Codes are generated for `OPERATIVE-01` through `OPERATIVE-NN` across the full pool regardless of
which IDs have been provisioned. IDs are assigned at check-in rather than to named people in
advance; if someone drops out, the unused ID goes to a reserve.

### Deterministic values and lock assignments

The deterministic unlock scheme is unchanged:

```text
HMAC_SHA256(SB_BUREAU_SECRET, operative_id || room_id)
```

`fourDigit` reduces the digest modulo 10000 for a zero-padded 4-digit code. `fragment` uses
base58 truncation for the required fragment length. Production computes the complete pool the
night before.

Rooms 1 and 2 have four physical locks each:

- Room 1 lock `k` has the group
  `OPERATIVE-(4(k-1)+1)` through `OPERATIVE-4k`, four members per lock.
- Room 2 lock `k` has the group
  `OPERATIVE-(3(k-1)+1)` through `OPERATIVE-3k`, three members per lock.
- For room `R` and lock `k`, the live member index is
  `HMAC(secret, "lock:<R>:<k>" || "live").readUIntBE(0, 4) mod groupSize`.
- The live code is `fourDigit(liveOperativeId, room, secret)`.

Only the selected member's code opens each physical lock. Every operative still earns and sees
their own normal code after verification. `lockAssignments(secret, pool)` returns the grouping,
live operative, and live code for all eight locks and rejects a pool smaller than 16. Rooms 3–5
are unchanged.

### Verification, reveal, and manual override

Verification gates the reveal of a value, never its existence. Every code exists from the moment
it is generated the night before, whether or not anyone earns it. The system decides when it is
shown, not whether it is real. A marshal can therefore short-circuit any gate at any time without
breaking anything downstream.

Normal verification reveals an operative's own result only after a watcher confirms chain state
or settled payment. Manual override has two independent routes:

- **Route 1 — system side.** The marshal dashboard lists every lock, assigned group, live
  operative, and live code; codes are revealable on request at any time. It can issue any
  well-formed operative ID a valid result in any room and can mark one operative or a whole room
  complete regardless of challenge state.
- **Route 2 — physical side.** Every lock must have a master key, known reset code, or documented
  bypass that requires no system or venue network. This is a props/purchasing item and must be
  tested and documented before the event day.

The `:8710` admin API uses bearer `SB_ADMIN_TOKEN`:

- `POST /operatives {operativeId, pubkey}`
- `POST /reveal {operativeId|"all", room}`
- `POST /override {operativeId, room}` returns the correct combo or fragment for any well-formed
  operative ID regardless of state and emits `override.granted`.
- `POST /force-complete {operativeId, room}` records completion, returns the unlock, and emits
  `override.completed`.
- `POST /rooms/:room/complete` marks a whole room complete and emits `room.completed`.
- `GET /locks` returns `{pool, locks:[{room, lock, members, liveOperative, liveCode}]}`.
- `GET /state`, `GET /events` (SSE), and `GET /health`.

### Pre-event kit and resilience

The pre-event kit is sent approximately one week before the event and contains:

- A one-page primer for the Solana account model and PDAs, the x402
  402→pay→retry cycle, and the Pay.sh CLI.
- A `bureau-terminal` TS starter repository with `@solana/web3.js`/`@solana/kit`, an
  x402 client, the Pay.sh CLI, a keypair environment slot, and one working example per protocol.
  Examples teach tools, not challenge solutions.
- The devnet RPC endpoint and a fallback RPC.

Rate-limit resilience uses the primary and fallback RPCs. The self-hosted facilitators and ledger
backend absorb payment load. Timed hints progressively expose layouts, formulas, and skeleton
code without exposing final answers. Manual override and the stated per-room lower-tier outcomes
provide graceful degradation.

## Room 1 — Operation

Physical game: see format bible, ref BUREAU/SB2026/FORMAT-BIBLE.

### Technical challenge

The operative receives the `bureau_registry` program ID and operative ID. They derive:

```text
recordPda = findProgramAddress(["claim", utf8(lowercase(operative_id))], programId)
```

They fetch and decode `VerificationRecord` without an IDL:

| Offset | Field | Type |
|---|---|---|
| `0..8` | Anchor discriminator | skip |
| `8..40` | `verifier` | `Pubkey` |
| `40` | `status` | `u8` (`0 = UNVERIFIED`, `1 = VERIFIED`) |
| `41..49` | `clearance_nonce` | `u64`, little-endian |
| `49..81` | `clearance_ata` | `Pubkey` |

They derive the exact payment:

```text
amount (base units) = 1000 + (clearance_nonce mod 9000)
memo = first 16 hex chars of sha256(
  utf8(operative_id) || clearance_nonce_LE_bytes
)
```

One transaction must contain both the exact `CRED` SPL-token transfer to `clearance_ata` and the
SPL Memo instruction. The operative ID is lowercased only for the PDA seed; the memo uses it
exactly as issued. The nonce is hashed as eight raw little-endian bytes, not as a hex string.

### Output

The operative's normal deterministic zero-padded 4-digit Room 1 code. It is always shown to that
operative after verification. Four codes exist for each four-member lock group, but only the
preselected live member's code opens that group's lock.

### Auto-verification

The watcher subscribes to `clearance_ata`, verifies the sending wallet, exact amount, and memo,
then calls `mark_verified`. The console displays `VERIFIED — UNLOCK RELEASED` and the operative's
code. A near miss emits `room1.rejected`.

### Fallback

At 15 minutes, reveal the byte-layout table. At 25 minutes, reveal a worked memo formula with a
dummy nonce. At 35 minutes, a marshal may use system-side manual override.

## Room 2 — Assembly

Physical game: see format bible, ref BUREAU/SB2026/FORMAT-BIBLE.

### Technical challenge

Hop A requests:

```http
GET https://bureau.example/component/<operative_id>
```

The `402 Payment Required` advertises an exact `2500`-base-unit `CRED` payment and
`extra.memoRequired = nonce_A`. A convenience x402 client settles without the required memo,
causing a `200` body with `status: "SEALED"`, a fee-kept result, `nextBrief`, and `carry:
nonce_B`. The operative must hand-build the `X-PAYMENT` envelope containing the Solana transfer
and required SPL Memo in the same transaction.

Hop B requests:

```http
GET https://bureau.example/authorize/<operative_id>
X-Carry: <nonce_B>
```

The amount must be computed from the carried nonce:

```text
amount = 4000 + (nonce_B mod 6000)
```

The exact payment goes to the advertised PDA-derived recipient. Both settlements must be on-chain.

### Output

`{"status":"UNSEALED","lockboxCombo":"<4-digit>","component":"COMPONENT-N"}` with the
operative's normal deterministic 4-digit Room 2 code. Three codes exist for each three-member
lock group, but only the preselected live member's code opens that group's lock.

### Auto-verification

The honest self-hosted facilitator settles each payment on devnet. The resource server re-reads
`postTokenBalances`, decodes the memo instruction, checks the carried nonce and exact derived
amount, and emits the combo only after both hops pass. A settled Hop A payment without the memo
emits `room2.fee-kept`.

### Fallback

At 15 minutes, point out that a `200` response body can still be `SEALED`. At 25 minutes, provide
a worked `X-PAYMENT` envelope with a memo and dummy values. At 35 minutes, a marshal may use
system-side manual override.

## Room 3 — Trust

Physical game: see format bible, ref BUREAU/SB2026/FORMAT-BIBLE.

### Technical challenge

Six operatives each request:

```http
GET https://vault.bureau.example/fragment/<operative_id>
```

The response advertises two x402 routes. FAC-A is deliberately compromised and marked
`integrity unverified`; it settles the payment but returns a fragment with a valid local CRC that
is off the reconstruction polynomial. Self-settlement requires the operative to build and submit
the transfer, then present the settled signature; it returns the correct share.

The encrypted response is:

```text
body: { "encShare": "<hex>", "salt": "<hex>", "shareIndex": <1..6> }
X-PAYMENT-RESPONSE: base64({ "keyMaterial": "<hex>" })
```

The wire share is 33 bytes: 32 data bytes plus one CRC8 byte. Decryption uses SHA-256
counter-mode XOR:

```text
block0 = sha256(keyMaterial || salt)
block1 = sha256(keyMaterial || salt || uint32be(1))
wire   = encShare XOR (block0 || block1)
```

CRC-8 uses polynomial `0x07`. The master value uses Shamir Secret Sharing over GF(256),
`k=4`, `n=6`. Exactly four true shares reconstruct the known target hash. Two configured
operatives have poison shares that retain a valid per-share CRC. The server allows three group
attempts.

### Output

On a passing four-share reconstruction, every operative receives an individual 12-character Room 3
fragment.

### Auto-verification

Per-operative verification checks a succeeded settlement, the sending wallet, exactly one
`1500`-base-unit transfer to the vault `CRED` ATA, signature reuse, and the decrypted share CRC.
Group verification uses Lagrange interpolation over GF(256) and compares the reconstructed
master hash to the target.

### Fallback

An operative who cannot produce a fragment receives the correct share through system-side
manual override so one laptop cannot block reconstruction. If all three group attempts fail, the
attempt sequence ends with the configured lower-tier result and penalty.

## Room 4 — Minesweeper

Physical game: see format bible, ref BUREAU/SB2026/FORMAT-BIBLE.

### Technical challenge

This challenge is per-operative. The operative derives the `OperativeHoldings` PDA:

```text
holdingsPda = findProgramAddress(["holdings", utf8(operative_id)], programId)
```

They decode `OperativeHoldings` without an IDL:

| Offset | Field | Type |
|---|---|---|
| `0..8` | Anchor discriminator | skip |
| `8..40` | `registrar_key` | `Pubkey` |
| `40` | `codes_minted` | `u8` |

They compute:

```text
memo_hash = sha256(utf8(operative_id) || utf8(attempt_salt))
```

They call `mint_code(operative_id, memo_hash)` on `bureau_registry`. The first remaining account
must equal `registrar_key`, and the same transaction must contain an SPL Memo whose data is the
64-character lowercase hex form of `memo_hash`. The program writes a `ClearanceRecord` PDA using
the unchanged seed literal `"deed"`:

```text
operative: String
clearance_code: [u8; 8]
issued_slot: u64
presented: bool
```

The code derivation is unchanged:

```text
clearance_code =
  bs58(sha256(operative_id || memo_hash || issued_slot_le))[..8]
```

The code is submitted to `POST /code/present` as `{"operative","code"}`. `present_code` checks
the stored code, operative, configured slot window, and `presented == false`, then makes the
record one-shot.

### Output

An 8-character base58 clearance code and, after successful presentation,
`CROSSING CONFIRMED`.

### Auto-verification

The verifier reads the `ClearanceRecord` PDA directly from devnet and calls `present_code`.
There is no shared private state outside the chain. Stale, wrong-operative, mismatched, and
already-presented values are rejected.

### Fallback

At 12 minutes, reveal the `OperativeHoldings` byte layout. At 20 minutes, a marshal may issue a
valid clearance code through system-side manual override. One-shot presentation still applies.

## Room 5 — Memory Path

Physical game: see format bible, ref BUREAU/SB2026/FORMAT-BIBLE.

### Technical challenge

This challenge is per-operative. The operative runs `pay setup`, then `pay whoami`, and begins:

```sh
pay curl "https://ledger.bureau.example/node/start?operative=<operative_id>"
```

Each x402-gated node returns the next content-addressed node only after payment:

```json
{ "hop": 1, "next": "n_8f3a", "hint": "...", "decoy_of_next": "d_0c1d" }
```

The operative must traverse seven nodes in order. Sequential paths such as `/node/1` do not
exist. Decoys occur at positions `{3,6}`. Paying a decoy returns `{"corrupted":true}`, increments
the decoy count, breaks the clean streak, and does not advance the route. The `hint` field
disambiguates the real `n_` node from the purchasable `d_` decoy. The intended solution is a
small `pay curl` loop that parses `next`, applies the hint, and follows the chain.

### Output

The final node returns:

```json
{ "hops_correct": "<0..7>", "flash_seconds": "<computed>", "token": "<signed>" }
```

The mapping is:

```text
flash_seconds = clamp(3 + hops_correct, 3, 10)
```

A clean `7/7` traversal returns 10 seconds. The result is posted to the per-operative scoreboard
in the form `OPERATIVE-04 — ROUTE 6/7 — 9s`.

### Auto-verification

Every node is settled through Pay.sh, keyed by operative ID. The server enforces the current
route position, records paid decoys, computes `hops_correct` and `flash_seconds`, signs the token,
and emits `room5.route-complete`. Results are derived from settled route state, never
self-reported.

### Fallback

At 15 minutes, provide a three-line `pay curl` plus `jq` traversal skeleton without decoy logic.
If the operative does not complete, the configured zero-completion outcome applies; a marshal
can also issue a valid result or force completion through system-side manual override.

## Open Items — Confirmation Required

1. **Room 3 headcount.** The reconstruction requires exactly six operatives. Confirm six will be
   in the room.
2. **Heart rate monitors.** Room 3 currently assumes live BPM on screen. The monitors have been
   cut from the props budget. Confirm whether the BPM element is dropped.
3. **Room 4 input device.** Must accept an 8-character alphanumeric code. Hardware not specified.
4. **Physical lock bypass.** Every lock needs a master key or reset code — see manual override,
   Route 2. This is a props purchasing decision and needs confirming before locks are bought.
5. **Venue network capacity.** Design assumes reliable internet for up to 16 simultaneous laptops
   hitting devnet RPC. Untested at the venue. Confirm whether a local RPC node is needed as
   fallback.

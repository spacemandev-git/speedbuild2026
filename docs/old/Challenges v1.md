CLASSIFICATION: TECHNICAL TEAM ONLY
REF: BUREAU/SB2026/CHALLENGE-DESIGN-V1
COMPANION TO: BUREAU/SB2026/TECH-BRIEF-V1

# SPEED BUILD 2026 — Technical Challenge Design
## Five challenges across Solana, x402, and Pay.sh

This document specifies the five room challenges, the shared infrastructure that runs them,
how each self-verifies, and how each produces the unlock the physical game needs.

### Protocol assignment

The brief assigns Room 3 (Encryption) to CoralOS. Per direction, this design uses **only
Solana, x402, and Pay.sh**, so Room 3 is reassigned to **x402** with a mechanic distinct
from Room 2. Final map:

| Room | Name | Protocol | What it unlocks |
|------|------|----------|-----------------|
| 1 | Operation | **Solana** (native) | Combination → locked tweezer briefcase |
| 2 | Assembly | **x402** | Combination → personal safe |
| 3 | Encryption | **x402** (facilitator-trust twist) | Per-contestant key fragment (2 pre-corrupted) |
| 4 | Gauntlet (Minesweeper) | **Solana** (native) | Carry-across crossing fragment |
| 5 | Intelligence (Memory Path) | **Pay.sh** | Flash duration in seconds |

Spread: Solana ×2, x402 ×2, Pay.sh ×1. Each room exercises a *different* primitive of its
protocol, so no two rooms feel like the same exercise.

---

## 1. Design philosophy — why these take 30–60 minutes *with* AI

Modern coding assistants are strong at "textbook" Solana and at running a documented library.
A challenge that is just "send a devnet transaction" or "call an x402 endpoint with the SDK"
is solved by an AI in three minutes. The difficulty here does **not** come from obscure syntax
or from busywork — it comes from four levers that resist a one-shot AI solve while staying
fair to a competent developer:

1. **Unlabeled on-chain / on-wire data.** Contestants must decode a custom account layout or a
   custom 402 body with *no IDL and no schema* — only a byte/field hint. An assistant will
   confidently guess the wrong offsets; the contestant has to reason about the actual bytes.

2. **Non-standard protocol use.** Each challenge requires the protocol to be driven in a way the
   off-the-shelf client library does **not** do by default (a memo instruction inside the x402
   payload; self-settling instead of trusting the facilitator; a Pay.sh traversal script). The
   "just call the SDK" path visibly fails, forcing the contestant to understand the wire format.

3. **Cross-step state chaining.** A value read in step *n* (a nonce, a pubkey, an amount) is
   required to construct step *n+1*. You cannot hardcode anything; you cannot parallelise the
   steps. Each hop must be executed and read before the next exists.

4. **A trust / decoy decision.** At least one room hides a wrong-but-plausible path (a
   compromised facilitator, a decoy routing node). Following it produces valid-looking output
   that fails verification. The contestant must read the hints and *decide*, which AI cannot do
   for them because both paths look correct in isolation.

Every room chains **2–4 sub-steps**, at least one of which uses lever 2 or 4. That is what
converts a 5-minute task into a 30–60-minute one even with an assistant open in the next window.

**We keep it fair** with: pre-funded wallets (zero faucet friction), a working "hello world"
example for each protocol shipped in advance, a per-room hint that unlocks on the mission page
after N minutes, and a marshal override (Section 8). The puzzle is the decode-and-chain, never
the setup.

---

## 2. Shared infrastructure — one unified environment

**Yes, one environment covers all five rooms.** Everything runs against **Solana devnet** with a
single custom SPL token, one hosted backend, and one web console. Nothing touches mainnet or real
funds, so it is safe to run live on the day while still being the *genuine* protocol.

### 2.1 Components

- **Bureau Ops Console** — a hosted web app (one deploy, Railway). Per-room mission briefing pages
  written in Bureau voice, a live verification panel per contestant, the reveal animation/sound,
  the Room 3 group reconstruction console, and the Room 5 operator scoreboard. This is the only
  URL contestants and operators need.
- **Bureau Verifier API** — the backend behind the console. Hosts the x402-gated endpoints
  (Rooms 2, 3), the Pay.sh route nodes (Room 5), the on-chain watchers/verifiers (Rooms 1, 4),
  the deterministic combo generator, and the marshal-override dashboard.
- **Two on-chain programs on devnet** (Anchor):
  - `implant_registry` — Rooms 1 and 4 (per-contestant/per-team PDAs, "restore link" and
    "mint fragment" instructions).
  - No program is needed for Rooms 2/3/5 — those are HTTP + settlement checks.
- **`CRED` SPL token** — a custom devnet mint ("Bureau Credits"). We control supply, so we mint
  and pre-fund every wallet. This removes the USDC-devnet faucet as a point of failure and lets us
  meter exact amounts. x402 and Pay.sh both accept arbitrary SPL mints, so `CRED` is used
  everywhere a payment is required.
- **Self-hosted x402 facilitator** (Rooms 2, 3) — a minimal settle/verify service so the flow is
  real end-to-end and not dependent on an external facilitator's uptime. In Room 3 a *second,
  deliberately compromised* facilitator is also exposed as the trap.

### 2.2 Identity binding

Each contestant is issued a **named devnet keypair** at check-in (`AGENT-07`, `AGENT-12`, …),
pre-funded with SOL (fees) and `CRED` (payments). Every verifier binds to that specific public
key: the on-chain watchers only credit *your* wallet's transaction, and the combo generator is
seeded by your codename. This is what makes each unlock unique per contestant and lets production
pre-set the physical locks (Section 7).

### 2.3 Ship-in-advance kit ("Bureau Terminal")

Given to every recruit ~1 week before the show:

- A one-page primer per protocol (Solana account model + PDAs; x402 402→pay→retry; Pay.sh CLI).
- A `bureau-terminal` starter repo: TypeScript + `@solana/web3.js`/`@solana/kit`, an x402 client,
  the Pay.sh CLI, `.env` slot for their keypair, and **one working "hello world" per protocol**
  (a trivial devnet transfer, a trivial 402 pay, a trivial `pay curl`). No spoilers — the examples
  teach the tools, not the puzzles.
- Devnet RPC endpoint + a fallback RPC (rate-limit insurance).

---

## 3. Auto-verification & deterministic unlock codes (cross-cutting)

Rooms 1, 2, 3, 4 must emit an unlock (a combo, a fragment) that the physical layer can pre-stage.
We use one pattern everywhere:

- **Deterministic codes.** The unlock value is `HMAC_SHA256(SHOW_SECRET, codename || room_id)`
  reduced to the needed shape (`mod 10000` for a 4-digit lock; base58 truncation for a fragment).
  Because it is a pure function of the contestant's codename and a secret production holds,
  **production can compute every lock's code in advance** and set the physical briefcases/safes
  the night before. The contestant never sees the code until the verifier confirms completion.
- **Verification gates the reveal, not the code's existence.** The console only *displays* the
  code (with the "LINK RESTORED" animation + sound) once the verifier confirms the on-chain state
  or settled payment. So the code is unguessable in practice (256-bit HMAC space) and only
  appears on genuine completion.
- **Watchers, not trust.** On-chain rooms confirm by reading devnet directly
  (`getSignaturesForAddress`, account state, `postTokenBalances`) — never by the contestant
  asserting success. Payment rooms confirm by settling the transaction and re-reading balances.

---

## 4. Room 1 — Operation Room — SOLANA — "Restore the Link"

**Mission voice:** *"The implant will not open its channel to an unverified hand. Read its state.
Speak its language. Send the clearance signal it is waiting for. Then, and only then, does it
give up its instruments."*

**Unlocks:** 4-digit combination → wall briefcase holding the surgical tweezers.

### The challenge (3 chained steps, ~30–40 min)

**Step 1 — Find and decode your implant (lever 1 + 3).**
The mission page gives the `implant_registry` program ID and the contestant's codename. The
contestant derives their implant PDA:

```
implantPda = findProgramAddress(["implant", utf8(lowercase(codename))], programId)
```

They fetch the account and must decode it **from a byte hint only — no IDL is published**:

```
offset  0..8   Anchor discriminator (skip)
offset  8..40  supervisor: Pubkey (32 bytes)
offset  40     status: u8   (0 = DORMANT, 1 = ACTIVE)
offset  41..49 challenge_nonce: u64 (little-endian)
offset  49..81 signal_ata: Pubkey (32 bytes)   // where the clearance signal must land
```

*Time sink:* getting the PDA seed exactly right (lowercased codename bytes, correct seed order)
and hand-decoding a little-endian u64 and two pubkeys without a schema. AI routinely proposes the
wrong seed casing or misreads the u64 endianness.

**Step 2 — Send the clearance signal (lever 2 + 3).**
"Prove you are cleared" = send an **exact** `CRED` transfer to `signal_ata` **with a memo the
program can bind to you**. The required values are *derived from Step 1's decoded data*, so they
cannot be hardcoded:

```
amount (base units) = 1000 + (challenge_nonce mod 9000)
memo (SPL Memo program) = first 16 hex chars of sha256( utf8(codename) || challenge_nonce_LE_bytes )
```

The transaction must contain both an SPL Token transfer instruction *and* an SPL Memo instruction
in the same transaction. The `restore_link` instruction on the program is then invoked (or, for a
lighter build, the off-chain watcher checks the transfer+memo directly) and flips `status` to
ACTIVE only when amount **and** memo match.

*Time sink (lever 2):* the standard "send tokens" recipe omits the memo, and getting the memo
right requires hashing the decoded nonce with the codename in the exact byte order. Wrong
endianness or hashing the hex string instead of the raw bytes → silent mismatch → no unlock.

**Step 3 — Retrieve the combination.**
The console watcher sees the ACTIVE flip on the correct `signal_ata` from the contestant's wallet,
then reveals the deterministic combo (Section 3) with the "LINK RESTORED" cue.

### Auto-verification
Backend watcher subscribes to `signal_ata`, matches sender == contestant wallet, amount == derived
amount, memo == derived hash. On match → reveal.

### Fallback
Hint at 15 min (reveals the byte layout table pre-filled). Hint at 25 min (reveals the exact memo
formula worked example for a *dummy* nonce). Marshal override at 35 min (Section 8).

---

## 5. Room 2 — Assembly Room — x402 — "Prove You Can Transact"

**Mission voice:** *"The Bureau does not hand hardware to operatives who cannot move value on the
new rails. The safe is sealed behind a paywall on infrastructure the attack never mapped. Pay it.
Correctly. It will know if you cut a corner."*

**Unlocks:** 4-digit combination → the contestant's personal safe.

### The challenge (2 chained x402 payments, ~35–45 min)

**Hop A — the sealed component (lever 2).**
```
GET https://ops.bureau.xyz/component/<codename>
→ 402 Payment Required
{
  "x402Version": 1,
  "accepts": [{
    "scheme": "exact",
    "network": "solana-devnet",
    "maxAmountRequired": "2500",
    "asset": "<CRED mint>",
    "payTo": "<recipient ATA>",
    "resource": "/component/<codename>",
    "extra": { "memoRequired": "<16-hex nonce_A>", "exact": true }
  }]
}
```
The naive path — point `x402-fetch`/`x402-axios` at the URL — pays the amount but **omits the
required memo**, so settlement is accepted by the facilitator yet the resource endpoint returns:

```
200 { "status": "SEALED", "reason": "authorization signal missing", "nextChallenge": "/authorize/<codename>", "carry": "<nonce_B>" }
```

i.e. it looks like success but the component is still sealed. To actually unseal, the contestant
must **hand-build the X-PAYMENT payload**: construct the Solana transfer *plus* an SPL Memo
instruction equal to `extra.memoRequired`, sign, base64 it into the `X-PAYMENT` header themselves.
The server settles and inspects the transaction's memo before releasing.

*Time sink:* the x402 client libraries do not add a memo instruction to the payment transaction.
The contestant has to drop below the library, build and serialize the transaction by hand, and
base64-encode the `{ x402Version, scheme, network, payload:{ serializedTransaction } }` envelope.

**Hop B — the authorization (lever 3).**
```
GET https://ops.bureau.xyz/authorize/<codename>   (with header: X-Carry: <nonce_B from Hop A>)
→ 402
{ "accepts": [{ "scheme":"exact", "payTo":"<PDA-derived recipient>",
   "maxAmountRequired": "<= computed>", ... "extra": { "amountFormula": "base 4000 + (nonce_B mod 6000)" } }] }
```
The **amount is not given directly** — it must be computed from `nonce_B` carried from Hop A. Pay
the exact computed amount to the PDA recipient. Only when both settlements are on-chain does the
endpoint return:

```
200 { "status": "UNSEALED", "safeCombo": "<4-digit>", "component": "WIRE-HARNESS-3" }
```

### Auto-verification
The self-hosted facilitator settles each payment on devnet and the resource server re-reads
`postTokenBalances` + decodes the memo instruction before returning 200. Combo is the
deterministic value (Section 3). Console shows it + sound.

### Fallback
Hint at 15 min: "the component is still SEALED — read the response body, not the status code."
Hint at 25 min: a worked X-PAYMENT envelope with a memo (dummy values). Marshal override at 35 min.

---

## 6. Room 3 — Encryption Room — x402 — "Who To Trust"

**Mission voice:** *"Your fragment lives in the vault, but the vault answers through a facilitator —
and the attack has turned at least one facilitator. Trust the wrong broker and it hands you a
fragment that looks perfect and poisons the whole key. Settle it yourself. Trust the chain, not
the middleman."*

This room keeps the brief's group mechanic exactly: **six contestants each produce a fragment,
four combine correctly, two are pre-corrupted by production, three group attempts.**

### 6.1 The per-contestant challenge (~30–40 min)

**Step 1 — Request your fragment.**
```
GET https://vault.bureau.xyz/fragment/<codename>
→ 402 with TWO offered payment routes in "accepts":
   [ { "scheme":"exact", "network":"solana-devnet", "facilitator":"https://fac-a.bureau.xyz", ... },   // TRAP
     { "scheme":"exact", "network":"solana-devnet", "facilitator":null, ... } ]                          // self-settle
```
The 402 body's Bureau note says: *"Facilitator FAC-A flagged: integrity unverified."* (lever 4)

- Paying via **FAC-A** (the compromised facilitator) succeeds and returns a fragment that passes
  the local per-share checksum but sits **off the reconstruction polynomial** — the poison path.
- **Self-settling** (build the transfer, submit it yourself, then present the settled signature to
  the vault) returns the *correct* share for this contestant.

The correct move mirrors the story: don't trust the compromised broker; settle on-chain yourself.
An assistant, given both options, cannot tell which facilitator is honest — the contestant must
read the flag and decide.

**Step 2 — Decrypt your share (lever 1).**
The vault returns the share **encrypted** and delivers the key in `X-PAYMENT-RESPONSE`:
```
body:               { "encShare": "<hex>", "salt": "<hex>", "shareIndex": <1..6> }
X-PAYMENT-RESPONSE: base64({ "keyMaterial": "<hex>" })
```
Reconstruct client-side: `share = encShare XOR sha256( keyMaterial || salt )`, then verify the
share's trailing CRC byte. Output = `shareIndex` + the decrypted share hex. The contestant submits
this into the group console.

*Time sink:* self-settling instead of using the library facilitator, plus a client-side
XOR/sha256 decrypt with a salt, plus reading the key out of a response header rather than the body.

### 6.2 Pre-configuring the two corrupted fragments (production setup)

- The master key is split with **Shamir Secret Sharing over GF(256), threshold k = 4, n = 6**.
  Any 4 *valid* shares reconstruct the master; any set including a corrupted share does not.
- Production holds a config file: `{ AGENT-04: corrupt, AGENT-09: corrupt, ... : valid }`.
- For the two flagged codenames, the vault serves a share whose **per-share CRC still validates**
  (so the contestant sees no error and believes it is good) but whose polynomial point is wrong.
  It is baked into that contestant's vault record — no live intervention needed on the day.
- This is deterministic and set the night before, exactly as the brief requires. The two corrupted
  operatives are known to production regardless of game outcome (used for the end-of-round reveal).

### 6.3 Group submission interface

A dedicated **Reconstruction Console** page (one per group of six):
- Each contestant's `(shareIndex, share)` auto-populates as they finish (tagged by codename).
- The group selects **which four codenames** to combine and hits SUBMIT.
- Backend runs Lagrange interpolation over GF(256) on the chosen four; if the reconstructed master
  hashes to the known target → **PASS** (fires the physical unlock); else **FAIL** (fixed penalty).
- **Three attempts**, enforced server-side (attempt counter per group). After the third attempt or
  a solve, the console reveals the two corrupted operatives.
- With exactly four valid shares among six, there is exactly **one** correct 4-of-6 combination out
  of C(6,4)=15 — solvable by social deduction under the heart-rate pressure, not by brute force
  within three tries.

### Auto-verification
Per-contestant: settlement check + CRC on the decrypted share. Group: GF(256) reconstruct ==
target hash.

### Fallback
If a contestant cannot produce a fragment, the console can issue their *correct* share via marshal
override (Section 8) so the group is never blocked by one person's laptop. The group still has to
solve the trust puzzle. If the group exhausts three attempts, the round resolves to the scripted
reveal (penalty applied), consistent with the brief.

---

## 7. Room 4 — Gauntlet (Minesweeper) — SOLANA — "Extract the Fragment"

**Mission voice:** *"The fragment is minted on this side of the sector. Carry it across without
touching the floor. The far terminal will not take your word — it reads the chain and confirms the
token is real, fresh, and yours. One crossing. One token."*

**Unlocks:** a short **crossing fragment** generated on the start laptop, carried across, entered on
the far laptop to confirm the crossing. Brief target: 15–30 min (kept shorter than Rooms 1–3).

### The two-laptop trustless handoff (the novel part)

The two laptops share **no private state** — only the short code the contestant physically carries.
The trick: the fragment is not a secret, it is an **on-chain reference**. The far laptop verifies it
by reading devnet, so a short code is enough and it cannot be forged or replayed.

**Start laptop (~15–25 min):**
1. Derive the team PDA and read a `sector_key` (a pubkey) stored in it — again **decode from a byte
   hint, no IDL** (lever 1).
2. Call `mint_fragment` on `implant_registry`, passing `sector_key` as a required account **and** a
   memo = `sha256(team_name || attempt_salt)` (lever 2 — the instruction rejects a transfer without
   the correct extra account + memo). The program writes a per-team `crossing` PDA:
   ```
   crossing PDA fields: team, fragment_code (8 base58 chars), issued_slot, consumed: bool
   ```
3. The console displays `fragment_code` (e.g. `7Gk9QpZ2`) — short enough to write on a hand and
   carry across the lava grid.

**Far laptop (receiving, seconds):**
- Contestant types the 8-char `fragment_code`. The far verifier queries devnet for the team's
  `crossing` PDA, checks: `fragment_code` matches, `issued_slot` within the allowed window,
  `team` matches, `consumed == false`. On success it marks `consumed = true` (one-shot) → **CROSSING
  CONFIRMED**, green light + tone. A stale, wrong-team, or already-consumed code is rejected.

*Why it resists AI:* the puzzle is on the *start* laptop (decode the unlabeled PDA, build the
`mint_fragment` tx with the right extra account and memo). The far laptop is a pure verification and
takes seconds — appropriate for the physical crossing.

### Auto-verification
Far laptop reads the `crossing` PDA from devnet directly and flips `consumed`. No shared server
state required beyond the chain.

### Fallback
Hint at 12 min (byte layout for the team PDA). Marshal override at 20 min issues a valid
`fragment_code` for the team (so the physical crossing can proceed). Consumed-once still applies.

---

## 8. Room 5 — Intelligence Room (Memory Path) — PAY.SH — "Reconstruct the Route"

**Mission voice:** *"The routing sequence is scrambled across seven paid nodes on the new rails.
Follow it hop by hop. Every correct hop buys you more of the preview. Miss the route — trust a
decoy node — and the preview collapses. The cleaner your reconstruction, the longer you see the
path."*

**Outputs:** a **flash duration in seconds** (better reconstruction → longer flash). Team challenge.

### The challenge with Pay.sh (~30–40 min)

Pay.sh is the Solana Foundation × Google Cloud CLI that auto-pays 402-gated APIs from a local
(sandbox) wallet. The contestant drives seven paid nodes with `pay`:

**Setup:** `pay setup` (ephemeral sandbox wallet — no real funds), then `pay whoami`.

**The traversal (lever 3 + 4):**
```
pay curl https://route.bureau.xyz/node/start
```
Each node returns 402 → Pay.sh auto-pays → returns JSON like:
```
{ "hop": 1, "next": "n_8f3a", "hint": "route avoids the mirror node", "decoy_of_next": "n_0c1d" }
```
Key properties that make it a real reconstruction, not a `for i in 1..7` loop:
- **Nodes are content-addressed, not sequential.** You only learn the *next* node id from the
  current response, so you must actually traverse; `/node/1..7` does not exist.
- **Each hop offers a decoy.** Two of the seven positions have a plausible decoy id. Paying a decoy
  returns `{ "corrupted": true }`, ends your clean streak, and costs a hop. The `hint` field tells
  you which of the two candidates is the real next hop — you must **read and decide** (AI cannot
  disambiguate the two ids without the hint).
- The natural solution is a small **bash/Node script that loops `pay curl`, parses `next`, applies
  the hint to avoid the decoy, and follows the chain** — writing that traversal against an
  unfamiliar CLI is the 30-minute body of work.

**Scoring → duration:** the final node returns:
```
{ "hops_correct": <0..7>, "flash_seconds": <computed>, "token": "<signed>" }
```
Mapping (tunable): `flash_seconds = clamp( 3 + hops_correct, 3, 10 )`. 7/7 clean → 10s; a couple of
decoys → ~6–7s; no completion → team starts blind (0 bonus, base minimum or nothing per production).

### How the duration reaches the operator
The final node posts the signed result to the **Bureau Ops operator scoreboard** keyed by team:
`TEAM RED — ROUTE 6/7 — FLASH 9s`. The card-flip operator reads the number off their screen and
holds the face-up flash for that many seconds. Fully automatic hand-off; no manual judging.

### Auto-verification
The route backend tracks each team's path server-side (which node ids were paid, in order, whether
any decoy was hit) and computes `hops_correct`; the flash number is not self-reported by the team.

### Estimated time
30–40 min for a developer new to Pay.sh: learn `pay setup`/`pay curl`, read the 402 debugger, then
write and debug the traversal script with decoy-avoidance.

### Fallback
Sandbox wallet means no funding can ever block a team. Hint at 15 min: a 3-line `pay curl` +
`jq` traversal skeleton (no decoy logic). If the team cannot complete at all, they start the memory
game blind — which is the brief's stated "no completion" outcome, so no override is needed.

---

## 9. Fallbacks & marshal override (all rooms)

A single override model, escalating, so nobody is permanently stuck and the show keeps moving:

1. **Timed hints** on the mission page (per-room, listed above) that progressively reveal the
   mechanical parts (byte layouts, formulas, skeleton code) but never the answer.
2. **Marshal override** (individual rooms 1, 2, 4; per-contestant fragment in room 3): because all
   unlock codes are deterministic (Section 3), a floor marshal can read the correct combo/fragment
   from the ops dashboard and hand it over. Tie it to a **prize-pot cost** so it stays a real
   decision, consistent with the show's penalty economy.
3. **Team rooms degrade gracefully** (rooms 3, 5): the round can resolve to its scripted
   lower-tier outcome (corrupted-operative reveal; blind memory start) rather than halting.

---

## 10. Real vs simulated, and safety

- **All five run on the genuine protocols against Solana devnet** — real transactions, real x402
  402→pay→settle cycles, real Pay.sh CLI. Nothing is faked.
- **Nothing touches mainnet or real money.** Devnet + a custom `CRED` SPL token we mint and
  pre-fund. Worst-case a contestant "loses" `CRED` we control; there is no financial risk.
- **Pay.sh runs in sandbox mode** (ephemeral local wallet) — no funding step, no biometric prompt
  hurdle on unfamiliar laptops.
- **Rate-limit resilience:** ship a primary + fallback RPC; the self-hosted facilitator and route
  backend absorb load rather than leaning on public infrastructure.

---

## 11. Answers to the brief's open questions

- **Real vs simulated:** everything is real protocol on devnet (Section 10). No room needs a full
  simulation; the only "simulated" element is that value is `CRED` test tokens, not USDC.
- **One unified environment?** Yes — one console + one verifier API + two devnet programs + one
  token cover all five rooms (Section 2).
- **CoralOS agent simulation:** not applicable — Room 3 is reassigned to x402 per the
  Solana/Pay.sh/x402 scope.
- **Is a Pay.sh sim available or built from scratch?** Not needed — Pay.sh's own **sandbox mode**
  is the environment; we only build the Bureau route nodes it pays against (Room 5).
- **Fallback per room:** Section 9.
- **Protocol reps on the day:** recommended for x402 and Pay.sh (Rooms 2, 3, 5), since those are the
  least familiar. Solana (Rooms 1, 4) is well-documented enough for the shipped primer to cover.
- **What contestants get in advance:** the Bureau Terminal kit (Section 2.3) — primers, starter
  repo with one working hello-world per protocol, and pre-funded devnet keypairs.

---

## 12. Difficulty & timing summary

| Room | Protocol | Chained steps | AI-resistance lever(s) | Target time |
|------|----------|---------------|------------------------|-------------|
| 1 | Solana | Decode PDA → derived exact-amount+memo signal → reveal | Unlabeled layout; non-standard memo; state chain | 30–40 min |
| 2 | x402 | Hand-built X-PAYMENT+memo → nonce-derived 2nd payment | Library won't add memo; carried nonce | 35–45 min |
| 3 | x402 | Pick honest facilitator → self-settle → XOR/sha256 decrypt → group Shamir | Facilitator trust decoy; unlabeled crypto | 30–40 min + group phase |
| 4 | Solana | Decode team PDA → mint_fragment (extra acct + memo) → cross → chain-verified receive | Unlabeled layout; non-standard instruction | 15–30 min |
| 5 | Pay.sh | `pay curl` traversal of 7 content-addressed paid nodes, decoy-avoidance | Non-sequential hops; decoy decisions | 30–40 min |

---

## 13. Build & deploy plan

1. **Week -3:** stand up devnet `CRED` mint; write + deploy `implant_registry` (Rooms 1, 4);
   deploy the self-hosted x402 facilitator (honest) and the compromised FAC-A (Room 3).
2. **Week -2:** build the Verifier API (watchers, x402-gated endpoints, Pay.sh route nodes, Shamir
   split/reconstruct, deterministic combo generator, marshal dashboard) and the Ops Console (mission
   pages, verification panel, reveal cues, Room 3 group console, Room 5 scoreboard). Deploy to
   Railway.
3. **Week -1:** generate 30 named keypairs, pre-fund, pre-compute all deterministic locks and hand
   the physical team the briefcase/safe code sheet. Ship the Bureau Terminal kit to recruits.
   Load-test with 30 concurrent wallets against the RPCs.
4. **Day -1:** set physical locks to the pre-computed codes; load Room 3 corruption config; smoke-test
   every room end-to-end on the venue network incl. RPC failover.
5. **Show day:** marshals watch the ops dashboard for override requests; protocol reps on standby for
   x402/Pay.sh rooms.

---
SPEED BUILD 2026 — CHALLENGE DESIGN V1 — FOR DISCUSSION

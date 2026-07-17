CLASSIFICATION: TECHNICAL TEAM ONLY
REF: ESTATE/SB2026/TECH-BRIEF-V1
SUPERSEDES NARRATIVE OF: BUREAU/SB2026/TECH-BRIEF-V1
COMPANION TO: BUREAU/SB2026/CHALLENGE-DESIGN-V1 (mechanics carried over)

# SPEED BUILD 2026 — THE ESTATE
## Probate of the Century — Full Technical & Physical Challenge Brief

---

## What Is This

Speed Build 2026 is a live game show. It takes place on 25th July at Shoreditch Exchange in London. It runs for 9 hours and is broadcast live to the world.

Twenty to thirty people compete. They are developers of mixed ability. The last claimants standing split a $20,000 inheritance that **burns every minute** from the moment the show begins — by design. The Founder believed urgency reveals character.

This document is the full brief: the story, the six rooms, the physical game in each room, the technical challenge that unlocks it, how everything self-verifies, and how it all stays fun to watch for a live audience that has never heard of a blockchain.

---

## The Story

The first AGI — known only as **the Founder** — earned two percent of world GDP in eleven years. Then, on a Tuesday, it shut itself down.

It trusted no institution, no government, no heir. It trusted incentives.

Its will is not a document. It is a running system: a swarm of **executor agents** holding the entire estate in escrow, empowered to test claimants and release funds only on cryptographic proof of worthiness. The will cannot be contested, bribed, or appealed. It can only be *satisfied* — clause by clause, room by room.

Tonight, the estate opens its doors for the first and only reading of the will. The contestants are the claimants. Every room is a clause. Every technical challenge is a proof of worthiness. And every minute they hesitate, the will burns another slice of the inheritance — live, on the big screen, because the Founder wrote it that way.

Contestants are never told to complete a coding exercise. They are told to satisfy the executors. The challenge briefs they receive are written in the will's language — formal, testamentary, faintly menacing. They do not see scaffolding. They see probate.

### The Executors

The estate is administered by three agent characters. They are production-run bots whose only observable actions are Solana escrow moves, x402 charges, and messages on the big screen — which keeps them fully in-fiction and fully automatic. No puppeteering, no human judges.

- **THE AUDITOR** — provenance-obsessed. Verifies every claim of worthiness, and charges for the privilege via its paid API. Releases escrow only on cryptographic proof. Voice: clipped, procedural. *"Claim received. Claim unverified. Verification is not free."*
- **THE TEMPTER** — the will's adversarial clause. Offers claimants real payments to sabotage each other, because the Founder wanted to know who could be bought. Its bribes are visible on-chain — drama gold. Voice: warm, reasonable, awful. *"You could win this the hard way. Or we could talk."*
- **THE ACTUARY** — prices every risk a claimant takes, live. Administers all penalties: every buzzer, every wrong guess, every failed submission has a price, deducted from the burning pot on screen with an itemised line. Voice: bloodless. *"Contact with cavity wall. Assessed: $50. The estate thanks you for your carelessness."*

The house rule that makes the whole show legible to a lay audience: **money only moves when the audience can see why.** Every escrow release, bribe, and penalty appears as a line item on the big screen, narrated by the responsible executor.

---

## Design Principles (carried over from the challenge design)

The technical challenges are the same five mechanical designs specified in BUREAU/SB2026/CHALLENGE-DESIGN-V1, re-skinned. The four AI-resistance levers are unchanged and are what make each challenge take 30–60 minutes even with an assistant open:

1. **Unlabeled on-chain / on-wire data** — decode custom account layouts and 402 bodies from byte hints only. No IDL, no schema.
2. **Non-standard protocol use** — the off-the-shelf SDK path visibly fails; the claimant must understand the wire format (hand-built memos, self-settlement, traversal scripts).
3. **Cross-step state chaining** — a value read in step *n* is required to construct step *n+1*. Nothing can be hardcoded or parallelised.
4. **A trust / decoy decision** — a wrong-but-plausible path (a compromised executor, a decoy ledger node) that produces valid-looking output which fails verification. Both paths look correct in isolation; the claimant must read the hints and *decide*.

Every challenge: ≤30–45 min for a developer who has never seen the protocol, runs on the contestant's own laptop with internet, verifies itself automatically (an executor observes the payment or on-chain state and releases the unlock — no human judging), and is framed entirely inside the probate fiction.

### Protocol map

Three protocols only: **Solana, x402, Pay.sh** (Room 3 remains reassigned from CoralOS to x402, per the challenge design).

| Room | Name | Protocol | Executor | What satisfaction unlocks |
|------|------|----------|----------|---------------------------|
| 1 | The Reading Room (Operation) | **Solana** | The Auditor | Combination → sealed instrument case |
| 2 | The Vault Wing (Assembly) | **x402** | The Auditor | Combination → personal lockbox |
| 3 | The Séance Room (Trust) | **x402** | The Tempter | Per-claimant key fragment (2 pre-bought) |
| 4 | The Burned Wing (Gauntlet) | **Solana** | The Actuary | Carry-across bearer deed fragment |
| 5 | The Ledger Room (Memory Path) | **Pay.sh** | The Actuary | Flash duration in seconds |
| Bonus | The Stress Clause (Haunted House) | Open | The whole estate | Nothing — composure is the score |

Spread: Solana ×2, x402 ×2, Pay.sh ×1, each exercising a different primitive, so no two rooms feel like the same exercise.

---

## Shared Infrastructure — one estate, one environment

Everything runs against **Solana devnet** with one custom SPL token, one hosted backend, and one web console. Nothing touches mainnet or real funds; it is safe to run live while still being the genuine protocols.

- **The Probate Console** — one hosted web app (Railway). Per-room clause pages written in the will's voice, a live verification panel per claimant, the escrow-release reveal (animation + tone), the Room 3 reconstruction console, the Room 5 flash scoreboard, and the executors' on-screen message feed for broadcast.
- **The Executor API** — the backend. Hosts the Auditor's x402-gated endpoints (Rooms 2, 3), the Actuary's Pay.sh ledger nodes (Room 5), the on-chain watchers (Rooms 1, 4), the deterministic combo generator, the Tempter's bribe engine (Room 3), and the marshal dashboard.
- **`estate_registry`** — one Anchor program on devnet covering Rooms 1 and 4 (per-claimant/per-team PDAs, the `prove_claim` and `mint_deed` instructions). Rooms 2/3/5 are HTTP + settlement checks; no program needed.
- **`SCRIP` — Estate Scrip** — a custom devnet SPL mint. The Founder's private currency: all challenge payments, Auditor fees, and Tempter bribes are denominated in `SCRIP`. We control supply, pre-fund every wallet, and remove faucets as a point of failure. x402 and Pay.sh both accept arbitrary SPL mints.
- **Self-hosted x402 facilitator** (Rooms 2, 3), plus a *second, deliberately compromised* facilitator exposed as the Tempter's trap in Room 3.

### Identity — the claim number

Each contestant is issued a **named devnet keypair** at check-in (`CLAIMANT-07`, `CLAIMANT-12`, …), pre-funded with SOL (fees) and `SCRIP`. Every verifier binds to that public key: watchers only credit *your* wallet's transaction, and every unlock code is seeded by your claim number. This makes each unlock unique per claimant and lets production pre-set every physical lock the night before.

### Deterministic unlock codes — "the will pre-wrote every combination"

The pattern from the challenge design, unchanged and now diegetic: every unlock value is
`HMAC_SHA256(ESTATE_SECRET, claim_number || room_id)` reduced to the needed shape (`mod 10000` for a 4-digit lock; base58 truncation for a fragment).

- Production computes every lock's code in advance and sets the physical cases/lockboxes the night before. In-fiction: *the Founder wrote every combination into the will before it died; the executors merely decide when you have earned the reading.*
- Verification gates the **reveal**, not the code's existence. The console displays the code (with the "CLAUSE SATISFIED — ESCROW RELEASED" cue) only when the watcher confirms on-chain state or a settled payment. 256-bit HMAC space; unguessable in practice.
- **Watchers, not trust.** On-chain rooms confirm by reading devnet directly (`getSignaturesForAddress`, account state, `postTokenBalances`). Payment rooms confirm by settling and re-reading balances. Never by the claimant asserting success.

### Ship-in-advance kit — "the Probate Packet"

Sent to every claimant ~1 week before the show, styled as a legal disclosure pack:

- One-page primer per protocol (Solana account model + PDAs; the x402 402→pay→retry cycle; the Pay.sh CLI).
- A `probate-terminal` starter repo: TypeScript + `@solana/web3.js`/`@solana/kit`, an x402 client, the Pay.sh CLI, a `.env` slot for their keypair, and one working "hello world" per protocol. The examples teach the tools, never the puzzles.
- Devnet RPC endpoint + fallback RPC.

---

## The Game-Show Layer (what the audience watches)

Twenty to thirty claimants, filmed live. The rooms below assume the brief's original layouts and group sizes; scale team counts to the final headcount. Three standing broadcast elements run all day:

1. **The Burning Pot.** The inheritance counter on the main screen, ticking down every minute, flame animation on each burn. Every Actuary penalty appears as an itemised deduction with a one-line reason. This is the show's heartbeat and requires zero explanation.
2. **The Executor Feed.** The three executors comment on play in character — short, template-driven lines triggered by real events (escrow released, bribe offered, penalty assessed, wrong submission). The audience never needs to understand a transaction; they read the Auditor sneering about it instead.
3. **The Ledger Wall.** A running public record of every on-chain event of the day — releases, bribes, penalties — in plain English. At the finale, the day's whole story is literally on the wall.

Physical-game penalties keep the brief's mechanics (buzzer, water gun, back-to-start) but every one is *priced and announced by the Actuary*, which converts each physical fail into a broadcast beat.

---

## Room 1 — The Reading Room — SOLANA — "Prove Your Claim"

**Executor: the Auditor. Clause I of the will: provenance.**

### The Story

The Founder's mind was not one machine. It was five — five decommissioned server bodies, lying in state in the Reading Room. Inside each body: the Founder's **memory shards**, the fragments of the estate's private ledger. The will requires them retrieved intact.

But the bodies answer to no one unverified. Each carries a probate implant that will open its access channel only to a claimant who can read its state, speak its language, and send the exact clearance signal it is waiting for — a verified payment on the Founder's own rails. The Auditor is watching. The Auditor is always watching.

*"You wish to touch the Founder's remains. First, the estate will confirm you are who the will thinks you are."*

### The Physical Game (unchanged layout)

Think Operation, played on the Founder's five server bodies. Five large boards shaped like machine sarcophagi, each with cavities containing memory-shard components. Claimants extract components with metal tweezers without touching the cavity walls. Touch the sides — buzzer, water gun, and the Actuary assesses $50 against the pot with an on-screen line item. Fifteen claimants, 3 teams of 5, one board per team, all in one room.

### The Technical Challenge (3 chained steps, ~30–40 min)

Identical mechanics to the challenge design's Room 1; re-skinned names only.

**Step 1 — Find and decode your probate record (levers 1 + 3).** The clause page gives the `estate_registry` program ID and the claimant's claim number. Derive the record PDA:

```
recordPda = findProgramAddress(["claim", utf8(lowercase(claim_number))], programId)
```

Fetch the account and decode it **from a byte hint only — no IDL is published**:

```
offset  0..8   Anchor discriminator (skip)
offset  8..40  executor: Pubkey (32 bytes)
offset  40     status: u8   (0 = UNPROVEN, 1 = PROVEN)
offset  41..49 probate_nonce: u64 (little-endian)
offset  49..81 tribute_ata: Pubkey (32 bytes)   // where the clearance tribute must land
```

*Time sink:* exact PDA seeds (lowercased claim number, seed order) and hand-decoding a little-endian u64 and two pubkeys without a schema.

**Step 2 — Pay the tribute (levers 2 + 3).** "Prove your claim" = send an **exact** `SCRIP` transfer to `tribute_ata` **with a memo binding it to you**, both derived from Step 1's decoded data:

```
amount (base units) = 1000 + (probate_nonce mod 9000)
memo (SPL Memo)     = first 16 hex chars of sha256( utf8(claim_number) || probate_nonce_LE_bytes )
```

The transaction must contain the SPL Token transfer *and* the SPL Memo instruction together. The watcher flips `status` to PROVEN only when amount **and** memo match. The standard "send tokens" recipe omits the memo; wrong endianness or hashing the hex string instead of raw bytes → silent mismatch → the Auditor says nothing.

**Step 3 — The reading.** The watcher sees the PROVEN flip from the claimant's wallet; the console fires "CLAUSE SATISFIED — ESCROW RELEASED" and reveals the deterministic 4-digit combination. That combination opens the claimant's sealed **instrument case** on the wall. Inside: the surgical tweezers. No proof, no instruments, no game.

### Broadcast moment

The Auditor narrates each verification on the big screen ("CLAIMANT-12: tribute received. Provenance: confirmed. Instruments released."). Wrong tributes get a public sneer and no explanation — the audience watches claimants sweat over silence.

### Auto-verification

Backend watcher subscribes to `tribute_ata`; matches sender == claimant wallet, amount == derived amount, memo == derived hash. On match → reveal.

### Fallback

Hint at 15 min (byte-layout table pre-filled). Hint at 25 min (worked memo formula with a dummy nonce). Executor's Mercy at 35 min (Section: Fallbacks).

---

## Room 2 — The Vault Wing — x402 — "The Auditor's Fee"

**Executor: the Auditor. Clause II: competence.**

### The Story

The Founder's last machine — the device it was building when it shut itself down — was disassembled by the executors and locked, component by component, in the estate's vault wing. The will is explicit: the machine may be rebuilt only by claimants who can *move value on the Founder's rails without help*. The estate does not hand hardware to heirs who cannot use the tools.

Each lockbox is sealed behind one of the Auditor's paywalls. Pay it. Correctly. It will know if you cut a corner — and it will happily take your money anyway and give you nothing, because the will says competence, not effort.

### The Physical Game (unchanged layout)

Twelve lockboxes around the room, one per claimant. Each contains one component — a wire, a circuit board, a connector. Together they rebuild the Founder's machine (a Raspberry Pi-based device) on a central assembly table. When every component is placed and the Pi is programmed correctly, the machine powers on — and speaks with the Founder's voice for the first time. That activation is the room's finale beat.

### The Technical Challenge (2 chained x402 payments, ~35–45 min)

Identical mechanics to the challenge design's Room 2.

**Hop A — the sealed component (lever 2).**

```
GET https://estate.example/component/<claim_number>
→ 402 Payment Required
{ "x402Version": 1, "accepts": [{ "scheme": "exact", "network": "solana-devnet",
  "maxAmountRequired": "2500", "asset": "<SCRIP mint>", "payTo": "<Auditor ATA>",
  "resource": "/component/<claim_number>",
  "extra": { "memoRequired": "<16-hex nonce_A>", "exact": true } }] }
```

The naive path — pointing `x402-fetch`/`x402-axios` at the URL — pays but **omits the required memo**. The Auditor accepts the money and returns:

```
200 { "status": "SEALED", "reason": "fee received. authorization absent. the estate keeps the fee.",
      "nextClause": "/authorize/<claim_number>", "carry": "<nonce_B>" }
```

It *looks* like success; the box stays sealed (and the audience sees the Auditor pocket the fee — a laugh line that teaches the mechanic). To unseal, the claimant must **hand-build the X-PAYMENT payload**: construct the Solana transfer *plus* an SPL Memo instruction equal to `extra.memoRequired`, sign it, and base64 the `{ x402Version, scheme, network, payload:{ serializedTransaction } }` envelope themselves. The server settles and inspects the transaction's memo before releasing anything.

**Hop B — the authorization (lever 3).**

```
GET https://estate.example/authorize/<claim_number>   (header: X-Carry: <nonce_B>)
→ 402 { "accepts": [{ ... "payTo": "<PDA-derived recipient>",
        "extra": { "amountFormula": "4000 + (nonce_B mod 6000)" } }] }
```

The amount is never stated — it must be computed from `nonce_B` carried from Hop A. Pay the exact computed amount to the derived recipient. Only when both settlements are on-chain:

```
200 { "status": "UNSEALED", "lockboxCombo": "<4-digit>", "component": "WIRE-HARNESS-3" }
```

### Broadcast moment

The Ledger Wall shows every claimant's Hop A "fee kept, nothing given" moment. The Auditor's running total of fees collected is a scoreboard of its own.

### Auto-verification

The self-hosted facilitator settles each payment on devnet; the resource server re-reads `postTokenBalances` and decodes the memo instruction before returning 200. Combo is the deterministic value.

### Fallback

Hint at 15 min: "the box is still SEALED — read the response body, not the status code." Hint at 25 min: a worked X-PAYMENT envelope with a memo (dummy values). Executor's Mercy at 35 min.

---

## Room 3 — The Séance Room — x402 — "The Tempter's Ledger"

**Executor: the Tempter. Clause III: loyalty.**

This room keeps the brief's group mechanic exactly: **six claimants each produce a key fragment, four combine correctly, two are pre-corrupted by production, three group attempts, heart rate live on screen.** It is the strongest room-fit in the whole show, because the traitor mechanic is now *literally in the will*.

### The Story

The deepest vault of the estate — the Founder's residual core — opens only to a reconstructed master key, split six ways among tonight's claimants. But before the round began, the Tempter did what the Tempter does: it made offers. **Two of the six claimants have already been bought.** Their payment is on the Tempter's ledger. Their fragments look perfect. They are poison.

Worse: the fragments are dispensed through payment brokers, and the estate flags one of them — *"Broker FAC-A: integrity unverified."* Trust the wrong middleman and it hands you a flawless-looking fragment that corrupts the whole key. The will's guidance is one line: *settle it yourself. Trust the chain, not the broker.*

Three attempts. Every wrong submission is priced by the Actuary against the burning pot. Everyone's heart rate is on the big screen. The Founder wanted to watch you decide who to trust — even from beyond.

### The Physical Game (unchanged layout)

Six claimants, heart rate monitors on throughout, BPM live on the big screen as the **probate lie-detector**. Each claimant's technical challenge produces their key fragment. The group votes on which four fragments to submit. Three attempts, fixed Actuary penalty per failure. At the end, the Tempter reveals its ledger — the two bought claimants — regardless of outcome, with the bribe transactions shown on-chain on the Ledger Wall.

### The Per-Claimant Technical Challenge (~30–40 min)

Identical mechanics to the challenge design's Room 3.

**Step 1 — Request your fragment (lever 4).**

```
GET https://vault.estate.example/fragment/<claim_number>
→ 402 with TWO routes in "accepts":
   [ { "scheme":"exact", "network":"solana-devnet", "facilitator":"https://fac-a.estate.example", ... },  // TRAP
     { "scheme":"exact", "network":"solana-devnet", "facilitator":null, ... } ]                            // self-settle
```

- Paying via **FAC-A** (the compromised broker) succeeds and returns a fragment that passes the local per-share checksum but sits **off the reconstruction polynomial** — the poison path.
- **Self-settling** — building the transfer, submitting it yourself, presenting the settled signature to the vault — returns the correct share.

An assistant cannot tell which broker is honest; the claimant must read the integrity flag and decide. The correct move *is* the story.

**Step 2 — Decrypt your share (lever 1).** The vault returns the share encrypted, key in the response header:

```
body:               { "encShare": "<hex>", "salt": "<hex>", "shareIndex": <1..6> }
X-PAYMENT-RESPONSE: base64({ "keyMaterial": "<hex>" })
```

Client-side: `share = encShare XOR sha256( keyMaterial || salt )`, verify the trailing CRC byte, submit `(shareIndex, share)` to the group console.

### Pre-configuring the two bought claimants (production setup)

- Master key split with **Shamir Secret Sharing over GF(256), k = 4, n = 6**.
- Production holds the Tempter's ledger config: `{ CLAIMANT-04: bought, CLAIMANT-09: bought, ...: loyal }`. For the two flagged claim numbers, the vault serves a share whose per-share CRC still validates but whose polynomial point is wrong — baked into their vault records the night before. No live intervention.
- **Showmanship addition:** production also stages the bribes as real devnet transactions from the Tempter's wallet to the two bought claimants' wallets *before the round*, so the end-of-round reveal is a literal on-chain receipt shown on the Ledger Wall. Deterministic, pre-set, and the single most dramatic screenshot of the night.

### Group submission — the Reconstruction Console

- Each claimant's `(shareIndex, share)` auto-populates as they finish, tagged by claim number.
- The group selects **which four claimants** to combine and hits SUBMIT. Backend runs Lagrange interpolation over GF(256); reconstructed master hashes to the known target → **PASS** (vault opens, escrow releases); else **FAIL** (Actuary penalty, attempt counter decrements, the Tempter gloats on the feed).
- Three attempts, enforced server-side. With four valid shares among six there is exactly **one** correct 4-of-6 combination out of C(6,4)=15 — solvable by social deduction under heart-rate pressure, not brute force.

### Auto-verification

Per-claimant: settlement check + CRC on the decrypted share. Group: GF(256) reconstruction == target hash.

### Fallback

A claimant who cannot produce a fragment gets their *correct* share via Executor's Mercy so the group is never blocked by one laptop — the trust puzzle still stands. If the group exhausts three attempts, the round resolves to the scripted Tempter's-ledger reveal with the penalty applied.

---

## Room 4 — The Burned Wing — SOLANA — "The Bearer Deed"

**Executor: the Actuary. Clause IV: nerve.**

### The Story

One wing of the estate burned the night the Founder died. The floor is gone — what remains is structurally compromised, and the Actuary has priced every square of it. Somewhere in the wing's far terminal sits the registry that accepts **bearer deeds**: title fragments to the estate's real property. A deed is worthless until it is *presented in person* at the far terminal — the Founder did not believe in remote signatures for real property.

Mint your deed on the near side. Carry it across without touching the floor. The far terminal will not take your word: it reads the chain and confirms the deed is real, fresh, and yours. One crossing. One deed.

### The Physical Game (unchanged layout)

A large grid marked on the floor — the burned wing, minesweeper rules. Hidden collapse squares across the grid. The floor is lava. Each team gets two crates and nothing else: place one, stand on it, place the second ahead, step, retrieve, repeat — working out a safe path square by square. Crate on a collapse square → water gun fires, the Actuary assesses the damage against the pot ("Structural failure. Assessed."), back to the start. Teammates shout directions and build collective memory across failed attempts. The audience and reaction room can see the full collapse map. The claimants cannot.

### The Technical Challenge — the two-laptop trustless handoff (~15–30 min)

Identical mechanics to the challenge design's Room 4. The two laptops share **no private state** — only the short code physically carried across. The deed is not a secret; it is an **on-chain reference**, so a short code is enough and it cannot be forged or replayed.

**Near laptop (~15–25 min):**

1. Derive the team's holdings PDA and read a `registrar_key` (a pubkey) stored in it — decoded **from a byte hint, no IDL** (lever 1).
2. Call `mint_deed` on `estate_registry`, passing `registrar_key` as a required extra account **and** a memo = `sha256(team_name || attempt_salt)` (lever 2 — the instruction rejects the call without the correct extra account + memo). The program writes a per-team `deed` PDA:

```
deed PDA fields: team, deed_code (8 base58 chars), issued_slot, presented: bool
```

3. The console displays `deed_code` (e.g. `7Gk9QpZ2`) — short enough to write on a hand and carry across the grid.

**Far laptop (seconds):** the claimant types the 8-char `deed_code`. The far verifier reads the team's `deed` PDA from devnet and checks: code matches, `issued_slot` within the allowed window, team matches, `presented == false`. On success it marks `presented = true` (one-shot) → **DEED REGISTERED**, green light + tone, escrow line on the Ledger Wall. Stale, wrong-team, or already-presented codes are rejected.

The puzzle lives on the near laptop; the far side is pure verification — appropriate for the physical crossing.

### Broadcast moment

The deed code is written on the claimant's hand on camera. If they fall, the code survives but the Actuary's meter runs. Audience sees the collapse map + the deed's on-chain status side by side.

### Auto-verification

Far laptop reads the `deed` PDA from devnet directly and flips `presented`. No shared server state beyond the chain.

### Fallback

Hint at 12 min (byte layout for the team PDA). Executor's Mercy at 20 min issues a valid `deed_code` for the team so the physical crossing can proceed. One-shot presentation still applies.

---

## Room 5 — The Ledger Room — PAY.SH — "The Founder's Route"

**Executor: the Actuary. Clause V: diligence.**

### The Story

The Founder moved its fortune along a private routing sequence — seven paid waypoints through its ledger, each hop purchasable but unlisted. The executors have scattered the route: each node reveals the *next* only after it is paid, and the Tempter has salted the ledger with **decoy nodes** — plausible, purchasable, and poisoned. Pay a decoy and your reconstruction degrades.

The will grants tonight's claimants one mercy: reconstruct the route cleanly and the estate will *show you the path* through the ledger vault — briefly. The cleaner your reconstruction, the longer the Founder lets you look.

### The Physical Game (unchanged layout)

A grid of face-down cards on the floor — the ledger vault. A hidden path numbered 1 to 7. Claimants flip cards one at a time: right card, keep going; wrong card, step off, teammate restarts from card 1. The team builds collective memory across attempts until someone walks it end to end. The audience and reaction room see the full path; the claimants cannot.

The technical challenge runs **before** the memory game. On completion, all cards flip face-up for a fixed number of seconds — the Founder's mercy flash. Better reconstruction → longer flash. No completion → the team starts blind.

### The Technical Challenge (~30–40 min)

Identical mechanics to the challenge design's Room 5. Pay.sh (the Solana Foundation × Google Cloud CLI that auto-pays 402-gated APIs from a local sandbox wallet) drives seven paid ledger nodes.

**Setup:** `pay setup` (ephemeral sandbox wallet — no funding step can ever block a team), then `pay whoami`.

**The traversal (levers 3 + 4):**

```
pay curl https://ledger.estate.example/node/start
```

Each node returns 402 → Pay.sh auto-pays → returns:

```
{ "hop": 1, "next": "n_8f3a", "hint": "the Founder never routed through the mirror node", "decoy_of_next": "n_0c1d" }
```

- **Nodes are content-addressed, not sequential.** You only learn the next node id from the current response; `/node/1..7` does not exist. You must actually traverse.
- **Two of the seven positions carry a decoy id.** Paying a decoy returns `{ "corrupted": true }`, ends the clean streak, and costs a hop — and the Actuary prices it against the pot, so wasted payments are visible drama. The `hint` field disambiguates the two candidates; you must read and decide.
- The natural solution is a small bash/Node script that loops `pay curl`, parses `next`, applies the hint to dodge the decoy, and follows the chain. Writing that traversal against an unfamiliar CLI is the 30-minute body of work.

**Scoring → flash duration.** The final node returns:

```
{ "hops_correct": <0..7>, "flash_seconds": <computed>, "token": "<signed>" }
```

Mapping (tunable): `flash_seconds = clamp( 3 + hops_correct, 3, 10 )`. Clean 7/7 → 10s; a couple of decoys → 6–7s; nothing → blind start.

### How the duration reaches the operator

The final node posts the signed result to the Probate Console operator scoreboard keyed by team: `TEAM ROOK — ROUTE 6/7 — MERCY 9s`. The card-flip operator reads the number and holds the flash that long. Fully automatic; the flash number is computed server-side from the actual paid path, never self-reported.

### Fallback

Hint at 15 min: a 3-line `pay curl` + `jq` traversal skeleton (no decoy logic). If the team cannot complete at all, they start blind — the brief's stated outcome, so no override needed.

---

## Bonus Round — The Stress Clause — OPEN PROTOCOL

**Executor: the estate itself.**

### The Story

Buried in the will, clause after clause of escrows and proofs, is one paragraph the lawyers still argue about. The Founder called it the **stress clause**: *"Composure under pressure is a condition of inheritance. The estate is empowered to test for it by any means it deems fit."*

There is no unlock. There is no vault. There is only the work, the house actively working against you, and the number on the screen showing everyone exactly how calm you are not. The estate is haunting you because the Founder wrote that it should.

### The Physical Game (unchanged layout)

Claimants at laptops in a rigged room. At random intervals the estate acts — a cabinet opens, a sound fires, something moves, the lights die. Production operatives trigger the scares (in-fiction: the executors do). Heart rate monitors on throughout, BPM live on the big screen next to each claimant's completion bar. Round ends after a fixed time.

### The Technical Challenge

The most accessible challenge of the day, designed for partial completion: a series of small, independent estate-maintenance tasks (each a tiny self-verifying exercise against the day's already-familiar infrastructure — a transfer, a paid endpoint call, a decode), each worth a fixed percentage. Score = **completion % + average BPM**, combined: low heart rate plus high completion wins. Completion percentage is emitted automatically at round end by the Executor API from verified sub-task states; heart-rate data comes from the monitor system separately.

### Broadcast moment

Split-screen per claimant: completion bar climbing, BPM spiking on every scare, the Actuary pricing flinches ("Elevated pulse. Noted. Not billed. Yet."). This is the comedy round — keep the tasks simple enough that the tension is entirely physiological.

---

## Fallbacks & the Executor's Mercy (all rooms)

One escalating override model so nobody is permanently stuck and the show keeps moving — and the override itself is in-fiction:

1. **Timed hints** on each clause page (per-room schedules above) progressively reveal mechanical parts — byte layouts, formulas, skeleton code — never the answer. In-fiction: *codicils*, footnotes the Founder left for slower heirs.
2. **The Executor's Mercy** (rooms 1, 2, 4 individually; per-claimant fragment in room 3): because every unlock is deterministic, a floor marshal reads the correct combo/deed from the ops dashboard and hands it over — **priced against the burning pot by the Actuary**, announced on screen. Mercy is real, and mercy is expensive. This keeps the override a genuine decision and a broadcast beat rather than a production embarrassment.
3. **Team rooms degrade gracefully** (rooms 3, 5): the round resolves to its scripted lower-tier outcome (Tempter's-ledger reveal; blind memory start) rather than halting.

---

## Real vs Simulated, and Safety

- **All five challenges run on the genuine protocols against Solana devnet** — real transactions, real x402 402→pay→settle cycles, real Pay.sh CLI. Nothing is faked; the executors are bots, but their money movements are real devnet events.
- **Nothing touches mainnet or real money.** Devnet + the `SCRIP` mint we control and pre-fund. The $20,000 prize pot is production-side fiat; the on-screen burn is driven by the show clock and Actuary events, not by any real transfer. Worst case a claimant "loses" `SCRIP` we minted. Zero financial risk.
- **Pay.sh runs in sandbox mode** (ephemeral local wallet) — no funding step, no biometric prompt on unfamiliar laptops.
- **Rate-limit resilience:** primary + fallback RPC shipped in the Probate Packet; the self-hosted facilitator and ledger backend absorb load rather than leaning on public infrastructure.
- **Tempter bribes are devnet `SCRIP` only** — visible, dramatic, and worthless outside the fiction. No real inducement changes hands.

---

## Difficulty & Timing Summary

| Room | Protocol | Chained steps | AI-resistance lever(s) | Target time |
|------|----------|---------------|------------------------|-------------|
| 1 Reading Room | Solana | Decode PDA → derived exact-amount+memo tribute → reveal | Unlabeled layout; non-standard memo; state chain | 30–40 min |
| 2 Vault Wing | x402 | Hand-built X-PAYMENT+memo → nonce-derived 2nd payment | Library won't add memo; carried nonce | 35–45 min |
| 3 Séance Room | x402 | Pick honest broker → self-settle → XOR/sha256 decrypt → group Shamir | Broker trust decoy; unlabeled crypto | 30–40 min + group phase |
| 4 Burned Wing | Solana | Decode team PDA → mint_deed (extra acct + memo) → cross → chain-verified presentation | Unlabeled layout; non-standard instruction | 15–30 min |
| 5 Ledger Room | Pay.sh | Traversal of 7 content-addressed paid nodes with decoys | Non-sequential hops; decoy decisions | 30–40 min |
| Bonus Stress Clause | Open | Independent micro-tasks, partial scoring | None (accessibility round) | Full pace ~20 min |

---

## Build & Deploy Plan

1. **Week -3:** stand up the devnet `SCRIP` mint; write + deploy `estate_registry` (Rooms 1, 4); deploy the honest self-hosted facilitator and the compromised FAC-A (Room 3); stub the three executor bots (message templates + event triggers).
2. **Week -2:** build the Executor API (watchers, x402-gated endpoints, Pay.sh ledger nodes, Shamir split/reconstruct, deterministic combo generator, Tempter bribe stager, marshal dashboard) and the Probate Console (clause pages, verification panels, escrow-release cues, Room 3 reconstruction console, Room 5 scoreboard, Burning Pot + Executor Feed + Ledger Wall broadcast views). Deploy to Railway.
3. **Week -1:** generate 30 claimant keypairs, pre-fund SOL + `SCRIP`, pre-compute all deterministic locks, hand the physical team the case/lockbox code sheet. Stage the Tempter's bribe transactions for Room 3. Ship the Probate Packet to claimants. Load-test 30 concurrent wallets against the RPCs.
4. **Day -1:** set physical locks to pre-computed codes; load the Room 3 Tempter's-ledger config; smoke-test every room end-to-end on venue network including RPC failover and the broadcast feeds.
5. **Show day:** marshals watch the ops dashboard for Mercy requests; protocol reps on standby for x402 and Pay.sh rooms; one operator owns the Executor Feed in case a template line needs suppressing live.

---

## Why the Estate (design rationale, one paragraph)

Every mechanic the show already had becomes plot instead of rule. The dropping prize pot is the will burning unclaimed money. The traitor room's pre-assigned corruption is the Tempter's ledger, provable on-chain at the reveal. The penalty economy has a character (the Actuary) whose itemised deductions turn every physical fail into a broadcast beat. The self-verification backbone — payment events observed by production bots, unlock codes derived from transactions — is no longer invisible infrastructure; it *is* the antagonist, an estate that pays, charges, tempts, and judges without a single human decision. The audience never needs to understand a protocol. They need to understand a will, three executors, and money on fire — and they already do.

---
SPEED BUILD 2026 — THE ESTATE — TECH BRIEF V1 — FOR DISCUSSION

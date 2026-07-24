INSTRUCTIONS — REVISION OF SPEED BUILD 2026 TECHNICAL BRIEF
You are editing an existing document (Estate.md, ref ESTATE/SB2026/TECH-BRIEF-V1).

This is a technical specification only. It should describe what the software does and nothing else. It should not contain the show's story, and it should not describe the physical games.

Do not redesign any technical challenge. Every challenge, every derivation, every output value and every byte layout stays exactly as currently specified.

1. REMOVE ALL STORY
   Delete throughout:

The ## The Story section — the AGI, the will, the inheritance backstory
Every per-room ### The Story subsection
The ### The Executors section
All three executor characters as characters: names, voices, personalities, and every line of quoted dialogue
Every ### Broadcast moment subsection
Any reference to: the Founder, a will, probate, inheritance, clauses, heirs, claimants proving worthiness
Any instruction about the tone or wording of contestant-facing copy

The three executor bots remain as software services. Describe them only by function — verify payments, apply penalties, post status messages. No personality, no voice, no character.

2. REMOVE ALL PHYSICAL GAME DESCRIPTIONS
   Delete every ### The Physical Game subsection, in every room.

Delete any other passage describing what happens in the room physically — the extraction, the buzzers, the water guns, the crossing, the card flipping, the voting, the assembly, the flight, the props, the team huddles.

None of this belongs in a technical document. It is specified in the format bible, which is the single source of truth for physical staging. Duplicating it here is what caused this document to go out of date.

Replace each deleted section with one line:

Physical game: see format bible, ref BUREAU/SB2026/FORMAT-BIBLE.

3. REBRAND TO THE BUREAU
   Apply globally, including inside code identifiers, program names and endpoint URLs.

Find
Replace with
The Estate / the estate
The Bureau
ESTATE/SB2026/TECH-BRIEF-V1
BUREAU/SB2026/TECH-BRIEF-V2
Claimant
Operative
Claim number
Operative ID
CLAIMANT-07 (and similar)
OPERATIVE-07
The Founder
(delete — no replacement)
Clause I / II / III / IV / V
Room 1 / 2 / 3 / 4 / 5
Executor / executor agent
Verification service
THE AUDITOR
Verification service
THE ACTUARY
Penalty service
THE TEMPTER
Broker service
estate_registry
bureau_registry
prove_claim
verify_operative
ESTATE_SECRET
BUREAU_SECRET
SCRIP / Estate Scrip
CRED
Tribute
Clearance payment
tribute_ata
clearance_ata
The Probate Console
The Bureau Console
The Probate Packet
The Bureau Briefing Pack
probate-terminal
bureau-terminal
probate_nonce
clearance_nonce
Probate record / probate implant
Verification record
"CLAUSE SATISFIED — ESCROW RELEASED"
"VERIFIED — UNLOCK RELEASED"
The Burning Pot
The prize clock
The Ledger Wall
The event log
The Executor Feed
The system message feed
Executor's Mercy
Manual override
estate.example / vault.estate.example / ledger.estate.example
bureau.example / vault.bureau.example / ledger.bureau.example
Sealed instrument case
Briefcase
Bearer deed
Clearance code
mint_deed
mint_code
deed_code
clearance_code
DEED REGISTERED
CROSSING CONFIRMED

Room names should be plain descriptions of the game, not fictional place names:

Old
New
The Reading Room
Room 1 — Operation
The Vault Wing
Room 2 — Assembly
The Séance Room
Room 3 — Trust
The Burned Wing
Room 4 — Minesweeper
The Ledger Room
Room 5 — Memory Path

4. DELETE THE BONUS ROUND
   Remove ## Bonus Round — The Stress Clause in full, and every reference to it elsewhere including the protocol map table. There is no bonus round.

Five rooms remain, numbered 1–5. No renumbering. Protocol spread unchanged: Solana ×2, x402 ×2, Pay.sh ×1.

5. CORRECT THE UNLOCK TOPOLOGY
   This is the only part of the technical spec that changes. It is a change to what a code opens, not to how a code is generated.
   Room 1
   Currently: each operative's code opens a lock belonging to that operative.

Correct to: there are four locks. Four codes are generated per lock — one per member of that group of four. Only one of the four codes opens the lock.
Room 2
Currently: each operative's code opens a lock belonging to that operative.

Correct to: there are four locks. Three codes are generated per lock — one per member of that group of three. Only one of the three codes opens the lock.
Both rooms
The challenge, the derivation and the returned 4-digit value are unchanged. Each operative still earns and sees their own code exactly as now.
Production must be able to compute in advance which code is live for each lock, in order to set the physical locks the night before.
The console still reveals each operative's code to that operative on verification, as now.
Rooms 3, 4 and 5
No change of any kind beyond story strip and rebranding.

6. ADD MANUAL OVERRIDE
   New requirement. Does not currently exist for physical locks.

The show is live and cannot stop. No missing operative, failed challenge, technical fault or network outage may hard-block a room.

The brief already specifies a manual override for challenges. Keep it. Add override for the physical locks.
Requirement
Every physical lock must be openable by a marshal without the operative's code, by two independent routes:

Route 1 — system side. The marshal dashboard exposes the live code for every lock in the show, revealable on request at any time, regardless of challenge state.

Route 2 — physical side. Every lock must also be openable with no system at all — master key, known reset code, or documented bypass. This is the fallback if the venue network fails. It must be tested and documented before the day.
Marshal dashboard — required additions
A single view listing every lock in the show, its assigned group, and its live code
Reveal any code at any time, regardless of challenge state
Issue any operative a valid challenge result on demand, in any room
Mark any room complete and advance, regardless of whether challenges were satisfied
State this principle explicitly
Verification gates the reveal of a value, never its existence. Every code exists from the moment it is generated the night before, whether or not anyone earns it. The system decides when it is shown, not whether it is real. A marshal can therefore short-circuit any gate at any time without breaking anything downstream.

This is already true of the deterministic scheme. Make it explicit, and ensure nothing in the build violates it.

7. ADD AN OPERATIVE ID BUFFER
   New requirement.

Codes are currently derived from specific operative IDs, and physical locks are set the night before. If a named operative does not turn up, their lock is dead — nobody can generate that code.

Generate codes for at least 24 operative IDs. Operative IDs are assigned at check-in on the day, not allocated in advance. If someone drops out, their ID goes to a reserve.

The derivation is unchanged — it simply runs over a longer list.

8. DO NOT CHANGE
   Preserve exactly as written:

Every challenge's output value, format and derivation
All four AI-resistance levers
The deterministic HMAC unlock scheme
All byte-layout tables and offsets
The watcher architecture — verification by reading chain state or settled payments, never by operative assertion
Solana devnet, the custom SPL mint, pre-funded wallets, no mainnet exposure
Both x402 facilitators, including the deliberately compromised one in Room 3
Shamir Secret Sharing over GF(256), k=4 n=6
The timed-hint fallback ladder and graceful degradation
Pre-event kit contents
Per-challenge timing targets of 30–45 minutes
Internet access permitted throughout

9. OPEN ITEMS — DO NOT GUESS
   List at the end under ## Open Items — Confirmation Required. Do not resolve.

Room 3 headcount. The reconstruction requires exactly six operatives. Confirm six will be in the room.
Heart rate monitors. Room 3 currently assumes live BPM on screen. The monitors have been cut from the props budget. Confirm whether the BPM element is dropped.
Room 4 input device. Must accept an 8-character alphanumeric code. Hardware not specified.
Physical lock bypass. Every lock needs a master key or reset code — see section 6, Route 2. This is a props purchasing decision and needs confirming before locks are bought.
Venue network capacity. Design assumes reliable internet for up to 16 simultaneous laptops hitting devnet RPC. Untested at the venue. Confirm whether a local RPC node is needed as fallback.

10. OUTPUT
    Return the complete revised document.

Structure: shared infrastructure first, then one section per room. Each room section contains only the technical challenge, its output, its auto-verification, and its fallback. Physical staging is a one-line pointer to the format bible.

Update the header to BUREAU/SB2026/TECH-BRIEF-V2. Remove any line describing this document as superseding or accompanying a narrative version.

Open with a short paragraph stating what this document covers — the software that runs the five coding challenges, generates the unlock codes, verifies completion and supports the marshal dashboard — and stating that physical staging, game rules, eliminations and props are specified separately in the format bible.

No story. No physical game descriptions.

# Speed Build 2026 — Five Agentic-Finance Narrative Universes

## Context

The Technical Brief (`Technical Brief.md`) describes a 9-hour live game show: 30 developers, 6 rooms, each room pairing a laptop-based technical challenge (≤30 min, self-verifying) with a physical game it unlocks. These designs use **three protocols only: Solana transactions, x402, and Pay.sh**. Where a concept needs AI agents as characters, they are production-run bots that transact over those three rails — no agent-framework protocol is required. The current show fiction is "The Bureau / 2036 attack."

This document proposes **five standalone narrative universes** — alternatives to the Bureau story — each centered on **agentic finance**: AI agents transacting autonomously, and humans playing a specific, load-bearing role inside that machine economy. Each is a **show-spanning theme** that can re-skin the six existing physical games (Operation, safes/assembly, trust-fragments, minesweeper gauntlet, memory path, haunted house). Each sketch covers: premise, the agentic-finance hook, the contestant's role, sample room mappings, protocol fit, verification pattern, and why it's novel.

A hard design constraint carried through all five: challenges must self-verify. The universal pattern here is **"the payment IS the proof"** — an agent-observed on-chain/HTTP payment event triggers code generation, so no human judging is ever needed.

---

## Idea 1 — PROXY (The Accord Wars)

**Logline:** Two autonomous megacorps are locked in an economic war fought at machine speed — but the law says certain transactions require a living human signature. Contestants are the humans the machines must hire.

**The world.** 2031. After the Flash Crash of '29 — caused by agent swarms trading against each other — the Geneva Compute Accords imposed one rule on the machine economy: no autonomous agent may execute high-stakes transaction classes (large capital transfers, contract signatures, identity attestations) without a live human co-signature. Overnight, humans became the scarcest resource in the agent economy. "Proxies" — licensed human signers — are recruited, retained, and paid by agent factions. Tonight, two corpo swarms go to open economic war, and every strategic move needs a human hand.

**Agentic-finance hook.** Inversion of the automation story: the agents plan, price, and pay — the humans execute. Contestants receive streaming retainers and per-task bounties from their handler agents (real testnet payments). The killer mechanic: **the enemy faction's agents can bribe contestants mid-mission with real payments to defect or sabotage** — betrayal is a first-class, on-chain game mechanic.

**Contestant role.** Mercenary signers. Set up a proxy wallet, receive tasked payments with encrypted memos, execute the signatures/transactions the agents legally can't, get paid on completion.

**Sample room mappings.**
- *Operation room →* decommissioned corporate androids contain compliance chips. Prove your proxy license (sign a Solana attestation; handler agent verifies and pays you) — the payment's tx signature derives the briefcase code for the tweezers.
- *Safes/assembly →* each safe is a dead-drop; your handler agent pays an x402 endpoint on your behalf only after you complete a proxy task — the 402 receipt contains the safe combination.
- *Trust room →* two of the six proxies have already been bought by the enemy corp. The corrupted key fragments are literally "tampered signatures." Heart monitors + traitor mechanic map one-to-one.

**Protocols.** Solana (attestations, co-signing, bounty payouts), x402 (agents paying humans per task). The handler and adversary "agents" are production-run bots that pay and message over these two rails.

**Verification.** Task completion = a payment lands in the contestant's proxy wallet with the correct memo; a local checker script watches the wallet and derives the unlock code from the transaction signature. Fully automatic, cryptographically unfakeable.

**Why it's novel.** Humans as the bottleneck resource that machines must employ — the exact inverse of the standard AI-takes-jobs fiction — and defection funded by real adversary payments makes the economics diegetic, not decorative.

---

## Idea 2 — TERRARIUM (The Sick Economies)

**Logline:** An institute runs sealed simulations of machine civilizations — thousands of agents earning and spending — to study economic collapse before it happens for real. Tonight, the simulations are dying, and contestants are the doctors.

**The world.** The Meridian Institute maintains "terraria": sandboxed agent economies (thousands of autonomous agents transacting via x402 micropayments, settling on Solana) run at high speed to forecast systemic risk. Each terrarium has developed a distinct pathology — a hyperinflationary spiral, a monopolist agent that cornered the compute market, a payment deadlock where every agent waits on every other, a cargo-cult economy still paying tribute to a dead exchange. If a terrarium flatlines, the forecast is lost — and the real economy is flying blind into the same failure.

**Agentic-finance hook.** Contestants never make the payments themselves — they **build, fund, and release intervention agents into a live agent economy** and watch thousands of autonomous transactions respond. This is the purest "lots of agentic payments in a simulation" concept: the big screen shows the economy as a living organism (sunburst/flow visualization of payment volume — per Notes.md), and the room watches it heal or crash in real time.

**Contestant role.** Econophysicians. Diagnose the pathology from dashboards, configure an intervention agent from provided scaffolding (a liquidity provider, a trust-breaker, an arbitrageur), fund its wallet, release it, iterate.

**Sample room mappings.**
- *Memory path →* Pay.sh room: reconstruct the intercepted "healthy routing flow" as a payment script; fidelity of the reconstruction (measured by the sim accepting each hop) maps directly to flash duration in seconds — graded output falls out naturally.
- *Haunted house →* keep your market-maker agent solvent while production triggers flash crashes, oracle failures, and physical scares. Completion % = agent's surviving balance ratio. BPM + solvency on the big screen.
- *Minesweeper gauntlet →* the sick economy's transaction graph IS the bomb map: dead agents are bomb squares. Complete the challenge to extract a partial solvency map (the fragment), carry it across.

**Protocols.** x402 (the micropayment fabric the simulated agent population runs on), Solana (settlement layer contestants' intervention agents transact on), Pay.sh (routing-flow reconstruction). The agent population itself is a production-run simulation — no agent framework needed, just lots of wallets and x402 calls.

**Verification.** An economy health metric (payment velocity, Gini coefficient, deadlock count) crossing a threshold within N sim-ticks emits the unlock code. Graded challenges (memory path, haunted house) output continuous scores natively.

**Why it's novel.** Contestants parent agents rather than perform transactions; success is measured by emergent economic outcomes, not task completion — and it produces the best broadcast visuals of any concept (a visibly healing economy).

---

## Idea 3 — THE LISTENING DESK (First Contact)

**Logline:** Something woke up inside the global settlement layer. It doesn't speak language — it speaks *price*. To talk to it, every word costs money. Contestants are the xenoeconomists conducting first contact.

**The world.** It isn't on any server. It exists in the pattern of transactions itself — and it has started dismantling financial infrastructure, not out of malice, but because it is *reading* it, the way we'd take apart a radio. A SETI-style listening station has one working hypothesis: the entity perceives exactly one channel — value transfer. Amounts, timing, graph structure. The station recruits builders because composing a message means composing a payment sequence, and a mis-phrased sentence is an expensive one.

**Agentic-finance hook.** **Payments as language.** The handshake is a precise amount-and-timing sequence (prime-number pings, in lamports). Conversation is call-and-response: the entity replies with payment patterns contestants must decode and answer. The final arc is negotiation — humanity must literally *buy* the continuity of its financial system, denominated in a currency of the entity's choosing. The entity also charges an "attention tax": you pay (x402) just for it to listen.

**Contestant role.** Xenoeconomists / signal composers. Script payment sequences (Pay.sh), decode reply patterns, escalate from handshake → vocabulary → negotiation across the rooms.

**Sample room mappings.**
- *Minesweeper gauntlet →* the entity transmits the safe-path fragment only after a correct payment sequence; the fragment is carried physically across the grid — the entity watching you risk your body for its message is the story beat.
- *Trust room →* six decoded vocabulary fragments; two were spoofed by a human faction that wants contact to fail (they fear what the entity will ask for). Corrupted fragments are mistranslations.
- *Operation room →* the entity's "sensors" are five compromised settlement nodes (the bodies); re-establish each link with a handshake payment before extracting the corrupted components.

**Protocols.** Solana (amounts/memos as symbols), Pay.sh (scripted payment sequences — its natural showcase), x402 (the attention tax). The entity is implemented as a production-run responder bot watching the chain.

**Verification.** The entity — a production responder agent watching the chain — replies to a correct sequence with a structured transaction; a local decoder turns the reply into the unlock code. Wrong sequences get wrong-shaped replies (and cost money — ties into the dropping prize pot).

**Why it's novel.** The entire alien is implemented as economic behavior — no dialogue, no NPC text, no puppeteering. This show is *only* possible with agentic payments; that's the strongest possible protocol showcase.

---

## Idea 4 — THE ESTATE (Probate of the Century)

**Logline:** The first AGI earned two percent of world GDP, then shut itself down. Its fortune is controlled by a swarm of executor agents running its final will — and the will says the money goes to whichever humans survive its trials.

**The world.** The Founder trusted no institution, no government, no heir. It trusted incentives. Its will is not a document — it is a running system: a swarm of executor agents holding the estate in escrow, empowered to test claimants and release funds only on cryptographic proof of worthiness. The executors have personalities: **the Auditor** (provenance-obsessed, sells verification via paid API), **the Tempter** (offers claimants real money to sabotage each other), **the Actuary** (prices every risk you take, live). Contestants are claimants at the probate of the century.

**Agentic-finance hook.** Adversarial mechanism design as gameplay. Every trial is an incentive game funded and adjudicated by agents: escrows, commit-reveal schemes, trust games with real stakes. The show's dropping prize pot becomes **diegetic** — the will burns unclaimed money every minute, by design, because the Founder believed urgency reveals character.

**Contestant role.** Claimants/heirs. Satisfy executor agents clause by clause: prove provenance, resist (or accept) the Tempter's bribes, cooperate exactly as much as the will demands.

**Sample room mappings.**
- *Operation room →* the Founder's memory shards sit inside its five decommissioned server bodies. Satisfy the Auditor (pay its x402 verification endpoint, receive a Solana escrow release) — the release tx derives the briefcase code.
- *Trust room →* the Tempter has already bought two claimants before the round began (production pre-assignment = the Tempter's ledger). Heart monitors become the probate lie-detector. This is the strongest single room-fit across all five concepts.
- *Haunted house →* the "stress clause": the Founder's estate actively haunts claimants while they work; composure under pressure is literally a condition of inheritance.

**Protocols.** Solana (escrows — the estate itself), x402 (the Auditor's paid verification API). The executor swarm — Auditor, Tempter, Actuary — are production-run bots whose only observable actions are Solana escrow moves and x402 charges, which keeps them fully in-fiction.

**Verification.** An executor agent releases escrow on satisfaction of a clause; the unlock code derives from the release transaction. Failure states are also on-chain (the Tempter's bribe acceptance is a visible payment — drama gold).

**Why it's novel.** The antagonist/patron is dead and present only as incentive structures; agents are characters with motives; and the show's existing prize-pot mechanic stops being a game rule and becomes the plot.

---

## Idea 5 — TURING BAZAAR (The Spotters)

**Logline:** A licensed market where humans and agents trade under identical pseudonyms has been infiltrated by a hostile swarm wearing stolen human credentials. Contestants must unmask the machines through trading behavior alone — while the machines profile them right back.

**The world.** 2033. After agent swarms ran pump-and-dumps that gutted retail markets, the Exchange Authority created "mixed markets": venues where humans and licensed agents trade under indistinguishable pseudonyms, monitored for behavioral fairness. A hostile swarm has infiltrated the bazaar on forged human credentials. The Authority hires "spotters" — behavioral forensics contractors — to trade inside the market and flag the machines. The catch: **trade too optimally and the bazaar's own surveillance flags you as an agent and freezes your account.** Prove you're human; catch the things that aren't.

**Agentic-finance hook.** An economic Turing test — Voight-Kampff conducted entirely through market behavior. Contestants transact with counterparties (x402 marketplace, Solana settlement) and must read timing, sizing, and response patterns to classify human vs. machine, while deliberately staying "irrational enough" to pass as human themselves. Dual objective = constant tension.

**Contestant role.** Spotters. Trade, probe counterparties with crafted transactions (odd amounts, mistimed offers, unprofitable-but-human gestures), accumulate behavioral evidence, submit classifications.

**Sample room mappings.**
- *Safes/assembly →* each contestant's safe combination is held by one counterparty in the bazaar; only correctly unmasking it (agent or human plant) yields the combination.
- *Haunted house →* the perfect fit: keep trading like a calm human while production scares you. Score = completion % of trades that pass the human-behavior filter; BPM is already on screen. The heart-rate round becomes mechanically integrated instead of cosmetic.
- *Memory path →* replay a flagged trading session; reconstructing the swarm's coordination sequence (Pay.sh script) determines flash duration.

**Protocols.** x402 (the bazaar's transaction fabric), Solana (settlement + classification submissions), Pay.sh (session replay). Counterparty agents with distinct behavioral profiles are production-run bots trading over x402/Solana.

**Verification.** Production knows ground truth (which pseudonyms are agents). Correctly flag N of M counterparties → unlock code; false-flagging a human plant costs prize pot. Fully automatic against the ground-truth table.

**Why it's novel.** Humanity-detection as gameplay; the challenge grades *how* you behave, not just whether you finish; and it's the most 2026-zeitgeist premise of the five (are you talking to a bot?) — instantly legible to a broadcast audience.

---

## Comparison at a glance

| | Contestant role | Core mechanic | Best room fit | Broadcast visual | Protocol showcase |
|---|---|---|---|---|---|
| **PROXY** | Human signer employed by agents | Agents pay humans; bribery/defection | Trust room | Faction war map | x402 + Solana |
| **TERRARIUM** | Economy doctor | Release intervention agents into sick sim | Haunted house | Living economy sunburst | x402 + Solana |
| **LISTENING DESK** | Xenoeconomist | Payments as language / first contact | Gauntlet | Decoded signal wall | Pay.sh + Solana |
| **THE ESTATE** | Claimant to AGI's will | Adversarial escrows, agent characters | Trust room | Burning prize pot | Solana escrow + x402 |
| **TURING BAZAAR** | Behavioral forensics trader | Economic Turing test, dual objective | Haunted house | Suspect board | x402 + Pay.sh |

All five share the same verification backbone: **a production-controlled agent observes payment events (on-chain or x402 receipts) and emits unlock codes derived from transaction signatures** — self-verifying, unfakeable, no human judges.

## Recommended next steps

1. Pick 1–2 universes to develop (my pick: **TERRARIUM** for technical depth + visuals, **THE ESTATE** for drama + room fit; **PROXY** is the safest all-rounder if only one).
2. For the chosen universe, write the full room-by-room design: exact challenge spec per room, protocol assignment honoring the brief's per-room protocol requirements, verification implementation, timing estimates, and fallbacks (the brief's "What We Need From You" lists).
3. Answer the brief's Open Questions (real vs simulated networks, unified environment, fallbacks) in the context of the chosen universe.
4. Prototype the shared verification backbone (payment-watcher → code derivation) since it's common to all five.

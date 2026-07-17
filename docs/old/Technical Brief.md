CLASSIFICATION: TECHNICAL TEAM ONLY
REF: BUREAU/SB2026/TECH-BRIEF-V1

SPEED BUILD 2026
Technical Challenge Brief
For the technical team — draft for discussion

What Is This
Speed Build 2026 is a live game show. It takes place on 25th July at Shoreditch Exchange in London. It runs for 9 hours and is broadcast live to the world.
Thirty people compete. They are developers of mixed ability. The last people standing split a $20,000 prize pot that drops every minute from the moment the show begins.

The Story
On October 3rd 2024, nine governments around the world received a transmission. It claimed to be from the year 2036. It was ignored — until it started predicting future events with terrifying accuracy.
Its final prediction: on October 16th 2036, an autonomous agent attack will cripple all human financial infrastructure. Payment rails severed. Settlement systems corrupted. The ability to move money — gone.
The attack cannot be stopped.
But in the hours that follow, there is a window. A window to rebuild. A window to fight back.
Thus, THE BUREAU was formed. Extrajudicial. Above the law. Tasked with recruiting the fastest builders alive to survive what is coming.
Speed Build 2026 is the simulation. The Bureau is running a 9-hour exercise to find the people who can rebuild financial infrastructure under sustained pressure. The contestants are the recruits. Every room is a mission. Every technical challenge is a real test of whether they have what it takes.
The technical challenges are woven directly into this story. Contestants are not told to complete a coding exercise. They are told they are fighting back. The challenge brief they receive is written in Bureau language. They do not see scaffolding — they see a mission.

Your Job
Each room in the show has a physical game inside it. Before contestants can play the physical game, they have to complete a technical challenge on their laptops. Completing the challenge unlocks the physical game — it generates a code, opens a lock, or reveals information they need to play.
Your job is to design and build those technical challenges. One per room. Each challenge must:
Take no longer than 30 minutes for a developer who has never seen the protocol before
Run on the contestant's own laptop with internet access
Verify itself automatically — when the challenge is complete, something happens on screen. A code appears, a sound plays, a signal fires. No human needs to judge it.
Use one of these protocols: Solana, x402, Pay.sh, CoralOS
Be framed inside the Bureau story — contestants should feel like they are doing something that matters, not completing a coding exercise

We are not prescribing what the technical challenge should be. That is your creative brief. What we are telling you is what each room looks like, what the physical game is, and what the challenge needs to unlock. You design the challenge that fits.

The Rooms

Room 1 — The Operation Room
PROTOCOL: SOLANA

The Story
Five Bureau field operatives were extracted from the field during the attack. They are unconscious. Their neural implants — the devices that carry fragmented copies of the last functioning global payment protocol — are corrupting. If the data inside the implants is not retrieved within the hour, it is lost forever.
The team are Bureau surgeons. But before they can operate, they need to re-establish the communication link to each implant. The implants are locked — they will only respond to a verified payment signal on the Solana network, proving the operator is a cleared Bureau agent.
That is the technical challenge. Prove you are cleared. Restore the link. Get your instruments. Save the operative.

The Physical Game
Think Operation — the board game. Five large boards in the room, each shaped like a human body. Inside each body are cavities containing small components. Contestants use metal tweezers to extract the components without touching the sides of the cavity. Touch the sides — buzzer fires, $50 off the prize pot, water gun. Fifteen contestants, 3 teams of 5, each team working on their own board. All in one room.

How the Technical Challenge Connects
Before a contestant can touch a board, they complete the technical challenge on their laptop. Completion generates a combination code. They use that code to open a locked briefcase on the wall. Inside the briefcase: the surgical tweezers they need to operate. No code, no tweezers, no game.

What the Challenge Needs to Do
Generate a unique combination code on successful completion.

What We Need From You
What the technical challenge actually is
How it runs on the contestant's laptop
How completion is verified automatically
How the combination code is generated and displayed
Estimated completion time for a developer unfamiliar with Solana
The fallback if someone cannot complete it

Room 2 — The Assembly Room
PROTOCOL: X402

The Story
The attack severed all Bureau communications at 03:47. Field operatives went dark. Command lost contact with every active unit simultaneously.
The Bureau has been building a parallel communications infrastructure — off the compromised global rails, running on the new payment protocols the attack did not anticipate. The components to rebuild the field comms device are locked in Bureau safes around the room.
But to access a safe, each operative must first prove they can transact on the new infrastructure. The Bureau does not hand equipment to people who cannot use the tools. Make the payment. Get the component. Build the device.

The Physical Game
Twelve safes around the room, one per contestant. Each safe contains one physical component — a wire, a circuit board, a connector. Together they build a Raspberry Pi-based comms device on a central assembly table. When all components are assembled and the Raspberry Pi is programmed correctly, the device activates. Bureau comms are restored.

How the Technical Challenge Connects
Complete the challenge, get the safe combination, open the safe, retrieve the component, bring it to the assembly table.

What the Challenge Needs to Do
Generate a unique combination code on successful completion.

What We Need From You
What the technical challenge actually is
How it runs on the contestant's laptop
How completion is verified automatically
How the combination code is generated and displayed
Estimated completion time for a developer unfamiliar with x402
The fallback if someone cannot complete it

Room 3 — The Encryption Room
PROTOCOL: CORALOS

The Story
Before the attack hit, the Bureau’s chief cryptographer fragmented the master encryption key — the one protecting the last copy of the global financial routing protocol — and distributed one fragment to each of six field operatives. No single person holds the full key. The key can only be reconstructed if the right combination of fragments is assembled.
But two of the operatives have been compromised. Their fragments have been corrupted by the attack. They look right. They are not.
The group has three attempts to submit the correct combination. Every wrong submission costs the Bureau money it cannot afford to lose. The team must figure out who to trust — while everyone’s heart rate is broadcast live on the big screen.

The Physical Game
Six contestants. Heart rate monitors on throughout — BPM live on screen for everyone. Each contestant’s technical challenge produces their key fragment. The group votes on which combination of fragments to submit. Three attempts. Wrong submission — fixed penalty. At the end, the two compromised operatives are revealed regardless of outcome.

How the Technical Challenge Connects
The challenge produces the key fragment the contestant contributes to the group. The fragments from four contestants combine correctly. The fragments from two contestants — pre-assigned by production — are corrupted. The corruption is baked into the challenge output for those two specific contestants.

What the Challenge Needs to Do
Produce a key fragment on completion. Four fragments combine correctly. Two fragments are pre-configured to be corrupted.

What We Need From You
What the technical challenge actually is
How it runs on the contestant's laptop
How the fragment is generated and displayed
How the two corrupted fragments are pre-configured — and how that is set up in advance by production
How the group submission interface works — inputting the combination and receiving pass/fail
Estimated completion time for a developer unfamiliar with CoralOS
The fallback if someone cannot complete it

Room 4 — The Gauntlet — Minesweeper
PROTOCOL: SOLANA

The Story
The Bureau has intercepted a fragment of the enemy's encryption key — the one locking the financial system. If the full key can be reconstructed, the attack can be reversed. But the fragment is trapped on one side of a hostile sector. The floor is compromised — one wrong step triggers a charge. The only way across is to never touch the floor.

The Physical Game
A large grid marked on the floor. Hidden bombs across the grid. The floor is lava — contestants cannot touch it at any point. Each team has two crates. That is all they have to get across.
They place one crate, stand on it, place the second crate in front, step onto that, retrieve the first crate, place it further ahead, and so on. Two crates, moving forward one step at a time, working out a path across the grid without landing on a bomb square.
If a crate is placed on a bomb square — water gun fires, back to the start. The group watches, shouts directions, and builds collective memory of where the bombs are across multiple failed attempts. The elimination audience and reaction room can see the full bomb map on a separate screen. The contestants cannot.

How the Technical Challenge Connects
The technical challenge runs on the laptop on the starting side of the grid. Completing it generates a fragment — a piece of information, a code, part of an encryption key. The contestant takes that fragment across the grid using the crates and inputs it into the laptop on the other side. Only when the fragment is successfully received on the far side does the crossing count.
Complete the challenge, get the fragment, carry it across on the crates, input it on the other side.

What the Challenge Needs to Do
Generate a fragment on successful completion that is then input into the receiving laptop on the far side of the grid to confirm a successful crossing.

Timing
15–30 minutes for a developer unfamiliar with the protocol.

What We Need From You
What the technical challenge actually is
How the fragment is generated and displayed on the starting laptop
How the receiving laptop on the far side accepts and verifies the fragment
Estimated completion time
The fallback if someone cannot complete it

Room 5 — The Intelligence Room — Memory Path
PROTOCOL: PAY.SH

The Story
Bureau analysts intercepted a payment routing sequence moments before the attack corrupted the network. The sequence is the safe path through the sector — a series of routing decisions, numbered 1 to 7, that leads to the recovery node. But the interception was partial. The full sequence is scrambled across a grid of encrypted cards.
The team must reconstruct the payment flow to unlock a preview of the route. The better the reconstruction, the longer they get to see the path before it disappears and they have to walk it from memory.

The Physical Game
A grid of face-down cards on the floor. A hidden path numbered 1 to 7. Contestants flip cards one at a time. Flip the right card — keep going. Flip the wrong card — step off, teammate steps on from card 1. The team builds collective memory across multiple attempts until someone makes it all the way through. The elimination audience and reaction room can see the full path. The contestants cannot.

How the Technical Challenge Connects
The team completes the technical challenge before the memory game begins. On completion, all cards flip face-up for a fixed number of seconds — a flash that lets them see the path before it disappears. Better completion — longer flash. Poor completion — shorter flash. No completion — they start blind.

What the Challenge Needs to Do
Output a duration in seconds that determines how long the cards stay face-up before the memory game begins.

What We Need From You
What the technical challenge actually is
How it runs on the contestant's laptop
How completion quality is measured and output as a duration in seconds
How that duration is communicated to the game operator who controls the card flip
Estimated completion time for a developer unfamiliar with Pay.sh
The fallback if the team cannot complete it

Bonus Round — The Haunted House
PROTOCOL: OPEN — NO SPECIFIC PROTOCOL REQUIRED

The Story
The Bureau has identified a psychological weakness in its recruits — the best builders freeze under unexpected pressure. The Haunted House is not a mission. It is an assessment. The Bureau needs to know who can keep their head when the environment is actively working against them.
There is no unlock. There is no prize. There is only the code, the scares, and the number on the screen showing everyone exactly how calm you are not.

The Physical Game
Contestants at laptops in a rigged room. At random intervals, things happen — a box opens, a sound fires, something moves. Bureau operatives trigger the scares. Heart rate monitors on throughout. BPM live on the big screen. Round ends after a fixed time.

How the Technical Challenge Connects
The challenge runs during the scare round. No unlock needed. Score is a combination of completion percentage and average BPM. Low heart rate plus high completion equals best score.

What the Challenge Needs to Do
Be completable in parts so partial completion can be scored at the end of the fixed time. Output a completion percentage. Heart rate data comes from the monitor system separately.

What We Need From You
What the technical challenge actually is — should be the most accessible challenge of the day
How partial completion is measured and scored
How the completion percentage is output at the end of the round
Estimated completion time at full pace for a generalist developer

Open Questions For You

These are the things we need your input on before we can finalise the brief:

Real vs simulated — where is it feasible and safe to run on a live network on the day, and where do we need a simulation? We want to show the genuine power of these protocols where possible.
Can one unified environment cover all rooms, or does each room need a separate setup?
What does a CoralOS agent simulation look like in practice?
Is a Pay.sh simulation environment available, or does it need to be built from scratch?
What is the fallback for each room if a contestant genuinely cannot complete the challenge?
Are there representatives from x402, Pay.sh, and CoralOS available on the day for technical support?
What should contestants receive in advance — documentation, a test environment, anything else — to give them a fighting chance with unfamiliar protocols?

SPEED BUILD 2026 — TECHNICAL BRIEF V1 — FOR DISCUSSION

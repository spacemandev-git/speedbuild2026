# Players Guide — The Estate

*A practical, out-of-fiction companion for claimants. The clause briefs speak in the
will's voice; this document tells you plainly what your machine is, what it can do, and how
to use it well under a nine-hour clock.*

Everything you build tonight runs against a **private Solana test network** with a token the
estate mints and pre-funds for you (`SCRIP`). Nothing touches mainnet, and nothing you can do
costs real money. The protocols are real; the stakes are theatrical.

---

## 1. What you are given

At check-in you receive:

- A **claim number** (e.g. `CLAIMANT-07`) — your identity for the whole show.
- **SSH access** to your own isolated Linux box (a container on the estate's server), reachable
  over the venue network on a port assigned to you.
- A **password** (and, if you sent one ahead, your SSH public key is already installed).

Your box comes with a pre-funded wallet, a full Solana / x402 / Pay.sh toolchain, and a local AI
coding assistant. You do **not** install anything to get started — it is all baked in.

### Connecting

```sh
ssh claimant@<estate-host> -p <your-port>
```

The floor marshals will give you `<estate-host>` (the server's venue IP or hostname) and
`<your-port>`. Every claimant logs in as the same Unix user, `claimant` — your *isolation* is that
you each have your own box, not your own username.

> **Recording notice.** Your interactive terminal is recorded (and may be streamed to the broadcast
> wall) for the duration of the show. File transfers (`scp`/`sftp`) and one-off remote commands
> (`ssh claimant@host -p PORT 'somecmd'`) are **not** recorded. This is expected and part of the
> production; it does not read your local machine, only what happens inside your estate box.

---

## 2. Your identity and wallet

Two environment variables define who you are. They are set for you at login:

| Variable | What it is |
|---|---|
| `CLAIM_NUMBER` | Your claim number. Nearly every clause endpoint and unlock code is keyed to it. |
| `ESTATE_API_KEY` | Your personal key for the estate's AI inference service (already wired into OpenCode). |

Check them any time:

```sh
echo "$CLAIM_NUMBER"
```

Your Solana wallet is at `~/.config/solana/id.json`, already funded with test SOL (for fees) and
`SCRIP` (the estate's currency, used for every tribute, fee, and payment). The Solana CLI is
pre-pointed at the estate's network — you do not configure an RPC:

```sh
solana address                 # your public key
solana balance                 # your SOL
spl-token accounts             # your SCRIP balance (and any other token accounts)
solana config get              # shows the RPC/WS the estate has set for you
```

Every verifier binds to *your* public key. A tribute or payment only counts when it comes from your
wallet — you cannot pay on someone else's behalf, and no one can pay on yours.

---

## 3. Your workspace and the clause briefs

Your home directory has an `~/estate/` folder:

```
~/estate/
  README.md            # orientation
  rooms/               # each room's brief appears here WHEN it is revealed to you
    room1/CLAUSE.md
    room2/CLAUSE.md
    ...
```

**A room's brief only exists after the estate reveals it to you.** When a room opens, its
`CLAUSE.md` appears under `~/estate/rooms/<room>/`. Read it first, every time.

### Live parameters — the clause endpoint

The briefs deliberately contain **no** deployment-specific values (program IDs, token mints, exact
endpoints, your personal nonce). Those are served live, keyed to your claim number:

```sh
curl "http://10.61.0.20:8700/clause/room1?claim=$CLAIM_NUMBER" | jq
```

This returns JSON with exactly what that room needs from you — the registry program, the RPC, the
`SCRIP` mint, and any per-claimant parameters. It returns `404` while a room is still sealed. **The
estate never publishes schemas.** You decode account layouts and wire formats from the byte hints in
the brief. That is the puzzle, by design.

---

## 4. The toolchain on your box

Everything you need is on `PATH`:

| Tool | For |
|---|---|
| `solana`, `spl-token` | Solana CLI + SPL token operations (pre-pointed at the estate RPC) |
| `anchor`, `cargo`, `rustc` | Build/deploy Anchor programs; Rust |
| `bun`, `node`, `npm` | Run TypeScript/JavaScript; `@solana/kit` / `web3.js` scripting |
| `pay` | The Pay.sh CLI (auto-pays 402-gated APIs from a sandbox wallet) — used in the Ledger Room |
| `jq` | Slice JSON responses (you will use this constantly) |
| `tmux` | Keep multiple panes / survive a flaky SSH connection |
| `git`, `vim`, `nano` | The usual |
| `opencode` | Your local AI coding assistant (next section) |

Recommended: **start every session in `tmux`** so a dropped connection doesn't kill a running
build or your assistant. Reconnect with `tmux attach`.

---

## 5. The AI assistant (OpenCode)

Your box ships with **OpenCode**, wired to the estate's own inference server. Start it from your
workspace:

```sh
cd ~/estate
opencode
```

It is preconfigured — no login, no API key to paste. It talks to the estate model over your
`ESTATE_API_KEY`, and it has a Solana MCP tool available for chain lookups.

### Use it well — and know its limits

The challenges are **specifically designed to resist being one-shotted by an AI**. An assistant that
you point at a clause and ask "solve this" will confidently produce plausible, *wrong* code — because
the puzzles hinge on things the model cannot guess: unlabeled byte layouts, a memo the standard SDK
omits, a nonce carried from the previous step, which of two brokers is honest. Treat the assistant as
a fast pair of hands, not an oracle.

What it is genuinely good for:

- **Boilerplate and mechanics** — "write a Bun script using `@solana/kit` that reads account
  `<pubkey>` and prints the raw bytes as hex."
- **Decoding help once you supply the layout** — paste the byte-offset table from the brief and the
  raw account bytes, and ask it to decode a little-endian u64 at a given offset.
- **Explaining tools you don't know** — the x402 402→pay→retry cycle, how to construct an SPL Memo
  instruction, what `pay curl` does.
- **Debugging** — paste the error, paste your code, ask what's wrong.

Where it will lead you astray if you're not careful:

- It will happily use the *standard* "send tokens" recipe that **omits the memo** a room requires.
- It will assume a schema/IDL exists when the whole point is that none is published.
- It doesn't know your live parameters — feed it the clause-endpoint JSON; don't let it invent
  program IDs or amounts.

**Performance:** the model is shared across every claimant on one CPU server. Under load it generates
a few tokens per second, and it can be bursty. Keep prompts tight, ask for one thing at a time, and
don't lean on it for long free-form essays — you're on a clock, and so is everyone else on the same
box.

---

## 6. How to approach each room

The rooms exercise different primitives; the shared discipline is: **read the brief, pull live
params from the clause endpoint, decode from bytes, chain each step's output into the next, and never
hardcode.** Concretely:

- **Solana decode-and-prove rooms (Reading Room, Burned Wing).** Derive the PDA with the *exact*
  seeds (watch case-sensitivity — claim numbers are lowercased in seeds). Fetch the account, decode
  it byte-by-byte from the offset table. The classic time sinks are **endianness** (a `u64` is
  little-endian) and **hashing raw bytes vs. the hex string** — get those right. Where a room wants a
  "tribute" or a `mint_deed`, the transaction must carry the **SPL Memo instruction in the same
  transaction** as the transfer/instruction. The standard SDK path usually leaves it out.

- **x402 payment rooms (Vault Wing, Séance Room).** The naive move — pointing `x402-fetch`/`x402-axios`
  at the URL — pays but omits the required memo, and the estate will *keep your fee and give you
  nothing*. Read the **response body**, not just the status code: a `200` can still say `SEALED`. To
  actually unseal, you hand-build the `X-PAYMENT` payload: construct the transfer *plus* the memo the
  `402` demanded, sign it, base64 the envelope yourself. Later hops compute their amount from a nonce
  carried in the previous response — never assume a fixed price.

- **The Séance Room's trust decision.** Two payment brokers are offered; one is flagged
  "integrity unverified." Paying through the compromised broker returns a fragment that *passes your
  local checksum but is poison*. **Self-settle** — build and submit the payment yourself, present the
  settled signature — to get the real share. There is no way for the assistant to tell you which
  broker is honest; read the flag and decide.

- **The Ledger Room (Pay.sh).** Run `pay setup` (an ephemeral sandbox wallet — nothing to fund),
  then `pay whoami`. The route is seven **content-addressed** nodes: you only learn the next node id
  from the current response, so you must actually traverse — there is no `/node/3`. Two positions
  carry a **decoy**; the `hint` field disambiguates. The natural solution is a small loop script
  (`pay curl` → parse `next` → apply the hint → follow the chain). A cleaner run earns a longer
  reveal.

- **The Stress Clause (bonus).** Small independent self-verifying tasks (a transfer, a paid call, a
  decode). Partial credit counts. It's the accessible round — bank what you can.

---

## 7. Getting unstuck

You are never meant to be permanently stuck, and asking for help is a real (sometimes costly)
in-game choice:

1. **Timed hints (codicils).** Each clause reveals more mechanical detail on a schedule — byte
   layouts, a worked formula with dummy values, skeleton code. They arrive on the clause page / the
   executor feed. They never hand you the answer, but they close the gap.
2. **The Executor's Mercy.** If you're truly blocked, a floor marshal can release your correct
   combination/deed from the ops console — but it is **priced against the burning pot and announced
   on screen**. Mercy is real and mercy is expensive; spend it deliberately.
3. **Team rooms degrade gracefully.** The group rooms (Séance, Ledger) resolve to a lower-tier
   outcome rather than halting the whole team on one stuck laptop.

---

## 8. Practical tips

- **Keep a scratch notes file** (`~/estate/notes.md`). You will carry values between steps
  (nonces, decoded pubkeys, deed codes) — write them down as you decode them.
- **Never hardcode.** Every value comes from the clause endpoint or a decoded account, and it is
  unique to you. A copied number from a neighbour or a hint's dummy value will silently fail.
- **Verify your reads before you pay.** Print the raw account bytes and confirm your decode against
  the offset table *before* spending a tribute — the estate does not explain rejected payments.
- **Reconnect-proof your work** with `tmux`. A nine-hour show on venue Wi-Fi will drop a connection.
- **Watch the response body.** Across every payment room, the failure mode is a `200`/settled
  payment that still didn't satisfy the clause. Read what the estate actually said.
- **Ask the assistant for tools, decide the strategy yourself.** The decisions — which broker, which
  node, whether the memo is present — are the parts it cannot do for you.

Good luck. Satisfy the executors.

# Players Guide — Speed Build 2026

This practical guide explains your participant box, identity, wallet, challenge briefs, tools, and
recovery options for the event.

Everything you build runs against Solana devnet with a pre-funded custom token (`CRED`). Nothing
touches mainnet, and nothing you do costs real money. The protocols and transactions are real; the
assets have no real-world value.

## 1. What you are given

At check-in you receive:

- An operative ID, such as `OPERATIVE-07`, used for the whole event.
- SSH access to an isolated Linux box, reachable over the venue network on an assigned port.
- A password. If you supplied an SSH public key in advance, it is already installed.

Your box includes a pre-funded wallet, the complete Solana/x402/Pay.sh toolchain, and a local AI
coding assistant. No installation is required to start.
A copy of this guide is pre-installed at `~/PLAYERS_GUIDE.md` on every box.

### Connecting

```sh
ssh operative@<host> -p <port>
```

Floor marshals provide `<host>` and `<port>`. Every participant logs in as the Unix user
`operative`; isolation comes from each participant having a separate box.

> **Recording notice.** Your interactive terminal is recorded and may be streamed to the event
> wall. File transfers (`scp`/`sftp`) and one-off remote commands such as
> `ssh operative@host -p PORT 'somecmd'` are not recorded. Recording covers only activity inside
> the participant box; it does not read your local computer.

## 2. Your identity and wallet

Two environment variables are set at login:

| Variable | What it is |
|---|---|
| `OPERATIVE_ID` | Your event identity. Challenge endpoints and result values are keyed to it. |
| `BUREAU_API_KEY` | Your personal key for the Bureau AI inference service, already configured in OpenCode. |

They are stored in `~/.bureau-env` and loaded into the login environment.

Check your ID at any time:

```sh
echo "$OPERATIVE_ID"
```

Your Solana wallet is at `~/.config/solana/id.json`, already funded with test SOL for fees and
`CRED` for challenge payments. The Solana CLI is preconfigured for the event RPC:

```sh
solana address
solana balance
spl-token accounts
solana config get
```

Every verifier binds to your public key. A transfer or payment counts only when it comes from your
wallet.

## 3. Your workspace and challenge briefs

Your home directory contains:

```text
~/bureau/
  README.md
  rooms/
    room1/BRIEF.md
    room2/BRIEF.md
    ...
```

A room's `BRIEF.md` appears in `~/bureau/rooms/<room>/` only after that room is revealed to you.
Read it first each time.

### Live parameters

Briefs omit deployment-specific values such as program IDs, token mints, exact endpoints, and
personal nonces. Pull the live values for your operative ID:

```sh
curl "http://10.61.0.20:8700/brief/room1?operative=$OPERATIVE_ID" | jq
```

The endpoint returns `404` until the room is revealed. Challenge schemas are intentionally not
published; decode account layouts and wire formats from the byte hints in `BRIEF.md`.

## 4. The toolchain on your box

Everything required is on `PATH`:

| Tool | Use |
|---|---|
| `solana`, `spl-token` | Solana CLI and SPL token operations, preconfigured for the event RPC |
| `anchor`, `cargo`, `rustc` | Anchor and Rust development |
| `bun`, `node`, `npm` | TS/JS and `@solana/kit`/`web3.js` programs |
| `pay` | Pay.sh CLI for x402-gated calls in Room 5 — Memory Path |
| `jq` | Parse and select JSON response data |
| `tmux` | Keep multiple panes and survive a dropped SSH connection |
| `git`, `vim`, `nano` | Standard development tools |
| `opencode` | Local AI coding assistant |

Start each session in `tmux` so a dropped connection does not terminate a build or assistant.
Reconnect with `tmux attach`.

## 5. The AI assistant

OpenCode is configured for the Bureau inference service. Start it from your workspace:

```sh
cd ~/bureau
opencode
```

No login or pasted key is required. It uses `BUREAU_API_KEY` and includes a Solana MCP tool for
chain lookups.

The challenges are designed around facts an assistant cannot infer: unlabeled byte layouts,
required memos omitted by convenience clients, state carried from one step to the next, and
trust/decoy decisions. Use the assistant as a fast implementation and debugging partner, not as
an answer source.

It is useful for:

- Generating focused boilerplate, such as reading an account and printing raw bytes.
- Decoding data after you provide the exact offset table and bytes.
- Explaining the x402 402→pay→retry cycle, SPL Memo instructions, or `pay curl`.
- Debugging when you provide the error, source, and live parameters.

Be careful when it:

- Uses a standard transfer recipe that omits the required SPL Memo instruction.
- Assumes an IDL or schema exists.
- Invents program IDs, amounts, or other live values instead of using the brief endpoint.

The model is shared across all participants on one CPU server. Under load it can generate only a
few tokens per second and may be bursty. Keep prompts focused and request one concrete task at a
time.

## 6. How to approach each room

Across every room: read `BRIEF.md`, pull live parameters from `/brief`, decode from bytes, feed
each step's output into the next, and never hardcode.

- **Room 1 — Operation.** Derive the verification-record PDA with the exact seeds and lowercase
  only the operative ID used in the `"claim"` seed. Decode the account from the offset table.
  Treat `u64` values as little-endian and hash raw nonce bytes, not the nonce's hex representation. The
  exact `CRED` transfer and required SPL Memo must be in the same transaction.

- **Room 2 — Assembly.** A convenience x402 client can pay while omitting the required memo.
  Read the response body: HTTP `200` may still report `SEALED`. Hand-build the `X-PAYMENT`
  envelope containing the transfer and memo, sign and base64-encode it, then carry the returned
  nonce into the second hop and compute that hop's amount rather than assuming a fixed price.

- **Room 3 — Trust.** FAC-A is marked `integrity unverified`; a payment through it returns a
  checksum-valid poison fragment. Self-settle by building and submitting the payment yourself,
  then present the settled signature. Decrypt the response with SHA-256 counter-mode XOR and
  verify its CRC before submitting it for reconstruction.

- **Room 4 — Minesweeper.** This is per-operative. Decode `registrar_key` from the
  `OperativeHoldings` PDA.
  The `mint_code` transaction needs both that pubkey as the first remaining account and the
  lowercase-hex memo in the same transaction. The stored `issued_slot` is little-endian, the code
  has an expiry window, and the presentation endpoint is one-shot.

- **Room 5 — Memory Path.** Run `pay setup`, then `pay whoami`. The seven-node route is
  content-addressed: only the current response reveals the next ID, so `/node/3` does not exist.
  Include `?operative=` on every request. Write a small loop around `pay curl`, parse `next`, and
  follow it. Decoys occur at positions `{3,6}`; use the hint and follow the real `n_` node rather
  than the purchasable `d_` decoy.

## 7. Getting unstuck

1. **Timed hints.** Each brief releases more mechanical detail on a schedule: byte layouts,
   worked formulas with dummy values, and skeleton code. Hints narrow the problem without giving
   you the final answer.
2. **Manual override.** If you are blocked, a marshal can release your correct code from the
   console. It is priced against the prize clock and announced.
3. **Participants remain independent.** One blocked laptop does not stop anyone else's progress
   or result. Every operative can continue and receive an individual output.

## 8. Practical tips

- Keep a scratch file such as `~/bureau/notes.md` for nonces, decoded pubkeys, codes, and other
  values carried between steps.
- Never hardcode. Live values come from the brief endpoint or decoded chain state and are unique
  to your operative ID.
- Print raw account bytes and validate your decode against the offset table before making a
  payment.
- Use `tmux` so a venue-network drop does not terminate your work.
- Read response bodies. A settled payment and HTTP `200` can still mean the challenge condition
  was not satisfied.
- Ask the assistant for implementation help; make the trust, memo, and decoy decisions yourself.

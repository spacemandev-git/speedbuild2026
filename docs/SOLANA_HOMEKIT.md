# Solana Home Kit — everything you need to satisfy the executors

*Study material for claimants. This teaches the Solana primitives the rooms actually exercise —
reading raw account bytes, deriving PDAs, and building transactions that carry exactly the right
transfer **and** memo — using the tools already on your box. It teaches the **tools**, never the
puzzles: no clause is solved here, but nothing in a clause should be unfamiliar after you read this.*

You are working against a **private Solana test network** (a `surfpool` validator the estate runs).
It behaves exactly like real Solana. Your CLI is already pointed at it; your wallet is already
funded. Nothing here touches mainnet or real money.

If you have never used Solana: read §1–§6 in order. If you have, skim to §5 (reading bytes), §6
(PDAs), and §11 (the pitfalls checklist) — that is where the rooms live.

---

## 1. The mental model in five sentences

1. **Everything is an account** — your wallet, a token balance, a program's state — a blob of bytes
   at an address, owned by some program.
2. **Programs are stateless code**; they read and write *other* accounts passed into each call.
3. **You act by sending a transaction**, which is an ordered list of **instructions**, each naming a
   program, the accounts it touches, and a byte payload of arguments.
4. **Addresses are 32-byte ed25519 public keys**, shown as base58 — either a keypair you hold, or a
   **PDA** (a deterministic address derived from a program + seeds, which no private key controls).
5. **You prove identity by signing** with your keypair; the network and the estate's watchers verify
   what actually landed on-chain — never what you claim.

Keep this frame in mind: most of a challenge is *reading an account's bytes correctly* and then
*building one transaction that does exactly what a clause demands* — usually a transfer plus a memo,
together.

---

## 2. Your environment (already set up)

Your Solana CLI is pre-pointed at the estate network — do not reconfigure the RPC.

```sh
solana config get          # shows RPC (http://10.61.0.20:8899), WS, and your keypair path
solana address             # your wallet's public key (base58)
solana balance             # your SOL (for transaction fees)
solana account <PUBKEY>    # dump any account's metadata + data
```

| Thing | Value on your box |
|---|---|
| RPC endpoint | `http://10.61.0.20:8899` |
| WebSocket | `ws://10.61.0.20:8900` |
| Your keypair | `~/.config/solana/id.json` |
| Your token balances | `spl-token accounts` |

For anything the CLI can't do (custom decoding, building an instruction by hand), you drop into
JavaScript/TypeScript with **Bun**. Set up a scratch project once:

```sh
mkdir -p ~/estate/scratch && cd ~/estate/scratch
bun init -y
bun add @solana/web3.js @solana/spl-token @solana/spl-memo
# @solana/kit (the modern successor to web3.js) is also available if you prefer it:
# bun add @solana/kit
```

Examples below use `@solana/web3.js` because its `Transaction` / `TransactionInstruction` /
`PublicKey` classes map one-to-one onto the concepts the rooms test. `@solana/kit` does the same
things with a functional API — either is fine.

---

## 3. Keypairs, addresses, and units

- A **keypair** is an ed25519 private+public pair. Your wallet file `id.json` is a JSON array of 64
  bytes (secret + public). Load it in code:

  ```ts
  import { Keypair } from "@solana/web3.js";
  import { readFileSync } from "fs";
  const secret = Uint8Array.from(JSON.parse(readFileSync(process.env.HOME + "/.config/solana/id.json", "utf8")));
  const me = Keypair.fromSecretKey(secret);
  console.log(me.publicKey.toBase58());
  ```

- A **public key / address** is 32 bytes, displayed as **base58** (no `0`, `O`, `I`, `l`). In code a
  `PublicKey` wraps those 32 bytes: `pk.toBytes()` gives the raw bytes, `pk.toBase58()` the string.
- **SOL** is measured in **lamports** (1 SOL = 1,000,000,000 lamports). SOL only pays fees here.
- **SPL tokens** (like the estate's `SCRIP`) have their own **decimals**. Amounts on-chain are always
  in **base units** (the smallest integer unit). If a token has 6 decimals, `1.5` tokens = `1_500_000`
  base units. **The rooms always specify amounts in base units — send the integer, do not scale it.**

---

## 4. SOL vs SPL tokens, mints, and ATAs

This matters because most "payments" in the rooms are **SPL token transfers**, not SOL.

- A **mint** is the token's definition (e.g. the `SCRIP` mint address, given by the clause endpoint).
- You don't hold tokens "in your wallet" directly — you hold them in an **Associated Token Account
  (ATA)**: a PDA derived from `(your wallet, the mint)`. One ATA per owner per mint.
- The clue this trips people on: when a clause says "send `SCRIP` to `tribute_ata`," the **recipient
  is already a token account** — you transfer from *your* ATA to *that* ATA.

```sh
spl-token accounts                 # your token accounts and balances
spl-token address --token <MINT>   # your ATA for a given mint
```

Derive an ATA in code:

```ts
import { getAssociatedTokenAddress } from "@solana/spl-token";
const myAta = await getAssociatedTokenAddress(mint, me.publicKey);
```

Standard program addresses you will reference (the same everywhere, loaded on the estate net):

| Program | Address |
|---|---|
| SPL Token | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` |
| Associated Token Account | `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL` |
| SPL Memo | `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr` |

---

## 5. Reading raw account bytes — the core skill

The estate publishes **no IDL and no schema**. Every Solana room hands you a byte-offset table and
expects you to decode the account yourself. This is the single most important skill; practice it.

Fetch an account's raw data:

```ts
import { Connection, PublicKey } from "@solana/web3.js";
const conn = new Connection("http://10.61.0.20:8899", "confirmed");
const info = await conn.getAccountInfo(new PublicKey(addr));
const data = info!.data;          // a Buffer of raw bytes
console.log(data.length, data.toString("hex"));
```

Or from the CLI: `solana account <PUBKEY> --output json` includes the base64 data.

### Decoding the field types the rooms use

Given a `Buffer data` and an offset table, decode each field by its type. An **Anchor account** always
starts with an 8-byte discriminator you skip.

```ts
// offset 0..8   : Anchor discriminator — SKIP, it is not your data.

// Pubkey (32 bytes) — e.g. offset 8..40:
const somePubkey = new PublicKey(data.subarray(8, 40));   // .toBase58() to print

// u8 (1 byte) — e.g. a status/flag at offset 40:
const status = data.readUInt8(40);

// u64 (8 bytes, LITTLE-ENDIAN) — e.g. a nonce at offset 41..49:
const nonce = data.readBigUInt64LE(41);   // returns a BigInt; note LE

// bool (1 byte, 0/1):
const presented = data.readUInt8(n) === 1;

// [u8; 8] fixed byte array (e.g. an 8-char code):
const code = data.subarray(x, x + 8);      // raw 8 bytes

// Anchor String: 4-byte LE length prefix, then that many UTF-8 bytes:
const len = data.readUInt32LE(p);
const s = data.subarray(p + 4, p + 4 + len).toString("utf8");
```

**Endianness is where people lose 20 minutes.** Multi-byte integers on Solana are **little-endian**.
`readBigUInt64LE` reads them correctly; `readBigUInt64BE` (big-endian) gives a wildly wrong number
that *looks* like a plausible value — and the estate won't tell you it's wrong. If a derived amount
or hash never verifies, suspect endianness first.

> Anchor lays fields out **in declaration order, packed, right after the 8-byte discriminator** —
> no padding between fields. The offset table in a clause is exactly this packing. Decode strictly in
> order; a wrong width on an early field shifts every field after it.

---

## 6. Program Derived Addresses (PDAs)

A **PDA** is an address computed from a program ID and a list of **seeds** — deterministic, and
controlled by the program, not a private key. The rooms use PDAs to locate *your* record: "your
probate record was written before you arrived; find it."

```ts
import { PublicKey } from "@solana/web3.js";
const [pda, bump] = PublicKey.findProgramAddressSync(
  [Buffer.from("claim"), Buffer.from("claimant-07")],   // seeds, in exact order
  programId,
);
```

The seeds must match **byte-for-byte** what the program used. The room-specific gotchas:

- **Seed order matters** and is fixed by the clause (e.g. a literal string tag then your identifier).
- **Encoding matters** — a string seed is its UTF-8 bytes; a pubkey seed is its 32 raw bytes
  (`pk.toBytes()`), not its base58 text.
- **Case matters.** If a clause says the seed is the *lowercased* claim number, lowercase it before
  `Buffer.from(...)`. `CLAIMANT-07` and `claimant-07` are different bytes and derive different PDAs.

Get a PDA wrong and you'll fetch a non-existent account (a `null` from `getAccountInfo`) or the wrong
one. When a fetch comes back empty, re-check your seeds before anything else.

---

## 7. Building a transaction: an instruction (or two) that lands together

A transaction is one or more instructions, signed and sent. The rooms frequently require **two
instructions in the same transaction** — most commonly a **token transfer plus an SPL Memo** — and
the verifier only accepts them when they arrive *together*.

### An SPL token transfer

```ts
import { createTransferInstruction } from "@solana/spl-token";
const ix = createTransferInstruction(
  sourceAta,        // your ATA for the mint
  destAta,          // the recipient token account (e.g. a tribute ATA from a decoded record)
  me.publicKey,     // owner/authority of the source ATA (you)
  amountBaseUnits,  // an integer in base units — do NOT scale by decimals
);
```

### An SPL Memo instruction

The Memo program takes **arbitrary UTF-8 bytes as its instruction data** and no accounts (or just the
signer). Its whole job is to attach a note that the estate's watchers read back.

```ts
import { createMemoInstruction } from "@solana/spl-memo";
const memoIx = createMemoInstruction("the exact memo string the clause demands", [me.publicKey]);
// Or build it by hand — same thing:
// new TransactionInstruction({
//   programId: new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"),
//   keys: [{ pubkey: me.publicKey, isSigner: true, isWritable: false }],
//   data: Buffer.from(memoString, "utf8"),
// });
```

### Sending both in one transaction

```ts
import { Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
const tx = new Transaction().add(ix).add(memoIx);   // BOTH instructions, one transaction
const sig = await sendAndConfirmTransaction(conn, tx, [me]);
console.log("signature:", sig);
```

> **Why this is a trap in the rooms:** the off-the-shelf "send tokens" helper builds a transaction
> with *only* the transfer. The clause requires the memo in the same transaction. If you use the
> convenient one-liner, your payment settles, the estate keeps it, and nothing unlocks — with no
> error explaining why. Whenever a clause names a memo, you are building the transaction yourself so
> the memo rides along.

### Confirming and inspecting what landed

```sh
solana confirm -v <SIGNATURE>      # status + logs for a transaction
solana transaction-history <PUBKEY>
```

Watchers confirm by *reading the chain*, so give confirmation a moment before assuming failure — a
transaction is real once it's confirmed at your commitment level.

---

## 8. Calling a custom (Anchor) program instruction by hand

Room 4 asks you to *invoke* an instruction on the estate's `estate_registry` program (not just
transfer tokens). Two ways:

**With Anchor's client**, if you reconstruct the interface — but no IDL is published, so the more
reliable path for a single instruction is often to build it raw.

**By hand**, an instruction is: the program ID, an ordered list of account metas, and a data buffer.
For an Anchor instruction the data buffer is:

```
[ 8-byte discriminator ] ++ [ borsh-encoded arguments ]
```

The **discriminator** for an Anchor instruction named `foo` is the first 8 bytes of
`sha256("global:foo")`:

```ts
import { createHash } from "crypto";
const disc = createHash("sha256").update("global:mint_deed").digest().subarray(0, 8);
```

Then append the arguments in declared order using their Borsh encoding (a `String` is a 4-byte LE
length + UTF-8 bytes; a `[u8;32]` is the 32 raw bytes; a `u64` is 8 LE bytes). Assemble the
instruction:

```ts
import { TransactionInstruction } from "@solana/web3.js";
const ix = new TransactionInstruction({
  programId,
  keys: [
    // the accounts the instruction reads/writes, IN THE ORDER THE PROGRAM EXPECTS,
    // each with correct isSigner / isWritable flags. "Extra" / remaining accounts
    // (e.g. a required registrar key, or the Instructions sysvar) go here too.
    { pubkey: somePda, isSigner: false, isWritable: true },
    { pubkey: me.publicKey, isSigner: true, isWritable: true },
    // ...
  ],
  data: Buffer.concat([disc, /* borsh args */]),
});
```

Two mechanisms the rooms lean on here:

- **Remaining / extra accounts.** An instruction may require an account beyond the obvious ones (e.g.
  a registrar key that must "witness" the call). Pass it in the `keys` array — omit it and the program
  rejects the call without explanation.
- **The Instructions sysvar (`Sysvar1nstructions1111111111111111111111111`).** A program can inspect
  the *other* instructions in the same transaction. That's how a program enforces "there must be a
  Memo instruction in this transaction carrying this exact data" — it reads the sysvar and checks.
  When a clause requires an in-transaction memo alongside a program call, include both the memo
  instruction **and** (if the layout calls for it) the Instructions sysvar account.

You don't need to memorize Borsh — the concepts (discriminator, ordered account metas, extra
accounts, the Instructions sysvar) are what the rooms test. Have the AI assistant generate the
encoding boilerplate once you've told it the exact instruction name, arguments, and account order.

---

## 9. Hashing and encoding you'll need

The rooms bind values together with hashes and encodings. Get the **input bytes** right — this is the
second-most-common silent failure after endianness.

- **sha256** over **raw bytes**, not text. A frequent mistake: hashing the *hex string* `"a1b2..."`
  instead of the raw bytes it represents. When a formula says `sha256(utf8(x) || nonce_LE_bytes)`,
  concatenate the **UTF-8 bytes of `x`** with the **8 little-endian bytes of the nonce**, then hash:

  ```ts
  import { createHash } from "crypto";
  const nonceBuf = Buffer.alloc(8);
  nonceBuf.writeBigUInt64LE(nonce);
  const h = createHash("sha256").update(Buffer.concat([Buffer.from(claim, "utf8"), nonceBuf])).digest();
  const first16Hex = h.toString("hex").slice(0, 16);   // when a clause wants "first 16 hex chars"
  ```

- **hex** ↔ bytes: `Buffer.from(hex, "hex")` and `buf.toString("hex")`. "Lowercase hex" means
  `.toString("hex")` (already lowercase) — don't uppercase it.
- **base58**: address text. `bs58.encode(bytes)` / `new PublicKey(bytes).toBase58()`.
- **base64**: used for serialized transactions and payment envelopes. `buf.toString("base64")`.
- **XOR** (byte-wise): appears when a value is masked with a hash — `out[i] = a[i] ^ b[i]`.

`||` in a clause always means **byte concatenation**, in the exact order written.

---

## 10. Watching the chain (optional but useful)

Rooms verify by watching accounts/transactions, and you can watch too — to confirm your own payment
landed before you assume it failed:

```sh
solana account <TRIBUTE_ATA>                 # re-read a token account's balance after paying
solana confirm -v <SIGNATURE>                # did my transaction actually succeed?
```

In code you can subscribe over the WebSocket (`onAccountChange`, `onLogs`) but for a claimant, polling
`getAccountInfo` / `getSignatureStatus` a couple of times is simpler and enough.

---

## 11. The pitfalls checklist — read this before every Solana room

Nearly every failed attempt is one of these, and the estate **never tells you which**:

- [ ] **Endianness.** `u64`/`u32` are **little-endian** (`readBigUInt64LE`). Big-endian gives a
      plausible-but-wrong number.
- [ ] **Hashing hex string vs. raw bytes.** Hash the raw bytes a formula describes, not their hex text.
- [ ] **Nonce as bytes.** "nonce as 8 LE bytes" = `writeBigUInt64LE` into an 8-byte buffer, then
      concatenate — not the decimal string.
- [ ] **PDA seeds:** exact order, exact encoding (UTF-8 for strings, 32 raw bytes for pubkeys), and
      **case** (lowercase when told to). Empty `getAccountInfo` = suspect the seeds.
- [ ] **Base units, not decimals.** Send the integer amount the clause states; never multiply by
      `10^decimals` yourself if the value is already in base units.
- [ ] **The memo must ride in the same transaction** as the transfer/call. The convenient SDK helper
      omits it. Build the transaction yourself.
- [ ] **Right recipient account.** A `tribute_ata` is already a token account — transfer to *it*, not
      to a wallet address.
- [ ] **Extra accounts + Instructions sysvar** for program calls that demand a witness/memo. Missing
      them = silent rejection.
- [ ] **Confirm before concluding failure.** Give a transaction a moment to confirm and re-read state.
- [ ] **Decode strictly in order.** A wrong field width early shifts every later offset.

---

## 12. Quick reference

**CLI**

```sh
solana config get                       # RPC, keypair
solana address / solana balance         # your pubkey / SOL
solana account <PUBKEY> --output json   # raw account data (base64)
solana confirm -v <SIG>                 # transaction result + logs
spl-token accounts                      # your token balances
spl-token address --token <MINT>        # your ATA for a mint
```

**JS/TS (`@solana/web3.js`)**

```ts
new Connection(url).getAccountInfo(pk)          // fetch bytes
PublicKey.findProgramAddressSync(seeds, prog)   // derive a PDA
data.readBigUInt64LE(off)                       // decode a u64 (LE!)
new PublicKey(data.subarray(a, b))              // decode a Pubkey
new Transaction().add(ix1).add(ix2)             // multiple instructions, one tx
sendAndConfirmTransaction(conn, tx, [signer])   // sign + send
```

**Program addresses:** SPL Token `Tokenkeg…`, ATA `AToken…`, Memo `MemoSq4…`, Instructions sysvar
`Sysvar1nstructions1111111111111111111111111`.

---

## 13. Using the AI assistant with this kit

The assistant on your box (`opencode`) is excellent at turning the concepts above into working code —
*once you supply the facts it cannot guess.* Good prompts:

- "Write a Bun script using `@solana/web3.js` that reads account `<pubkey>` from
  `http://10.61.0.20:8899` and prints its data as hex."
- "Given this byte-offset table `<paste>` and this hex `<paste>`, decode each field. u64 is
  little-endian."
- "Build a transaction with an SPL token transfer of `<N>` base units from `<ata>` to `<ata>` **and**
  an SPL Memo instruction with data `<string>`, signed by my keypair, and send it."

What it will get wrong if you let it: it defaults to the memo-less transfer helper, it assumes an IDL
exists, and it invents amounts/addresses. Feed it the clause-endpoint JSON and the byte table; make
the **decisions** yourself. The primitives in this kit are exactly the parts the puzzles are built to
stop an assistant from doing for you — which is why knowing them is the edge.

Satisfy the executors.

/**
 * Fund claimant wallets and initialize exact registry ClaimRecord/ClaimHoldings PDAs.
 * Usage: bun run src/30-fund-and-seed.ts [claimants.json] [--help]
 */

import { createHmac } from "node:crypto";
import { BN, type Program } from "@coral-xyz/anchor";
import {
  getOrCreateAssociatedTokenAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import {
  cheatcode,
  claimPda,
  connection,
  errorMessage,
  holdingsPda,
  isHelpRequest,
  loadKeypair,
  loadRegistryProgram,
  SCRIP_MINT_PATH,
} from "./lib";

interface ClaimantInput {
  claimNumber: string;
  pubkey: string;
}

interface SeedInput {
  claimants: ClaimantInput[];
}

interface StoredMint {
  address: string;
  secretKey: number[];
}

function validateInput(value: unknown): SeedInput {
  if (!value || typeof value !== "object") {
    throw new Error("seed input must be a JSON object");
  }
  const candidate = value as Partial<SeedInput>;
  if (!Array.isArray(candidate.claimants)) {
    throw new Error('seed input must contain a "claimants" array');
  }
  if (Object.keys(value).some((key) => key !== "claimants")) {
    throw new Error('seed input may contain only a "claimants" array');
  }
  for (const claimant of candidate.claimants) {
    if (
      !claimant ||
      typeof claimant.claimNumber !== "string" ||
      typeof claimant.pubkey !== "string" ||
      claimant.claimNumber.length === 0 ||
      Buffer.byteLength(claimant.claimNumber, "utf8") > 16
    ) {
      throw new Error("each claimant needs claimNumber (1..16 UTF-8 bytes) and pubkey");
    }
  }
  return candidate as SeedInput;
}

function estateSecret(): Buffer {
  const encoded = process.env.SB_ESTATE_SECRET;
  if (!encoded || encoded.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(encoded)) {
    throw new Error("SB_ESTATE_SECRET must be a non-empty even-length hex string");
  }
  return Buffer.from(encoded, "hex");
}

function probateNonce(secret: Buffer, claimNumber: string): bigint {
  const digest = createHmac("sha256", secret)
    .update(Buffer.from(`${claimNumber}nonce`, "utf8"))
    .digest();
  return digest.readBigUInt64LE(0);
}

async function loadMint(): Promise<PublicKey> {
  const path = SCRIP_MINT_PATH;
  if (!(await Bun.file(path).exists())) {
    throw new Error(`${path} is missing; run 10-mint-scrip.ts first`);
  }
  const stored = (await Bun.file(path).json()) as Partial<StoredMint>;
  if (typeof stored.address !== "string") {
    throw new Error(`${path} does not contain a SCRIP mint address`);
  }
  return new PublicKey(stored.address);
}

async function seedClaimant(
  program: Program,
  mint: PublicKey,
  tributeAta: PublicKey,
  secret: Buffer,
  claimant: ClaimantInput,
): Promise<void> {
  const owner = new PublicKey(claimant.pubkey);
  await cheatcode("surfnet_setAccount", [
    owner.toBase58(),
    {
      lamports: 100 * LAMPORTS_PER_SOL,
      // surfpool's cheatcode parses bare hex (no 0x prefix); a plain wallet has
      // no account data, so send an empty hex string.
      data: "",
      owner: "11111111111111111111111111111111",
      executable: false,
      rentEpoch: 0,
    },
  ]);
  await cheatcode("surfnet_setTokenAccount", [
    owner.toBase58(),
    mint.toBase58(),
    // 100 SCRIP at 6 decimals — headroom for tributes, fees, and node payments
    // across all five paid rooms plus bonus tasks.
    { amount: 100_000_000 },
    TOKEN_PROGRAM_ID.toBase58(),
  ]);

  const record = claimPda(program.programId, claimant.claimNumber);
  if (await connection.getAccountInfo(record, "confirmed")) {
    console.log(`Claim ${claimant.claimNumber} already initialized at ${record}`);
    return;
  }

  const nonce = probateNonce(secret, claimant.claimNumber);
  const initClaim = program.methods.initClaim;
  if (!initClaim) {
    throw new Error("Registry IDL does not define the init_claim instruction");
  }
  // The program derives the claim PDA from lowercase(claim_number) (Room 1 spec).
  // Anchor's client would auto-resolve it from the raw argument, which diverges
  // for mixed-case claim numbers, so pass the lowercased PDA explicitly.
  const claim = claimPda(program.programId, claimant.claimNumber);
  const signature = await initClaim(claimant.claimNumber, new BN(nonce.toString()))
    .accounts({ claim, tributeAta })
    .rpc();
  console.log(`Initialized claim ${claimant.claimNumber} (${signature})`);
}

async function seedClaimHoldings(
  program: Program,
  claimant: ClaimantInput,
): Promise<void> {
  const holdings = holdingsPda(program.programId, claimant.claimNumber);
  if (await connection.getAccountInfo(holdings, "confirmed")) {
    console.log(
      `Claim holdings ${claimant.claimNumber} already initialized at ${holdings}`,
    );
    return;
  }

  const initClaimHoldings = program.methods.initClaimHoldings;
  if (!initClaimHoldings) {
    throw new Error(
      "Registry IDL does not define the init_claim_holdings instruction",
    );
  }
  const signature = await initClaimHoldings(
    claimant.claimNumber,
    new PublicKey(claimant.pubkey),
  ).rpc();
  console.log(
    `Initialized claim holdings ${claimant.claimNumber} (${signature})`,
  );
}

async function main(): Promise<void> {
  if (isHelpRequest()) {
    console.log(
      "Usage: bun run src/30-fund-and-seed.ts [claimants.json]\n" +
        "Default: /var/lib/estate/claimants.json. Creates an empty skeleton when absent.",
    );
    return;
  }

  const inputPath = process.argv[2] ?? "/var/lib/estate/claimants.json";
  const inputFile = Bun.file(inputPath);
  if (!(await inputFile.exists())) {
    await Bun.write(inputPath, '{\n  "claimants": []\n}\n');
    console.log(`Created empty seed skeleton at ${inputPath}; nothing to seed yet.`);
    return;
  }

  const input = validateInput(await inputFile.json());
  if (input.claimants.length === 0) {
    console.log(`No claimants in ${inputPath}; nothing to seed.`);
    return;
  }

  const deployer = await loadKeypair();
  const program = await loadRegistryProgram(deployer);
  const mint = await loadMint();
  const secret = input.claimants.length > 0 ? estateSecret() : Buffer.alloc(0);
  const tributeAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    deployer,
    mint,
    deployer.publicKey,
    false,
    "confirmed",
  );

  for (const claimant of input.claimants) {
    await seedClaimant(program, mint, tributeAccount.address, secret, claimant);
    await seedClaimHoldings(program, claimant);
  }
}

main().catch((error: unknown) => {
  console.error(`30-fund-and-seed failed: ${errorMessage(error)}`);
  process.exit(1);
});

/**
 * Fund operative wallets and initialize verification and holdings PDAs.
 * Usage: bun run src/30-fund-and-seed.ts [operatives.json] [--help]
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
  CRED_MINT_PATH,
  connection,
  errorMessage,
  holdingsPda,
  isHelpRequest,
  loadKeypair,
  loadRegistryProgram,
  operativePda,
} from "./lib";

interface OperativeInput {
  operativeId: string;
  pubkey: string;
}

interface SeedInput {
  operatives: OperativeInput[];
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
  if (!Array.isArray(candidate.operatives)) {
    throw new Error('seed input must contain an "operatives" array');
  }
  if (Object.keys(value).some((key) => key !== "operatives")) {
    throw new Error('seed input may contain only an "operatives" array');
  }
  for (const operative of candidate.operatives) {
    if (
      !operative ||
      typeof operative.operativeId !== "string" ||
      typeof operative.pubkey !== "string" ||
      operative.operativeId.length === 0 ||
      Buffer.byteLength(operative.operativeId, "utf8") > 16
    ) {
      throw new Error("each operative needs operativeId (1..16 UTF-8 bytes) and pubkey");
    }
  }
  return candidate as SeedInput;
}

function bureauSecret(): Buffer {
  const encoded = process.env.SB_BUREAU_SECRET;
  if (!encoded || encoded.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(encoded)) {
    throw new Error("SB_BUREAU_SECRET must be a non-empty even-length hex string");
  }
  return Buffer.from(encoded, "hex");
}

function clearanceNonce(secret: Buffer, operativeId: string): bigint {
  const digest = createHmac("sha256", secret)
    .update(Buffer.from(`${operativeId}nonce`, "utf8"))
    .digest();
  return digest.readBigUInt64LE(0);
}

async function loadMint(): Promise<PublicKey> {
  const path = CRED_MINT_PATH;
  if (!(await Bun.file(path).exists())) {
    throw new Error(`${path} is missing; run 10-mint-cred.ts first`);
  }
  const stored = (await Bun.file(path).json()) as Partial<StoredMint>;
  if (typeof stored.address !== "string") {
    throw new Error(`${path} does not contain a CRED mint address`);
  }
  return new PublicKey(stored.address);
}

async function seedOperative(
  program: Program,
  mint: PublicKey,
  clearanceAta: PublicKey,
  secret: Buffer,
  operative: OperativeInput,
): Promise<void> {
  const owner = new PublicKey(operative.pubkey);
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
    // 100 CRED at 6 decimals provides headroom for room payments, fees, and
    // node payments across all five rooms.
    { amount: 100_000_000 },
    TOKEN_PROGRAM_ID.toBase58(),
  ]);

  const verificationRecord = operativePda(program.programId, operative.operativeId);
  if (await connection.getAccountInfo(verificationRecord, "confirmed")) {
    console.log(
      `Operative ${operative.operativeId} already initialized at ${verificationRecord}`,
    );
    return;
  }

  const nonce = clearanceNonce(secret, operative.operativeId);
  const initOperative = program.methods.initOperative;
  if (!initOperative) {
    throw new Error("Registry IDL does not define the init_operative instruction");
  }
  // The program derives the verification PDA from lowercase(operative_id).
  // Anchor's client would auto-resolve it from the raw argument, which diverges
  // for mixed-case IDs, so pass the lowercased PDA explicitly.
  const signature = await initOperative(
    operative.operativeId,
    new BN(nonce.toString()),
  )
    .accounts({ verificationRecord, clearanceAta })
    .rpc();
  console.log(`Initialized operative ${operative.operativeId} (${signature})`);
}

async function seedOperativeHoldings(
  program: Program,
  operative: OperativeInput,
): Promise<void> {
  const holdings = holdingsPda(program.programId, operative.operativeId);
  if (await connection.getAccountInfo(holdings, "confirmed")) {
    console.log(
      `Operative holdings ${operative.operativeId} already initialized at ${holdings}`,
    );
    return;
  }

  const initOperativeHoldings = program.methods.initOperativeHoldings;
  if (!initOperativeHoldings) {
    throw new Error(
      "Registry IDL does not define the init_operative_holdings instruction",
    );
  }
  const signature = await initOperativeHoldings(
    operative.operativeId,
    new PublicKey(operative.pubkey),
  ).rpc();
  console.log(
    `Initialized operative holdings ${operative.operativeId} (${signature})`,
  );
}

async function main(): Promise<void> {
  if (isHelpRequest()) {
    console.log(
      "Usage: bun run src/30-fund-and-seed.ts [operatives.json]\n" +
        "Default: /var/lib/bureau/operatives.json. Creates an empty skeleton when absent.",
    );
    return;
  }

  const inputPath =
    process.argv[2] ??
    process.env.OPERATIVES_PATH ??
    "/var/lib/bureau/operatives.json";
  const inputFile = Bun.file(inputPath);
  if (!(await inputFile.exists())) {
    await Bun.write(inputPath, '{\n  "operatives": []\n}\n');
    console.log(`Created empty seed skeleton at ${inputPath}; nothing to seed yet.`);
    return;
  }

  const input = validateInput(await inputFile.json());
  if (input.operatives.length === 0) {
    console.log(`No operatives in ${inputPath}; nothing to seed.`);
    return;
  }

  const deployer = await loadKeypair();
  const program = await loadRegistryProgram(deployer);
  const mint = await loadMint();
  const secret = input.operatives.length > 0 ? bureauSecret() : Buffer.alloc(0);
  const clearanceAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    deployer,
    mint,
    deployer.publicKey,
    false,
    "confirmed",
  );

  for (const operative of input.operatives) {
    await seedOperative(
      program,
      mint,
      clearanceAccount.address,
      secret,
      operative,
    );
    await seedOperativeHoldings(program, operative);
  }
}

main().catch((error: unknown) => {
  console.error(`30-fund-and-seed failed: ${errorMessage(error)}`);
  process.exit(1);
});

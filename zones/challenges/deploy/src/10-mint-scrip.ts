/**
 * Create or restore the six-decimal SCRIP mint controlled by the deployer.
 * Usage: bun run src/10-mint-scrip.ts [--help]
 */

import { rename, writeFile } from "node:fs/promises";
import { createMint } from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  connection,
  errorMessage,
  isHelpRequest,
  loadKeypair,
  SCRIP_MINT_PATH,
} from "./lib";

interface StoredMint {
  address: string;
  secretKey: number[];
}

async function loadStoredMint(): Promise<StoredMint | undefined> {
  const file = Bun.file(SCRIP_MINT_PATH);
  if (!(await file.exists())) return undefined;
  const value = (await file.json()) as Partial<StoredMint>;
  if (
    typeof value.address !== "string" ||
    !Array.isArray(value.secretKey) ||
    value.secretKey.length !== 64
  ) {
    throw new Error(`${SCRIP_MINT_PATH} is not a valid persisted mint keypair`);
  }
  return { address: value.address, secretKey: value.secretKey };
}

async function main(): Promise<void> {
  if (isHelpRequest()) {
    console.log(
      "Usage: bun run src/10-mint-scrip.ts\n" +
        `Creates SCRIP or restores it from ${SCRIP_MINT_PATH}.`,
    );
    return;
  }

  const deployer = await loadKeypair();
  const balance = await connection.getBalance(deployer.publicKey, "confirmed");
  if (balance < 10 * LAMPORTS_PER_SOL) {
    const signature = await connection.requestAirdrop(
      deployer.publicKey,
      10 * LAMPORTS_PER_SOL - balance,
    );
    await connection.confirmTransaction(signature, "confirmed");
  }

  const stored = await loadStoredMint();
  const mintKeypair = stored
    ? Keypair.fromSecretKey(Uint8Array.from(stored.secretKey))
    : Keypair.generate();
  if (stored && stored.address !== mintKeypair.publicKey.toBase58()) {
    throw new Error(`${SCRIP_MINT_PATH} address does not match its secret key`);
  }

  const existing = await connection.getAccountInfo(mintKeypair.publicKey, "confirmed");
  if (!existing) {
    await createMint(
      connection,
      deployer,
      deployer.publicKey,
      deployer.publicKey,
      6,
      mintKeypair,
      { commitment: "confirmed" },
    );
    console.log(`Created SCRIP mint ${mintKeypair.publicKey.toBase58()}`);
  } else {
    console.log(`SCRIP mint already exists at ${mintKeypair.publicKey.toBase58()}`);
  }

  if (!stored) {
    const value: StoredMint = {
      address: mintKeypair.publicKey.toBase58(),
      secretKey: Array.from(mintKeypair.secretKey),
    };
    const temporaryPath = `${SCRIP_MINT_PATH}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      mode: 0o600,
    });
    await rename(temporaryPath, SCRIP_MINT_PATH);
  }
}

main().catch((error: unknown) => {
  console.error(`10-mint-scrip failed: ${errorMessage(error)}`);
  process.exit(1);
});

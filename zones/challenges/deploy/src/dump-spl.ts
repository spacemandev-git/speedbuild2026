/**
 * Download required SPL program ELF files from mainnet-beta while online.
 * Usage: bun run src/dump-spl.ts [--help]
 */

import { mkdir } from "node:fs/promises";
import { errorMessage, isHelpRequest } from "./lib";

const DUMP_DIR = new URL("../spl-dumps/", import.meta.url).pathname;
const PROGRAM_IDS = [
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
] as const;

async function main(): Promise<void> {
  if (isHelpRequest()) {
    console.log(
      "Usage: bun run src/dump-spl.ts\n" +
        "Requires internet and solana CLI; writes mainnet program dumps to spl-dumps/.",
    );
    return;
  }

  await mkdir(DUMP_DIR, { recursive: true });
  for (const programId of PROGRAM_IDS) {
    const destination = `${DUMP_DIR}${programId}.so`;
    if (await Bun.file(destination).exists()) {
      console.log(`Keeping existing ${destination}`);
      continue;
    }
    console.log(`Dumping ${programId} to ${destination}`);
    const processResult = Bun.spawnSync([
      "solana",
      "program",
      "dump",
      "--url",
      "mainnet-beta",
      programId,
      destination,
    ]);
    if (processResult.exitCode !== 0) {
      throw new Error(
        `solana program dump failed for ${programId}: ${processResult.stderr.toString().trim()}`,
      );
    }
  }
}

main().catch((error: unknown) => {
  console.error(`dump-spl failed: ${errorMessage(error)}`);
  process.exit(1);
});

/**
 * Ensure Surfpool has SPL Token, Associated Token, and Memo programs.
 * Usage: bun run src/00-ensure-spl.ts [--help]
 */

import { readFile } from "node:fs/promises";
import { PublicKey } from "@solana/web3.js";
import { cheatcode, connection, errorMessage, isHelpRequest } from "./lib";

const DUMP_DIR = "/opt/zone/deploy/spl-dumps";
const LEGACY_BPF_LOADER = "BPFLoader2111111111111111111111111111111111";
const PROGRAMS = [
  {
    name: "SPL Token",
    id: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  },
  {
    name: "Associated Token Account",
    id: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  },
  {
    name: "SPL Memo",
    id: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
  },
] as const;

async function writeProgram(programId: string, dumpPath: string): Promise<void> {
  try {
    await cheatcode("surfnet_writeProgram", [programId, dumpPath]);
    return;
  } catch (writeError) {
    const bytes = await readFile(dumpPath);
    const lamports = await connection.getMinimumBalanceForRentExemption(bytes.length);
    try {
      await cheatcode("surfnet_setAccount", [
        programId,
        {
          lamports,
          data: `0x${bytes.toString("hex")}`,
          owner: LEGACY_BPF_LOADER,
          executable: true,
          rentEpoch: 0,
        },
      ]);
      return;
    } catch (setAccountError) {
      throw new Error(
        `Unable to load ${programId} from ${dumpPath}. ` +
          `surfnet_writeProgram: ${errorMessage(writeError)}; ` +
          `surfnet_setAccount: ${errorMessage(setAccountError)}`,
      );
    }
  }
}

async function main(): Promise<void> {
  if (isHelpRequest()) {
    console.log(
      "Usage: bun run src/00-ensure-spl.ts\n" +
        "Checks required SPL programs and loads missing programs from spl-dumps/.",
    );
    return;
  }

  for (const program of PROGRAMS) {
    const address = new PublicKey(program.id);
    if (await connection.getAccountInfo(address, "confirmed")) {
      console.log(`${program.name} present at ${program.id}`);
      continue;
    }

    const dumpPath = `${DUMP_DIR}/${program.id}.so`;
    const dump = Bun.file(dumpPath);
    if (!(await dump.exists())) {
      throw new Error(
        `${program.name} (${program.id}) is missing and ${dumpPath} does not exist. ` +
          "With internet access, run `bun run src/dump-spl.ts`; alternatively run " +
          `\`solana program dump --url mainnet-beta ${program.id} ${dumpPath}\` ` +
          "and place the resulting file there, then retry.",
      );
    }

    console.log(`Loading ${program.name} from ${dumpPath}`);
    await writeProgram(program.id, dumpPath);
    if (!(await connection.getAccountInfo(address, "confirmed"))) {
      throw new Error(
        `${program.name} was not visible after loading ${dumpPath}; check Surfpool logs`,
      );
    }
  }
}

main().catch((error: unknown) => {
  console.error(`00-ensure-spl failed: ${errorMessage(error)}`);
  process.exit(1);
});

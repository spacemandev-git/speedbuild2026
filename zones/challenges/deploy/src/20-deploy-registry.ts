/**
 * Build/deploy estate_registry and initialize its Config PDA once.
 * Usage: bun run src/20-deploy-registry.ts [--help]
 */

import { BN } from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3.js";
import {
  configPda,
  connection,
  DEPLOYER_PATH,
  errorMessage,
  isHelpRequest,
  loadKeypair,
  loadRegistryProgram,
  RPC_URL,
} from "./lib";

const REGISTRY_DIR = "/opt/packages/estate-registry";
const PROGRAM_SO = `${REGISTRY_DIR}/target/deploy/estate_registry.so`;
const PROGRAM_KEYPAIR = `${REGISTRY_DIR}/target/deploy/estate_registry-keypair.json`;

function run(command: string[], cwd: string): void {
  const result = Bun.spawnSync(command, {
    cwd,
    stdout: "inherit",
    stderr: "inherit",
    env: process.env,
  });
  if (result.exitCode !== 0) {
    throw new Error(`Command failed (${result.exitCode}): ${command.join(" ")}`);
  }
}

async function main(): Promise<void> {
  if (isHelpRequest()) {
    console.log(
      "Usage: bun run src/20-deploy-registry.ts\n" +
        "Builds estate_registry when needed, deploys it to local Surfpool, and initializes Config.",
    );
    return;
  }

  // Program ID is deploy-host-authoritative. The checked-in declare_id!/Anchor.toml
  // value is a placeholder from the build machine; on a fresh host Anchor generates
  // a different program keypair. Generate/keep the on-host keypair, then `anchor
  // keys sync` rewrites declare_id! + Anchor.toml to it, and a rebuild regenerates
  // the .so and IDL with that id — so keypair, source, IDL, and the deployed
  // program all agree (the equality guard below then holds).
  if (!(await Bun.file(PROGRAM_KEYPAIR).exists())) {
    run(["anchor", "build"], REGISTRY_DIR); // first build creates the program keypair
  }
  run(["anchor", "keys", "sync"], REGISTRY_DIR);
  run(["anchor", "build"], REGISTRY_DIR); // rebuild so .so + IDL carry the synced id
  if (!(await Bun.file(PROGRAM_KEYPAIR).exists())) {
    throw new Error(`Program keypair missing after build: ${PROGRAM_KEYPAIR}`);
  }

  const programKeypair = await loadKeypair(PROGRAM_KEYPAIR);
  const programAccount = await connection.getAccountInfo(
    programKeypair.publicKey,
    "confirmed",
  );
  if (!programAccount) {
    run(
      [
        "solana",
        "program",
        "deploy",
        "--url",
        RPC_URL,
        "--keypair",
        DEPLOYER_PATH,
        "--program-id",
        PROGRAM_KEYPAIR,
        PROGRAM_SO,
      ],
      REGISTRY_DIR,
    );
  } else if (!programAccount.executable) {
    throw new Error(
      `${programKeypair.publicKey} exists but is not an executable program account`,
    );
  } else {
    console.log(`estate_registry already deployed at ${programKeypair.publicKey}`);
  }

  const deployer = await loadKeypair();
  const program = await loadRegistryProgram(deployer);
  if (!program.programId.equals(programKeypair.publicKey)) {
    throw new Error(
      `IDL program id ${program.programId} does not match ${PROGRAM_KEYPAIR} (${programKeypair.publicKey})`,
    );
  }
  const config = configPda(program.programId);
  if (await connection.getAccountInfo(config, "confirmed")) {
    console.log(`Registry Config already initialized at ${config}`);
    return;
  }

  const initialize = program.methods.initialize;
  if (!initialize) {
    throw new Error("Registry IDL does not define the initialize instruction");
  }
  const signature = await initialize(new BN(4500)).rpc();
  console.log(`Initialized registry Config (${signature})`);
}

main().catch((error: unknown) => {
  console.error(`20-deploy-registry failed: ${errorMessage(error)}`);
  process.exit(1);
});

/** Shared RPC, keypair, and Anchor helpers for the Bureau deployment tools. */

import { readFile } from "node:fs/promises";
import {
  AnchorProvider,
  Program,
  Wallet,
  type Idl,
} from "@coral-xyz/anchor";
import {
  Commitment,
  Connection,
  Keypair,
  PublicKey,
} from "@solana/web3.js";

export const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8899";
export const DEPLOYER_PATH =
  process.env.BUREAU_DEPLOYER ?? "/var/lib/bureau/deployer.json";
export const REGISTRY_IDL_PATH =
  process.env.BUREAU_IDL ??
  "/opt/packages/bureau-registry/target/idl/bureau_registry.json";
export const CRED_MINT_PATH =
  process.env.CRED_MINT_PATH ?? "/var/lib/bureau/cred-mint.json";
export const COMMITMENT: Commitment = "confirmed";

export const connection = new Connection(RPC_URL, COMMITMENT);

export async function loadKeypair(path = DEPLOYER_PATH): Promise<Keypair> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read keypair ${path}: ${errorMessage(error)}`);
  }

  if (
    !Array.isArray(parsed) ||
    parsed.length !== 64 ||
    !parsed.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)
  ) {
    throw new Error(`Keypair ${path} must be a JSON array of 64 bytes`);
  }
  return Keypair.fromSecretKey(Uint8Array.from(parsed as number[]));
}

export function anchorProvider(deployer: Keypair): AnchorProvider {
  return new AnchorProvider(connection, new Wallet(deployer), {
    commitment: COMMITMENT,
    preflightCommitment: COMMITMENT,
  });
}

type AddressedIdl = Idl & {
  address?: string;
  metadata?: { address?: string };
};

export async function loadRegistryProgram(
  deployer: Keypair,
): Promise<Program> {
  let idl: AddressedIdl;
  try {
    idl = JSON.parse(await readFile(REGISTRY_IDL_PATH, "utf8")) as AddressedIdl;
  } catch (error) {
    throw new Error(
      `Unable to read registry IDL ${REGISTRY_IDL_PATH}: ${errorMessage(error)}`,
    );
  }

  const address = idl.address ?? idl.metadata?.address;
  if (!address) {
    throw new Error(`Registry IDL ${REGISTRY_IDL_PATH} has no program address`);
  }
  // Modern Anchor reads `address`; normalize older metadata-only IDLs too.
  idl.address = new PublicKey(address).toBase58();
  return new Program(idl, anchorProvider(deployer));
}

interface JsonRpcResponse<T> {
  jsonrpc: "2.0";
  id: number;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

export async function cheatcode<T = unknown>(
  method: string,
  params: unknown[],
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
  } catch (error) {
    throw new Error(
      `Surfpool RPC ${method} could not reach ${RPC_URL}: ${errorMessage(error)}`,
    );
  }

  if (!response.ok) {
    throw new Error(
      `Surfpool RPC ${method} returned HTTP ${response.status} ${response.statusText}`,
    );
  }
  const body = (await response.json()) as JsonRpcResponse<T>;
  if (body.error) {
    throw new Error(
      `Surfpool RPC ${method} failed (${body.error.code}): ${body.error.message}`,
    );
  }
  if (!("result" in body)) {
    throw new Error(`Surfpool RPC ${method} returned no result`);
  }
  return body.result as T;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isHelpRequest(args = process.argv.slice(2)): boolean {
  return args.includes("--help") || args.includes("-h");
}

export function configPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    programId,
  )[0];
}

export function operativePda(programId: PublicKey, operativeId: string): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("claim"), Buffer.from(operativeId.toLowerCase(), "utf8")],
    programId,
  )[0];
}

export function holdingsPda(
  programId: PublicKey,
  operativeId: string,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("holdings"), Buffer.from(operativeId, "utf8")],
    programId,
  )[0];
}

import { readFile } from "node:fs/promises";
import { AnchorProvider, Program, Wallet, type Idl } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  type Commitment,
} from "@solana/web3.js";
import type { ExecutorConfig } from "./config.ts";

export interface ClaimRecord {
  address: string;
  executor: string;
  status: number;
  probateNonce: bigint;
  tributeAta: string;
}

export interface DeedRecord {
  address: string;
  claim: string;
  deedCode: string;
  issuedSlot: bigint;
  presented: boolean;
}

function requireLength(buffer: Uint8Array, minimum: number, account: string): void {
  if (buffer.byteLength < minimum) {
    throw new Error(`${account} account is truncated: expected at least ${minimum} bytes, got ${buffer.byteLength}`);
  }
}

export function decodeClaimRecord(data: Uint8Array, address = ""): ClaimRecord {
  requireLength(data, 81, "ClaimRecord");
  const bytes = Buffer.from(data);
  return {
    address,
    executor: new PublicKey(bytes.subarray(8, 40)).toBase58(),
    status: bytes[40] ?? 0,
    probateNonce: bytes.readBigUInt64LE(41),
    tributeAta: new PublicKey(bytes.subarray(49, 81)).toBase58(),
  };
}

export function decodeDeed(data: Uint8Array, address = ""): DeedRecord {
  requireLength(data, 12, "Deed");
  const bytes = Buffer.from(data);
  const claimLength = bytes.readUInt32LE(8);
  if (claimLength > 16) throw new Error(`Deed claim string exceeds 16 bytes (${claimLength})`);
  const endOfClaim = 12 + claimLength;
  requireLength(bytes, endOfClaim + 17, "Deed");
  const claim = bytes.subarray(12, endOfClaim).toString("utf8");
  const deedCode = bytes.subarray(endOfClaim, endOfClaim + 8).toString("utf8");
  return {
    address,
    claim,
    deedCode,
    issuedSlot: bytes.readBigUInt64LE(endOfClaim + 8),
    presented: bytes[endOfClaim + 16] === 1,
  };
}

type LoadableIdl = Omit<Idl, "address" | "metadata"> & {
  address?: string;
  metadata?: Idl["metadata"] & { address?: string };
};

type CallableProgram = Program & {
  methods: Record<string, (...args: unknown[]) => {
    accounts(accounts: Record<string, PublicKey>): { rpc(): Promise<string> };
  }>;
};

export class EstateChain {
  readonly connection: Connection;
  private deployerPromise?: Promise<Keypair>;
  private programPromise?: Promise<CallableProgram>;
  private programIdPromise?: Promise<PublicKey>;

  constructor(private readonly config: ExecutorConfig, commitment: Commitment = "confirmed") {
    this.connection = new Connection(config.rpcUrl, {
      commitment,
      wsEndpoint: config.wsUrl,
    });
  }

  private async loadJson(path: string, purpose: string): Promise<unknown> {
    try {
      return JSON.parse(await readFile(path, "utf8")) as unknown;
    } catch (error) {
      throw new Error(`Unable to load ${purpose} at ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getDeployer(): Promise<Keypair> {
    this.deployerPromise ??= (async () => {
      const value = await this.loadJson(this.config.estateDeployerPath, "estate deployer keypair");
      if (!Array.isArray(value) || value.length !== 64
        || !value.every((byte) => Number.isInteger(byte) && Number(byte) >= 0 && Number(byte) <= 255)) {
        throw new Error(`Estate deployer at ${this.config.estateDeployerPath} must be a keypair byte array`);
      }
      return Keypair.fromSecretKey(Uint8Array.from(value as number[]));
    })();
    return this.deployerPromise;
  }

  async getScripMint(): Promise<PublicKey> {
    const value = await this.loadJson(this.config.scripMintPath, "SCRIP mint");
    if (typeof value === "object" && value !== null && "address" in value) {
      return new PublicKey(String((value as { address: unknown }).address));
    }
    if (Array.isArray(value) && value.length === 64
      && value.every((byte) => Number.isInteger(byte) && Number(byte) >= 0 && Number(byte) <= 255)) {
      return Keypair.fromSecretKey(Uint8Array.from(value as number[])).publicKey;
    }
    throw new Error(`SCRIP mint at ${this.config.scripMintPath} must contain {address} or a keypair byte array`);
  }

  private async loadIdl(): Promise<Idl> {
    const value = await this.loadJson(this.config.idlPath, "estate_registry IDL");
    if (typeof value !== "object" || value === null) throw new Error("estate_registry IDL is not a JSON object");
    const idl = value as LoadableIdl;
    const address = idl.address ?? idl.metadata?.address;
    if (!address) throw new Error(`estate_registry IDL at ${this.config.idlPath} has no program address`);
    if (!idl.address) idl.address = address;
    return idl as Idl;
  }

  async getProgramId(): Promise<PublicKey> {
    this.programIdPromise ??= this.loadIdl().then((idl) => new PublicKey(idl.address));
    return this.programIdPromise;
  }

  async getProgram(): Promise<CallableProgram> {
    this.programPromise ??= (async () => {
      const [idl, deployer] = await Promise.all([this.loadIdl(), this.getDeployer()]);
      const provider = new AnchorProvider(this.connection, new Wallet(deployer), {
        commitment: "confirmed",
        preflightCommitment: "confirmed",
      });
      return new Program(idl, provider) as CallableProgram;
    })();
    return this.programPromise;
  }

  async claimPda(claimNumber: string): Promise<PublicKey> {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("claim"), Buffer.from(claimNumber.toLowerCase(), "utf8")],
      await this.getProgramId(),
    )[0];
  }

  async deedPda(claim: string): Promise<PublicKey> {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("deed"), Buffer.from(claim, "utf8")],
      await this.getProgramId(),
    )[0];
  }

  private async configPda(): Promise<PublicKey> {
    return PublicKey.findProgramAddressSync([Buffer.from("config")], await this.getProgramId())[0];
  }

  async getClaimRecord(claimNumber: string): Promise<ClaimRecord | null> {
    const address = await this.claimPda(claimNumber);
    const account = await this.connection.getAccountInfo(address, "confirmed");
    return account ? decodeClaimRecord(account.data, address.toBase58()) : null;
  }

  async markProven(claimNumber: string): Promise<string> {
    const [program, authority, config, claimRecord] = await Promise.all([
      this.getProgram(),
      this.getDeployer().then((keypair) => keypair.publicKey),
      this.configPda(),
      this.claimPda(claimNumber),
    ]);
    const method = program.methods.markProven;
    if (!method) throw new Error("estate_registry IDL does not expose markProven");
    return method(claimNumber).accounts({ config, claim: claimRecord, authority }).rpc();
  }

  async presentDeed(claim: string, code: string): Promise<string> {
    const [program, authority, config, deed] = await Promise.all([
      this.getProgram(),
      this.getDeployer().then((keypair) => keypair.publicKey),
      this.configPda(),
      this.deedPda(claim),
    ]);
    const method = program.methods.presentDeed;
    if (!method) throw new Error("estate_registry IDL does not expose presentDeed");
    return method(claim, code).accounts({ config, deed, authority }).rpc();
  }

  async getDeed(claim: string): Promise<DeedRecord | null> {
    const address = await this.deedPda(claim);
    const account = await this.connection.getAccountInfo(address, "confirmed");
    return account ? decodeDeed(account.data, address.toBase58()) : null;
  }
}

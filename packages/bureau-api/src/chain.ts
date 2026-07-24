import { readFile } from "node:fs/promises";
import { AnchorProvider, Program, Wallet, type Idl } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  type Commitment,
} from "@solana/web3.js";
import type { BureauConfig } from "./config.ts";

export interface VerificationRecord {
  address: string;
  verifier: string;
  status: number;
  clearanceNonce: bigint;
  clearanceAta: string;
}

export interface ClearanceRecord {
  address: string;
  operative: string;
  clearanceCode: string;
  issuedSlot: bigint;
  presented: boolean;
}

function requireLength(buffer: Uint8Array, minimum: number, account: string): void {
  if (buffer.byteLength < minimum) {
    throw new Error(`${account} account is truncated: expected at least ${minimum} bytes, got ${buffer.byteLength}`);
  }
}

export function decodeVerificationRecord(data: Uint8Array, address = ""): VerificationRecord {
  requireLength(data, 81, "VerificationRecord");
  const bytes = Buffer.from(data);
  return {
    address,
    verifier: new PublicKey(bytes.subarray(8, 40)).toBase58(),
    status: bytes[40] ?? 0,
    clearanceNonce: bytes.readBigUInt64LE(41),
    clearanceAta: new PublicKey(bytes.subarray(49, 81)).toBase58(),
  };
}

export function decodeClearanceRecord(data: Uint8Array, address = ""): ClearanceRecord {
  requireLength(data, 12, "ClearanceRecord");
  const bytes = Buffer.from(data);
  const operativeLength = bytes.readUInt32LE(8);
  if (operativeLength > 16) throw new Error(`ClearanceRecord operative string exceeds 16 bytes (${operativeLength})`);
  const endOfOperative = 12 + operativeLength;
  requireLength(bytes, endOfOperative + 17, "ClearanceRecord");
  const operative = bytes.subarray(12, endOfOperative).toString("utf8");
  const clearanceCode = bytes.subarray(endOfOperative, endOfOperative + 8).toString("utf8");
  return {
    address,
    operative,
    clearanceCode,
    issuedSlot: bytes.readBigUInt64LE(endOfOperative + 8),
    presented: bytes[endOfOperative + 16] === 1,
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

export class BureauChain {
  readonly connection: Connection;
  private deployerPromise?: Promise<Keypair>;
  private programPromise?: Promise<CallableProgram>;
  private programIdPromise?: Promise<PublicKey>;

  constructor(private readonly config: BureauConfig, commitment: Commitment = "confirmed") {
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
      const value = await this.loadJson(this.config.bureauDeployerPath, "Bureau deployer keypair");
      if (!Array.isArray(value) || value.length !== 64
        || !value.every((byte) => Number.isInteger(byte) && Number(byte) >= 0 && Number(byte) <= 255)) {
        throw new Error(`Bureau deployer at ${this.config.bureauDeployerPath} must be a keypair byte array`);
      }
      return Keypair.fromSecretKey(Uint8Array.from(value as number[]));
    })();
    return this.deployerPromise;
  }

  async getCredMint(): Promise<PublicKey> {
    const value = await this.loadJson(this.config.credMintPath, "CRED mint");
    if (typeof value === "object" && value !== null && "address" in value) {
      return new PublicKey(String((value as { address: unknown }).address));
    }
    if (Array.isArray(value) && value.length === 64
      && value.every((byte) => Number.isInteger(byte) && Number(byte) >= 0 && Number(byte) <= 255)) {
      return Keypair.fromSecretKey(Uint8Array.from(value as number[])).publicKey;
    }
    throw new Error(`CRED mint at ${this.config.credMintPath} must contain {address} or a keypair byte array`);
  }

  private async loadIdl(): Promise<Idl> {
    const value = await this.loadJson(this.config.idlPath, "bureau_registry IDL");
    if (typeof value !== "object" || value === null) throw new Error("bureau_registry IDL is not a JSON object");
    const idl = value as LoadableIdl;
    const address = idl.address ?? idl.metadata?.address;
    if (!address) throw new Error(`bureau_registry IDL at ${this.config.idlPath} has no program address`);
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

  async operativePda(operativeId: string): Promise<PublicKey> {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("claim"), Buffer.from(operativeId.toLowerCase(), "utf8")],
      await this.getProgramId(),
    )[0];
  }

  async clearanceRecordPda(operativeId: string): Promise<PublicKey> {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("deed"), Buffer.from(operativeId, "utf8")],
      await this.getProgramId(),
    )[0];
  }

  private async configPda(): Promise<PublicKey> {
    return PublicKey.findProgramAddressSync([Buffer.from("config")], await this.getProgramId())[0];
  }

  async getVerificationRecord(operativeId: string): Promise<VerificationRecord | null> {
    const address = await this.operativePda(operativeId);
    const account = await this.connection.getAccountInfo(address, "confirmed");
    return account ? decodeVerificationRecord(account.data, address.toBase58()) : null;
  }

  async markVerified(operativeId: string): Promise<string> {
    const [program, authority, config, verificationRecord] = await Promise.all([
      this.getProgram(),
      this.getDeployer().then((keypair) => keypair.publicKey),
      this.configPda(),
      this.operativePda(operativeId),
    ]);
    const method = program.methods.markVerified;
    if (!method) throw new Error("bureau_registry IDL does not expose markVerified");
    return method(operativeId).accounts({ config, verificationRecord, authority }).rpc();
  }

  async presentCode(operativeId: string, code: string): Promise<string> {
    const [program, authority, config, clearanceRecord] = await Promise.all([
      this.getProgram(),
      this.getDeployer().then((keypair) => keypair.publicKey),
      this.configPda(),
      this.clearanceRecordPda(operativeId),
    ]);
    const method = program.methods.presentCode;
    if (!method) throw new Error("bureau_registry IDL does not expose presentCode");
    return method(operativeId, code).accounts({ config, clearanceRecord, authority }).rpc();
  }

  async getClearanceRecord(operativeId: string): Promise<ClearanceRecord | null> {
    const address = await this.clearanceRecordPda(operativeId);
    const account = await this.connection.getAccountInfo(address, "confirmed");
    return account ? decodeClearanceRecord(account.data, address.toBase58()) : null;
  }
}

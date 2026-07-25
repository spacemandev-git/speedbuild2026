import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { encodePaymentRequiredHeader } from "@x402/core/http";
import type { PaymentRequired, PaymentRequirements } from "@x402/core/types";
import { ExactSvmScheme } from "@x402/svm/exact/client";

const NETWORK = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const DEFAULT_RPC_URL = "http://10.61.0.20:8899";
const DEFAULT_MAX_AMOUNT = 10000n;

const USAGE = `Usage: x402-curl [options] <url>

Options:
  --keypair <path>   Solana CLI keypair JSON
  --rpc <url>        Solana RPC URL
  -H, --header <line>
                      Extra request header (repeatable)
  --max-amount <n>   Maximum payment in base units (default: 10000)
  -v, --verbose      Show payment terms and settlement signature
  -h, --help         Show this help
`;

type Environment = Record<string, string | undefined>;

export interface RequestHeader {
  name: string;
  value: string;
}

export interface CliOptions {
  keypairPath: string;
  rpcUrl: string;
  headers: RequestHeader[];
  maxAmount: bigint;
  verbose: boolean;
  help: boolean;
  url: string | undefined;
}

class ArgumentError extends Error {}

class AmountLimitError extends Error {}

function argumentValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (value === undefined) throw new ArgumentError(`${flag} requires a value`);
  return value;
}

export function parseHeaderLine(line: string): RequestHeader {
  const colon = line.indexOf(":");
  if (colon < 0) throw new ArgumentError(`invalid header "${line}": expected Name: value`);
  const name = line.slice(0, colon).trim();
  const value = line.slice(colon + 1).trim();
  if (!name) throw new ArgumentError(`invalid header "${line}": name is empty`);
  return { name, value };
}

export function parseArgs(
  argv: readonly string[],
  env: Environment = process.env,
): CliOptions {
  const home = env.HOME || homedir();
  const options: CliOptions = {
    keypairPath: env.SOLANA_KEYPAIR || join(home, ".config/solana/id.json"),
    rpcUrl: env.SB_RPC_URL || DEFAULT_RPC_URL,
    headers: [],
    maxAmount: DEFAULT_MAX_AMOUNT,
    verbose: false,
    help: false,
    url: undefined,
  };
  let positionalOnly = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === undefined) continue;
    if (!positionalOnly && argument === "--") {
      positionalOnly = true;
      continue;
    }
    if (!positionalOnly && (argument === "-h" || argument === "--help")) {
      options.help = true;
      continue;
    }
    if (!positionalOnly && (argument === "-v" || argument === "--verbose")) {
      options.verbose = true;
      continue;
    }
    if (!positionalOnly && argument === "--keypair") {
      options.keypairPath = argumentValue(argv, index, argument);
      index += 1;
      continue;
    }
    if (!positionalOnly && argument === "--rpc") {
      options.rpcUrl = argumentValue(argv, index, argument);
      index += 1;
      continue;
    }
    if (!positionalOnly && (argument === "-H" || argument === "--header")) {
      options.headers.push(parseHeaderLine(argumentValue(argv, index, argument)));
      index += 1;
      continue;
    }
    if (!positionalOnly && argument === "--max-amount") {
      const value = argumentValue(argv, index, argument);
      if (!/^\d+$/.test(value)) {
        throw new ArgumentError("--max-amount must be a non-negative integer");
      }
      options.maxAmount = BigInt(value);
      index += 1;
      continue;
    }
    if (!positionalOnly && argument.startsWith("-")) {
      throw new ArgumentError(`unknown option: ${argument}`);
    }
    if (options.url !== undefined) throw new ArgumentError(`unexpected argument: ${argument}`);
    options.url = argument;
  }

  if (!options.help && options.url === undefined) throw new ArgumentError("missing URL");
  return options;
}

export function selectRequirement(
  paymentRequired: Pick<PaymentRequired, "accepts">,
  maxAmount: bigint,
): PaymentRequirements {
  const requirement = paymentRequired.accepts[0];
  if (!requirement) throw new Error("server advertised no payment requirements");

  let amount: bigint;
  try {
    amount = BigInt(requirement.amount);
  } catch {
    throw new Error(`server advertised an invalid payment amount: ${requirement.amount}`);
  }
  if (amount < 0n) throw new Error(`server advertised a negative payment amount: ${requirement.amount}`);
  if (amount > maxAmount) {
    throw new AmountLimitError(
      `refusing payment of ${requirement.amount} base units; maximum is ${maxAmount}`,
    );
  }
  return requirement;
}

function message(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/\s+/g, " ").trim() || "unknown error";
}

function requestHeaders(headers: readonly RequestHeader[]): Headers {
  const result = new Headers();
  for (const header of headers) result.append(header.name, header.value);
  return result;
}

function parsedBody(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return body;
  }
}

function responseHeaders(response: Response): (name: string) => string | null {
  return (name) => response.headers.get(name.toLowerCase());
}

function isV2PaymentBody(body: unknown): body is PaymentRequired {
  if (typeof body !== "object" || body === null) return false;
  const candidate = body as { x402Version?: unknown; accepts?: unknown };
  return candidate.x402Version === 2 && Array.isArray(candidate.accepts);
}

function paymentDeclaration(
  client: x402HTTPClient,
  response: Response,
  body: unknown,
): PaymentRequired {
  const getHeader = responseHeaders(response);
  try {
    return client.getPaymentRequiredResponse(getHeader, body);
  } catch (error) {
    if (!isV2PaymentBody(body)) throw error;
    const fallback = encodePaymentRequiredHeader(body);
    return client.getPaymentRequiredResponse(
      (name) => getHeader(name)
        ?? (name.toLowerCase() === "payment-required" ? fallback : null),
      body,
    );
  }
}

async function readSigner(keypairPath: string) {
  let decoded: unknown;
  try {
    decoded = JSON.parse(await readFile(keypairPath, "utf8")) as unknown;
  } catch (error) {
    throw new Error(`cannot read keypair ${keypairPath}: ${message(error)}`);
  }
  if (!Array.isArray(decoded)
    || decoded.length !== 64
    || !decoded.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
    throw new Error(`keypair ${keypairPath} must be a JSON array of 64 bytes`);
  }
  return createKeyPairSignerFromBytes(Uint8Array.from(decoded as number[]));
}

function writeBody(body: string): void {
  process.stdout.write(body);
}

function paymentTerms(requirement: PaymentRequirements): string {
  const feePayer = typeof requirement.extra.feePayer === "string"
    ? requirement.extra.feePayer
    : String(requirement.extra.feePayer ?? "");
  return `payment terms: network=${requirement.network} amount=${requirement.amount}`
    + ` asset=${requirement.asset} payTo=${requirement.payTo} feePayer=${feePayer}`;
}

export async function runCli(argv: readonly string[]): Promise<number> {
  let options: CliOptions;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(`x402-curl: ${message(error)}`);
    return 2;
  }

  if (options.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  const url = options.url;
  if (url === undefined) throw new Error("missing URL");
  const initial = await fetch(url, { method: "GET", headers: requestHeaders(options.headers) });
  const initialText = await initial.text();
  if (initial.status !== 402) {
    writeBody(initialText);
    if (initial.ok) return 0;
    console.error(`x402-curl: request failed with HTTP ${initial.status}`);
    return 1;
  }

  const body = parsedBody(initialText);
  const parserClient = new x402HTTPClient(new x402Client());
  const declaration = paymentDeclaration(parserClient, initial, body);

  let requirement: PaymentRequirements;
  try {
    requirement = selectRequirement(declaration, options.maxAmount);
  } catch (error) {
    if (!(error instanceof AmountLimitError)) throw error;
    console.error(`x402-curl: ${message(error)}`);
    return 3;
  }
  if (requirement.network !== NETWORK) {
    throw new Error(`unsupported payment network: ${requirement.network}`);
  }
  if (requirement.scheme !== "exact") {
    throw new Error(`unsupported payment scheme: ${requirement.scheme}`);
  }
  if (options.verbose) console.error(`x402-curl: ${paymentTerms(requirement)}`);

  const signer = await readSigner(options.keypairPath);
  const coreClient = new x402Client().register(
    NETWORK,
    new ExactSvmScheme(signer, { rpcUrl: options.rpcUrl }),
  );
  const httpClient = new x402HTTPClient(coreClient);
  const payload = await httpClient.createPaymentPayload(declaration);
  const paymentHeaders = httpClient.encodePaymentSignatureHeader(payload);
  const encodedPayment = paymentHeaders["PAYMENT-SIGNATURE"] ?? paymentHeaders["X-PAYMENT"];
  if (!encodedPayment) throw new Error("x402 client did not produce a payment header");
  paymentHeaders["X-PAYMENT"] = encodedPayment;

  const retryHeaders = requestHeaders(options.headers);
  for (const [name, value] of Object.entries(paymentHeaders)) retryHeaders.set(name, value);
  const paid = await fetch(url, { method: "GET", headers: retryHeaders });
  const paidText = await paid.text();
  writeBody(paidText);

  if (options.verbose && responseHeaders(paid)("X-PAYMENT-RESPONSE")) {
    const result = httpClient.parsePaymentResult({
      status: paid.status,
      getHeader: responseHeaders(paid),
      body: parsedBody(paidText),
    });
    const signature = result.header && "success" in result.header
      ? result.header.transaction
      : undefined;
    if (signature) console.error(`x402-curl: settlement signature=${signature}`);
  }
  if (paid.ok) return 0;
  console.error(`x402-curl: paid request failed with HTTP ${paid.status}`);
  return 1;
}

if (import.meta.main) {
  runCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(`x402-curl: ${message(error)}`);
      process.exitCode = 1;
    });
}

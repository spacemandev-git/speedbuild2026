import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const INCUS_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/i;

export interface IncusInstance {
  name: string;
  status?: string;
  status_code?: number;
  [key: string]: unknown;
}

interface SpawnProcessLike {
  stdout: ReadableStream<Uint8Array> | null;
  stderr: ReadableStream<Uint8Array> | null;
  stdin?: { write(data: string | Uint8Array): number; end(): void } | null;
  exited: Promise<number>;
}

export type SpawnLike = (
  argv: string[],
  options: {
    stdout: "pipe";
    stderr: "pipe";
    stdin: "pipe" | "ignore";
  },
) => SpawnProcessLike;

export interface ExecOptions {
  input?: string;
}

export interface FilePushOptions {
  recursive?: boolean;
  mode?: number;
  uid?: number;
}

export class IncusError extends Error {
  constructor(
    message: string,
    readonly argv: readonly string[],
    readonly exitCode: number,
    readonly stderr: string,
  ) {
    super(message);
    this.name = "IncusError";
  }
}

export function validateIncusName(value: string, label = "Incus name"): string {
  if (!INCUS_NAME_PATTERN.test(value)) {
    throw new Error(`${label} must match ${INCUS_NAME_PATTERN}`);
  }
  return value;
}

function validateAbsolutePath(value: string, label: string): string {
  if (!value.startsWith("/") || value.includes("\0") || value.split("/").includes("..")) {
    throw new Error(`${label} must be a safe absolute path`);
  }
  return value;
}

function validateLocalPath(value: string): string {
  if (!value || value.includes("\0")) throw new Error("local path is invalid");
  return value;
}

function validatePort(port: number): number {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("invalid TCP port");
  return port;
}

function isIpv4(value: string): boolean {
  const octets = value.split(".");
  return octets.length === 4
    && octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255);
}

async function streamText(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) return "";
  return new Response(stream).text();
}

export class IncusClient {
  constructor(private readonly spawn: SpawnLike = Bun.spawn as unknown as SpawnLike) {}

  private async run(args: string[], input?: string): Promise<string> {
    const argv = ["incus", ...args];
    const process = this.spawn(argv, {
      stdout: "pipe",
      stderr: "pipe",
      stdin: input === undefined ? "ignore" : "pipe",
    });
    if (input !== undefined) {
      if (!process.stdin) throw new Error("Incus process stdin was not available");
      process.stdin.write(input);
      process.stdin.end();
    }
    const [stdout, stderr, exitCode] = await Promise.all([
      streamText(process.stdout),
      streamText(process.stderr),
      process.exited,
    ]);
    if (exitCode !== 0) {
      throw new IncusError(`incus ${args[0] ?? "command"} failed`, argv, exitCode, stderr.trim());
    }
    return stdout.trim();
  }

  exec(container: string, command: readonly string[], options: ExecOptions = {}): Promise<string> {
    validateIncusName(container, "container name");
    if (command.length === 0 || command.some((arg) => arg.includes("\0"))) {
      throw new Error("exec command must contain safe argv entries");
    }
    return this.run(["exec", container, "--", ...command], options.input);
  }

  copy(source: string, target: string): Promise<string> {
    validateIncusName(source, "source container");
    validateIncusName(target, "target container");
    return this.run(["copy", source, target]);
  }

  start(container: string): Promise<string> {
    validateIncusName(container, "container name");
    return this.run(["start", container]);
  }

  stop(container: string): Promise<string> {
    validateIncusName(container, "container name");
    return this.run(["stop", container]);
  }

  delete(container: string, force = false): Promise<string> {
    validateIncusName(container, "container name");
    return this.run(["delete", ...(force ? ["--force"] : []), container]);
  }

  async list(): Promise<IncusInstance[]> {
    const output = await this.run(["list", "--format", "json"]);
    const value: unknown = JSON.parse(output || "[]");
    if (!Array.isArray(value)) throw new Error("incus list returned a non-array JSON value");
    return value.filter((item): item is IncusInstance => {
      return typeof item === "object" && item !== null && typeof (item as { name?: unknown }).name === "string";
    });
  }

  filePush(local: string, container: string, destination: string, options: FilePushOptions = {}): Promise<string> {
    validateLocalPath(local);
    validateIncusName(container, "container name");
    validateAbsolutePath(destination, "container destination");
    const flags: string[] = [];
    if (options.recursive) flags.push("--recursive");
    if (options.mode !== undefined) {
      if (!Number.isInteger(options.mode) || options.mode < 0 || options.mode > 0o7777) throw new Error("invalid file mode");
      flags.push("--mode", options.mode.toString(8).padStart(4, "0"));
    }
    if (options.uid !== undefined) {
      if (!Number.isInteger(options.uid) || options.uid < 0) throw new Error("invalid file uid");
      flags.push("--uid", String(options.uid));
    }
    return this.run(["file", "push", ...flags, local, `${container}${destination}`]);
  }

  async filePushContent(
    content: string,
    container: string,
    destination: string,
    mode: number,
    uid: number,
  ): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), "sb-host-agent-"));
    const temporaryFile = join(directory, "content");
    try {
      await Bun.write(temporaryFile, content);
      return await this.filePush(temporaryFile, container, destination, { mode, uid });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  deviceOverride(container: string, device: string, key: "ipv4.address", value: string): Promise<string> {
    validateIncusName(container, "container name");
    validateIncusName(device, "device name");
    if (key !== "ipv4.address" || !isIpv4(value)) {
      throw new Error("invalid device override");
    }
    return this.run(["config", "device", "override", container, device, `${key}=${value}`]);
  }

  deviceAdd(container: string, device: string, listenPort: number, connectPort = 22): Promise<string> {
    validateIncusName(container, "container name");
    validateIncusName(device, "device name");
    validatePort(listenPort);
    validatePort(connectPort);
    return this.run([
      "config",
      "device",
      "add",
      container,
      device,
      "proxy",
      `listen=tcp:0.0.0.0:${listenPort}`,
      `connect=tcp:127.0.0.1:${connectPort}`,
      "bind=host",
    ]);
  }

  deviceRemove(container: string, device: string): Promise<string> {
    validateIncusName(container, "container name");
    validateIncusName(device, "device name");
    return this.run(["config", "device", "remove", container, device]);
  }
}

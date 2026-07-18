import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncusClient } from "./incus.ts";

export const SESSIONS_DIR = "/var/log/sessions";

export interface RecordingInfo {
  file: string;
  size: number;
}

type RecordingsIncus = Pick<IncusClient, "exec">;

export async function listRecordings(
  incus: RecordingsIncus,
  container: string,
): Promise<RecordingInfo[]> {
  const script = `find ${SESSIONS_DIR} -maxdepth 1 -type f -name '*.cast' -printf '%f\\t%s\\n' 2>/dev/null | LC_ALL=C sort`;
  const output = await incus.exec(container, ["bash", "-lc", script]);
  const recordings: RecordingInfo[] = [];
  for (const line of output.split("\n")) {
    if (!line) continue;
    const separator = line.lastIndexOf("\t");
    if (separator < 0) continue;
    const file = line.slice(0, separator);
    const size = Number.parseInt(line.slice(separator + 1), 10);
    if (!file || Number.isNaN(size)) continue;
    recordings.push({ file, size });
  }
  return recordings;
}

export async function archiveRecordings(
  incus: RecordingsIncus,
  container: string,
): Promise<Uint8Array> {
  const script = `find ${SESSIONS_DIR} -maxdepth 1 -type f -name '*.cast' -printf '%f\\0' | tar -C ${SESSIONS_DIR} --null --no-recursion -czf - -T - | base64 -w0`;
  const output = await incus.exec(container, ["bash", "-lc", script]);
  return Buffer.from(output, "base64");
}

export async function bundleArchives(
  entries: Array<{ name: string; bytes: Uint8Array }>,
): Promise<Uint8Array> {
  const directory = await mkdtemp(join(tmpdir(), "sb-recordings-"));
  try {
    for (const entry of entries) {
      await Bun.write(join(directory, `${entry.name}.tar.gz`), entry.bytes);
    }
    const proc = Bun.spawn(["tar", "-cf", "-", "-C", directory, "."], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [buffer, exitCode] = await Promise.all([
      new Response(proc.stdout).arrayBuffer(),
      proc.exited,
    ]);
    if (exitCode !== 0) {
      throw new Error(`tar bundle failed with exit code ${exitCode}`);
    }
    return new Uint8Array(buffer);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

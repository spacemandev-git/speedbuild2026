import { describe, expect, test } from "bun:test";
import type { IncusClient } from "../src/incus.ts";
import { archiveRecordings, bundleArchives, listRecordings } from "../src/recordings.ts";

interface ExecCall {
  container: string;
  command: readonly string[];
}

function mockIncus(output: string): {
  incus: Pick<IncusClient, "exec">;
  execCalls: ExecCall[];
} {
  const execCalls: ExecCall[] = [];
  const incus: Pick<IncusClient, "exec"> = {
    async exec(container, command): Promise<string> {
      execCalls.push({ container, command });
      return output;
    },
  };
  return { incus, execCalls };
}

describe("session recordings", () => {
  test("lists recordings from tab-separated find output", async () => {
    const { incus, execCalls } = mockIncus(
      "claimant-20260718-120000-101.cast\t123\nclaimant-20260718-120100-102.cast\t456",
    );

    expect(await listRecordings(incus, "p01")).toEqual([
      { file: "claimant-20260718-120000-101.cast", size: 123 },
      { file: "claimant-20260718-120100-102.cast", size: 456 },
    ]);
    expect(execCalls).toEqual([{
      container: "p01",
      command: [
        "bash",
        "-lc",
        "find /var/log/sessions -maxdepth 1 -type f -name '*.cast' -printf '%f\\t%s\\n' 2>/dev/null | LC_ALL=C sort",
      ],
    }]);
  });

  test("returns an empty list for empty find output", async () => {
    const { incus } = mockIncus("");
    expect(await listRecordings(incus, "p02")).toEqual([]);
  });

  test("decodes a recording archive from base64", async () => {
    const payload = Buffer.from("hello-cast-bytes");
    const { incus, execCalls } = mockIncus(payload.toString("base64"));

    expect(await archiveRecordings(incus, "p03")).toEqual(new Uint8Array(payload));
    expect(execCalls).toEqual([{
      container: "p03",
      command: [
        "bash",
        "-lc",
        "find /var/log/sessions -maxdepth 1 -type f -name '*.cast' -printf '%f\\0' | tar -C /var/log/sessions --null --no-recursion -czf - -T - | base64 -w0",
      ],
    }]);
  });

  test("bundles participant archives into a non-empty tar", async () => {
    const bytes = await bundleArchives([
      { name: "p01", bytes: new Uint8Array([1, 2, 3]) },
      { name: "p02", bytes: new Uint8Array([4, 5, 6]) },
    ]);

    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.byteLength).toBeGreaterThan(0);
  });
});

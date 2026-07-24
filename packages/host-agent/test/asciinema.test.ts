import { describe, expect, test } from "bun:test";
import { provisionStream } from "../src/asciinema.ts";
import type { IncusClient } from "../src/incus.ts";

interface ExecCall {
  container: string;
  command: readonly string[];
}

interface PushCall {
  content: string;
  container: string;
  destination: string;
  mode: number;
  uid: number;
}

function mockIncus(output: string): {
  incus: Pick<IncusClient, "exec" | "filePushContent">;
  execCalls: ExecCall[];
  pushCalls: PushCall[];
} {
  const execCalls: ExecCall[] = [];
  const pushCalls: PushCall[] = [];
  const incus: Pick<IncusClient, "exec" | "filePushContent"> = {
    async exec(container, command): Promise<string> {
      execCalls.push({ container, command });
      if (container === "admin") return output;
      if (command[0] === "id") return "1000";
      return "";
    },
    async filePushContent(content, container, destination, mode, uid): Promise<string> {
      pushCalls.push({ content, container, destination, mode, uid });
      return "";
    },
  };
  return { incus, execCalls, pushCalls };
}

describe("asciinema stream provisioning", () => {
  test("parses valid output and pushes current, legacy, and stream credentials", async () => {
    const installId = "123e4567-e89b-42d3-a456-426614174000";
    const publicToken = "AbCdEf0123456789";
    const producerToken = "zYxWvU9876543210";
    const { incus, execCalls, pushCalls } = mockIncus(`${installId} ${publicToken} ${producerToken}\n`);

    expect(await provisionStream(incus, "p01", "p01")).toEqual({
      installId,
      publicToken,
      producerToken,
      playerWsPath: `/ws/s/${publicToken}`,
    });
    expect(execCalls).toEqual([
      { container: "admin", command: ["/usr/local/bin/provision-stream", "p01"] },
      {
        container: "p01",
        command: [
          "install", "-d", "-m", "0700", "-o", "operative", "-g", "operative",
          "/home/operative/.local",
          "/home/operative/.local/state",
          "/home/operative/.local/state/asciinema",
          "/home/operative/.config",
          "/home/operative/.config/asciinema",
        ],
      },
      { container: "p01", command: ["id", "-u", "operative"] },
      {
        container: "p01",
        command: [
          "chown", "operative:operative",
          "/home/operative/.local/state/asciinema/install-id",
          "/home/operative/.config/asciinema/install-id",
          "/home/operative/.config/asciinema/stream-token",
        ],
      },
    ]);
    expect(pushCalls).toEqual([
      {
        content: `${installId}\n`,
        container: "p01",
        destination: "/home/operative/.local/state/asciinema/install-id",
        mode: 0o600,
        uid: 1000,
      },
      {
        content: `${installId}\n`,
        container: "p01",
        destination: "/home/operative/.config/asciinema/install-id",
        mode: 0o600,
        uid: 1000,
      },
      {
        content: `${publicToken}\n`,
        container: "p01",
        destination: "/home/operative/.config/asciinema/stream-token",
        mode: 0o600,
        uid: 1000,
      },
    ]);
  });

  test("rejects garbage without writing participant files", async () => {
    const { incus, execCalls, pushCalls } = mockIncus("not provisioning output");
    expect(provisionStream(incus, "p01", "p01")).rejects.toThrow("not provisioning output");
    expect(execCalls).toHaveLength(1);
    expect(pushCalls).toHaveLength(0);
  });

  test("rejects tokens that are not exactly 16 alphanumeric characters", async () => {
    const { incus, pushCalls } = mockIncus(
      "123e4567-e89b-42d3-a456-426614174000 short abcdefghijklmnopq",
    );
    expect(provisionStream(incus, "p01", "p01")).rejects.toThrow("short");
    expect(pushCalls).toHaveLength(0);
  });
});

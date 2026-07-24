import { describe, expect, test } from "bun:test";
import type { Config } from "../src/config.ts";
import type { IncusClient } from "../src/incus.ts";
import { operativeId, ParticipantManager, participantName, ROOMS } from "../src/participants.ts";
import { generatePassword, PASSWORD_WORDS } from "../src/password.ts";
import type { HostAgentState } from "../src/state.ts";
import type { StateStore } from "../src/state.ts";

describe("participant identity derivation", () => {
  test("derives padded container names and operative ids", () => {
    expect(participantName(1)).toBe("p01");
    expect(participantName(30)).toBe("p30");
    expect(operativeId(1)).toBe("OPERATIVE-01");
    expect(operativeId(30)).toBe("OPERATIVE-30");
  });

  test("rejects numbers outside the two-digit participant range", () => {
    expect(() => participantName(0)).toThrow();
    expect(() => operativeId(100)).toThrow();
  });

  test("supports the five standard rooms", () => {
    expect(ROOMS).toEqual(["room1", "room2", "room3", "room4", "room5"]);
  });

  test("provisions Bureau identity files, registers the operative, and uses Bureau paths", async () => {
    const config: Config = {
      hostAgentToken: "host-token",
      adminToken: "admin-token",
      subnetPrefix: "10.61.0",
      sshPortBase: 2200,
      participantCount: 30,
      statePath: "/tmp/state.json",
      contentDir: "/opt/content",
      hostLanHint: "192.0.2.10",
      sunburstOrKey: "or-key",
    };
    let state: HostAgentState = { participants: {}, apiKeysAssigned: [] };
    const pushedContent: Array<{ content: string; destination: string }> = [];
    const pushedFiles: Array<{ source: string; destination: string }> = [];
    const passwordInputs: string[] = [];
    const incus = {
      async exec(container: string, command: readonly string[], options: { input?: string } = {}): Promise<string> {
        if (options.input) passwordInputs.push(options.input);
        if (container === "inference") return "api-key-01";
        if (container === "admin") {
          return "123e4567-e89b-42d3-a456-426614174000 AbCdEf0123456789 zYxWvU9876543210";
        }
        if (command[0] === "id") return "1000";
        if (command[0] === "bash" && command[2]?.includes("base64")) {
          return Buffer.from("recording").toString("base64");
        }
        if (command[0] === "bash") return "operative-session.cast\t9";
        return "";
      },
      async list(): Promise<Array<{ name: string; status: string }>> {
        return [{ name: "p01", status: "Running" }];
      },
      async copy(): Promise<string> { return ""; },
      async deviceOverride(): Promise<string> { return ""; },
      async start(): Promise<string> { return ""; },
      async deviceAdd(): Promise<string> { return ""; },
      async delete(): Promise<string> { return ""; },
      async filePushContent(content: string, _container: string, destination: string): Promise<string> {
        pushedContent.push({ content, destination });
        return "";
      },
      async filePush(source: string, _container: string, destination: string): Promise<string> {
        pushedFiles.push({ source, destination });
        return "";
      },
    } as unknown as IncusClient;
    const stateStore = {
      async load(): Promise<HostAgentState> {
        return structuredClone(state);
      },
      async save(next: HostAgentState): Promise<void> {
        state = structuredClone(next);
      },
    } as unknown as StateStore;
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({
        url: String(input),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      });
      return new Response(null, { status: 200 });
    }) as typeof fetch;

    try {
      const manager = new ParticipantManager(config, incus, stateStore);
      const participant = await manager.provision("p01");
      expect(participant.operativeId).toBe("OPERATIVE-01");
      expect(participant.sshCommand).toBe("ssh operative@192.0.2.10 -p 2201");
      expect(passwordInputs[0]).toStartWith("operative:");

      const environment = pushedContent.find((entry) => entry.destination.endsWith(".bureau-env"));
      expect(environment?.destination).toBe("/home/operative/.bureau-env");
      expect(environment?.content).toContain("export BUREAU_API_KEY='api-key-01'");
      expect(environment?.content).toContain("export OPERATIVE_ID='OPERATIVE-01'");
      expect(environment?.content).toContain("export SOLANA_KEYPAIR=/home/operative/.config/solana/id.json");
      expect(environment?.content).toContain("export SUNBURST_OR_KEY='or-key'");
      expect(requests[0]).toEqual({
        url: "http://10.61.0.20:8710/operatives",
        body: { operativeId: "OPERATIVE-01", pubkey: participant.solanaPubkey },
      });

      await manager.reveal("p01", "room1");
      expect(pushedFiles).toContainEqual({
        source: "/opt/content/rooms/room1/",
        destination: "/home/operative/bureau/rooms/room1/",
      });
      expect(requests[1]).toEqual({
        url: "http://10.61.0.20:8710/reveal",
        body: { operativeId: "OPERATIVE-01", room: "room1" },
      });

      const archive = await manager.recordingsArchiveAll();
      expect(archive.filename).toBe("bureau-recordings.tar");
      expect(archive.bytes.byteLength).toBeGreaterThan(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("password generation", () => {
  test("uses four words from the embedded wordlist", () => {
    expect(PASSWORD_WORDS.length).toBeGreaterThanOrEqual(190);
    expect(PASSWORD_WORDS.length).toBeLessThanOrEqual(210);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const words = generatePassword().split("-");
      expect(words).toHaveLength(4);
      expect(words.every((word) => (PASSWORD_WORDS as readonly string[]).includes(word))).toBeTrue();
    }
  });
});

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HostAgentState } from "../src/state.ts";
import { StateStore } from "../src/state.ts";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("StateStore", () => {
  test("returns an empty state for a missing file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sb-state-test-"));
    directories.push(directory);
    expect(await new StateStore(join(directory, "missing", "state.json")).load()).toEqual({
      participants: {},
    });
  });

  test("round-trips participant state through an atomic save", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sb-state-test-"));
    directories.push(directory);
    const store = new StateStore(join(directory, "nested", "state.json"));
    const state: HostAgentState = {
      participants: {
        p01: {
          n: 1,
          operativeId: "OPERATIVE-01",
          ip: "10.61.0.101",
          sshPort: 2201,
          password: "acorn-amber-anchor-arrow",
          solanaPubkey: "example-public-key",
          solanaSecretKey: [1, 2, 3],
          asciinemaToken: null,
          revealedRooms: ["room1"],
          createdAt: "2026-07-16T00:00:00.000Z",
          status: "Running",
        },
      },
    };

    await store.save(state);
    expect(await store.load()).toEqual(state);
  });

  test("drops retired model credentials from legacy state", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sb-state-test-"));
    directories.push(directory);
    const path = join(directory, "state.json");
    await Bun.write(path, JSON.stringify({
      participants: {
        p01: {
          n: 1,
          operativeId: "OPERATIVE-01",
          ip: "10.61.0.101",
          sshPort: 2201,
          password: "acorn-amber-anchor-arrow",
          solanaPubkey: "example-public-key",
          solanaSecretKey: [1, 2, 3],
          apiKeyIndex: 1,
          apiKey: "retired-key",
          revealedRooms: [],
          createdAt: "2026-07-16T00:00:00.000Z",
        },
      },
      apiKeysAssigned: [1],
    }));

    expect(await new StateStore(path).load()).toEqual({
      participants: {
        p01: {
          n: 1,
          operativeId: "OPERATIVE-01",
          ip: "10.61.0.101",
          sshPort: 2201,
          password: "acorn-amber-anchor-arrow",
          solanaPubkey: "example-public-key",
          solanaSecretKey: [1, 2, 3],
          revealedRooms: [],
          createdAt: "2026-07-16T00:00:00.000Z",
        },
      },
    });
  });
});

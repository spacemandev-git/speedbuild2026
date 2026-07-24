import { describe, expect, test } from "bun:test";
import type { BureauEvent, NotifierDeps } from "../src/notifier.ts";
import { BureauNotifier, resolveDirectTargets } from "../src/notifier.ts";

function event(overrides: Partial<BureauEvent> = {}): BureauEvent {
  return {
    id: 1,
    type: "combo.reveal",
    room: "room1",
    operativeId: "OPERATIVE-01",
    message: "Room verification completed.",
    data: { combo: "1234" },
    ...overrides,
  };
}

describe("resolveDirectTargets", () => {
  test("formats a room 1 combination reveal", () => {
    const targets = resolveDirectTargets(event());
    expect(targets).toHaveLength(1);
    expect(targets[0]?.operativeId).toBe("OPERATIVE-01");
    expect(targets[0]?.text).toContain("Room 1 — Operation");
    expect(targets[0]?.text).toContain("1234");
    expect(targets[0]?.text).toContain("Next: Room 2 — Assembly");
  });

  test("creates one room 3 notice with the matching fragment per operative", () => {
    const targets = resolveDirectTargets(event({
      room: "room3",
      operativeId: null,
      data: {
        unlocks: {
          "OPERATIVE-01": "FRAG-A",
          "OPERATIVE-02": "FRAG-B",
          "OPERATIVE-03": "FRAG-C",
        },
      },
    }));
    expect(targets).toHaveLength(3);
    for (const [operativeId, fragment] of [
      ["OPERATIVE-01", "FRAG-A"],
      ["OPERATIVE-02", "FRAG-B"],
      ["OPERATIVE-03", "FRAG-C"],
    ]) {
      const target = targets.find((candidate) => candidate.operativeId === operativeId);
      expect(target?.text).toContain(fragment);
      expect(target?.text).toContain("Next: Room 4 — Minesweeper");
    }
  });

  test("formats a manual override fragment", () => {
    const override = resolveDirectTargets(event({
      type: "override.granted",
      room: "room3",
      data: { fragment: "OVERRIDE-FRAGMENT" },
    }));
    expect(override).toHaveLength(1);
    expect(override[0]?.text).toContain("MANUAL OVERRIDE");
    expect(override[0]?.text).toContain("OVERRIDE-FRAGMENT");
    expect(override[0]?.text).toContain("Next: Room 4 — Minesweeper");
  });

  test("formats a force-completed room with its unlock and next step", () => {
    const override = resolveDirectTargets(event({
      type: "override.completed",
      room: "room2",
      message: "Room force-completed.",
      data: { combo: "FORCED-COMBO" },
    }));
    expect(override).toHaveLength(1);
    expect(override[0]?.text).toContain("ROOM FORCE-COMPLETED");
    expect(override[0]?.text).toContain("Room force-completed.");
    expect(override[0]?.text).toContain("Combination: FORCED-COMBO");
    expect(override[0]?.text).toContain("Next: Room 3 — Trust");
    expect(override[0]?.text).toEndWith(
      "Next: Room 3 — Trust. Its brief appears at ~/bureau/rooms/room3/BRIEF.md when revealed — see a marshal to proceed.",
    );
  });

  test("notifies the room 4 operative with the clearance code", () => {
    const targets = resolveDirectTargets(event({
      room: "room4",
      operativeId: null,
      data: { operative: "OPERATIVE-04", clearanceCode: "CODE-04" },
    }));
    expect(targets).toHaveLength(1);
    expect(targets[0]?.operativeId).toBe("OPERATIVE-04");
    expect(targets[0]?.text).toContain("ROOM VERIFIED");
    expect(targets[0]?.text).toContain("Clearance code: CODE-04");
    expect(targets[0]?.text).toContain("Next: Room 5 — Memory Path");
  });

  test("notifies the room 5 operative with the route-complete notice", () => {
    const targets = resolveDirectTargets(event({
      type: "room5.route-complete",
      room: "room5",
      operativeId: null,
      message: "Five hops reconstructed in 10 seconds.",
      data: { operative: "OPERATIVE-05", hops_correct: 5, flash_seconds: 10 },
    }));
    expect(targets).toHaveLength(1);
    expect(targets[0]?.operativeId).toBe("OPERATIVE-05");
    expect(targets[0]?.text).toContain("ROUTE COMPLETE");
    expect(targets[0]?.text).toContain("Five hops reconstructed in 10 seconds.");
    expect(targets[0]?.text).toContain("All five rooms are complete");
    expect(targets[0]?.text).toEndWith("All five rooms are complete. Report to a marshal.");
  });

  test("ignores paired solve events and unrelated room 5 events", () => {
    expect(resolveDirectTargets(event({ type: "room1.verified" }))).toEqual([]);
    expect(resolveDirectTargets(event({
      type: "room5.decoy-paid",
      room: "room5",
      operativeId: null,
      data: { operative: "OPERATIVE-05", node: "NODE-1" },
    }))).toEqual([]);
  });
});

interface ExecCall {
  container: string;
  argv: string[];
  input: string;
}

function notifierDeps(overrides: Partial<NotifierDeps> = {}): {
  deps: NotifierDeps;
  execCalls: ExecCall[];
  cursorWrites: number[];
  logs: Record<string, unknown>[];
} {
  const execCalls: ExecCall[] = [];
  const cursorWrites: number[] = [];
  const logs: Record<string, unknown>[] = [];
  const deps: NotifierDeps = {
    eventsUrl: "http://bureau/events",
    stateUrl: "http://bureau/state",
    adminToken: "admin-token",
    incusExec: async (container, argv, opts) => {
      execCalls.push({ container, argv, input: opts.input });
    },
    loadParticipants: async () => ({ p01: { operativeId: "OPERATIVE-01" } }),
    readCursor: async () => 0,
    writeCursor: async (id) => {
      cursorWrites.push(id);
    },
    log: (entry) => logs.push(entry),
    ...overrides,
  };
  return { deps, execCalls, cursorWrites, logs };
}

describe("BureauNotifier.handleEvent", () => {
  test("delivers new event ids once and persists the cursor", async () => {
    const { deps, execCalls, cursorWrites } = notifierDeps();
    const notifier = new BureauNotifier(deps);

    await notifier.handleEvent(event({ id: 5, data: { combo: "5555" } }));
    expect(execCalls).toHaveLength(1);
    expect(execCalls[0]?.container).toBe("p01");
    expect(execCalls[0]?.argv.slice(0, 2)).toEqual(["bash", "-c"]);
    expect(execCalls[0]?.input).toContain("5555");
    expect(cursorWrites).toEqual([5]);

    await notifier.handleEvent(event({ id: 5, data: { combo: "5555" } }));
    await notifier.handleEvent(event({ id: 4, data: { combo: "4444" } }));
    expect(execCalls).toHaveLength(1);
    expect(cursorWrites).toEqual([5]);

    await notifier.handleEvent(event({ id: 6, data: { combo: "6666" } }));
    expect(execCalls).toHaveLength(2);
    expect(execCalls[1]?.input).toContain("6666");
    expect(cursorWrites).toEqual([5, 6]);
  });

  test("logs and skips an operative without a participant container", async () => {
    const { deps, execCalls, logs } = notifierDeps({ loadParticipants: async () => ({}) });
    const notifier = new BureauNotifier(deps);
    await notifier.handleEvent(event({ id: 5 }));
    expect(execCalls).toHaveLength(0);
    expect(logs).toContainEqual({
      component: "notify",
      skip: "unknown-operative",
      operativeId: "OPERATIVE-01",
    });
  });
});

describe("BureauNotifier event stream", () => {
  test("seeds from first-connection replay without delivering stale events", async () => {
    const replay = event({ id: 1, data: { combo: "1111" } });
    const live = event({ id: 2, data: { combo: "2222" } });
    const payload = [
      `id: 1\nevent: combo.reveal\ndata: ${JSON.stringify(replay)}\n\n`,
      ": bureau event stream connected\n\n",
      `id: 2\nevent: combo.reveal\ndata: ${JSON.stringify(live)}\n\n`,
    ].join("");
    const fetchImpl = (async () => new Response(payload, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    })) as unknown as typeof fetch;
    const { deps, execCalls, cursorWrites } = notifierDeps({
      fetchImpl,
      readCursor: async () => null,
    });
    let notifier: BureauNotifier;
    deps.incusExec = async (container, argv, opts) => {
      execCalls.push({ container, argv, input: opts.input });
      notifier.stop();
    };
    notifier = new BureauNotifier(deps);

    expect(() => notifier.start()).not.toThrow();
    for (let attempt = 0; attempt < 100 && cursorWrites.at(-1) !== 2; attempt += 1) {
      await Bun.sleep(1);
    }
    notifier.stop();

    expect(execCalls).toHaveLength(1);
    expect(execCalls[0]?.input).toContain("2222");
    expect(execCalls[0]?.input).not.toContain("1111");
    expect(cursorWrites).toEqual([1, 2]);
  });
});

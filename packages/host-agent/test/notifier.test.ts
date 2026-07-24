import { describe, expect, test } from "bun:test";
import type { ExecutorEvent, NotifierDeps } from "../src/notifier.ts";
import { EstateNotifier, resolveDirectTargets } from "../src/notifier.ts";

function event(overrides: Partial<ExecutorEvent> = {}): ExecutorEvent {
  return {
    id: 1,
    type: "combo.reveal",
    room: "room1",
    claimNumber: "CLAIMANT-01",
    message: "The clause is satisfied.",
    data: { combo: "1234" },
    ...overrides,
  };
}

describe("resolveDirectTargets", () => {
  test("formats a room 1 combination reveal", () => {
    const targets = resolveDirectTargets(event());
    expect(targets).toHaveLength(1);
    expect(targets[0]?.claimNumber).toBe("CLAIMANT-01");
    expect(targets[0]?.text).toContain("CLAUSE I");
    expect(targets[0]?.text).toContain("1234");
  });

  test("creates one room 3 notice with the matching fragment per claimant", () => {
    const targets = resolveDirectTargets(event({
      room: "room3",
      claimNumber: null,
      data: {
        unlocks: {
          "CLAIMANT-01": "FRAG-A",
          "CLAIMANT-02": "FRAG-B",
          "CLAIMANT-03": "FRAG-C",
        },
      },
    }));
    expect(targets).toHaveLength(3);
    for (const [claimNumber, fragment] of [
      ["CLAIMANT-01", "FRAG-A"],
      ["CLAIMANT-02", "FRAG-B"],
      ["CLAIMANT-03", "FRAG-C"],
    ]) {
      const target = targets.find((candidate) => candidate.claimNumber === claimNumber);
      expect(target?.text).toContain(fragment);
    }
  });

  test("formats mercy fragments and bonus completion", () => {
    const mercy = resolveDirectTargets(event({
      type: "mercy.granted",
      room: "room3",
      data: { fragment: "MERCY-FRAGMENT" },
    }));
    expect(mercy).toHaveLength(1);
    expect(mercy[0]?.text).toContain("MERCY GRANTED");
    expect(mercy[0]?.text).toContain("MERCY-FRAGMENT");

    const bonus = resolveDirectTargets(event({
      type: "bonus.task-complete",
      room: "bonus",
      message: "Survey duty recorded.",
      data: { task: "survey" },
    }));
    expect(bonus).toHaveLength(1);
    expect(bonus[0]?.text).toContain("DUTY RECORDED");
  });

  test("notifies the room 4 claimant with the deed code", () => {
    const targets = resolveDirectTargets(event({
      room: "room4",
      claimNumber: null,
      data: { claim: "CLAIMANT-04", deedCode: "DEED-04" },
    }));
    expect(targets).toHaveLength(1);
    expect(targets[0]?.claimNumber).toBe("CLAIMANT-04");
    expect(targets[0]?.text).toContain("SATISFIED");
    expect(targets[0]?.text).toContain("Deed code: DEED-04");
  });

  test("notifies the room 5 claimant with the route-complete notice", () => {
    const targets = resolveDirectTargets(event({
      type: "room5.route-complete",
      room: "room5",
      claimNumber: null,
      message: "Five hops reconstructed in 10 seconds.",
      data: { claim: "CLAIMANT-05", hops_correct: 5, flash_seconds: 10 },
    }));
    expect(targets).toHaveLength(1);
    expect(targets[0]?.claimNumber).toBe("CLAIMANT-05");
    expect(targets[0]?.text).toContain("ROUTE RECONSTRUCTED");
    expect(targets[0]?.text).toContain("Five hops reconstructed in 10 seconds.");
  });

  test("ignores paired solve events and unrelated room 5 events", () => {
    expect(resolveDirectTargets(event({ type: "room1.proven" }))).toEqual([]);
    expect(resolveDirectTargets(event({
      type: "room5.decoy-paid",
      room: "room5",
      claimNumber: null,
      data: { claim: "CLAIMANT-05", node: "NODE-1" },
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
    eventsUrl: "http://executor/events",
    stateUrl: "http://executor/state",
    adminToken: "admin-token",
    incusExec: async (container, argv, opts) => {
      execCalls.push({ container, argv, input: opts.input });
    },
    loadParticipants: async () => ({ p01: { claimNumber: "CLAIMANT-01" } }),
    readCursor: async () => 0,
    writeCursor: async (id) => {
      cursorWrites.push(id);
    },
    log: (entry) => logs.push(entry),
    ...overrides,
  };
  return { deps, execCalls, cursorWrites, logs };
}

describe("EstateNotifier.handleEvent", () => {
  test("delivers new event ids once and persists the cursor", async () => {
    const { deps, execCalls, cursorWrites } = notifierDeps();
    const notifier = new EstateNotifier(deps);

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

  test("logs and skips a claimant without a participant container", async () => {
    const { deps, execCalls, logs } = notifierDeps({ loadParticipants: async () => ({}) });
    const notifier = new EstateNotifier(deps);
    await notifier.handleEvent(event({ id: 5 }));
    expect(execCalls).toHaveLength(0);
    expect(logs).toContainEqual({
      component: "notify",
      skip: "unknown-claim",
      claimNumber: "CLAIMANT-01",
    });
  });
});

describe("EstateNotifier event stream", () => {
  test("seeds from first-connection replay without delivering stale events", async () => {
    const replay = event({ id: 1, data: { combo: "1111" } });
    const live = event({ id: 2, data: { combo: "2222" } });
    const payload = [
      `id: 1\nevent: combo.reveal\ndata: ${JSON.stringify(replay)}\n\n`,
      ": executor event stream connected\n\n",
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
    let notifier: EstateNotifier;
    deps.incusExec = async (container, argv, opts) => {
      execCalls.push({ container, argv, input: opts.input });
      notifier.stop();
    };
    notifier = new EstateNotifier(deps);

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

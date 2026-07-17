import { describe, expect, test } from "bun:test";
import { IncusClient } from "../src/incus.ts";
import type { SpawnLike } from "../src/incus.ts";

function textStream(value: string): ReadableStream<Uint8Array> {
  return new Response(value).body as ReadableStream<Uint8Array>;
}

function mockSpawn(calls: string[][]): SpawnLike {
  return (argv) => {
    calls.push(argv);
    return {
      stdout: textStream(argv.includes("list") ? "[]" : ""),
      stderr: textStream(""),
      exited: Promise.resolve(0),
    };
  };
}

describe("IncusClient argv validation", () => {
  test("passes validated commands as argv without a shell", async () => {
    const calls: string[][] = [];
    const incus = new IncusClient(mockSpawn(calls));
    await incus.start("p01");
    await incus.deviceAdd("p01", "ssh-p01", 2201);
    expect(calls[0]).toEqual(["incus", "start", "p01"]);
    expect(calls[1]).toEqual([
      "incus", "config", "device", "add", "p01", "ssh-p01", "proxy",
      "listen=tcp:0.0.0.0:2201", "connect=tcp:127.0.0.1:22", "bind=host",
    ]);
  });

  test("rejects unsafe names before spawning", () => {
    const calls: string[][] = [];
    const incus = new IncusClient(mockSpawn(calls));
    expect(() => incus.start("p01;shutdown")).toThrow();
    expect(() => incus.copy("p-template", "../p01")).toThrow();
    expect(() => incus.deviceAdd("p01", "ssh_p01", 2201)).toThrow();
    expect(calls).toHaveLength(0);
  });

  test("rejects unsafe container destinations and invalid ports", () => {
    const incus = new IncusClient(mockSpawn([]));
    expect(() => incus.filePush("/tmp/file", "p01", "/home/../root/file")).toThrow();
    expect(() => incus.deviceAdd("p01", "ssh-p01", 70_000)).toThrow();
    expect(() => incus.deviceOverride("p01", "eth0", "ipv4.address", "999.1.1.1")).toThrow();
  });
});

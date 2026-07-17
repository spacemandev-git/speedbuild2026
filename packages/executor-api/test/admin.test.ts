import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { createAdminAuthMiddleware } from "../src/admin.ts";

describe("admin bearer authentication", () => {
  const app = new Hono();
  app.use("*", createAdminAuthMiddleware("test-admin-token"));
  app.get("/health", (c) => c.json({ ok: true }));

  test("rejects missing and incorrect tokens", async () => {
    expect((await app.request("/health")).status).toBe(401);
    expect((await app.request("/health", { headers: { Authorization: "Bearer wrong" } })).status).toBe(401);
  });

  test("accepts the configured bearer token", async () => {
    const response = await app.request("/health", {
      headers: { Authorization: "Bearer test-admin-token" },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
});

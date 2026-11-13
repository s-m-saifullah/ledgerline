import Fastify from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "./app";
import { createDatabase } from "./db/client";
import { applyMigrations } from "./db/migrate";
import { addApiNoStore } from "./lib/api-cache";
import { isQuietRequest } from "./lib/request-log";
import { requireTestDatabase, testConfig } from "./test-support/harness";

describe("which requests are left out of the log", () => {
  it("leaves out the health check, with or without a query, and nothing else", () => {
    expect(isQuietRequest("/api/health")).toBe(true);
    expect(isQuietRequest("/api/health?probe=1")).toBe(true);
    expect(isQuietRequest("/api/healthz")).toBe(false);
    expect(isQuietRequest("/api/health/extra")).toBe(false);
    expect(isQuietRequest("/api/v1/health")).toBe(false);
    expect(isQuietRequest("/api/v1/ledgers")).toBe(false);
    expect(isQuietRequest("/")).toBe(false);
  });
});

describe("API responses are never cached", () => {
  const route = async () => {
    const app = Fastify();
    addApiNoStore(app);
    app.get("/api/plain", async () => ({ ok: true }));
    app.get("/api/own", async (_request, reply) => {
      reply.header("cache-control", "private, max-age=5");
      return { ok: true };
    });
    app.get("/api/problem", async (_request, reply) =>
      reply.code(500).send({ ok: false }),
    );
    app.get("/docs/openapi.json", async () => ({ ok: true }));
    await app.ready();
    return app;
  };

  it("sets no-store on every /api response that has no policy of its own", async () => {
    const app = await route();
    expect((await app.inject("/api/plain")).headers["cache-control"]).toBe(
      "no-store",
    );
    expect((await app.inject("/api/problem")).headers["cache-control"]).toBe(
      "no-store",
    );
    expect((await app.inject("/api/missing")).headers["cache-control"]).toBe(
      "no-store",
    );
  });

  it("keeps a policy a route set on purpose", async () => {
    const app = await route();
    expect((await app.inject("/api/own")).headers["cache-control"]).toBe(
      "private, max-age=5",
    );
  });

  it("leaves everything outside /api alone", async () => {
    const app = await route();
    expect(
      (await app.inject("/docs/openapi.json")).headers["cache-control"],
    ).toBeUndefined();
  });
});

describe("the real app", () => {
  const url = requireTestDatabase("Request policy tests");
  const config = testConfig(url, "policy");
  const { db, pool } = createDatabase(url);
  const app = buildApp(db, config);
  let built: Awaited<typeof app>;
  beforeAll(async () => {
    await applyMigrations(url);
    built = await app;
    await built.ready();
  });
  afterAll(async () => {
    await built.close();
    await pool.end();
  });

  it("answers the health check without a log line and without caching", async () => {
    const info = vi.spyOn(built.log, "info");
    const response = await built.inject("/api/health");
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(info).not.toHaveBeenCalled();
    info.mockRestore();
  });

  it("still logs other requests, and refused ones are not cached either", async () => {
    const info = vi.spyOn(built.log, "info");
    const response = await built.inject("/api/v1/ledgers");
    expect(response.statusCode).toBe(401);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(info).toHaveBeenCalledTimes(1);
    info.mockRestore();
  });
});

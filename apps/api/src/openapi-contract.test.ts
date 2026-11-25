import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "./app";
import { createDatabase } from "./db/client";
import { API_VERSION } from "./lib/api-version";
import { requireTestDatabase, testConfig } from "./test-support/harness";

// The contract in docs/openapi.json is written once, by the route helpers, so a route cannot say something the others
// do not: every signed-in operation takes the session cookie or the app's token, and says what the shared guards answer.
const url = requireTestDatabase("OpenAPI contract tests");
const config = testConfig(url, "oac");
const { db, pool } = createDatabase(url);
const app = await buildApp(db, config);
afterAll(async () => {
  await app.close();
  await pool.end();
});

type Operation = {
  security?: Record<string, unknown>[];
  responses: Record<string, unknown>;
  tags?: string[];
  summary?: string;
};
const doc = (await app.inject({ url: "/api/v1/openapi.json" })).json() as {
  info: { version: string };
  paths: Record<string, Record<string, Operation>>;
};
const methods = ["get", "post", "put", "patch", "delete"];
const operations = Object.entries(doc.paths).flatMap(([path, found]) =>
  Object.entries(found)
    .filter(([method]) => methods.includes(method))
    .map(([method, operation]) => ({
      name: `${method.toUpperCase()} ${path}`,
      path,
      method,
      operation,
    })),
);
const signedIn = operations.filter(({ operation }) => operation.security);

describe("the API contract", () => {
  it("names the version once", () => {
    expect(doc.info.version).toBe(API_VERSION);
  });

  it("leaves only the health check open to everyone", () => {
    expect(
      operations
        .filter(({ operation }) => !operation.security)
        .map(({ name }) => name),
    ).toEqual(["GET /api/health"]);
    expect(signedIn.length).toBeGreaterThan(100);
  });

  it("takes the session cookie or the app's token on every signed-in operation", () => {
    const wrong = signedIn
      .filter(
        ({ operation }) =>
          JSON.stringify(operation.security) !==
          JSON.stringify([{ sessionCookie: [] }, { bearerAuth: [] }]),
      )
      .map(({ name }) => name);
    expect(wrong).toEqual([]);
  });

  it("says 401 and 403 on every signed-in operation (the guards can answer both on any route)", () => {
    const missing = signedIn
      .filter(
        ({ operation }) =>
          !("401" in operation.responses && "403" in operation.responses),
      )
      .map(({ name }) => name);
    expect(missing).toEqual([]);
  });

  it("describes every ledger read: a tag and a summary", () => {
    for (const path of ["/api/v1/ledgers", "/api/v1/ledgers/{ledgerId}"]) {
      const operation = doc.paths[path]?.get as Operation;
      expect(operation.tags, path).toEqual(["Ledgers"]);
      expect(operation.summary, path).toBeTruthy();
    }
  });

  it("does not promise a conflict on a read that cannot conflict", () => {
    const reads = signedIn.filter(
      ({ path, method }) =>
        method === "get" &&
        (path.endsWith("/home") || path.includes("/reports/")),
    );
    expect(reads.length).toBe(4);
    expect(
      reads.filter(({ operation }) => "409" in operation.responses),
    ).toEqual([]);
  });
});

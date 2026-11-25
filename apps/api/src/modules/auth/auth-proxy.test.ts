import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../app";
import { createDatabase } from "../../db/client";
import { applyMigrations } from "../../db/migrate";
import { requireTestDatabase, testConfig } from "../../test-support/harness";

// The sign-in routes are a small, fixed window onto Better Auth (ADR 0038, ADR 0042): only the listed routes answer,
// every one that changes something wants the app's own Origin, and a failure never shows Better Auth's own words.
// The token, trusted-device, stopped-sign-in and rate-limit rules have their own tests beside this one.
const url = requireTestDatabase("Auth proxy tests");
const config = testConfig(url, "prx");
const { db, pool } = createDatabase(url);
const app = await buildApp(db, config);
beforeAll(async () => {
  await applyMigrations(url);
});
afterAll(async () => {
  await app.close();
  await pool.end();
});

let nextAddress = 1;
const address = () => `198.51.100.${(nextAddress++ % 250) + 1}`;
const call = (
  method: "GET" | "POST",
  path: string,
  headers: Record<string, string> = {},
  payload: unknown = undefined,
) =>
  app.inject({
    method,
    url: path,
    headers: {
      "x-forwarded-for": address(),
      ...(payload === undefined ? {} : { "content-type": "application/json" }),
      ...headers,
    },
    ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
  });
const own = { origin: config.APP_URL };
const base = "/api/v1/auth";

describe("the routes that answer", () => {
  const closed: Array<["GET" | "POST", string]> = [
    ["GET", "/sign-in/email"],
    ["POST", "/sign-up/email"],
    ["POST", "/change-password"],
    ["POST", "/reset-password"],
    ["POST", "/forget-password"],
    ["POST", "/revoke-sessions"],
    ["GET", "/list-sessions"],
    ["POST", "/get-session"],
    ["GET", "/sign-out"],
    ["GET", "/two-factor/enable"],
    ["POST", "/two-factor/get-totp-uri"],
    ["POST", "/two-factor/send-otp"],
    ["GET", "/"],
    ["GET", "/unknown/deeper/path"],
  ];

  it.each(closed)(
    "%s %s is closed, with or without the app's Origin",
    async (method, path) => {
      for (const headers of [own, {}]) {
        const response = await call(
          method,
          base + path,
          headers,
          method === "POST" ? {} : undefined,
        );
        expect(response.statusCode, `${method} ${path}`).toBe(404);
        expect(response.headers["content-type"]).toContain(
          "application/problem+json",
        );
        expect(response.json()).toMatchObject({
          status: 404,
          title: "Not found",
          detail: "This authentication endpoint is disabled.",
        });
      }
    },
  );

  it("answers the session read without an Origin, as a browser's own request has none", async () => {
    const response = await call("GET", `${base}/get-session`);
    expect(response.statusCode, response.body).toBe(200);
  });
});

describe("the origin rule", () => {
  const writes = [
    "/sign-in/email",
    "/sign-out",
    "/two-factor/enable",
    "/two-factor/verify-totp",
    "/two-factor/verify-backup-code",
    "/two-factor/generate-backup-codes",
    "/two-factor/disable",
  ];

  it.each(writes)("POST %s wants the app's own Origin", async (path) => {
    for (const headers of [{}, { origin: "https://elsewhere.example.com" }]) {
      const response = await call("POST", base + path, headers, {});
      expect(response.statusCode, path).toBe(403);
      expect(response.headers["content-type"]).toContain(
        "application/problem+json",
      );
      expect(response.json()).toMatchObject({
        status: 403,
        title: "Forbidden",
        detail: "Request origin is not allowed.",
      });
    }
  });

  it("is checked before Better Auth sees the request: a closed path with a foreign Origin is still 404", async () => {
    const response = await call(
      "POST",
      `${base}/sign-up/email`,
      { origin: "https://elsewhere.example.com" },
      {},
    );
    expect(response.statusCode).toBe(404);
  });
});

describe("a failure", () => {
  it("is the same generic answer whatever Better Auth said", async () => {
    const response = await call("POST", `${base}/sign-in/email`, own, {
      email: "nobody-prx@example.com",
      password: "not-the-password-0000",
    });
    expect(response.statusCode).toBe(401);
    expect(response.headers["content-type"]).toContain(
      "application/problem+json",
    );
    expect(response.json()).toMatchObject({
      status: 401,
      title: "Authentication failed",
      detail: "Check your credentials and try again.",
    });
    expect(response.body.toLowerCase()).not.toContain(
      "invalid email or password",
    );
  });

  it("does not give a browser a session cookie or token it did not earn", async () => {
    const response = await call("POST", `${base}/sign-in/email`, own, {
      email: "nobody-prx@example.com",
      password: "not-the-password-0000",
    });
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(response.headers["set-auth-token"]).toBeUndefined();
  });
});

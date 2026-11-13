import { newId } from "@ledgerline/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../app";
import { createDatabase } from "../../db/client";
import { applyMigrations } from "../../db/migrate";
import { account as credentials, user } from "../../db/schema";
import {
  requireTestDatabase,
  seedUser,
  testConfig,
} from "../../test-support/harness";

// The sign-in limit is per client address. The API reads the address from a single-address
// `X-Forwarded-For`, which the web container's Caddy writes (see `infra/scripts/caddyfile.test.mjs`).
// If that header ever carries a chain or nothing, everyone shares one limit and one stranger can keep
// the household out, so these tests pin both halves of the contract.
const url = requireTestDatabase("Client address tests");
const config = testConfig(url, "client-address");
const { db, pool } = createDatabase(url);
const app = await buildApp(db, config);
const person = { id: newId(), email: "client-address-person@example.com" };

const badSignIn = (forwardedFor: string) =>
  app.inject({
    method: "POST",
    url: "/api/v1/auth/sign-in/email",
    headers: { origin: config.APP_URL, "x-forwarded-for": forwardedFor },
    payload: { email: person.email, password: "not-the-right-password" },
  });

beforeAll(async () => {
  await applyMigrations(url);
  await seedUser(db, config, { ...person });
  await app.ready();
});
afterAll(async () => {
  await db.delete(credentials).where(eq(credentials.userId, person.id));
  await db.delete(user).where(eq(user.id, person.id));
  await app.close();
  await pool.end();
});

describe("the sign-in limit follows the client address", () => {
  it("stops the fourth bad sign-in from one address and leaves every other address alone", async () => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 4; attempt += 1)
      statuses.push((await badSignIn("203.0.113.10")).statusCode);
    expect(statuses.slice(0, 3).every((status) => status === 401)).toBe(true);
    expect(statuses[3]).toBe(429);
    // Another client is untouched: it gets the ordinary wrong-password answer, not the limit.
    expect((await badSignIn("203.0.113.11")).statusCode).toBe(401);
  });

  it("limits IPv6 clients by their /64, so one network cannot dodge the limit by changing the last digits", async () => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 4; attempt += 1)
      statuses.push(
        (await badSignIn(`2001:db8:5:5::${(attempt + 1).toString(16)}`))
          .statusCode,
      );
    expect(statuses[3]).toBe(429);
    expect((await badSignIn("2001:db8:6:6::1")).statusCode).toBe(401);
  });

  it("puts a header that is not one address into a single shared limit (why Caddy must write one address)", async () => {
    for (let attempt = 0; attempt < 3; attempt += 1)
      await badSignIn("203.0.113.20, 172.18.0.1");
    // A different client, with a different chain, is stopped by the first one's attempts.
    expect((await badSignIn("203.0.113.21, 172.18.0.1")).statusCode).toBe(429);
  });
});

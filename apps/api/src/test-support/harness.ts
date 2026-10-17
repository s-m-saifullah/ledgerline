import { expect } from "vitest";
import type { buildApp } from "../app";
import { type Config, readConfig } from "../config";
import type { Database } from "../db/client";
import { account as credentials, ledgerMembers, user } from "../db/schema";
import { hashPassword } from "../modules/auth/password";

/** Shared setup for API integration tests. Import these instead of copying the blocks. */

/** The dedicated test database URL; refuses to run against anything else. */
export function requireTestDatabase(suite: string) {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !new URL(url).pathname.endsWith("/ledgerline_test"))
    throw new Error(`${suite} require the dedicated ledgerline_test database.`);
  return url;
}

/** A test configuration; `prefix` keeps each suite's secret and owner distinct. */
export function testConfig(url: string, prefix: string): Config {
  return readConfig({
    NODE_ENV: "test",
    DATABASE_URL: url,
    APP_URL: "http://localhost:5173",
    BETTER_AUTH_SECRET: `${prefix}-test-secret-only-`.padEnd(48, "0"),
    OWNER_EMAIL: `${prefix}-owner@example.com`,
    OWNER_PASSWORD: `${prefix}-test-password-`.padEnd(28, "0"),
    OWNER_NAME: `${prefix} owner`,
  });
}

/** Signs in with email and password (default: the config's owner password) and returns the cookie header. */
export async function signInCookie(
  app: Awaited<ReturnType<typeof buildApp>>,
  config: Config,
  email: string,
  password = config.OWNER_PASSWORD,
) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/sign-in/email",
    headers: { origin: config.APP_URL },
    payload: { email, password },
  });
  expect(response.statusCode).toBe(200);
  const header = response.headers["set-cookie"];
  return (Array.isArray(header) ? header : [header ?? ""])
    .map((value) => value.split(";")[0])
    .join("; ");
}

/** Creates a user with a password sign-in and, optionally, a role in one ledger. */
export async function seedUser(
  db: Database,
  config: Config,
  input: {
    id: string;
    email: string;
    name?: string;
    ledgerId?: string;
    role?: "owner" | "editor" | "viewer";
  },
) {
  await db.insert(user).values({
    id: input.id,
    name: input.name ?? input.role ?? "user",
    email: input.email,
  });
  await db.insert(credentials).values({
    userId: input.id,
    accountId: input.id,
    providerId: "credential",
    password: await hashPassword(config.OWNER_PASSWORD),
  });
  if (input.ledgerId && input.role)
    await db.insert(ledgerMembers).values({
      userId: input.id,
      ledgerId: input.ledgerId,
      role: input.role,
    });
}

import { ledgerSchema, newId } from "@ledgerline/shared";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../app";
import { readConfig } from "../../config";
import { createDatabase } from "../../db/client";
import { applyMigrations } from "../../db/migrate";
import {
  account as credentials,
  ledgerMembers,
  ledgers,
  session,
  user,
  writeReceipts,
} from "../../db/schema";
import { hashPassword } from "../auth/password";

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("/ledgerline_test"))
  throw new Error(
    "Ledger tests require the dedicated ledgerline_test database.",
  );
const config = readConfig({
  NODE_ENV: "test",
  DATABASE_URL: url,
  APP_URL: "http://localhost:5173",
  BETTER_AUTH_SECRET: "ledgers-test-secret-only-0000000000000000",
  OWNER_EMAIL: "ledgers-owner@example.com",
  OWNER_PASSWORD: "Ledgers-test-password-000",
  OWNER_NAME: "Ledgers owner",
});
const { db, pool } = createDatabase(url);
const app = await buildApp(db, config);
const ledgerId = newId();
const foreignLedger = newId();
const fixtureLedgers = [ledgerId, foreignLedger];
const fixtureUsers = [newId(), newId(), newId()];
const cookies: string[] = [];
const patch = (
  payload: unknown,
  ledger = ledgerId,
  cookie = cookies[0] ?? "",
  key = newId(),
) =>
  app.inject({
    method: "PATCH",
    url: `/api/v1/ledgers/${ledger}`,
    headers: {
      "content-type": "application/json",
      cookie,
      origin: config.APP_URL,
      "idempotency-key": key,
    },
    payload: JSON.stringify(payload),
  });
const read = async (ledger = ledgerId) =>
  ledgerSchema.parse(
    (
      await app.inject({
        url: `/api/v1/ledgers/${ledger}`,
        headers: { cookie: cookies[0] ?? "" },
      })
    ).json(),
  );
async function signIn(email: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/sign-in/email",
    headers: { origin: config.APP_URL },
    payload: { email, password: config.OWNER_PASSWORD },
  });
  expect(response.statusCode).toBe(200);
  const cookie = response.headers["set-cookie"];
  return (Array.isArray(cookie) ? cookie : [cookie ?? ""])
    .map((value) => value.split(";")[0])
    .join("; ");
}
beforeAll(async () => {
  await applyMigrations(url);
  await db
    .insert(ledgers)
    .values(fixtureLedgers.map((id) => ({ id, name: "Synthetic ledger" })));
  const password = await hashPassword(config.OWNER_PASSWORD);
  for (const [index, role] of (
    ["owner", "editor", "viewer"] as const
  ).entries()) {
    const id = fixtureUsers[index] ?? "";
    await db.insert(user).values({
      id,
      name: role,
      email: `ledgers-${role}-${id}@example.com`,
    });
    await db.insert(credentials).values({
      userId: id,
      accountId: id,
      providerId: "credential",
      password,
    });
    await db.insert(ledgerMembers).values({ userId: id, ledgerId, role });
  }
  await app.ready();
  for (const [index, role] of ["owner", "editor", "viewer"].entries())
    cookies.push(
      await signIn(`ledgers-${role}-${fixtureUsers[index]}@example.com`),
    );
});
afterAll(async () => {
  await app.close();
  await db
    .delete(writeReceipts)
    .where(inArray(writeReceipts.ledgerId, fixtureLedgers));
  await db.delete(session).where(inArray(session.userId, fixtureUsers));
  await db.delete(credentials).where(inArray(credentials.userId, fixtureUsers));
  await db
    .delete(ledgerMembers)
    .where(inArray(ledgerMembers.ledgerId, fixtureLedgers));
  await db.delete(ledgers).where(inArray(ledgers.id, fixtureLedgers));
  await db.delete(user).where(inArray(user.id, fixtureUsers));
  await pool.end();
});

describe("ledger time zone", () => {
  it("starts empty and is set by the owner with the version", async () => {
    const before = await read();
    expect(before.timeZone).toBeNull();
    expect(before.version).toBe(1);
    const response = await patch({
      timeZone: "America/Chicago",
      expectedVersion: 1,
    });
    expect(response.statusCode).toBe(200);
    const after = ledgerSchema.parse(response.json());
    expect(after).toMatchObject({
      timeZone: "America/Chicago",
      version: 2,
      role: "owner",
    });
    expect(await read()).toEqual(after);
  });

  it("refuses a stale version and bad names", async () => {
    expect(
      (await patch({ timeZone: "Asia/Dhaka", expectedVersion: 1 })).statusCode,
    ).toBe(409);
    for (const timeZone of ["", "Mars/Base", "+05:00", "america chicago"])
      expect((await patch({ timeZone, expectedVersion: 2 })).statusCode).toBe(
        400,
      );
    expect((await read()).timeZone).toBe("America/Chicago");
  });

  it("replays a retry with the same key", async () => {
    const key = newId();
    const body = { timeZone: "Asia/Dhaka", expectedVersion: 2 };
    const first = await patch(body, ledgerId, cookies[0], key);
    const again = await patch(body, ledgerId, cookies[0], key);
    expect(again.headers["idempotency-replayed"]).toBe("true");
    expect(again.json()).toEqual(first.json());
    expect((await read()).version).toBe(3);
  });

  it("is owner only", async () => {
    const body = { timeZone: "Europe/London", expectedVersion: 3 };
    expect((await patch(body, ledgerId, cookies[1])).statusCode).toBe(403);
    expect((await patch(body, ledgerId, cookies[2])).statusCode).toBe(403);
    expect((await read()).timeZone).toBe("Asia/Dhaka");
  });

  it("cannot read or write another ledger", async () => {
    const response = await patch(
      {
        timeZone: "Europe/London",
        expectedVersion: 1,
      },
      foreignLedger,
    );
    expect(response.statusCode).toBe(404);
    const other = await app.inject({
      url: `/api/v1/ledgers/${foreignLedger}`,
      headers: { cookie: cookies[0] ?? "" },
    });
    expect(other.statusCode).toBe(404);
  });

  it("needs a signed-in session", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/ledgers/${ledgerId}`,
      headers: {
        "content-type": "application/json",
        origin: config.APP_URL,
        "idempotency-key": newId(),
      },
      payload: JSON.stringify({ timeZone: "UTC", expectedVersion: 3 }),
    });
    expect(response.statusCode).toBe(401);
  });
});

import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requireTestDatabase } from "../test-support/harness";
import { createDatabase } from "./client";
import { applyMigrations } from "./migrate";

// Migration 0028 (ADR 0048): the account the server was set up with becomes the admin, and nothing else changes.
const url = requireTestDatabase("Migration 0028 tests");
const { db, pool } = createDatabase(url);
const migration = readFileSync(
  new URL("../../drizzle/0028_account_flags.sql", import.meta.url),
  "utf8",
);
const statements = migration.split("--> statement-breakpoint");
const adminStatement = statements.find((part) =>
  part.includes('UPDATE "users" SET "is_admin"'),
);

beforeAll(async () => {
  await applyMigrations(url);
});
afterAll(async () => {
  await pool.end();
});

class Rollback extends Error {}
/** Runs a check inside a transaction that is always rolled back, so no other suite's accounts are touched. */
async function rolledBack(
  check: (
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  ) => Promise<void>,
) {
  await expect(
    db.transaction(async (tx) => {
      await check(tx);
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
}

describe("migration 0028", () => {
  it("adds only the three columns, each safe for an account that exists today", () => {
    expect(migration).toMatch(
      /ADD COLUMN "is_admin" boolean DEFAULT false NOT NULL/,
    );
    expect(migration).toMatch(
      /ADD COLUMN "must_change_password" boolean DEFAULT false NOT NULL/,
    );
    expect(migration).toMatch(
      /ADD COLUMN "disabled_at" timestamp with time zone;/,
    );
    expect(migration.match(/ALTER TABLE/g)).toHaveLength(3);
    expect(migration).not.toMatch(/\b(DROP|DELETE|TRUNCATE)\b/);
  });

  it("makes the earliest live account the admin and no other", async () => {
    expect(adminStatement).toBeDefined();
    await rolledBack(async (tx) => {
      await tx.execute(sql`UPDATE users SET is_admin = false`);
      await tx.execute(
        sql`INSERT INTO users (id, name, email, created_at) VALUES
          ('01a00000-0000-7000-8000-000000000001', 'Gone', 'm28-gone@example.com', '2020-01-01T00:00:00Z'),
          ('01a00000-0000-7000-8000-000000000002', 'First', 'm28-first@example.com', '2020-01-02T00:00:00Z'),
          ('01a00000-0000-7000-8000-000000000003', 'Second', 'm28-second@example.com', '2020-01-03T00:00:00Z')`,
      );
      await tx.execute(
        sql`UPDATE users SET deleted_at = now() WHERE email = 'm28-gone@example.com'`,
      );
      await tx.execute(sql.raw(adminStatement as string));
      const admins = await tx.execute(
        sql`SELECT email FROM users WHERE is_admin = true`,
      );
      expect(admins.rows.map((row) => row.email)).toEqual([
        "m28-first@example.com",
      ]);
    });
  });

  it("does nothing on a database with no account yet", async () => {
    await rolledBack(async (tx) => {
      await tx.execute(sql`DELETE FROM users WHERE false`);
      await expect(
        tx.execute(sql.raw(adminStatement as string)),
      ).resolves.toBeDefined();
    });
  });
});

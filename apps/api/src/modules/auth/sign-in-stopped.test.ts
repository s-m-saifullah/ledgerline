import { newId } from "@ledgerline/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "../../db/client";
import { applyMigrations } from "../../db/migrate";
import { user } from "../../db/schema";
import { requireTestDatabase } from "../../test-support/harness";
import { isSignInStopped } from "./sign-in-stopped";

// A stopped person is recognised by the email in the sign-in request, however it is written, with one comparison
// (`lower(email) = lower(input)`, as the Users page uses), even when the stored email has capitals.
const url = requireTestDatabase("Sign-in stopped tests");
const { db, pool } = createDatabase(url);
const stopped = {
  id: newId(),
  email: "Stopped-Person@Example.com",
};
const active = { id: newId(), email: "active-person@example.com" };
const gone = { id: newId(), email: "gone-person@example.com" };
const row = (person: { id: string; email: string }, extra = {}) => ({
  id: person.id,
  name: "Synthetic person",
  email: person.email,
  emailVerified: true,
  ...extra,
});

beforeAll(async () => {
  await applyMigrations(url);
  await db
    .insert(user)
    .values([
      row(stopped, { disabledAt: new Date() }),
      row(active),
      row(gone, { disabledAt: new Date(), deletedAt: new Date() }),
    ]);
});
afterAll(async () => {
  for (const person of [stopped, active, gone])
    await db.delete(user).where(eq(user.id, person.id));
  await pool.end();
});

describe("isSignInStopped", () => {
  it.each([
    "stopped-person@example.com",
    "STOPPED-PERSON@EXAMPLE.COM",
    "Stopped-Person@Example.com",
  ])("sees a stopped person typed as %s", async (typed) => {
    expect(await isSignInStopped(db, { email: typed })).toBe(true);
  });

  it("does not stop an active person, a deleted one or an unknown address", async () => {
    expect(await isSignInStopped(db, { email: active.email })).toBe(false);
    expect(await isSignInStopped(db, { email: gone.email })).toBe(false);
    expect(await isSignInStopped(db, { email: "nobody@example.com" })).toBe(
      false,
    );
  });

  it("has no opinion about a body that is not an email", async () => {
    for (const body of [null, {}, { email: 42 }, "text"])
      expect(await isSignInStopped(db, body)).toBe(false);
  });
});

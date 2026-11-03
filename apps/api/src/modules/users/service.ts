import type { ManagedUser } from "@ledgerline/shared";
import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { Database, DatabaseConnection } from "../../db/client";
import {
  account,
  ledgerMembers,
  ledgers,
  session,
  user,
} from "../../db/schema";
import { ApiProblem } from "../../lib/problem";
import { createAccount } from "../auth/accounts";
import { hashPassword } from "../auth/password";
import { removeTwoFactor } from "../auth/reset-two-factor";

// The admin's routes for the people on this server (ADR 0048). They read and change account facts only: nothing
// here reads, joins or returns a ledger's data, and a password is hashed on arrival and never returned or logged.

const toItem = (row: typeof user.$inferSelect): ManagedUser => ({
  id: row.id,
  name: row.name,
  email: row.email,
  isAdmin: row.isAdmin,
  mustChangePassword: row.mustChangePassword,
  disabled: row.disabledAt !== null,
  twoFactorEnabled: row.twoFactorEnabled,
  createdAt: row.createdAt.toISOString(),
});

/** Only the admin may use these routes. Anyone else is 403, whether or not the person they name exists. */
export async function requireAdmin(db: Database, userId: string) {
  const [row] = await db
    .select({ isAdmin: user.isAdmin })
    .from(user)
    .where(and(eq(user.id, userId), isNull(user.deletedAt)));
  if (!row) throw new ApiProblem(401, "Unauthorized", "Sign in to continue.");
  if (!row.isAdmin)
    throw new ApiProblem(403, "Forbidden", "Only the admin can manage people.");
}

/** The person a route names. The admin's own account is refused for every action here (it has its own pages). */
async function target(db: DatabaseConnection, adminId: string, id: string) {
  if (id === adminId)
    throw new ApiProblem(
      409,
      "Conflict",
      "You cannot do this to your own account.",
    );
  const [row] = await db
    .select()
    .from(user)
    .where(and(eq(user.id, id), isNull(user.deletedAt)));
  if (!row) throw new ApiProblem(404, "Not found", "Person not found.");
  return row;
}

const endSessions = (tx: DatabaseConnection, userId: string, now: Date) =>
  tx
    .update(session)
    .set({ deletedAt: now, updatedAt: now })
    .where(and(eq(session.userId, userId), isNull(session.deletedAt)));

export async function listUsers(db: Database) {
  const rows = await db
    .select()
    .from(user)
    .where(isNull(user.deletedAt))
    .orderBy(asc(user.createdAt), asc(user.id));
  return rows.map(toItem);
}

const emailTaken = () =>
  new ApiProblem(
    409,
    "Conflict",
    "Someone already has that email. Reset that person's password instead.",
  );

/** Whether a database error is a unique-index violation (drizzle wraps the driver error in `cause`). */
const isUniqueViolation = (error: unknown) =>
  (error as { cause?: { code?: unknown } } | null)?.cause?.code === "23505";

/** Makes a person with their own ledger on a temporary password. A deleted person's email is never reused. */
export async function createUser(
  db: Database,
  input: { name: string; email: string; temporaryPassword: string },
) {
  try {
    return await db.transaction(async (tx) => {
      const [taken] = await tx
        .select({ id: user.id })
        .from(user)
        .where(sql`lower(${user.email}) = lower(${input.email})`);
      if (taken) throw emailTaken();
      const { userId } = await createAccount(tx, {
        email: input.email,
        name: input.name,
        password: input.temporaryPassword,
        mustChangePassword: true,
      });
      const [row] = await tx.select().from(user).where(eq(user.id, userId));
      return toItem(row as typeof user.$inferSelect);
    });
  } catch (error) {
    // Two requests with the same email at once: the second one meets the unique index.
    if (isUniqueViolation(error)) throw emailTaken();
    throw error;
  }
}

/** Stops or allows a person's sign-in. Stopping ends their sessions and app tokens; their ledger is untouched. */
export async function setDisabled(
  db: Database,
  adminId: string,
  id: string,
  disabled: boolean,
) {
  return db.transaction(async (tx) => {
    const person = await target(tx, adminId, id);
    const now = new Date();
    const [row] = await tx
      .update(user)
      .set({
        disabledAt: disabled ? (person.disabledAt ?? now) : null,
        updatedAt: now,
      })
      .where(eq(user.id, id))
      .returning();
    if (disabled) await endSessions(tx, id, now);
    return toItem(row as typeof user.$inferSelect);
  });
}

/** A new temporary password: the person must choose their own at the next sign-in, and every session ends. */
export async function resetPassword(
  db: Database,
  adminId: string,
  id: string,
  temporaryPassword: string,
) {
  const hash = await hashPassword(temporaryPassword);
  await db.transaction(async (tx) => {
    await target(tx, adminId, id);
    const now = new Date();
    const changed = await tx
      .update(account)
      .set({ password: hash, updatedAt: now })
      .where(
        and(
          eq(account.userId, id),
          eq(account.providerId, "credential"),
          isNull(account.deletedAt),
        ),
      )
      .returning({ id: account.id });
    if (changed.length === 0)
      throw new ApiProblem(
        409,
        "Conflict",
        "This person has no password sign-in.",
      );
    await tx
      .update(user)
      .set({ mustChangePassword: true, updatedAt: now })
      .where(eq(user.id, id));
    await endSessions(tx, id, now);
  });
}

export async function signOutEverywhere(
  db: Database,
  adminId: string,
  id: string,
) {
  await db.transaction(async (tx) => {
    await target(tx, adminId, id);
    await endSessions(tx, id, new Date());
  });
}

export async function turnOffTwoFactor(
  db: Database,
  adminId: string,
  id: string,
) {
  await db.transaction(async (tx) => {
    await target(tx, adminId, id);
    await removeTwoFactor(tx, id);
  });
}

/**
 * Soft-deletes the person, their sign-in, their ledger and memberships, and ends their sessions. Old backups still
 * hold the data, and the email stays taken. A ledger another live person is a member of is left alone (sharing is
 * not built, so today every ledger has one member).
 */
export async function deleteUser(db: Database, adminId: string, id: string) {
  await db.transaction(async (tx) => {
    await target(tx, adminId, id);
    const now = new Date();
    const mine = await tx
      .select({ ledgerId: ledgerMembers.ledgerId })
      .from(ledgerMembers)
      .where(
        and(eq(ledgerMembers.userId, id), isNull(ledgerMembers.deletedAt)),
      );
    const ledgerIds = mine.map((member) => member.ledgerId);
    if (ledgerIds.length) {
      const shared = await tx
        .select({ ledgerId: ledgerMembers.ledgerId })
        .from(ledgerMembers)
        .where(
          and(
            inArray(ledgerMembers.ledgerId, ledgerIds),
            ne(ledgerMembers.userId, id),
            isNull(ledgerMembers.deletedAt),
          ),
        );
      const kept = new Set(shared.map((member) => member.ledgerId));
      const own = ledgerIds.filter((ledgerId) => !kept.has(ledgerId));
      if (own.length)
        await tx
          .update(ledgers)
          .set({ deletedAt: now, updatedAt: now })
          .where(and(inArray(ledgers.id, own), isNull(ledgers.deletedAt)));
    }
    await tx
      .update(ledgerMembers)
      .set({ deletedAt: now, updatedAt: now })
      .where(
        and(eq(ledgerMembers.userId, id), isNull(ledgerMembers.deletedAt)),
      );
    await tx
      .update(account)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(account.userId, id), isNull(account.deletedAt)));
    await endSessions(tx, id, now);
    await tx
      .update(user)
      .set({ deletedAt: now, updatedAt: now })
      .where(eq(user.id, id));
  });
}

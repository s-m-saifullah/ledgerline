import type { DeletedUser, ManagedUser } from "@ledgerline/shared";
import {
  and,
  asc,
  desc,
  eq,
  getTableName,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  sql,
} from "drizzle-orm";
import type { Database, DatabaseConnection } from "../../db/client";
import {
  account,
  accounts,
  budgets,
  categories,
  contacts,
  currencies,
  exchangeRates,
  importBatches,
  ledgerMembers,
  ledgers,
  receivableEvents,
  receivablePayments,
  receivables,
  recurringRules,
  recurringRuns,
  session,
  tags,
  transactionSplits,
  transactions,
  transactionTags,
  twoFactor,
  user,
  verification,
  writeReceipts,
} from "../../db/schema";
import type { JobLog } from "../../jobs/runner";
import { ApiProblem } from "../../lib/problem";
import { ledgerClearedAtFor } from "../ledgers/cleared-at";

// ADR 0049: a deleted person waits 30 days in "Recently deleted", where the admin can restore them exactly as they
// were or delete them at once; after that they and all their data are removed for good. Nothing here reads or
// returns anything from a ledger.

/** How long a deleted person can be restored, counted from the moment they were deleted. */
export const RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
export const purgeAtOf = (deletedAt: Date) =>
  new Date(deletedAt.getTime() + RETENTION_DAYS * DAY_MS);
/** The days a deleted person has left, counting a part of a day as a whole one (so never "0 days left"). */
const daysLeft = (purgeAt: Date, now: Date) =>
  Math.ceil((purgeAt.getTime() - now.getTime()) / DAY_MS);
const cutoff = (now: Date) => new Date(now.getTime() - RETENTION_DAYS * DAY_MS);

/**
 * Every table that holds a ledger's rows, children before the rows they point at, so one pass over a ledger's
 * ids removes everything (the deferred constraints settle the few circular links at commit). A test walks the
 * database's own table list and fails when a table that points at a ledger or a person is missing here.
 */
export const PURGE_ORDER = [
  transactionTags,
  transactionSplits,
  receivableEvents,
  recurringRuns,
  transactions,
  receivablePayments,
  receivables,
  recurringRules,
  budgets,
  writeReceipts,
  importBatches,
  accounts,
  categories,
  contacts,
  tags,
  currencies,
  exchangeRates,
  ledgerMembers,
] as const;
export const PURGED_TABLES: readonly string[] = PURGE_ORDER.map((table) =>
  getTableName(table),
);

const toDeleted = (row: typeof user.$inferSelect): DeletedUser => ({
  id: row.id,
  name: row.name,
  email: row.email,
  deletedAt: (row.deletedAt as Date).toISOString(),
  purgeAt: purgeAtOf(row.deletedAt as Date).toISOString(),
});
const toManaged = (
  row: typeof user.$inferSelect,
  ledgerClearedAt: string | null,
): ManagedUser => ({
  id: row.id,
  name: row.name,
  email: row.email,
  isAdmin: row.isAdmin,
  mustChangePassword: row.mustChangePassword,
  disabled: row.disabledAt !== null,
  twoFactorEnabled: row.twoFactorEnabled,
  ledgerClearedAt,
  createdAt: row.createdAt.toISOString(),
});

/** The people in "Recently deleted": deleted less than 30 days ago, newest first. Account facts only. */
export async function listDeletedUsers(db: Database, now = new Date()) {
  const rows = await db
    .select()
    .from(user)
    .where(gt(user.deletedAt, cutoff(now)))
    .orderBy(desc(user.deletedAt), asc(user.id));
  return rows.map(toDeleted);
}

/** What the admin is told when a new person's email belongs to someone deleted. */
export function deletedEmailMessage(deletedAt: Date, now = new Date()) {
  const purgeAt = purgeAtOf(deletedAt);
  if (purgeAt.getTime() <= now.getTime())
    return "That person was deleted and is being removed. Try again in a little while, or use another email.";
  const days = daysLeft(purgeAt, now);
  return `That person was deleted. Restore them from Recently deleted (${days} ${days === 1 ? "day" : "days"} left), or use another email.`;
}

/** The person a route names, locked, who must be in the deleted stage. The admin's own id is refused. */
async function lockDeleted(
  tx: DatabaseConnection,
  adminId: string,
  id: string,
  { restorable, now }: { restorable: boolean; now: Date },
) {
  if (id === adminId)
    throw new ApiProblem(
      409,
      "Conflict",
      "You cannot do this to your own account.",
    );
  // Locked first, so a restore and a delete at the same moment queue up and the second sees what the first did.
  const [row] = await tx
    .select()
    .from(user)
    .where(
      and(
        eq(user.id, id),
        ne(user.isAdmin, true),
        restorable
          ? gt(user.deletedAt, cutoff(now))
          : isNotNull(user.deletedAt),
      ),
    )
    .for("update");
  if (!row) throw new ApiProblem(404, "Not found", "Person not found.");
  return row;
}

/**
 * Brings a deleted person back exactly as they were: the person, their sign-in, their ledger and their memberships
 * that the delete removed (the same moment, so nothing deleted earlier or separately comes back). Their password,
 * two-factor and stopped sign-in are untouched; their sessions stay ended, so they sign in again.
 */
export async function restoreUser(
  db: Database,
  adminId: string,
  id: string,
  now = new Date(),
) {
  return db.transaction(async (tx) => {
    const person = await lockDeleted(tx, adminId, id, {
      restorable: true,
      now,
    });
    const stamp = person.deletedAt as Date;
    const mine = await tx
      .select({ ledgerId: ledgerMembers.ledgerId })
      .from(ledgerMembers)
      .where(
        and(eq(ledgerMembers.userId, id), eq(ledgerMembers.deletedAt, stamp)),
      );
    const ledgerIds = mine.map((member) => member.ledgerId);
    // `updated_at` moves on its own with every update, so a phone's next pull sees what came back.
    const touched = { deletedAt: null };
    if (ledgerIds.length)
      await tx
        .update(ledgers)
        .set(touched)
        .where(
          and(inArray(ledgers.id, ledgerIds), eq(ledgers.deletedAt, stamp)),
        );
    await tx
      .update(ledgerMembers)
      .set(touched)
      .where(
        and(eq(ledgerMembers.userId, id), eq(ledgerMembers.deletedAt, stamp)),
      );
    await tx
      .update(account)
      .set(touched)
      .where(and(eq(account.userId, id), eq(account.deletedAt, stamp)));
    const [row] = await tx
      .update(user)
      .set(touched)
      .where(eq(user.id, id))
      .returning();
    const cleared = await ledgerClearedAtFor(tx, [id]);
    return toManaged(row as typeof user.$inferSelect, cleared.get(id) ?? null);
  });
}

/**
 * Removes one person and everything of theirs for good, in the caller's transaction, with the person's row already
 * locked: their sole-owner ledgers with every row in them, their memberships, sessions, tokens, sign-in rows,
 * two-factor and verification rows, and the person. A ledger another live person is a member of is kept (sharing is
 * not built); if something in it still points at the person the database refuses and nothing is removed.
 */
export async function purgeUser(
  tx: DatabaseConnection,
  person: typeof user.$inferSelect,
) {
  const id = person.id;
  const mine = await tx
    .select({ ledgerId: ledgerMembers.ledgerId })
    .from(ledgerMembers)
    .where(eq(ledgerMembers.userId, id));
  const ledgerIds = mine.map((member) => member.ledgerId);
  let own: string[] = [];
  if (ledgerIds.length) {
    const shared = await tx
      .select({ ledgerId: ledgerMembers.ledgerId })
      .from(ledgerMembers)
      .where(
        and(
          inArray(ledgerMembers.ledgerId, ledgerIds),
          isNull(ledgerMembers.deletedAt),
        ),
      );
    const kept = new Set(shared.map((member) => member.ledgerId));
    own = ledgerIds.filter((ledgerId) => !kept.has(ledgerId));
  }
  if (own.length)
    for (const table of PURGE_ORDER)
      await tx.delete(table).where(inArray(table.ledgerId, own));
  await tx.delete(ledgerMembers).where(eq(ledgerMembers.userId, id));
  if (own.length) await tx.delete(ledgers).where(inArray(ledgers.id, own));
  await tx.delete(twoFactor).where(eq(twoFactor.userId, id));
  await tx.delete(session).where(eq(session.userId, id));
  await tx.delete(account).where(eq(account.userId, id));
  await tx
    .delete(verification)
    .where(sql`lower(${verification.identifier}) = lower(${person.email})`);
  await tx.delete(user).where(eq(user.id, id));
}

/** The admin's "Delete now": for a person in the deleted stage, at once. */
export async function purgeNow(db: Database, adminId: string, id: string) {
  try {
    await db.transaction(async (tx) => {
      const person = await lockDeleted(tx, adminId, id, {
        restorable: false,
        now: new Date(),
      });
      await purgeUser(tx, person);
    });
  } catch (error) {
    if (
      (error as { cause?: { code?: unknown } } | null)?.cause?.code === "23503"
    )
      throw new ApiProblem(
        409,
        "Conflict",
        "This person still has data in a ledger that other people use.",
      );
    throw error;
  }
}

/**
 * The hourly job's part: removes everyone whose 30 days are over, one transaction each, so a person it cannot remove
 * is left whole and the others still go. The admin is never removed. Counts only are logged, never a name or an email.
 */
export async function purgeDeletedPeople(db: Database, now: Date, log: JobLog) {
  const due = await db
    .select({ id: user.id })
    .from(user)
    .where(lte(user.deletedAt, cutoff(now)));
  let purged = 0;
  let failed = 0;
  for (const { id } of due) {
    try {
      const done = await db.transaction(async (tx) => {
        // Looked at again under the lock: a restore that got there first wins, and the admin is never removed.
        const [person] = await tx
          .select()
          .from(user)
          .where(
            and(
              eq(user.id, id),
              lte(user.deletedAt, cutoff(now)),
              ne(user.isAdmin, true),
            ),
          )
          .for("update");
        if (!person) return false;
        await purgeUser(tx, person);
        return true;
      });
      if (done) purged += 1;
    } catch {
      failed += 1;
    }
  }
  if (purged) log.info({ purged }, "Removed deleted people");
  if (failed) log.error({ failed }, "Could not remove deleted people");
  return { purged, failed };
}

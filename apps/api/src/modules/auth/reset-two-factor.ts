import { and, eq, isNull } from "drizzle-orm";
import type { Database, DatabaseConnection } from "../../db/client";
import { session, twoFactor, user } from "../../db/schema";

/**
 * Turns two-factor off for one person and ends their sessions. Shared by the server command below and the
 * admin's "Turn off two-factor" (ADR 0048). Rows are soft deleted like everything else, and nothing secret is
 * returned. Call it inside a transaction.
 */
export async function removeTwoFactor(tx: DatabaseConnection, userId: string) {
  const now = new Date();
  const secrets = await tx
    .update(twoFactor)
    .set({ deletedAt: now, updatedAt: now })
    .where(and(eq(twoFactor.userId, userId), isNull(twoFactor.deletedAt)))
    .returning({ id: twoFactor.id });
  await tx
    .update(user)
    .set({ twoFactorEnabled: false, updatedAt: now })
    .where(eq(user.id, userId));
  const sessions = await tx
    .update(session)
    .set({ deletedAt: now, updatedAt: now })
    .where(and(eq(session.userId, userId), isNull(session.deletedAt)))
    .returning({ id: session.id });
  return { secretsRemoved: secrets.length, sessionsEnded: sessions.length };
}

/**
 * Last-resort recovery (ADR 0038): run by the server's administrator through `infra/scripts/reset-two-factor.sh`
 * for the one account named by its email; no route calls it.
 */
export async function resetTwoFactor(db: Database, email: string) {
  return db.transaction(async (tx) => {
    const [found] = await tx
      .select({ id: user.id })
      .from(user)
      .where(and(eq(user.email, email.toLowerCase()), isNull(user.deletedAt)));
    if (!found) return null;
    return removeTwoFactor(tx, found.id);
  });
}

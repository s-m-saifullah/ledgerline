import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "../../db/client";
import { session, twoFactor, user } from "../../db/schema";

/**
 * Last-resort recovery (ADR 0038): turns two-factor off for one user and ends their sessions. Run by the
 * server's administrator through `infra/scripts/reset-two-factor.sh`; no route calls it. Rows are soft
 * deleted like everything else, and nothing secret is returned.
 */
export async function resetTwoFactor(db: Database, email: string) {
  return db.transaction(async (tx) => {
    const [found] = await tx
      .select({ id: user.id })
      .from(user)
      .where(and(eq(user.email, email.toLowerCase()), isNull(user.deletedAt)));
    if (!found) return null;
    const now = new Date();
    const secrets = await tx
      .update(twoFactor)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(twoFactor.userId, found.id), isNull(twoFactor.deletedAt)))
      .returning({ id: twoFactor.id });
    await tx
      .update(user)
      .set({ twoFactorEnabled: false, updatedAt: now })
      .where(eq(user.id, found.id));
    const sessions = await tx
      .update(session)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(session.userId, found.id), isNull(session.deletedAt)))
      .returning({ id: session.id });
    return { secretsRemoved: secrets.length, sessionsEnded: sessions.length };
  });
}

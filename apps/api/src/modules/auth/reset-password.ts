import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "../../db/client";
import { account, session, user } from "../../db/schema";
import { assertPasswordAllowed, hashPassword } from "./password";

/**
 * Last-resort recovery (ADR 0048): sets a temporary password for one person, who must change it at the next
 * sign-in, and ends their sessions. Run by the server's administrator through `infra/scripts/reset-password.sh`;
 * no route calls it. Returns null when there is no such live person. The password is never logged.
 */
export async function resetPassword(
  db: Database,
  email: string,
  temporaryPassword: string,
) {
  assertPasswordAllowed(temporaryPassword);
  const hash = await hashPassword(temporaryPassword);
  return db.transaction(async (tx) => {
    const [found] = await tx
      .select({ id: user.id })
      .from(user)
      .where(and(eq(user.email, email.toLowerCase()), isNull(user.deletedAt)));
    if (!found) return null;
    const now = new Date();
    const changed = await tx
      .update(account)
      .set({ password: hash, updatedAt: now })
      .where(
        and(
          eq(account.userId, found.id),
          eq(account.providerId, "credential"),
          isNull(account.deletedAt),
        ),
      )
      .returning({ id: account.id });
    if (!changed.length) return null;
    await tx
      .update(user)
      .set({ mustChangePassword: true, updatedAt: now })
      .where(eq(user.id, found.id));
    const ended = await tx
      .update(session)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(session.userId, found.id), isNull(session.deletedAt)))
      .returning({ id: session.id });
    return { sessionsEnded: ended.length };
  });
}

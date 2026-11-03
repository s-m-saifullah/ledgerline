import type { Me } from "@ledgerline/shared";
import { and, eq, isNull, ne } from "drizzle-orm";
import type { Database } from "../../db/client";
import { account, session, user } from "../../db/schema";
import { ApiProblem } from "../../lib/problem";
import { hashPassword, verifyPassword } from "../auth/password";

const toMe = (row: typeof user.$inferSelect): Me => ({
  id: row.id,
  name: row.name,
  email: row.email,
  isAdmin: row.isAdmin,
  mustChangePassword: row.mustChangePassword,
  twoFactorEnabled: row.twoFactorEnabled,
});

async function mine(db: Database, userId: string) {
  const [row] = await db
    .select()
    .from(user)
    .where(and(eq(user.id, userId), isNull(user.deletedAt)));
  if (!row) throw new ApiProblem(401, "Unauthorized", "Sign in to continue.");
  return row;
}

export async function readMe(db: Database, userId: string) {
  return toMe(await mine(db, userId));
}

/** Only the name can change here: the email is fixed (the server checks the admin's at start, and no mail exists to confirm a new one). */
export async function renameMe(db: Database, userId: string, name: string) {
  await mine(db, userId);
  const [row] = await db
    .update(user)
    .set({ name })
    .where(eq(user.id, userId))
    .returning();
  return toMe(row as typeof user.$inferSelect);
}

/** Counts wrong current passwords per person in memory: five in fifteen minutes lock the change for the rest of the window. */
export function createAttemptLimiter(
  now: () => Date,
  { max = 5, windowMs = 15 * 60 * 1000 } = {},
) {
  const tries = new Map<string, { count: number; since: number }>();
  const live = (key: string) => {
    const entry = tries.get(key);
    if (entry && now().getTime() - entry.since >= windowMs) {
      tries.delete(key);
      return undefined;
    }
    return entry;
  };
  return {
    blocked: (key: string) => (live(key)?.count ?? 0) >= max,
    fail: (key: string) => {
      const entry = live(key);
      if (entry) entry.count += 1;
      else tries.set(key, { count: 1, since: now().getTime() });
    },
    clear: (key: string) => void tries.delete(key),
  };
}
export type AttemptLimiter = ReturnType<typeof createAttemptLimiter>;

const fieldProblem = (field: string, message: string) =>
  new ApiProblem(400, "Invalid request", "Check the request fields.", [
    { field, message },
  ]);

/**
 * Changes my own password: needs the current one, refuses the same one, clears a temporary password's flag and,
 * unless told not to, ends my other sessions (an app token ends with its session). Nothing here is ever logged.
 */
export async function changePassword(
  db: Database,
  limiter: AttemptLimiter,
  input: {
    userId: string;
    sessionId: string;
    currentPassword: string;
    newPassword: string;
    signOutOtherDevices: boolean;
  },
) {
  if (limiter.blocked(input.userId))
    throw new ApiProblem(
      429,
      "Too many attempts",
      "Too many attempts. Wait a few minutes and try again.",
    );
  const [login] = await db
    .select()
    .from(account)
    .where(
      and(
        eq(account.userId, input.userId),
        eq(account.providerId, "credential"),
        isNull(account.deletedAt),
      ),
    );
  if (
    !login?.password ||
    !(await verifyPassword({
      hash: login.password,
      password: input.currentPassword,
    }))
  ) {
    limiter.fail(input.userId);
    throw fieldProblem("currentPassword", "That is not your current password.");
  }
  limiter.clear(input.userId);
  if (
    await verifyPassword({ hash: login.password, password: input.newPassword })
  )
    throw fieldProblem("newPassword", "Choose a password you do not use now.");
  const hash = await hashPassword(input.newPassword);
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(account)
      .set({ password: hash, updatedAt: now })
      .where(eq(account.id, login.id));
    await tx
      .update(user)
      .set({ mustChangePassword: false, updatedAt: now })
      .where(eq(user.id, input.userId));
    if (input.signOutOtherDevices)
      await tx
        .update(session)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          and(
            eq(session.userId, input.userId),
            ne(session.id, input.sessionId),
            isNull(session.deletedAt),
          ),
        );
  });
}

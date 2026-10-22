import type { SessionItem } from "@ledgerline/shared";
import { and, desc, eq, gt, isNull, ne } from "drizzle-orm";
import type { Database } from "../../db/client";
import { session } from "../../db/schema";
import { deviceName } from "../../lib/device-name";
import { ApiProblem } from "../../lib/problem";

const live = (userId: string) =>
  and(
    eq(session.userId, userId),
    isNull(session.deletedAt),
    gt(session.expiresAt, new Date()),
  );

/** The caller's signed-in devices, newest use first (at most 100, and always the one making the request). Tokens and addresses are never returned (ADR 0042). */
export async function listSessions(
  db: Database,
  userId: string,
  currentId: string,
): Promise<SessionItem[]> {
  const rows = await db
    .select()
    .from(session)
    .where(live(userId))
    .orderBy(desc(session.updatedAt), desc(session.id))
    .limit(100);
  // The device in use always shows, even if a hundred newer sessions exist.
  if (!rows.some((row) => row.id === currentId)) {
    const own = await db
      .select()
      .from(session)
      .where(and(live(userId), eq(session.id, currentId)));
    rows.push(...own);
  }
  return rows.map((row) => ({
    id: row.id,
    current: row.id === currentId,
    device: deviceName(row.userAgent),
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.updatedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  }));
}

/** Signs one other device out. Its token stops working at once; a row that is not the caller's is 404. */
export async function revokeSession(
  db: Database,
  userId: string,
  currentId: string,
  id: string,
) {
  if (id === currentId)
    throw new ApiProblem(
      409,
      "Conflict",
      "This is the device you are using. Use Sign out for it.",
    );
  const revoked = await db
    .update(session)
    .set({ deletedAt: new Date() })
    .where(and(live(userId), eq(session.id, id)))
    .returning({ id: session.id });
  if (revoked.length === 0)
    throw new ApiProblem(404, "Not found", "Device not found.");
}

/** Signs every other device out and leaves the one making the request. Returns how many were signed out. */
export async function revokeOtherSessions(
  db: Database,
  userId: string,
  currentId: string,
) {
  const revoked = await db
    .update(session)
    .set({ deletedAt: new Date() })
    .where(and(live(userId), ne(session.id, currentId)))
    .returning({ id: session.id });
  return revoked.length;
}

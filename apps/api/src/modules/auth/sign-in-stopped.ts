import { and, isNotNull, isNull, sql } from "drizzle-orm";
import type { Database } from "../../db/client";
import { user } from "../../db/schema";

/**
 * True when the email in a sign-in request belongs to a person whose sign-in was stopped (ADR 0048). The email is
 * compared as the Users page compares it (`lower(email) = lower(input)`), whatever letters it was typed or stored in.
 */
export async function isSignInStopped(db: Database, body: unknown) {
  const email = (body as { email?: unknown } | null)?.email;
  if (typeof email !== "string") return false;
  const [found] = await db
    .select({ id: user.id })
    .from(user)
    .where(
      and(
        sql`lower(${user.email}) = lower(${email})`,
        isNull(user.deletedAt),
        isNotNull(user.disabledAt),
      ),
    );
  return Boolean(found);
}

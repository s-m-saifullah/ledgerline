import { eq, sql } from "drizzle-orm";
import type { Config } from "../../config";
import type { Database } from "../../db/client";
import { user } from "../../db/schema";
import { createAccount } from "./accounts";

/** Credentials are provisioned from private environment values, never a public setup route. */
export async function provisionOwner(db: Database, config: Config) {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(782194001)`);
    const existing = await tx.select().from(user).limit(1);
    if (existing.length) {
      const [owner] = await tx
        .select()
        .from(user)
        .where(eq(user.email, config.OWNER_EMAIL.toLowerCase()));
      if (!owner || owner.deletedAt)
        throw new Error(
          "Configured owner does not match existing installation",
        );
      // The account the server was set up with is the admin (ADR 0048), also when it was made before the flag existed.
      if (!owner.isAdmin)
        await tx
          .update(user)
          .set({ isAdmin: true })
          .where(eq(user.id, owner.id));
      return;
    }
    await createAccount(tx, {
      email: config.OWNER_EMAIL,
      name: config.OWNER_NAME,
      password: config.OWNER_PASSWORD,
      isAdmin: true,
    });
  });
}

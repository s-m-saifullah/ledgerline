import { newId } from "@ledgerline/shared";
import { eq, sql } from "drizzle-orm";
import type { Config } from "../../config";
import type { Database } from "../../db/client";
import { account, ledgerMembers, ledgers, user } from "../../db/schema";
import { hashPassword } from "./password";

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
      return;
    }
    const userId = newId();
    const ledgerId = newId();
    await tx.insert(user).values({
      id: userId,
      email: config.OWNER_EMAIL.toLowerCase(),
      name: config.OWNER_NAME,
      emailVerified: true,
    });
    await tx.insert(account).values({
      userId,
      accountId: userId,
      providerId: "credential",
      password: await hashPassword(config.OWNER_PASSWORD),
    });
    await tx
      .insert(ledgers)
      .values({ id: ledgerId, name: "Personal ledger", baseCurrency: "USD" });
    await tx.insert(ledgerMembers).values({ ledgerId, userId, role: "owner" });
  });
}

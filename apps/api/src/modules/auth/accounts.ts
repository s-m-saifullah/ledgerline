import { newId } from "@ledgerline/shared";
import type { Database } from "../../db/client";
import { account, ledgerMembers, ledgers, user } from "../../db/schema";
import { assertPasswordAllowed, hashPassword } from "./password";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * One way to make an account: a person, a password sign-in and a ledger of their own with them as its owner.
 * The first run (the admin) and the admin's "Add user" use it (ADR 0048). Call it inside a transaction, so a taken
 * email leaves nothing behind. The password is stored hashed and never returned.
 */
export async function createAccount(
  tx: Transaction,
  input: {
    email: string;
    name: string;
    password: string;
    isAdmin?: boolean;
    mustChangePassword?: boolean;
  },
) {
  assertPasswordAllowed(input.password);
  const userId = newId();
  const ledgerId = newId();
  await tx.insert(user).values({
    id: userId,
    email: input.email.toLowerCase(),
    name: input.name,
    emailVerified: true,
    isAdmin: input.isAdmin ?? false,
    mustChangePassword: input.mustChangePassword ?? false,
  });
  await tx.insert(account).values({
    userId,
    accountId: userId,
    providerId: "credential",
    password: await hashPassword(input.password),
  });
  await tx
    .insert(ledgers)
    .values({ id: ledgerId, name: "Personal ledger", baseCurrency: "USD" });
  await tx.insert(ledgerMembers).values({ ledgerId, userId, role: "owner" });
  return { userId, ledgerId };
}

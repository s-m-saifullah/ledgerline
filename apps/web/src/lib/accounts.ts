import { type Account, accountListSchema } from "@ledgerline/shared";
import { api } from "./api";

const path = (ledgerId: string) => `/ledgers/${ledgerId}/accounts`;
export async function getAccounts(
  ledgerId: string,
  status: "all" | "active" | "archived",
  cursor: string | null,
  signal?: AbortSignal,
) {
  const query = new URLSearchParams({ status, limit: "50" });
  if (cursor) query.set("cursor", cursor);
  return accountListSchema.parse(
    await api(`${path(ledgerId)}?${query}`, { ...(signal ? { signal } : {}) }),
  );
}
async function readEvery(
  ledgerId: string,
  status: "all" | "active",
  signal?: AbortSignal,
) {
  const items: Account[] = [],
    visited = new Set<string>();
  let cursor: string | null = null;
  do {
    const page = await getAccounts(ledgerId, status, cursor, signal);
    items.push(...page.items);
    cursor = page.nextCursor;
    if (cursor && visited.has(cursor))
      throw new Error("Account pagination did not advance");
    if (cursor) visited.add(cursor);
  } while (cursor);
  return items;
}
/** Every active account, read page by page (the Home summary leaves cards and loans out of its own list). */
export const getActiveAccounts = (ledgerId: string, signal?: AbortSignal) =>
  readEvery(ledgerId, "active", signal);
/** Every account, archived ones too. */
export const getAllAccounts = (ledgerId: string, signal?: AbortSignal) =>
  readEvery(ledgerId, "all", signal);
/** A client's balance account (ADR 0030) is managed from Clients, never picked by hand. */
export const pickableAccounts = (accounts: Account[]) =>
  accounts.filter((account) => !account.contactId);

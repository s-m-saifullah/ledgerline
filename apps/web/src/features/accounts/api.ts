import {
  type Account,
  accountListSchema,
  accountSchema,
  type CreateAccount,
  type JsonValue,
} from "@ledgerline/shared";
import { api, prepareFinancialWrite } from "../../lib/api";

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
export async function getAccount(ledgerId: string, accountId: string) {
  return accountSchema.parse(await api(`${path(ledgerId)}/${accountId}`));
}
export function prepareAccountSave(
  ledgerId: string,
  account: Account | undefined,
  body: CreateAccount,
) {
  const run = prepareFinancialWrite<unknown>(
    account ? `${path(ledgerId)}/${account.id}` : path(ledgerId),
    account ? "PATCH" : "POST",
    // Optional fields that are left out stay out of the saved request.
    JSON.parse(
      JSON.stringify(
        account ? { ...body, expectedVersion: account.version } : body,
      ),
    ) as JsonValue,
  );
  return async () => accountSchema.parse(await run());
}
export function prepareAccountArchive(ledgerId: string, account: Account) {
  const run = prepareFinancialWrite<unknown>(
    `${path(ledgerId)}/${account.id}/archive`,
    "POST",
    { expectedVersion: account.version },
  );
  return async () => accountSchema.parse(await run());
}

export function prepareAccountUnarchive(ledgerId: string, account: Account) {
  const run = prepareFinancialWrite<unknown>(
    `${path(ledgerId)}/${account.id}/unarchive`,
    "POST",
    { expectedVersion: account.version },
  );
  return async () => accountSchema.parse(await run());
}

export function prepareAccountDelete(ledgerId: string, item: Account) {
  return prepareFinancialWrite<void>(`${path(ledgerId)}/${item.id}`, "DELETE", {
    expectedVersion: item.version,
  });
}

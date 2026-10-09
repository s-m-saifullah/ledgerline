import {
  type Account,
  accountListSchema,
  accountSchema,
  type CreateAccount,
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
    account ? { ...body, expectedVersion: account.version } : body,
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

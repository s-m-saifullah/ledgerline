import {
  type ForgiveLoan,
  type JsonValue,
  type LoanMove,
  type LoanOpening,
  loanListSchema,
  loanResultSchema,
} from "@ledgerline/shared";
import { api, prepareFinancialWrite } from "../../lib/api";
import { clientPath } from "./api";

export type LoanAction = "lend" | "borrow" | "repay" | "forgive" | "opening";

export async function getLoans(
  ledgerId: string,
  contactId: string,
  signal?: AbortSignal,
) {
  return loanListSchema.parse(
    await api(`${clientPath(ledgerId)}/contacts/${contactId}/loans`, {
      ...(signal ? { signal } : {}),
    }),
  );
}
/** One write per person action; call the returned function again to retry with the same key. */
export function prepareLoanWrite(
  ledgerId: string,
  contactId: string,
  action: LoanAction,
  body: LoanMove | ForgiveLoan | LoanOpening,
) {
  const run = prepareFinancialWrite<unknown>(
    `${clientPath(ledgerId)}/contacts/${contactId}/loans/${action}`,
    "POST",
    JSON.parse(JSON.stringify(body)) as JsonValue,
  );
  return async () => loanResultSchema.parse(await run());
}

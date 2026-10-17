import {
  contactSchema,
  type ForgiveLoan,
  type JsonValue,
  type LoanMove,
  type LoanOpening,
  loanListSchema,
  loanPeopleSchema,
  loanResultSchema,
} from "@ledgerline/shared";
import { api, prepareFinancialWrite } from "../../lib/api";

const clientPath = (ledgerId: string) => `/ledgers/${ledgerId}`;

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
export async function getLoanPeople(
  ledgerId: string,
  status: string,
  text: string,
  cursor: string | null,
  signal?: AbortSignal,
) {
  const query = new URLSearchParams({ status, limit: "50" });
  if (text) query.set("text", text);
  if (cursor) query.set("cursor", cursor);
  return loanPeopleSchema.parse(
    await api(`${clientPath(ledgerId)}/loans?${query}`, {
      ...(signal ? { signal } : {}),
    }),
  );
}
export async function getPerson(ledgerId: string, id: string) {
  return contactSchema.parse(
    await api(`${clientPath(ledgerId)}/contacts/${id}`),
  );
}
/** A new person for loans: it shows under Loans, not under Clients (ADR 0030). */
export function prepareCreatePerson(ledgerId: string, name: string) {
  const run = prepareFinancialWrite<unknown>(
    `${clientPath(ledgerId)}/contacts`,
    "POST",
    { name, origin: "loan" },
  );
  return async () => contactSchema.parse(await run());
}
export function preparePersonChange(
  ledgerId: string,
  person: { id: string; version: number },
  change:
    | {
        action: "rename";
        name: string;
        phone: string | null;
        email: string | null;
        note: string | null;
      }
    | { action: "archive" | "unarchive" },
) {
  const run =
    change.action === "rename"
      ? prepareFinancialWrite<unknown>(
          `${clientPath(ledgerId)}/contacts/${person.id}`,
          "PATCH",
          {
            name: change.name,
            phone: change.phone,
            email: change.email,
            note: change.note,
            expectedVersion: person.version,
          },
        )
      : prepareFinancialWrite<unknown>(
          `${clientPath(ledgerId)}/contacts/${person.id}/${change.action}`,
          "POST",
          { expectedVersion: person.version },
        );
  return async () => contactSchema.parse(await run());
}

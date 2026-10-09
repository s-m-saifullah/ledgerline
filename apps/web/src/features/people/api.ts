import {
  contactListSchema,
  contactSchema,
  type JsonValue,
  paymentListSchema,
  paymentSchema,
  receiptPreviewSchema,
  receiptSchema,
  receivableEventListSchema,
  receivableListSchema,
  receivableSchema,
} from "@ledgerline/shared";
import { api, prepareFinancialWrite } from "../../lib/api";
export const peoplePath = (ledgerId: string) => `/ledgers/${ledgerId}`;
export async function getPerson(l: string, id: string) {
  return contactSchema.parse(await api(`${peoplePath(l)}/contacts/${id}`));
}
export async function getService(l: string, id: string) {
  return receivableSchema.parse(
    await api(`${peoplePath(l)}/receivables/${id}`),
  );
}
export async function getPayment(l: string, id: string, pid: string) {
  return paymentSchema.parse(
    await api(`${peoplePath(l)}/receivables/${id}/payments/${pid}`),
  );
}
export async function getReceipt(l: string, id: string) {
  return receiptSchema.parse(await api(`${peoplePath(l)}/receipts/${id}`));
}
export async function getReceiptPreview(
  l: string,
  contactId: string,
  amount: number,
  signal?: AbortSignal,
) {
  return receiptPreviewSchema.parse(
    await api(
      `${peoplePath(l)}/contacts/${contactId}/receipt-preview?amount=${amount}`,
      { ...(signal ? { signal } : {}) },
    ),
  );
}
export async function getPeople(
  l: string,
  status: string,
  text: string,
  cursor: string | null,
  signal?: AbortSignal,
) {
  const q = new URLSearchParams({ status, limit: "50" });
  if (text) q.set("text", text);
  if (cursor) q.set("cursor", cursor);
  return contactListSchema.parse(
    await api(`${peoplePath(l)}/contacts?${q}`, {
      ...(signal ? { signal } : {}),
    }),
  );
}
export async function getServices(
  l: string,
  id: string,
  cursor: string | null,
  signal?: AbortSignal,
) {
  const q = new URLSearchParams({ contactId: id, limit: "50" });
  if (cursor) q.set("cursor", cursor);
  return receivableListSchema.parse(
    await api(`${peoplePath(l)}/receivables?${q}`, {
      ...(signal ? { signal } : {}),
    }),
  );
}
export async function getPayments(
  l: string,
  id: string,
  cursor: string | null,
  signal?: AbortSignal,
) {
  const q = new URLSearchParams({ limit: "50" });
  if (cursor) q.set("cursor", cursor);
  return paymentListSchema.parse(
    await api(`${peoplePath(l)}/receivables/${id}/payments?${q}`, {
      ...(signal ? { signal } : {}),
    }),
  );
}
export async function getHistory(
  l: string,
  id: string,
  cursor: string | null,
  signal?: AbortSignal,
) {
  const q = new URLSearchParams({ limit: "50" });
  if (cursor) q.set("cursor", cursor);
  return receivableEventListSchema.parse(
    await api(`${peoplePath(l)}/contacts/${id}/history?${q}`, {
      ...(signal ? { signal } : {}),
    }),
  );
}
export function preparePeopleWrite(
  l: string,
  path: string,
  method: "POST" | "PATCH" | "DELETE",
  body: JsonValue,
) {
  return prepareFinancialWrite<unknown>(peoplePath(l) + path, method, body);
}

export async function getAllPeople(ledgerId: string, signal?: AbortSignal) {
  const items = [];
  let cursor: string | null = null;
  const seen = new Set<string>();
  do {
    const page = await getPeople(ledgerId, "all", "", cursor, signal);
    items.push(...page.items);
    cursor = page.nextCursor;
    if (cursor && seen.has(cursor))
      throw new Error("People pagination did not advance.");
    if (cursor) seen.add(cursor);
  } while (cursor);
  return items;
}

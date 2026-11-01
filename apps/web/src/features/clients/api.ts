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

const clientPath = (ledgerId: string) => `/ledgers/${ledgerId}`;
/** One client; `month` (YYYY-MM) is the month its `paidThisMonth` covers. */
export async function getClient(
  l: string,
  id: string,
  month?: string,
  signal?: AbortSignal,
) {
  const q = month ? `?month=${month}` : "";
  return contactSchema.parse(
    await api(`${clientPath(l)}/contacts/${id}${q}`, {
      ...(signal ? { signal } : {}),
    }),
  );
}
export async function getService(l: string, id: string) {
  return receivableSchema.parse(
    await api(`${clientPath(l)}/receivables/${id}`),
  );
}
export async function getPayment(l: string, id: string, pid: string) {
  return paymentSchema.parse(
    await api(`${clientPath(l)}/receivables/${id}/payments/${pid}`),
  );
}
export async function getReceipt(l: string, id: string) {
  return receiptSchema.parse(await api(`${clientPath(l)}/receipts/${id}`));
}
export async function getReceiptPreview(
  l: string,
  contactId: string,
  amount: number,
  currency: string,
  signal?: AbortSignal,
) {
  return receiptPreviewSchema.parse(
    await api(
      `${clientPath(l)}/contacts/${contactId}/receipt-preview?amount=${amount}&currency=${currency}`,
      { ...(signal ? { signal } : {}) },
    ),
  );
}
export async function getClients(
  l: string,
  status: string,
  text: string,
  cursor: string | null,
  signal?: AbortSignal,
  month?: string,
) {
  // Clients leave out people who were only added for loans (ADR 0030).
  const q = new URLSearchParams({ status, limit: "50", kind: "clients" });
  if (text) q.set("text", text);
  if (month) q.set("month", month);
  if (cursor) q.set("cursor", cursor);
  return contactListSchema.parse(
    await api(`${clientPath(l)}/contacts?${q}`, {
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
    await api(`${clientPath(l)}/receivables?${q}`, {
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
    await api(`${clientPath(l)}/receivables/${id}/payments?${q}`, {
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
    await api(`${clientPath(l)}/contacts/${id}/history?${q}`, {
      ...(signal ? { signal } : {}),
    }),
  );
}
export function prepareClientWrite(
  l: string,
  path: string,
  method: "POST" | "PATCH" | "DELETE",
  body: JsonValue,
) {
  return prepareFinancialWrite<unknown>(clientPath(l) + path, method, body);
}

export async function getAllClients(
  ledgerId: string,
  signal?: AbortSignal,
  month?: string,
) {
  const items = [];
  let cursor: string | null = null;
  const seen = new Set<string>();
  do {
    const page = await getClients(ledgerId, "all", "", cursor, signal, month);
    items.push(...page.items);
    cursor = page.nextCursor;
    if (cursor && seen.has(cursor))
      throw new Error("Clients pagination did not advance.");
    if (cursor) seen.add(cursor);
  } while (cursor);
  return items;
}

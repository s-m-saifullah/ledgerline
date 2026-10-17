import {
  contactSchema,
  createContactSchema,
  createPaymentSchema,
  createReceiptSchema,
  createReceivableSchema,
  type JsonValue,
  paymentSchema,
  type ReceiptPreview as ReceiptPreviewData,
  receiptSchema,
  receivableSchema,
  updateContactSchema,
  updatePaymentSchema,
  updateReceiptSchema,
  updateReceivableSchema,
} from "@ledgerline/shared";
import type { QueryClient } from "@tanstack/react-query";
import { prepareClientWrite } from "../api";
import { positiveMoney } from "../form";
import type { PaymentDerived } from "./derive";
import {
  bumped,
  type ClientOperation,
  expectedPayments,
  type Fields,
} from "./types";

/** Everything a prepared write needs from the workspace. */
export type PrepareContext = {
  ledgerId: string | undefined;
  values: Fields;
  derived: PaymentDerived;
  previewData: ReceiptPreviewData | undefined;
  /** localStorage keys for the last-used payment and tip categories. */
  preference: string;
  tipPreference: string;
  queryClient: QueryClient;
  completed: (message: string, next?: ClientOperation | null) => void;
  setDeletedClientId: (id: string) => void;
};
type Kind<K extends ClientOperation["kind"]> = Extract<
  ClientOperation,
  { kind: K }
>;
type Prepared = () => Promise<void>;

/** The extra fields a payment or receipt carries when the account is in another currency. */
function requestParts(ctx: PrepareContext) {
  const { values, derived } = ctx;
  const {
    needsReceived,
    accountCurrency,
    rateSettable,
    creatingPayment,
    itemCurrency,
    extra,
  } = derived;
  /** What arrived, and any rate set by hand, when the account's currency calls for them. */
  function received() {
    return {
      ...(needsReceived && accountCurrency
        ? {
            receivedAmount: positiveMoney(
              values.receivedAmount,
              accountCurrency,
            ),
          }
        : {}),
      ...(rateSettable && values.fxRate ? { fxRate: values.fxRate } : {}),
    };
  }
  /** The tip saved with a new payment, in the receiving account's currency (ADR 0027). */
  function tipField() {
    if (!creatingPayment) return {};
    const currency = accountCurrency ?? itemCurrency;
    const amount =
      needsReceived && accountCurrency
        ? values.tipAmount.trim()
          ? positiveMoney(values.tipAmount, accountCurrency).amount
          : 0
        : (extra?.tip ?? 0);
    if (!amount) return {};
    if (!values.tipCategoryId)
      throw new Error("Choose a category for the tip.");
    return {
      tip: {
        amount: { amount, currency },
        categoryId: values.tipCategoryId,
      },
    };
  }
  return { received, tipField };
}

function prepareContact(
  operation: Kind<"contact">,
  ctx: PrepareContext,
  l: string,
): Prepared {
  const { values, completed } = ctx;
  const fields = {
    name: values.name,
    phone: values.phone || null,
    email: values.email || null,
    note: values.note || null,
  };
  // Validate now; the plain fields are what is sent (an omitted origin means a client).
  createContactSchema.parse(fields);
  const run = prepareClientWrite(
    l,
    operation.client ? `/contacts/${operation.client.id}` : "/contacts",
    operation.client ? "PATCH" : "POST",
    operation.client
      ? updateContactSchema.parse({
          ...fields,
          expectedVersion: operation.client.version,
        })
      : fields,
  );
  return async () => {
    contactSchema.parse(await run());
    completed("Client saved.");
  };
}

function prepareService(
  operation: Kind<"service">,
  ctx: PrepareContext,
  l: string,
): Prepared {
  const { values, completed } = ctx;
  const parsed = createReceivableSchema.parse({
    contactId: values.contactId,
    description: values.description,
    serviceDate: values.serviceDate,
    // Blank means no time (null clears a saved one).
    serviceTime: values.serviceTime || null,
    dueDate: values.dueDate || null,
    amount: positiveMoney(values.amount, values.currency),
  });
  const withTime = <T extends { serviceTime?: string | null | undefined }>(
    row: T,
  ) => ({ ...row, serviceTime: row.serviceTime ?? null });
  const body = withTime(parsed);
  const run = prepareClientWrite(
    l,
    operation.service ? `/receivables/${operation.service.id}` : "/receivables",
    operation.service ? "PATCH" : "POST",
    operation.service
      ? withTime(
          updateReceivableSchema.parse({
            ...body,
            expectedVersion: operation.service.version,
          }),
        )
      : body,
  );
  return async () => {
    const row = receivableSchema.parse(await run());
    completed(
      "Service saved.",
      operation.service
        ? null
        : { kind: "action", action: "deleteService", service: row },
    );
  };
}

function preparePayment(
  operation: Kind<"payment">,
  ctx: PrepareContext,
  l: string,
): Prepared {
  const { values, completed, preference, tipPreference } = ctx;
  const { extra } = ctx.derived;
  const { received, tipField } = requestParts(ctx);
  const body = createPaymentSchema.parse({
    amount: extra
      ? {
          amount: extra.settle,
          currency: operation.service.amount.currency,
        }
      : positiveMoney(values.amount, operation.service.amount.currency),
    ...received(),
    ...tipField(),
    accountId: values.accountId,
    categoryId: values.categoryId,
    date: values.date,
    time: values.time || null,
    note: values.note || null,
    expectedReceivableVersion: operation.service.version,
  });
  const run = prepareClientWrite(
    l,
    `/receivables/${operation.service.id}/payments${operation.payment ? `/${operation.payment.id}` : ""}`,
    operation.payment ? "PATCH" : "POST",
    // Optional fields that were left out stay out of the saved request.
    JSON.parse(
      JSON.stringify(
        operation.payment
          ? updatePaymentSchema.parse({
              ...body,
              expectedVersion: operation.payment.version,
            })
          : body,
      ),
    ) as JsonValue,
  );
  return async () => {
    const p = paymentSchema.parse(await run());
    localStorage.setItem(preference, p.transaction.categoryId ?? "");
    if (p.tip) localStorage.setItem(tipPreference, p.tip.categoryId);
    completed(
      "Payment saved.",
      operation.payment
        ? null
        : {
            kind: "action",
            action: "deletePayment",
            service: p.receivable,
            payment: p,
          },
    );
  };
}

function prepareReceipt(
  operation: Kind<"receipt">,
  ctx: PrepareContext,
  l: string,
): Prepared {
  const { values, completed, preference, tipPreference } = ctx;
  const { extra } = ctx.derived;
  const preview = { data: ctx.previewData };
  const { received, tipField } = requestParts(ctx);
  const fields = {
    accountId: values.accountId,
    categoryId: values.categoryId,
    date: values.date,
    time: values.time || null,
    note: values.note || null,
    ...received(),
  };
  if (operation.receipt) {
    const run = prepareClientWrite(
      l,
      `/receipts/${operation.receipt.id}`,
      "PATCH",
      // Optional fields that were left out stay out of the saved request.
      JSON.parse(
        JSON.stringify(
          updateReceiptSchema.parse({
            ...fields,
            expectedPayments: expectedPayments(operation.receipt),
          }),
        ),
      ) as JsonValue,
    );
    return async () => {
      receiptSchema.parse(await run());
      completed("Receipt saved.");
    };
  }
  const amount = extra
      ? { amount: extra.settle, currency: values.receiptCurrency }
      : positiveMoney(values.amount, values.receiptCurrency),
    shown = preview.data;
  if (
    !shown ||
    shown.amount.amount !== amount.amount ||
    shown.exceedsBalance ||
    shown.tooManyServices
  )
    throw new Error("Wait for the allocation preview to match the amount.");
  const run = prepareClientWrite(
    l,
    `/contacts/${operation.client.id}/receipts`,
    "POST",
    JSON.parse(
      JSON.stringify(
        createReceiptSchema.parse({
          ...fields,
          amount,
          ...tipField(),
          expectedAllocations: shown.allocations.map((a) => ({
            receivableId: a.receivableId,
            expectedVersion: a.version,
            applied: a.applied.amount,
          })),
        }),
      ),
    ) as JsonValue,
  );
  return async () => {
    const r = receiptSchema.parse(await run());
    localStorage.setItem(preference, values.categoryId);
    if (r.payments.some((p) => p.tip))
      localStorage.setItem(tipPreference, values.tipCategoryId);
    completed("Payment applied to the client's services.", {
      kind: "action",
      action: "deleteReceipt",
      receipt: r,
    });
  };
}

function prepareAction(
  operation: Kind<"action">,
  ctx: PrepareContext,
  l: string,
): Prepared {
  const { values, completed, queryClient, setDeletedClientId } = ctx;
  const a = operation.action,
    s = operation.service,
    p = operation.payment,
    r = operation.receipt,
    client = operation.client;
  let path = "",
    method: "POST" | "DELETE" = "POST",
    body: JsonValue = {};
  if (r) {
    path = `/receipts/${r.id}${a === "restoreReceipt" ? "/restore" : ""}`;
    method = a === "deleteReceipt" ? "DELETE" : "POST";
    body = { expectedPayments: expectedPayments(r) };
  } else if (client) {
    path = `/contacts/${client.id}${a === "deleteContact" ? "" : `/${a}`}`;
    method = a === "deleteContact" ? "DELETE" : "POST";
    body = { expectedVersion: client.version };
  } else if (p) {
    path = `/receivables/${p.receivableId}/payments/${p.id}${a === "restorePayment" ? "/restore" : ""}`;
    method = a === "deletePayment" ? "DELETE" : "POST";
    body = {
      expectedVersion: p.version,
      expectedReceivableVersion: (s ?? p.receivable).version,
    };
  } else if (s) {
    path = `/receivables/${s.id}${a === "writeOff" ? "/write-off" : a === "restoreService" ? "/restore" : a === "reopen" ? "/reopen" : ""}`;
    method = a === "deleteService" ? "DELETE" : "POST";
    body = {
      expectedVersion: s.version,
      ...(a === "writeOff" ? { reason: values.reason || null } : {}),
    };
  } else throw new Error("Missing action target.");
  const run = prepareClientWrite(l, path, method, body);
  return async () => {
    const result = await run();
    let next: ClientOperation | null = null;
    if (a === "deleteService" && s)
      next = {
        kind: "action",
        action: "restoreService",
        service: { ...s, version: s.version + 1 },
      };
    if (a === "deleteReceipt" && r)
      next = { kind: "action", action: "restoreReceipt", receipt: bumped(r) };
    if (a === "deletePayment" && p) {
      const service = {
        ...(s ?? p.receivable),
        version: (s ?? p.receivable).version + 1,
      };
      next = {
        kind: "action",
        action: "restorePayment",
        service,
        payment: { ...p, version: p.version + 1, receivable: service },
      };
    }
    if ((a === "writeOff" || a === "reopen") && s) {
      const row = receivableSchema.parse(result);
      next = {
        kind: "action",
        action: a === "writeOff" ? "reopen" : "writeOff",
        service: row,
        ...(a === "reopen" ? { reason: s.writeOffReason } : {}),
      };
    }
    if (a === "deleteContact" && client) {
      // Drop the deleted client's detail queries first so nothing refetches them (they would 404).
      for (const key of ["contacts", "receivables", "clientHistory"]) {
        queryClient.removeQueries({
          queryKey: [key, l],
          predicate: (query) => query.queryKey.includes(client.id),
        });
      }
      setDeletedClientId(client.id);
      completed("Client deleted.", null);
      return;
    }
    completed("Action completed.", next);
  };
}

/** Validates the form and returns the request to send; it throws when the form is not ready. */
export function prepareOperation(
  operation: ClientOperation,
  ctx: PrepareContext,
): Prepared {
  if (!ctx.ledgerId) throw new Error("Choose a ledger.");
  const l = ctx.ledgerId;
  if (operation.kind === "contact") return prepareContact(operation, ctx, l);
  if (operation.kind === "service") return prepareService(operation, ctx, l);
  if (operation.kind === "payment") return preparePayment(operation, ctx, l);
  if (operation.kind === "receipt") return prepareReceipt(operation, ctx, l);
  return prepareAction(operation, ctx, l);
}

import {
  type Contact,
  contactSchema,
  createContactSchema,
  createPaymentSchema,
  createReceiptSchema,
  createReceivableSchema,
  currencyDigits,
  deriveRate,
  type JsonValue,
  paymentSchema,
  type Receipt,
  type ReceiptPreview as ReceiptPreviewData,
  type Receivable,
  type ReceivablePayment,
  receiptSchema,
  receivableSchema,
  type Transaction,
  updateContactSchema,
  updatePaymentSchema,
  updateReceiptSchema,
  updateReceivableSchema,
} from "@ledgerline/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  type ComponentPropsWithoutRef,
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { AmountInput } from "../../components/amount-input";
import { DateTimeInput } from "../../components/date-time-input";
import { EditorDialog } from "../../components/editor-dialog";
import { NativeSelect } from "../../components/native-select";
import { Toast } from "../../components/toast";
import { UndoPill } from "../../components/undo-pill";
import { ApiError } from "../../lib/api";
import { decimalFromCents, formatMoney } from "../accounts/money";
import { getCategories } from "../categories/api";
import { CategoryPicker } from "../categories/picker";
import { useBaseValues } from "../currencies/base-value";
import { EntryRate } from "../currencies/entry-rate";
import { rateSentence } from "../currencies/format";
import { PrivacyContext } from "../shell/preferences";
import { getAllAccounts } from "../transactions/api";
import { amountMinor, localToday } from "../transactions/form";
import {
  getAllClients,
  getClient,
  getPayment,
  getReceipt,
  getReceiptPreview,
  getService,
  prepareClientWrite,
} from "./api";
import { paymentDefault, positiveMoney, splitExtra, tipDefault } from "./form";
import { HourlyHelper } from "./hourly-helper";

type ClientOperation =
  | { kind: "contact"; client?: Contact }
  | { kind: "service"; client: Contact; service?: Receivable }
  | {
      kind: "payment";
      service: Receivable;
      client?: Contact;
      payment?: ReceivablePayment;
    }
  | { kind: "receipt"; client: Contact; receipt?: Receipt; receiptId?: string }
  | {
      kind: "action";
      action:
        | "archive"
        | "unarchive"
        | "deleteContact"
        | "deleteService"
        | "restoreService"
        | "writeOff"
        | "reopen"
        | "deletePayment"
        | "restorePayment"
        | "deleteReceipt"
        | "restoreReceipt";
      receipt?: Receipt;
      receiptId?: string;
      client?: Contact;
      reason?: string | null;
      service?: Receivable;
      payment?: ReceivablePayment;
    };
type Workspace = {
  blocked: boolean;
  /** The most recently deleted client, so the Clients page can leave their detail view. */
  deletedClientId: string | null;
  open: (op: ClientOperation, trigger: string) => void;
};
const Context = createContext<Workspace | null>(null);
export const useClientsWorkspace = () => useContext(Context);
type Fields = {
  name: string;
  phone: string;
  email: string;
  note: string;
  description: string;
  serviceDate: string;
  serviceTime: string;
  dueDate: string;
  amount: string;
  // Money owed in other currencies (ADR 0022).
  currency: string;
  receiptCurrency: string;
  receivedAmount: string;
  // Extra money received on top of what is owed (ADR 0027).
  tipAmount: string;
  tipCategoryId: string;
  fxRate: string;
  accountId: string;
  categoryId: string;
  date: string;
  time: string;
  contactId: string;
  reason: string;
};
const empty = (): Fields => ({
  name: "",
  phone: "",
  email: "",
  note: "",
  description: "",
  serviceDate: localToday(),
  serviceTime: "",
  dueDate: "",
  amount: "",
  currency: "USD",
  receiptCurrency: "USD",
  receivedAmount: "",
  tipAmount: "",
  tipCategoryId: "",
  fxRate: "",
  accountId: "",
  categoryId: "",
  date: localToday(),
  time: "",
  contactId: "",
  reason: "",
});
function fieldsFor(op: ClientOperation): Fields {
  const f = empty();
  if (op.kind === "contact" && op.client)
    Object.assign(f, {
      name: op.client.name,
      phone: op.client.phone ?? "",
      email: op.client.email ?? "",
      note: op.client.note ?? "",
    });
  if (op.kind === "service")
    Object.assign(f, {
      contactId: op.client.id,
      ...(op.service
        ? {
            description: op.service.description,
            serviceDate: op.service.serviceDate,
            serviceTime: op.service.serviceTime ?? "",
            dueDate: op.service.dueDate ?? "",
            currency: op.service.amount.currency,
            amount: decimalFromCents(
              op.service.amount.amount,
              currencyDigits(op.service.amount.currency),
            ),
          }
        : {}),
    });
  if (op.kind === "payment")
    Object.assign(f, {
      amount: decimalFromCents(
        op.payment?.amount.amount ?? op.service.outstanding.amount,
        currencyDigits(op.service.amount.currency),
      ),
      ...(op.payment
        ? {
            // What arrived, when the account's currency is not the service's.
            receivedAmount:
              op.payment.transaction.amount.currency !==
              op.service.amount.currency
                ? decimalFromCents(
                    op.payment.transaction.amount.amount,
                    currencyDigits(op.payment.transaction.amount.currency),
                  )
                : "",
            accountId: op.payment.transaction.accountId,
            categoryId: op.payment.transaction.categoryId ?? "",
            date: op.payment.transaction.date,
            time: op.payment.transaction.time ?? "",
            note: op.payment.transaction.note ?? "",
          }
        : {}),
    });
  if (op.kind === "receipt") {
    const first = op.receipt?.payments[0]?.transaction;
    const owed = op.client.openBalances;
    Object.assign(f, {
      receiptCurrency: op.receipt
        ? op.receipt.amount.currency
        : ((owed.find((b) => b.currency === "USD") ?? owed[0])?.currency ??
          "USD"),
      ...(op.receipt
        ? {
            amount: decimalFromCents(
              op.receipt.amount.amount,
              currencyDigits(op.receipt.amount.currency),
            ),
            receivedAmount:
              first && first.amount.currency !== op.receipt.amount.currency
                ? decimalFromCents(
                    op.receipt.payments.reduce(
                      (sum, p) => sum + p.transaction.amount.amount,
                      0,
                    ),
                    currencyDigits(first.amount.currency),
                  )
                : "",
          }
        : {}),
      ...(first
        ? {
            accountId: first.accountId,
            categoryId: first.categoryId ?? "",
            date: first.date,
            time: first.time ?? "",
            note: first.note ?? "",
          }
        : {}),
    });
  }
  if (op.kind === "action")
    f.reason = op.reason ?? op.service?.writeOffReason ?? "";
  return f;
}
const names = {
  archive: "Archive client",
  unarchive: "Unarchive client",
  deleteContact: "Delete client",
  deleteService: "Delete service",
  restoreService: "Undo service deletion",
  writeOff: "Write off remainder",
  reopen: "Reopen service",
  deletePayment: "Delete payment",
  restorePayment: "Undo payment deletion",
  deleteReceipt: "Delete receipt",
  restoreReceipt: "Undo receipt deletion",
};
/** Concurrency tokens a receipt change must echo back, optionally after a version bump. */
function expectedPayments(receipt: Receipt, bump = 0) {
  return receipt.payments.map((p) => ({
    paymentId: p.id,
    expectedVersion: p.version + bump,
    expectedReceivableVersion: p.receivable.version + bump,
  }));
}
function bumped(receipt: Receipt): Receipt {
  return {
    ...receipt,
    payments: receipt.payments.map((p) => ({
      ...p,
      version: p.version + 1,
      receivable: { ...p.receivable, version: p.receivable.version + 1 },
    })),
  };
}
export function ClientsWorkspace({
  ledgerId,
  actorId,
  writable,
  blocked,
  onLock,
  linkedTransaction,
  onLinkedOpened,
  children,
}: {
  ledgerId: string | undefined;
  actorId: string | undefined;
  writable: boolean;
  blocked: boolean;
  onLock: (value: boolean) => void;
  linkedTransaction: Transaction | null;
  onLinkedOpened: () => void;
  children: ReactNode;
}) {
  const queryClient = useQueryClient(),
    privateMode = useContext(PrivacyContext);
  const [op, setOp] = useState<ClientOperation | null>(null),
    [values, setValues] = useState<Fields>(empty),
    [open, setOpen] = useState(false),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [error, setError] = useState(""),
    [conflict, setConflict] = useState(false),
    [trigger, setTrigger] = useState("main-content"),
    [notice, setNotice] = useState(""),
    [deletedClientId, setDeletedClientId] = useState<string | null>(null),
    // The toast closes itself; an Undo stays reachable from a pill until used or replaced.
    [toastDone, setToastDone] = useState(false),
    [undo, setUndo] = useState<ClientOperation | null>(null);
  const attempt = useRef<(() => Promise<void>) | null>(null),
    inFlight = useRef(false),
    loadSequence = useRef(0);
  const paymentMode = op?.kind === "payment" || op?.kind === "receipt";
  const allowWrite =
    writable && !(op?.kind === "payment" && op.service.status === "writtenOff");
  const clients = useQuery({
    queryKey: ["contacts", ledgerId, "choices"],
    queryFn: ({ signal }) => getAllClients(ledgerId as string, signal),
    enabled: !!ledgerId && op?.kind === "service" && !!op.service,
  });
  const accounts = useQuery({
    queryKey: ["accounts", ledgerId, "history"],
    queryFn: ({ signal }) => getAllAccounts(ledgerId as string, signal),
    enabled: !!ledgerId && paymentMode,
  });
  const categories = useQuery({
    queryKey: ["categories", ledgerId],
    queryFn: ({ signal }) => getCategories(ledgerId as string, signal),
    enabled: !!ledgerId && paymentMode,
  });
  const baseValues = useBaseValues(ledgerId);
  // The currency a payment settles in, and what the chosen account uses (ADR 0022).
  const itemCurrency =
    op?.kind === "payment"
      ? op.service.amount.currency
      : op?.kind === "receipt"
        ? op.receipt
          ? op.receipt.amount.currency
          : values.receiptCurrency
        : "USD";
  const accountCurrency =
    accounts.data?.find((a) => a.id === values.accountId)?.currency ?? null;
  const needsReceived =
    paymentMode && !!accountCurrency && accountCurrency !== itemCurrency;
  const rateSettable =
    paymentMode &&
    !!accountCurrency &&
    accountCurrency !== "USD" &&
    itemCurrency !== "USD";
  const receiptCreate = op?.kind === "receipt" && !op.receipt ? op : null;
  // Money received above what is owed settles the balance and the rest is a tip (ADR 0027).
  const creatingPayment =
    (op?.kind === "payment" && !op.payment) || !!receiptCreate;
  const outstanding =
    op?.kind === "payment"
      ? op.service.outstanding.amount
      : receiptCreate
        ? owedInCurrency(receiptCreate.client, values.receiptCurrency)
        : 0;
  const extra =
    creatingPayment && !needsReceived
      ? splitExtra(values.amount, itemCurrency, outstanding)
      : null;
  const tipMinor = !creatingPayment
    ? 0
    : needsReceived
      ? accountCurrency
        ? (amountMinor(values.tipAmount, accountCurrency) ?? 0)
        : 0
      : (extra?.tip ?? 0);
  const previewCents = (() => {
    if (!receiptCreate) return null;
    if (extra) return extra.settle;
    try {
      return positiveMoney(values.amount, values.receiptCurrency).amount;
    } catch {
      return null;
    }
  })();
  const preview = useQuery({
    queryKey: [
      "receivables",
      ledgerId,
      "receipt-preview",
      receiptCreate?.client.id,
      values.receiptCurrency,
      previewCents,
    ],
    queryFn: ({ signal }) =>
      getReceiptPreview(
        ledgerId as string,
        (receiptCreate as { client: Contact }).client.id,
        previewCents as number,
        values.receiptCurrency,
        signal,
      ),
    enabled: !!ledgerId && !!receiptCreate && previewCents !== null && open,
    staleTime: 0,
    retry: false,
  });
  const preference = `ledgerline:payment-category:${actorId}:${ledgerId}`;
  const tipPreference = `ledgerline:tip-category:${actorId}:${ledgerId}`;
  const invalidate = () => {
    for (const key of [
      "contacts",
      "receivables",
      "clientHistory",
      "accounts",
      "transactions",
      "home",
    ])
      void queryClient.invalidateQueries({ queryKey: [key, ledgerId] });
  };
  const frozen = busy || uncertain || loading;
  const dismiss = () => {
    if (busy) return;
    setOpen(false);
    if (!uncertain) {
      loadSequence.current++;
      setOp(null);
      setLoading(false);
      onLock(false);
      if (linkedTransaction) onLinkedOpened();
    }
  };
  async function begin(next: ClientOperation, id: string, fresh = true) {
    if (inFlight.current || uncertain || blocked) return;
    const sequence = ++loadSequence.current;
    setOpen(true);
    setTrigger(id);
    setError("");
    setConflict(false);
    setNotice("");
    setUndo(null);
    onLock(true);
    setOp(next);
    setValues(fieldsFor(next));
    if (!ledgerId || !fresh) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      let loaded = next;
      if (next.kind === "contact" && next.client)
        loaded = { ...next, client: await getClient(ledgerId, next.client.id) };
      else if (next.kind === "service")
        loaded = {
          ...next,
          client: await getClient(ledgerId, next.client.id),
          ...(next.service
            ? { service: await getService(ledgerId, next.service.id) }
            : {}),
        };
      else if (next.kind === "receipt")
        loaded = {
          ...next,
          client: await getClient(ledgerId, next.client.id),
          ...(next.receipt || next.receiptId
            ? {
                receipt: await getReceipt(
                  ledgerId,
                  (next.receipt?.id ?? next.receiptId) as string,
                ),
              }
            : {}),
        };
      else if (next.kind === "payment") {
        const service = await getService(ledgerId, next.service.id);
        loaded = {
          ...next,
          service,
          client: await getClient(ledgerId, service.contactId),
          ...(next.payment
            ? {
                payment: await getPayment(
                  ledgerId,
                  service.id,
                  next.payment.id,
                ),
              }
            : {}),
        };
      } else if (next.kind === "action") {
        loaded = {
          ...next,
          ...(next.client
            ? { client: await getClient(ledgerId, next.client.id) }
            : {}),
          ...(next.service
            ? { service: await getService(ledgerId, next.service.id) }
            : {}),
          ...(next.receipt || next.receiptId
            ? {
                receipt: await getReceipt(
                  ledgerId,
                  (next.receipt?.id ?? next.receiptId) as string,
                ),
              }
            : {}),
          ...(next.payment
            ? {
                payment: await getPayment(
                  ledgerId,
                  next.payment.receivableId,
                  next.payment.id,
                ),
              }
            : {}),
        };
        if (loaded.payment) loaded.service = loaded.payment.receivable;
      }
      const fields = fieldsFor(loaded);
      if (loaded.kind === "payment" || loaded.kind === "receipt") {
        const [freshAccounts, freshCategories] = await Promise.all([
          getAllAccounts(ledgerId),
          getCategories(ledgerId),
        ]);
        if (loadSequence.current !== sequence) return;
        queryClient.setQueryData(
          ["accounts", ledgerId, "history"],
          freshAccounts,
        );
        queryClient.setQueryData(["categories", ledgerId], freshCategories);
        if (!(loaded.kind === "payment" ? loaded.payment : loaded.receipt)) {
          fields.accountId = freshAccounts.find((a) => !a.archivedAt)?.id ?? "";
          fields.categoryId = paymentDefault(
            freshCategories,
            localStorage.getItem(preference),
          );
          fields.tipCategoryId = tipDefault(
            freshCategories,
            localStorage.getItem(tipPreference),
          );
        }
      }
      if (loadSequence.current === sequence) {
        setOp(loaded);
        setValues(fields);
      }
    } catch (e) {
      if (loadSequence.current === sequence) {
        setError(e instanceof Error ? e.message : "Could not load details.");
        setConflict(true);
      }
    } finally {
      if (loadSequence.current === sequence) setLoading(false);
    }
  }
  useEffect(() => {
    if (
      !linkedTransaction?.receivableId ||
      !linkedTransaction.receivablePaymentId ||
      !ledgerId
    )
      return;
    let active = true;
    const sequence = ++loadSequence.current;
    const row = linkedTransaction;
    setOp(null);
    setLoading(true);
    setOpen(true);
    onLock(true);
    setTrigger(`transaction-${row.id}`);
    setError("");
    void getPayment(
      ledgerId,
      row.receivableId as string,
      row.receivablePaymentId as string,
    )
      .then(async (payment) => {
        const client = await getClient(ledgerId, payment.receivable.contactId);
        const receipt = payment.receiptId
          ? await getReceipt(ledgerId, payment.receiptId)
          : undefined;
        if (active && loadSequence.current === sequence) {
          const next: ClientOperation = receipt
            ? { kind: "receipt", client, receipt }
            : {
                kind: "payment",
                service: payment.receivable,
                client,
                payment,
              };
          setOp(next);
          setValues(fieldsFor(next));
          setLoading(false);
          onLinkedOpened();
        }
      })
      .catch((e) => {
        if (active && loadSequence.current === sequence) {
          setError(e instanceof Error ? e.message : "Could not load payment.");
          setLoading(false);
          onLinkedOpened();
        }
      })
      .finally(() => {
        if (active && loadSequence.current === sequence) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [linkedTransaction, ledgerId, onLock, onLinkedOpened]);
  function completed(message: string, nextUndo: ClientOperation | null = null) {
    attempt.current = null;
    setUncertain(false);
    setConflict(false);
    setOpen(false);
    setOp(null);
    setNotice(message);
    setToastDone(false);
    setUndo(nextUndo);
    onLock(false);
    invalidate();
  }
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
  function prepare(operation: ClientOperation): () => Promise<void> {
    if (!ledgerId) throw new Error("Choose a ledger.");
    const l = ledgerId;
    if (operation.kind === "contact") {
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
    if (operation.kind === "service") {
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
        operation.service
          ? `/receivables/${operation.service.id}`
          : "/receivables",
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
    if (operation.kind === "payment") {
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
    if (operation.kind === "receipt") {
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
  async function perform(prepared?: () => Promise<void>) {
    if (inFlight.current || !writable || blocked) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      attempt.current ??= prepared ?? (op ? prepare(op) : null);
      if (!attempt.current) throw new Error("Choose an action.");
      await attempt.current();
    } catch (e) {
      const unknown =
        attempt.current !== null &&
        (!(e instanceof ApiError) || e.status >= 500);
      setUncertain(unknown);
      setConflict(e instanceof ApiError && e.status === 409);
      if (!unknown) attempt.current = null;
      setError(
        unknown
          ? "We couldn't confirm this action. Retry the same request."
          : e instanceof Error
            ? e.name === "ZodError"
              ? "Check the required fields and the exact amount."
              : e.message
            : "Could not save.",
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  const title =
    op?.kind === "receipt"
      ? op.receipt
        ? "Edit receipt"
        : `Record payment from ${op.client.name}`
      : op?.kind === "contact"
        ? op.client
          ? "Edit client"
          : "Add client"
        : op?.kind === "service"
          ? op.service
            ? "Edit service"
            : "Log service"
          : op?.kind === "payment"
            ? op.payment
              ? "Edit payment"
              : "Record payment"
            : op?.kind === "action"
              ? names[op.action]
              : "Payment details";
  const input = (
    key: keyof Fields,
    label: string,
    type = "text",
    required = false,
    // A currency makes this a money box (typed from the cents when that preference is on).
    money?: string,
  ) => (
    <label className="form-field" htmlFor={`client-${key}`} key={key}>
      {label}
      {type === "date" || type === "time" ? (
        <DateTimeInput
          label={label}
          id={`client-${key}`}
          type={type}
          value={values[key]}
          required={required}
          disabled={frozen || !allowWrite}
          min={type === "date" ? "0001-01-01" : undefined}
          max={type === "date" ? "9999-12-31" : undefined}
          step={type === "time" ? 60 : undefined}
          onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
        />
      ) : (
        <MoneyOrText
          money={money}
          id={`client-${key}`}
          type={type}
          value={values[key]}
          required={required}
          disabled={frozen || !allowWrite}
          maxLength={
            key === "description" || key === "note" || key === "reason"
              ? 2000
              : key === "email"
                ? 254
                : 100
          }
          onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
        />
      )}
    </label>
  );
  const paymentFields = (
    existingAccountId: string | undefined,
    creating: boolean,
  ) => (
    <>
      <label className="form-field" htmlFor="client-account">
        Receiving account
        <NativeSelect
          id="client-account"
          value={values.accountId}
          onChange={(e) =>
            setValues((v) => ({
              ...v,
              accountId: e.target.value,
            }))
          }
        >
          <option value="">Choose account</option>
          {accounts.data
            ?.filter((a) => !a.archivedAt || a.id === existingAccountId)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.archivedAt ? " (archived)" : ""}
              </option>
            ))}
        </NativeSelect>
      </label>
      {needsReceived && accountCurrency && (
        <>
          {input(
            "receivedAmount",
            `Amount received (${accountCurrency})`,
            privateMode ? "password" : "text",
            true,
            accountCurrency,
          )}
          <PaymentRate
            settled={amountMinor(values.amount, itemCurrency)}
            received={amountMinor(values.receivedAmount, accountCurrency)}
            itemCurrency={itemCurrency}
            accountCurrency={accountCurrency}
          />
        </>
      )}
      {rateSettable && accountCurrency && ledgerId && (
        <EntryRate
          ledgerId={ledgerId}
          currency={accountCurrency}
          date={values.date}
          amountMinor={amountMinor(
            needsReceived ? values.receivedAmount : values.amount,
            accountCurrency,
          )}
          manualRate={values.fxRate}
          onManualRate={(rate) => setValues((v) => ({ ...v, fxRate: rate }))}
        />
      )}
      {creating && needsReceived && accountCurrency && (
        <>
          {input(
            "tipAmount",
            `Tip (${accountCurrency}, optional)`,
            privateMode ? "password" : "text",
            false,
            accountCurrency,
          )}
          <p className="form-help">
            Extra money received beyond what is owed. It is saved as its own
            income entry and does not change the balance owed.
          </p>
        </>
      )}
      {creating && !needsReceived && extra && extra.tip > 0 && (
        <p role="status" className="tip-note">
          {privateMode
            ? "••••"
            : `This settles ${formatMoney(extra.settle, itemCurrency)}. The extra ${formatMoney(extra.tip, itemCurrency)} is saved as a tip: separate income that does not change what is owed.`}
        </p>
      )}
      {creating && tipMinor > 0 && (
        <CategoryPicker
          label="Category for the tip"
          categories={categories.data ?? []}
          kind="income"
          value={values.tipCategoryId}
          onChange={(id) =>
            setValues((v) => ({ ...v, tipCategoryId: id ?? "" }))
          }
          disabled={frozen || !allowWrite}
        />
      )}
      <CategoryPicker
        label="Category for the payment"
        categories={categories.data ?? []}
        kind="income"
        value={values.categoryId}
        onChange={(id) => setValues((v) => ({ ...v, categoryId: id ?? "" }))}
        disabled={frozen || !allowWrite}
      />
      {writable &&
        categories.data &&
        !categories.data.some((c) => c.kind === "income" && !c.archivedAt) && (
          <p className="muted">
            There are no income categories yet.{" "}
            <Link to="/categories">Add income categories</Link> first.
          </p>
        )}
      {accounts.data &&
        !accounts.data.some((a) => !a.archivedAt) &&
        creating && <Link to="/accounts">Set up a receiving account</Link>}
      <details className="more-details" open={!creating}>
        <summary>More details: date, time and note</summary>
        {input("date", "Payment date", "date", true)}
        {input("time", "Local time", "time")}
        {input("note", "Payment note")}
      </details>
    </>
  );
  return (
    <Context
      value={{
        blocked: blocked || frozen || !!op,
        deletedClientId,
        open: (next, id) => {
          void begin(next, id);
        },
      }}
    >
      {children}
      {op && !open && uncertain && (
        <div className="transaction-toast client-toast">
          <p role="status">A Client action needs confirmation.</p>
          <button
            className="secondary-button"
            type="button"
            onClick={() => setOpen(true)}
          >
            Resume Client action
          </button>
        </div>
      )}
      {(op || loading || error) && open && (
        <EditorDialog
          open={open}
          title={title}
          description={
            op?.kind === "receipt"
              ? op.receipt
                ? "Correct the details of one payment you received. Amounts stay as recorded; to change them, delete the receipt and enter it again."
                : "Record money received from this client. It pays their oldest services first, each with its own linked income entry."
              : op?.kind === "payment"
                ? "Record only money actually received. This creates one linked income entry."
                : op?.kind === "service"
                  ? "Logging a service creates no income and changes no account balance."
                  : "Keep clients and their payment history together."
          }
          busy={busy}
          onDismiss={dismiss}
          returnFocusId={trigger}
          fallbackFocusId="main-content"
          closeLabel="Close Client editor"
          initialFocusId={
            uncertain
              ? "client-retry"
              : op?.kind === "payment" ||
                  (op?.kind === "receipt" && !op.receipt)
                ? "client-amount"
                : op?.kind === "service"
                  ? "client-description"
                  : op?.kind === "contact"
                    ? "client-name"
                    : undefined
          }
        >
          {loading ? (
            <p role="status">Loading latest details…</p>
          ) : (
            <form
              className="account-form"
              onSubmit={(e) => {
                e.preventDefault();
                void perform();
              }}
            >
              <fieldset
                disabled={frozen || !allowWrite}
                className="client-fields"
              >
                {op?.kind === "contact" && (
                  <>
                    {input("name", "Name", "text", true)}
                    {input("phone", "Phone")}
                    {input("email", "Email", "email")}
                    {input("note", "Note")}
                  </>
                )}
                {op?.kind === "service" && (
                  <>
                    <p>
                      Client: {op.client.name}
                      {op.client.archivedAt ? " (archived)" : ""}
                    </p>
                    {op.service && (
                      <label className="form-field" htmlFor="client-picker">
                        Client
                        <NativeSelect
                          id="client-picker"
                          value={values.contactId}
                          onChange={(e) =>
                            setValues((v) => ({
                              ...v,
                              contactId: e.target.value,
                            }))
                          }
                        >
                          {(clients.data ?? [op.client])
                            .filter(
                              (p) => !p.archivedAt || p.id === op.client.id,
                            )
                            .map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                                {p.archivedAt ? " (archived)" : ""}
                              </option>
                            ))}
                        </NativeSelect>
                      </label>
                    )}
                    {input("description", "Description", "text", true)}
                    {input("serviceDate", "Service date", "date", true)}
                    {input("serviceTime", "Service time (optional)", "time")}
                    {input("dueDate", "Due date", "date")}
                    {baseValues.currencies.length > 1 && (
                      <label className="form-field" htmlFor="client-currency">
                        Currency
                        <NativeSelect
                          id="client-currency"
                          value={values.currency}
                          disabled={
                            !!op.service && op.service.received.amount > 0
                          }
                          onChange={(e) =>
                            setValues((v) => ({
                              ...v,
                              currency: e.target.value,
                            }))
                          }
                        >
                          {baseValues.currencies.map((code) => (
                            <option key={code} value={code}>
                              {code}
                            </option>
                          ))}
                        </NativeSelect>
                        {!!op.service && op.service.received.amount > 0 && (
                          <span className="form-help">
                            It stays {op.service.amount.currency}, the currency
                            payments were recorded in.
                          </span>
                        )}
                      </label>
                    )}
                    {input(
                      "amount",
                      `Service amount (${values.currency})`,
                      privateMode ? "password" : "text",
                      true,
                      values.currency,
                    )}
                    <HourlyHelper
                      currency={values.currency}
                      secret={privateMode}
                      disabled={frozen || !allowWrite}
                      descriptionBlank={!values.description.trim()}
                      onUse={(amount, description) =>
                        setValues((v) => ({
                          ...v,
                          amount,
                          ...(description ? { description } : {}),
                        }))
                      }
                    />
                  </>
                )}
                {op?.kind === "payment" && (
                  <>
                    {op.client && <p>Client: {op.client.name}</p>}
                    <p>{op.service.description}</p>
                    {op.service.status === "writtenOff" && (
                      <p className="muted">
                        Reopen this service in Clients before correcting its
                        payments.
                      </p>
                    )}
                    <p>
                      Outstanding:{" "}
                      {privateMode
                        ? "••••"
                        : formatMoney(
                            op.service.outstanding.amount,
                            op.service.outstanding.currency,
                          )}
                    </p>
                    {input(
                      "amount",
                      `Payment amount (${itemCurrency})`,
                      privateMode ? "password" : "text",
                      true,
                      itemCurrency,
                    )}
                    {op.payment?.tip && !op.payment.tip.deletedAt && (
                      <p className="muted">
                        This payment came with a tip. Change the tip from
                        Transactions.
                      </p>
                    )}
                    {paymentFields(
                      op.payment?.transaction.accountId,
                      !op.payment,
                    )}
                  </>
                )}
                {op?.kind === "receipt" && (
                  <>
                    <p>Client: {op.client.name}</p>
                    {op.receipt ? (
                      <>
                        <p>
                          Receipt total:{" "}
                          {privateMode
                            ? "••••"
                            : formatMoney(
                                op.receipt.amount.amount,
                                op.receipt.amount.currency,
                              )}
                          , split across {op.receipt.payments.length} services.
                        </p>
                        <p className="muted">
                          Changes to the account, category, date, time or note
                          apply to every payment in this receipt.
                        </p>
                      </>
                    ) : (
                      <>
                        {op.client.openBalances.length > 1 && (
                          <label
                            className="form-field"
                            htmlFor="client-receipt-currency"
                          >
                            Currency being paid
                            <NativeSelect
                              id="client-receipt-currency"
                              value={values.receiptCurrency}
                              onChange={(e) =>
                                setValues((v) => ({
                                  ...v,
                                  receiptCurrency: e.target.value,
                                  amount: "",
                                  receivedAmount: "",
                                  fxRate: "",
                                }))
                              }
                            >
                              {op.client.openBalances.map((b) => (
                                <option key={b.currency} value={b.currency}>
                                  {b.currency}
                                </option>
                              ))}
                            </NativeSelect>
                          </label>
                        )}
                        <p>
                          Open balance:{" "}
                          {privateMode
                            ? "••••"
                            : formatMoney(
                                owedInCurrency(
                                  op.client,
                                  values.receiptCurrency,
                                ),
                                values.receiptCurrency,
                              )}
                        </p>
                        {input(
                          "amount",
                          `Payment amount (${values.receiptCurrency})`,
                          privateMode ? "password" : "text",
                          true,
                          values.receiptCurrency,
                        )}
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={frozen}
                          onClick={() =>
                            setValues((v) => ({
                              ...v,
                              amount: decimalFromCents(
                                owedInCurrency(op.client, v.receiptCurrency),
                                currencyDigits(v.receiptCurrency),
                              ),
                            }))
                          }
                        >
                          Pay full balance
                        </button>
                        <ReceiptPreview
                          currency={values.receiptCurrency}
                          query={preview}
                          hasAmount={previewCents !== null}
                          hidden={privateMode}
                        />
                      </>
                    )}
                    {op.receipt?.payments.some(
                      (p) => p.tip && !p.tip.deletedAt,
                    ) && (
                      <p className="muted">
                        This receipt came with a tip. Change the tip from
                        Transactions.
                      </p>
                    )}
                    {paymentFields(
                      op.receipt?.payments[0]?.transaction.accountId,
                      !op.receipt,
                    )}
                  </>
                )}
                {op?.kind === "action" && (
                  <>
                    <p>
                      {op.action === "deleteReceipt"
                        ? "Delete this receipt: every payment it created, its linked income entries and any tip that came with it are removed together."
                        : op.action === "restoreReceipt"
                          ? "Restore the whole receipt with the same payments, income entries and tip."
                          : op.action === "deletePayment"
                            ? "Delete the payment, its linked income and any tip that came with it together."
                            : op.action === "writeOff"
                              ? "Waive only the unpaid remainder. Received income stays in place."
                              : op.action === "reopen"
                                ? "Return the waived remainder to money owed."
                                : op.action === "deleteContact"
                                  ? "Delete this client only after all their services are deleted. Archive to retain accessible history."
                                  : op.action === "deleteService"
                                    ? "Delete this service only after its payments are deleted."
                                    : "Confirm this action using the loaded version."}
                    </p>
                    {op.action === "writeOff" &&
                      input("reason", "Write-off reason")}
                  </>
                )}
              </fieldset>
              {error && (
                <p className="field-error" role="alert">
                  {error}
                </p>
              )}
              {(accounts.isError || categories.isError) && paymentMode && (
                <p role="alert">
                  Could not load payment choices.{" "}
                  <button
                    type="button"
                    onClick={() => {
                      void accounts.refetch();
                      void categories.refetch();
                    }}
                  >
                    Reload choices
                  </button>
                </p>
              )}
              <div className="form-actions">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={busy}
                  onClick={dismiss}
                >
                  Close
                </button>
                {uncertain ? (
                  <button
                    id="client-retry"
                    type="button"
                    className="button"
                    disabled={busy || blocked || !writable}
                    onClick={() => void perform()}
                  >
                    Retry same action
                  </button>
                ) : conflict ? (
                  <button
                    type="button"
                    className="button"
                    onClick={() => {
                      if (op) void begin(op, trigger);
                    }}
                  >
                    Reload latest details
                  </button>
                ) : (
                  allowWrite &&
                  op && (
                    <button
                      className={
                        op.kind === "action" && op.action.startsWith("delete")
                          ? "button danger-action"
                          : "button"
                      }
                      type="submit"
                      disabled={
                        busy ||
                        blocked ||
                        (paymentMode && (!accounts.data || !categories.data)) ||
                        (!!receiptCreate &&
                          (!preview.data ||
                            preview.data.amount.amount !== previewCents ||
                            preview.data.exceedsBalance ||
                            preview.data.tooManyServices))
                      }
                    >
                      {op.kind === "action"
                        ? "Confirm"
                        : op.kind === "payment" || op.kind === "receipt"
                          ? op.kind === "receipt" && op.receipt
                            ? "Save receipt"
                            : "Save payment"
                          : op.kind === "service"
                            ? "Save service"
                            : "Save client"}
                    </button>
                  )
                )}
              </div>
            </form>
          )}
        </EditorDialog>
      )}
      {notice && !open && toastDone && undo && writable && (
        <UndoPill
          label="Undo Client action"
          disabled={blocked || frozen}
          onUndo={() => {
            const next = undo;
            setUndo(null);
            setNotice("");
            void begin(next, "main-content", false);
          }}
          onDismiss={() => {
            setUndo(null);
            setNotice("");
          }}
        />
      )}
      {notice && !open && !toastDone && (
        <Toast
          label="Client notification"
          className="client-toast"
          durationMs={blocked || frozen ? null : undo ? 5000 : 3000}
          onExpire={() => {
            if (undo && writable) setToastDone(true);
            else setNotice("");
          }}
        >
          <p role="status">{notice}</p>
          {undo && writable && (
            <button
              className="secondary-button"
              type="button"
              disabled={blocked || frozen}
              onClick={() => {
                const next = undo;
                setUndo(null);
                void begin(next, "main-content", false);
              }}
            >
              Undo Client action
            </button>
          )}
          <button
            className="secondary-button"
            type="button"
            onClick={() => {
              setNotice("");
              setUndo(null);
            }}
          >
            Dismiss
          </button>
        </Toast>
      )}
    </Context>
  );
}

function ReceiptPreview({
  query,
  hasAmount,
  hidden,
  currency,
}: {
  currency: string;
  query: {
    data: ReceiptPreviewData | undefined;
    isError: boolean;
  };
  hasAmount: boolean;
  hidden: boolean;
}) {
  const money = (cents: number) =>
    hidden ? "••••" : formatMoney(cents, currency);
  if (!hasAmount)
    return (
      <p className="muted">
        Enter an amount to see which services it pays, oldest first.
      </p>
    );
  if (query.isError)
    return (
      <p role="alert">Could not preview this payment. Check the amount.</p>
    );
  const data = query.data;
  if (!data) return <p role="status">Checking open services…</p>;
  if (data.exceedsBalance)
    return (
      <p role="alert">
        That is more than the open balance of {money(data.openTotal.amount)}.
      </p>
    );
  if (data.tooManyServices)
    return (
      <p role="alert">
        This would cover more than 100 services. Record a smaller payment first.
      </p>
    );
  const full = data.allocations.filter((a) => a.remainingAfter.amount === 0);
  return (
    <div className="receipt-preview" aria-live="polite">
      <p>
        {full.length === data.allocations.length
          ? `Pays ${full.length} ${full.length === 1 ? "service" : "services"} in full.`
          : `Pays ${full.length} ${full.length === 1 ? "service" : "services"} in full and part of one more.`}
      </p>
      <ul className="client-rows">
        {data.allocations.map((a) => (
          <li className="service-row" key={a.receivableId}>
            <div className="row-main">
              <div className="row-text">
                <h3>{a.description}</h3>
                <p className="muted">
                  {a.serviceDate} ·{" "}
                  {a.remainingAfter.amount === 0
                    ? "Paid in full"
                    : `${money(a.remainingAfter.amount)} left`}
                </p>
              </div>
              <div className="row-figure">{money(a.applied.amount)}</div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** What a client owes in one currency (0 when nothing is open in it). */
function owedInCurrency(client: Contact, currency: string) {
  return client.openBalances.find((b) => b.currency === currency)?.amount ?? 0;
}
/**
 * When one side of a payment is in USD, the two amounts fix the rate; show it so a typo in the
 * amount received is easy to spot ("1 USD = 120 BDT").
 */
function PaymentRate({
  settled,
  received,
  itemCurrency,
  accountCurrency,
}: {
  settled: number | null;
  received: number | null;
  itemCurrency: string;
  accountCurrency: string;
}) {
  if (settled === null || received === null) return null;
  const base =
    itemCurrency === "USD"
      ? settled
      : accountCurrency === "USD"
        ? received
        : null;
  if (base === null) return null;
  const foreign = itemCurrency === "USD" ? accountCurrency : itemCurrency;
  const foreignAmount = itemCurrency === "USD" ? received : settled;
  return (
    <p className="form-help" aria-live="polite">
      {rateSentence(
        foreign,
        deriveRate(base, foreignAmount, foreign, "USD"),
        "USD",
      )}
    </p>
  );
}

/** A money box when a currency is given, otherwise a plain text input. */
function MoneyOrText({
  money,
  ...rest
}: { money: string | undefined } & ComponentPropsWithoutRef<"input">) {
  return money ? (
    <AmountInput currency={money} {...rest} />
  ) : (
    <input {...rest} />
  );
}

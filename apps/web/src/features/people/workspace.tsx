import {
  type Contact,
  contactSchema,
  createContactSchema,
  createPaymentSchema,
  createReceiptSchema,
  createReceivableSchema,
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
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { DateTimeInput } from "../../components/date-time-input";
import { EditorDialog } from "../../components/editor-dialog";
import { NativeSelect } from "../../components/native-select";
import { Toast } from "../../components/toast";
import { ApiError } from "../../lib/api";
import { decimalFromCents, formatUsd } from "../accounts/money";
import { getCategories } from "../categories/api";
import { CategoryPicker } from "../categories/picker";
import { PrivacyContext } from "../shell/preferences";
import { getAllAccounts } from "../transactions/api";
import { localToday } from "../transactions/form";
import {
  getAllPeople,
  getPayment,
  getPerson,
  getReceipt,
  getReceiptPreview,
  getService,
  preparePeopleWrite,
} from "./api";
import { paymentDefault, positiveCents } from "./form";
export type PeopleOperation =
  | { kind: "contact"; person?: Contact }
  | { kind: "service"; person: Contact; service?: Receivable }
  | {
      kind: "payment";
      service: Receivable;
      person?: Contact;
      payment?: ReceivablePayment;
    }
  | { kind: "receipt"; person: Contact; receipt?: Receipt; receiptId?: string }
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
      person?: Contact;
      reason?: string | null;
      service?: Receivable;
      payment?: ReceivablePayment;
    };
type Workspace = {
  blocked: boolean;
  /** The most recently deleted person, so the People page can leave their detail view. */
  deletedPersonId: string | null;
  open: (op: PeopleOperation, trigger: string) => void;
};
const Context = createContext<Workspace | null>(null);
export const usePeopleWorkspace = () => useContext(Context);
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
  accountId: "",
  categoryId: "",
  date: localToday(),
  time: "",
  contactId: "",
  reason: "",
});
function fieldsFor(op: PeopleOperation): Fields {
  const f = empty();
  if (op.kind === "contact" && op.person)
    Object.assign(f, {
      name: op.person.name,
      phone: op.person.phone ?? "",
      email: op.person.email ?? "",
      note: op.person.note ?? "",
    });
  if (op.kind === "service")
    Object.assign(f, {
      contactId: op.person.id,
      ...(op.service
        ? {
            description: op.service.description,
            serviceDate: op.service.serviceDate,
            serviceTime: op.service.serviceTime ?? "",
            dueDate: op.service.dueDate ?? "",
            amount: decimalFromCents(op.service.amount.amount),
          }
        : {}),
    });
  if (op.kind === "payment")
    Object.assign(f, {
      amount: decimalFromCents(
        op.payment?.amount.amount ?? op.service.outstanding.amount,
      ),
      ...(op.payment
        ? {
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
    Object.assign(f, {
      ...(op.receipt
        ? { amount: decimalFromCents(op.receipt.amount.amount) }
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
  archive: "Archive person",
  unarchive: "Unarchive person",
  deleteContact: "Delete person",
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
export function PeopleWorkspace({
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
  const client = useQueryClient(),
    privateMode = useContext(PrivacyContext);
  const [op, setOp] = useState<PeopleOperation | null>(null),
    [values, setValues] = useState<Fields>(empty),
    [open, setOpen] = useState(false),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [error, setError] = useState(""),
    [conflict, setConflict] = useState(false),
    [trigger, setTrigger] = useState("main-content"),
    [notice, setNotice] = useState(""),
    [deletedPersonId, setDeletedPersonId] = useState<string | null>(null),
    // The toast closes itself; an Undo stays reachable from a pill until used or replaced.
    [toastDone, setToastDone] = useState(false),
    [undo, setUndo] = useState<PeopleOperation | null>(null);
  const attempt = useRef<(() => Promise<void>) | null>(null),
    inFlight = useRef(false),
    loadSequence = useRef(0);
  const paymentMode = op?.kind === "payment" || op?.kind === "receipt";
  const allowWrite =
    writable && !(op?.kind === "payment" && op.service.status === "writtenOff");
  const people = useQuery({
    queryKey: ["contacts", ledgerId, "choices"],
    queryFn: ({ signal }) => getAllPeople(ledgerId as string, signal),
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
  const receiptCreate = op?.kind === "receipt" && !op.receipt ? op : null;
  const previewCents = (() => {
    if (!receiptCreate) return null;
    try {
      return positiveCents(values.amount).amount;
    } catch {
      return null;
    }
  })();
  const preview = useQuery({
    queryKey: [
      "receivables",
      ledgerId,
      "receipt-preview",
      receiptCreate?.person.id,
      previewCents,
    ],
    queryFn: ({ signal }) =>
      getReceiptPreview(
        ledgerId as string,
        (receiptCreate as { person: Contact }).person.id,
        previewCents as number,
        signal,
      ),
    enabled: !!ledgerId && !!receiptCreate && previewCents !== null && open,
    staleTime: 0,
    retry: false,
  });
  const preference = `ledgerline:payment-category:${actorId}:${ledgerId}`;
  const invalidate = () => {
    for (const key of [
      "contacts",
      "receivables",
      "peopleHistory",
      "accounts",
      "transactions",
      "home",
    ])
      void client.invalidateQueries({ queryKey: [key, ledgerId] });
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
  async function begin(next: PeopleOperation, id: string, fresh = true) {
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
      if (next.kind === "contact" && next.person)
        loaded = { ...next, person: await getPerson(ledgerId, next.person.id) };
      else if (next.kind === "service")
        loaded = {
          ...next,
          person: await getPerson(ledgerId, next.person.id),
          ...(next.service
            ? { service: await getService(ledgerId, next.service.id) }
            : {}),
        };
      else if (next.kind === "receipt")
        loaded = {
          ...next,
          person: await getPerson(ledgerId, next.person.id),
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
          person: await getPerson(ledgerId, service.contactId),
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
          ...(next.person
            ? { person: await getPerson(ledgerId, next.person.id) }
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
        client.setQueryData(["accounts", ledgerId, "history"], freshAccounts);
        client.setQueryData(["categories", ledgerId], freshCategories);
        if (!(loaded.kind === "payment" ? loaded.payment : loaded.receipt)) {
          fields.accountId = freshAccounts.find((a) => !a.archivedAt)?.id ?? "";
          fields.categoryId = paymentDefault(
            freshCategories,
            localStorage.getItem(preference),
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
        const person = await getPerson(ledgerId, payment.receivable.contactId);
        const receipt = payment.receiptId
          ? await getReceipt(ledgerId, payment.receiptId)
          : undefined;
        if (active && loadSequence.current === sequence) {
          const next: PeopleOperation = receipt
            ? { kind: "receipt", person, receipt }
            : {
                kind: "payment",
                service: payment.receivable,
                person,
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
  function completed(message: string, nextUndo: PeopleOperation | null = null) {
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
  function prepare(operation: PeopleOperation): () => Promise<void> {
    if (!ledgerId) throw new Error("Choose a ledger.");
    const l = ledgerId;
    if (operation.kind === "contact") {
      const body = createContactSchema.parse({
        name: values.name,
        phone: values.phone || null,
        email: values.email || null,
        note: values.note || null,
      });
      const run = preparePeopleWrite(
        l,
        operation.person ? `/contacts/${operation.person.id}` : "/contacts",
        operation.person ? "PATCH" : "POST",
        operation.person
          ? updateContactSchema.parse({
              ...body,
              expectedVersion: operation.person.version,
            })
          : body,
      );
      return async () => {
        contactSchema.parse(await run());
        completed("Person saved.");
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
        amount: positiveCents(values.amount),
      });
      const withTime = <T extends { serviceTime?: string | null | undefined }>(
        row: T,
      ) => ({ ...row, serviceTime: row.serviceTime ?? null });
      const body = withTime(parsed);
      const run = preparePeopleWrite(
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
        amount: positiveCents(values.amount),
        accountId: values.accountId,
        categoryId: values.categoryId,
        date: values.date,
        time: values.time || null,
        note: values.note || null,
        expectedReceivableVersion: operation.service.version,
      });
      const run = preparePeopleWrite(
        l,
        `/receivables/${operation.service.id}/payments${operation.payment ? `/${operation.payment.id}` : ""}`,
        operation.payment ? "PATCH" : "POST",
        operation.payment
          ? updatePaymentSchema.parse({
              ...body,
              expectedVersion: operation.payment.version,
            })
          : body,
      );
      return async () => {
        const p = paymentSchema.parse(await run());
        localStorage.setItem(preference, p.transaction.categoryId ?? "");
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
      };
      if (operation.receipt) {
        const run = preparePeopleWrite(
          l,
          `/receipts/${operation.receipt.id}`,
          "PATCH",
          updateReceiptSchema.parse({
            ...fields,
            expectedPayments: expectedPayments(operation.receipt),
          }),
        );
        return async () => {
          receiptSchema.parse(await run());
          completed("Receipt saved.");
        };
      }
      const amount = positiveCents(values.amount),
        shown = preview.data;
      if (
        !shown ||
        shown.amount.amount !== amount.amount ||
        shown.exceedsBalance ||
        shown.tooManyServices
      )
        throw new Error("Wait for the allocation preview to match the amount.");
      const run = preparePeopleWrite(
        l,
        `/contacts/${operation.person.id}/receipts`,
        "POST",
        createReceiptSchema.parse({
          ...fields,
          amount,
          expectedAllocations: shown.allocations.map((a) => ({
            receivableId: a.receivableId,
            expectedVersion: a.version,
            applied: a.applied.amount,
          })),
        }),
      );
      return async () => {
        const r = receiptSchema.parse(await run());
        localStorage.setItem(preference, values.categoryId);
        completed("Payment applied to the person's services.", {
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
      person = operation.person;
    let path = "",
      method: "POST" | "DELETE" = "POST",
      body: JsonValue = {};
    if (r) {
      path = `/receipts/${r.id}${a === "restoreReceipt" ? "/restore" : ""}`;
      method = a === "deleteReceipt" ? "DELETE" : "POST";
      body = { expectedPayments: expectedPayments(r) };
    } else if (person) {
      path = `/contacts/${person.id}${a === "deleteContact" ? "" : `/${a}`}`;
      method = a === "deleteContact" ? "DELETE" : "POST";
      body = { expectedVersion: person.version };
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
    const run = preparePeopleWrite(l, path, method, body);
    return async () => {
      const result = await run();
      let next: PeopleOperation | null = null;
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
      if (a === "deleteContact" && person) {
        // Drop the deleted person's detail queries first so nothing refetches them (they would 404).
        for (const key of ["contacts", "receivables", "peopleHistory"]) {
          client.removeQueries({
            queryKey: [key, l],
            predicate: (query) => query.queryKey.includes(person.id),
          });
        }
        setDeletedPersonId(person.id);
        completed("Person deleted.", null);
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
              ? "Check the required fields and exact USD amount."
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
        : `Record payment from ${op.person.name}`
      : op?.kind === "contact"
        ? op.person
          ? "Edit person"
          : "Add person"
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
  ) => (
    <label className="form-field" htmlFor={`people-${key}`} key={key}>
      {label}
      {type === "date" || type === "time" ? (
        <DateTimeInput
          label={label}
          id={`people-${key}`}
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
        <input
          id={`people-${key}`}
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
      <label className="form-field" htmlFor="people-account">
        Receiving account
        <NativeSelect
          id="people-account"
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
      <CategoryPicker
        label="Income category"
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
            <Link to="/more/categories">Add income categories</Link> first.
          </p>
        )}
      {accounts.data &&
        !accounts.data.some((a) => !a.archivedAt) &&
        creating && <Link to="/more/accounts">Set up a receiving account</Link>}
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
        deletedPersonId,
        open: (next, id) => {
          void begin(next, id);
        },
      }}
    >
      {children}
      {op && !open && uncertain && (
        <div className="transaction-toast people-toast">
          <p role="status">A People action needs confirmation.</p>
          <button
            className="secondary-button"
            type="button"
            onClick={() => setOpen(true)}
          >
            Resume People action
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
                : "Record money received from this person. It pays their oldest services first, each with its own linked income entry."
              : op?.kind === "payment"
                ? "Record only money actually received. This creates one linked income entry."
                : op?.kind === "service"
                  ? "Logging a service creates no income and changes no account balance."
                  : "Keep people and their payment history together."
          }
          busy={busy}
          onDismiss={dismiss}
          returnFocusId={trigger}
          fallbackFocusId="main-content"
          closeLabel="Close People editor"
          initialFocusId={
            uncertain
              ? "people-retry"
              : op?.kind === "payment" ||
                  (op?.kind === "receipt" && !op.receipt)
                ? "people-amount"
                : op?.kind === "service"
                  ? "people-description"
                  : op?.kind === "contact"
                    ? "people-name"
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
                className="people-fields"
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
                      Person: {op.person.name}
                      {op.person.archivedAt ? " (archived)" : ""}
                    </p>
                    {op.service && (
                      <label className="form-field" htmlFor="people-person">
                        Person
                        <NativeSelect
                          id="people-person"
                          value={values.contactId}
                          onChange={(e) =>
                            setValues((v) => ({
                              ...v,
                              contactId: e.target.value,
                            }))
                          }
                        >
                          {(people.data ?? [op.person])
                            .filter(
                              (p) => !p.archivedAt || p.id === op.person.id,
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
                    {input(
                      "amount",
                      "Service amount (USD)",
                      privateMode ? "password" : "text",
                      true,
                    )}
                  </>
                )}
                {op?.kind === "payment" && (
                  <>
                    {op.person && <p>Person: {op.person.name}</p>}
                    <p>{op.service.description}</p>
                    {op.service.status === "writtenOff" && (
                      <p className="muted">
                        Reopen this service in People before correcting its
                        payments.
                      </p>
                    )}
                    <p>
                      Outstanding:{" "}
                      {privateMode
                        ? "••••"
                        : formatUsd(op.service.outstanding.amount)}
                    </p>
                    {input(
                      "amount",
                      "Payment amount (USD)",
                      privateMode ? "password" : "text",
                      true,
                    )}
                    {paymentFields(
                      op.payment?.transaction.accountId,
                      !op.payment,
                    )}
                  </>
                )}
                {op?.kind === "receipt" && (
                  <>
                    <p>Person: {op.person.name}</p>
                    {op.receipt ? (
                      <>
                        <p>
                          Receipt total:{" "}
                          {privateMode
                            ? "••••"
                            : formatUsd(op.receipt.amount.amount)}
                          , split across {op.receipt.payments.length} services.
                        </p>
                        <p className="muted">
                          Changes to the account, category, date, time or note
                          apply to every payment in this receipt.
                        </p>
                      </>
                    ) : (
                      <>
                        <p>
                          Open balance:{" "}
                          {privateMode
                            ? "••••"
                            : formatUsd(op.person.openBalance.amount)}
                        </p>
                        {input(
                          "amount",
                          "Payment amount (USD)",
                          privateMode ? "password" : "text",
                          true,
                        )}
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={frozen}
                          onClick={() =>
                            setValues((v) => ({
                              ...v,
                              amount: decimalFromCents(
                                op.person.openBalance.amount,
                              ),
                            }))
                          }
                        >
                          Pay full balance
                        </button>
                        <ReceiptPreview
                          query={preview}
                          hasAmount={previewCents !== null}
                          hidden={privateMode}
                        />
                      </>
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
                        ? "Delete this receipt: every payment it created and its linked income entries are removed together."
                        : op.action === "restoreReceipt"
                          ? "Restore the whole receipt with the same payments and income entries."
                          : op.action === "deletePayment"
                            ? "Delete the payment and its linked income together."
                            : op.action === "writeOff"
                              ? "Waive only the unpaid remainder. Received income stays in place."
                              : op.action === "reopen"
                                ? "Return the waived remainder to money owed."
                                : op.action === "deleteContact"
                                  ? "Delete this person only after all their services are deleted. Archive to retain accessible history."
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
                    id="people-retry"
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
                            : "Save person"}
                    </button>
                  )
                )}
              </div>
            </form>
          )}
        </EditorDialog>
      )}
      {notice && !open && toastDone && undo && writable && (
        <button
          type="button"
          className="undo-pill"
          disabled={blocked || frozen}
          onClick={() => {
            const next = undo;
            setUndo(null);
            setNotice("");
            void begin(next, "main-content", false);
          }}
        >
          Undo People action
        </button>
      )}
      {notice && !open && !toastDone && (
        <Toast
          label="People notification"
          className="people-toast"
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
              Undo People action
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
}: {
  query: {
    data: ReceiptPreviewData | undefined;
    isError: boolean;
  };
  hasAmount: boolean;
  hidden: boolean;
}) {
  const money = (cents: number) => (hidden ? "••••" : formatUsd(cents));
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
      <ul className="people-rows">
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

import type { Contact, Transaction } from "@ledgerline/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { DeleteTrigger } from "../../components/delete-trigger";
import { LoadError } from "../../components/load-error";
import { Overlay } from "../../components/overlay";
import { Toast } from "../../components/toast";
import { UndoPill } from "../../components/undo-pill";
import { ApiError } from "../../lib/api";
import { PrivacyContext } from "../../lib/preferences";
import { getCategories } from "../categories/api";
import { useBaseValues } from "../currencies/base-value";
import { getAllAccounts } from "../transactions/api";
import {
  getAllClients,
  getClient,
  getPayment,
  getReceipt,
  getReceiptPreview,
  getService,
} from "./api";
import { paymentDefault, tipDefault } from "./form";
import { derivePayment } from "./operations/derive";
import type { OperationForm } from "./operations/form-context";
import {
  askText,
  dialogDescription,
  dialogInitialFocus,
  dialogTitle,
  isDelete,
  submitLabel,
} from "./operations/labels";
import { prepareOperation } from "./operations/prepare";
import {
  renderActionOperation,
  renderContactFields,
  renderPaymentOperation,
  renderReceiptOperation,
  renderServiceFields,
} from "./operations/sections";
import {
  type ClientOperation,
  empty,
  type Fields,
  fieldsFor,
  isPaymentOperation,
  names,
} from "./operations/types";

type Workspace = {
  blocked: boolean;
  /** The most recently deleted client, so the Clients page can leave their detail view. */
  deletedClientId: string | null;
  open: (op: ClientOperation, trigger: string) => void;
};
const Context = createContext<Workspace | null>(null);
export const useClientsWorkspace = () => useContext(Context);
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
    // The sheet shows once what it needs has loaded, or after a moment when that takes long (ADR 0047).
    [visible, setVisible] = useState(false),
    // The trash beside Save on a payment or a receipt asks first.
    [confirmDelete, setConfirmDelete] = useState(false),
    [trigger, setTrigger] = useState("main-content"),
    [notice, setNotice] = useState(""),
    [deletedClientId, setDeletedClientId] = useState<string | null>(null),
    // The toast closes itself; an Undo stays reachable from a pill until used or replaced.
    [toastDone, setToastDone] = useState(false),
    [undo, setUndo] = useState<ClientOperation | null>(null);
  const attempt = useRef<(() => Promise<void>) | null>(null),
    inFlight = useRef(false),
    loadSequence = useRef(0);
  const paymentMode = isPaymentOperation(op);
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
  const derived = derivePayment(op, values, accounts.data);
  const { receiptCreate, previewCents } = derived;
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
  useEffect(() => {
    if (!open) {
      setVisible(false);
      return;
    }
    if (!loading) {
      setVisible(true);
      return;
    }
    const timer = setTimeout(() => setVisible(true), 250);
    return () => clearTimeout(timer);
  }, [open, loading]);
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
        setError(e instanceof Error ? e.message : "Couldn't load details.");
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
          setError(e instanceof Error ? e.message : "Couldn't load payment.");
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
  const preparing = (operation: ClientOperation) =>
    prepareOperation(operation, {
      ledgerId,
      values,
      derived,
      previewData: preview.data,
      preference,
      tipPreference,
      queryClient,
      completed,
      setDeletedClientId,
    });
  async function perform(prepared?: () => Promise<void>) {
    if (inFlight.current || !writable || blocked) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      attempt.current ??= prepared ?? (op ? preparing(op) : null);
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
  const form: OperationForm = {
    ledgerId,
    writable,
    frozen,
    allowWrite,
    privateMode,
    values,
    setValues,
    accounts,
    categories,
    clients,
    currencies: baseValues.currencies,
    preview,
    previewCents,
    derived,
  };
  // A payment or a receipt being corrected has its own delete, behind the trash beside Save.
  const deleteOp: Extract<ClientOperation, { kind: "action" }> | null =
    op?.kind === "payment" && op.payment
      ? {
          kind: "action",
          action: "deletePayment",
          service: op.service,
          payment: op.payment,
        }
      : op?.kind === "receipt" && op.receipt
        ? {
            kind: "action",
            action: "deleteReceipt",
            receipt: op.receipt,
            receiptId: op.receipt.id,
          }
        : null;
  const footer =
    loading || !op ? undefined : uncertain ? (
      <button
        id="client-retry"
        type="button"
        className="ui-btn ui-btn-primary"
        disabled={busy || blocked || !writable}
        onClick={() => void perform()}
      >
        Retry same action
      </button>
    ) : conflict ? (
      <button
        type="button"
        className="ui-btn ui-btn-primary"
        onClick={() => void begin(op, trigger)}
      >
        Reload latest details
      </button>
    ) : allowWrite ? (
      <>
        {deleteOp && (
          <DeleteTrigger
            id="delete-client-item"
            label={names[deleteOp.action]}
            disabled={busy}
            onClick={() => setConfirmDelete(true)}
          />
        )}
        <button
          className={
            op.kind === "action" && isDelete(op.action)
              ? "ui-btn ui-btn-danger-filled"
              : "ui-btn ui-btn-primary"
          }
          type="submit"
          form="client-form"
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
          {submitLabel(op)}
        </button>
      </>
    ) : undefined;
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
            className="ui-btn ui-btn-secondary"
            type="button"
            onClick={() => setOpen(true)}
          >
            Resume Client action
          </button>
        </div>
      )}
      {(op || loading || error) && (
        <Overlay
          open={open && visible}
          kind={op?.kind === "action" ? "question" : "sheet"}
          title={dialogTitle(op)}
          description={dialogDescription(op)}
          busy={busy}
          onDismiss={dismiss}
          returnFocusId={trigger}
          fallbackFocusId="main-content"
          initialFocusId={dialogInitialFocus(op, uncertain)}
          footer={footer}
        >
          {loading ? (
            <p role="status">Loading latest details…</p>
          ) : (
            <form
              id="client-form"
              className="ed-form"
              noValidate={false}
              onSubmit={(e) => {
                e.preventDefault();
                void perform();
              }}
            >
              <fieldset disabled={frozen || !allowWrite} className="ed-fields">
                {op?.kind === "contact" && renderContactFields(form)}
                {op?.kind === "service" && renderServiceFields(form, op)}
                {op?.kind === "payment" && renderPaymentOperation(form, op)}
                {op?.kind === "receipt" && renderReceiptOperation(form, op)}
                {op?.kind === "action" && renderActionOperation(form, op)}
              </fieldset>
              {error && (
                <p className="field-error" role="alert">
                  {error}
                </p>
              )}
              {(accounts.isError || categories.isError) && paymentMode && (
                <LoadError
                  message="Couldn't load payment choices."
                  onRetry={() => {
                    void accounts.refetch();
                    void categories.refetch();
                  }}
                  retryLabel="Reload choices"
                />
              )}
            </form>
          )}
        </Overlay>
      )}
      {deleteOp && (
        <Overlay
          kind="question"
          open={confirmDelete}
          title={names[deleteOp.action]}
          busy={busy}
          onDismiss={() => setConfirmDelete(false)}
          returnFocusId="delete-client-item"
          fallbackFocusId="main-content"
          footer={
            <button
              type="button"
              className="ui-btn ui-btn-danger-filled"
              disabled={busy || blocked}
              onClick={() => {
                setConfirmDelete(false);
                void perform(preparing(deleteOp));
              }}
            >
              Delete
            </button>
          }
        >
          <p>{askText[deleteOp.action]}</p>
        </Overlay>
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
              className="ui-btn ui-btn-secondary"
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
            className="ui-btn ui-btn-secondary"
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

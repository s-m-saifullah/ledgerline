import { zodResolver } from "@hookform/resolvers/zod";
import {
  type Account,
  bonusFromBps,
  type Category,
  currencyDigits,
  type Transaction,
  type Transfer,
} from "@ledgerline/shared";
import { Button } from "@ledgerline/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { EditorDialog } from "../../components/editor-dialog";
import { ApiError } from "../../lib/api";
import { decimalFromCents } from "../../lib/money";
import { PrivacyContext } from "../../lib/preferences";
import { prepareTransactionUndo } from "./api";
import { defaultFeeText, feeMinor, parseFee } from "./fee";
import { amountMinor, rememberAccount } from "./form";
import { buildTransferBody } from "./transfer/build-body";
import {
  renderAccountPickers,
  renderAmountFields,
  renderBonusFields,
  renderFeeField,
  renderLinkedNotes,
  renderMoreCategories,
  renderWhenAndNote,
} from "./transfer/fields";
import type { TransferFormContext } from "./transfer/form-context";
import { defaults, makeSchema, type Values } from "./transfer/schema";
import { getTransfer, prepareTransferSave, transferLeg } from "./transfers";

export function TransferForm({
  actorId = "",
  ledgerId,
  transfer,
  accounts,
  categories = [],
  open,
  writable,
  blocked = false,
  onDismiss,
  onSaved,
  onDeleted,
  onLock,
  returnFocusId = "add-transaction",
  modeControl,
}: {
  actorId?: string;
  ledgerId: string;
  transfer?: Transfer | undefined;
  accounts: readonly Account[];
  /** Used to pick the fee and bonus categories on a new transfer. */
  categories?: readonly Category[];
  open: boolean;
  writable: boolean;
  blocked?: boolean;
  onDismiss: () => void;
  onSaved: (row: Transaction, info?: { bonus: boolean; fee: boolean }) => void;
  onDeleted?: (row: Transaction) => void;
  onLock: (locked: boolean) => void;
  returnFocusId?: string;
  modeControl?: React.ReactNode;
}) {
  const client = useQueryClient();
  const privateMode = useContext(PrivacyContext);
  const [baseline, setBaseline] = useState(transfer);
  const [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [conflict, setConflict] = useState(false),
    [confirmDelete, setConfirmDelete] = useState(false),
    [error, setError] = useState("");
  const attempt = useRef<(() => Promise<Transfer | undefined>) | null>(null),
    inFlight = useRef(false);
  const operation = useRef<"save" | "delete">("save");
  const schema = useMemo(() => makeSchema(accounts), [accounts]);
  const {
    register,
    reset,
    watch,
    setValue,
    handleSubmit,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: defaults(transfer, accounts, actorId, ledgerId),
  });
  const currencyOf = (id: string) =>
    accounts.find((row) => row.id === id)?.currency ?? "USD";
  const fromCurrency = currencyOf(watch("fromAccountId"));
  const toCurrency = currencyOf(watch("toAccountId"));
  const crossCurrency = fromCurrency !== toCurrency;
  // The bonus on a new transfer (ADR 0023): the destination's rate prefills it from the
  // received amount until the person types their own figure.
  const toAccount = accounts.find((row) => row.id === watch("toAccountId"));
  const toId = toAccount?.id;
  const toCategory = toAccount?.bonusCategoryId ?? "";
  const bps = !baseline ? (toAccount?.inboundBonusBps ?? null) : null;
  const bonusOn = watch("bonusOn");
  const receivedMinor = amountMinor(
    watch(crossCurrency ? "receivedAmount" : "amount"),
    toCurrency,
  );
  const bonusEdited = useRef(false);
  const lastTo = useRef<string | undefined>(undefined);
  const hasBonus = !!baseline?.bonus && !baseline.bonus.deletedAt;
  const [alsoDeleteBonus, setAlsoDeleteBonus] = useState(true);
  useEffect(() => {
    if (baseline) return;
    if (lastTo.current !== toId) {
      lastTo.current = toId;
      bonusEdited.current = false;
      setValue("bonusOn", !!bps);
      setValue("bonusAmount", "");
      setValue("bonusCategoryId", toCategory);
    }
    if (bps && !bonusEdited.current)
      setValue(
        "bonusAmount",
        receivedMinor && receivedMinor > 0
          ? decimalFromCents(
              bonusFromBps(receivedMinor, bps),
              currencyDigits(toCurrency),
            )
          : "",
      );
  }, [baseline, toId, toCategory, bps, receivedMinor, toCurrency, setValue]);
  // The fee on a new transfer (ADR 0025): the sending account's remembered fee and category
  // prefill the box until the person types their own.
  const fromAccount = accounts.find((row) => row.id === watch("fromAccountId"));
  const fromId = fromAccount?.id;
  const feeEdited = useRef(false);
  const lastFrom = useRef<string | undefined>(undefined);
  const hasFee = !!baseline?.fee && !baseline.fee.deletedAt;
  const [alsoDeleteFee, setAlsoDeleteFee] = useState(true);
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => {
    if (baseline || lastFrom.current === fromId) return;
    lastFrom.current = fromId;
    feeEdited.current = false;
    setValue("feeText", defaultFeeText(fromAccount));
    setValue("feeCategoryId", fromAccount?.feeCategoryId ?? "");
  }, [baseline, fromId, fromAccount, setValue]);
  const feeText = watch("feeText");
  const feeInput = parseFee(feeText, fromCurrency);
  const sentMinor = amountMinor(watch("amount"), fromCurrency);
  const feeCost = feeMinor(feeInput, sentMinor);
  const feeCategoryId = watch("feeCategoryId");
  const bonusCategoryId = watch("bonusCategoryId");
  // The categories live under More; open it whenever one of them is needed and missing.
  const needsCategory =
    (feeInput.kind !== "none" &&
      feeInput.kind !== "invalid" &&
      !feeCategoryId) ||
    (bonusOn && !bonusCategoryId) ||
    !!errors.feeCategoryId ||
    !!errors.bonusCategoryId;
  useEffect(() => {
    if (needsCategory) setMoreOpen(true);
  }, [needsCategory]);
  useEffect(() => {
    onLock(busy || uncertain);
  }, [busy, uncertain, onLock]);
  useEffect(() => {
    if (open && uncertain) document.getElementById("retry-transfer")?.focus();
  }, [open, uncertain]);
  useEffect(() => {
    if (!open && !baseline && !attempt.current && !inFlight.current) {
      reset(defaults(undefined, accounts, actorId, ledgerId));
      lastTo.current = undefined;
      lastFrom.current = undefined;
      setMoreOpen(false);
      setError("");
    }
  }, [open, baseline, accounts, actorId, ledgerId, reset]);
  const execute = async (mode: "save" | "delete", values?: Values) => {
    if (inFlight.current || !writable || blocked || conflict) return;
    if (!attempt.current) {
      if (mode === "delete" && baseline) {
        const run = prepareTransactionUndo(ledgerId, transferLeg(baseline), {
          deleteBonus: hasBonus && alsoDeleteBonus,
          deleteFee: hasFee && alsoDeleteFee,
        });
        attempt.current = async () => {
          await run();
          return undefined;
        };
      } else {
        if (!values) return;
        const body = buildTransferBody(values, accounts, baseline);
        attempt.current = prepareTransferSave(ledgerId, baseline, body);
      }
      operation.current = mode;
    }
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const row = await attempt.current();
      attempt.current = null;
      setUncertain(false);
      onLock(false);
      if (operation.current === "delete" && baseline)
        onDeleted?.(transferLeg(baseline));
      else if (row) {
        rememberAccount(actorId, ledgerId, row.fromAccountId);
        onSaved(transferLeg(row), {
          bonus: !!row.bonus && !row.bonus.deletedAt,
          fee: !!row.fee && !row.fee.deletedAt,
        });
      }
    } catch (failure) {
      const unknown = !(failure instanceof ApiError) || failure.status >= 500;
      setUncertain(unknown);
      if (!unknown) {
        attempt.current = null;
        setConflict(
          !!baseline && (failure.status === 409 || failure.status === 404),
        );
      }
      setError(
        unknown
          ? "We couldn't confirm this transfer. Retry to confirm the same request."
          : baseline && failure instanceof ApiError && failure.status === 409
            ? "This transfer or its accounts changed. Reload the latest details before trying again. Reloading replaces this form."
            : failure instanceof ApiError
              ? failure.message
              : "Couldn't save the transfer.",
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const reload = async () => {
    if (!baseline || inFlight.current) return;
    setBusy(true);
    try {
      const latest = await getTransfer(ledgerId, baseline.id);
      await client.invalidateQueries({ queryKey: ["accounts", ledgerId] });
      await client.invalidateQueries({ queryKey: ["home", ledgerId] });
      setBaseline(latest);
      reset(defaults(latest, accounts, actorId, ledgerId));
      setConflict(false);
      setConfirmDelete(false);
      setError("");
    } catch {
      setError("Couldn't reload this transfer. It may no longer be available.");
    } finally {
      setBusy(false);
    }
  };
  const form: TransferFormContext = {
    register,
    watch,
    setValue,
    errors,
    accounts,
    baseline,
    categories,
    privateMode,
    ledgerId,
    fromCurrency,
    toCurrency,
    crossCurrency,
    fromAccount,
    toAccount,
    bps,
    bonusOn,
    feeInput,
    feeCost,
    sentMinor,
    feeCategoryId,
    bonusCategoryId,
    feeEdited,
    bonusEdited,
    moreOpen,
    setMoreOpen,
    hasFee,
    hasBonus,
  };
  return (
    <EditorDialog
      open={open}
      title={
        baseline
          ? writable
            ? "Edit transfer"
            : "Transfer details"
          : "Add transaction"
      }
      description="Move money between accounts. Both balances change together; this does not count as income or spending."
      busy={busy}
      onDismiss={onDismiss}
      returnFocusId={returnFocusId}
      fallbackFocusId="main-content"
      closeLabel={
        baseline ? "Close transfer editor" : "Close transaction dialog"
      }
      contentClassName="transaction-dialog"
      initialFocusId={uncertain ? "retry-transfer" : "transfer-amount"}
    >
      {modeControl}
      {blocked && (
        <p role="alert">
          Confirm the earlier transaction action before adding a transfer.
        </p>
      )}
      {!writable && (
        <p role="status">You have read-only access to this ledger.</p>
      )}
      {!baseline && accounts.filter((row) => !row.archivedAt).length < 2 && (
        <p role="status" className="form-help">
          Create two active accounts to record a transfer.
        </p>
      )}
      <form
        noValidate
        onSubmit={(event) => {
          if (attempt.current) {
            event.preventDefault();
            void execute(operation.current);
          } else void handleSubmit((values) => execute("save", values))(event);
        }}
      >
        <fieldset
          className="account-fields transaction-fields"
          disabled={
            busy ||
            uncertain ||
            conflict ||
            confirmDelete ||
            blocked ||
            !writable
          }
        >
          {renderAmountFields(form)}
          {renderAccountPickers(form)}
          {renderFeeField(form)}
          {renderBonusFields(form)}
          {renderMoreCategories(form)}
          {renderLinkedNotes(form)}
          {renderWhenAndNote(form)}
        </fieldset>
        {error && (
          <p role="alert" className="field-error account-error">
            {error}
          </p>
        )}
        {confirmDelete && !uncertain && !conflict && (
          <>
            <p role="alert">
              Delete this transfer? Both legs will be deleted. You can undo the
              deletion.
            </p>
            {hasBonus && (
              <label className="split-toggle">
                <input
                  type="checkbox"
                  checked={alsoDeleteBonus}
                  onChange={(event) => setAlsoDeleteBonus(event.target.checked)}
                />{" "}
                Also delete its bonus entry
              </label>
            )}
            {hasFee && (
              <label className="split-toggle">
                <input
                  type="checkbox"
                  checked={alsoDeleteFee}
                  onChange={(event) => setAlsoDeleteFee(event.target.checked)}
                />{" "}
                Also delete its fee entry
              </label>
            )}
          </>
        )}
        <div className="account-dialog-actions transaction-editor-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={onDismiss}
          >
            {uncertain ? "Close for now" : "Close"}
          </button>
          {writable &&
            (uncertain ? (
              <Button
                id="retry-transfer"
                type="button"
                disabled={busy || blocked}
                onClick={() => void execute(operation.current)}
              >
                Retry {operation.current === "delete" ? "delete" : "save"}
              </Button>
            ) : conflict ? (
              <Button
                type="button"
                disabled={busy}
                onClick={() => void reload()}
              >
                Reload latest details
              </Button>
            ) : confirmDelete ? (
              <>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setConfirmDelete(false)}
                >
                  Keep transfer
                </button>
                <Button
                  type="button"
                  className="danger-action"
                  disabled={busy}
                  onClick={() => void execute("delete")}
                >
                  Confirm delete
                </Button>
              </>
            ) : (
              <>
                {baseline && (
                  <button
                    type="button"
                    className="secondary-button danger-action"
                    disabled={busy}
                    onClick={() => setConfirmDelete(true)}
                  >
                    Delete transfer
                  </button>
                )}
                <Button
                  type="submit"
                  disabled={
                    busy ||
                    blocked ||
                    (!baseline &&
                      accounts.filter((row) => !row.archivedAt).length < 2)
                  }
                >
                  {busy
                    ? "Saving…"
                    : baseline
                      ? "Save changes"
                      : "Save transfer"}
                </Button>
              </>
            ))}
        </div>
      </form>
    </EditorDialog>
  );
}

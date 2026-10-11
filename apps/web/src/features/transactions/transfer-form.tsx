import { zodResolver } from "@hookform/resolvers/zod";
import {
  type Account,
  createTransferSchema,
  currencyDigits,
  deriveRate,
  parseMinorUnits,
  rateSchema,
  type Transaction,
  type Transfer,
} from "@ledgerline/shared";
import { Button } from "@ledgerline/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { DateTimeInput } from "../../components/date-time-input";
import { EditorDialog } from "../../components/editor-dialog";
import { NativeSelect } from "../../components/native-select";
import { ApiError } from "../../lib/api";
import { cleanAmountText, decimalFromCents } from "../accounts/money";
import { EntryRate } from "../currencies/entry-rate";
import { rateSentence } from "../currencies/format";
import { PrivacyContext } from "../shell/preferences";
import { prepareTransactionUndo } from "./api";
import {
  amountMessage,
  amountMinor,
  isPositiveAmount,
  lastActiveAccount,
  localToday,
  rememberAccount,
  transactionFormSchema,
} from "./form";
import { getTransfer, prepareTransferSave, transferLeg } from "./transfers";

/** The transfer form's rules depend on the two accounts' currencies, so they are built per list. */
function makeSchema(accounts: readonly Account[]) {
  const currencyOf = (id: string) =>
    accounts.find((row) => row.id === id)?.currency ?? "USD";
  return z
    .object({
      amount: z.string().trim().transform(cleanAmountText),
      // Only used when the two accounts have different currencies.
      receivedAmount: z.string().trim().transform(cleanAmountText),
      // A rate set by hand ("" means use the stored one); only for transfers between two
      // non-USD currencies.
      fxRate: z.string(),
      fromAccountId: createTransferSchema.shape.fromAccountId,
      toAccountId: createTransferSchema.shape.toAccountId,
      date: createTransferSchema.shape.date,
      time: transactionFormSchema.shape.time,
      note: transactionFormSchema.shape.note,
    })
    .superRefine((row, ctx) => {
      const from = currencyOf(row.fromAccountId);
      const to = currencyOf(row.toAccountId);
      if (row.fromAccountId === row.toAccountId)
        ctx.addIssue({
          code: "custom",
          path: ["toAccountId"],
          message: "Choose two different accounts.",
        });
      if (!isPositiveAmount(row.amount, from))
        ctx.addIssue({
          code: "custom",
          path: ["amount"],
          message: amountMessage(from),
        });
      if (from !== to && !isPositiveAmount(row.receivedAmount, to))
        ctx.addIssue({
          code: "custom",
          path: ["receivedAmount"],
          message: `Enter how much arrives in ${to}.`,
        });
      if (row.fxRate !== "" && !rateSchema.safeParse(row.fxRate).success)
        ctx.addIssue({
          code: "custom",
          path: ["fxRate"],
          message: "Enter a valid exchange rate.",
        });
    });
}
type Values = z.infer<ReturnType<typeof makeSchema>>;
function defaults(
  row: Transfer | undefined,
  accounts: readonly Account[],
  actorId: string,
  ledgerId: string,
): Values {
  const from = lastActiveAccount(actorId, ledgerId, accounts);
  return row
    ? {
        amount: decimalFromCents(
          row.amount.amount,
          currencyDigits(row.amount.currency),
        ),
        receivedAmount:
          row.receivedAmount.currency === row.amount.currency
            ? ""
            : decimalFromCents(
                row.receivedAmount.amount,
                currencyDigits(row.receivedAmount.currency),
              ),
        // The transfer keeps its saved rate unless one is set here.
        fxRate: "",
        fromAccountId: row.fromAccountId,
        toAccountId: row.toAccountId,
        date: row.date,
        time: row.time ?? "",
        note: row.note ?? "",
      }
    : {
        amount: "",
        receivedAmount: "",
        fxRate: "",
        fromAccountId: from,
        toAccountId:
          accounts.find((account) => !account.archivedAt && account.id !== from)
            ?.id ?? "",
        date: localToday(),
        time: "",
        note: "",
      };
}
export function TransferForm({
  actorId = "",
  ledgerId,
  transfer,
  accounts,
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
  open: boolean;
  writable: boolean;
  blocked?: boolean;
  onDismiss: () => void;
  onSaved: (row: Transaction) => void;
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
  useEffect(() => {
    onLock(busy || uncertain);
  }, [busy, uncertain, onLock]);
  useEffect(() => {
    if (open && uncertain) document.getElementById("retry-transfer")?.focus();
  }, [open, uncertain]);
  useEffect(() => {
    if (!open && !baseline && !attempt.current && !inFlight.current) {
      reset(defaults(undefined, accounts, actorId, ledgerId));
      setError("");
    }
  }, [open, baseline, accounts, actorId, ledgerId, reset]);
  const execute = async (mode: "save" | "delete", values?: Values) => {
    if (inFlight.current || !writable || blocked || conflict) return;
    if (!attempt.current) {
      if (mode === "delete" && baseline) {
        const run = prepareTransactionUndo(ledgerId, transferLeg(baseline));
        attempt.current = async () => {
          await run();
          return undefined;
        };
      } else {
        if (!values) return;
        const from = currencyOf(values.fromAccountId);
        const to = currencyOf(values.toAccountId);
        const { receivedAmount, fxRate, ...fields } = values;
        const body = createTransferSchema.parse({
          ...fields,
          amount: {
            amount: parseMinorUnits(values.amount, currencyDigits(from)),
            currency: from,
          },
          ...(from !== to
            ? {
                receivedAmount: {
                  amount: parseMinorUnits(receivedAmount, currencyDigits(to)),
                  currency: to,
                },
              }
            : {}),
          // A hand-set rate only matters when neither account is in the base currency.
          ...(fxRate && from !== "USD" && to !== "USD" ? { fxRate } : {}),
          time: values.time || null,
          note: values.note || null,
        });
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
        onSaved(transferLeg(row));
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
          <label htmlFor="transfer-amount">
            {crossCurrency
              ? `Amount sent (${fromCurrency})`
              : `Amount (${fromCurrency})`}
          </label>
          <input
            id="transfer-amount"
            className="transaction-amount"
            type={privateMode ? "password" : "text"}
            inputMode="decimal"
            autoComplete="off"
            {...register("amount")}
          />
          {errors.amount && (
            <p className="field-error">{errors.amount.message}</p>
          )}
          {crossCurrency && (
            <>
              <label htmlFor="transfer-received">
                Amount received ({toCurrency})
              </label>
              <input
                id="transfer-received"
                type={privateMode ? "password" : "text"}
                inputMode="decimal"
                autoComplete="off"
                {...register("receivedAmount")}
              />
              {errors.receivedAmount && (
                <p className="field-error">{errors.receivedAmount.message}</p>
              )}
              <TransferRate
                sent={amountMinor(watch("amount"), fromCurrency)}
                received={amountMinor(watch("receivedAmount"), toCurrency)}
                fromCurrency={fromCurrency}
                toCurrency={toCurrency}
              />
              {fromCurrency !== "USD" && toCurrency !== "USD" && (
                <EntryRate
                  ledgerId={ledgerId}
                  currency={fromCurrency}
                  date={watch("date")}
                  amountMinor={amountMinor(watch("amount"), fromCurrency)}
                  manualRate={watch("fxRate")}
                  onManualRate={(rate) => setValue("fxRate", rate)}
                />
              )}
            </>
          )}
          <div className="transaction-context">
            {(["fromAccountId", "toAccountId"] as const).map((field) => (
              <div key={field}>
                <label htmlFor={`transfer-${field}`}>
                  {field === "fromAccountId" ? "From account" : "To account"}
                </label>
                <NativeSelect
                  id={`transfer-${field}`}
                  {...register(field, {
                    // A rate set by hand belonged to the old accounts.
                    onChange: () => setValue("fxRate", ""),
                  })}
                >
                  <option value="" disabled>
                    Choose an account
                  </option>
                  {accounts
                    .filter(
                      (row) => !row.archivedAt || row.id === baseline?.[field],
                    )
                    .map((row) => (
                      <option
                        key={row.id}
                        value={row.id}
                        disabled={!!row.archivedAt}
                      >
                        {row.name}
                        {row.archivedAt ? " (archived)" : ""}
                      </option>
                    ))}
                </NativeSelect>
                {errors[field] && (
                  <p className="field-error">{errors[field]?.message}</p>
                )}
              </div>
            ))}
          </div>
          <div className="transaction-context">
            <div>
              <label htmlFor="transfer-date">Date</label>
              <DateTimeInput
                label="Date"
                required
                id="transfer-date"
                type="date"
                min="0001-01-01"
                max="9999-12-31"
                {...register("date")}
              />
              {errors.date && (
                <p className="field-error">Choose a valid date.</p>
              )}
            </div>
            <div>
              <label htmlFor="transfer-time">Time (optional)</label>
              <DateTimeInput
                label="Time (optional)"
                id="transfer-time"
                type="time"
                step={60}
                {...register("time")}
              />
              {errors.time && (
                <p className="field-error">Choose a valid time.</p>
              )}
            </div>
          </div>
          <label htmlFor="transfer-note">Note</label>
          <textarea
            id="transfer-note"
            rows={2}
            maxLength={2000}
            {...register("note")}
          />
        </fieldset>
        {error && (
          <p role="alert" className="field-error account-error">
            {error}
          </p>
        )}
        {confirmDelete && !uncertain && !conflict && (
          <p role="alert">
            Delete this transfer? Both legs will be deleted. You can undo the
            deletion.
          </p>
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

/**
 * When one account is in USD, the amounts themselves fix the rate; show it so a typo in the
 * received amount is easy to spot ("1 USD = 0.89 EUR").
 */
function TransferRate({
  sent,
  received,
  fromCurrency,
  toCurrency,
}: {
  sent: number | null;
  received: number | null;
  fromCurrency: string;
  toCurrency: string;
}) {
  if (sent === null || received === null) return null;
  const base =
    fromCurrency === "USD" ? sent : toCurrency === "USD" ? received : null;
  if (base === null) return null;
  const foreign = fromCurrency === "USD" ? toCurrency : fromCurrency;
  const foreignAmount = fromCurrency === "USD" ? received : sent;
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

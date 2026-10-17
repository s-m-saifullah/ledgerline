import { zodResolver } from "@hookform/resolvers/zod";
import {
  type Account,
  bonusFromBps,
  type Category,
  createTransferSchema,
  currencyDigits,
  deriveRate,
  feeFromBps,
  parseMinorUnits,
  rateSchema,
  type Transaction,
  type Transfer,
} from "@ledgerline/shared";
import { Button } from "@ledgerline/ui";
import { useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { AmountInput } from "../../components/amount-input";
import { DateTimeInput } from "../../components/date-time-input";
import { EditorDialog } from "../../components/editor-dialog";
import { NativeSelect } from "../../components/native-select";
import { ApiError } from "../../lib/api";
import { cleanAmountText, decimalFromCents } from "../../lib/money";
import { PrivacyContext } from "../../lib/preferences";
import { rateSentence } from "../../lib/rate-format";
import { localToday } from "../../lib/time";
import { CategoryPicker } from "../categories/picker";
import { EntryRate } from "../currencies/entry-rate";
import { prepareTransactionUndo } from "./api";
import { defaultFeeText, feeHint, feeMinor, parseFee } from "./fee";
import { FeePreview } from "./fee-preview";
import {
  amountMessage,
  amountMinor,
  isPositiveAmount,
  lastActiveAccount,
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
      // An optional bonus on the received amount (ADR 0023); only sent when switched on.
      bonusOn: z.boolean(),
      bonusAmount: z.string().trim().transform(cleanAmountText),
      bonusCategoryId: z.string(),
      // An optional fee on the sending account (ADR 0025): "2" is fixed, "2%" is a percentage.
      feeText: z.string(),
      feeCategoryId: z.string(),
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
      if (row.bonusOn) {
        if (!isPositiveAmount(row.bonusAmount, to))
          ctx.addIssue({
            code: "custom",
            path: ["bonusAmount"],
            message: `Enter the bonus in ${to}, or switch it off.`,
          });
        if (!row.bonusCategoryId)
          ctx.addIssue({
            code: "custom",
            path: ["bonusCategoryId"],
            message: "Choose a category for the bonus.",
          });
      }
      const fee = parseFee(row.feeText, from);
      if (fee.kind === "invalid")
        ctx.addIssue({
          code: "custom",
          path: ["feeText"],
          message: fee.message,
        });
      else if (fee.kind !== "none") {
        const sent = amountMinor(row.amount, from);
        if (
          fee.kind === "percent" &&
          sent !== null &&
          feeFromBps(sent, fee.bps) < 1
        )
          ctx.addIssue({
            code: "custom",
            path: ["feeText"],
            message: "That fee comes to less than the smallest unit.",
          });
        if (!row.feeCategoryId)
          ctx.addIssue({
            code: "custom",
            path: ["feeCategoryId"],
            message: "Choose a category for the fee.",
          });
      }
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
        bonusOn: false,
        bonusAmount: "",
        bonusCategoryId: "",
        feeText: "",
        feeCategoryId: "",
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
        bonusOn: false,
        bonusAmount: "",
        bonusCategoryId: "",
        feeText: "",
        feeCategoryId: "",
      };
}
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
        const from = currencyOf(values.fromAccountId);
        const to = currencyOf(values.toAccountId);
        const {
          receivedAmount,
          fxRate,
          bonusOn: withBonus,
          bonusAmount,
          bonusCategoryId,
          feeText: typedFee,
          feeCategoryId: feeCategory,
          ...fields
        } = values;
        const fee = parseFee(typedFee, from);
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
          ...(withBonus && !baseline
            ? {
                bonus: {
                  amount: {
                    amount: parseMinorUnits(bonusAmount, currencyDigits(to)),
                    currency: to,
                  },
                  categoryId: bonusCategoryId,
                },
              }
            : {}),
          ...(!baseline && fee.kind === "fixed"
            ? {
                fee: {
                  amount: { amount: fee.minor, currency: from },
                  categoryId: feeCategory,
                },
              }
            : {}),
          ...(!baseline && fee.kind === "percent"
            ? { fee: { basisPoints: fee.bps, categoryId: feeCategory } }
            : {}),
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
          <AmountInput
            currency={fromCurrency}
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
              <AmountInput
                currency={toCurrency}
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
          {!baseline && fromAccount && (
            <div className="transfer-fee">
              <label htmlFor="transfer-fee">Fee (optional)</label>
              <input
                id="transfer-fee"
                type={privateMode ? "password" : "text"}
                inputMode="text"
                autoComplete="off"
                placeholder="2 or 2%"
                aria-invalid={!!errors.feeText}
                aria-describedby="transfer-fee-help transfer-fee-preview"
                {...register("feeText", {
                  onChange: () => {
                    feeEdited.current = true;
                  },
                })}
              />
              <p id="transfer-fee-help" className="form-help">
                {feeHint} Charged to {fromAccount.name} in {fromCurrency}; the
                amount received stays the same.
              </p>
              {errors.feeText && (
                <p className="field-error">{errors.feeText.message}</p>
              )}
              <p
                id="transfer-fee-preview"
                className="form-help"
                aria-live="polite"
              >
                <FeePreview
                  fee={feeInput.kind}
                  cost={feeCost}
                  sent={sentMinor}
                  currency={fromCurrency}
                  accountName={fromAccount.name}
                />
              </p>
            </div>
          )}
          {!baseline && toAccount && (bps || bonusOn) && (
            <div className="transfer-bonus">
              <label className="split-toggle">
                <input
                  type="checkbox"
                  checked={bonusOn}
                  onChange={(event) =>
                    setValue("bonusOn", event.target.checked)
                  }
                />{" "}
                Add a bonus{bps ? ` (${bps / 100}% of what arrives)` : ""}
              </label>
              {bonusOn && (
                <>
                  <label htmlFor="transfer-bonus-amount">
                    Bonus ({toCurrency})
                  </label>
                  <AmountInput
                    currency={toCurrency}
                    id="transfer-bonus-amount"
                    type={privateMode ? "password" : "text"}
                    inputMode="decimal"
                    autoComplete="off"
                    {...register("bonusAmount", {
                      onChange: () => {
                        bonusEdited.current = true;
                      },
                    })}
                  />
                  {errors.bonusAmount && (
                    <p className="field-error">{errors.bonusAmount.message}</p>
                  )}
                  <p className="form-help">
                    Saved as income in {toAccount.name} together with the
                    transfer. Switch it off to save the transfer alone.
                  </p>
                </>
              )}
            </div>
          )}
          {!baseline && toAccount && !bps && !bonusOn && (
            <button
              type="button"
              className="quiet-button inline-category-toggle"
              onClick={() => setValue("bonusOn", true)}
            >
              <Plus size={16} />
              Add a bonus
            </button>
          )}
          {!baseline && (
            <details
              className="transaction-details transfer-more"
              open={moreOpen}
              onToggle={(event) => setMoreOpen(event.currentTarget.open)}
            >
              <summary>
                More
                <span className="muted transfer-more-hint">
                  {" "}
                  fee {bonusOn || bps ? "and bonus " : ""}categories
                </span>
              </summary>
              <div className="account-fields">
                <CategoryPicker
                  categories={categories}
                  kind="expense"
                  label="Fee category"
                  value={feeCategoryId || null}
                  onChange={(id) => setValue("feeCategoryId", id ?? "")}
                />
                {errors.feeCategoryId && (
                  <p className="field-error">{errors.feeCategoryId.message}</p>
                )}
                {bonusOn && (
                  <>
                    <CategoryPicker
                      categories={categories}
                      kind="income"
                      label="Bonus category"
                      value={bonusCategoryId || null}
                      onChange={(id) => setValue("bonusCategoryId", id ?? "")}
                    />
                    {errors.bonusCategoryId && (
                      <p className="field-error">
                        {errors.bonusCategoryId.message}
                      </p>
                    )}
                  </>
                )}
                <p className="form-help">
                  Used only when the transfer has a fee
                  {bonusOn ? " or a bonus" : ""}. An account can remember its
                  default categories when you edit it.
                </p>
              </div>
            </details>
          )}
          {hasFee && (
            <p className="form-help">
              This transfer has a fee entry. It is a separate expense, so edit
              it from the transaction list.
            </p>
          )}
          {hasBonus && (
            <p className="form-help">
              This transfer has a bonus entry. It is separate income, so edit it
              from the transaction list.
            </p>
          )}
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

import { zodResolver } from "@hookform/resolvers/zod";
import {
  type Account,
  type Category,
  createCategorySchema,
  type Transaction,
} from "@ledgerline/shared";
import { Button } from "@ledgerline/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Plus, X } from "lucide-react";
import { useContext, useEffect, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { DateTimeInput } from "../../components/date-time-input";
import { EditorDialog } from "../../components/editor-dialog";
import { NativeSelect } from "../../components/native-select";
import { Toast } from "../../components/toast";
import { ApiError } from "../../lib/api";
import { getCategories, prepareCategorySave } from "../categories/api";
import { CategoryPicker } from "../categories/picker";
import { categoryOptions } from "../categories/tree";
import { EntryRate } from "../currencies/entry-rate";
import { PrivacyContext } from "../shell/preferences";
import {
  getActiveAccounts,
  prepareTransactionCreate,
  prepareTransactionUndo,
} from "./api";
import {
  amountMinor,
  rememberAccount,
  type TransactionFormValues,
  transactionBody,
  transactionDefaults,
  transactionFormSchema,
} from "./form";
import { SplitFields } from "./split-fields";
import { TransferForm } from "./transfer-form";
import { useTransactionWorkspace } from "./workspace";

const uncertainFailure = (failure: unknown) =>
  !(failure instanceof ApiError) || failure.status >= 500;
export function QuickAdd({
  actorId,
  ledgerId,
  writable,
  open,
  onDismiss,
  returnFocusId,
}: {
  actorId: string;
  ledgerId: string;
  writable: boolean;
  open: boolean;
  onDismiss: () => void;
  returnFocusId: string;
}) {
  const [mode, setMode] = useState<"entry" | "transfer">("entry");
  const workspace = useTransactionWorkspace();
  const externalBlocked = workspace?.editorLocked ?? false;
  const setQuickAddLocked = workspace?.setQuickAddLocked;
  const client = useQueryClient();
  const accounts = useQuery({
    queryKey: ["accounts", ledgerId, "quick-add"],
    queryFn: ({ signal }) => getActiveAccounts(ledgerId, signal),
    enabled: open,
    refetchOnMount: "always",
  });
  const categories = useQuery({
    queryKey: ["categories", ledgerId],
    queryFn: ({ signal }) => getCategories(ledgerId, signal),
    enabled: open,
    refetchOnMount: "always",
  });
  const [saved, setSaved] = useState<Transaction | null>(null);
  const [undoError, setUndoError] = useState("");
  const [undoBusy, setUndoBusy] = useState(false);
  const [formLocked, setFormLocked] = useState(false);
  const [undoUncertain, setUndoUncertain] = useState(false);
  useEffect(() => {
    setQuickAddLocked?.(formLocked || undoBusy || undoUncertain);
  }, [formLocked, undoBusy, undoUncertain, setQuickAddLocked]);
  const undoAttempt = useRef<(() => Promise<void>) | null>(null);
  const undoInFlight = useRef(false);
  const invalidate = () => {
    void client.invalidateQueries({ queryKey: ["accounts", ledgerId] });
    void client.invalidateQueries({ queryKey: ["transactions", ledgerId] });
    void client.invalidateQueries({ queryKey: ["home", ledgerId] });
  };
  const undo = async () => {
    if (
      !saved ||
      undoInFlight.current ||
      formLocked ||
      externalBlocked ||
      !writable
    )
      return;
    undoInFlight.current = true;
    setUndoBusy(true);
    setUndoError("");
    undoAttempt.current ??= prepareTransactionUndo(ledgerId, saved);
    try {
      await undoAttempt.current();
      setSaved(null);
      setUndoUncertain(false);
      undoAttempt.current = null;
      invalidate();
    } catch (failure) {
      if (uncertainFailure(failure)) {
        setUndoUncertain(true);
        setUndoError(
          "We couldn't confirm Undo. Retry to confirm the same action.",
        );
      } else {
        undoAttempt.current = null;
        setUndoUncertain(false);
        setUndoError(
          failure instanceof ApiError && failure.status === 409
            ? "This entry changed. Open its latest details before deleting it."
            : failure instanceof ApiError
              ? failure.message
              : "Couldn't undo this entry.",
        );
      }
    } finally {
      undoInFlight.current = false;
      setUndoBusy(false);
    }
  };
  const refreshed = async () => {
    await Promise.all([accounts.refetch(), categories.refetch()]);
  };
  const hasData = accounts.data && categories.data;
  const modeControl = (
    <fieldset
      className="balance-direction"
      disabled={formLocked || undoBusy || undoUncertain || externalBlocked}
    >
      <legend>Add mode</legend>
      <label>
        <input
          type="radio"
          name="add-mode"
          checked={mode === "entry"}
          onChange={() => setMode("entry")}
        />
        Income / expense
      </label>
      <label>
        <input
          type="radio"
          name="add-mode"
          checked={mode === "transfer"}
          onChange={() => setMode("transfer")}
        />
        Transfer
      </label>
    </fieldset>
  );
  return (
    <>
      {hasData && mode === "transfer" ? (
        <TransferForm
          actorId={actorId}
          ledgerId={ledgerId}
          accounts={accounts.data}
          open={open}
          writable={writable}
          blocked={undoBusy || undoUncertain || externalBlocked}
          onDismiss={onDismiss}
          onLock={setFormLocked}
          returnFocusId={returnFocusId}
          modeControl={modeControl}
          onSaved={(transaction) => {
            setSaved(transaction);
            setUndoError("");
            setUndoUncertain(false);
            undoAttempt.current = null;
            invalidate();
            onDismiss();
          }}
        />
      ) : hasData ? (
        <QuickAddForm
          modeControl={modeControl}
          returnFocusId={returnFocusId}
          actorId={actorId}
          ledgerId={ledgerId}
          accounts={accounts.data}
          categories={categories.data}
          open={open}
          writable={writable}
          blocked={undoBusy || undoUncertain || externalBlocked}
          onDismiss={onDismiss}
          onLock={setFormLocked}
          onRefresh={refreshed}
          onCategorySaved={(category) => {
            client.setQueryData<Category[]>(
              ["categories", ledgerId],
              (items) => [
                ...(items ?? []).filter((row) => row.id !== category.id),
                category,
              ],
            );
            void client.invalidateQueries({
              queryKey: ["categories", ledgerId],
            });
            void client.invalidateQueries({ queryKey: ["home", ledgerId] });
          }}
          onSaved={(transaction) => {
            setSaved(transaction);
            setUndoError("");
            setUndoUncertain(false);
            undoAttempt.current = null;
            invalidate();
            onDismiss();
          }}
        />
      ) : (
        <EditorDialog
          open={open}
          title="Add transaction"
          description="Record money coming in or going out."
          busy={false}
          onDismiss={onDismiss}
          returnFocusId={returnFocusId}
          fallbackFocusId="main-content"
          closeLabel="Close transaction dialog"
        >
          {accounts.isError || categories.isError ? (
            <div className="account-error">
              <p role="alert">Couldn't load accounts and categories.</p>
              <button
                type="button"
                className="secondary-button"
                onClick={() => void refreshed()}
              >
                Try again
              </button>
            </div>
          ) : (
            <p role="status" className="account-error">
              Opening transaction entry…
            </p>
          )}
        </EditorDialog>
      )}
      {saved && (
        <Toast
          label="Transaction notification"
          durationMs={undoBusy || undoUncertain || undoError ? null : 5000}
          onExpire={() => {
            setSaved(null);
            undoAttempt.current = null;
          }}
        >
          <p role="status">
            {saved.transferId ? "Transfer" : "Transaction"} saved
            {saved.status === "pending" ? " as pending" : ""}.
          </p>
          {undoError && (
            <p role="alert" className="field-error">
              {undoError}
            </p>
          )}
          <button
            type="button"
            className="secondary-button"
            disabled={undoBusy || formLocked || externalBlocked || !writable}
            onClick={() => void undo()}
          >
            {undoBusy ? "Undoing…" : undoUncertain ? "Retry Undo" : "Undo"}
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Dismiss transaction notification"
            disabled={undoBusy || undoUncertain}
            onClick={() => {
              setSaved(null);
              setUndoError("");
              undoAttempt.current = null;
            }}
          >
            <X size={18} />
          </button>
        </Toast>
      )}
    </>
  );
}

export function QuickAddForm({
  actorId,
  ledgerId,
  accounts,
  categories,
  open,
  writable,
  blocked,
  onDismiss,
  onSaved,
  onCategorySaved,
  onRefresh,
  onLock,
  returnFocusId = "add-transaction",
  modeControl,
}: {
  modeControl?: React.ReactNode;
  returnFocusId?: string | undefined;
  actorId: string;
  ledgerId: string;
  accounts: readonly Account[];
  categories: readonly Category[];
  open: boolean;
  writable: boolean;
  blocked: boolean;
  onDismiss: () => void;
  onSaved: (transaction: Transaction) => void;
  onCategorySaved: (category: Category) => void;
  onRefresh: () => Promise<void>;
  onLock?: ((locked: boolean) => void) | undefined;
}) {
  const privateMode = useContext(PrivacyContext);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const attempt = useRef<(() => Promise<Transaction>) | null>(null);
  const inFlight = useRef(false);
  const [newCategory, setNewCategory] = useState(false);
  const [categoryName, setCategoryName] = useState("");
  const [categoryError, setCategoryError] = useState("");
  const [categoryBusy, setCategoryBusy] = useState(false);
  const [categoryUncertain, setCategoryUncertain] = useState(false);
  const categoryAttempt = useRef<(() => Promise<Category>) | null>(null);
  const categoryInFlight = useRef(false);
  const form = useForm<TransactionFormValues>({
    resolver: zodResolver(transactionFormSchema),
    defaultValues: transactionDefaults(actorId, ledgerId, accounts),
  });
  const {
    register,
    control,
    watch,
    reset,
    setValue,
    setError: fieldError,
    handleSubmit,
    formState: { errors },
  } = form;
  const kind = watch("kind");
  const busy = saving || categoryBusy || refreshing;
  useEffect(() => {
    onLock?.(busy || uncertain || categoryUncertain);
  }, [busy, uncertain, categoryUncertain, onLock]);
  useEffect(() => {
    if (open && (uncertain || categoryUncertain))
      document
        .getElementById(
          uncertain ? "retry-transaction-save" : "retry-transaction-category",
        )
        ?.focus();
  }, [open, uncertain, categoryUncertain]);
  const frozen = busy || uncertain || categoryUncertain || blocked || !writable;
  const activeAccounts = accounts.filter((row) => !row.archivedAt);
  const choices = categoryOptions(categories, kind, "");
  useEffect(() => {
    // Keep every original payload intact across close/resume while its outcome is unknown.
    if (
      !open &&
      !attempt.current &&
      !categoryAttempt.current &&
      !inFlight.current &&
      !categoryInFlight.current
    ) {
      reset(transactionDefaults(actorId, ledgerId, accounts));
      setError("");
      setNewCategory(false);
      setCategoryName("");
      setCategoryError("");
    }
  }, [open, reset, actorId, ledgerId, accounts]);
  const executeSave = async (values?: TransactionFormValues) => {
    if (inFlight.current || categoryAttempt.current || blocked || !writable)
      return;
    if (!attempt.current) {
      if (!values) return;
      if (!activeAccounts.some((row) => row.id === values.accountId)) {
        fieldError("accountId", { message: "Choose an active account." });
        return;
      }
      if (
        !values.splitEnabled &&
        !choices.some((option) => option.category.id === values.categoryId)
      ) {
        fieldError("categoryId", {
          message: "Choose an active category for this entry.",
        });
        return;
      }
      attempt.current = prepareTransactionCreate(
        ledgerId,
        transactionBody(values),
      );
    }
    inFlight.current = true;
    setSaving(true);
    setError("");
    try {
      const transaction = await attempt.current();
      attempt.current = null;
      setUncertain(false);
      rememberAccount(actorId, ledgerId, transaction.accountId);
      reset(transactionDefaults(actorId, ledgerId, accounts));
      onSaved(transaction);
    } catch (failure) {
      if (uncertainFailure(failure)) {
        setUncertain(true);
        setError(
          "We couldn't confirm the save. Retry to confirm the same action.",
        );
      } else {
        attempt.current = null;
        setUncertain(false);
        setError(
          failure instanceof ApiError
            ? failure.message
            : "Couldn't save this entry.",
        );
      }
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };
  const createCategory = async () => {
    if (categoryInFlight.current || attempt.current || blocked || !writable)
      return;
    if (!categoryAttempt.current) {
      const parsed = createCategorySchema.safeParse({
        name: categoryName,
        kind,
        parentId: null,
        icon: null,
        color: null,
      });
      if (!parsed.success) {
        setCategoryError("Give the category a name of 1–100 characters.");
        return;
      }
      categoryAttempt.current = prepareCategorySave(
        ledgerId,
        undefined,
        parsed.data,
      );
    }
    categoryInFlight.current = true;
    setCategoryBusy(true);
    setCategoryError("");
    try {
      const category = await categoryAttempt.current();
      categoryAttempt.current = null;
      setCategoryUncertain(false);
      onCategorySaved(category);
      setValue("categoryId", category.id, { shouldValidate: true });
      setNewCategory(false);
      setCategoryName("");
    } catch (failure) {
      if (uncertainFailure(failure)) {
        setCategoryUncertain(true);
        setCategoryError(
          "We couldn't confirm the category. Retry to confirm the same action.",
        );
      } else {
        categoryAttempt.current = null;
        setCategoryUncertain(false);
        setCategoryError(
          failure instanceof ApiError
            ? failure.message
            : "Couldn't add the category.",
        );
      }
    } finally {
      categoryInFlight.current = false;
      setCategoryBusy(false);
    }
  };
  return (
    <EditorDialog
      open={open}
      title="Add transaction"
      description="Amount, category, save. USD only."
      busy={busy}
      onDismiss={onDismiss}
      contentClassName="transaction-dialog"
      initialFocusId={
        uncertain
          ? "retry-transaction-save"
          : categoryUncertain
            ? "retry-transaction-category"
            : blocked
              ? "transaction-dialog-cancel"
              : "transaction-amount"
      }
      returnFocusId={returnFocusId}
      fallbackFocusId="main-content"
      closeLabel="Close transaction dialog"
    >
      {modeControl}
      {!writable && (
        <p role="status" className="account-error">
          You have read-only access to this ledger.
        </p>
      )}
      {blocked && (
        <p role="alert" className="account-error">
          Confirm the earlier transaction action before adding another entry.
        </p>
      )}
      {activeAccounts.length === 0 &&
      !attempt.current &&
      !categoryAttempt.current ? (
        <div className="account-error transaction-setup">
          <p>Create an active account before recording entries.</p>
          <Link to="/more/accounts" className="button" onClick={onDismiss}>
            Set up accounts
          </Link>
        </div>
      ) : (
        <form
          noValidate
          onSubmit={(event) => {
            if (attempt.current) {
              event.preventDefault();
              void executeSave();
            } else void handleSubmit((values) => executeSave(values))(event);
          }}
        >
          <fieldset
            disabled={frozen}
            className="account-fields transaction-fields"
          >
            <fieldset className="balance-direction">
              <legend>Entry type</legend>
              <label>
                <input
                  type="radio"
                  value="expense"
                  {...register("kind", {
                    onChange: () => {
                      setValue("categoryId", "");
                      setValue(
                        "splits",
                        watch("splits")?.map((line) => ({
                          ...line,
                          id: undefined,
                          categoryId: "",
                        })),
                      );
                    },
                  })}
                />
                Expense
              </label>
              <label>
                <input
                  type="radio"
                  value="income"
                  {...register("kind", {
                    onChange: () => {
                      setValue("categoryId", "");
                      setValue(
                        "splits",
                        watch("splits")?.map((line) => ({
                          ...line,
                          id: undefined,
                          categoryId: "",
                        })),
                      );
                    },
                  })}
                />
                Income
              </label>
            </fieldset>
            <label htmlFor="transaction-amount">
              Amount ({watch("currency")})
            </label>
            <input
              id="transaction-amount"
              className="transaction-amount"
              type={privateMode ? "password" : "text"}
              inputMode="decimal"
              autoComplete="off"
              aria-invalid={!!errors.amount}
              aria-describedby="transaction-amount-help"
              {...register("amount")}
            />
            <p
              id="transaction-amount-help"
              className={errors.amount ? "field-error" : "form-help"}
            >
              {errors.amount?.message ??
                (privateMode
                  ? "Privacy mode hides the amount."
                  : "Enter a positive amount; the entry type sets its direction.")}
            </p>
            <EntryRate
              ledgerId={ledgerId}
              currency={watch("currency")}
              date={watch("date")}
              amountMinor={amountMinor(watch("amount"), watch("currency"))}
              manualRate={watch("fxRate")}
              onManualRate={(rate) => setValue("fxRate", rate)}
              disabled={frozen}
            />
            <SplitFields form={form} categories={categories} kind={kind} />
            {!watch("splitEnabled") && (
              <Controller
                name="categoryId"
                control={control}
                render={({ field }) => (
                  <CategoryPicker
                    categories={categories}
                    kind={kind}
                    value={field.value || null}
                    onChange={(id) => field.onChange(id ?? "")}
                    disabled={frozen}
                  />
                )}
              />
            )}
            {errors.categoryId && (
              <p className="field-error">Choose a category.</p>
            )}
            <button
              type="button"
              className="quiet-button inline-category-toggle"
              onClick={() => setNewCategory((value) => !value)}
            >
              <Plus size={16} />
              New category
            </button>
            {newCategory && (
              <div className="inline-category">
                <label htmlFor="quick-category-name">New category name</label>
                <input
                  id="quick-category-name"
                  value={categoryName}
                  onChange={(event) => setCategoryName(event.target.value)}
                  maxLength={100}
                  autoComplete="off"
                />
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => void createCategory()}
                >
                  Add category
                </button>
              </div>
            )}
            <div className="transaction-context">
              <div>
                <label htmlFor="transaction-account">Account</label>
                <NativeSelect
                  id="transaction-account"
                  value={watch("accountId")}
                  onChange={(event) => {
                    setValue("accountId", event.target.value);
                    // The entry is in the account's currency; a hand-set rate was for the old one.
                    setValue(
                      "currency",
                      accounts.find((row) => row.id === event.target.value)
                        ?.currency ?? "USD",
                    );
                    setValue("fxRate", "");
                  }}
                >
                  <option value="" disabled>
                    Choose an account
                  </option>
                  {activeAccounts.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name}
                    </option>
                  ))}
                </NativeSelect>
                {errors.accountId && (
                  <p className="field-error">Choose an active account.</p>
                )}
              </div>
              <div>
                <label htmlFor="transaction-date">Date</label>
                <DateTimeInput
                  label="Date"
                  required
                  id="transaction-date"
                  type="date"
                  min="0001-01-01"
                  max="9999-12-31"
                  aria-invalid={!!errors.date}
                  {...register("date")}
                />
                {errors.date && (
                  <p className="field-error">Choose a valid date.</p>
                )}
              </div>
            </div>
            <details className="transaction-details">
              <summary>More details</summary>
              <div className="account-fields">
                <label htmlFor="transaction-time">Time (optional)</label>
                <DateTimeInput
                  label="Time (optional)"
                  id="transaction-time"
                  type="time"
                  step={60}
                  aria-invalid={!!errors.time}
                  aria-describedby="transaction-time-help"
                  {...register("time")}
                />
                <p id="transaction-time-help" className="form-help">
                  Local time on the selected date. Leave blank if unknown.
                </p>
                {errors.time && (
                  <p className="field-error">Choose a valid time.</p>
                )}
                <label htmlFor="transaction-payee">
                  {kind === "income" ? "Payer" : "Payee"}
                </label>
                <input
                  id="transaction-payee"
                  maxLength={200}
                  autoComplete="off"
                  {...register("payee")}
                />
                <label htmlFor="transaction-note">Note</label>
                <textarea
                  id="transaction-note"
                  maxLength={2000}
                  rows={2}
                  {...register("note")}
                />
                <label htmlFor="transaction-status">Status</label>
                <NativeSelect id="transaction-status" {...register("status")}>
                  <option value="cleared">Cleared</option>
                  <option value="pending">Pending</option>
                </NativeSelect>
                <p className="form-help">
                  Pending entries do not change your posted balance.
                </p>
              </div>
            </details>
          </fieldset>
          {categoryError && (
            <p role="alert" className="field-error account-error">
              {categoryError}
            </p>
          )}
          {categoryUncertain && (
            <button
              id="retry-transaction-category"
              type="button"
              className="secondary-button"
              disabled={busy || blocked || !writable}
              onClick={() => void createCategory()}
            >
              Retry category
            </button>
          )}
          {error && (
            <p role="alert" className="field-error account-error">
              {error}
            </p>
          )}
          {error && !uncertain && (
            <button
              type="button"
              className="quiet-button"
              disabled={busy}
              onClick={async () => {
                setRefreshing(true);
                try {
                  await onRefresh();
                } finally {
                  setRefreshing(false);
                }
              }}
            >
              Refresh choices
            </button>
          )}
          <div className="account-dialog-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              id="transaction-dialog-cancel"
              onClick={onDismiss}
            >
              {uncertain || categoryUncertain ? "Close for now" : "Cancel"}
            </button>
            <Button
              id="retry-transaction-save"
              type="submit"
              disabled={busy || blocked || categoryUncertain || !writable}
            >
              {saving
                ? "Saving…"
                : uncertain
                  ? "Retry save"
                  : "Save transaction"}
            </Button>
          </div>
        </form>
      )}
    </EditorDialog>
  );
}

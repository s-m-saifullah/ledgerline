import { zodResolver } from "@hookform/resolvers/zod";
import {
  type Account,
  type Category,
  createCategorySchema,
  type Transaction,
} from "@ledgerline/shared";
import { Button } from "@ledgerline/ui";
import { Link } from "@tanstack/react-router";
import { useContext, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { EditorDialog } from "../../components/editor-dialog";
import { ApiError } from "../../lib/api";
import { PrivacyContext } from "../../lib/preferences";
import { prepareCategorySave } from "../categories/api";
import { categoryOptions } from "../categories/tree";
import { prepareTransactionCreate } from "./api";
import {
  rememberAccount,
  type TransactionFormValues,
  transactionBody,
  transactionDefaults,
  transactionFormSchema,
} from "./form";
import type { QuickAddContext } from "./quick-add/context";
import {
  renderAccountAndDate,
  renderCategoryFields,
  renderKindAndAmount,
  renderMoreDetails,
  renderRetryAndErrors,
} from "./quick-add/fields";

const uncertainFailure = (failure: unknown) =>
  !(failure instanceof ApiError) || failure.status >= 500;
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
  const ctx: QuickAddContext = {
    form,
    register,
    control,
    watch,
    setValue,
    errors,
    ledgerId,
    privateMode,
    frozen,
    kind,
    accounts,
    activeAccounts,
    categories,
    newCategory,
    setNewCategory,
    categoryName,
    setCategoryName,
    createCategory,
    categoryError,
    categoryUncertain,
    error,
    uncertain,
    busy,
    blocked,
    writable,
    setRefreshing,
    onRefresh,
  };
  return (
    <EditorDialog
      open={open}
      title="Add transaction"
      description="Amount, category, save."
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
          <Link to="/accounts" className="button" onClick={onDismiss}>
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
            {renderKindAndAmount(ctx)}
            {renderCategoryFields(ctx)}
            {renderAccountAndDate(ctx)}
            {renderMoreDetails(ctx)}
          </fieldset>
          {renderRetryAndErrors(ctx)}
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

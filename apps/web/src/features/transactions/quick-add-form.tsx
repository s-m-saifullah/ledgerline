import { zodResolver } from "@hookform/resolvers/zod";
import {
  type Account,
  type Category,
  createCategorySchema,
  type Transaction,
} from "@ledgerline/shared";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { Overlay } from "../../components/overlay";
import { ApiError } from "../../lib/api";
import { prepareCategorySave } from "../categories/api";
import { categoryOptions } from "../categories/tree";
import { prepareTransactionCreate } from "./api";
import { changeKind, EntryFields } from "./entry-fields";
import { type EntryType, TypePill } from "./entry-sheet";
import {
  rememberAccount,
  type TransactionFormValues,
  transactionBody,
  transactionDefaults,
  transactionFormSchema,
} from "./form";
import { NewCategory, SaveErrors } from "./quick-add/fields";

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
  startKind = "expense",
  onTypeChange,
}: {
  /** The kind the form opens on: Add remembers it when the pill moves to Transfer and back. */
  startKind?: "expense" | "income";
  onTypeChange?: ((type: EntryType) => void) | undefined;
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
  const defaults = () => ({
    ...transactionDefaults(actorId, ledgerId, accounts),
    kind: startKind,
  });
  const form = useForm<TransactionFormValues>({
    resolver: zodResolver(transactionFormSchema),
    defaultValues: defaults(),
  });
  const { watch, reset, setValue, setError: fieldError, handleSubmit } = form;
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
      reset({
        ...transactionDefaults(actorId, ledgerId, accounts),
        kind: startKind,
      });
      setError("");
      setNewCategory(false);
      setCategoryName("");
      setCategoryError("");
    }
  }, [open, reset, actorId, ledgerId, accounts, startKind]);
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
      reset({
        ...transactionDefaults(actorId, ledgerId, accounts),
        kind: startKind,
      });
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
  const setup =
    activeAccounts.length === 0 && !attempt.current && !categoryAttempt.current;
  return (
    <Overlay
      open={open}
      title="Add transaction"
      description="Amount, category, save."
      busy={busy}
      onDismiss={onDismiss}
      cancelLabel={uncertain || categoryUncertain ? "Close for now" : "Cancel"}
      initialFocusId={
        uncertain
          ? "retry-transaction-save"
          : categoryUncertain
            ? "retry-transaction-category"
            : blocked
              ? undefined
              : "transaction-amount"
      }
      returnFocusId={returnFocusId}
      fallbackFocusId="main-content"
      footer={
        setup ? undefined : (
          <button
            id="retry-transaction-save"
            type="submit"
            form="entry-form"
            className="ui-btn ui-btn-primary"
            disabled={busy || blocked || categoryUncertain || !writable}
          >
            {saving ? "Saving…" : uncertain ? "Retry save" : "Save transaction"}
          </button>
        )
      }
    >
      <TypePill
        value={kind}
        withTransfer
        disabled={frozen}
        onChange={(type) => {
          onTypeChange?.(type);
          if (type !== "transfer") changeKind(form, type);
        }}
      />
      {!writable && (
        <p role="status">You have read-only access to this ledger.</p>
      )}
      {blocked && (
        <p role="alert">
          Confirm the earlier transaction action before adding another entry.
        </p>
      )}
      {setup ? (
        <div className="entry-setup">
          <p>Create an active account before recording entries.</p>
          <Link
            to="/accounts"
            className="ui-btn ui-btn-secondary"
            onClick={onDismiss}
          >
            Set up accounts
          </Link>
        </div>
      ) : (
        <form
          id="entry-form"
          noValidate
          className="entry-form"
          onSubmit={(event) => {
            if (attempt.current) {
              event.preventDefault();
              void executeSave();
            } else void handleSubmit((values) => executeSave(values))(event);
          }}
        >
          <fieldset disabled={frozen} className="entry-fields">
            <EntryFields
              form={form}
              ledgerId={ledgerId}
              categories={categories}
              accounts={activeAccounts}
              idPrefix="transaction"
              frozen={frozen}
              accountError="Choose an active account."
              afterCategory={
                <NewCategory
                  open={newCategory}
                  onToggle={() => setNewCategory((value) => !value)}
                  name={categoryName}
                  onName={setCategoryName}
                  onAdd={() => void createCategory()}
                />
              }
            />
          </fieldset>
          <SaveErrors
            categoryError={categoryError}
            categoryUncertain={categoryUncertain}
            busy={busy}
            blocked={blocked}
            writable={writable}
            onRetryCategory={() => void createCategory()}
            error={error}
            uncertain={uncertain}
            onRefresh={async () => {
              setRefreshing(true);
              try {
                await onRefresh();
              } finally {
                setRefreshing(false);
              }
            }}
          />
        </form>
      )}
    </Overlay>
  );
}

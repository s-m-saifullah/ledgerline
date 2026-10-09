import type { Category, CategoryMergePreview } from "@ledgerline/shared";
import { Button } from "@ledgerline/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { EditorDialog } from "../../components/editor-dialog";
import { Toast } from "../../components/toast";
import { ApiError } from "../../lib/api";
import {
  getCategories,
  getCategoryMergePreview,
  prepareCategoryMerge,
} from "./api";
import { CategoryPicker } from "./picker";

type Workspace = {
  blocked: boolean;
  begin: (source: Category, triggerId: string) => void;
};
const Context = createContext<Workspace | null>(null);
export const useCategoryMergeWorkspace = () => useContext(Context);

/** Mounted in the actor/ledger-keyed shell: uncertain requests survive route changes. */
export function CategoryMergeWorkspace({
  ledgerId,
  writable,
  blocked,
  onLock,
  children,
}: {
  ledgerId: string | undefined;
  writable: boolean;
  blocked: boolean;
  onLock: (value: boolean) => void;
  children: ReactNode;
}) {
  const client = useQueryClient();
  const [source, setSource] = useState<Category | null>(null),
    [open, setOpen] = useState(false),
    [destinationId, setDestinationId] = useState<string | null>(null),
    [preview, setPreview] = useState<CategoryMergePreview | null>(null),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [error, setError] = useState(""),
    [reloadRequired, setReloadRequired] = useState(false),
    [revision, setRevision] = useState(0),
    [triggerId, setTriggerId] = useState("main-content"),
    [notice, setNotice] = useState("");
  const attempt = useRef<ReturnType<typeof prepareCategoryMerge> | null>(null),
    inFlight = useRef(false);
  const choices = useQuery({
    queryKey: ["categories", ledgerId],
    queryFn: ({ signal }) => getCategories(ledgerId as string, signal),
    enabled: !!ledgerId && !!source,
    refetchOnMount: "always",
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision is the explicit user-requested preview reload trigger.
  useEffect(() => {
    if (
      !ledgerId ||
      !source ||
      !destinationId ||
      !open ||
      uncertain ||
      attempt.current ||
      reloadRequired
    )
      return;
    const controller = new AbortController();
    setPreview(null);
    setLoading(true);
    setError("");
    void getCategoryMergePreview(
      ledgerId,
      source.id,
      destinationId,
      controller.signal,
    )
      .then((value) => {
        if (!controller.signal.aborted) setPreview(value);
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted)
          setError(
            failure instanceof ApiError
              ? failure.message
              : "Couldn't load the merge preview. Try again.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [
    ledgerId,
    source,
    destinationId,
    open,
    uncertain,
    reloadRequired,
    revision,
  ]);
  const reset = () => {
    setSource(null);
    setOpen(false);
    setDestinationId(null);
    setPreview(null);
    setLoading(false);
    setUncertain(false);
    setReloadRequired(false);
    setError("");
    attempt.current = null;
    onLock(false);
  };
  const dismiss = () => {
    if (busy) return;
    if (uncertain) setOpen(false);
    else reset();
  };
  const reload = () => {
    if (busy || uncertain || blocked) return;
    attempt.current = null;
    setPreview(null);
    setReloadRequired(false);
    setRevision((value) => value + 1);
    void choices.refetch();
  };
  const save = async () => {
    if (
      !ledgerId ||
      !source ||
      !writable ||
      blocked ||
      inFlight.current ||
      reloadRequired
    )
      return;
    if (!attempt.current) {
      if (
        !preview?.canMerge ||
        !preview.previewToken ||
        loading ||
        preview.destination.id !== destinationId
      )
        return;
      attempt.current = prepareCategoryMerge(ledgerId, source.id, {
        destinationCategoryId: preview.destination.id,
        expectedSourceVersion: preview.expectedSourceVersion,
        expectedDestinationVersion: preview.expectedDestinationVersion,
        previewToken: preview.previewToken,
      });
    }
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await attempt.current();
      for (const key of [
        "categories",
        "transactions",
        "contacts",
        "receivables",
        "peopleHistory",
        "accounts",
        "home",
      ])
        void client.invalidateQueries({ queryKey: [key, ledgerId] });
      reset();
      setNotice("Categories merged. The source is archived.");
    } catch (failure) {
      const unknown = !(failure instanceof ApiError) || failure.status >= 500;
      setUncertain(unknown);
      if (!unknown) {
        attempt.current = null;
        setReloadRequired(true);
        setPreview(null);
      }
      setError(
        unknown
          ? "We couldn't confirm the merge. Retry the same action."
          : failure.message,
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const frozen = busy || uncertain || blocked || !writable;
  const summary = preview?.summary;
  return (
    <Context
      value={{
        blocked: blocked || !!source,
        begin: (row, id) => {
          if (!writable || blocked || source || !ledgerId) return;
          setSource(row);
          setOpen(true);
          setTriggerId(id);
          setError("");
          setNotice("");
          onLock(true);
        },
      }}
    >
      {children}
      {source && !open && uncertain && (
        <div className="transaction-toast">
          <p role="status">A category merge needs confirmation.</p>
          <button
            type="button"
            className="secondary-button"
            onClick={() => setOpen(true)}
          >
            Resume category merge
          </button>
        </div>
      )}
      {source && (
        <EditorDialog
          open={open}
          title="Merge categories"
          description={`Merge ${source.name} into another category. Review the affected records before confirming.`}
          busy={busy}
          contentClassName="category-merge-dialog"
          onDismiss={dismiss}
          returnFocusId={triggerId}
          fallbackFocusId="main-content"
          initialFocusId={uncertain ? "retry-category-merge" : undefined}
          closeLabel="Close category merge"
        >
          <fieldset disabled={frozen}>
            {choices.isPending && (
              <p role="status">Loading destination categories…</p>
            )}
            {choices.isError && (
              <p role="alert">
                Couldn't load destination categories. Reload the preview to try
                again.
              </p>
            )}
            {choices.data && (
              <CategoryPicker
                categories={choices.data}
                kind={source.kind}
                value={destinationId}
                label="Destination category"
                rootsOnly={!source.parentId}
                childrenOnly={!!source.parentId}
                excludeId={source.id}
                disabled={frozen}
                onChange={(id) => {
                  setDestinationId(id);
                  setPreview(null);
                  setLoading(!!id);
                  setError("");
                  setReloadRequired(false);
                }}
              />
            )}
          </fieldset>
          {loading && !uncertain && <p role="status">Loading merge preview…</p>}
          {preview && (
            <section aria-label="Merge preview">
              <p>
                <strong>{preview.source.name}</strong> →{" "}
                <strong>{preview.destination.name}</strong>
              </p>
              {summary && (
                <ul>
                  <li>
                    {summary.ordinaryCleared} cleared and{" "}
                    {summary.ordinaryPending} pending ordinary transactions
                  </li>
                  <li>
                    {summary.splitLines} split lines across{" "}
                    {summary.splitParents} entries
                  </li>
                  <li>
                    {summary.linkedPayments} linked payments across{" "}
                    {summary.receivables} services
                  </li>
                  <li>{summary.children.length} child categories to move</li>
                </ul>
              )}
              {!!summary?.children.length && (
                <ul aria-label="Children to move">
                  {summary.children.map((row) => (
                    <li key={row.id}>
                      {row.name}
                      {row.archivedAt ? " (archived)" : ""}
                    </li>
                  ))}
                </ul>
              )}
              {summary &&
                summary.excludedTransactions +
                  summary.excludedSplitLines +
                  summary.excludedChildren >
                  0 && (
                  <p className="form-help">
                    Deleted history stays unchanged:{" "}
                    {summary.excludedTransactions} transactions (including{" "}
                    {summary.excludedPayments} linked payments),{" "}
                    {summary.excludedSplitLines} split lines and{" "}
                    {summary.excludedChildren} child categories.
                  </p>
                )}
              {preview.blockers.map((row) => (
                <p
                  role="alert"
                  className="field-error"
                  key={`${row.code}:${row.message}`}
                >
                  {row.message}
                </p>
              ))}
            </section>
          )}
          <p className="form-help">
            Amounts, dates and account balances stay the same. The source is
            archived. This merge has no bulk Undo; unarchiving the source won't
            move records or children back.
          </p>
          {error && (
            <p role="alert" className="field-error">
              {error}
            </p>
          )}
          {!uncertain && (
            <button
              type="button"
              className="quiet-button"
              disabled={busy || blocked || !writable}
              onClick={reload}
            >
              Reload preview
            </button>
          )}
          <div className="account-dialog-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={dismiss}
            >
              {uncertain ? "Close for now" : "Cancel"}
            </button>
            {uncertain ? (
              <Button
                id="retry-category-merge"
                type="button"
                disabled={busy || blocked || !writable}
                onClick={() => void save()}
              >
                {busy ? "Confirming…" : "Retry same merge"}
              </Button>
            ) : (
              <Button
                type="button"
                disabled={
                  frozen ||
                  loading ||
                  reloadRequired ||
                  choices.isError ||
                  !preview?.canMerge
                }
                onClick={() => void save()}
              >
                Confirm merge
              </Button>
            )}
          </div>
        </EditorDialog>
      )}
      {notice && (
        <Toast
          label="Category notification"
          durationMs={3000}
          onExpire={() => setNotice("")}
        >
          <p role="status">{notice}</p>
          <button
            type="button"
            className="secondary-button"
            onClick={() => setNotice("")}
          >
            Dismiss category notification
          </button>
        </Toast>
      )}
    </Context>
  );
}

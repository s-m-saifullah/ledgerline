import {
  type Category,
  categoryStarterGroups,
  defaultCategoryStarterSet,
  type StarterGroupKey,
} from "@ledgerline/shared";
import { Button } from "@ledgerline/ui";
import { useRef, useState } from "react";
import { EditorDialog } from "../../components/editor-dialog";
import { ApiError } from "../../lib/api";
import {
  getCategories,
  prepareCategoryArchive,
  prepareCategoryDelete,
  prepareCategoryStarterSet,
  prepareCategoryUnarchive,
} from "./api";
import { StarterGroups } from "./starter-preview";
export type CategoryAction =
  | { kind: "archive" | "unarchive" | "delete"; category: Category }
  | { kind: "starter" };
export function CategoryActionDialog({
  ledgerId,
  action,
  open,
  onDismiss,
  onUnconfirmed,
  onSaved,
  onReloaded,
}: {
  ledgerId: string;
  action: CategoryAction;
  open: boolean;
  onDismiss: () => void;
  onUnconfirmed: (value: boolean) => void;
  onSaved: () => void;
  onReloaded: (items: Category[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<StarterGroupKey>>(
    () => new Set(defaultCategoryStarterSet.map((group) => group.key)),
  );
  const attempt = useRef<(() => Promise<unknown>) | null>(null);
  const inFlight = useRef(false);
  const label =
    action.kind === "delete"
      ? "Delete category"
      : action.kind === "archive"
        ? "Archive category"
        : action.kind === "unarchive"
          ? "Unarchive category"
          : "Create categories";
  const save = async () => {
    if (inFlight.current || conflict) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    attempt.current ??=
      action.kind === "delete"
        ? prepareCategoryDelete(ledgerId, action.category)
        : action.kind === "archive"
          ? prepareCategoryArchive(ledgerId, action.category)
          : action.kind === "unarchive"
            ? prepareCategoryUnarchive(ledgerId, action.category)
            : prepareCategoryStarterSet(
                ledgerId,
                categoryStarterGroups
                  .map((group) => group.key)
                  .filter((key) => selected.has(key)),
              );
    try {
      await attempt.current();
      onUnconfirmed(false);
      onSaved();
    } catch (failure) {
      if (!(failure instanceof ApiError) || failure.status >= 500) {
        setUncertain(true);
        onUnconfirmed(true);
        setError(
          "We couldn't confirm this action. Retry to confirm the same action.",
        );
      } else {
        attempt.current = null;
        setUncertain(false);
        onUnconfirmed(false);
        setError(failure.message);
        if (failure.status === 409) setConflict(true);
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const reload = async () => {
    setBusy(true);
    try {
      onReloaded(await getCategories(ledgerId));
    } catch {
      setError("Couldn't reload your categories. Please try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <EditorDialog
      open={open}
      title={
        action.kind === "delete"
          ? "Delete category?"
          : action.kind === "archive"
            ? "Archive category?"
            : action.kind === "unarchive"
              ? "Unarchive category?"
              : "Starter categories"
      }
      description={
        action.kind === "delete"
          ? `Delete ${action.category.name}? Delete connected transactions and delete or move child categories first. Deleted transactions cannot be restored while this category is deleted. This category has no Undo; archive it to keep it instead.`
          : action.kind === "archive"
            ? `Archive ${action.category.name}. Its label stays available in your history and leaves new-entry pickers.`
            : action.kind === "unarchive"
              ? `Make ${action.category.name} available for new entries again. Its label and history stay the same. It moves to the end of its sibling group; children remain archived.`
              : "Untick any group you don't want, or tick an add-on that fits you, then create them. Only categories are added, no accounts. You can rename and organize them later."
      }
      busy={busy}
      onDismiss={onDismiss}
      returnFocusId={
        action.kind === "starter"
          ? "categories-title"
          : `edit-category-${action.category.id}`
      }
      closeLabel="Close category dialog"
      fallbackFocusId="categories-title"
    >
      {action.kind === "starter" && (
        <StarterGroups
          selected={selected}
          disabled={busy || uncertain}
          onToggle={(key) =>
            setSelected((current) => {
              const next = new Set(current);
              if (!next.delete(key)) next.add(key);
              return next;
            })
          }
        />
      )}
      {error && (
        <p className="field-error account-error" role="alert">
          {error}
        </p>
      )}
      <div className="account-dialog-actions">
        <button
          type="button"
          className="secondary-button"
          disabled={busy}
          onClick={onDismiss}
        >
          {uncertain ? "Close for now" : "Cancel"}
        </button>
        {conflict ? (
          <Button disabled={busy} onClick={() => void reload()}>
            Reload categories
          </Button>
        ) : (
          <Button
            className={action.kind === "delete" ? "danger-action" : undefined}
            disabled={
              busy || (action.kind === "starter" && selected.size === 0)
            }
            onClick={() => void save()}
          >
            {busy ? "Saving…" : uncertain ? "Retry action" : label}
          </Button>
        )}
      </div>
    </EditorDialog>
  );
}

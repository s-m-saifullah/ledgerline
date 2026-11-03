import {
  type Category,
  categoryStarterGroups,
  defaultCategoryStarterSet,
  type StarterGroupKey,
} from "@ledgerline/shared";
import { useRef, useState } from "react";
import { Overlay } from "../../components/overlay";
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
      ? "Delete"
      : action.kind === "archive"
        ? "Archive"
        : action.kind === "unarchive"
          ? "Unarchive"
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
  const starter = action.kind === "starter";
  const name = action.kind === "starter" ? "" : action.category.name;
  return (
    <Overlay
      open={open}
      kind={starter ? "sheet" : "question"}
      title={
        action.kind === "delete"
          ? `Delete ${name}?`
          : action.kind === "archive"
            ? `Archive ${name}?`
            : action.kind === "unarchive"
              ? `Unarchive ${name}?`
              : "Starter categories"
      }
      description={
        starter
          ? "Untick any group you don't want, or tick an add-on that fits you, then create them. Only categories are added, no accounts. You can rename and organize them later."
          : undefined
      }
      busy={busy}
      onDismiss={onDismiss}
      cancelLabel={uncertain ? "Close for now" : "Cancel"}
      returnFocusId={
        action.kind === "starter"
          ? "categories-title"
          : `edit-category-${action.category.id}`
      }
      fallbackFocusId="categories-title"
      footer={
        conflict ? (
          <button
            type="button"
            className="ui-btn ui-btn-primary"
            disabled={busy}
            onClick={() => void reload()}
          >
            Reload categories
          </button>
        ) : (
          <button
            type="button"
            className={
              action.kind === "delete"
                ? "ui-btn ui-btn-danger-filled"
                : "ui-btn ui-btn-primary"
            }
            disabled={busy || (starter && selected.size === 0)}
            onClick={() => void save()}
          >
            {busy ? "Saving…" : uncertain ? "Retry action" : label}
          </button>
        )
      }
    >
      {action.kind === "archive" && (
        <p>Its label stays in your history and leaves new-entry pickers.</p>
      )}
      {action.kind === "unarchive" && (
        <p>
          It is available for new entries again. It moves to the end of its
          group; subcategories stay archived.
        </p>
      )}
      {action.kind === "delete" && (
        <p>
          Delete its transactions and move or delete its subcategories first. A
          deleted category has no Undo; archive it to keep it instead.
        </p>
      )}
      {starter && (
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
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </Overlay>
  );
}

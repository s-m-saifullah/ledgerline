import { Plus } from "lucide-react";

/** "New category" under the category field: a name box that adds a top-level category of the current kind. */
export function NewCategory({
  open,
  onToggle,
  name,
  onName,
  onAdd,
}: {
  open: boolean;
  onToggle: () => void;
  name: string;
  onName: (name: string) => void;
  onAdd: () => void;
}) {
  return (
    <>
      <button
        type="button"
        className="ui-btn ui-btn-text entry-new-category"
        onClick={onToggle}
      >
        <Plus size={16} aria-hidden="true" />
        New category
      </button>
      {open && (
        <div className="entry-inline-category">
          <label htmlFor="quick-category-name">New category name</label>
          <input
            id="quick-category-name"
            value={name}
            onChange={(event) => onName(event.target.value)}
            maxLength={100}
            autoComplete="off"
          />
          <button
            type="button"
            className="ui-btn ui-btn-secondary"
            onClick={onAdd}
          >
            Add category
          </button>
        </div>
      )}
    </>
  );
}

/** Category and save errors, the category retry and the refresh button. */
export function SaveErrors({
  categoryError,
  categoryUncertain,
  busy,
  blocked,
  writable,
  onRetryCategory,
  error,
  uncertain,
  onRefresh,
}: {
  categoryError: string;
  categoryUncertain: boolean;
  busy: boolean;
  blocked: boolean;
  writable: boolean;
  onRetryCategory: () => void;
  error: string;
  uncertain: boolean;
  onRefresh: () => void;
}) {
  return (
    <>
      {categoryError && (
        <p role="alert" className="field-error">
          {categoryError}
        </p>
      )}
      {categoryUncertain && (
        <button
          id="retry-transaction-category"
          type="button"
          className="ui-btn ui-btn-secondary"
          disabled={busy || blocked || !writable}
          onClick={onRetryCategory}
        >
          Retry category
        </button>
      )}
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
      {error && !uncertain && (
        <button
          type="button"
          className="ui-btn ui-btn-text"
          disabled={busy}
          onClick={onRefresh}
        >
          Refresh choices
        </button>
      )}
    </>
  );
}

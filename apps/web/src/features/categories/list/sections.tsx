import { Plus, Shapes } from "lucide-react";
import { NativeSelect } from "../../../components/native-select";
import { StarterButton } from "../starter-preview";
import { renderCategoryRow } from "./category-row";
import type { CategoriesViewContext } from "./context";

/** The notice, the saving and error states of reordering, and the "action needs confirmation" card. */
export function renderNotices(form: CategoriesViewContext) {
  const { notice, reorder, dialog, setDialog, writable } = form;
  return (
    <>
      {notice && (
        <p className="account-notice" role="status">
          {notice}
        </p>
      )}
      {reorder.state === "saving" && (
        <p className="account-notice" role="status">
          Saving category order…
        </p>
      )}
      {reorder.notice && !notice && (
        <p className="account-notice" role="status">
          {reorder.notice}
        </p>
      )}
      {reorder.error && (
        <section className="settings-card">
          <p className="field-error" role="alert">
            {reorder.error}
          </p>
          {reorder.state === "uncertain" && (
            <button
              type="button"
              className="secondary-button"
              onClick={() => void reorder.save()}
            >
              Retry order
            </button>
          )}
          {reorder.state === "conflict" && (
            <button
              type="button"
              className="secondary-button"
              onClick={() => void reorder.reload()}
            >
              Reload categories
            </button>
          )}
        </section>
      )}
      {dialog?.unconfirmed && !dialog.open && (
        <section className="settings-card">
          <h2>An action needs confirmation</h2>
          <p>
            The connection was interrupted. Resume the action to confirm it
            before making another change.
          </p>
          <button
            type="button"
            className="secondary-button"
            onClick={() =>
              setDialog((current) =>
                current ? { ...current, open: true } : null,
              )
            }
          >
            Resume action
          </button>
        </section>
      )}
      {!writable && (
        <p className="muted account-notice">
          You can view categories in this ledger. Editing is available to owners
          and editors.
        </p>
      )}
    </>
  );
}
/** The kind buttons, the status filter and the search box. */
export function renderToolbar(form: CategoriesViewContext) {
  const { kind, setKind, status, setStatus, search, setSearch } = form;
  return (
    <div className="category-toolbar">
      <fieldset className="category-kind-buttons" aria-label="Category kind">
        {(["expense", "income"] as const).map((value) => (
          <button
            key={value}
            type="button"
            className="secondary-button"
            aria-pressed={kind === value}
            onClick={() => setKind(value)}
          >
            {value === "expense" ? "Expenses" : "Income"}
          </button>
        ))}
      </fieldset>
      <label className="category-status" htmlFor="category-status">
        View categories
        <NativeSelect
          id="category-status"
          value={status}
          onChange={(event) => setStatus(event.target.value as typeof status)}
        >
          <option value="all">All categories</option>
          <option value="active">Active categories</option>
          <option value="archived">Archived categories</option>
        </NativeSelect>
      </label>
      <label className="category-search">
        Search categories
        <input
          type="search"
          value={search}
          autoComplete="off"
          placeholder="Search by name"
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>
    </div>
  );
}
/** Loading, error and empty states. */
export function renderStates(form: CategoriesViewContext) {
  const { query, groups, items, writable, locked, start } = form;
  return (
    <>
      {query.isPending && (
        <p className="settings-card" role="status">
          Loading categories…
        </p>
      )}
      {query.isError && (
        <section className="settings-card" role="alert">
          <p>Couldn't load your categories.</p>
          <button
            type="button"
            className="secondary-button"
            onClick={() => void query.refetch()}
          >
            Try again
          </button>
        </section>
      )}
      {!query.isPending && !query.isError && groups.length === 0 && (
        <section className="welcome-card account-empty category-empty">
          <div className="small-mark">
            <Shapes size={28} />
          </div>
          <h2>
            {items.length === 0
              ? "Make room for your categories."
              : "No matching categories."}
          </h2>
          <p>
            {items.length === 0
              ? "Start with your own categories, or add a ready-made starter set. You see the full list first, and nothing is added until you confirm."
              : "Try another kind, view, or search."}
          </p>
          {writable && items.length === 0 && (
            <div className="category-empty-actions">
              <StarterButton
                disabled={locked}
                onChoose={() =>
                  start({ kind: "action", action: { kind: "starter" } })
                }
              />
              <button
                type="button"
                className="secondary-button"
                disabled={locked}
                onClick={() => start({ kind: "edit" })}
              >
                <Plus size={18} />
                Add your first category
              </button>
            </div>
          )}
        </section>
      )}
    </>
  );
}
/** The category groups. */
export function renderGroups(form: CategoriesViewContext) {
  const { query, groups } = form;
  return (
    <>
      {!query.isError && (
        <div className="category-groups">
          {groups.map(({ root, children, showRoot }) => (
            <section key={root.id} className="category-group">
              {showRoot ? (
                renderCategoryRow(form, root)
              ) : (
                <h2 className="category-parent-context">
                  {root.name}
                  {root.archivedAt ? " · Archived" : ""}
                </h2>
              )}
              {children.map((category) =>
                renderCategoryRow(form, category, true),
              )}
            </section>
          ))}
        </div>
      )}
    </>
  );
}

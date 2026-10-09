import type { Category, ledgerSchema } from "@ledgerline/shared";
import { Button } from "@ledgerline/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  GitMerge,
  Pencil,
  Plus,
  Shapes,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import type { z } from "zod";
import { useIsPhone } from "../../components/action-bar";
import { ActionMenu } from "../../components/action-menu";
import { NativeSelect } from "../../components/native-select";
import { getLedgers } from "../../lib/api";
import { type CategoryAction, CategoryActionDialog } from "./action-dialog";
import { getCategories } from "./api";
import { CategoryMark } from "./appearance";
import { CategoryEditor } from "./editor";
import { useCategoryMergeWorkspace } from "./merge-workspace";
import { useCategoryReorder } from "./reorder";
import { StarterButton } from "./starter-preview";
import { byOrder, moveCategory } from "./tree";

type DialogState = { intentId: string; open: boolean; unconfirmed: boolean } & (
  | { kind: "edit"; category?: Category }
  | { kind: "action"; action: CategoryAction }
);
export function CategoriesPage() {
  const ledgers = useQuery({ queryKey: ["ledgers"], queryFn: getLedgers });
  const ledger = ledgers.data?.items[0];
  if (ledgers.isPending) return <p role="status">Opening your categories…</p>;
  if (ledgers.isError || !ledger)
    return (
      <section className="settings-card">
        <h1>Categories</h1>
        <p role="alert">
          {ledgers.isError
            ? "Couldn't load your ledger."
            : "No ledger is available for this session."}
        </p>
        <button
          type="button"
          className="secondary-button"
          onClick={() => void ledgers.refetch()}
        >
          Try again
        </button>
      </section>
    );
  return <LedgerCategories key={ledger.id} ledger={ledger} />;
}
function LedgerCategories({
  ledger,
}: {
  ledger: z.infer<typeof ledgerSchema>;
}) {
  const client = useQueryClient();
  const phone = useIsPhone();
  const [kind, setKind] = useState<Category["kind"]>("expense");
  const [status, setStatus] = useState<"all" | "active" | "archived">("all");
  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [notice, setNotice] = useState("");
  const writable = ledger.role !== "viewer";
  const query = useQuery({
    queryKey: ["categories", ledger.id],
    queryFn: ({ signal }) => getCategories(ledger.id, signal),
    refetchOnMount: "always",
  });
  const items = query.data ?? [];
  const reorder = useCategoryReorder(ledger.id);
  const merge = useCategoryMergeWorkspace();
  const locked = !!dialog?.unconfirmed || reorder.locked || !!merge?.blocked;
  const start = (
    intent:
      | { kind: "edit"; category?: Category }
      | { kind: "action"; action: CategoryAction },
  ) => {
    if (reorder.locked || merge?.blocked) return;
    if (dialog?.unconfirmed) {
      setDialog((current) => (current ? { ...current, open: true } : null));
      return;
    }
    setNotice("");
    setDialog({
      ...intent,
      intentId: crypto.randomUUID(),
      open: true,
      unconfirmed: false,
    });
  };
  const dismiss = () =>
    setDialog((current) =>
      current?.unconfirmed ? { ...current, open: false } : null,
    );
  const unconfirmed = (value: boolean) =>
    setDialog((current) =>
      current ? { ...current, unconfirmed: value } : null,
    );
  const saved = (category?: Category) => {
    if (category)
      client.setQueryData<Category[]>(["categories", ledger.id], (rows) => [
        ...(rows ?? []).filter((row) => row.id !== category.id),
        category,
      ]);
    setNotice(
      dialog?.kind === "action"
        ? dialog.action.kind === "archive"
          ? "Category archived. Its label and history are kept."
          : dialog.action.kind === "unarchive"
            ? "Category unarchived. It's available for new entries again."
            : dialog.action.kind === "delete"
              ? "Category deleted."
              : "Starter categories created."
        : dialog?.category
          ? "Category updated."
          : "Category added.",
    );
    setDialog(null);
    void client.invalidateQueries({ queryKey: ["categories", ledger.id] });
    void client.invalidateQueries({ queryKey: ["home", ledger.id] });
  };
  const matches = (row: Category, root: Category) =>
    (status === "all" ||
      (status === "archived" ? !!row.archivedAt : !row.archivedAt)) &&
    `${root.name} ${row.name}`
      .toLocaleLowerCase()
      .includes(search.trim().toLocaleLowerCase());
  const groups = items
    .filter((row) => row.kind === kind && !row.parentId)
    .sort(byOrder)
    .map((root) => ({
      root,
      children: items
        .filter((row) => row.parentId === root.id)
        .sort(byOrder)
        .filter((row) => matches(row, root)),
      showRoot: matches(root, root),
    }))
    .filter((group) => group.showRoot || group.children.length > 0);
  const row = (category: Category, child = false) => {
    const up = moveCategory(items, category, -1);
    const down = moveCategory(items, category, 1);
    const activeChildren = items.some(
      (item) => item.parentId === category.id && !item.archivedAt,
    );
    const inactiveParent =
      !!category.parentId &&
      !items.some((item) => item.id === category.parentId && !item.archivedAt);
    return (
      <article
        key={category.id}
        className={`category-row${child ? " category-child" : ""}`}
        aria-labelledby={`category-title-${category.id}`}
      >
        <div className="category-row-heading">
          <CategoryMark icon={category.icon} color={category.color} />
          <div>
            <h3 id={`category-title-${category.id}`} title={category.name}>
              {category.name}
            </h3>
            {category.archivedAt && (
              <span className="account-badge">Archived</span>
            )}
          </div>
        </div>
        {writable && phone && (
          <ActionMenu
            id={`edit-category-${category.id}`}
            label={`Actions for ${category.name}`}
            actions={[
              ...(category.archivedAt
                ? []
                : [
                    {
                      key: "up",
                      label: "Move up",
                      icon: ArrowUp,
                      disabled: locked || !up || query.isFetching,
                      onSelect: () => {
                        if (!up) return;
                        setNotice("");
                        void reorder.save(up);
                      },
                    },
                    {
                      key: "down",
                      label: "Move down",
                      icon: ArrowDown,
                      disabled: locked || !down || query.isFetching,
                      onSelect: () => {
                        if (!down) return;
                        setNotice("");
                        void reorder.save(down);
                      },
                    },
                  ]),
              ...(merge
                ? [
                    {
                      key: "merge",
                      label: "Merge into another category",
                      icon: GitMerge,
                      disabled: locked || query.isFetching || !!dialog,
                      onSelect: () =>
                        merge.begin(category, `edit-category-${category.id}`),
                    },
                  ]
                : []),
              {
                key: "edit",
                label: "Edit category",
                icon: Pencil,
                disabled: locked || query.isFetching,
                onSelect: () => start({ kind: "edit", category }),
              },
              {
                key: "archive",
                label: category.archivedAt
                  ? "Unarchive category"
                  : "Archive category",
                icon: category.archivedAt ? ArchiveRestore : Archive,
                disabled: category.archivedAt ? inactiveParent : activeChildren,
                onSelect: () =>
                  start({
                    kind: "action",
                    action: {
                      kind: category.archivedAt ? "unarchive" : "archive",
                      category,
                    },
                  }),
              },
              {
                key: "delete",
                label: "Delete category",
                icon: Trash2,
                danger: true,
                disabled: locked || query.isFetching,
                onSelect: () =>
                  start({
                    kind: "action",
                    action: { kind: "delete", category },
                  }),
              },
            ]}
          />
        )}
        {writable && !phone && (
          <div className="category-controls">
            {!category.archivedAt && (
              <>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Move ${category.name} up`}
                  title="Move up"
                  disabled={locked || !up || query.isFetching}
                  onClick={() => {
                    if (!up) return;
                    setNotice("");
                    void reorder.save(up);
                  }}
                >
                  <ArrowUp size={18} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Move ${category.name} down`}
                  title="Move down"
                  disabled={locked || !down || query.isFetching}
                  onClick={() => {
                    if (!down) return;
                    setNotice("");
                    void reorder.save(down);
                  }}
                >
                  <ArrowDown size={18} aria-hidden="true" />
                </button>
              </>
            )}
            {merge && (
              <button
                type="button"
                className="icon-button"
                title="Merge into another category"
                id={`merge-category-${category.id}`}
                aria-label={`Merge ${category.name}`}
                disabled={locked || query.isFetching || !!dialog}
                onClick={() =>
                  merge.begin(category, `merge-category-${category.id}`)
                }
              >
                <GitMerge size={18} aria-hidden="true" />
              </button>
            )}
            <button
              type="button"
              className="icon-button"
              title="Edit category"
              id={`edit-category-${category.id}`}
              aria-label={`Edit ${category.name}`}
              disabled={locked || query.isFetching}
              onClick={() => start({ kind: "edit", category })}
            >
              <Pencil size={18} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label={`${category.archivedAt ? "Unarchive" : "Archive"} ${category.name}`}
              title={
                category.archivedAt
                  ? inactiveParent
                    ? "Unarchive the parent first"
                    : "Unarchive category"
                  : activeChildren
                    ? "Archive active children first"
                    : "Archive category"
              }
              disabled={
                locked ||
                query.isFetching ||
                (category.archivedAt ? inactiveParent : activeChildren)
              }
              onClick={() =>
                start({
                  kind: "action",
                  action: {
                    kind: category.archivedAt ? "unarchive" : "archive",
                    category,
                  },
                })
              }
            >
              {category.archivedAt ? (
                <ArchiveRestore size={18} aria-hidden="true" />
              ) : (
                <Archive size={18} aria-hidden="true" />
              )}
            </button>
            <button
              type="button"
              className="icon-button danger-action"
              title="Delete category"
              aria-label={`Delete ${category.name}`}
              disabled={locked || query.isFetching}
              onClick={() =>
                start({ kind: "action", action: { kind: "delete", category } })
              }
            >
              <Trash2 size={18} aria-hidden="true" />
            </button>
          </div>
        )}
        {writable && category.archivedAt && inactiveParent && (
          <p className="form-help category-archive-help">
            Unarchive the parent before this category.
          </p>
        )}
        {writable && activeChildren && (
          <p className="form-help category-archive-help">
            Archive active children before this parent.
          </p>
        )}
      </article>
    );
  };
  return (
    <>
      <Link to="/more" className="accounts-back">
        ← More
      </Link>
      <div className="page-heading accounts-heading">
        <div>
          <p className="eyebrow">YOUR PERSONAL LEDGER</p>
          <h1 id="categories-title" tabIndex={-1}>
            Categories
          </h1>
          <p className="muted">
            Organize money coming in and going out, your way.
          </p>
        </div>
        {writable && items.length > 0 && (
          <Button
            disabled={locked || query.isFetching || query.isError}
            onClick={() => start({ kind: "edit" })}
          >
            <Plus size={18} />
            Add category
          </Button>
        )}
      </div>
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
      {!query.isError && (
        <div className="category-groups">
          {groups.map(({ root, children, showRoot }) => (
            <section key={root.id} className="category-group">
              {showRoot ? (
                row(root)
              ) : (
                <h2 className="category-parent-context">
                  {root.name}
                  {root.archivedAt ? " · Archived" : ""}
                </h2>
              )}
              {children.map((category) => row(category, true))}
            </section>
          ))}
        </div>
      )}
      {dialog?.kind === "edit" && (
        <CategoryEditor
          key={dialog.intentId}
          ledgerId={ledger.id}
          category={dialog.category}
          categories={items}
          kind={kind}
          open={dialog.open}
          onDismiss={dismiss}
          onUnconfirmed={unconfirmed}
          onSaved={saved}
        />
      )}
      {dialog?.kind === "action" && (
        <CategoryActionDialog
          key={dialog.intentId}
          ledgerId={ledger.id}
          action={dialog.action}
          open={dialog.open}
          onDismiss={dismiss}
          onUnconfirmed={unconfirmed}
          onSaved={saved}
          onReloaded={(latest) => {
            client.setQueryData(["categories", ledger.id], latest);
            setDialog(null);
            setNotice(
              "Categories reloaded. Choose the action again using the latest details.",
            );
          }}
        />
      )}
    </>
  );
}

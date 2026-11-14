import type { Category, ledgerSchema } from "@ledgerline/shared";
import {
  EmptyState,
  FilterChip,
  SectionLabel,
  SegmentedControl,
} from "@ledgerline/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import type { z } from "zod";
import { LoadError } from "../../components/load-error";
import { Loading } from "../../components/loading";
import { ReadOnlyNote } from "../../components/read-only-note";
import { SearchField } from "../../components/search-field";
import { Toast, toastDuration } from "../../components/toast";
import { getLedgers } from "../../lib/api";
import { randomUuid } from "../../lib/random-uuid";
import { usePageAdd } from "../shell/page-add";
import { CategoryActionDialog } from "./action-dialog";
import { getCategories } from "./api";
import { CategoryActions } from "./category-actions";
import { CategoryCard } from "./category-list";
import type { DialogIntent, DialogState } from "./dialog-state";
import { CategoryEditor } from "./editor";
import { useCategoryMergeWorkspace } from "./merge-workspace";
import {
  activeRootCount,
  allOpen,
  anyArchived,
  buildGroups,
  resolveStatus,
  type StatusFilter,
} from "./model";
import { useCategoryReorder } from "./reorder";
import { StarterButton } from "./starter-preview";
import "./categories.css";

export function CategoriesPage() {
  const ledgers = useQuery({ queryKey: ["ledgers"], queryFn: getLedgers });
  const ledger = ledgers.data?.items[0];
  if (ledgers.isPending) return <Loading what="categories" />;
  if (ledgers.isError || !ledger)
    return (
      <div className="cg-page">
        <div className="page-heading">
          <h1 id="categories-title" tabIndex={-1}>
            Categories
          </h1>
        </div>
        {ledgers.isError ? (
          <LoadError
            message="Couldn't load your ledger."
            onRetry={() => void ledgers.refetch()}
          />
        ) : (
          <p role="alert">No ledger is available for this session.</p>
        )}
      </div>
    );
  return <LedgerCategories key={ledger.id} ledger={ledger} />;
}

/**
 * Categories (ADR 0047, the prototype's `R.categories`): Expense and Income as one accordion card each, side by
 * side from 700 px and one at a time under it by a switch; one actions sheet per category.
 */
function LedgerCategories({
  ledger,
}: {
  ledger: z.infer<typeof ledgerSchema>;
}) {
  const client = useQueryClient();
  const [kind, setKind] = useState<Category["kind"]>("expense");
  const [chosen, setChosen] = useState<StatusFilter | null>(null);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [actions, setActions] = useState<Category | null>(null);
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
  // The chips mean nothing until something is archived, so All stands until then.
  const status = resolveStatus(chosen, items);
  const start = (intent: DialogIntent) => {
    if (reorder.locked || merge?.blocked) return;
    if (dialog?.unconfirmed) {
      setDialog((current) => (current ? { ...current, open: true } : null));
      return;
    }
    setNotice("");
    setDialog({
      ...intent,
      intentId: randomUuid(),
      open: true,
      unconfirmed: false,
    });
  };
  usePageAdd(
    writable && items.length > 0
      ? {
          label: "Add category",
          disabled: locked || query.isFetching || query.isError,
          onClick: () => start({ kind: "edit" }),
        }
      : null,
  );
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
        : dialog?.kind === "edit" && dialog.category
          ? "Category updated."
          : "Category added.",
    );
    setDialog(null);
    void client.invalidateQueries({ queryKey: ["categories", ledger.id] });
    void client.invalidateQueries({ queryKey: ["home", ledger.id] });
  };
  const kinds = ["expense", "income"] as const;
  const groupsOf = (value: Category["kind"]) =>
    buildGroups(items, value, status, search);
  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const visible = kinds.flatMap(groupsOf);
  const everyOpen = allOpen(visible, open);
  const shownNotice = notice || (reorder.notice ?? "");
  return (
    <div className="cg-page">
      <div className="page-heading cg-head-bar">
        <h1 id="categories-title" tabIndex={-1}>
          Categories
        </h1>
        {writable && items.length > 0 && (
          <button
            type="button"
            id="add-category"
            className="ui-btn ui-btn-primary cg-add"
            disabled={locked || query.isFetching || query.isError}
            onClick={() => start({ kind: "edit" })}
          >
            <Plus size={18} aria-hidden="true" />
            Add category
          </button>
        )}
      </div>
      {reorder.state === "saving" && (
        <p className="cg-note" role="status">
          Saving category order…
        </p>
      )}
      {reorder.error && (
        <section className="ui-card cg-alert">
          <p className="field-error" role="alert">
            {reorder.error}
          </p>
          {reorder.state === "uncertain" && (
            <button
              type="button"
              className="ui-btn ui-btn-secondary"
              onClick={() => void reorder.save()}
            >
              Retry order
            </button>
          )}
          {reorder.state === "conflict" && (
            <button
              type="button"
              className="ui-btn ui-btn-secondary"
              onClick={() => void reorder.reload()}
            >
              Reload categories
            </button>
          )}
        </section>
      )}
      {dialog?.unconfirmed && !dialog.open && (
        <section className="ui-card cg-alert">
          <p>An action needs confirmation.</p>
          <button
            type="button"
            className="ui-btn ui-btn-secondary"
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
      {!writable && <ReadOnlyNote />}
      {query.isPending && <Loading what="categories" />}
      {query.isError && (
        <LoadError
          message="Couldn't load your categories."
          onRetry={() => void query.refetch()}
          retryLabel="Try again"
        />
      )}
      {!query.isPending && !query.isError && items.length === 0 && (
        <div className="ui-card cg-empty">
          <EmptyState text="No categories yet." />
          {writable && (
            <div className="cg-empty-actions">
              <StarterButton
                disabled={locked}
                onChoose={() =>
                  start({ kind: "action", action: { kind: "starter" } })
                }
              />
              <button
                type="button"
                className="ui-btn ui-btn-secondary"
                disabled={locked}
                onClick={() => start({ kind: "edit" })}
              >
                <Plus size={18} aria-hidden="true" />
                Add your first category
              </button>
            </div>
          )}
        </div>
      )}
      {!query.isError && items.length > 0 && (
        <>
          <div className="cg-kind">
            <SegmentedControl
              label="Category kind"
              value={kind}
              onChange={setKind}
              options={[
                {
                  value: "expense",
                  label: `Expense ${activeRootCount(items, "expense")}`,
                },
                {
                  value: "income",
                  label: `Income ${activeRootCount(items, "income")}`,
                },
              ]}
            />
          </div>
          <SearchField
            id="category-search"
            label="Search categories"
            value={search}
            onChange={setSearch}
          />
          <div className="cg-bar">
            {anyArchived(items) ? (
              <fieldset className="cg-chips">
                <legend className="sr-only">View categories</legend>
                <FilterChip
                  selected={status === "active"}
                  onClick={() => setChosen("active")}
                >
                  Active
                </FilterChip>
                <FilterChip
                  selected={status === "archived"}
                  onClick={() => setChosen("archived")}
                >
                  Archived
                </FilterChip>
                <FilterChip
                  selected={status === "all"}
                  onClick={() => setChosen("all")}
                >
                  All
                </FilterChip>
              </fieldset>
            ) : (
              <span />
            )}
            <button
              type="button"
              className="ui-btn ui-btn-text"
              onClick={() =>
                setOpen(
                  everyOpen
                    ? new Set()
                    : new Set(
                        visible
                          .filter((group) => group.children.length > 0)
                          .map((group) => group.root.id),
                      ),
                )
              }
            >
              {everyOpen ? "Collapse all" : "Expand all"}
            </button>
          </div>
          <div className="cg-cols">
            {kinds.map((value) => (
              <div
                key={value}
                className="cg-col"
                data-active={value === kind ? "true" : "false"}
              >
                <SectionLabel>
                  {value === "expense" ? "Expense" : "Income"} ·{" "}
                  {activeRootCount(items, value)}
                </SectionLabel>
                <CategoryCard
                  groups={groupsOf(value)}
                  open={open}
                  searching={!!search.trim()}
                  writable={writable}
                  onToggle={toggle}
                  onActions={setActions}
                />
              </div>
            ))}
          </div>
        </>
      )}
      {shownNotice && (
        <Toast
          label="Category notification"
          className="cg-toast"
          durationMs={toastDuration(false)}
          onExpire={() => {
            setNotice("");
            reorder.clearNotice();
          }}
          onDismiss={() => {
            setNotice("");
            reorder.clearNotice();
          }}
        >
          <p role="status">{shownNotice}</p>
        </Toast>
      )}
      {actions && (
        <CategoryActions
          category={actions}
          items={items}
          disabled={locked || query.isFetching}
          canMerge={!!merge}
          onClose={() => setActions(null)}
          onStart={start}
          onMove={(body) => {
            setNotice("");
            void reorder.save(body);
          }}
          onMerge={() => merge?.begin(actions, `edit-category-${actions.id}`)}
        />
      )}
      {dialog?.kind === "edit" && (
        <CategoryEditor
          key={dialog.intentId}
          ledgerId={ledger.id}
          category={dialog.category}
          parentId={dialog.parentId}
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
    </div>
  );
}

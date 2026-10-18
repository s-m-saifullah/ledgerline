import type { Category, ledgerSchema } from "@ledgerline/shared";
import { Button } from "@ledgerline/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import type { z } from "zod";
import { useIsPhone } from "../../components/action-bar";
import { BackToMore } from "../../components/back-to-more";
import { getLedgers } from "../../lib/api";
import { randomUuid } from "../../lib/random-uuid";
import { CategoryActionDialog } from "./action-dialog";
import { getCategories } from "./api";
import { CategoryEditor } from "./editor";
import type {
  CategoriesViewContext,
  DialogIntent,
  DialogState,
} from "./list/context";
import {
  renderGroups,
  renderNotices,
  renderStates,
  renderToolbar,
} from "./list/sections";
import { useCategoryMergeWorkspace } from "./merge-workspace";
import { useCategoryReorder } from "./reorder";
import { byOrder } from "./tree";

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
  const form: CategoriesViewContext = {
    items,
    groups,
    writable,
    phone,
    locked,
    query,
    dialog,
    setDialog,
    notice,
    setNotice,
    reorder,
    merge,
    start,
    kind,
    setKind,
    status,
    setStatus,
    search,
    setSearch,
  };
  return (
    <>
      <BackToMore />
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
      {renderNotices(form)}
      {renderToolbar(form)}
      {renderStates(form)}
      {!query.isError && (
        <div className="category-groups">{renderGroups(form)}</div>
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

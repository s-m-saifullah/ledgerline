import type { Category } from "@ledgerline/shared";
import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  GitMerge,
  Pencil,
  Trash2,
} from "lucide-react";
import { ActionMenu } from "../../../components/action-menu";
import { CategoryMark } from "../appearance";
import { moveCategory } from "../tree";
import type { CategoriesViewContext } from "./context";

/** One category with its move, merge, edit, archive and delete controls (a menu on phones). */
export function renderCategoryRow(
  form: CategoriesViewContext,
  category: Category,
  child = false,
) {
  const {
    items,
    writable,
    phone,
    locked,
    query,
    dialog,
    reorder,
    merge,
    start,
    setNotice,
  } = form;
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
}

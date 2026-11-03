import type { Category } from "@ledgerline/shared";
import { IconTile, ListCard } from "@ledgerline/ui";
import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  FolderPlus,
  GitMerge,
  Pencil,
  Trash2,
} from "lucide-react";
import { Overlay } from "../../components/overlay";
import type { DialogIntent } from "./dialog-state";
import { archiveBlocked } from "./model";
import { moveCategory } from "./tree";

/**
 * Everything one can do with a category, in one sheet (the prototype's `OV["category-actions"]`): Edit, Add
 * subcategory, Move up and down, Merge into another category, Archive or Unarchive, and Delete in red. A row
 * that cannot be used now is disabled and says why in one short line.
 */
export function CategoryActions({
  category,
  items,
  disabled,
  canMerge,
  onClose,
  onStart,
  onMove,
  onMerge,
}: {
  category: Category;
  items: readonly Category[];
  /** Something else is open or saving, so nothing can start. */
  disabled: boolean;
  canMerge: boolean;
  onClose: () => void;
  onStart: (intent: DialogIntent) => void;
  onMove: (body: NonNullable<ReturnType<typeof moveCategory>>) => void;
  onMerge: () => void;
}) {
  const archived = !!category.archivedAt;
  const up = archived ? null : moveCategory(items, category, -1);
  const down = archived ? null : moveCategory(items, category, 1);
  const blocked = archiveBlocked(items, category);
  const row = (
    icon: React.ReactNode,
    title: string,
    run: () => void,
    options: { disabled?: boolean; hint?: string; danger?: boolean } = {},
  ) => (
    <button
      type="button"
      className="ui-row ui-row-press"
      disabled={disabled || options.disabled}
      onClick={() => {
        onClose();
        run();
      }}
    >
      <span className={options.danger ? "cg-danger-tile" : undefined}>
        <IconTile>{icon}</IconTile>
      </span>
      <span className="ui-row-main">
        <span
          className={options.danger ? "ui-row-title cg-danger" : "ui-row-title"}
        >
          {title}
        </span>
        {options.hint && <span className="ui-row-hint">{options.hint}</span>}
      </span>
    </button>
  );
  const icon = (Icon: typeof Pencil) => <Icon size={20} aria-hidden="true" />;
  return (
    <Overlay
      open
      title={category.name}
      busy={false}
      onDismiss={onClose}
      returnFocusId={`edit-category-${category.id}`}
      fallbackFocusId="main-content"
    >
      <ListCard>
        {row(icon(Pencil), "Edit", () => onStart({ kind: "edit", category }))}
        {!category.parentId &&
          !archived &&
          row(icon(FolderPlus), "Add subcategory", () =>
            onStart({ kind: "edit", parentId: category.id }),
          )}
        {!archived &&
          row(icon(ArrowUp), "Move up", () => up && onMove(up), {
            disabled: !up,
          })}
        {!archived &&
          row(icon(ArrowDown), "Move down", () => down && onMove(down), {
            disabled: !down,
          })}
        {canMerge && row(icon(GitMerge), "Merge into…", onMerge)}
        {row(
          icon(archived ? ArchiveRestore : Archive),
          archived ? "Unarchive" : "Archive",
          () =>
            onStart({
              kind: "action",
              action: { kind: archived ? "unarchive" : "archive", category },
            }),
          {
            disabled: blocked,
            ...(blocked
              ? {
                  hint: archived
                    ? "Unarchive the main category first"
                    : "Archive its subcategories first",
                }
              : {}),
          },
        )}
        {row(
          icon(Trash2),
          "Delete",
          () =>
            onStart({ kind: "action", action: { kind: "delete", category } }),
          { danger: true },
        )}
      </ListCard>
    </Overlay>
  );
}

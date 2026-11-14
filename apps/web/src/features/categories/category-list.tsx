import type { Category } from "@ledgerline/shared";
import { EmptyState, ListCard } from "@ledgerline/ui";
import { ChevronDown, ChevronUp, EllipsisVertical } from "lucide-react";
import { CategoryMark } from "./appearance";
import { type CategoryGroup, groupHint } from "./model";

/**
 * One kind's categories as an accordion (the prototype's `catRows`): a main category is a row that opens to its
 * subcategories, with its own actions button; a subcategory is a row that opens the actions sheet.
 */
export function CategoryCard({
  groups,
  open,
  searching,
  writable,
  onToggle,
  onActions,
}: {
  groups: readonly CategoryGroup[];
  open: ReadonlySet<string>;
  searching: boolean;
  writable: boolean;
  onToggle: (id: string) => void;
  onActions: (category: Category) => void;
}) {
  if (groups.length === 0)
    return (
      <div className="ui-card">
        <EmptyState text="No matching categories." />
      </div>
    );
  return (
    <ListCard>
      {groups.map((group) => {
        const { root, children } = group;
        const expanded =
          (open.has(root.id) || searching) && children.length > 0;
        return (
          <div
            key={root.id}
            className="cg-group"
            data-open={expanded ? "true" : "false"}
          >
            <div className="cg-head">
              {children.length === 0 ? (
                <div className="ui-row ui-row-static cg-toggle">
                  <CategoryMark icon={root.icon} color={root.color} />
                  <span className="ui-row-main">
                    <span className="ui-row-title">{root.name}</span>
                    <span className="ui-row-hint">{groupHint(group)}</span>
                  </span>
                </div>
              ) : (
                <button
                  type="button"
                  className="ui-row ui-row-press cg-toggle"
                  aria-expanded={expanded}
                  aria-controls={`cg-subs-${root.id}`}
                  onClick={() => onToggle(root.id)}
                >
                  <CategoryMark icon={root.icon} color={root.color} />
                  <span className="ui-row-main">
                    <span className="ui-row-title">{root.name}</span>
                    <span className="ui-row-hint">{groupHint(group)}</span>
                  </span>
                  <span className="ui-row-chevron" aria-hidden="true">
                    {expanded ? (
                      <ChevronUp size={18} />
                    ) : (
                      <ChevronDown size={18} />
                    )}
                  </span>
                </button>
              )}
              {writable && (
                <button
                  type="button"
                  id={`edit-category-${root.id}`}
                  className="ui-icon-btn cg-more"
                  aria-label={`Actions for ${root.name}`}
                  onClick={() => onActions(root)}
                >
                  <EllipsisVertical size={20} aria-hidden="true" />
                </button>
              )}
            </div>
            {expanded && (
              <div id={`cg-subs-${root.id}`} className="cg-subs">
                {children.map((child) =>
                  writable ? (
                    <button
                      key={child.id}
                      type="button"
                      id={`edit-category-${child.id}`}
                      className="ui-row ui-row-press cg-sub"
                      aria-label={`Actions for ${child.name}`}
                      onClick={() => onActions(child)}
                    >
                      <span className="ui-row-main">
                        <span className="ui-row-title">{child.name}</span>
                        {child.archivedAt && (
                          <span className="ui-row-hint">Archived</span>
                        )}
                      </span>
                    </button>
                  ) : (
                    <div key={child.id} className="ui-row ui-row-static cg-sub">
                      <span className="ui-row-main">
                        <span className="ui-row-title">{child.name}</span>
                        {child.archivedAt && (
                          <span className="ui-row-hint">Archived</span>
                        )}
                      </span>
                    </div>
                  ),
                )}
              </div>
            )}
          </div>
        );
      })}
    </ListCard>
  );
}

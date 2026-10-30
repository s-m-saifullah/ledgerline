import type { Category } from "@ledgerline/shared";
import { SegmentedControl } from "@ledgerline/ui";
import { useState } from "react";
import { DateTimeInput } from "../../components/date-time-input";
import { NativeSelect } from "../../components/native-select";
import { Overlay } from "../../components/overlay";
import type { TransactionFilters } from "./filters";
import { type SheetFilters, sheetFilters } from "./list-model";

type Option = { id: string; name: string };
export const rangeMessage = "Choose an end date on or after the start date.";
export const isBackwards = (draft: SheetFilters) =>
  !!draft.from && !!draft.to && draft.from > draft.to;

type StatusChoice = "all" | "cleared" | "pending";

/**
 * The filters that do not apply as you type: account, category, tag, dates and status. The draft is the sheet's
 * own until Apply; Cancel, Escape and a click outside drop it.
 */
export function FiltersSheet({
  open,
  applied,
  accounts,
  categories,
  tags,
  categoryName,
  onApply,
  onDismiss,
}: {
  open: boolean;
  applied: TransactionFilters;
  accounts: Option[];
  categories: Category[];
  tags: Option[];
  categoryName: (id: string) => string;
  onApply: (draft: SheetFilters) => void;
  onDismiss: () => void;
}) {
  const [draft, setDraft] = useState<SheetFilters>(() => sheetFilters(applied));
  const [wasOpen, setWasOpen] = useState(open);
  // Each opening starts from what is applied, not from a draft that was dropped.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setDraft(sheetFilters(applied));
  }
  const set = (key: keyof SheetFilters, value: string) =>
    setDraft((previous) => {
      const next = { ...previous };
      if (value) Object.assign(next, { [key]: value });
      else delete next[key];
      return next;
    });
  const backwards = isBackwards(draft);
  const hasSubcategories = categories.some(
    (item) => item.parentId === draft.categoryId,
  );
  return (
    <Overlay
      open={open}
      title="Filters"
      busy={false}
      onDismiss={onDismiss}
      returnFocusId="open-filters"
      fallbackFocusId="main-content"
      action={
        <button
          type="button"
          className="ui-btn ui-btn-text"
          onClick={() => setDraft({})}
        >
          Reset all
        </button>
      }
      footer={
        <button
          type="button"
          className="ui-btn ui-btn-primary"
          disabled={backwards}
          onClick={() => onApply(draft)}
        >
          Apply
        </button>
      }
    >
      <div className="tx-sheet">
        <div>
          <label htmlFor="filter-account">Account</label>
          <NativeSelect
            id="filter-account"
            value={draft.accountId ?? ""}
            onChange={(event) => set("accountId", event.target.value)}
          >
            <option value="">All accounts</option>
            {accounts.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div>
          <label htmlFor="filter-category">Category</label>
          <NativeSelect
            id="filter-category"
            value={draft.categoryId ?? ""}
            onChange={(event) => set("categoryId", event.target.value)}
          >
            <option value="">All categories</option>
            {categories.map((row) => (
              <option key={row.id} value={row.id}>
                {categoryName(row.id)}
              </option>
            ))}
          </NativeSelect>
          {hasSubcategories && (
            <p className="muted">Includes its subcategories.</p>
          )}
        </div>
        <div>
          <label htmlFor="filter-tag">Tag</label>
          <NativeSelect
            id="filter-tag"
            value={draft.tagId ?? ""}
            onChange={(event) => set("tagId", event.target.value)}
          >
            <option value="">All tags</option>
            {tags.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="tx-sheet-dates">
          <div>
            <label htmlFor="filter-from">From date</label>
            <DateTimeInput
              label="From date"
              id="filter-from"
              type="date"
              min="0001-01-01"
              max="9999-12-31"
              value={draft.from ?? ""}
              onChange={(event) => set("from", event.target.value)}
            />
          </div>
          <div>
            <label htmlFor="filter-to">To date</label>
            <DateTimeInput
              label="To date"
              id="filter-to"
              type="date"
              min="0001-01-01"
              max="9999-12-31"
              value={draft.to ?? ""}
              onChange={(event) => set("to", event.target.value)}
            />
          </div>
        </div>
        {backwards && (
          <p role="alert" className="field-error">
            {rangeMessage}
          </p>
        )}
        <SegmentedControl<StatusChoice>
          label="Status"
          options={[
            { value: "all", label: "All" },
            { value: "cleared", label: "Cleared" },
            { value: "pending", label: "Pending" },
          ]}
          value={draft.status ?? "all"}
          onChange={(value) => set("status", value === "all" ? "" : value)}
        />
      </div>
    </Overlay>
  );
}

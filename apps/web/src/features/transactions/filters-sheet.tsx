import { SegmentedControl } from "@ledgerline/ui";
import { useState } from "react";
import {
  type ComboCreate,
  ComboField,
  type ComboOption,
} from "../../components/combo-field";
import { DateTimeInput } from "../../components/date-time-input";
import { Overlay } from "../../components/overlay";
import type { TransactionFilters } from "./filters";
import { type SheetFilters, sheetFilters } from "./list-model";

export const rangeMessage = "Choose an end date on or after the start date.";
export const isBackwards = (filters: SheetFilters) =>
  !!filters.from && !!filters.to && filters.from > filters.to;

type StatusChoice = "all" | "cleared" | "pending";

/**
 * The filters that do not apply as you type in the search: account, category, tag, dates and status. Each
 * change applies at once (there is no Apply button), so the list behind the sheet follows; Done closes it.
 */
export function FiltersSheet({
  open,
  applied,
  accounts,
  categories,
  tags,
  categoryHasChildren,
  createCategories,
  createTags,
  onChange,
  onDismiss,
}: {
  open: boolean;
  applied: TransactionFilters;
  accounts: ComboOption[];
  categories: ComboOption[];
  tags: ComboOption[];
  categoryHasChildren: (id: string) => boolean;
  /** Ways to make a category or a tag from what was typed; empty for someone who cannot add them. */
  createCategories: ComboCreate[];
  createTags: ComboCreate[];
  onChange: (next: SheetFilters) => void;
  onDismiss: () => void;
}) {
  const current = sheetFilters(applied);
  // A date is typed or picked in its own box; it applies once it is a whole date (or emptied) and the range
  // is not backwards. The boxes follow the address when something else changes the filters.
  const [dates, setDates] = useState({
    from: current.from ?? "",
    to: current.to ?? "",
  });
  const [seen, setSeen] = useState({
    from: current.from ?? "",
    to: current.to ?? "",
  });
  if (seen.from !== (current.from ?? "") || seen.to !== (current.to ?? "")) {
    const next = { from: current.from ?? "", to: current.to ?? "" };
    setSeen(next);
    setDates(next);
  }
  const change = (key: keyof SheetFilters, value: string) => {
    const next = { ...current };
    if (value) Object.assign(next, { [key]: value });
    else delete next[key];
    onChange(next);
  };
  const setDate = (key: "from" | "to", value: string) => {
    const nextDates = { ...dates, [key]: value };
    setDates(nextDates);
    const next: SheetFilters = { ...current };
    if (nextDates.from) next.from = nextDates.from;
    else delete next.from;
    if (nextDates.to) next.to = nextDates.to;
    else delete next.to;
    if (!isBackwards(next)) onChange(next);
  };
  const backwards = !!dates.from && !!dates.to && dates.from > dates.to;
  return (
    <Overlay
      open={open}
      title="Filters"
      cancelLabel="Done"
      busy={false}
      onDismiss={onDismiss}
      returnFocusId="open-filters"
      fallbackFocusId="main-content"
      action={
        <button
          type="button"
          className="ui-btn ui-btn-text"
          onClick={() => {
            setDates({ from: "", to: "" });
            onChange({});
          }}
        >
          Reset all
        </button>
      }
    >
      <div className="tx-sheet">
        <ComboField
          label="Account"
          allLabel="All accounts"
          emptyText="No matching accounts."
          options={accounts}
          value={current.accountId ?? null}
          onChange={(id) => change("accountId", id ?? "")}
        />
        <div>
          <ComboField
            label="Category"
            allLabel="All categories"
            emptyText="No matching categories."
            options={categories}
            value={current.categoryId ?? null}
            onChange={(id) => change("categoryId", id ?? "")}
            creates={createCategories}
          />
          {!!current.categoryId && categoryHasChildren(current.categoryId) && (
            <p className="muted">Includes its subcategories.</p>
          )}
        </div>
        <ComboField
          label="Tag"
          allLabel="All tags"
          emptyText="No matching tags."
          options={tags}
          value={current.tagId ?? null}
          onChange={(id) => change("tagId", id ?? "")}
          creates={createTags}
        />
        <div className="tx-sheet-dates">
          <div>
            <label htmlFor="filter-from">From date</label>
            <DateTimeInput
              label="From date"
              id="filter-from"
              type="date"
              min="0001-01-01"
              max="9999-12-31"
              value={dates.from}
              onChange={(event) => setDate("from", event.target.value)}
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
              value={dates.to}
              onChange={(event) => setDate("to", event.target.value)}
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
          value={current.status ?? "all"}
          onChange={(value) => change("status", value === "all" ? "" : value)}
        />
      </div>
    </Overlay>
  );
}

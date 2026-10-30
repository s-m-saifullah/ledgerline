import { FilterChip, ListCard, ListHead } from "@ledgerline/ui";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Fragment, useEffect, useState } from "react";
import { Amount } from "../../components/amount-text";
import { getLedgers } from "../../lib/api";
import { getCategories } from "../categories/api";
import { ExportButton } from "../exports/export-button";
import { useTags } from "../tags/use-tags";
import { getAllAccounts, getTransactions } from "./api";
import { EntryRow } from "./entry-row";
import { dayLabel, type TransactionFilters } from "./filters";
import { FiltersSheet } from "./filters-sheet";
import {
  countFilters,
  groupDays,
  hasAnyFilter,
  nextFilters,
  type SheetFilters,
} from "./list-model";
import { useTransactionWorkspace } from "./workspace";
import "./transactions.css";

/** How long the search waits after the last key before it applies (Enter applies at once). */
export const SEARCH_PAUSE_MS = 400;
const kinds = [
  { value: undefined, label: "All" },
  { value: "expense", label: "Expenses" },
  { value: "income", label: "Income" },
  { value: "transfer", label: "Transfers" },
] as const;
const rangeMessage = "Choose an end date on or after the start date.";
/** The filters with the search text set (or removed when it is empty); everything else stays. */
function withText(
  filters: TransactionFilters,
  text: string,
): TransactionFilters {
  const { text: _dropped, ...rest } = filters;
  return text ? { ...rest, text } : rest;
}

export function TransactionsPage() {
  const filters = useSearch({ from: "/transactions" });
  const navigate = useNavigate();
  const workspace = useTransactionWorkspace();
  const ledgers = useQuery({ queryKey: ["ledgers"], queryFn: getLedgers });
  const ledger = ledgers.data?.items[0];
  const rangeInvalid =
    !!filters.from && !!filters.to && filters.from > filters.to;
  const entries = useInfiniteQuery({
    queryKey: ["transactions", ledger?.id, "list", filters],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      getTransactions(ledger?.id as string, filters, pageParam, signal),
    getNextPageParam: (page, _pages, _param, params) =>
      page.nextCursor && !params.includes(page.nextCursor)
        ? page.nextCursor
        : undefined,
    enabled: !!ledger && !rangeInvalid,
  });
  const accounts = useQuery({
    queryKey: ["accounts", ledger?.id, "history"],
    queryFn: ({ signal }) => getAllAccounts(ledger?.id as string, signal),
    enabled: !!ledger,
  });
  const categories = useQuery({
    queryKey: ["categories", ledger?.id],
    queryFn: ({ signal }) => getCategories(ledger?.id as string, signal),
    enabled: !!ledger,
  });
  const tags = useTags(ledger?.id);
  const accountNames = new Map(
    accounts.data?.map((row) => [
      row.id,
      `${row.name}${row.archivedAt ? " (archived)" : ""}`,
    ]),
  );
  const accountName = (id: string) =>
    accountNames.get(id) ?? "Account unavailable";
  const categoryName = (id: string | null) => {
    const row = categories.data?.find((item) => item.id === id);
    const parent = categories.data?.find((item) => item.id === row?.parentId);
    return row
      ? `${parent ? `${parent.name} / ` : ""}${row.name}${row.archivedAt ? " (archived)" : ""}`
      : "Category unavailable";
  };
  const rows = [
    ...new Map(
      entries.data?.pages
        .flatMap((page) => page.items)
        .map((row) => [row.id, row]),
    ).values(),
  ];
  const days = groupDays(rows, !!entries.hasNextPage);

  // The search applies after a pause or on Enter. It follows the address when something else changes it
  // (Clear filters, a link), but not when the change is the one it just made.
  const [searchText, setSearchText] = useState(filters.text ?? "");
  const [seenText, setSeenText] = useState(filters.text);
  const [sentText, setSentText] = useState<string | null>(null);
  if (filters.text !== seenText) {
    setSeenText(filters.text);
    if ((filters.text ?? "") !== sentText) setSearchText(filters.text ?? "");
  }
  const applySearch = () => {
    const text = searchText.trim();
    if (text === (filters.text ?? "")) return;
    setSentText(text);
    void navigate({ to: "/transactions", search: withText(filters, text) });
  };
  useEffect(() => {
    const text = searchText.trim();
    if (text === (filters.text ?? "")) return;
    const timer = setTimeout(() => {
      setSentText(text);
      void navigate({
        to: "/transactions",
        search: withText(filters, text),
        replace: true,
      });
    }, SEARCH_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [searchText, filters, navigate]);

  const [sheetOpen, setSheetOpen] = useState(false);
  const chooseKind = (kind: (typeof kinds)[number]["value"]) => {
    const { kind: _dropped, ...rest } = filters;
    void navigate({
      to: "/transactions",
      search: kind ? { ...rest, kind } : rest,
    });
  };
  const applySheet = (draft: SheetFilters) => {
    setSheetOpen(false);
    void navigate({ to: "/transactions", search: nextFilters(filters, draft) });
  };
  const count = countFilters(filters);
  const paginationStalled =
    !!entries.data &&
    entries.data.pages.some(
      (page, index) =>
        !!page.nextCursor &&
        entries.data.pageParams.slice(0, index + 1).includes(page.nextCursor),
    );
  const blocked = !!workspace?.blocked || !accounts.data || !categories.data;
  return (
    <div className="tx-page">
      <div className="page-heading tx-head">
        <h1 id="transactions-title" tabIndex={-1}>
          Transactions
        </h1>
        <ExportButton
          ledgerId={ledger?.id}
          filters={filters}
          disabled={rangeInvalid}
        />
      </div>
      <search>
        <form
          className="tx-search"
          onSubmit={(event) => {
            event.preventDefault();
            applySearch();
          }}
        >
          <label htmlFor="transaction-search" className="sr-only">
            Search payer, payee or note
          </label>
          <input
            id="transaction-search"
            type="search"
            maxLength={200}
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="Search transactions"
          />
          <button
            type="button"
            id="open-filters"
            className="ui-btn ui-btn-secondary"
            aria-haspopup="dialog"
            onClick={() => setSheetOpen(true)}
          >
            Filters
            {count > 0 && <span className="ui-chip-count">{count}</span>}
          </button>
        </form>
      </search>
      <div className="tx-chips">
        <fieldset className="tx-kinds">
          <legend className="sr-only">Entry type</legend>
          {kinds.map((option) => (
            <FilterChip
              key={option.label}
              selected={(filters.kind ?? undefined) === option.value}
              onClick={() => chooseKind(option.value)}
            >
              {option.label}
            </FilterChip>
          ))}
        </fieldset>
        {hasAnyFilter(filters) && (
          <button
            type="button"
            className="ui-btn ui-btn-text"
            onClick={() => {
              setSearchText("");
              void navigate({ to: "/transactions", search: {} });
            }}
          >
            Clear filters
          </button>
        )}
      </div>
      {rangeInvalid && (
        <p role="alert" className="field-error">
          {rangeMessage}
        </p>
      )}
      <FiltersSheet
        open={sheetOpen}
        applied={filters}
        accounts={(accounts.data ?? []).map((row) => ({
          id: row.id,
          name: accountName(row.id),
        }))}
        categories={categories.data ?? []}
        tags={(tags.data ?? []).map((row) => ({
          id: row.id,
          name: `${row.name}${row.archivedAt ? " (archived)" : ""}`,
        }))}
        categoryName={categoryName}
        onApply={applySheet}
        onDismiss={() => setSheetOpen(false)}
      />
      {(ledgers.isError ||
        entries.isError ||
        accounts.isError ||
        categories.isError) && (
        <div className="ui-card tx-error">
          <p role="alert">Couldn't load all transaction details.</p>
          <button
            type="button"
            className="ui-btn ui-btn-secondary"
            onClick={() => {
              void ledgers.refetch();
              void entries.refetch();
              void accounts.refetch();
              void categories.refetch();
            }}
          >
            Try again
          </button>
        </div>
      )}
      {(ledgers.isPending ||
        (!!ledger && entries.isPending && !rangeInvalid)) && (
        <p role="status">Loading transactions…</p>
      )}
      {ledgers.data && !ledger && (
        <p className="account-error">No ledger is available.</p>
      )}
      {!rangeInvalid && entries.data && rows.length === 0 && (
        <div className="ui-card tx-empty">
          <h2 className="ui-title">No matching entries</h2>
          <p className="muted">
            {hasAnyFilter(filters)
              ? "Try another search or clear the filters."
              : "Use Add to record your first income or expense."}
          </p>
        </div>
      )}
      {!rangeInvalid &&
        days.map((day) => (
          <section
            className="tx-day"
            key={day.date}
            aria-label={dayLabel(day.date)}
          >
            <ListCard>
              <ListHead
                left={<h2 className="tx-day-title">{dayLabel(day.date)}</h2>}
                right={
                  day.net.length > 0 ? (
                    <span className="tx-net">
                      {day.net.map((money, index) => (
                        <Fragment key={money.currency}>
                          {index > 0 && " · "}
                          <span
                            className={money.amount > 0 ? "tx-pos" : undefined}
                          >
                            <Amount
                              cents={money.amount}
                              currency={money.currency}
                              plus
                            />
                          </span>
                        </Fragment>
                      ))}
                    </span>
                  ) : undefined
                }
              />
              {day.entries.map((entry) => (
                <EntryRow
                  key={entry.kind === "single" ? entry.row.id : entry.from.id}
                  entry={entry}
                  names={{ account: accountName, category: categoryName }}
                  disabled={blocked}
                  onOpen={(row) => workspace?.openTransaction(row)}
                />
              ))}
            </ListCard>
          </section>
        ))}
      {paginationStalled && (
        <p role="alert" className="field-error">
          Pagination stopped advancing. Refresh the list before continuing.
        </p>
      )}
      {!rangeInvalid && entries.hasNextPage && (
        <button
          type="button"
          className="ui-btn ui-btn-secondary tx-load-more"
          disabled={entries.isFetchingNextPage}
          onClick={() => void entries.fetchNextPage()}
        >
          {entries.isFetchingNextPage ? "Loading more…" : "Load more"}
        </button>
      )}
    </div>
  );
}

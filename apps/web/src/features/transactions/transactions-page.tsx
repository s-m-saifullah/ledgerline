import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useContext, useEffect, useState } from "react";
import { DateTimeInput } from "../../components/date-time-input";
import { NativeSelect } from "../../components/native-select";
import { getLedgers } from "../../lib/api";
import { formatTime12 } from "../../lib/time";
import { formatUsd } from "../accounts/money";
import { getCategories } from "../categories/api";
import { PrivacyContext } from "../shell/preferences";
import { getAllAccounts, getTransactions } from "./api";
import {
  dayLabel,
  type TransactionFilters,
  transactionSearchSchema,
} from "./filters";
import { useTransactionWorkspace } from "./workspace";

export function TransactionsPage() {
  const filters = useSearch({ from: "/transactions" });
  const navigate = useNavigate();
  const privateMode = useContext(PrivacyContext);
  const workspace = useTransactionWorkspace();
  const ledgers = useQuery({ queryKey: ["ledgers"], queryFn: getLedgers });
  const ledger = ledgers.data?.items[0];
  const [draft, setDraft] = useState<TransactionFilters>(filters);
  const [filterError, setFilterError] = useState("");
  useEffect(() => {
    setDraft(filters);
    setFilterError("");
  }, [filters]);
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
  const accountNames = new Map(
    accounts.data?.map((row) => [
      row.id,
      `${row.name}${row.archivedAt ? " (archived)" : ""}`,
    ]),
  );
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
  const days = [...new Set(rows.map((row) => row.date))];
  const setFilter = (key: keyof TransactionFilters, value: string) =>
    setDraft((previous) => ({ ...previous, [key]: value || undefined }));
  const apply = async () => {
    const parsed = transactionSearchSchema.safeParse(draft);
    if (!parsed.success || (draft.from && draft.to && draft.from > draft.to)) {
      setFilterError("Choose an end date on or after the start date.");
      return;
    }
    setFilterError("");
    await navigate({ to: "/transactions", search: parsed.data });
  };
  const paginationStalled =
    !!entries.data &&
    entries.data.pages.some(
      (page, index) =>
        !!page.nextCursor &&
        entries.data.pageParams.slice(0, index + 1).includes(page.nextCursor),
    );
  return (
    <>
      <div className="page-heading">
        <p className="eyebrow">YOUR LEDGER</p>
        <h1 id="transactions-title" tabIndex={-1}>
          Transactions
        </h1>
        <p className="muted">
          Find an entry, check its details, or make a correction.
        </p>
      </div>
      <form
        className="transaction-filters"
        onSubmit={(event) => {
          event.preventDefault();
          void apply();
        }}
      >
        <div className="transaction-filter-search">
          <label htmlFor="transaction-search">
            Search payer, payee or note
          </label>
          <input
            id="transaction-search"
            type="search"
            maxLength={200}
            value={draft.text ?? ""}
            onChange={(event) => setFilter("text", event.target.value)}
            placeholder="Search transactions"
          />
          <button type="submit" className="button">
            Apply filters
          </button>
        </div>
        <details>
          <summary>Filter entries</summary>
          <div className="transaction-filter-grid">
            <div>
              <label htmlFor="filter-account">Account</label>
              <NativeSelect
                id="filter-account"
                value={draft.accountId ?? ""}
                onChange={(event) => setFilter("accountId", event.target.value)}
              >
                <option value="">All accounts</option>
                {accounts.data?.map((row) => (
                  <option key={row.id} value={row.id}>
                    {accountNames.get(row.id)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div>
              <label htmlFor="filter-category">Category</label>
              <NativeSelect
                id="filter-category"
                value={draft.categoryId ?? ""}
                onChange={(event) =>
                  setFilter("categoryId", event.target.value)
                }
              >
                <option value="">All categories</option>
                {categories.data?.map((row) => (
                  <option key={row.id} value={row.id}>
                    {categoryName(row.id)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div>
              <label htmlFor="filter-from">From date</label>
              <DateTimeInput
                label="From date"
                id="filter-from"
                type="date"
                min="0001-01-01"
                max="9999-12-31"
                value={draft.from ?? ""}
                onChange={(event) => setFilter("from", event.target.value)}
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
                onChange={(event) => setFilter("to", event.target.value)}
              />
            </div>
            <div>
              <label htmlFor="filter-kind">Entry type</label>
              <NativeSelect
                id="filter-kind"
                value={draft.kind ?? ""}
                onChange={(event) => setFilter("kind", event.target.value)}
              >
                <option value="">All entries</option>
                <option value="expense">Expenses</option>
                <option value="income">Income</option>
                <option value="transfer">Transfers</option>
              </NativeSelect>
            </div>
            <div>
              <label htmlFor="filter-status">Status</label>
              <NativeSelect
                id="filter-status"
                value={draft.status ?? ""}
                onChange={(event) => setFilter("status", event.target.value)}
              >
                <option value="">Cleared and pending</option>
                <option value="cleared">Cleared</option>
                <option value="pending">Pending</option>
              </NativeSelect>
            </div>
          </div>
        </details>
        <button
          type="button"
          className="quiet-button"
          onClick={() => {
            setDraft({});
            void navigate({ to: "/transactions", search: {} });
          }}
        >
          Clear filters
        </button>
        {(filterError || rangeInvalid) && (
          <p role="alert" className="field-error">
            {filterError || "Choose an end date on or after the start date."}
          </p>
        )}
      </form>
      {(ledgers.isError ||
        entries.isError ||
        accounts.isError ||
        categories.isError) && (
        <div className="account-error">
          <p role="alert">Couldn't load all transaction details.</p>
          <button
            type="button"
            className="secondary-button"
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
        <div className="transaction-empty">
          <h2>No matching entries</h2>
          <p>
            {Object.values(filters).some(Boolean)
              ? "Try another search or clear the filters."
              : "Use Add to record your first income or expense."}
          </p>
        </div>
      )}
      {!rangeInvalid &&
        days.map((date) => (
          <section
            className="transaction-day"
            key={date}
            aria-label={dayLabel(date)}
          >
            <h2>{dayLabel(date)}</h2>
            <ul>
              {rows
                .filter((row) => row.date === date)
                .map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      id={`transaction-${row.id}`}
                      className="transaction-row"
                      disabled={
                        workspace?.blocked || !accounts.data || !categories.data
                      }
                      onClick={() => workspace?.openTransaction(row)}
                      aria-label={`Open transaction: ${row.transferId ? `Transfer ${row.amount.amount < 0 ? "from" : "to"} ${accountNames.get(row.accountId) ?? "account"}` : row.payee || (row.isSplit ? "Split transaction" : categoryName(row.categoryId))}`}
                    >
                      <span className="transaction-row-description">
                        <strong>
                          {row.transferId
                            ? `Transfer ${row.amount.amount < 0 ? "from" : "to"} ${accountNames.get(row.accountId) ?? "account"}`
                            : row.payee ||
                              (row.isSplit
                                ? "Split transaction"
                                : categoryName(row.categoryId))}
                        </strong>
                        <span>
                          {row.transferId
                            ? "Transfer"
                            : row.isSplit
                              ? `Split · ${row.splits.length} categories`
                              : categoryName(row.categoryId)}{" "}
                          ·{" "}
                          {accountNames.get(row.accountId) ??
                            "Account unavailable"}
                          {row.time ? ` · ${formatTime12(row.time)}` : ""}
                          {row.receivablePaymentId ? " · Service payment" : ""}
                        </span>
                        {row.note && (
                          <span className="transaction-row-note">
                            {row.note}
                          </span>
                        )}
                      </span>
                      <span className="transaction-row-value">
                        <strong>
                          {privateMode ? (
                            <>
                              <span aria-hidden="true">••••</span>
                              <span className="sr-only">Amount hidden</span>
                            </>
                          ) : (
                            formatUsd(row.amount.amount)
                          )}
                        </strong>
                        <span
                          className={
                            row.status === "pending"
                              ? "transaction-pending"
                              : "muted"
                          }
                        >
                          {row.status === "pending"
                            ? "Pending"
                            : row.kind === "transfer"
                              ? "Transfer"
                              : row.kind === "income"
                                ? "Income"
                                : "Expense"}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
            </ul>
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
          className="secondary-button transaction-load-more"
          disabled={entries.isFetchingNextPage}
          onClick={() => void entries.fetchNextPage()}
        >
          {entries.isFetchingNextPage ? "Loading more…" : "Load more"}
        </button>
      )}
    </>
  );
}

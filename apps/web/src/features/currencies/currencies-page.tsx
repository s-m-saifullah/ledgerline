import type { PinnedCurrency } from "@ledgerline/shared";
import { Button } from "@ledgerline/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { getLedgers } from "../../lib/api";
import { AddCurrencyDialog } from "./add-dialog";
import { getCurrencies, prepareRatesRefresh } from "./api";
import { currencyName, rateSentence } from "./format";
import { RateEditor } from "./rate-editor";

export function CurrenciesPage() {
  const client = useQueryClient();
  const ledgers = useQuery({ queryKey: ["ledgers"], queryFn: getLedgers });
  const ledger = ledgers.data?.items[0];
  const writable = !!ledger && ledger.role !== "viewer";
  const list = useQuery({
    queryKey: ["currencies", ledger?.id],
    queryFn: ({ signal }) => getCurrencies(ledger?.id as string, signal),
    enabled: !!ledger,
    staleTime: 0,
  });
  const data = list.data;
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const refresh = () =>
    void client.invalidateQueries({ queryKey: ["currencies", ledger?.id] });
  const editingCurrency: PinnedCurrency | undefined = data?.items.find(
    (item) => item.code === editing,
  );
  const refreshRates = async () => {
    if (!ledger) return;
    setRefreshing(true);
    setNotice("");
    try {
      const result = await prepareRatesRefresh(ledger.id)();
      const parts = [
        result.updated
          ? `Updated ${result.updated} ${result.updated === 1 ? "rate" : "rates"}.`
          : "Rates are already up to date.",
      ];
      if (result.keptManual)
        parts.push(`Kept ${result.keptManual} you set yourself.`);
      if (result.failed.length)
        parts.push(
          `Couldn't fetch ${result.failed.join(", ")}. You can set those by hand.`,
        );
      setNotice(parts.join(" "));
      refresh();
    } catch {
      setNotice("Couldn't refresh the rates. Please try again.");
    } finally {
      setRefreshing(false);
    }
  };
  return (
    <>
      <div className="page-heading">
        <p className="eyebrow">MAKE IT YOURS</p>
        <h1 id="currencies-title" tabIndex={-1}>
          Currencies
        </h1>
        <p className="muted">
          {data
            ? `Your base currency is ${currencyName(data.baseCurrency)} (${data.baseCurrency}). Totals are shown in it.`
            : "Exchange rates for the currencies you use."}
        </p>
      </div>
      {(ledgers.isError || list.isError) && (
        <div className="account-error">
          <p role="alert">Couldn't load your currencies.</p>
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              void ledgers.refetch();
              if (ledger) void list.refetch();
            }}
          >
            Try again
          </button>
        </div>
      )}
      {!data && !list.isError && !ledgers.isError && (
        <p className="muted" role="status">
          Loading your currencies…
        </p>
      )}
      {data && (
        <>
          {writable && (
            <div className="account-dialog-actions currency-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={refreshing || data.items.length === 0}
                onClick={refreshRates}
              >
                {refreshing ? "Refreshing…" : "Refresh rates"}
              </button>
              <Button
                type="button"
                id="add-currency"
                onClick={() => setAdding(true)}
              >
                Add a currency
              </Button>
            </div>
          )}
          {notice && (
            <p role="status" className="muted">
              {notice}
            </p>
          )}
          {data.items.length === 0 ? (
            <p className="muted">
              Only {data.baseCurrency} so far.{" "}
              {writable ? "Add a currency to keep money in more than one." : ""}
            </p>
          ) : (
            <ul className="budget-list" aria-label="Currencies">
              {data.items.map((item) => (
                <li key={item.id}>
                  {writable ? (
                    <button
                      type="button"
                      id={`currency-${item.code}`}
                      className="budget-line"
                      onClick={() => setEditing(item.code)}
                    >
                      <CurrencyRow item={item} base={data.baseCurrency} />
                    </button>
                  ) : (
                    <div className="budget-line">
                      <CurrencyRow item={item} base={data.baseCurrency} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {ledger && data && adding && (
        <AddCurrencyDialog
          ledgerId={ledger.id}
          baseCurrency={data.baseCurrency}
          taken={data.items.map((item) => item.code)}
          onDismiss={() => setAdding(false)}
          onChanged={refresh}
        />
      )}
      {ledger && data && editingCurrency && (
        <RateEditor
          key={`${editingCurrency.code}-${editingCurrency.latestRate?.version ?? 0}`}
          ledgerId={ledger.id}
          baseCurrency={data.baseCurrency}
          currency={editingCurrency}
          onDismiss={() => setEditing(null)}
          onChanged={refresh}
        />
      )}
    </>
  );
}

function CurrencyRow({ item, base }: { item: PinnedCurrency; base: string }) {
  const latest = item.latestRate;
  return (
    <>
      <span className="budget-line-top">
        <strong>
          {currencyName(item.code)} ({item.code})
        </strong>
      </span>
      <span className="budget-line-detail muted">
        {latest
          ? `${rateSentence(item.code, latest.rate, base)} · ${latest.date} · ${latest.source === "manual" ? "set by you" : "fetched"}`
          : "No rate yet. Refresh, or set one yourself."}
      </span>
    </>
  );
}

import type { PinnedCurrency } from "@ledgerline/shared";
import {
  EmptyState,
  IconTile,
  ListCard,
  RowBody,
  StatusPill,
} from "@ledgerline/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw } from "lucide-react";
import { useState } from "react";
import { LoadError } from "../../components/load-error";
import { Toast } from "../../components/toast";
import { getLedgers } from "../../lib/api";
import { currencyName } from "../../lib/rate-format";
import { usePageAdd } from "../shell/page-add";
import { AddCurrencySheet } from "./add-sheet";
import { getCurrencies, prepareRatesRefresh } from "./api";
import { rateHint, refreshFailed, refreshNotice } from "./model";
import { RateSheet } from "./rate-sheet";
import "./currencies.css";

/**
 * Currencies (ADR 0047, the prototype's `R.currencies`): one card with the base currency first and then each added
 * currency with its newest rate, Refresh rates and Add currency in the head, and one sheet per currency.
 */
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
  const reload = () =>
    void client.invalidateQueries({ queryKey: ["currencies", ledger?.id] });
  const editingCurrency: PinnedCurrency | undefined = data?.items.find(
    (item) => item.code === editing,
  );
  usePageAdd(
    writable && data
      ? {
          label: "Add currency",
          disabled: false,
          onClick: () => {
            setNotice("");
            setAdding(true);
          },
        }
      : null,
  );
  const refreshRates = async () => {
    if (!ledger) return;
    setRefreshing(true);
    setNotice("");
    try {
      setNotice(refreshNotice(await prepareRatesRefresh(ledger.id)()));
      reload();
    } catch {
      setNotice(refreshFailed);
    } finally {
      setRefreshing(false);
    }
  };
  const row = (item: PinnedCurrency, base: string) => {
    const body = (
      <RowBody
        lead={
          <IconTile>
            <span className="cu-code">{item.code}</span>
          </IconTile>
        }
        title={currencyName(item.code)}
        hint={rateHint(item, base)}
        chevron={writable}
      />
    );
    return writable ? (
      <button
        key={item.id}
        type="button"
        id={`currency-${item.code}`}
        className="ui-row ui-row-press cu-row"
        onClick={() => {
          setNotice("");
          setEditing(item.code);
        }}
      >
        {body}
      </button>
    ) : (
      <div key={item.id} className="ui-row ui-row-static cu-row">
        {body}
      </div>
    );
  };
  return (
    <div className="cu-page">
      <div className="page-heading cu-head">
        <h1 id="currencies-title" tabIndex={-1}>
          Currencies
        </h1>
        {writable && data && (
          <div className="cu-buttons">
            <button
              type="button"
              className="ui-btn ui-btn-secondary"
              disabled={refreshing || data.items.length === 0}
              onClick={() => void refreshRates()}
            >
              <RefreshCw size={18} aria-hidden="true" />
              {refreshing ? "Refreshing…" : "Refresh rates"}
            </button>
            <button
              type="button"
              id="add-currency"
              className="ui-btn ui-btn-primary cu-add"
              onClick={() => {
                setNotice("");
                setAdding(true);
              }}
            >
              <Plus size={18} aria-hidden="true" />
              Add currency
            </button>
          </div>
        )}
      </div>
      {(ledgers.isError || list.isError) && (
        <LoadError
          message="Couldn't load your currencies."
          onRetry={() => {
            void ledgers.refetch();
            if (ledger) void list.refetch();
          }}
        />
      )}
      {!data && !list.isError && !ledgers.isError && (
        <p className="muted" role="status">
          Loading your currencies…
        </p>
      )}
      {data && (
        <>
          <ListCard>
            <div className="ui-row ui-row-static cu-row">
              <RowBody
                lead={
                  <IconTile>
                    <span className="cu-code">{data.baseCurrency}</span>
                  </IconTile>
                }
                title={currencyName(data.baseCurrency)}
                value={<StatusPill>Base</StatusPill>}
              />
            </div>
            {data.items.map((item) => row(item, data.baseCurrency))}
          </ListCard>
          {data.items.length === 0 && (
            <div className="ui-card">
              <EmptyState
                text={`Only ${data.baseCurrency} so far.${writable ? " Add a currency to keep money in more than one." : ""}`}
              />
            </div>
          )}
        </>
      )}
      {notice && (
        <Toast
          label="Currency notification"
          durationMs={6000}
          onExpire={() => setNotice("")}
        >
          <p role="status">{notice}</p>
        </Toast>
      )}
      {ledger && data && adding && (
        <AddCurrencySheet
          ledgerId={ledger.id}
          baseCurrency={data.baseCurrency}
          taken={data.items.map((item) => item.code)}
          onDismiss={() => setAdding(false)}
          onSaved={(done) => {
            setAdding(false);
            setNotice(done);
            reload();
          }}
        />
      )}
      {ledger && data && editingCurrency && (
        <RateSheet
          key={`${editingCurrency.code}-${editingCurrency.latestRate?.version ?? 0}`}
          ledgerId={ledger.id}
          baseCurrency={data.baseCurrency}
          currency={editingCurrency}
          onDismiss={() => setEditing(null)}
          onSaved={(done) => {
            setEditing(null);
            setNotice(done);
            reload();
          }}
        />
      )}
    </div>
  );
}

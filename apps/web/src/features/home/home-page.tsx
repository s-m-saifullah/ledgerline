import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { getLedgers } from "../../lib/api";
import { monthLabel, useCurrentMonth } from "../../lib/month";
import { useBaseValues } from "../currencies/base-value";
import { getActiveAccounts, getHome } from "./api";
import "./home.css";
import { currenciesOf } from "./model";
import {
  AccountsColumn,
  type BaseOf,
  HomeHero,
  LatestColumn,
  MonthCard,
  Notes,
} from "./sections";

function Loading() {
  return (
    <div role="status" aria-live="polite">
      <p className="muted">Loading your overview…</p>
      <div className="home-skeleton" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

function FirstAccount({ writable }: { writable: boolean }) {
  return (
    <section className="ui-card home-welcome" aria-labelledby="home-setup">
      <h2 id="home-setup" className="ui-title">
        Add your first account
      </h2>
      <p className="muted">
        {writable
          ? "Start with an account you use today and its balance."
          : "No accounts yet. Ask the ledger owner to add one."}
      </p>
      {writable && (
        <Link to="/accounts" className="ui-btn ui-btn-primary">
          Set up accounts
        </Link>
      )}
    </section>
  );
}

export function HomePage() {
  const month = useCurrentMonth();
  const ledgers = useQuery({ queryKey: ["ledgers"], queryFn: getLedgers });
  const ledger = ledgers.data?.items[0];
  const writable = !!ledger && ledger.role !== "viewer";
  const summary = useQuery({
    queryKey: ["home", ledger?.id, month],
    queryFn: ({ signal }) => getHome(ledger?.id as string, month, signal),
    enabled: !!ledger,
    staleTime: 0,
  });
  const data = summary.data;
  const ready = !!data?.setup.hasActiveAccount;
  // The summary leaves cards and loans out of its account list, so the lists come from the accounts themselves.
  const accounts = useQuery({
    queryKey: ["accounts", ledger?.id, "home"],
    queryFn: ({ signal }) => getActiveAccounts(ledger?.id as string, signal),
    enabled: !!ledger && ready,
  });
  const values = useBaseValues(ledger?.id);
  const baseOf: BaseOf = (money) => {
    const amount = values.baseValue(money);
    return amount === null ? null : { amount, currency: values.baseCurrency };
  };
  const [chosen, setChosen] = useState<string | null>(null);
  const currencies = currenciesOf(accounts.data ?? []);
  // With two or more currencies one is always chosen (the one with most accounts until another is picked).
  const currency =
    currencies.length < 2
      ? null
      : chosen && currencies.includes(chosen)
        ? chosen
        : (currencies[0] ?? null);
  const failed = ledgers.isError || summary.isError;
  return (
    <div className="home">
      <div className="page-heading home-heading">
        <h1>Home</h1>
      </div>
      {failed && (
        <div className="ui-card home-error">
          <p role="alert">
            {data
              ? "Couldn't refresh. Showing the last numbers we loaded."
              : "Couldn't load your overview."}
          </p>
          <button
            type="button"
            className="ui-btn ui-btn-secondary"
            onClick={() => {
              void ledgers.refetch();
              if (ledger) void summary.refetch();
            }}
          >
            Try again
          </button>
        </div>
      )}
      {!data && !failed && <Loading />}
      {ledgers.data && !ledger && (
        <p className="account-error">No ledger is available.</p>
      )}
      {data && !data.setup.hasActiveAccount && (
        <FirstAccount writable={writable} />
      )}
      {data?.setup.hasActiveAccount && (
        <>
          <Notes summary={data} writable={writable} />
          <div className="home-band">
            <HomeHero summary={data} />
            <MonthCard summary={data} label={monthLabel(month)} />
          </div>
          <div className="home-band">
            <AccountsColumn
              summary={data}
              accounts={accounts.data ?? []}
              loading={accounts.isPending}
              failed={accounts.isError}
              retry={() => void accounts.refetch()}
              currencies={currencies}
              currency={currency}
              onCurrency={setChosen}
              baseOf={baseOf}
            />
            <LatestColumn latest={data.latest} writable={writable} />
          </div>
        </>
      )}
    </div>
  );
}

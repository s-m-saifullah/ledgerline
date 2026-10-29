import type { Account, HomeLatest, HomeSummary } from "@ledgerline/shared";
import {
  Avatar,
  EmptyState,
  Hero,
  HeroFigure,
  IconTile,
  ListCard,
  ListHead,
  ListRow,
  ProportionBar,
  SectionLabel,
  SegmentedControl,
  StatusPill,
} from "@ledgerline/ui";
import { Link } from "@tanstack/react-router";
import {
  ArrowLeftRight,
  ChevronRight,
  Clock,
  Coins,
  Shapes,
} from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { Amount, BaseNote } from "../../components/amount-text";
import { NativeSelect } from "../../components/native-select";
import { morePages } from "../shell/nav";
import { useTransactionWorkspace } from "../transactions/workspace";
import {
  accountGroups,
  cashFlow,
  heroFigures,
  isOverdrawn,
  shortDay,
} from "./model";

const typeLabels = {
  bank: "Bank",
  cash: "Cash",
  card: "Card",
  wallet: "Wallet",
  loan: "Loan",
  savings: "Savings",
} as const;

/** A row, hero figure or card that is a router link: the pieces take a `render` function. */
const linkTo =
  (to: string, search?: Record<string, string>) =>
  (inner: ReactNode, className: string): ReactElement => (
    <Link to={to} {...(search ? { search } : {})} className={className}>
      {inner}
    </Link>
  );
/** What an amount in another currency is worth in the base currency, or null (see `useBaseValues`). */
export type BaseOf = (money: Account["balance"]) => Account["balance"] | null;
const iconOf = (to: string) => morePages.find((page) => page.to === to)?.icon;

/** What the owner can do about the page itself: missing rates, pending entries, categories. One row each, never a paragraph. */
export function Notes({
  summary,
  writable,
}: {
  summary: HomeSummary;
  writable: boolean;
}) {
  const missing = summary.unconvertedCurrencies;
  const needsCategories = !summary.setup.hasCategory;
  if (missing.length === 0 && summary.pendingCount === 0 && !needsCategories)
    return null;
  return (
    <ListCard>
      {missing.length > 0 && (
        <ListRow
          lead={
            <IconTile>
              <Coins size={18} />
            </IconTile>
          }
          title={`No exchange rate for ${missing.join(", ")}`}
          hint="Add a rate"
          chevron
          render={linkTo("/currencies")}
        />
      )}
      {summary.pendingCount > 0 && (
        <ListRow
          lead={
            <IconTile>
              <Clock size={18} />
            </IconTile>
          }
          title={
            summary.pendingCount === 1
              ? "1 pending entry"
              : `${summary.pendingCount} pending entries`
          }
          hint="Not counted yet"
          chevron
          render={linkTo("/transactions", { status: "pending" })}
        />
      )}
      {needsCategories &&
        (writable ? (
          <ListRow
            lead={
              <IconTile>
                <Shapes size={18} />
              </IconTile>
            }
            title="Set up categories"
            hint="So every entry can be sorted"
            chevron
            render={linkTo("/categories")}
          />
        ) : (
          <ListRow
            lead={
              <IconTile>
                <Shapes size={18} />
              </IconTile>
            }
            title="Categories haven't been set up yet."
          />
        ))}
    </ListCard>
  );
}

export function HomeHero({ summary }: { summary: HomeSummary }) {
  const figures = heroFigures(
    summary.owed.total,
    summary.loans.lent,
    summary.loans.borrowed,
  );
  return (
    <Hero label="In hand" figure={<Amount cents={summary.inHand.amount} />}>
      {figures.length > 0
        ? figures.map((figure) => {
            const Icon = iconOf(figure.to);
            return (
              <HeroFigure
                key={figure.key}
                label={figure.label}
                value={<Amount cents={figure.amount} />}
                {...(Icon ? { icon: <Icon aria-hidden="true" /> } : {})}
                render={linkTo(figure.to)}
              />
            );
          })
        : undefined}
    </Hero>
  );
}

export function MonthCard({
  summary,
  label,
}: {
  summary: HomeSummary;
  label: string;
}) {
  const flow = cashFlow(summary.moneyIn.amount, summary.moneyOut.amount);
  const percent = Math.round(flow.share * 100);
  return (
    <Link to="/insights" className="ui-card home-month">
      <span className="home-month-head">
        <span className="home-month-title">
          <span className="ui-title">This month</span>
          <span className="ui-row-hint">{label}</span>
        </span>
        <span
          className={
            flow.net > 0 ? "home-month-net home-pos" : "home-month-net"
          }
        >
          <Amount cents={flow.net} plus />
          <ChevronRight size={18} aria-hidden="true" />
        </span>
      </span>
      <span className="home-month-cols">
        <span>
          <span className="ui-row-hint">Money in</span>
          <strong>
            <Amount cents={summary.moneyIn.amount} />
          </strong>
        </span>
        <span>
          <span className="ui-row-hint">Money out</span>
          <strong>
            <Amount cents={summary.moneyOut.amount} />
          </strong>
        </span>
      </span>
      <ProportionBar
        share={flow.share}
        state={flow.state}
        label={`${percent}% of money in went out`}
      />
    </Link>
  );
}

function AccountRow({ account, baseOf }: { account: Account; baseOf: BaseOf }) {
  const base = baseOf(account.balance);
  const overdrawn = isOverdrawn(account);
  return (
    <ListRow
      lead={<Avatar name={account.name} />}
      title={account.name}
      hint={`${typeLabels[account.type]}${overdrawn ? " · Overdrawn" : ""}`}
      value={
        <>
          <span className={overdrawn ? "home-neg" : undefined}>
            <Amount
              cents={account.balance.amount}
              currency={account.balance.currency}
            />
          </span>
          <BaseNote amount={account.balance} baseAmount={base} />
        </>
      }
      chevron
      render={linkTo("/accounts")}
    />
  );
}

/** The currency control: a segmented control for up to four currencies, a select beyond that. */
function CurrencyControl({
  currencies,
  value,
  onChange,
}: {
  currencies: string[];
  value: string;
  onChange: (code: string) => void;
}) {
  if (currencies.length <= 4)
    return (
      <SegmentedControl
        label="Currency"
        options={currencies.map((code) => ({ value: code, label: code }))}
        value={value}
        onChange={onChange}
      />
    );
  return (
    <NativeSelect
      aria-label="Currency"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {currencies.map((code) => (
        <option key={code} value={code}>
          {code}
        </option>
      ))}
    </NativeSelect>
  );
}

export function AccountsColumn({
  summary,
  accounts,
  loading,
  failed,
  retry,
  currencies,
  currency,
  onCurrency,
  baseOf,
}: {
  summary: HomeSummary;
  accounts: Account[];
  loading: boolean;
  failed: boolean;
  retry: () => void;
  currencies: string[];
  currency: string | null;
  onCurrency: (code: string) => void;
  baseOf: BaseOf;
}) {
  const groups = accountGroups(accounts, currency);
  return (
    <section className="ui-stack home-accounts">
      <div className="home-label-row">
        <SectionLabel as="h2" id="home-accounts">
          Accounts
        </SectionLabel>
        {currency && (
          <CurrencyControl
            currencies={currencies}
            value={currency}
            onChange={onCurrency}
          />
        )}
      </div>
      {failed ? (
        <div className="ui-card home-error">
          <p role="alert">Couldn't load your accounts.</p>
          <button
            type="button"
            className="ui-btn ui-btn-secondary"
            onClick={retry}
          >
            Try again
          </button>
        </div>
      ) : loading ? (
        <div className="home-skeleton" aria-hidden="true">
          <span />
          <span />
        </div>
      ) : groups.length === 0 ? (
        <EmptyState text="No accounts yet" />
      ) : (
        <ListCard>
          {groups.map((group) => (
            <div key={group.key} className="home-group">
              <ListHead left={group.title} right={String(group.items.length)} />
              {group.items.map((account) => (
                <AccountRow
                  key={account.id}
                  account={account}
                  baseOf={baseOf}
                />
              ))}
            </div>
          ))}
        </ListCard>
      )}
      {summary.archived.count > 0 && (
        <ListCard>
          <ListRow
            title="Archived accounts"
            hint={`${summary.archived.count} not counted in In hand`}
            chevron
            render={linkTo("/accounts")}
          />
        </ListCard>
      )}
    </section>
  );
}

function latestTitle(row: HomeLatest) {
  const entry = row.transaction;
  if (entry.transferId)
    return `${row.accountName} → ${row.counterpartAccountName ?? "account"}`;
  return (
    entry.payee ||
    (entry.isSplit
      ? "Split transaction"
      : (row.categoryLabel ?? "Category unavailable"))
  );
}
function latestHint(row: HomeLatest) {
  const entry = row.transaction;
  const parts = [shortDay(entry.date)];
  if (entry.transferId) parts.unshift("Transfer");
  else parts.push(row.accountName);
  if (entry.isSplit) parts.push(`Split · ${entry.splits.length} categories`);
  if (entry.receivablePaymentId) parts.push("Service payment");
  if (entry.feeTransferId) parts.push("Transfer fee");
  if (entry.tipPaymentId) parts.push("Tip");
  return parts.join(" · ");
}

function LatestRow({ row }: { row: HomeLatest }) {
  const workspace = useTransactionWorkspace();
  const entry = row.transaction;
  const transfer = !!entry.transferId;
  const income = !transfer && entry.amount.amount > 0;
  const title = latestTitle(row);
  const common = {
    lead: transfer ? (
      <IconTile>
        <ArrowLeftRight size={18} />
      </IconTile>
    ) : (
      <Avatar name={title} />
    ),
    title,
    hint: latestHint(row),
    value: (
      <>
        <span className={income ? "home-pos" : undefined}>
          <Amount
            cents={
              transfer ? Math.abs(entry.amount.amount) : entry.amount.amount
            }
            currency={entry.amount.currency}
            plus={income}
          />
        </span>
        <BaseNote amount={entry.amount} baseAmount={entry.baseAmount} />
        {entry.status === "pending" && (
          <span className="home-pending">
            <StatusPill tone="neutral">Pending</StatusPill>
          </span>
        )}
      </>
    ),
  };
  return workspace ? (
    <ListRow
      {...common}
      disabled={workspace.blocked}
      onClick={() => workspace.openTransaction(entry)}
    />
  ) : (
    <ListRow {...common} render={linkTo("/transactions")} />
  );
}

export function LatestColumn({
  latest,
  writable,
}: {
  latest: HomeSummary["latest"];
  writable: boolean;
}) {
  return (
    <section className="ui-stack" aria-labelledby="home-latest">
      <div className="home-label-row">
        <SectionLabel as="h2" id="home-latest">
          Latest transactions
        </SectionLabel>
        <Link to="/transactions" className="ui-btn ui-btn-text">
          View all
        </Link>
      </div>
      {latest.length === 0 ? (
        <EmptyState
          text={
            writable
              ? "Use Add to record your first entry"
              : "No entries have been recorded yet"
          }
        />
      ) : (
        <ListCard>
          {latest.map((row) => (
            <LatestRow key={row.transaction.id} row={row} />
          ))}
        </ListCard>
      )}
    </section>
  );
}

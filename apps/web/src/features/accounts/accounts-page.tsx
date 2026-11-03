import type { Account, ledgerSchema } from "@ledgerline/shared";
import {
  EmptyState,
  IconTile,
  ListCard,
  RowBody,
  SectionLabel,
} from "@ledgerline/ui";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Banknote,
  ChevronDown,
  CreditCard,
  Landmark,
  PiggyBank,
  Plus,
  Wallet,
} from "lucide-react";
import { useState } from "react";
import type { z } from "zod";
import { Amount, BaseNote } from "../../components/amount-text";
import { LoadError } from "../../components/load-error";
import { Toast } from "../../components/toast";
import { getLedgers } from "../../lib/api";
import { randomUuid } from "../../lib/random-uuid";
import { getCategories } from "../categories/api";
import { useBaseValues } from "../currencies/base-value";
import { usePageAdd } from "../shell/page-add";
import { getAccounts } from "./api";
import { ArchiveAccountDialog } from "./archive";
import { AccountEditor } from "./editor";
import { accountHint, isOverdrawn, splitAccounts } from "./model";
import "./accounts.css";

const icons = {
  bank: Landmark,
  cash: Banknote,
  card: CreditCard,
  wallet: Wallet,
  loan: Landmark,
  savings: PiggyBank,
};
export type AccountIntent =
  | { kind: "edit"; account?: Account }
  | { kind: "archive" | "unarchive" | "delete"; account: Account };
type DialogState = {
  intentId: string;
  open: boolean;
  unconfirmed: boolean;
} & AccountIntent;

export function AccountsPage() {
  const ledgers = useQuery({ queryKey: ["ledgers"], queryFn: getLedgers });
  const ledger = ledgers.data?.items[0];
  if (ledgers.isPending) return <p role="status">Opening your accounts…</p>;
  if (ledgers.isError || !ledger)
    return (
      <div className="ac-page">
        <div className="page-heading">
          <h1 id="accounts-title" tabIndex={-1}>
            Accounts
          </h1>
        </div>
        {ledgers.isError ? (
          <LoadError
            message="Couldn't load your ledger."
            onRetry={() => void ledgers.refetch()}
          />
        ) : (
          <p role="alert">No ledger is available for this session.</p>
        )}
      </div>
    );
  return <LedgerAccounts key={ledger.id} ledger={ledger} />;
}

/**
 * Accounts (ADR 0047, the prototype's `R.accounts`): Cash and banking and Cards and loans as two grouped cards,
 * the archived accounts in a fold, and one sheet per account for everything one can do with it.
 */
function LedgerAccounts({ ledger }: { ledger: z.infer<typeof ledgerSchema> }) {
  const client = useQueryClient();
  const categories = useQuery({
    queryKey: ["categories", ledger.id],
    queryFn: ({ signal }) => getCategories(ledger.id, signal),
  });
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [notice, setNotice] = useState("");
  const writable = ledger.role !== "viewer";
  const values = useBaseValues(ledger.id);
  const accounts = useInfiniteQuery({
    queryKey: ["accounts", ledger.id, "all"],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      getAccounts(ledger.id, "all", pageParam, signal),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchOnMount: "always",
  });
  const everything = accounts.data?.pages.flatMap((page) => page.items) ?? [];
  const { groups, archived } = splitAccounts(everything);
  const count = groups.length + archived.length;
  const locked = !!dialog?.unconfirmed;
  const start = (intent: AccountIntent) => {
    if (dialog?.unconfirmed) {
      setDialog({ ...dialog, open: true });
      return;
    }
    setNotice("");
    setDialog({
      ...intent,
      intentId: randomUuid(),
      open: true,
      unconfirmed: false,
    });
  };
  usePageAdd(
    writable && count > 0
      ? {
          label: "Add account",
          disabled: locked,
          onClick: () => start({ kind: "edit" }),
        }
      : null,
  );
  const dismiss = () =>
    setDialog((current) =>
      current?.unconfirmed ? { ...current, open: false } : null,
    );
  const unconfirmed = (value: boolean) =>
    setDialog((current) =>
      current ? { ...current, unconfirmed: value } : null,
    );
  const saved = () => {
    setNotice(
      dialog?.kind === "delete"
        ? "Account deleted."
        : dialog?.kind === "archive"
          ? "Account archived. Its balance and history are kept."
          : dialog?.kind === "unarchive"
            ? "Account unarchived. It is available for new entries again."
            : dialog?.account
              ? "Account updated."
              : "Account added.",
    );
    setDialog(null);
    void client.invalidateQueries({ queryKey: ["accounts", ledger.id] });
    void client.invalidateQueries({ queryKey: ["home", ledger.id] });
  };
  const row = (account: Account) => {
    const Icon = icons[account.type];
    const base = values.baseValue(account.balance);
    const body = (
      <RowBody
        lead={
          <IconTile>
            <Icon size={20} aria-hidden="true" />
          </IconTile>
        }
        title={account.name}
        hint={accountHint(account)}
        value={
          <>
            <span className={isOverdrawn(account) ? "ac-neg" : undefined}>
              <Amount
                cents={account.balance.amount}
                currency={account.balance.currency}
              />
            </span>
            <BaseNote
              amount={account.balance}
              baseAmount={
                base === null
                  ? null
                  : { amount: base, currency: values.baseCurrency }
              }
            />
          </>
        }
        chevron={writable}
      />
    );
    return writable ? (
      <button
        key={account.id}
        type="button"
        id={`edit-account-${account.id}`}
        className="ui-row ui-row-press ac-row"
        disabled={locked}
        onClick={() => start({ kind: "edit", account })}
      >
        {body}
      </button>
    ) : (
      <div key={account.id} className="ui-row ui-row-static ac-row">
        {body}
      </div>
    );
  };
  return (
    <div className="ac-page">
      <div className="page-heading ac-head">
        <h1 id="accounts-title" tabIndex={-1}>
          Accounts
        </h1>
        {writable && count > 0 && (
          <button
            type="button"
            id="add-account"
            className="ui-btn ui-btn-primary ac-add"
            disabled={locked}
            onClick={() => start({ kind: "edit" })}
          >
            <Plus size={18} aria-hidden="true" />
            Add account
          </button>
        )}
      </div>
      {dialog?.unconfirmed && !dialog.open && (
        <section className="ui-card ac-alert">
          <p>An action needs confirmation.</p>
          <button
            type="button"
            className="ui-btn ui-btn-secondary"
            onClick={() => setDialog({ ...dialog, open: true })}
          >
            Resume action
          </button>
        </section>
      )}
      {!writable && (
        <p className="ac-note">
          You can view accounts in this ledger. Editing is available to owners
          and editors.
        </p>
      )}
      {accounts.isPending && (
        <p className="muted" role="status">
          Loading accounts…
        </p>
      )}
      {accounts.isError && (
        <LoadError
          message="Couldn't load your accounts."
          onRetry={() => void accounts.refetch()}
        />
      )}
      {!accounts.isPending && !accounts.isError && count === 0 && (
        <div className="ui-card ac-empty">
          <EmptyState text="No accounts yet." />
          {writable && (
            <button
              type="button"
              className="ui-btn ui-btn-secondary"
              disabled={locked}
              onClick={() => start({ kind: "edit" })}
            >
              <Plus size={18} aria-hidden="true" />
              Add your first account
            </button>
          )}
        </div>
      )}
      {!accounts.isPending && !accounts.isError && count > 0 && (
        <>
          {groups.length === 0 ? (
            <div className="ui-card">
              <EmptyState text="No active accounts." />
            </div>
          ) : (
            <div className="ac-cols">
              {groups.map((group) => (
                <div key={group.key} className="ac-col">
                  <SectionLabel>{group.title}</SectionLabel>
                  <ListCard>{group.items.map(row)}</ListCard>
                </div>
              ))}
            </div>
          )}
          {archived.length > 0 && (
            <details className="ui-card ac-fold">
              <summary>
                <span>{archived.length} archived</span>
                <ChevronDown size={18} aria-hidden="true" />
              </summary>
              <div className="ac-fold-body">{archived.map(row)}</div>
            </details>
          )}
        </>
      )}
      {accounts.hasNextPage && (
        <button
          type="button"
          className="ui-btn ui-btn-secondary"
          disabled={accounts.isFetchingNextPage}
          onClick={() => void accounts.fetchNextPage()}
        >
          {accounts.isFetchingNextPage ? "Loading…" : "Load more accounts"}
        </button>
      )}
      {notice && (
        <Toast
          label="Account notification"
          durationMs={3000}
          onExpire={() => setNotice("")}
        >
          <p role="status">{notice}</p>
        </Toast>
      )}
      {dialog?.kind === "edit" && (
        <AccountEditor
          key={dialog.intentId}
          ledgerId={ledger.id}
          account={dialog.account}
          open={dialog.open}
          onDismiss={dismiss}
          onUnconfirmed={unconfirmed}
          onSaved={saved}
          onAction={(kind, account) => start({ kind, account })}
          currencies={values.currencies}
          categories={categories.data ?? []}
        />
      )}
      {(dialog?.kind === "archive" ||
        dialog?.kind === "unarchive" ||
        dialog?.kind === "delete") && (
        <ArchiveAccountDialog
          key={dialog.intentId}
          ledgerId={ledger.id}
          account={dialog.account}
          mode={dialog.kind}
          open={dialog.open}
          onDismiss={dismiss}
          onUnconfirmed={unconfirmed}
          onSaved={saved}
        />
      )}
    </div>
  );
}

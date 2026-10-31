import type { Account, ledgerSchema } from "@ledgerline/shared";
import { Button } from "@ledgerline/ui";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Archive,
  ArchiveRestore,
  Banknote,
  ChevronDown,
  CreditCard,
  Landmark,
  PiggyBank,
  Plus,
  Trash2,
  Wallet,
} from "lucide-react";
import { useContext, useState } from "react";
import type { z } from "zod";
import { Amount } from "../../components/amount-text";
import { getLedgers } from "../../lib/api";
import { formatMoney } from "../../lib/money";
import { PrivacyContext } from "../../lib/preferences";
import { randomUuid } from "../../lib/random-uuid";
import { getCategories } from "../categories/api";
import { useBaseValues } from "../currencies/base-value";
import { getAccounts } from "./api";
import { ArchiveAccountDialog } from "./archive";
import { AccountEditor } from "./editor";
import { accountTypes, isLiability } from "./form";

const icons = {
  bank: Landmark,
  cash: Banknote,
  card: CreditCard,
  wallet: Wallet,
  loan: Landmark,
  savings: PiggyBank,
};
type DialogState = { intentId: string; open: boolean; unconfirmed: boolean } & (
  | { kind: "edit"; account?: Account }
  | { kind: "archive" | "unarchive" | "delete"; account: Account }
);

export function AccountsPage() {
  const ledgers = useQuery({ queryKey: ["ledgers"], queryFn: getLedgers });
  const ledger = ledgers.data?.items[0];
  if (ledgers.isPending) return <p role="status">Opening your accounts…</p>;
  if (ledgers.isError || !ledger)
    return (
      <section className="settings-card">
        <h1>Accounts</h1>
        <p role="alert">
          {ledgers.isError
            ? "Couldn't load your ledger."
            : "No ledger is available for this session."}
        </p>
        <button
          type="button"
          className="secondary-button"
          onClick={() => void ledgers.refetch()}
        >
          Try again
        </button>
      </section>
    );
  return <LedgerAccounts key={ledger.id} ledger={ledger} />;
}
function LedgerAccounts({ ledger }: { ledger: z.infer<typeof ledgerSchema> }) {
  const client = useQueryClient();
  const categories = useQuery({
    queryKey: ["categories", ledger.id],
    queryFn: ({ signal }) => getCategories(ledger.id, signal),
  });
  const privateMode = useContext(PrivacyContext);
  const [status, setStatus] = useState<"all" | "active" | "archived">("all");
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [notice, setNotice] = useState("");
  const writable = ledger.role !== "viewer";
  const values = useBaseValues(ledger.id);
  const baseValueOf = values.baseValue;
  const accounts = useInfiniteQuery({
    queryKey: ["accounts", ledger.id, status],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      getAccounts(ledger.id, status, pageParam, signal),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchOnMount: "always",
  });
  // A client's balance account (ADR 0030) is managed from Clients, not listed here.
  const items =
    accounts.data?.pages
      .flatMap((page) => page.items)
      .filter((account) => !account.contactId) ?? [];
  const start = (
    intent:
      | { kind: "edit"; account?: Account }
      | { kind: "archive" | "unarchive" | "delete"; account: Account },
  ) => {
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
  const dismiss = () =>
    setDialog((current) =>
      current?.unconfirmed ? { ...current, open: false } : null,
    );
  const unconfirmed = (value: boolean) =>
    setDialog((current) =>
      current ? { ...current, unconfirmed: value } : null,
    );
  const saved = (account: Account) => {
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
    if (!account.archivedAt && status === "archived") setStatus("all");
    void client.invalidateQueries({ queryKey: ["accounts", ledger.id] });
    void client.invalidateQueries({ queryKey: ["home", ledger.id] });
  };
  return (
    <>
      <div className="page-heading accounts-heading">
        <div>
          <p className="eyebrow">YOUR PERSONAL LEDGER</p>
          <h1 id="accounts-title" tabIndex={-1}>
            Accounts
          </h1>
          <p className="muted">
            The places you keep money, and the balances you owe.
          </p>
        </div>
        {writable &&
          (accounts.isPending ||
            accounts.isError ||
            items.length > 0 ||
            status === "archived") && (
            <Button
              onClick={() => start({ kind: "edit" })}
              disabled={!!dialog?.unconfirmed}
            >
              <Plus size={18} />
              Add account
            </Button>
          )}
      </div>
      {notice && (
        <p className="account-notice" role="status">
          {notice}
        </p>
      )}
      {dialog?.unconfirmed && !dialog.open && (
        <section className="settings-card">
          <h2>An action needs confirmation</h2>
          <p>
            The connection was interrupted. Resume the action to confirm it
            before making another change.
          </p>
          <button
            type="button"
            className="secondary-button"
            onClick={() => setDialog({ ...dialog, open: true })}
          >
            Resume action
          </button>
        </section>
      )}
      {!writable && (
        <p className="muted account-notice">
          You can view accounts in this ledger. Editing is available to owners
          and editors.
        </p>
      )}
      <div className="accounts-toolbar">
        <label htmlFor="account-status">View accounts</label>
        <div className="theme-picker">
          <select
            id="account-status"
            value={status}
            onChange={(event) => setStatus(event.target.value as typeof status)}
          >
            <option value="all">All accounts</option>
            <option value="active">Active accounts</option>
            <option value="archived">Archived accounts</option>
          </select>
          <ChevronDown size={16} aria-hidden="true" />
        </div>
      </div>
      {accounts.isPending && (
        <p role="status" className="settings-card">
          Loading accounts…
        </p>
      )}
      {accounts.isError && (
        <div role="alert" className="settings-card">
          <p>Couldn't load your accounts.</p>
          <button
            type="button"
            className="secondary-button"
            onClick={() => void accounts.refetch()}
          >
            Try again
          </button>
        </div>
      )}
      {!accounts.isPending && !accounts.isError && items.length === 0 && (
        <section className="welcome-card account-empty">
          <div className="small-mark">
            <Wallet size={28} />
          </div>
          <h2>
            {status === "all"
              ? "A place for your money."
              : status === "archived"
                ? "No archived accounts."
                : "No active accounts."}
          </h2>
          <p>
            {status === "all"
              ? "Add your first bank account, wallet, or card. You can add the rest whenever you're ready."
              : status === "archived"
                ? "Accounts you archive stay here with their balances and history."
                : "Choose All accounts to see archived accounts, or add an account you use today."}
          </p>
          {writable && status !== "archived" && (
            <Button
              disabled={!!dialog?.unconfirmed}
              onClick={() => start({ kind: "edit" })}
            >
              <Plus size={18} />
              {status === "all" ? "Add your first account" : "Add account"}
            </Button>
          )}
        </section>
      )}
      <div className="accounts-grid">
        {items.map((account) => {
          const Icon = icons[account.type];
          const debt = isLiability(account.type) && account.balance.amount < 0;
          const label = debt
            ? "Amount owed"
            : isLiability(account.type) && account.balance.amount > 0
              ? "Credit balance"
              : account.balance.amount < 0
                ? "Overdrawn balance"
                : "Balance";
          return (
            <article
              className="account-card"
              key={account.id}
              aria-labelledby={`account-title-${account.id}`}
            >
              <div className="account-card-heading">
                <span className="account-icon">
                  <Icon size={22} />
                </span>
                <div>
                  <h2 id={`account-title-${account.id}`}>{account.name}</h2>
                  <p className="form-help">
                    {accountTypes[account.type]} · {account.currency}
                  </p>
                </div>
                {account.archivedAt && (
                  <span className="account-badge">
                    <Archive size={12} />
                    Archived
                  </span>
                )}
              </div>
              <p className="form-help account-balance-label">{label}</p>
              <p className="account-balance">
                {privateMode ? (
                  <>
                    <span aria-hidden="true">••••</span>
                    <span className="sr-only">Amount hidden</span>
                  </>
                ) : (
                  formatMoney(
                    debt
                      ? Math.abs(account.balance.amount)
                      : account.balance.amount,
                    account.balance.currency,
                  )
                )}
              </p>
              {baseValueOf(account.balance) !== null && (
                <p className="form-help account-base-value">
                  About{" "}
                  <Amount
                    cents={Math.abs(baseValueOf(account.balance) as number)}
                    currency={values.baseCurrency}
                  />{" "}
                  in {values.baseCurrency} at today's rate
                </p>
              )}
              {writable && (
                <div className="account-card-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    aria-label={`Edit ${account.name}`}
                    id={`edit-account-${account.id}`}
                    disabled={!!dialog?.unconfirmed}
                    onClick={() => start({ kind: "edit", account })}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="text-button danger-action"
                    aria-label={`Delete ${account.name}`}
                    disabled={!!dialog?.unconfirmed}
                    onClick={() => start({ kind: "delete", account })}
                  >
                    <Trash2 size={16} aria-hidden="true" />
                    Delete
                  </button>
                  {account.archivedAt ? (
                    <button
                      type="button"
                      className="text-button"
                      aria-label={`Unarchive ${account.name}`}
                      disabled={!!dialog?.unconfirmed}
                      onClick={() => start({ kind: "unarchive", account })}
                    >
                      <ArchiveRestore size={16} aria-hidden="true" />
                      Unarchive
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="text-button"
                      aria-label={`Archive ${account.name}`}
                      disabled={!!dialog?.unconfirmed}
                      onClick={() => start({ kind: "archive", account })}
                    >
                      <Archive size={16} aria-hidden="true" />
                      Archive
                    </button>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>
      {accounts.hasNextPage && (
        <div className="accounts-load-more">
          <button
            type="button"
            className="secondary-button"
            disabled={accounts.isFetchingNextPage}
            onClick={() => void accounts.fetchNextPage()}
          >
            {accounts.isFetchingNextPage ? "Loading…" : "Load more accounts"}
          </button>
        </div>
      )}
      {items.length > 0 && (
        <p className="form-help accounts-note">
          Balances start from the opening amounts you entered. Cleared
          transactions contribute to these balances; pending entries do not.
        </p>
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
    </>
  );
}

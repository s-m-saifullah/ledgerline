import type { LoanPerson } from "@ledgerline/shared";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Archive,
  ArchiveRestore,
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  CircleSlash,
  Pencil,
  type Plus,
} from "lucide-react";
import { useState } from "react";
import { ActionBar, useIsPhone } from "../../components/action-bar";
import { Amount } from "../../components/amount";
import { BackToMore } from "../../components/back-to-more";
import { NativeSelect } from "../../components/native-select";
import { getLedgers } from "../../lib/api";
import { Amount as HomeAmount } from "../home/amount";
import { getHome } from "../home/api";
import { useCurrentMonth } from "../home/month";
import { LoanDialog } from "./loan-dialog";
import { getLoanPeople, getPerson, type LoanAction } from "./loans-api";
import { PersonLoans, useLoans } from "./loans-section";
import { PersonDialog } from "./person-dialog";

/** Each currency's balance for one person, in a short sentence. */
function Summary({ person }: { person: LoanPerson }) {
  if (person.balances.length === 0)
    return <span className="muted">No loans yet</span>;
  const open = person.balances.filter((loan) => loan.balance.amount !== 0);
  if (open.length === 0) return <span className="muted">Settled</span>;
  return (
    <span className="client-balances">
      {open.map((loan) => (
        <span key={loan.accountId}>
          {loan.balance.amount > 0 ? "Owes you " : "You owe "}
          <Amount
            value={Math.abs(loan.balance.amount)}
            currency={loan.balance.currency}
          />
        </span>
      ))}
    </span>
  );
}

/** Money you lend to or borrow from people (ADR 0030); it never counts as income or spending. */
export function LoansPage() {
  const phone = useIsPhone();
  const queryClient = useQueryClient();
  const ledger = useQuery({ queryKey: ["ledgers"], queryFn: getLedgers }).data
    ?.items[0];
  const month = useCurrentMonth();
  const home = useQuery({
    queryKey: ["home", ledger?.id, month],
    queryFn: ({ signal }) => getHome(ledger?.id as string, month, signal),
    enabled: !!ledger,
    staleTime: 0,
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [status, setStatus] = useState("active");
  const [text, setText] = useState("");
  const [dialog, setDialog] = useState<{
    mode: LoanAction;
    adding: boolean;
  } | null>(null);
  const [personAction, setPersonAction] = useState<
    "rename" | "archive" | "unarchive" | null
  >(null);
  const people = useInfiniteQuery({
    queryKey: ["loanPeople", ledger?.id, status, text],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      getLoanPeople(ledger?.id as string, status, text, pageParam, signal),
    getNextPageParam: (page, _pages, _param, params) =>
      page.nextCursor && !params.includes(page.nextCursor)
        ? page.nextCursor
        : undefined,
    enabled: !!ledger,
    refetchOnMount: "always",
  });
  const rows = people.data?.pages.flatMap((page) => page.items) ?? [];
  const person = useQuery({
    queryKey: ["loanPerson", ledger?.id, selected],
    queryFn: () => getPerson(ledger?.id as string, selected as string),
    enabled: !!ledger && !!selected,
    refetchOnMount: "always",
  });
  const loans = useLoans(ledger?.id, selected);
  const loanList = loans.data?.items ?? [];
  const hasOpen = loanList.some((loan) => loan.balance.amount !== 0);
  const writable = !!ledger && ledger.role !== "viewer";
  const refresh = () => {
    for (const key of [
      "loans",
      "loanPeople",
      "loanPerson",
      "accounts",
      "home",
      "transactions",
      "contacts",
    ])
      void queryClient.invalidateQueries({ queryKey: [key] });
  };
  const lent = home.data?.loans.lent.amount ?? 0;
  const borrowed = home.data?.loans.borrowed.amount ?? 0;
  const detail = person.data;
  const archived = !!detail?.archivedAt;
  const action = (
    key: string,
    label: string,
    shortLabel: string,
    icon: typeof Plus,
    run: () => void,
    disabled = archived,
  ) => ({ key, label, shortLabel, icon, disabled, onSelect: run });
  return (
    <>
      <BackToMore />
      <div className="page-heading">
        <p className="eyebrow">MONEY YOU LEND AND BORROW</p>
        <h1 id="loans-title" tabIndex={-1}>
          Loans
        </h1>
        <p className="muted">
          Money lent to or borrowed from friends and family. It never counts as
          income or spending.
        </p>
      </div>
      {!ledger ? (
        <p role="status">Loading your ledger…</p>
      ) : selected ? (
        <>
          <button
            type="button"
            className="secondary-button"
            onClick={() => setSelected(null)}
          >
            All people
          </button>
          {person.isError ? (
            <p role="alert">
              Could not load this person.{" "}
              <button type="button" onClick={() => void person.refetch()}>
                Try again
              </button>
            </p>
          ) : (
            detail && (
              <>
                <section className="settings-card client-detail">
                  <h2>
                    {detail.name}
                    {archived ? " (archived)" : ""}
                  </h2>
                  {writable && (
                    <ActionBar
                      menuLabel={`More actions for ${detail.name}`}
                      menuId="loan-person-menu"
                      primary={
                        hasOpen
                          ? {
                              ...action(
                                "repay",
                                "Record repayment",
                                "Repayment",
                                Banknote,
                                () =>
                                  setDialog({ mode: "repay", adding: false }),
                              ),
                              id: "loan-primary",
                            }
                          : {
                              ...action(
                                "lend",
                                "Lend money",
                                "Lend",
                                ArrowUpRight,
                                () =>
                                  setDialog({ mode: "lend", adding: false }),
                              ),
                              id: "loan-primary",
                            }
                      }
                      actions={[
                        ...(hasOpen
                          ? [
                              action(
                                "lend",
                                "Lend money",
                                "Lend",
                                ArrowUpRight,
                                () =>
                                  setDialog({ mode: "lend", adding: false }),
                              ),
                            ]
                          : []),
                        action(
                          "borrow",
                          "Borrow money",
                          "Borrow",
                          ArrowDownLeft,
                          () => setDialog({ mode: "borrow", adding: false }),
                        ),
                        ...(hasOpen
                          ? [
                              action(
                                "waive",
                                "Waive what is left",
                                "Waive",
                                CircleSlash,
                                () =>
                                  setDialog({ mode: "waive", adding: false }),
                              ),
                            ]
                          : []),
                        action(
                          "rename",
                          "Rename",
                          "Rename",
                          Pencil,
                          () => setPersonAction("rename"),
                          false,
                        ),
                        action(
                          "archive",
                          archived ? "Unarchive" : "Archive",
                          archived ? "Unarchive" : "Archive",
                          archived ? ArchiveRestore : Archive,
                          () =>
                            setPersonAction(archived ? "unarchive" : "archive"),
                          false,
                        ),
                      ]}
                    />
                  )}
                </section>
                {loans.isError ? (
                  <p role="alert">
                    Could not load the balance.{" "}
                    <button type="button" onClick={() => void loans.refetch()}>
                      Try again
                    </button>
                  </p>
                ) : (
                  <PersonLoans
                    ledgerId={ledger.id}
                    personId={detail.id}
                    name={detail.name}
                    loans={loanList}
                  />
                )}
              </>
            )
          )}
        </>
      ) : (
        <>
          {(lent > 0 || borrowed > 0) && (
            <section className="overview-grid" aria-label="Loan totals">
              {lent > 0 && (
                <article className="stat-card">
                  <p>Lent out</p>
                  <div className="amount">
                    <HomeAmount cents={lent} />
                  </div>
                  <span className="muted">Owed back to you</span>
                </article>
              )}
              {borrowed > 0 && (
                <article className="stat-card">
                  <p>You owe</p>
                  <div className="amount">
                    <HomeAmount cents={borrowed} />
                  </div>
                  <span className="muted">Money you borrowed</span>
                </article>
              )}
            </section>
          )}
          <div className="client-toolbar">
            <label>
              Search people
              <input
                type="search"
                value={text}
                maxLength={200}
                onChange={(event) => setText(event.target.value)}
              />
            </label>
            <label htmlFor="loan-status">
              Show
              <NativeSelect
                id="loan-status"
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                <option value="active">Active people</option>
                <option value="archived">Archived people</option>
                <option value="all">Everyone</option>
              </NativeSelect>
            </label>
            {writable && (
              <button
                id="add-loan"
                type="button"
                className="button"
                onClick={() => setDialog({ mode: "lend", adding: true })}
              >
                Add loan
              </button>
            )}
          </div>
          {people.isPending ? (
            <p role="status">Loading people…</p>
          ) : people.isError ? (
            <p role="alert">
              Could not load people.{" "}
              <button type="button" onClick={() => void people.refetch()}>
                Try again
              </button>
            </p>
          ) : (
            <>
              {rows.length === 0 && (
                <section className="settings-card">
                  <h2>{text ? "No matching people" : "Keep track of loans"}</h2>
                  <p>
                    Add a loan to record money you lent, money you borrowed or a
                    loan you already had.
                  </p>
                </section>
              )}
              <div className="client-grid">
                {rows.map((row) => (
                  <button
                    id={`loan-person-${row.id}`}
                    type="button"
                    className="settings-card client-card"
                    key={row.id}
                    onClick={() => setSelected(row.id)}
                  >
                    <strong>
                      {row.name}
                      {row.archivedAt ? " (archived)" : ""}
                    </strong>
                    <Summary person={row} />
                  </button>
                ))}
              </div>
              {people.hasNextPage && (
                <button
                  className="secondary-button"
                  type="button"
                  disabled={people.isFetchingNextPage}
                  onClick={() => void people.fetchNextPage()}
                >
                  Load more people
                </button>
              )}
            </>
          )}
        </>
      )}
      {dialog && ledger && (
        <LoanDialog
          ledgerId={ledger.id}
          person={
            dialog.adding || !detail
              ? null
              : { id: detail.id, name: detail.name }
          }
          people={rows}
          loans={loanList}
          mode={dialog.mode}
          returnFocusId={
            dialog.adding
              ? "add-loan"
              : phone
                ? "loan-person-menu"
                : "loan-primary"
          }
          onClose={() => setDialog(null)}
          onSaved={(personId) => {
            setDialog(null);
            setSelected(personId);
            refresh();
          }}
        />
      )}
      {personAction && detail && ledger && (
        <PersonDialog
          ledgerId={ledger.id}
          person={detail}
          action={personAction}
          returnFocusId={phone ? "loan-person-menu" : "loan-primary"}
          onClose={() => setPersonAction(null)}
          onSaved={() => {
            setPersonAction(null);
            refresh();
          }}
        />
      )}
    </>
  );
}

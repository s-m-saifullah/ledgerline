import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState } from "react";
import { LoadError } from "../../components/load-error";
import { getLedgers } from "../../lib/api";
import { useCurrentMonth } from "../../lib/month";
import { useAppWide } from "../../lib/use-app-width";
import { getHome } from "../home/api";
import { usePageAdd } from "../shell/page-add";
import { LoanDialog } from "./loan-dialog";
import { getAllPeople, getPerson } from "./loans-api";
import { useLoans } from "./loans-section";
import {
  anyArchived,
  type PeopleFilter,
  resolveFilter,
  showsSearch,
  visiblePeople,
} from "./model";
import { PersonDetail, type PersonEditor } from "./person-detail";
import { PersonDialog } from "./person-dialog";
import { PersonList } from "./person-list";
import { RemoveLoanDialog } from "./remove-loan-dialog";
import "./loans.css";

type Open = { editor: PersonEditor | { kind: "add" }; trigger: string };

/**
 * Loans (ADR 0030, ADR 0047, the prototype's `R.loans`): the list and one person beside it from 1100 px, one at
 * a time below. The person is in the address (`/loans/{id}`); on a wide page with none chosen the first one is
 * open. CSS decides which panes show, and the width is read here only to skip fetching a pane nobody sees.
 */
export function LoansPage() {
  const { personId } = useParams({ strict: false }) as { personId?: string };
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const month = useCurrentMonth();
  const wide = useAppWide(1100);
  const ledgers = useQuery({ queryKey: ["ledgers"], queryFn: getLedgers });
  const ledger = ledgers.data?.items[0];
  const writable = !!ledger && ledger.role !== "viewer";
  const home = useQuery({
    queryKey: ["home", ledger?.id, month],
    queryFn: ({ signal }) => getHome(ledger?.id as string, month, signal),
    enabled: !!ledger,
    staleTime: 0,
  });
  const people = useQuery({
    queryKey: ["loanPeople", ledger?.id, "book"],
    queryFn: ({ signal }) => getAllPeople(ledger?.id as string, signal),
    enabled: !!ledger,
    refetchOnMount: "always",
  });
  const [chosen, setChosen] = useState<PeopleFilter | null>(null);
  const [text, setText] = useState("");
  const [open, setOpen] = useState<Open | null>(null);
  const all = people.data ?? [];
  const filter = resolveFilter(chosen, all);
  const search = showsSearch(all);
  const shown = visiblePeople(all, filter, text);
  const selectedId = personId ?? (wide ? shown[0]?.id : undefined);
  const fallback = all.find((row) => row.id === selectedId);
  const person = useQuery({
    queryKey: ["loanPerson", ledger?.id, selectedId],
    queryFn: () => getPerson(ledger?.id as string, selectedId as string),
    enabled: !!ledger && !!selectedId,
    refetchOnMount: "always",
  });
  const loans = useLoans(ledger?.id, selectedId ?? null);
  const loanList = loans.data?.items ?? [];
  const contact = person.data;
  // What the list knows stands in until the person's own answer comes.
  const archivedAt = contact?.archivedAt ?? fallback?.archivedAt ?? null;
  const archived = !!archivedAt;
  const blocked = !!open;
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
  const start = (editor: Open["editor"], trigger: string) =>
    setOpen({ editor, trigger });
  // A phone's one Add button adds what the screen lists: loans on the list, money lent on a person.
  usePageAdd(
    !writable
      ? null
      : personId
        ? {
            label: "Lend money",
            disabled: blocked || !selectedId || archived,
            onClick: () =>
              start({ kind: "loan", mode: "lend" }, "mobile-add-page"),
          }
        : {
            label: "Add loan",
            disabled: blocked,
            onClick: () => start({ kind: "add" }, "mobile-add-page"),
          },
  );
  const editor = open?.editor;
  const trigger = open?.trigger ?? "main-content";
  const name = contact?.name ?? fallback?.name ?? "";
  return (
    <div className="ln-page">
      <div className="page-heading ln-head" data-open={!!personId}>
        <h1 id="loans-title" tabIndex={-1}>
          Loans
        </h1>
        <div className="ln-head-actions">
          <Link to="/loans" className="ui-btn ui-btn-text ln-back">
            All people
          </Link>
          {writable && (
            <button
              type="button"
              id="add-loan"
              className="ui-btn ui-btn-primary ln-add"
              disabled={blocked}
              onClick={() => start({ kind: "add" }, "add-loan")}
            >
              <Plus size={18} aria-hidden="true" />
              Add loan
            </button>
          )}
        </div>
      </div>
      {ledgers.isError ? (
        <LoadError
          message="Couldn't load your ledger."
          onRetry={() => void ledgers.refetch()}
        />
      ) : !ledger ? (
        <p className="muted" role="status">
          Loading your ledger…
        </p>
      ) : people.isError ? (
        <LoadError
          message="Couldn't load people."
          onRetry={() => void people.refetch()}
        />
      ) : !people.data ? (
        <p className="muted" role="status">
          Loading people…
        </p>
      ) : (
        <div className="ln-split" data-open={!!personId}>
          <div className="ln-list">
            <PersonList
              people={all}
              shown={shown}
              filter={filter}
              chips={anyArchived(all)}
              search={search}
              text={text}
              onText={setText}
              onFilter={setChosen}
              selectedId={selectedId}
              lent={home.data?.loans.lent.amount ?? 0}
              borrowed={home.data?.loans.borrowed.amount ?? 0}
            />
          </div>
          <div className="ln-detail">
            {selectedId &&
              (person.isError && !fallback ? (
                <LoadError
                  message="Couldn't load this person."
                  onRetry={() => void person.refetch()}
                />
              ) : !fallback && !contact ? (
                <p className="muted" role="status">
                  Loading person…
                </p>
              ) : !loans.data && !loans.isError ? (
                <p className="muted" role="status">
                  Loading balance…
                </p>
              ) : (
                <PersonDetail
                  key={selectedId}
                  ledgerId={ledger.id}
                  person={{
                    id: selectedId,
                    name,
                    archivedAt,
                  }}
                  loans={loanList}
                  loansError={loans.isError}
                  onRetryLoans={() => void loans.refetch()}
                  writable={writable}
                  busy={blocked}
                  onOpen={start}
                />
              ))}
          </div>
        </div>
      )}
      {ledger && editor?.kind === "add" && (
        <LoanDialog
          ledgerId={ledger.id}
          person={null}
          people={all}
          mode="lend"
          returnFocusId={trigger}
          onClose={() => setOpen(null)}
          onSaved={(id) => {
            setOpen(null);
            void navigate({ to: "/loans/$personId", params: { personId: id } });
            refresh();
          }}
        />
      )}
      {ledger && selectedId && editor?.kind === "loan" && (
        <LoanDialog
          ledgerId={ledger.id}
          person={{ id: selectedId, name }}
          loans={loanList}
          mode={editor.mode}
          editCurrency={editor.editCurrency}
          returnFocusId={trigger}
          onClose={() => setOpen(null)}
          onSaved={(id) => {
            setOpen(null);
            void navigate({ to: "/loans/$personId", params: { personId: id } });
            refresh();
          }}
        />
      )}
      {ledger && contact && editor?.kind === "person" && (
        <PersonDialog
          ledgerId={ledger.id}
          person={contact}
          action={editor.action}
          returnFocusId={trigger}
          onClose={() => setOpen(null)}
          onSaved={() => {
            setOpen(null);
            refresh();
          }}
        />
      )}
      {ledger && selectedId && editor?.kind === "remove" && (
        <RemoveLoanDialog
          ledgerId={ledger.id}
          person={{ id: selectedId, name }}
          loan={editor.loan}
          returnFocusId="main-content"
          onClose={() => setOpen(null)}
          onRemoved={() => {
            setOpen(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

import type { LoanBalance } from "@ledgerline/shared";
import { IconTile, ListCard } from "@ledgerline/ui";
import {
  Archive,
  ArchiveRestore,
  ArrowDownLeft,
  ArrowUpRight,
  CircleAlert,
  EllipsisVertical,
  HandCoins,
  Pencil,
} from "lucide-react";
import { useState } from "react";
import { Amount } from "../../components/amount-text";
import { LoadError } from "../../components/load-error";
import { Overlay } from "../../components/overlay";
import type { LoanAction } from "./loans-api";
import { PersonLoans } from "./loans-section";
import { cardLabel, openLoans } from "./model";

export type PersonEditor =
  | { kind: "loan"; mode: LoanAction; editCurrency?: string }
  | { kind: "person"; action: "rename" | "archive" | "unarchive" }
  | { kind: "remove"; loan: LoanBalance };

type Detail = { id: string; name: string; archived: boolean };

/** Lend, borrow, waive, rename and archive, in a sheet behind the card's menu button (the prototype's `OV["person-actions"]`). */
function PersonMenu({
  person,
  hasOpen,
  onClose,
  onPick,
}: {
  person: Detail;
  hasOpen: boolean;
  onClose: () => void;
  onPick: (editor: PersonEditor, trigger: string) => void;
}) {
  const row = (icon: React.ReactNode, title: string, editor: PersonEditor) => (
    <button
      type="button"
      className="ui-row ui-row-press"
      onClick={() => {
        onClose();
        onPick(editor, "loan-person-menu");
      }}
    >
      <IconTile>{icon}</IconTile>
      <span className="ui-row-main">
        <span className="ui-row-title">{title}</span>
      </span>
    </button>
  );
  const icon = (Icon: typeof Pencil) => <Icon size={20} aria-hidden="true" />;
  return (
    <Overlay
      open
      title={person.name}
      busy={false}
      onDismiss={onClose}
      returnFocusId="loan-person-menu"
      fallbackFocusId="main-content"
    >
      <ListCard>
        {!person.archived && hasOpen
          ? row(icon(ArrowUpRight), "Lend money", {
              kind: "loan",
              mode: "lend",
            })
          : null}
        {!person.archived &&
          row(icon(ArrowDownLeft), "Borrow money", {
            kind: "loan",
            mode: "borrow",
          })}
        {!person.archived && hasOpen
          ? row(icon(CircleAlert), "Waive what is left", {
              kind: "loan",
              mode: "waive",
            })
          : null}
        {row(icon(Pencil), "Rename", { kind: "person", action: "rename" })}
        {row(
          icon(person.archived ? ArchiveRestore : Archive),
          person.archived ? "Unarchive" : "Archive",
          {
            kind: "person",
            action: person.archived ? "unarchive" : "archive",
          },
        )}
      </ListCard>
    </Overlay>
  );
}

/**
 * One person (the prototype's `personDetail`): the card with what is owed, the one primary action and the
 * menu, then Balance, Before Ledgerline and Activity. An archived person has only Rename and Unarchive.
 */
export function PersonDetail({
  ledgerId,
  person,
  loans,
  loansError,
  onRetryLoans,
  writable,
  busy,
  onOpen,
}: {
  ledgerId: string;
  person: { id: string; name: string; archivedAt: string | null };
  loans: LoanBalance[];
  loansError: boolean;
  onRetryLoans: () => void;
  writable: boolean;
  /** An editor is open, so the buttons wait. */
  busy: boolean;
  onOpen: (editor: PersonEditor, trigger: string) => void;
}) {
  const [menu, setMenu] = useState(false);
  const archived = !!person.archivedAt;
  const open = openLoans(loans);
  const hasOpen = open.length > 0;
  const detail: Detail = { id: person.id, name: person.name, archived };
  return (
    <>
      <section className="ui-card ln-card" aria-label={person.name}>
        <div className="ln-card-top">
          <h2 className="ln-name">
            {person.name}
            {archived ? " (archived)" : ""}
          </h2>
          {writable && (
            <button
              type="button"
              id="loan-person-menu"
              className="ui-icon-btn ln-menu"
              aria-label={`More actions for ${person.name}`}
              disabled={busy}
              onClick={() => setMenu(true)}
            >
              <EllipsisVertical size={20} aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="ln-card-main">
          <p className="ln-label">{archived ? "Archived" : cardLabel(loans)}</p>
          <p className="ln-figure">
            {open.length === 0 ? (
              <Amount cents={0} />
            ) : (
              open.map((loan) => (
                <span key={loan.accountId} className="ln-amount">
                  <Amount
                    cents={Math.abs(loan.balance.amount)}
                    currency={loan.balance.currency}
                  />
                </span>
              ))
            )}
          </p>
        </div>
        {writable && !archived && (
          <div className="ln-card-actions">
            <button
              type="button"
              id="loan-primary"
              className="ui-btn ui-btn-primary"
              disabled={busy}
              onClick={() =>
                onOpen(
                  { kind: "loan", mode: hasOpen ? "repay" : "lend" },
                  "loan-primary",
                )
              }
            >
              {hasOpen ? (
                <HandCoins size={18} aria-hidden="true" />
              ) : (
                <ArrowUpRight size={18} aria-hidden="true" />
              )}
              {hasOpen ? "Record repayment" : "Lend money"}
            </button>
          </div>
        )}
      </section>
      {loansError ? (
        <LoadError
          message="Couldn't load the balance."
          onRetry={onRetryLoans}
        />
      ) : (
        <PersonLoans
          ledgerId={ledgerId}
          personId={person.id}
          name={person.name}
          loans={loans}
          writable={writable}
          onRemove={(loan) =>
            onOpen({ kind: "remove", loan }, `loan-remove-${loan.currency}`)
          }
          onEdit={(editCurrency) =>
            onOpen(
              { kind: "loan", mode: "opening", editCurrency },
              `loan-edit-${editCurrency}`,
            )
          }
        />
      )}
      {menu && (
        <PersonMenu
          person={detail}
          hasOpen={hasOpen}
          onClose={() => setMenu(false)}
          onPick={onOpen}
        />
      )}
    </>
  );
}

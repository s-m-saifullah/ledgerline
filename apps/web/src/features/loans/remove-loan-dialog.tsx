import type { LoanBalance } from "@ledgerline/shared";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { EditorDialog } from "../../components/editor-dialog";
import { ApiError } from "../../lib/api";
import { getTransactions } from "../transactions/api";
import { prepareRemoveLoan } from "./loans-api";

const shown = 50;

/**
 * Remove one currency's loan of a person. It is only allowed when nothing but the starting
 * balance is left: otherwise the dates of the entries still using it are listed, so they can be
 * deleted first from Transactions.
 */
export function RemoveLoanDialog({
  ledgerId,
  person,
  loan,
  returnFocusId,
  onClose,
  onRemoved,
}: {
  ledgerId: string;
  person: { id: string; name: string };
  loan: LoanBalance;
  returnFocusId: string;
  onClose: () => void;
  onRemoved: () => void;
}) {
  const entries = useQuery({
    queryKey: ["loans", ledgerId, person.id, "remove-check", loan.accountId],
    queryFn: ({ signal }) =>
      getTransactions(ledgerId, { accountId: loan.accountId }, null, signal),
    refetchOnMount: "always",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const attempt = useRef<ReturnType<typeof prepareRemoveLoan> | null>(null);
  const items = entries.data?.items ?? [];
  const blocked = items.length > 0;
  const submit = async () => {
    setError("");
    attempt.current ??= prepareRemoveLoan(ledgerId, person.id, loan);
    setBusy(true);
    try {
      await attempt.current();
      attempt.current = null;
      onRemoved();
    } catch (failure) {
      if (failure instanceof ApiError && failure.status < 500) {
        attempt.current = null;
        setError(failure.message);
      } else setError("We couldn't remove that. Please try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <EditorDialog
      open
      title={`Remove the ${loan.currency} loan`}
      description={
        blocked
          ? `This loan with ${person.name} cannot be removed yet.`
          : `This removes the ${loan.currency} balance with ${person.name}, including the balance from before Ledgerline. Nothing changes in any of your accounts.`
      }
      busy={busy}
      onDismiss={onClose}
      returnFocusId={returnFocusId}
      closeLabel="Close dialog"
      fallbackFocusId="main-content"
    >
      <form
        className="account-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!blocked && entries.isSuccess) void submit();
        }}
      >
        {entries.isPending && <p className="muted">Checking this loan…</p>}
        {entries.isError && (
          <p role="alert" className="field-error">
            We couldn't check this loan. Close this and try again.
          </p>
        )}
        {blocked && (
          <>
            <p>
              Entries still use this loan. Delete them in Transactions first,
              then remove the loan. They are dated:
            </p>
            <ul className="client-rows" aria-label="Entries using this loan">
              {items.slice(0, shown).map((entry) => (
                <li key={entry.id} className="loan-row">
                  <span>{entry.date}</span>
                </li>
              ))}
            </ul>
            {(items.length > shown || entries.data?.nextCursor) && (
              <p className="muted">and more.</p>
            )}
          </>
        )}
        {error && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={onClose}
          >
            {blocked ? "Close" : "Keep loan"}
          </button>
          {!blocked && (
            <button
              type="submit"
              className="button danger-action"
              disabled={busy || !entries.isSuccess}
            >
              {busy ? "Removing…" : "Remove loan"}
            </button>
          )}
        </div>
      </form>
    </EditorDialog>
  );
}

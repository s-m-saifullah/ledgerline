import type { LoanBalance } from "@ledgerline/shared";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Loading } from "../../components/loading";
import { Overlay } from "../../components/overlay";
import { ApiError } from "../../lib/api";
import { getTransactions } from "../transactions/api";
import { prepareRemoveLoan } from "./loans-api";
import "./loans.css";

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
    <Overlay
      open
      kind="question"
      title={
        blocked
          ? `The ${loan.currency} loan cannot be removed yet`
          : `Remove the ${loan.currency} loan?`
      }
      busy={busy}
      onDismiss={onClose}
      cancelLabel={blocked ? "Close" : "Keep loan"}
      returnFocusId={returnFocusId}
      fallbackFocusId="main-content"
      footer={
        blocked ? undefined : (
          <button
            type="button"
            className="ui-btn ui-btn-danger-filled"
            disabled={busy || !entries.isSuccess}
            onClick={() => void submit()}
          >
            {busy ? "Removing…" : "Remove loan"}
          </button>
        )
      }
    >
      {entries.isPending && <Loading what="this loan" />}
      {entries.isError && (
        <p role="alert" className="field-error">
          We couldn't check this loan. Close this and try again.
        </p>
      )}
      {!blocked && entries.isSuccess && (
        <p>
          Removes the balance with {person.name}, including the one from before
          Ledgerline. No account changes.
        </p>
      )}
      {blocked && (
        <>
          <p>
            Entries still use it. Delete them in Transactions first. They are
            dated:
          </p>
          <ul className="ln-dates" aria-label="Entries using this loan">
            {items.slice(0, shown).map((entry) => (
              <li key={entry.id}>{entry.date}</li>
            ))}
          </ul>
          {(items.length > shown || entries.data?.nextCursor) && (
            <p className="ln-note">and more.</p>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
    </Overlay>
  );
}

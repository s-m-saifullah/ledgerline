import { IconTile, ListRow } from "@ledgerline/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore } from "lucide-react";
import { useRef, useState } from "react";
import { Question, TypedConfirm } from "../../components/question";
import { ApiError, getLedgers } from "../../lib/api";
import {
  daysLeft,
  daysLeftText,
  undoDays,
  undoEndsAt,
} from "../../lib/days-left";
import { prepareClearLedger, prepareRestoreLedger } from "../ledger/api";

type Asking = "clear" | "restore";

/**
 * The rows of "Your data" that start a ledger afresh (ADR 0049; the prototype's `R.settings` with `OV["ledger-clear"]`
 * and `OV["ledger-unclear"]`): Clear ledger in red (type CLEAR) and, while an undo waits, Restore cleared ledger with
 * its days left. Only the owner sees them. After either one the whole app reads its data again, because every list on
 * screen is now out of date.
 */
export function ClearLedger({
  onNotice,
}: {
  onNotice: (text: string) => void;
}) {
  const client = useQueryClient();
  const ledgers = useQuery({ queryKey: ["ledgers"], queryFn: getLedgers });
  const ledger = ledgers.data?.items[0];
  const [asking, setAsking] = useState<Asking | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // One key per press: a lost answer is tried again with the same key, so the server never does it twice.
  const attempt = useRef<{ kind: Asking; run: () => Promise<unknown> } | null>(
    null,
  );
  if (ledger?.role !== "owner") return null;
  const close = () => {
    attempt.current = null;
    setAsking(null);
    setTyped("");
    setError("");
  };
  const submit = async (kind: Asking) => {
    if (attempt.current?.kind !== kind)
      attempt.current = {
        kind,
        run:
          kind === "clear"
            ? prepareClearLedger(ledger)
            : prepareRestoreLedger(ledger),
      };
    setBusy(true);
    setError("");
    try {
      await attempt.current.run();
    } catch (problem) {
      if (problem instanceof ApiError && problem.status < 500) {
        attempt.current = null;
        setError(problem.message);
      } else {
        // The change may have gone through: say so, never "it failed".
        setError("We couldn't confirm that. Please try again.");
      }
      setBusy(false);
      return;
    }
    setBusy(false);
    close();
    // Everything on screen came from the ledger as it was: read it all again.
    void client.invalidateQueries();
    onNotice(kind === "clear" ? "Ledger cleared." : "Ledger restored.");
  };
  const waiting = ledger.clearedAt ?? null;
  return (
    <>
      {waiting && (
        <ListRow
          lead={
            <IconTile>
              <ArchiveRestore size={18} />
            </IconTile>
          }
          title="Restore cleared ledger"
          hint={daysLeftText(daysLeft(undoEndsAt(waiting)))}
          onClick={() => setAsking("restore")}
        />
      )}
      <button
        type="button"
        id="clear-ledger"
        className="ui-row ui-row-press"
        onClick={() => setAsking("clear")}
      >
        <IconTile>
          <Archive size={18} />
        </IconTile>
        <span className="ui-row-main">
          <span className="ui-row-title set-danger">Clear ledger</span>
          <span className="ui-row-hint">Undo for {undoDays} days</span>
        </span>
      </button>
      <Question
        open={asking === "clear"}
        title="Clear your ledger?"
        text={`Your accounts, entries and budgets leave the app so you can start fresh. You can undo this for ${undoDays} days.`}
        confirm="Clear"
        danger
        busy={busy}
        error={error}
        disabled={typed.trim().toUpperCase() !== "CLEAR"}
        returnFocusId="clear-ledger"
        fallbackFocusId="settings-title"
        onDismiss={close}
        onConfirm={() => void submit("clear")}
      >
        <TypedConfirm
          id="clear-ledger-word"
          label="Type CLEAR to confirm"
          placeholder="CLEAR"
          value={typed}
          busy={busy}
          onChange={setTyped}
        />
      </Question>
      <Question
        open={asking === "restore"}
        title="Restore your cleared ledger?"
        text="Everything comes back as it was. This works only while your ledger is empty."
        confirm="Restore"
        busy={busy}
        error={error}
        returnFocusId="clear-ledger"
        fallbackFocusId="settings-title"
        onDismiss={close}
        onConfirm={() => void submit("restore")}
      />
    </>
  );
}

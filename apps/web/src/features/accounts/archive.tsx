import type { Account } from "@ledgerline/shared";
import { useRef, useState } from "react";
import { Overlay } from "../../components/overlay";
import { ApiError } from "../../lib/api";
import {
  getAccount,
  prepareAccountArchive,
  prepareAccountDelete,
  prepareAccountUnarchive,
} from "./api";

export function ArchiveAccountDialog({
  ledgerId,
  account,
  open,
  onDismiss,
  onUnconfirmed,
  onSaved,
  mode = "archive",
}: {
  mode?: "archive" | "delete" | "unarchive";
  ledgerId: string;
  account: Account;
  open: boolean;
  onDismiss: () => void;
  onUnconfirmed: (value: boolean) => void;
  onSaved: (account: Account) => void;
}) {
  const [baseline, setBaseline] = useState(account);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const attempt = useRef<(() => Promise<Account>) | null>(null);
  const save = async () => {
    if (inFlight.current || conflict) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    if (!attempt.current) {
      if (mode === "delete") {
        const run = prepareAccountDelete(ledgerId, baseline);
        attempt.current = async () => {
          await run();
          return baseline;
        };
      } else if (mode === "unarchive")
        attempt.current = prepareAccountUnarchive(ledgerId, baseline);
      else attempt.current = prepareAccountArchive(ledgerId, baseline);
    }
    let archived: Account;
    try {
      archived = await attempt.current();
    } catch (failure) {
      if (!(failure instanceof ApiError) || failure.status >= 500) {
        setUncertain(true);
        onUnconfirmed(true);
        setError(
          `We couldn't confirm the ${mode === "delete" ? "deletion" : mode === "unarchive" ? "unarchive" : "archive"}. Retry to confirm the same action.`,
        );
      } else {
        attempt.current = null;
        setUncertain(false);
        onUnconfirmed(false);
        if (failure.status === 409) {
          setConflict(true);
          setError(
            mode === "delete"
              ? failure.message +
                  " Reload its latest details before trying again."
              : `This account changed. Reload its latest details before ${mode === "unarchive" ? "unarchiving" : "archiving"}.`,
          );
        } else setError(failure.message);
      }
      return;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
    onUnconfirmed(false);
    onSaved(archived);
  };
  const reload = async () => {
    setBusy(true);
    try {
      const latest = await getAccount(ledgerId, baseline.id);
      if (
        (latest.archivedAt && mode === "archive") ||
        (!latest.archivedAt && mode === "unarchive")
      ) {
        onUnconfirmed(false);
        onSaved(latest);
      } else {
        setBaseline(latest);
        setConflict(false);
        setError("");
        attempt.current = null;
      }
    } catch {
      setError("Couldn't reload this account. Please try again.");
    } finally {
      setBusy(false);
    }
  };
  const name = baseline.name;
  return (
    <Overlay
      open={open}
      kind="question"
      title={
        mode === "delete"
          ? `Delete ${name}?`
          : mode === "unarchive"
            ? `Unarchive ${name}?`
            : `Archive ${name}?`
      }
      busy={busy}
      onDismiss={onDismiss}
      cancelLabel={uncertain ? "Close for now" : "Cancel"}
      returnFocusId={`edit-account-${baseline.id}`}
      fallbackFocusId="accounts-title"
      footer={
        conflict ? (
          <button
            type="button"
            className="ui-btn ui-btn-primary"
            disabled={busy}
            onClick={() => void reload()}
          >
            Reload latest details
          </button>
        ) : (
          <button
            type="button"
            className={
              mode === "delete"
                ? "ui-btn ui-btn-danger-filled"
                : "ui-btn ui-btn-primary"
            }
            disabled={busy}
            onClick={() => void save()}
          >
            {busy
              ? "Saving…"
              : uncertain
                ? "Retry action"
                : mode === "delete"
                  ? "Delete"
                  : mode === "unarchive"
                    ? "Unarchive"
                    : "Archive"}
          </button>
        )
      }
    >
      <p>
        {mode === "delete"
          ? "Delete its connected transactions first. This removes its opening balance from your ledger totals. A deleted account has no Undo; archive it to keep it instead."
          : mode === "unarchive"
            ? "It returns to your active accounts and new-entry pickers; its balance and history are unchanged."
            : "Its balance and history stay in your ledger, and it moves out of your active accounts."}
      </p>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </Overlay>
  );
}

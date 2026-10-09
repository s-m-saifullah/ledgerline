import type { Account } from "@ledgerline/shared";
import { Button } from "@ledgerline/ui";
import { useRef, useState } from "react";
import { ApiError } from "../../lib/api";
import {
  getAccount,
  prepareAccountArchive,
  prepareAccountDelete,
  prepareAccountUnarchive,
} from "./api";
import { AccountDialog } from "./dialog";

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
  return (
    <AccountDialog
      open={open}
      title={
        mode === "delete"
          ? "Delete account?"
          : mode === "unarchive"
            ? "Unarchive account?"
            : "Archive account?"
      }
      description={
        mode === "delete"
          ? `Delete ${baseline.name}? Delete its connected transactions first. This removes its opening balance from your ledger totals. Deleted transactions cannot be restored while this account is deleted. This account has no Undo; archive it to keep it instead.`
          : mode === "unarchive"
            ? `Unarchive ${baseline.name}. It returns to your active accounts and new-entry pickers; its balance and history are unchanged.`
            : `Archive ${baseline.name}. Its balance and history stay in your ledger, and it moves out of your active accounts.`
      }
      busy={busy}
      onDismiss={onDismiss}
      returnFocusId={`edit-account-${baseline.id}`}
    >
      {error && (
        <p className="field-error account-error" role="alert">
          {error}
        </p>
      )}
      <div className="account-dialog-actions">
        <button
          type="button"
          className="secondary-button"
          disabled={busy}
          onClick={onDismiss}
        >
          {uncertain ? "Close for now" : "Keep account"}
        </button>
        {conflict ? (
          <Button disabled={busy} onClick={() => void reload()}>
            Reload latest details
          </Button>
        ) : (
          <Button
            className={mode === "delete" ? "danger-action" : undefined}
            disabled={busy}
            onClick={() => void save()}
          >
            {busy
              ? mode === "delete"
                ? "Deleting…"
                : mode === "unarchive"
                  ? "Unarchiving…"
                  : "Archiving…"
              : uncertain
                ? mode === "delete"
                  ? "Retry delete"
                  : mode === "unarchive"
                    ? "Retry unarchive"
                    : "Retry archive"
                : mode === "delete"
                  ? "Delete account"
                  : mode === "unarchive"
                    ? "Unarchive account"
                    : "Archive account"}
          </Button>
        )}
      </div>
    </AccountDialog>
  );
}

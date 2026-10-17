import { useRef, useState } from "react";
import { EditorDialog } from "../../components/editor-dialog";
import { ApiError } from "../../lib/api";
import { preparePersonChange } from "./loans-api";

type Person = {
  id: string;
  name: string;
  version: number;
  phone: string | null;
  email: string | null;
  note: string | null;
};

/** Rename a person, or archive or unarchive them (their balances and history are kept). */
export function PersonDialog({
  ledgerId,
  person,
  action,
  returnFocusId,
  onClose,
  onSaved,
}: {
  ledgerId: string;
  person: Person;
  action: "rename" | "archive" | "unarchive";
  returnFocusId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(person.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const attempt = useRef<{
    sig: string;
    run: ReturnType<typeof preparePersonChange>;
  } | null>(null);
  const submit = async () => {
    setError("");
    if (action === "rename" && !name.trim()) {
      setError("Enter the person's name.");
      return;
    }
    const change =
      action === "rename"
        ? {
            action,
            name: name.trim(),
            phone: person.phone,
            email: person.email,
            note: person.note,
          }
        : { action };
    const sig = JSON.stringify(change);
    if (attempt.current?.sig !== sig)
      attempt.current = {
        sig,
        run: preparePersonChange(ledgerId, person, change),
      };
    setBusy(true);
    try {
      await attempt.current.run();
      attempt.current = null;
      onSaved();
    } catch (failure) {
      if (failure instanceof ApiError && failure.status < 500) {
        attempt.current = null;
        setError(failure.message);
      } else setError("We couldn't save that. Please try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <EditorDialog
      open
      title={
        action === "rename"
          ? "Rename"
          : action === "archive"
            ? `Archive ${person.name}`
            : `Unarchive ${person.name}`
      }
      description={
        action === "rename"
          ? "The name also changes on their balance account."
          : action === "archive"
            ? "Their balances and history are kept. You cannot lend or borrow until you unarchive them."
            : "You can lend and borrow again."
      }
      busy={busy}
      onDismiss={onClose}
      returnFocusId={returnFocusId}
      closeLabel="Close dialog"
      fallbackFocusId="main-content"
      initialFocusId={action === "rename" ? "person-name" : undefined}
    >
      <form
        className="account-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {action === "rename" && (
          <fieldset disabled={busy} className="client-fields">
            <label className="form-field" htmlFor="person-name">
              Name
              <input
                id="person-name"
                value={name}
                maxLength={100}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
          </fieldset>
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
            Close
          </button>
          <button type="submit" className="button" disabled={busy}>
            {busy
              ? "Saving…"
              : action === "rename"
                ? "Save name"
                : action === "archive"
                  ? "Archive"
                  : "Unarchive"}
          </button>
        </div>
      </form>
    </EditorDialog>
  );
}

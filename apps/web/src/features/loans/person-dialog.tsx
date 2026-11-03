import { useRef, useState } from "react";
import { Overlay } from "../../components/overlay";
import { ApiError } from "../../lib/api";
import { preparePersonChange } from "./loans-api";
import "./loans.css";

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
  const rename = action === "rename";
  const word = action === "archive" ? "Archive" : "Unarchive";
  return (
    <Overlay
      open
      kind={rename ? "sheet" : "question"}
      title={rename ? "Rename" : `${word} ${person.name}?`}
      busy={busy}
      onDismiss={onClose}
      returnFocusId={returnFocusId}
      fallbackFocusId="main-content"
      initialFocusId={rename ? "person-name" : undefined}
      footer={
        <button
          type={rename ? "submit" : "button"}
          {...(rename
            ? { form: "person-form" }
            : { onClick: () => void submit() })}
          className="ui-btn ui-btn-primary"
          disabled={busy}
        >
          {busy ? "Saving…" : rename ? "Save name" : word}
        </button>
      }
    >
      <form
        id="person-form"
        className="ln-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {rename ? (
          <>
            <fieldset disabled={busy} className="ln-fields">
              <div className="ln-field">
                <label htmlFor="person-name">Name</label>
                <input
                  id="person-name"
                  value={name}
                  maxLength={100}
                  placeholder="Name"
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
            </fieldset>
            <p className="ln-note">
              The name also changes on their balance account.
            </p>
          </>
        ) : (
          <p>
            {action === "archive"
              ? "Balances and history are kept. No new loans until you unarchive."
              : "You can lend and borrow again."}
          </p>
        )}
        {error && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}
      </form>
    </Overlay>
  );
}

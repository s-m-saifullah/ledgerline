import type { Me } from "@ledgerline/shared";
import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Overlay } from "../../components/overlay";
import { ApiError } from "../../lib/api";
import { meKey, renameMe } from "./api";
import { nameMessage, parseName } from "./model";

/**
 * The name sheet (the prototype's `OV["name-form"]`): one field and Save. The email is read only (the server checks
 * the admin's at start and no mail exists to confirm a new one). A rename is safe to repeat, so a lost answer is
 * simply tried again.
 */
export function NameSheet({
  me,
  onDismiss,
  onSaved,
}: {
  me: Me;
  onDismiss: () => void;
  /** Called with the sentence that says what happened, once the server has the new name. */
  onSaved: (notice: string) => void;
}) {
  const client = useQueryClient();
  const [name, setName] = useState(me.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = parseName(name);
    if (!parsed) {
      setError(nameMessage);
      return;
    }
    setBusy(true);
    setError("");
    try {
      client.setQueryData(meKey, await renameMe(parsed));
      // The sidebar reads the name from the session.
      await client.invalidateQueries({ queryKey: ["session"] });
    } catch (problem) {
      setError(
        problem instanceof ApiError && problem.status < 500
          ? problem.message
          : "We couldn't save that. Please try again.",
      );
      setBusy(false);
      return;
    }
    setBusy(false);
    onSaved("Name saved.");
  };
  return (
    <Overlay
      open
      title="Your name"
      description="Shown in the sidebar and on this page. Your email cannot be changed here."
      busy={busy}
      onDismiss={onDismiss}
      returnFocusId="profile-account"
      fallbackFocusId="profile-title"
      initialFocusId="profile-name"
      footer={
        <button
          type="submit"
          form="profile-name-form"
          className="ui-btn ui-btn-primary"
          disabled={busy}
        >
          {busy ? "Saving…" : "Save"}
        </button>
      }
    >
      <form
        id="profile-name-form"
        className="pf-form"
        noValidate
        onSubmit={submit}
      >
        <div className="pf-field">
          <label htmlFor="profile-name">Name</label>
          <input
            id="profile-name"
            value={name}
            maxLength={100}
            autoComplete="name"
            placeholder="Name"
            disabled={busy}
            aria-invalid={error ? "true" : undefined}
            aria-describedby={error ? "profile-name-error" : undefined}
            onChange={(event) => {
              setName(event.target.value);
              setError("");
            }}
          />
        </div>
        {error && (
          <p id="profile-name-error" role="alert" className="field-error">
            {error}
          </p>
        )}
      </form>
    </Overlay>
  );
}

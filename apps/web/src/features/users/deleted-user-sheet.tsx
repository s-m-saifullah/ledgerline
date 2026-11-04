import type { DeletedUser } from "@ledgerline/shared";
import { ListCard, ListRow } from "@ledgerline/ui";
import { useState } from "react";
import { Overlay } from "../../components/overlay";
import { Question, TypedConfirm } from "../../components/question";
import { daysLeft, daysLeftText } from "../../lib/days-left";
import { purgeUser, restoreUser } from "./api";
import { deleteConfirmed, firstName } from "./model";
import { usePersonAction } from "./use-person-action";

/**
 * The sheet of a person in Recently deleted (the prototype's `OV["user-deleted"]` and `OV["user-purge"]`): Restore
 * brings them back exactly as they were, at once; Delete now (red) asks the admin to type their email, then removes
 * them and everything of theirs for good. The question names how long old backups keep the data (ADR 0049).
 */
export function DeletedUserSheet({
  person,
  onDismiss,
  onSaved,
}: {
  person: DeletedUser;
  onDismiss: () => void;
  onSaved: (notice: string) => void;
}) {
  const first = firstName(person.name);
  const [asking, setAsking] = useState(false);
  const [typed, setTyped] = useState("");
  const { busy, error, setError, run } = usePersonAction(
    "They are no longer in Recently deleted.",
    onSaved,
  );
  const close = () => {
    setAsking(false);
    setTyped("");
    setError("");
  };
  return (
    <>
      <Overlay
        open
        title={person.name}
        description="Bring this person back, or remove them for good."
        busy={busy}
        onDismiss={onDismiss}
        returnFocusId={`user-${person.id}`}
        fallbackFocusId="users-title"
      >
        <div className="us-form">
          <ListCard>
            <ListRow
              title="Restore"
              hint={`${daysLeftText(daysLeft(person.purgeAt))} to restore`}
              disabled={busy}
              onClick={() =>
                void run(
                  () => restoreUser(person.id),
                  `${first} is back, as they were.`,
                )
              }
            />
          </ListCard>
          <ListCard>
            <button
              type="button"
              id={`user-purge-${person.id}`}
              className="ui-row ui-row-press"
              disabled={busy}
              onClick={() => setAsking(true)}
            >
              <span className="ui-row-main">
                <span className="ui-row-title us-danger">Delete now</span>
              </span>
            </button>
          </ListCard>
          {error && !asking && (
            <p role="alert" className="field-error">
              {error}
            </p>
          )}
        </div>
      </Overlay>
      <Question
        open={asking}
        title={`Delete ${first} now?`}
        text="They and everything of theirs are removed for good, and the email can be used again. Backups keep it 7 days on the server and 90 days off-site."
        confirm="Delete now"
        danger
        busy={busy}
        error={error}
        returnFocusId="users-title"
        fallbackFocusId="users-title"
        disabled={!deleteConfirmed(person.email, typed)}
        onDismiss={close}
        onConfirm={() =>
          void run(() => purgeUser(person.id), "Deleted for good.")
        }
      >
        <TypedConfirm
          id="user-purge-email"
          label="Type their email to confirm"
          placeholder={person.email}
          value={typed}
          busy={busy}
          onChange={setTyped}
        />
      </Question>
    </>
  );
}

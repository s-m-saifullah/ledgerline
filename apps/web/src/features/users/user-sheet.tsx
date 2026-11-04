import type { ManagedUser } from "@ledgerline/shared";
import { ListCard, ListRow } from "@ledgerline/ui";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { Overlay } from "../../components/overlay";
import { Question, TypedConfirm } from "../../components/question";
import {
  daysLeft,
  daysLeftText,
  undoDays,
  undoEndsAt,
} from "../../lib/days-left";
import {
  clearUserLedger,
  deleteUser,
  resetUserPassword,
  restoreUserLedger,
  setUserDisabled,
  signOutUser,
  turnOffUserTwoFactor,
} from "./api";
import { deleteConfirmed, firstName, makeTemporaryPassword } from "./model";
import { PasswordBox } from "./password-box";
import { usePersonAction } from "./use-person-action";

type Asking =
  | "twoFactor"
  | "signOut"
  | "disable"
  | "delete"
  | "clear"
  | "unclear";

/**
 * One sheet per person (the prototype's `OV["user-actions"]` and the dialogs that follow it): Reset password
 * (which swaps the content of the same sheet to a new temporary password), Turn off two-factor when it is on, Sign out
 * their devices, Stop sign-in or Allow it again, then the ledger group (Clear their ledger in red and, while an undo
 * waits, Restore cleared ledger with its days left; ADR 0049), and Delete user in red. Each of those but Allow asks
 * first in a centred question; Clear and Delete ask the admin to type the person's email. The admin only ever sees
 * a date here, never anything from the ledger.
 */
export function UserSheet({
  person,
  onDismiss,
  onSaved,
}: {
  person: ManagedUser;
  onDismiss: () => void;
  onSaved: (notice: string) => void;
}) {
  const first = firstName(person.name);
  const [password, setPassword] = useState<string | null>(null);
  const [asking, setAsking] = useState<Asking | null>(null);
  const [typed, setTyped] = useState("");
  const { busy, error, setError, run } = usePersonAction(
    "They are no longer on this server.",
    onSaved,
  );
  const close = () => {
    setAsking(null);
    setTyped("");
    setError("");
  };
  const returnFocusId = `user-${person.id}`;
  return (
    <>
      <Overlay
        open
        title={password === null ? person.name : "New temporary password"}
        description={
          password === null
            ? "What you can do with this person's account."
            : "Give them this password. They choose their own at their next sign-in."
        }
        busy={busy}
        onDismiss={onDismiss}
        returnFocusId={returnFocusId}
        fallbackFocusId="users-title"
        footer={
          password === null ? undefined : (
            <button
              type="button"
              className="ui-btn ui-btn-primary"
              disabled={busy}
              onClick={() =>
                void run(
                  () => resetUserPassword(person.id, password),
                  `Password reset for ${first}.`,
                )
              }
            >
              {busy ? "Resetting…" : "Reset password"}
            </button>
          )
        }
      >
        {password === null ? (
          <div className="us-form">
            <ListCard>
              <ListRow
                title="Reset password"
                {...(person.mustChangePassword
                  ? { hint: "Still on a temporary password" }
                  : {})}
                chevron
                disabled={busy}
                onClick={() => {
                  setError("");
                  setPassword(makeTemporaryPassword());
                }}
              />
              {person.twoFactorEnabled && (
                <ListRow
                  title="Turn off two-factor"
                  chevron
                  disabled={busy}
                  onClick={() => setAsking("twoFactor")}
                />
              )}
              <ListRow
                title="Sign out their devices"
                chevron
                disabled={busy}
                onClick={() => setAsking("signOut")}
              />
              {person.disabled ? (
                <ListRow
                  title="Allow sign-in again"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () => setUserDisabled(person.id, false),
                      `${first} can sign in again.`,
                    )
                  }
                />
              ) : (
                <ListRow
                  title="Stop sign-in"
                  hint="Their ledger stays as it is"
                  chevron
                  disabled={busy}
                  onClick={() => setAsking("disable")}
                />
              )}
            </ListCard>
            <ListCard>
              {person.ledgerClearedAt && (
                <ListRow
                  title="Restore cleared ledger"
                  hint={daysLeftText(
                    daysLeft(undoEndsAt(person.ledgerClearedAt)),
                  )}
                  chevron
                  disabled={busy}
                  onClick={() => setAsking("unclear")}
                />
              )}
              <button
                type="button"
                id={`user-clear-${person.id}`}
                className="ui-row ui-row-press"
                disabled={busy}
                onClick={() => setAsking("clear")}
              >
                <span className="ui-row-main">
                  <span className="ui-row-title us-danger">
                    Clear their ledger
                  </span>
                  <span className="ui-row-hint">Undo for {undoDays} days</span>
                </span>
                <span className="ui-row-chevron" aria-hidden="true">
                  <ChevronRight size={18} />
                </span>
              </button>
            </ListCard>
            <ListCard>
              <button
                type="button"
                id={`user-delete-${person.id}`}
                className="ui-row ui-row-press"
                disabled={busy}
                onClick={() => setAsking("delete")}
              >
                <span className="ui-row-main">
                  <span className="ui-row-title us-danger">Delete user</span>
                </span>
              </button>
            </ListCard>
            {error && !asking && (
              <p role="alert" className="field-error">
                {error}
              </p>
            )}
          </div>
        ) : (
          <div className="us-form">
            <PasswordBox
              password={password}
              disabled={busy}
              onNew={() => setPassword(makeTemporaryPassword())}
            />
            <p className="us-note">
              They are signed out and choose a new password at their next
              sign-in.
            </p>
            {error && (
              <p role="alert" className="field-error">
                {error}
              </p>
            )}
          </div>
        )}
      </Overlay>
      <Question
        open={asking === "twoFactor"}
        title={`Turn off two-factor for ${first}?`}
        text="They sign in with only their password until they turn it on again."
        confirm="Turn off"
        busy={busy}
        error={error}
        returnFocusId="users-title"
        fallbackFocusId="users-title"
        onDismiss={close}
        onConfirm={() =>
          void run(
            () => turnOffUserTwoFactor(person.id),
            "Two-factor turned off.",
          )
        }
      />
      <Question
        open={asking === "signOut"}
        title={`Sign out ${first}'s devices?`}
        text="They will need to sign in again."
        confirm="Sign out"
        busy={busy}
        error={error}
        returnFocusId="users-title"
        fallbackFocusId="users-title"
        onDismiss={close}
        onConfirm={() =>
          void run(() => signOutUser(person.id), "Signed them out.")
        }
      />
      <Question
        open={asking === "disable"}
        title={`Stop ${first} signing in?`}
        text="They are signed out and cannot sign in until you allow it again. Their ledger is not changed."
        confirm="Stop sign-in"
        busy={busy}
        error={error}
        returnFocusId="users-title"
        fallbackFocusId="users-title"
        onDismiss={close}
        onConfirm={() =>
          void run(
            () => setUserDisabled(person.id, true),
            `${first} can no longer sign in.`,
          )
        }
      />
      <Question
        open={asking === "clear"}
        title={`Clear ${first}'s ledger?`}
        text={`Their accounts, entries and budgets leave the app so they can start fresh. You can undo this for ${undoDays} days.`}
        confirm="Clear"
        danger
        busy={busy}
        error={error}
        returnFocusId="users-title"
        fallbackFocusId="users-title"
        disabled={!deleteConfirmed(person.email, typed)}
        onDismiss={close}
        onConfirm={() =>
          void run(() => clearUserLedger(person.id), "Ledger cleared.")
        }
      >
        <TypedConfirm
          id="user-clear-email"
          label="Type their email to confirm"
          placeholder={person.email}
          value={typed}
          busy={busy}
          onChange={setTyped}
        />
      </Question>
      <Question
        open={asking === "unclear"}
        title={`Restore ${first}'s ledger?`}
        text="Everything comes back as it was. This works only while their ledger is empty."
        confirm="Restore"
        busy={busy}
        error={error}
        returnFocusId="users-title"
        fallbackFocusId="users-title"
        onDismiss={close}
        onConfirm={() =>
          void run(() => restoreUserLedger(person.id), "Ledger restored.")
        }
      />
      <Question
        open={asking === "delete"}
        title={`Delete ${first} and their ledger?`}
        text={`They cannot sign in. You can restore them for ${undoDays} days, then everything is removed for good.`}
        confirm="Delete"
        danger
        busy={busy}
        error={error}
        returnFocusId="users-title"
        fallbackFocusId="users-title"
        disabled={!deleteConfirmed(person.email, typed)}
        onDismiss={close}
        onConfirm={() => void run(() => deleteUser(person.id), "User deleted.")}
      >
        <TypedConfirm
          id="user-delete-email"
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

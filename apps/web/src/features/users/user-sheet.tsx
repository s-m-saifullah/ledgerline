import type { ManagedUser } from "@ledgerline/shared";
import { ListCard, ListRow } from "@ledgerline/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Overlay } from "../../components/overlay";
import { ApiError } from "../../lib/api";
import {
  deleteUser,
  resetUserPassword,
  setUserDisabled,
  signOutUser,
  turnOffUserTwoFactor,
  usersKey,
} from "./api";
import { deleteConfirmed, firstName, makeTemporaryPassword } from "./model";
import { PasswordBox } from "./password-box";

type Asking = "twoFactor" | "signOut" | "disable" | "delete";

/**
 * One sheet per person (the prototype's `OV["user-actions"]` and the dialogs that follow it): Reset password
 * (which swaps the content of the same sheet to a new temporary password), Turn off two-factor when it is on, Sign out
 * their devices, Stop sign-in or Allow it again, and Delete user in red. Each of those but Allow asks first in a
 * centred question; Delete asks the admin to type the person's email. Nothing here is about money.
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
  const client = useQueryClient();
  const first = firstName(person.name);
  const [password, setPassword] = useState<string | null>(null);
  const [asking, setAsking] = useState<Asking | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (action: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (problem) {
      if (problem instanceof ApiError && problem.status === 404) {
        setError("They are no longer on this server.");
        void client.invalidateQueries({ queryKey: usersKey });
      } else if (problem instanceof ApiError && problem.status < 500) {
        setError(problem.message);
      } else {
        // The change may have gone through: say so, never "it failed".
        setError("We couldn't confirm that. Please try again.");
      }
      setBusy(false);
      return;
    }
    setBusy(false);
    onSaved(done);
  };
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
        onDismiss={close}
        onConfirm={() =>
          void run(
            () => setUserDisabled(person.id, true),
            `${first} can no longer sign in.`,
          )
        }
      />
      <Question
        open={asking === "delete"}
        title={`Delete ${first} and their ledger?`}
        text="Their accounts, entries and settings leave the app. Old backups still hold them."
        confirm="Delete"
        danger
        busy={busy}
        error={error}
        disabled={!deleteConfirmed(person.email, typed)}
        onDismiss={close}
        onConfirm={() => void run(() => deleteUser(person.id), "User deleted.")}
      >
        <div className="us-field">
          <label htmlFor="user-delete-email">Type their email to confirm</label>
          <input
            id="user-delete-email"
            value={typed}
            placeholder={person.email}
            autoComplete="off"
            disabled={busy}
            onChange={(event) => setTyped(event.target.value)}
          />
        </div>
      </Question>
    </>
  );
}

/** A centred question over the sheet: Cancel beside one confirming button; the server's refusal shows inside it. */
function Question({
  open,
  title,
  text,
  confirm,
  danger,
  disabled,
  busy,
  error,
  onDismiss,
  onConfirm,
  children,
}: {
  open: boolean;
  title: string;
  text: string;
  confirm: string;
  danger?: boolean;
  disabled?: boolean;
  busy: boolean;
  error: string;
  onDismiss: () => void;
  onConfirm: () => void;
  children?: React.ReactNode;
}) {
  return (
    <Overlay
      kind="question"
      open={open}
      title={title}
      busy={busy}
      onDismiss={onDismiss}
      returnFocusId="users-title"
      fallbackFocusId="users-title"
      footer={
        <button
          type="button"
          className={`ui-btn ${danger ? "ui-btn-danger-filled" : "ui-btn-primary"}`}
          disabled={busy || disabled}
          onClick={onConfirm}
        >
          {busy ? "Working…" : confirm}
        </button>
      }
    >
      <p>{text}</p>
      {children}
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
    </Overlay>
  );
}

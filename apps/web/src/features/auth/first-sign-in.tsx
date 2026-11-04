import { KeyRound } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { changePassword } from "../profile/api";
import {
  checkPasswords,
  type PasswordField,
  passwordProblem,
} from "../profile/model";
import { AuthMark } from "./sign-in";
import "./auth.css";

const rows: {
  field: PasswordField;
  id: string;
  label: string;
  autoComplete: string;
  placeholder?: string;
}[] = [
  {
    field: "currentPassword",
    id: "first-temporary",
    label: "Temporary password",
    autoComplete: "current-password",
  },
  {
    field: "newPassword",
    id: "first-new",
    label: "New password",
    autoComplete: "new-password",
    // Short, so it is not cut off beside the label at 320 px.
    placeholder: "12+ characters",
  },
  {
    field: "repeat",
    id: "first-confirm",
    label: "Confirm New",
    autoComplete: "new-password",
  },
];

/**
 * The first sign-in with a temporary password (ADR 0048, the prototype's `R["change-password"]`): no shell, one
 * centred card, and nothing else reachable until the password is changed. The server enforces it; this card is what
 * it asks for. **One departure from the prototype, approved by the owner:** a first row for the temporary password,
 * because the server needs the current password to change it and a reload forgets whatever the sign-in form held.
 * Saving goes on to the app; Sign out is the one other way off the card.
 */
export function FirstSignIn({
  onSaved,
  onSignOut,
}: {
  /** Called once the new password is saved: the app reads who I am again and goes Home. */
  onSaved: () => Promise<void>;
  onSignOut: () => Promise<void>;
}) {
  const [values, setValues] = useState({
    currentPassword: "",
    newPassword: "",
    repeat: "",
  });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{
    field: PasswordField | null;
    message: string;
  } | null>(null);
  const inputs = useRef<Partial<Record<PasswordField, HTMLInputElement>>>({});
  useEffect(() => {
    document.title = "New password · Ledgerline";
    inputs.current.currentPassword?.focus();
  }, []);
  // A mistake sends the focus to the row that has it.
  useEffect(() => {
    if (problem?.field) inputs.current[problem.field]?.focus();
  }, [problem]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const found = checkPasswords(values);
    if (found) {
      setProblem(
        found.field === "currentPassword"
          ? {
              field: found.field,
              message: "Enter the temporary password you were given.",
            }
          : found,
      );
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      await changePassword({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
        signOutOtherDevices: true,
      });
    } catch (error) {
      setProblem(passwordProblem(error));
      setBusy(false);
      return;
    }
    // The password is saved; if reading who I am fails, the next page load shows the app anyway.
    await onSaved().catch(() => undefined);
    setBusy(false);
  };
  const signOut = async () => {
    setProblem(null);
    try {
      await api("/auth/sign-out", { method: "POST", body: "{}" });
      await onSignOut();
    } catch {
      setProblem({
        field: null,
        message: "Couldn't sign out. Please try again.",
      });
    }
  };
  return (
    <main className="au-page" aria-labelledby="first-sign-in-title">
      <div className="au-box">
        <div className="au-head">
          <AuthMark>
            <KeyRound size={24} />
          </AuthMark>
          <h1 id="first-sign-in-title">Choose a new password</h1>
        </div>
        <p className="sr-only">
          Your password was set by the admin. Choose your own to continue.
        </p>
        <form className="au-form" onSubmit={submit} noValidate>
          <div className="au-card">
            {rows.map(({ field, id, label, autoComplete, placeholder }) => (
              <div key={field} className="au-block">
                <div className="au-row">
                  <label htmlFor={id}>{label}</label>
                  <input
                    id={id}
                    ref={(node) => {
                      if (node) inputs.current[field] = node;
                    }}
                    type="password"
                    autoComplete={autoComplete}
                    placeholder={placeholder}
                    value={values[field]}
                    disabled={busy}
                    aria-invalid={problem?.field === field ? "true" : undefined}
                    aria-describedby={
                      problem?.field === field ? `${id}-error` : undefined
                    }
                    onChange={(event) => {
                      setValues({ ...values, [field]: event.target.value });
                      setProblem(null);
                    }}
                  />
                </div>
                {problem?.field === field && (
                  <p
                    id={`${id}-error`}
                    role="alert"
                    className="field-error au-err"
                  >
                    {problem.message}
                  </p>
                )}
              </div>
            ))}
          </div>
          {problem && problem.field === null && (
            <p role="alert" className="field-error">
              {problem.message}
            </p>
          )}
          <button
            type="submit"
            className="ui-btn ui-btn-primary"
            disabled={busy}
          >
            {busy ? "Saving…" : "Save and continue"}
          </button>
        </form>
        <div className="au-links">
          <button
            type="button"
            className="ui-btn ui-btn-text"
            disabled={busy}
            onClick={() => void signOut()}
          >
            Sign out
          </button>
        </div>
      </div>
    </main>
  );
}

import { createUserSchema } from "@ledgerline/shared";
import { SectionLabel } from "@ledgerline/ui";
import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Overlay } from "../../components/overlay";
import { ApiError } from "../../lib/api";
import { addUser, usersKey } from "./api";
import { firstName, makeTemporaryPassword } from "./model";
import { PasswordBox } from "./password-box";

type Field = "name" | "email";

/**
 * Add user (the prototype's `OV["add-user"]`): a name, an email and a temporary password made in the browser. The
 * password is shown only here, sent once and never returned; it lives in this sheet's state and is gone when the
 * sheet closes (ADR 0048). A lost answer is never called a failure: the list is read again, and a second try that
 * finds the email taken says what to do instead.
 */
export function AddUserSheet({
  onDismiss,
  onSaved,
}: {
  onDismiss: () => void;
  onSaved: (notice: string) => void;
}) {
  const client = useQueryClient();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState(makeTemporaryPassword);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{
    field: Field | null;
    message: string;
  } | null>(null);
  const inputs = useRef<Partial<Record<Field, HTMLInputElement>>>({});
  // A mistake sends the focus to the row that has it.
  useEffect(() => {
    if (problem?.field) inputs.current[problem.field]?.focus();
  }, [problem]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = createUserSchema.safeParse({
      name,
      // An email field already drops the spaces around what was typed.
      email,
      temporaryPassword: password,
    });
    if (!parsed.success) {
      const field = parsed.error.issues[0]?.path[0];
      setProblem(
        field === "email"
          ? { field: "email", message: "Enter a valid email address." }
          : { field: "name", message: "Enter their name." },
      );
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      await addUser(parsed.data);
    } catch (error) {
      if (error instanceof ApiError && error.status < 500) {
        setProblem({
          field: error.status === 409 ? "email" : null,
          message: error.message,
        });
      } else {
        // The person may have been added: read the list again and say so, never "it failed".
        setProblem({
          field: null,
          message: "We couldn't confirm that. Check the list, then try again.",
        });
        void client.invalidateQueries({ queryKey: usersKey });
      }
      setBusy(false);
      return;
    }
    setBusy(false);
    onSaved(
      `${firstName(parsed.data.name)} can sign in. They set their own password first.`,
    );
  };
  const rows: {
    field: Field;
    id: string;
    label: string;
    value: string;
    set: (value: string) => void;
    type: string;
    placeholder: string;
    autoComplete: string;
  }[] = [
    {
      field: "name",
      id: "user-name",
      label: "Name",
      value: name,
      set: setName,
      type: "text",
      placeholder: "Full name",
      autoComplete: "off",
    },
    {
      field: "email",
      id: "user-email",
      label: "Email",
      value: email,
      set: setEmail,
      type: "email",
      placeholder: "name@example.com",
      autoComplete: "off",
    },
  ];
  return (
    <Overlay
      open
      title="Add user"
      description="Add a person with their own account and their own ledger."
      busy={busy}
      onDismiss={onDismiss}
      returnFocusId="add-user"
      fallbackFocusId="users-title"
      footer={
        <button
          type="submit"
          form="add-user-form"
          className="ui-btn ui-btn-primary"
          disabled={busy}
        >
          {busy ? "Adding…" : "Add user"}
        </button>
      }
    >
      <form id="add-user-form" className="us-form" noValidate onSubmit={submit}>
        <div className="ui-card us-group">
          {rows.map(
            ({
              field,
              id,
              label,
              value,
              set,
              type,
              placeholder,
              autoComplete,
            }) => (
              <div key={field} className="us-input-row">
                <label htmlFor={id}>{label}</label>
                <input
                  id={id}
                  ref={(node) => {
                    if (node) inputs.current[field] = node;
                  }}
                  type={type}
                  value={value}
                  placeholder={placeholder}
                  autoComplete={autoComplete}
                  disabled={busy}
                  aria-invalid={problem?.field === field ? "true" : undefined}
                  aria-describedby={
                    problem?.field === field ? "add-user-error" : undefined
                  }
                  onChange={(event) => {
                    set(event.target.value);
                    setProblem(null);
                  }}
                />
              </div>
            ),
          )}
        </div>
        {problem && (
          <p id="add-user-error" role="alert" className="field-error">
            {problem.message}
          </p>
        )}
        <p className="us-note">They start with their own empty ledger.</p>
        <div className="us-sect">
          <SectionLabel>Temporary password</SectionLabel>
          <PasswordBox
            password={password}
            disabled={busy}
            onNew={() => setPassword(makeTemporaryPassword())}
          />
        </div>
        <p className="us-note">They choose their own at first sign-in.</p>
      </form>
    </Overlay>
  );
}

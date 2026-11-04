import { SwitchRow } from "@ledgerline/ui";
import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Overlay } from "../../components/overlay";
import { devicesKey } from "../settings/devices-api";
import { changePassword } from "./api";
import { checkPasswords, type PasswordField, passwordProblem } from "./model";

const rows: {
  field: PasswordField;
  id: string;
  label: string;
  autoComplete: string;
  placeholder?: string;
}[] = [
  {
    field: "currentPassword",
    id: "profile-current",
    label: "Current",
    autoComplete: "current-password",
  },
  {
    field: "newPassword",
    id: "profile-new",
    label: "New",
    autoComplete: "new-password",
    placeholder: "12 characters or more",
  },
  {
    field: "repeat",
    id: "profile-repeat",
    label: "Repeat it",
    autoComplete: "new-password",
  },
];

/**
 * The change-password sheet (the prototype's `OV["change-password"]`): the current password, the new one twice and a
 * switch that signs out my other devices, on by default (the Android app uses the same sign-in). The page checks what
 * it can; the server's answers land on their own rows. Nothing typed is kept anywhere but in the fields.
 */
export function PasswordSheet({
  onDismiss,
  onSaved,
}: {
  onDismiss: () => void;
  onSaved: (notice: string) => void;
}) {
  const client = useQueryClient();
  const [values, setValues] = useState({
    currentPassword: "",
    newPassword: "",
    repeat: "",
  });
  const [others, setOthers] = useState(true);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{
    field: PasswordField | null;
    message: string;
  } | null>(null);
  const inputs = useRef<Partial<Record<PasswordField, HTMLInputElement>>>({});
  // A mistake sends the focus to the row that has it.
  useEffect(() => {
    if (problem?.field) inputs.current[problem.field]?.focus();
  }, [problem]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const found = checkPasswords(values);
    if (found) {
      setProblem(found);
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      await changePassword({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
        signOutOtherDevices: others,
      });
    } catch (error) {
      setProblem(passwordProblem(error));
      setBusy(false);
      return;
    }
    // Other devices may have been signed out: the devices count on this page reads again.
    await client.invalidateQueries({ queryKey: devicesKey });
    setBusy(false);
    onSaved("Password changed.");
  };
  return (
    <Overlay
      open
      title="Change password"
      description="Choose a password of 12 characters or more."
      busy={busy}
      onDismiss={onDismiss}
      returnFocusId="profile-password"
      fallbackFocusId="profile-title"
      initialFocusId="profile-current"
      footer={
        <button
          type="submit"
          form="profile-password-form"
          className="ui-btn ui-btn-primary"
          disabled={busy}
        >
          {busy ? "Saving…" : "Save password"}
        </button>
      }
    >
      <form
        id="profile-password-form"
        className="pf-form"
        noValidate
        onSubmit={submit}
      >
        <div className="ui-card pf-group">
          {rows.map(({ field, id, label, autoComplete, placeholder }) => (
            <div key={field} className="pf-input-row">
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
                  problem?.field === field
                    ? "profile-password-error"
                    : undefined
                }
                onChange={(event) => {
                  setValues({ ...values, [field]: event.target.value });
                  setProblem(null);
                }}
              />
            </div>
          ))}
        </div>
        {problem && (
          <p id="profile-password-error" role="alert" className="field-error">
            {problem.message}
          </p>
        )}
        <div className="ui-card pf-group">
          <SwitchRow
            title="Sign out my other devices"
            checked={others}
            disabled={busy}
            onChange={setOthers}
          />
        </div>
      </form>
    </Overlay>
  );
}

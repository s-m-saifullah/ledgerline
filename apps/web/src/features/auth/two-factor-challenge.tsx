import { ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AuthMark } from "./sign-in";
import {
  twoFactorMessage,
  verifyBackupCode,
  verifyCode,
} from "./two-factor-api";

/**
 * The sign-in step after the password for someone who turned two-factor on (ADR 0038; the prototype's `R["2fa"]`):
 * the same card with a shield, one code row and Continue, then two plain text buttons. The 6-digit code is large
 * and centred; a backup code is a plain text field.
 */
export function TwoFactorChallenge({
  onSuccess,
  onBack,
}: {
  onSuccess: () => Promise<void>;
  onBack: () => void;
}) {
  const [useBackup, setUseBackup] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: refocus when the kind of code changes
  useEffect(() => field.current?.focus(), [useBackup]);
  const submit = async () => {
    const value = code.replace(/\s+/g, "");
    if (!value) return setError("Enter the code.");
    setBusy(true);
    setError("");
    try {
      await (useBackup ? verifyBackupCode(value) : verifyCode(value));
      await onSuccess();
    } catch (failure) {
      setError(twoFactorMessage(failure, useBackup ? "backup" : "code"));
      setBusy(false);
    }
  };
  return (
    <>
      <div className="au-head">
        <AuthMark>
          <ShieldCheck size={24} />
        </AuthMark>
        <h1 id="sign-in-title">Two-factor code</h1>
      </div>
      <p className="sr-only">
        {useBackup
          ? "Enter one of your backup codes."
          : "Enter the 6-digit code from your authenticator app."}
      </p>
      <form
        className="au-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="au-card">
          <div className="au-block">
            <div className="au-row">
              <label htmlFor="two-factor-code">
                {useBackup ? "Backup code" : "6-digit code"}
              </label>
              <input
                id="two-factor-code"
                ref={field}
                className={useBackup ? undefined : "au-code"}
                value={code}
                onChange={(event) => setCode(event.target.value)}
                autoComplete="one-time-code"
                inputMode={useBackup ? "text" : "numeric"}
                autoCapitalize="none"
                spellCheck={false}
                {...(useBackup ? {} : { placeholder: "000000" })}
                aria-invalid={!!error}
                aria-describedby={error ? "two-factor-error" : undefined}
              />
            </div>
          </div>
        </div>
        {error && (
          <p role="alert" className="field-error" id="two-factor-error">
            {error}
          </p>
        )}
        <button type="submit" className="ui-btn ui-btn-primary" disabled={busy}>
          {busy ? "Checking…" : "Continue"}
        </button>
      </form>
      <div className="au-links">
        <button
          type="button"
          className="ui-btn ui-btn-text"
          onClick={() => {
            setUseBackup(!useBackup);
            setCode("");
            setError("");
          }}
        >
          {useBackup ? "Use my authenticator app" : "Use a backup code instead"}
        </button>
        <button type="button" className="ui-btn ui-btn-text" onClick={onBack}>
          Back to sign in
        </button>
      </div>
    </>
  );
}

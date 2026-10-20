import { Button } from "@ledgerline/ui";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  twoFactorMessage,
  verifyBackupCode,
  verifyCode,
} from "./two-factor-api";

/** The sign-in step after the password for someone who turned two-factor on (ADR 0038). */
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
      <div className="small-mark">
        <ShieldCheck size={24} />
      </div>
      <h2 id="sign-in-title">Two-factor code</h2>
      <p className="muted">
        {useBackup
          ? "Enter one of your backup codes."
          : "Enter the 6-digit code from your authenticator app."}
      </p>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label htmlFor="two-factor-code">
          {useBackup ? "Backup code" : "6-digit code"}
        </label>
        <input
          id="two-factor-code"
          ref={field}
          value={code}
          onChange={(event) => setCode(event.target.value)}
          autoComplete="one-time-code"
          inputMode={useBackup ? "text" : "numeric"}
          autoCapitalize="none"
          spellCheck={false}
          aria-invalid={!!error}
          aria-describedby={error ? "two-factor-error" : undefined}
        />
        {error && (
          <p role="alert" className="field-error" id="two-factor-error">
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy}>
          {busy ? "Checking…" : "Continue"}
          <ArrowRight size={18} />
        </Button>
      </form>
      <p className="two-factor-links">
        <button
          type="button"
          className="quiet-button"
          onClick={() => {
            setUseBackup(!useBackup);
            setCode("");
            setError("");
          }}
        >
          {useBackup ? "Use my authenticator app" : "Use a backup code instead"}
        </button>
        <button type="button" className="quiet-button" onClick={onBack}>
          Back to sign in
        </button>
      </p>
    </>
  );
}

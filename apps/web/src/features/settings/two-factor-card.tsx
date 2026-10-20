import { Button } from "@ledgerline/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { getSession } from "../../lib/api";
import {
  makeBackupCodes,
  secretFromUri,
  startTwoFactor,
  turnOffTwoFactor,
  twoFactorMessage,
  verifyCode,
} from "../auth/two-factor-api";
import { QrCode } from "./qr-code";

type Step =
  | { name: "idle" }
  | { name: "password"; action: "setup" | "codes" | "off" }
  | { name: "scan"; totpURI: string; backupCodes: string[] }
  | { name: "codes"; backupCodes: string[]; fresh: boolean };

/** Settings card: turn two-factor sign-in on or off and renew the backup codes (ADR 0038). */
export function TwoFactorCard() {
  const client = useQueryClient();
  const session = useQuery({ queryKey: ["session"], queryFn: getSession });
  const ready = session.isSuccess;
  const enabled = session.data?.user?.twoFactorEnabled === true;
  const [step, setStep] = useState<Step>({ name: "idle" });
  const [notice, setNotice] = useState("");
  const refresh = () => client.invalidateQueries({ queryKey: ["session"] });
  return (
    <section className="settings-card" aria-labelledby="two-factor-title">
      <h2 id="two-factor-title">Two-factor sign-in</h2>
      <p className="scope-label">Your account</p>
      {session.isError ? (
        <p role="alert" className="field-error">
          Couldn't check your two-factor setting. Please try again later.
        </p>
      ) : session.isPending ? (
        <p>Checking your two-factor setting…</p>
      ) : (
        <p>
          {enabled
            ? "On. Signing in asks for a code from your authenticator app after your password."
            : "Off. Add a second step to signing in: a 6-digit code from an authenticator app on your phone."}
        </p>
      )}
      {notice && (
        <p role="status" className="two-factor-notice">
          {notice}
        </p>
      )}
      {ready && step.name === "idle" && !enabled && (
        <div className="two-factor-actions">
          <Button
            type="button"
            onClick={() => {
              setNotice("");
              setStep({ name: "password", action: "setup" });
            }}
          >
            Set up two-factor
          </Button>
        </div>
      )}
      {ready && step.name === "idle" && enabled && (
        <details className="two-factor-manage">
          <summary className="two-factor-summary">Manage</summary>
          <div className="two-factor-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setNotice("");
                setStep({ name: "password", action: "codes" });
              }}
            >
              Make new backup codes
            </button>
            <button
              type="button"
              className="secondary-button danger-action"
              onClick={() => {
                setNotice("");
                setStep({ name: "password", action: "off" });
              }}
            >
              Turn off two-factor
            </button>
          </div>
        </details>
      )}
      {step.name === "password" && (
        <PasswordStep
          action={step.action}
          onCancel={() => setStep({ name: "idle" })}
          onDone={async (next) => {
            if (next === "off") {
              setStep({ name: "idle" });
              setNotice("Two-factor is off.");
              await refresh();
            } else setStep(next);
          }}
        />
      )}
      {step.name === "scan" && (
        <ScanStep
          totpURI={step.totpURI}
          onCancel={() => setStep({ name: "idle" })}
          onConfirmed={() =>
            setStep({
              name: "codes",
              backupCodes: step.backupCodes,
              fresh: true,
            })
          }
        />
      )}
      {step.name === "codes" && (
        <CodesStep
          backupCodes={step.backupCodes}
          onDone={async () => {
            setStep({ name: "idle" });
            setNotice(
              step.fresh
                ? "Two-factor is on. Use a code from your app the next time you sign in."
                : "New backup codes are ready. The old ones no longer work.",
            );
            await refresh();
          }}
        />
      )}
    </section>
  );
}

function PasswordStep({
  action,
  onCancel,
  onDone,
}: {
  action: "setup" | "codes" | "off";
  onCancel: () => void;
  onDone: (
    next:
      | "off"
      | { name: "scan"; totpURI: string; backupCodes: string[] }
      | { name: "codes"; backupCodes: string[]; fresh: boolean },
  ) => Promise<void>;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => field.current?.focus(), []);
  const submit = async () => {
    if (!password) return setError("Enter your password.");
    setBusy(true);
    setError("");
    try {
      if (action === "setup") {
        const setup = await startTwoFactor(password);
        await onDone({ name: "scan", ...setup });
      } else if (action === "codes") {
        const result = await makeBackupCodes(password);
        await onDone({
          name: "codes",
          backupCodes: result.backupCodes,
          fresh: false,
        });
      } else {
        await turnOffTwoFactor(password);
        await onDone("off");
      }
    } catch (failure) {
      setError(twoFactorMessage(failure, "password"));
      setBusy(false);
    }
  };
  return (
    <form
      noValidate
      className="two-factor-step"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label htmlFor="two-factor-password">Your password</label>
      <input
        id="two-factor-password"
        ref={field}
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        aria-invalid={!!error}
        aria-describedby={error ? "two-factor-password-error" : undefined}
      />
      {error && (
        <p role="alert" className="field-error" id="two-factor-password-error">
          {error}
        </p>
      )}
      <div className="two-factor-actions">
        {action === "off" ? (
          <Button type="submit" className="danger-action" disabled={busy}>
            Turn off two-factor
          </Button>
        ) : (
          <Button type="submit" disabled={busy}>
            {action === "setup" ? "Continue" : "Make new codes"}
          </Button>
        )}
        <button type="button" className="secondary-button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function ScanStep({
  totpURI,
  onCancel,
  onConfirmed,
}: {
  totpURI: string;
  onCancel: () => void;
  onConfirmed: () => void;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const secret = secretFromUri(totpURI);
  const submit = async () => {
    const value = code.replace(/\s+/g, "");
    if (!value) return setError("Enter the 6-digit code.");
    setBusy(true);
    setError("");
    try {
      await verifyCode(value);
      onConfirmed();
    } catch (failure) {
      setError(twoFactorMessage(failure, "code"));
      setBusy(false);
    }
  };
  return (
    <div className="two-factor-step">
      <p>
        Scan this with an authenticator app (Google Authenticator, Authy,
        1Password and others), or add it by hand with the key below. Two-factor
        only turns on once you enter a code from the app.
      </p>
      <QrCode text={totpURI} label="QR code for your authenticator app" />
      <p>
        <a className="two-factor-link" href={totpURI}>
          Open in my authenticator app
        </a>
      </p>
      <p>
        Key to type by hand:{" "}
        <code className="two-factor-key">
          {secret.replace(/(.{4})/g, "$1 ").trim()}
        </code>
      </p>
      <form
        noValidate
        className="two-factor-code-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label htmlFor="two-factor-setup-code">6-digit code from the app</label>
        <input
          id="two-factor-setup-code"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          autoComplete="one-time-code"
          inputMode="numeric"
          spellCheck={false}
          aria-invalid={!!error}
          aria-describedby={error ? "two-factor-setup-error" : undefined}
        />
        {error && (
          <p role="alert" className="field-error" id="two-factor-setup-error">
            {error}
          </p>
        )}
        <div className="two-factor-actions">
          <Button type="submit" disabled={busy}>
            Turn on
          </Button>
          <button type="button" className="secondary-button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

function CodesStep({
  backupCodes,
  onDone,
}: {
  backupCodes: string[];
  onDone: () => Promise<void>;
}) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(backupCodes.join("\n"));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="two-factor-step">
      <p>
        Backup codes. Each one signs you in once if you lose your phone. They
        are shown only now, so keep them somewhere safe, like a password
        manager.
      </p>
      <ul className="backup-codes" aria-label="Backup codes">
        {backupCodes.map((code) => (
          <li key={code} className="backup-code">
            {code}
          </li>
        ))}
      </ul>
      <div className="two-factor-actions">
        <button
          type="button"
          className="secondary-button"
          onClick={() => void copy()}
        >
          {copied ? "Copied" : "Copy all"}
        </button>
      </div>
      <label className="budget-rollover amount-entry-toggle">
        <input
          type="checkbox"
          checked={saved}
          onChange={(event) => setSaved(event.target.checked)}
        />
        <span className="check-text">I saved these codes</span>
      </label>
      <div className="two-factor-actions">
        <Button type="button" disabled={!saved} onClick={() => void onDone()}>
          Done
        </Button>
      </div>
    </div>
  );
}

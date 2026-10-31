import { ListCard, ListRow, SectionLabel, StatusPill } from "@ledgerline/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Overlay } from "../../components/overlay";
import { getSession } from "../../lib/api";
import {
  makeBackupCodes,
  secretFromUri,
  startTwoFactor,
  turnOffTwoFactor,
  twoFactorMessage,
  verifyCode,
} from "../auth/two-factor-api";
import { ActionRow } from "./action-row";
import { QrCode } from "./qr-code";

type Action = "setup" | "codes" | "off";
type Step =
  | { name: "idle" }
  | { name: "password"; action: Action }
  | { name: "scan"; totpURI: string; backupCodes: string[] }
  | { name: "codes"; backupCodes: string[]; fresh: boolean };

const openerOf: Record<Action, string> = {
  setup: "two-factor-setup",
  codes: "two-factor-codes",
  off: "two-factor-off",
};

/**
 * Settings, Security: turn two-factor sign-in on or off and renew the backup codes (ADR 0038). The prototype's
 * rows open one sheet that changes step in place (password, then the scan for a new setup, then the codes), so
 * the sheet never closes and reopens between steps.
 */
export function TwoFactorCard({
  onNotice,
}: {
  onNotice: (text: string) => void;
}) {
  const client = useQueryClient();
  const session = useQuery({ queryKey: ["session"], queryFn: getSession });
  const ready = session.isSuccess;
  const enabled = session.data?.user?.twoFactorEnabled === true;
  const [step, setStep] = useState<Step>({ name: "idle" });
  const [opener, setOpener] = useState<Action>("setup");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const refresh = () => client.invalidateQueries({ queryKey: ["session"] });
  const begin = (action: Action) => {
    setOpener(action);
    setSaved(false);
    setStep({ name: "password", action });
  };
  const close = () => setStep({ name: "idle" });
  const title =
    step.name === "scan"
      ? "Scan the code"
      : step.name === "codes"
        ? "Backup codes"
        : "Your password";
  return (
    <section aria-labelledby="two-factor-title" className="set-sect">
      <SectionLabel as="h2" id="two-factor-title">
        Security
      </SectionLabel>
      <ListCard>
        {session.isError ? (
          <div className="ui-row ui-row-static">
            <p role="alert" className="field-error">
              Couldn't check your two-factor setting. Please try again later.
            </p>
          </div>
        ) : (
          <ListRow
            title="Two-factor"
            hint={
              session.isPending
                ? "Checking your two-factor setting…"
                : enabled
                  ? "Asks for a code after your password"
                  : "A code from an app on your phone"
            }
            {...(ready
              ? {
                  value: (
                    <StatusPill tone={enabled ? "accent" : "neutral"}>
                      {enabled ? "On" : "Off"}
                    </StatusPill>
                  ),
                }
              : {})}
          />
        )}
        {ready && !enabled && (
          <ActionRow
            id={openerOf.setup}
            title="Set up two-factor"
            tone="accent"
            onClick={() => begin("setup")}
          />
        )}
        {ready && enabled && (
          <>
            <ActionRow
              id={openerOf.codes}
              title="Make new backup codes"
              onClick={() => begin("codes")}
            />
            <ActionRow
              id={openerOf.off}
              title="Turn off two-factor"
              tone="danger"
              onClick={() => begin("off")}
            />
          </>
        )}
      </ListCard>
      <Overlay
        open={step.name !== "idle"}
        title={title}
        busy={busy}
        dismissible={step.name !== "codes"}
        onDismiss={close}
        returnFocusId={openerOf[opener]}
        fallbackFocusId="main-content"
        footer={
          step.name === "password" ? (
            <button
              type="submit"
              form="two-factor-password-form"
              disabled={busy}
              className={`ui-btn ${step.action === "off" ? "ui-btn-danger-filled" : "ui-btn-primary"}`}
            >
              {step.action === "off"
                ? "Turn off two-factor"
                : step.action === "setup"
                  ? "Continue"
                  : "Make new codes"}
            </button>
          ) : step.name === "scan" ? (
            <button
              type="submit"
              form="two-factor-code-form"
              disabled={busy}
              className="ui-btn ui-btn-primary"
            >
              Turn on
            </button>
          ) : step.name === "codes" ? (
            <button
              type="button"
              disabled={!saved}
              className="ui-btn ui-btn-primary"
              onClick={() => {
                close();
                onNotice(
                  step.fresh
                    ? "Two-factor is on. Use a code from your app the next time you sign in."
                    : "New backup codes are ready. The old ones no longer work.",
                );
                void refresh();
              }}
            >
              Done
            </button>
          ) : undefined
        }
      >
        {step.name === "password" && (
          <PasswordStep
            action={step.action}
            onBusy={setBusy}
            onDone={async (next) => {
              if (next === "off") {
                close();
                onNotice("Two-factor is off.");
                await refresh();
              } else setStep(next);
            }}
          />
        )}
        {step.name === "scan" && (
          <ScanStep
            totpURI={step.totpURI}
            onBusy={setBusy}
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
            saved={saved}
            onSaved={setSaved}
          />
        )}
      </Overlay>
    </section>
  );
}

function PasswordStep({
  action,
  onBusy,
  onDone,
}: {
  action: Action;
  onBusy: (busy: boolean) => void;
  onDone: (
    next:
      | "off"
      | { name: "scan"; totpURI: string; backupCodes: string[] }
      | { name: "codes"; backupCodes: string[]; fresh: boolean },
  ) => Promise<void>;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => field.current?.focus(), []);
  const submit = async () => {
    if (!password) return setError("Enter your password.");
    onBusy(true);
    setError("");
    try {
      if (action === "setup") {
        const setup = await startTwoFactor(password);
        onBusy(false);
        await onDone({ name: "scan", ...setup });
      } else if (action === "codes") {
        const result = await makeBackupCodes(password);
        onBusy(false);
        await onDone({
          name: "codes",
          backupCodes: result.backupCodes,
          fresh: false,
        });
      } else {
        await turnOffTwoFactor(password);
        onBusy(false);
        await onDone("off");
      }
    } catch (failure) {
      setError(twoFactorMessage(failure, "password"));
      onBusy(false);
    }
  };
  return (
    <form
      noValidate
      id="two-factor-password-form"
      className="set-step"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label className="field-label" htmlFor="two-factor-password">
        Your password
      </label>
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
    </form>
  );
}

function ScanStep({
  totpURI,
  onBusy,
  onConfirmed,
}: {
  totpURI: string;
  onBusy: (busy: boolean) => void;
  onConfirmed: () => void;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const secret = secretFromUri(totpURI);
  const submit = async () => {
    const value = code.replace(/\s+/g, "");
    if (!value) return setError("Enter the 6-digit code.");
    onBusy(true);
    setError("");
    try {
      await verifyCode(value);
      onBusy(false);
      onConfirmed();
    } catch (failure) {
      setError(twoFactorMessage(failure, "code"));
      onBusy(false);
    }
  };
  return (
    <div className="set-step">
      <p className="set-line">
        Scan with an authenticator app. It turns on once you enter a code.
      </p>
      <QrCode text={totpURI} label="QR code for your authenticator app" />
      <ListCard>
        <ListRow
          title="Open in my authenticator app"
          chevron
          render={(inner, className) => (
            <a className={className} href={totpURI}>
              {inner}
            </a>
          )}
        />
      </ListCard>
      <div className="set-key">
        <span className="set-key-label">Key to type by hand</span>
        <code className="two-factor-key">
          {secret.replace(/(.{4})/g, "$1 ").trim()}
        </code>
      </div>
      <form
        noValidate
        id="two-factor-code-form"
        className="set-step"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label className="field-label" htmlFor="two-factor-setup-code">
          6-digit code from the app
        </label>
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
      </form>
    </div>
  );
}

function CodesStep({
  backupCodes,
  saved,
  onSaved,
}: {
  backupCodes: string[];
  saved: boolean;
  onSaved: (saved: boolean) => void;
}) {
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
    <div className="set-step">
      <p className="set-line">
        Each one signs you in once. They are shown only now.
      </p>
      <ul className="backup-codes" aria-label="Backup codes">
        {backupCodes.map((code) => (
          <li key={code} className="backup-code">
            {code}
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="ui-btn ui-btn-secondary"
        onClick={() => void copy()}
      >
        {copied ? "Copied" : "Copy all"}
      </button>
      <label className="set-check">
        <input
          type="checkbox"
          checked={saved}
          onChange={(event) => onSaved(event.target.checked)}
        />
        <span>I saved these codes</span>
      </label>
    </div>
  );
}

import { Button } from "@ledgerline/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { NativeSelect } from "../../components/native-select";
import { ApiError, getLedgers } from "../../lib/api";
import { prepareLedgerTimeZone } from "./api";

function zoneNames(): string[] {
  const names =
    typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : [];
  return names.includes("UTC") ? names : ["UTC", ...names];
}
const deviceZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** The ledger's time zone decides what "today" means for scheduled work such as recurring entries. */
export function TimeZoneCard() {
  const client = useQueryClient();
  const ledgers = useQuery({ queryKey: ["ledgers"], queryFn: getLedgers });
  const ledger = ledgers.data?.items[0];
  const options = useMemo(zoneNames, []);
  const [choice, setChoice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const attempt = useRef<{ sig: string; run: () => Promise<unknown> } | null>(
    null,
  );
  const isOwner = ledger?.role === "owner";
  const suggested = deviceZone();
  const selected =
    choice ??
    ledger?.timeZone ??
    (options.includes(suggested) ? suggested : "UTC");
  const save = async () => {
    if (!ledger) return;
    const sig = `${ledger.version}|${selected}`;
    if (attempt.current?.sig !== sig)
      attempt.current = {
        sig,
        run: prepareLedgerTimeZone(ledger, selected),
      };
    setBusy(true);
    setMessage("");
    setFailed(false);
    try {
      await attempt.current.run();
      attempt.current = null;
      setChoice(null);
      setMessage("Time zone saved.");
      await client.invalidateQueries({ queryKey: ["ledgers"] });
    } catch (failure) {
      attempt.current = null;
      setFailed(true);
      setMessage(
        failure instanceof ApiError && failure.status < 500
          ? failure.message
          : "We couldn't save that. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="settings-card" aria-labelledby="ledger-title">
      <h2 id="ledger-title">Ledger</h2>
      {ledgers.isError ? (
        <p role="alert" className="field-error">
          Couldn't load your ledger.
        </p>
      ) : (
        ledger && (
          <p>
            {ledger.timeZone
              ? `Today follows the ${ledger.timeZone} time zone.`
              : "No time zone yet. Set one so scheduled entries know what today is."}
          </p>
        )
      )}
      {ledger && isOwner && (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <fieldset disabled={busy} className="account-fields">
            <label htmlFor="ledger-time-zone">Time zone</label>
            <NativeSelect
              id="ledger-time-zone"
              value={selected}
              onChange={(event) => {
                setChoice(event.target.value);
                setMessage("");
              }}
            >
              {options.map((name) => (
                <option key={name} value={name}>
                  {name.replaceAll("_", " ")}
                </option>
              ))}
            </NativeSelect>
          </fieldset>
          {message && (
            <p
              role={failed ? "alert" : "status"}
              className={failed ? "field-error" : undefined}
            >
              {message}
            </p>
          )}
          <div className="account-dialog-actions">
            <Button
              type="submit"
              disabled={busy || selected === ledger.timeZone}
            >
              {busy ? "Saving…" : "Save time zone"}
            </Button>
          </div>
        </form>
      )}
      {ledger && !isOwner && (
        <p className="muted">Only the owner can change this.</p>
      )}
    </section>
  );
}

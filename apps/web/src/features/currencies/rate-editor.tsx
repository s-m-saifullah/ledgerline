import {
  invertRate,
  type PinnedCurrency,
  rateFromInverse,
} from "@ledgerline/shared";
import { Button } from "@ledgerline/ui";
import { useRef, useState } from "react";
import { EditorDialog } from "../../components/editor-dialog";
import { ApiError } from "../../lib/api";
import { prepareCurrencyRemove, prepareRateSet } from "./api";
import { currencyName, rateSentence, today } from "./format";

export function RateEditor({
  ledgerId,
  baseCurrency,
  currency,
  onDismiss,
  onChanged,
}: {
  ledgerId: string;
  baseCurrency: string;
  currency: PinnedCurrency;
  onDismiss: () => void;
  onChanged: () => void;
}) {
  const latest = currency.latestRate;
  const [date, setDate] = useState(today());
  // People read and type the rate as base currency first: 1 USD = X of this currency.
  const [rate, setRate] = useState(latest ? invertRate(latest.rate) : "");
  const [error, setError] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const attempt = useRef<{ sig: string; run: () => Promise<unknown> } | null>(
    null,
  );
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await action();
      onChanged();
      onDismiss();
    } catch (failure) {
      attempt.current = null;
      setError(
        failure instanceof ApiError && failure.status < 500
          ? failure.message
          : "We couldn't confirm that. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  const save = () => {
    const stored = rateFromInverse(rate);
    if (!stored) {
      setError(
        `Enter how much ${currency.code} one ${baseCurrency} is worth, such as 122.5.`,
      );
      return;
    }
    const sig = `${date}|${stored}`;
    if (attempt.current?.sig !== sig)
      attempt.current = {
        sig,
        // Editing the rate stored for this exact date, otherwise adding a new one.
        run: prepareRateSet(
          ledgerId,
          { code: currency.code, date, rate: stored },
          latest && latest.date === date ? latest : undefined,
        ),
      };
    void run(attempt.current.run);
  };
  const remove = () => {
    attempt.current ??= {
      sig: "remove",
      run: prepareCurrencyRemove(ledgerId, currency),
    };
    void run(attempt.current.run);
  };
  return (
    <EditorDialog
      open
      title={`${currency.code} rate`}
      description={`${currencyName(currency.code)}. Set a rate yourself and it is kept, never replaced by a refresh.`}
      busy={busy}
      onDismiss={onDismiss}
      returnFocusId={`currency-${currency.code}`}
      closeLabel="Close rate dialog"
      fallbackFocusId="currencies-title"
      initialFocusId="rate-value"
    >
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <fieldset disabled={busy} className="account-fields">
          <label htmlFor="rate-date">Date</label>
          <input
            id="rate-date"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
          <label htmlFor="rate-value">
            {`1 ${baseCurrency} is worth (${currency.code})`}
          </label>
          <input
            id="rate-value"
            inputMode="decimal"
            autoComplete="off"
            value={rate}
            onChange={(event) => {
              setRate(event.target.value);
              setError("");
            }}
            aria-invalid={error ? "true" : undefined}
            aria-describedby={error ? "rate-error" : undefined}
          />
          {latest && (
            <p className="muted">
              Latest: {rateSentence(currency.code, latest.rate, baseCurrency)}{" "}
              on {latest.date} (
              {latest.source === "manual" ? "set by you" : "fetched"})
            </p>
          )}
        </fieldset>
        {error && (
          <p id="rate-error" role="alert" className="field-error">
            {error}
          </p>
        )}
        <div className="account-dialog-actions">
          {confirmRemove ? (
            <button
              type="button"
              className="secondary-button danger-action"
              disabled={busy}
              onClick={remove}
            >
              Yes, remove {currency.code}
            </button>
          ) : (
            <button
              type="button"
              className="quiet-button danger-action"
              disabled={busy}
              onClick={() => setConfirmRemove(true)}
            >
              Remove currency
            </button>
          )}
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save rate"}
          </Button>
        </div>
      </form>
    </EditorDialog>
  );
}

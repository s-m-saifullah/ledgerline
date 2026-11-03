import {
  invertRate,
  type PinnedCurrency,
  rateFromInverse,
} from "@ledgerline/shared";
import { StatusPill } from "@ledgerline/ui";
import { type FormEvent, useRef, useState } from "react";
import { DeleteTrigger } from "../../components/delete-trigger";
import { Overlay } from "../../components/overlay";
import { ApiError } from "../../lib/api";
import { currencyName, today } from "../../lib/rate-format";
import { prepareCurrencyRemove, prepareRateSet } from "./api";
import { sourceLabel } from "./model";

/**
 * One sheet for a currency (ADR 0047, the prototype's `OV["rate-form"]`): the stored rate and where it came from,
 * the field to set the rate yourself and the trash that asks before it removes the currency. A rate set here counts
 * for today. People read and type the rate base first, 1 USD = X of this currency; it is stored inverted. Each
 * write keeps its Idempotency-Key until the answer is known.
 */
export function RateSheet({
  ledgerId,
  baseCurrency,
  currency,
  onDismiss,
  onSaved,
}: {
  ledgerId: string;
  baseCurrency: string;
  currency: PinnedCurrency;
  onDismiss: () => void;
  /** Called with the sentence that says what happened, once the write is confirmed. */
  onSaved: (notice: string) => void;
}) {
  const latest = currency.latestRate;
  const [rate, setRate] = useState(latest ? invertRate(latest.rate) : "");
  const [error, setError] = useState("");
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const attempt = useRef<{ sig: string; run: () => Promise<unknown> } | null>(
    null,
  );
  const send = async (
    sig: string,
    prepare: () => () => Promise<unknown>,
    done: string,
  ) => {
    if (attempt.current?.sig !== sig) attempt.current = { sig, run: prepare() };
    setBusy(true);
    setError("");
    try {
      await attempt.current.run();
    } catch (failure) {
      // A refusal is final; anything else may have gone through, so the same key is used again.
      const refused = failure instanceof ApiError && failure.status < 500;
      if (refused) attempt.current = null;
      setError(
        refused
          ? failure.message
          : "We couldn't confirm that. Please try again.",
      );
      return;
    } finally {
      setBusy(false);
    }
    onSaved(done);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const stored = rateFromInverse(rate);
    if (!stored) {
      setError(
        `Enter how much ${currency.code} one ${baseCurrency} is worth, such as 122.5.`,
      );
      return;
    }
    const date = today();
    void send(
      `${date}|${stored}`,
      // Editing today's stored rate when there is one, otherwise adding today's.
      () =>
        prepareRateSet(
          ledgerId,
          { code: currency.code, date, rate: stored },
          latest && latest.date === date ? latest : undefined,
        ),
      "Rate saved.",
    );
  };
  return (
    <>
      <Overlay
        open
        title={currencyName(currency.code)}
        description="Set a rate yourself and it is kept, never replaced by a refresh."
        busy={busy}
        onDismiss={onDismiss}
        returnFocusId={`currency-${currency.code}`}
        fallbackFocusId="currencies-title"
        initialFocusId="rate-value"
        footer={
          <>
            <DeleteTrigger
              id="remove-currency"
              label="Remove currency"
              disabled={busy}
              onClick={() => {
                setError("");
                setAsking(true);
              }}
            />
            <button
              type="submit"
              form="rate-form"
              className="ui-btn ui-btn-primary"
              disabled={busy}
            >
              {busy && !asking ? "Saving…" : "Save"}
            </button>
          </>
        }
      >
        <form id="rate-form" className="cu-form" noValidate onSubmit={submit}>
          <fieldset disabled={busy} className="cu-fields">
            <div className="cu-card">
              <div className="ui-row ui-row-static">
                <span className="ui-row-main">
                  <span className="ui-row-title">Rate</span>
                  <span className="ui-row-hint">{`1 ${baseCurrency} in ${currency.code}`}</span>
                </span>
                <span className="ui-row-end cu-figure">
                  {latest ? invertRate(latest.rate) : "None yet"}
                </span>
              </div>
              {latest && (
                <div className="ui-row ui-row-static">
                  <span className="ui-row-main">
                    <span className="ui-row-title">Source</span>
                    <span className="ui-row-hint">{latest.date}</span>
                  </span>
                  <span className="ui-row-end">
                    <StatusPill
                      tone={latest.source === "manual" ? "accent" : "neutral"}
                    >
                      {sourceLabel(latest)}
                    </StatusPill>
                  </span>
                </div>
              )}
            </div>
            <div className="cu-field">
              <label htmlFor="rate-value">Set the rate yourself</label>
              <input
                id="rate-value"
                className="cu-rate"
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
            </div>
          </fieldset>
          {error && !asking && (
            <p id="rate-error" role="alert" className="field-error">
              {error}
            </p>
          )}
        </form>
      </Overlay>
      <Overlay
        kind="question"
        open={asking}
        title={`Remove ${currency.code}?`}
        busy={busy}
        onDismiss={() => {
          setAsking(false);
          setError("");
        }}
        returnFocusId="remove-currency"
        fallbackFocusId="currencies-title"
        footer={
          <button
            type="button"
            className="ui-btn ui-btn-danger-filled"
            disabled={busy}
            onClick={() =>
              void send(
                "remove",
                () => prepareCurrencyRemove(ledgerId, currency),
                `Removed ${currency.code}.`,
              )
            }
          >
            {busy ? "Removing…" : "Remove"}
          </button>
        }
      >
        <p>Its stored rates and the entries in it are kept.</p>
        {error && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}
      </Overlay>
    </>
  );
}

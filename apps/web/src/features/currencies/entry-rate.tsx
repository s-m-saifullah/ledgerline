import { convertMinor, invertRate, rateFromInverse } from "@ledgerline/shared";
import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Amount } from "../home/amount";
import { getRateLookup } from "./api";
import { useBaseValues } from "./base-value";
import { rateSentence } from "./format";

/**
 * Under an amount in another currency: what it is worth in the base currency, which rate that
 * uses, and a way to set the rate by hand (read base-currency first, "1 USD = X EUR"). Shows
 * nothing for an entry in the base currency. `manualRate` is the stored form of a rate set by
 * hand ("" means use the stored rate); `savedRate` is an existing entry's own rate.
 */
type EntryRateProps = {
  ledgerId: string;
  currency: string;
  date: string;
  /** The entry's amount in smallest units (sign does not matter), or null when not typed yet. */
  amountMinor: number | null;
  manualRate: string;
  savedRate?: string | undefined;
  onManualRate: (rate: string) => void;
  disabled?: boolean | undefined;
};

/** Renders nothing, and runs no queries, for the base currency (USD for every ledger today). */
export function EntryRate(props: EntryRateProps) {
  if (props.currency === "USD") return null;
  return <ForeignEntryRate {...props} />;
}

function ForeignEntryRate({
  ledgerId,
  currency,
  date,
  amountMinor,
  manualRate,
  savedRate,
  onManualRate,
  disabled,
}: EntryRateProps) {
  const { baseCurrency } = useBaseValues(ledgerId);
  const foreign = currency !== baseCurrency;
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const lookup = useQuery({
    queryKey: ["rate-lookup", ledgerId, currency, date],
    queryFn: ({ signal }) => getRateLookup(ledgerId, currency, date, signal),
    enabled: foreign && validDate,
    staleTime: 30_000,
  });
  const [editing, setEditing] = useState(false);
  const [typed, setTyped] = useState("");
  const [typedError, setTypedError] = useState("");
  const inputId = useId();
  if (!foreign) return null;
  const stored = lookup.data?.rate ?? null;
  const rate = manualRate || savedRate || stored;
  let base: number | null = null;
  if (rate && amountMinor !== null && amountMinor !== 0)
    try {
      base = convertMinor(Math.abs(amountMinor), rate, currency, baseCurrency);
    } catch {
      base = null;
    }
  const missing = !manualRate && !savedRate && lookup.isSuccess && !stored;
  const source = manualRate
    ? "set by you"
    : savedRate
      ? "this entry's saved rate"
      : lookup.data?.rateDate && lookup.data.rateDate !== date
        ? `rate from ${lookup.data.rateDate}`
        : "";
  return (
    <div className="entry-rate">
      {rate ? (
        <p className="form-help" aria-live="polite">
          {base !== null && (
            <>
              About <Amount cents={base} currency={baseCurrency} />
              {" · "}
            </>
          )}
          {rateSentence(currency, rate, baseCurrency)}
          {source && ` (${source})`}
        </p>
      ) : (
        <p
          className={missing ? "field-error" : "form-help"}
          role={missing ? "alert" : undefined}
        >
          {missing
            ? `No ${currency} rate is stored for this date yet. Set one to save this entry.`
            : lookup.isError
              ? "Couldn't look up the exchange rate."
              : "Looking up the exchange rate…"}
        </p>
      )}
      {!disabled && !editing && (
        <button
          type="button"
          className="quiet-button entry-rate-toggle"
          onClick={() => {
            setEditing(true);
            setTyped(rate ? invertRate(rate) : "");
            setTypedError("");
          }}
        >
          {manualRate ? "Change the rate" : "Set the rate yourself"}
        </button>
      )}
      {!disabled && editing && (
        <div className="entry-rate-edit">
          <label htmlFor={inputId}>
            {`1 ${baseCurrency} is worth (${currency})`}
          </label>
          <input
            id={inputId}
            inputMode="decimal"
            autoComplete="off"
            value={typed}
            aria-invalid={typedError ? "true" : undefined}
            onChange={(event) => {
              const text = event.target.value;
              setTyped(text);
              const next = rateFromInverse(text);
              if (!text.trim()) {
                setTypedError("");
                onManualRate("");
              } else if (next) {
                setTypedError("");
                onManualRate(next);
              } else {
                setTypedError("Enter a positive amount such as 122.5.");
                onManualRate("");
              }
            }}
          />
          {typedError && <p className="field-error">{typedError}</p>}
          <button
            type="button"
            className="quiet-button entry-rate-toggle"
            onClick={() => {
              setEditing(false);
              setTyped("");
              setTypedError("");
              onManualRate("");
            }}
          >
            Use the stored rate
          </button>
        </div>
      )}
    </div>
  );
}

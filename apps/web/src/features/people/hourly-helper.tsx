import { useState } from "react";
import { formatMoney } from "../accounts/money";
import { hourlyResult, totalText } from "./hourly";

/**
 * Optional "hours at a rate" calculator on the Log service form (ADR 0026). It only fills the
 * amount (and a blank description); the service stores the total like any other amount.
 */
export function HourlyHelper({
  currency,
  secret,
  disabled,
  descriptionBlank,
  onUse,
}: {
  currency: string;
  secret: boolean;
  disabled: boolean;
  descriptionBlank: boolean;
  onUse: (amount: string, description: string | null) => void;
}) {
  const [hours, setHours] = useState("");
  const [rate, setRate] = useState("");
  const result = hourlyResult(hours, rate, currency);
  return (
    <details className="more-details hourly-helper">
      <summary>Work paid by the hour? Calculate the amount</summary>
      <label className="form-field" htmlFor="people-hours">
        Hours
        <input
          id="people-hours"
          inputMode="decimal"
          value={hours}
          disabled={disabled}
          maxLength={7}
          onChange={(e) => setHours(e.target.value)}
        />
      </label>
      <label className="form-field" htmlFor="people-hourly-rate">
        Hourly rate ({currency})
        <input
          id="people-hourly-rate"
          type={secret ? "password" : "text"}
          inputMode="decimal"
          value={rate}
          disabled={disabled}
          maxLength={30}
          onChange={(e) => setRate(e.target.value)}
        />
      </label>
      {result && !result.ok && (
        <p className="form-help" role="alert">
          {result.message}
        </p>
      )}
      {result?.ok && (
        <>
          <p role="status">
            {result.hours} h at {secret ? "••••" : result.rate}/h ={" "}
            {secret ? "••••" : formatMoney(result.total, currency)}
          </p>
          <button
            type="button"
            className="secondary-button"
            disabled={disabled}
            onClick={() =>
              onUse(
                totalText(result.total, currency),
                descriptionBlank
                  ? `${result.hours} h at ${result.rate}/h`
                  : null,
              )
            }
          >
            Use this total
          </button>
        </>
      )}
    </details>
  );
}

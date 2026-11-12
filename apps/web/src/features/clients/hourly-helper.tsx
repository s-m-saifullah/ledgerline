import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { AmountInput } from "../../components/amount-input";
import { formatMoney } from "../../lib/money";
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
    <details className="ed-card ed-fold hourly-helper">
      <summary>
        <span className="ui-row-title">
          Paid by the hour? Work out the amount
        </span>
        <ChevronDown size={18} aria-hidden="true" />
      </summary>
      <div className="ed-fold-body">
        <div className="ed-pair">
          <div className="ed-field">
            <label htmlFor="client-hours">Hours</label>
            <input
              id="client-hours"
              inputMode="decimal"
              value={hours}
              disabled={disabled}
              maxLength={7}
              onChange={(e) => setHours(e.target.value)}
            />
          </div>
          <div className="ed-field">
            <label htmlFor="client-hourly-rate">Hourly rate ({currency})</label>
            <AmountInput
              currency={currency}
              id="client-hourly-rate"
              type={secret ? "password" : "text"}
              inputMode="decimal"
              value={rate}
              disabled={disabled}
              maxLength={30}
              onChange={(e) => setRate(e.target.value)}
            />
          </div>
        </div>
        {result && (
          <div className="ed-fold-result">
            {result && !result.ok && (
              <p className="field-error" role="alert">
                {result.message}
              </p>
            )}
            {result?.ok && (
              <>
                <p role="status" className="ed-note">
                  {result.hours} h at {secret ? "••••" : result.rate}/h ={" "}
                  {secret ? "••••" : formatMoney(result.total, currency)}
                </p>
                <button
                  type="button"
                  className="ui-btn ui-btn-secondary"
                  disabled={disabled}
                  onClick={() =>
                    onUse(
                      totalText(result.total, currency),
                      // The words hold the rate, so they are not saved while amounts are hidden.
                      descriptionBlank && !secret
                        ? `${result.hours} h at ${result.rate}/h`
                        : null,
                    )
                  }
                >
                  Use this total
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </details>
  );
}

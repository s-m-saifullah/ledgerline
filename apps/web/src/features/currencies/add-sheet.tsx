import { type FormEvent, useMemo, useRef, useState } from "react";
import { Overlay } from "../../components/overlay";
import { PickRow } from "../../components/pick-row";
import { ApiError } from "../../lib/api";
import { addableCurrencies } from "../../lib/rate-format";
import { prepareCurrencyPin, prepareRatesRefresh } from "./api";

/**
 * Add currency (ADR 0047): one sheet with a pick row for the currency and Add currency pinned. Fetching its rate
 * afterwards is best effort; the Currencies screen shows "No rate yet" when none came back.
 */
export function AddCurrencySheet({
  ledgerId,
  baseCurrency,
  taken,
  onDismiss,
  onSaved,
}: {
  ledgerId: string;
  baseCurrency: string;
  taken: string[];
  onDismiss: () => void;
  onSaved: (notice: string) => void;
}) {
  const options = useMemo(
    () => addableCurrencies([baseCurrency, ...taken]),
    [baseCurrency, taken],
  );
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const attempt = useRef<{ code: string; run: () => Promise<unknown> } | null>(
    null,
  );
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!code) {
      setError("Choose a currency.");
      return;
    }
    if (attempt.current?.code !== code)
      attempt.current = { code, run: prepareCurrencyPin(ledgerId, code) };
    setBusy(true);
    setError("");
    try {
      await attempt.current.run();
      await prepareRatesRefresh(ledgerId, code)().catch(() => null);
    } catch (failure) {
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
    onSaved(`Added ${code}.`);
  };
  return (
    <Overlay
      open
      title="Add currency"
      description="Rates for it are fetched for you, and you can set your own at any time."
      busy={busy}
      onDismiss={onDismiss}
      returnFocusId="add-currency"
      fallbackFocusId="currencies-title"
      initialFocusId="currency-choice"
      footer={
        <button
          type="submit"
          form="currency-form"
          className="ui-btn ui-btn-primary"
          disabled={busy}
        >
          {busy ? "Adding…" : "Add currency"}
        </button>
      }
    >
      <form
        id="currency-form"
        className="cu-form"
        noValidate
        onSubmit={(event) => void submit(event)}
      >
        <div className="cu-card">
          <PickRow
            id="currency-choice"
            label="Currency"
            value={code}
            disabled={busy}
            options={[
              { value: "", label: "Choose…" },
              ...options.map((option) => ({
                value: option.code,
                label: `${option.name} (${option.code})`,
              })),
            ]}
            onChange={(value) => {
              setCode(value);
              setError("");
            }}
          />
        </div>
        {error && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}
      </form>
    </Overlay>
  );
}

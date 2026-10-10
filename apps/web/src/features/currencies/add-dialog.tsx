import { Button } from "@ledgerline/ui";
import { useMemo, useRef, useState } from "react";
import { EditorDialog } from "../../components/editor-dialog";
import { ApiError } from "../../lib/api";
import { prepareCurrencyPin, prepareRatesRefresh } from "./api";
import { addableCurrencies } from "./format";

export function AddCurrencyDialog({
  ledgerId,
  baseCurrency,
  taken,
  onDismiss,
  onChanged,
}: {
  ledgerId: string;
  baseCurrency: string;
  taken: string[];
  onDismiss: () => void;
  onChanged: () => void;
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
  const add = async () => {
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
      // Fetching is best effort; the Currencies screen says when no rate came back.
      await prepareRatesRefresh(ledgerId, code)().catch(() => null);
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
  return (
    <EditorDialog
      open
      title="Add a currency"
      description="Rates for it are fetched for you, and you can set your own at any time."
      busy={busy}
      onDismiss={onDismiss}
      returnFocusId="add-currency"
      closeLabel="Close add currency dialog"
      fallbackFocusId="currencies-title"
      initialFocusId="currency-choice"
    >
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void add();
        }}
      >
        <fieldset disabled={busy} className="account-fields">
          <label htmlFor="currency-choice">Currency</label>
          <select
            id="currency-choice"
            value={code}
            onChange={(event) => {
              setCode(event.target.value);
              setError("");
            }}
          >
            <option value="">Choose…</option>
            {options.map((option) => (
              <option key={option.code} value={option.code}>
                {option.name} ({option.code})
              </option>
            ))}
          </select>
        </fieldset>
        {error && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}
        <div className="account-dialog-actions">
          <Button type="submit" disabled={busy}>
            {busy ? "Adding…" : "Add currency"}
          </Button>
        </div>
      </form>
    </EditorDialog>
  );
}

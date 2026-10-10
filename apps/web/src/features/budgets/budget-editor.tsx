import { type BudgetLine, parseMinorUnits } from "@ledgerline/shared";
import { Button } from "@ledgerline/ui";
import { useRef, useState } from "react";
import { EditorDialog } from "../../components/editor-dialog";
import { ApiError } from "../../lib/api";
import { cleanAmountText, decimalFromCents } from "../accounts/money";
import { monthLabel } from "../home/month";
import { prepareBudgetRemove, prepareBudgetSave } from "./api";

/** Parse a typed budget amount into whole cents, or explain what is wrong. */
export function parseBudgetAmount(text: string) {
  const cleaned = cleanAmountText(text);
  if (!cleaned) return { error: "Enter a budget amount." } as const;
  try {
    const cents = parseMinorUnits(cleaned);
    if (cents < 0) return { error: "A budget cannot be negative." } as const;
    return { cents } as const;
  } catch {
    return { error: "Use an amount such as 250 or 250.50." } as const;
  }
}

export function BudgetEditor({
  ledgerId,
  month,
  line,
  onDismiss,
  onChanged,
}: {
  ledgerId: string;
  month: string;
  line: BudgetLine;
  onDismiss: () => void;
  /** Called after any saved change, or after a conflict so the page can reload. */
  onChanged: () => void;
}) {
  const existing = line.budget ?? undefined;
  const [amount, setAmount] = useState(
    existing ? decimalFromCents(existing.amount.amount) : "",
  );
  const [rollover, setRollover] = useState(existing?.rollover ?? false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  // One prepared action per distinct request, so a retry reuses its Idempotency-Key.
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
      if (failure instanceof ApiError && failure.status === 409) {
        attempt.current = null;
        setConflict(true);
        setError(
          "This budget changed somewhere else. Reload to see the latest.",
        );
      } else if (failure instanceof ApiError && failure.status < 500) {
        attempt.current = null;
        setError(failure.message);
      } else {
        setError("We couldn't confirm that. Try again to retry safely.");
      }
    } finally {
      setBusy(false);
    }
  };
  const save = () => {
    const parsed = parseBudgetAmount(amount);
    if ("error" in parsed) {
      setError(parsed.error);
      return;
    }
    const sig = `${parsed.cents}|${rollover}`;
    if (attempt.current?.sig !== sig)
      attempt.current = {
        sig,
        run: prepareBudgetSave(
          ledgerId,
          {
            categoryId: line.categoryId,
            month,
            amount: parsed.cents,
            rollover,
          },
          existing,
        ),
      };
    void run(attempt.current.run);
  };
  const remove = () => {
    if (!existing) return;
    attempt.current ??= {
      sig: "remove",
      run: prepareBudgetRemove(ledgerId, existing),
    };
    void run(attempt.current.run);
  };
  return (
    <EditorDialog
      open
      title={`${line.name} budget`}
      description={`How much to spend on ${line.name} in ${monthLabel(month)}.`}
      busy={busy}
      onDismiss={onDismiss}
      returnFocusId={`budget-line-${line.categoryId}`}
      closeLabel="Close budget dialog"
      fallbackFocusId="budgets-title"
      initialFocusId="budget-amount"
    >
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!conflict) save();
        }}
      >
        <fieldset disabled={busy || conflict} className="account-fields">
          <label htmlFor="budget-amount">Budget for the month (USD)</label>
          <input
            id="budget-amount"
            inputMode="decimal"
            autoComplete="off"
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value);
              setError("");
            }}
            aria-invalid={error ? "true" : undefined}
            aria-describedby={error ? "budget-error" : undefined}
          />
          <label className="budget-rollover">
            <input
              type="checkbox"
              checked={rollover}
              onChange={(event) => setRollover(event.target.checked)}
            />
            <span>
              Carry over what is left, or what is overspent, to the next month
            </span>
          </label>
        </fieldset>
        {error && (
          <p id="budget-error" role="alert" className="field-error">
            {error}
          </p>
        )}
        <div className="account-dialog-actions">
          {conflict ? (
            <Button
              type="button"
              onClick={() => {
                onChanged();
                onDismiss();
              }}
            >
              Reload budgets
            </Button>
          ) : (
            <>
              {existing &&
                (confirmRemove ? (
                  <button
                    type="button"
                    className="secondary-button danger-action"
                    disabled={busy}
                    onClick={remove}
                  >
                    Yes, remove it
                  </button>
                ) : (
                  <button
                    type="button"
                    className="quiet-button danger-action"
                    disabled={busy}
                    onClick={() => setConfirmRemove(true)}
                  >
                    Remove budget
                  </button>
                ))}
              <Button type="submit" disabled={busy}>
                {busy ? "Saving…" : "Save budget"}
              </Button>
            </>
          )}
        </div>
      </form>
    </EditorDialog>
  );
}

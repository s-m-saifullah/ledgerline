import { type BudgetLine, parseMinorUnits } from "@ledgerline/shared";
import { Avatar, ListCard, SwitchRow } from "@ledgerline/ui";
import { useRef, useState } from "react";
import { Amount } from "../../components/amount-text";
import { EntryAmount } from "../../components/entry-amount";
import { Overlay } from "../../components/overlay";
import { ApiError } from "../../lib/api";
import { cleanAmountText, decimalFromCents } from "../../lib/money";
import { monthLabel } from "../../lib/month";
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

/** Round amounts a tap fills in, in cents. */
const presets = [5000, 10000, 15000, 25000];
const whole = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/**
 * Set limit (ADR 0047): the category and what it spent, the limit as a big amount with a few round amounts to
 * tap, the carry-over switch, and Remove limit and Save at the foot. A sheet on a phone, a drawer from 700 px.
 */
export function LimitSheet({
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
  /** Called after a saved change, with what to tell the owner, or after a conflict so the page can reload. */
  onChanged: (notice?: string) => void;
}) {
  const existing = line.budget ?? undefined;
  const [amount, setAmount] = useState(
    existing ? decimalFromCents(existing.amount.amount) : "",
  );
  const [rollover, setRollover] = useState(existing?.rollover ?? false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  // One prepared action per distinct request, so a retry reuses its Idempotency-Key.
  const attempt = useRef<{ sig: string; run: () => Promise<unknown> } | null>(
    null,
  );
  const run = async (action: () => Promise<unknown>, notice: string) => {
    setBusy(true);
    setError("");
    try {
      await action();
      onChanged(notice);
      onDismiss();
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 409) {
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
    const sig = `save|${parsed.cents}|${rollover}`;
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
    void run(attempt.current.run, "Limit saved.");
  };
  const remove = () => {
    if (!existing) return;
    if (attempt.current?.sig !== "remove")
      attempt.current = {
        sig: "remove",
        run: prepareBudgetRemove(ledgerId, existing),
      };
    void run(attempt.current.run, "Limit removed");
  };
  const frozen = busy || conflict;
  return (
    <Overlay
      open
      title="Set limit"
      description={`How much to spend on ${line.name} in ${monthLabel(month)}.`}
      busy={busy}
      onDismiss={onDismiss}
      returnFocusId={`budget-line-${line.categoryId}`}
      fallbackFocusId="budgets-title"
      footer={
        conflict ? (
          <button
            type="button"
            className="ui-btn ui-btn-primary"
            onClick={() => {
              onChanged();
              onDismiss();
            }}
          >
            Reload budgets
          </button>
        ) : (
          <>
            {existing && (
              <button
                type="button"
                id="remove-limit"
                className="ui-btn ui-btn-secondary ui-btn-danger"
                disabled={busy}
                onClick={remove}
              >
                Remove limit
              </button>
            )}
            <button
              type="submit"
              form="budget-form"
              className="ui-btn ui-btn-primary"
              disabled={busy}
            >
              {busy ? "Saving…" : "Save"}
            </button>
          </>
        )
      }
    >
      <form
        id="budget-form"
        noValidate
        className="bud-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!conflict) save();
        }}
      >
        <ListCard>
          <div className="ui-row ui-row-static">
            <Avatar name={line.name} />
            <span className="ui-row-main">
              <span className="ui-row-title">{line.name}</span>
              <span className="ui-row-hint">
                Spent <Amount cents={line.spent.amount} /> this month
              </span>
            </span>
          </div>
        </ListCard>
        <fieldset disabled={frozen} className="bud-fields">
          <EntryAmount
            id="budget-amount"
            label="Budget for the month (USD)"
            currency="USD"
            invalid={!!error}
            describedBy={error ? "budget-error" : undefined}
            inputProps={{
              value: amount,
              onChange: (event) => {
                setAmount(event.target.value);
                setError("");
              },
            }}
          />
          <div className="bud-presets">
            {presets.map((cents) => (
              <button
                key={cents}
                type="button"
                className="ui-chip"
                onClick={() => {
                  setAmount(decimalFromCents(cents));
                  setError("");
                }}
              >
                {whole.format(cents / 100)}
              </button>
            ))}
          </div>
          <ListCard>
            <SwitchRow
              title="Carry over what is left"
              checked={rollover}
              onChange={setRollover}
            />
          </ListCard>
        </fieldset>
        {error && (
          <p id="budget-error" role="alert" className="field-error">
            {error}
          </p>
        )}
      </form>
    </Overlay>
  );
}

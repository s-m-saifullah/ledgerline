import { type ComponentPropsWithRef, useContext } from "react";
import { PrivacyContext } from "../lib/preferences";
import { AmountInput } from "./amount-input";
import "./entry-amount.css";

/**
 * The big amount with its currency code beside it, for the entry sheets and the budget limit. The visible
 * label would only repeat the code, so the label is read aloud and the code is drawn.
 */
export function EntryAmount({
  id,
  label,
  currency,
  invalid,
  describedBy,
  inputProps,
}: {
  id: string;
  label: string;
  currency: string;
  invalid: boolean;
  describedBy: string | undefined;
  /** What a form library registers, or a value and its change handler. */
  inputProps: Omit<
    ComponentPropsWithRef<typeof AmountInput>,
    "currency" | "id"
  >;
}) {
  const privateMode = useContext(PrivacyContext);
  return (
    <div className="entry-amount">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <AmountInput
        currency={currency}
        id={id}
        className="entry-amount-input"
        type={privateMode ? "password" : "text"}
        inputMode="decimal"
        autoComplete="off"
        aria-invalid={invalid}
        aria-describedby={describedBy}
        {...inputProps}
      />
      <span className="entry-amount-code" aria-hidden="true">
        {currency}
      </span>
    </div>
  );
}

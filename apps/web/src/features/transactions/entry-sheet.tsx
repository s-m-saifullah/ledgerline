import { SegmentedControl } from "@ledgerline/ui";
import { Trash2 } from "lucide-react";
import { type ReactNode, useContext } from "react";
import type { UseFormRegisterReturn } from "react-hook-form";
import { AmountInput } from "../../components/amount-input";
import { PrivacyContext } from "../../lib/preferences";
import "./entry-sheet.css";

export type EntryType = "expense" | "income" | "transfer";

const kinds = [
  { value: "expense", label: "Expense" },
  { value: "income", label: "Income" },
] as const;
const kindsAndTransfer = [
  ...kinds,
  { value: "transfer", label: "Transfer" },
] as const;

/** The type of an entry as a pill: Expense and Income, and Transfer only when a new entry may be one (ADR 0047). */
export function TypePill({
  value,
  onChange,
  withTransfer,
  disabled,
}: {
  value: EntryType;
  onChange: (type: EntryType) => void;
  withTransfer: boolean;
  disabled?: boolean;
}) {
  return (
    <SegmentedControl<EntryType>
      label="Entry type"
      options={[...(withTransfer ? kindsAndTransfer : kinds)]}
      value={value}
      onChange={onChange}
      {...(disabled ? { disabled } : {})}
    />
  );
}

/**
 * The big amount with its currency code beside it. The visible label would only repeat the code, so the
 * label is read aloud and the code is drawn.
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
  inputProps: UseFormRegisterReturn;
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

/** One bordered card of fields; the sheet's body spaces its cards. */
export function EntryCard({ children }: { children: ReactNode }) {
  return <div className="entry-card">{children}</div>;
}

/** The first step of deleting: only the trash on a phone, the words from 700 px. It asks; it never deletes. */
export function DeleteTrigger({
  id,
  label,
  disabled,
  onClick,
}: {
  id?: string;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      id={id}
      type="button"
      className="ui-btn ui-btn-secondary ui-btn-danger entry-delete"
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      <Trash2 size={18} aria-hidden="true" />
      <span className="entry-delete-label">{label}</span>
    </button>
  );
}

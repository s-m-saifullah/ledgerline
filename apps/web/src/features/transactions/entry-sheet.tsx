import { SegmentedControl } from "@ledgerline/ui";
import { Trash2 } from "lucide-react";
import type { ReactNode } from "react";
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

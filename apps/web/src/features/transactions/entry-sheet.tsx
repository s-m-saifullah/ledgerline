import { SegmentedControl } from "@ledgerline/ui";
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

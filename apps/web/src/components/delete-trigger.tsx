import { Trash2 } from "lucide-react";
import "./delete-trigger.css";

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

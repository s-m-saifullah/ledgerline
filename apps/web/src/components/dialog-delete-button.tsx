import { Trash2 } from "lucide-react";

/**
 * The first step of deleting from an editor dialog (ADR 0039). On a phone it shrinks to a trash icon so the
 * Close, Delete and Save buttons share one row; the label stays in the page for screen readers and tests.
 * Pressing it only asks for confirmation; the real delete is a second button.
 */
export function DialogDeleteButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="secondary-button danger-action dialog-delete"
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      <Trash2 size={20} aria-hidden="true" />
      <span className="dialog-delete-label">{label}</span>
    </button>
  );
}

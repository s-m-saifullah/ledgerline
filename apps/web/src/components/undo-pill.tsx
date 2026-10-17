import { X } from "lucide-react";

/** The Undo that stays in the corner after the toast has gone, with a cross to dismiss it. */
export function UndoPill({
  label,
  disabled,
  dismissDisabled = false,
  onUndo,
  onDismiss,
}: {
  label: string;
  disabled: boolean;
  dismissDisabled?: boolean;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="undo-pill">
      <button
        type="button"
        className="undo-pill-action"
        disabled={disabled}
        onClick={onUndo}
      >
        {label}
      </button>
      <button
        type="button"
        className="undo-pill-dismiss"
        aria-label="Dismiss undo"
        disabled={dismissDisabled}
        onClick={onDismiss}
      >
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
}

import type { ReactNode } from "react";
import "./question.css";
import { Overlay } from "./overlay";

/** A centred question over a page or a sheet: Cancel beside one confirming button; the server's refusal shows inside it. */
export function Question({
  open,
  title,
  text,
  confirm,
  danger,
  disabled,
  busy,
  error,
  returnFocusId,
  fallbackFocusId,
  onDismiss,
  onConfirm,
  children,
}: {
  open: boolean;
  title: string;
  text: string;
  confirm: string;
  danger?: boolean;
  disabled?: boolean;
  busy: boolean;
  error: string;
  /** Where the focus goes back to when the question closes, and the heading to use if that is gone. */
  returnFocusId: string;
  fallbackFocusId: string;
  onDismiss: () => void;
  onConfirm: () => void;
  children?: ReactNode;
}) {
  return (
    <Overlay
      kind="question"
      open={open}
      title={title}
      busy={busy}
      onDismiss={onDismiss}
      returnFocusId={returnFocusId}
      fallbackFocusId={fallbackFocusId}
      footer={
        <button
          type="button"
          className={`ui-btn ${danger ? "ui-btn-danger-filled" : "ui-btn-primary"}`}
          disabled={busy || disabled}
          onClick={onConfirm}
        >
          {busy ? "Working…" : confirm}
        </button>
      }
    >
      <p>{text}</p>
      {children}
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
    </Overlay>
  );
}

/** A labelled box to type a word or an email into: the gate of every question that cannot be undone at once. */
export function TypedConfirm({
  id,
  label,
  placeholder,
  value,
  busy,
  onChange,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  busy: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="ui-typed">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        disabled={busy}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

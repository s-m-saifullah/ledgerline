import { X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

/** Two lengths only: a confirmation, and a confirmation that holds an Undo (a person needs longer to decide). */
export const toastDuration = (withUndo: boolean) => (withUndo ? 6000 : 4000);

/**
 * A confirmation that dismisses itself. `durationMs` null keeps it open (use that
 * while an action is running, uncertain or has failed, so Retry is never lost).
 * Hovering or focusing the toast pauses the timer and the progress bar. `onDismiss` adds the one Dismiss
 * control (a cross on a phone, the word from 700 px); a notice that must be resumed has neither it nor `onExpire`.
 */
export function Toast({
  label,
  durationMs,
  onExpire,
  onDismiss,
  dismissDisabled = false,
  className = "",
  children,
}: {
  label: string;
  durationMs: number | null;
  onExpire?: () => void;
  onDismiss?: () => void;
  dismissDisabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [paused, setPaused] = useState(false);
  const remaining = useRef(durationMs ?? 0);
  const expire = useRef(onExpire);
  expire.current = onExpire;
  useEffect(() => {
    remaining.current = durationMs ?? 0;
  }, [durationMs]);
  useEffect(() => {
    if (!durationMs || paused) return;
    const started = Date.now();
    const timer = window.setTimeout(
      () => expire.current?.(),
      Math.max(remaining.current, 0),
    );
    return () => {
      window.clearTimeout(timer);
      remaining.current -= Date.now() - started;
    };
  }, [durationMs, paused]);
  return (
    <fieldset
      className={`transaction-toast ${className}`.trim()}
      aria-label={label}
      data-paused={paused || undefined}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      {children}
      {onDismiss && (
        <button
          type="button"
          className="ui-btn ui-btn-secondary toast-dismiss"
          disabled={dismissDisabled}
          onClick={onDismiss}
        >
          <X size={18} aria-hidden="true" />
          <span className="toast-dismiss-word">Dismiss</span>
        </button>
      )}
      {durationMs ? (
        <div className="toast-progress" aria-hidden="true">
          <span style={{ animationDuration: `${durationMs}ms` }} />
        </div>
      ) : null}
    </fieldset>
  );
}

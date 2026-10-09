import { type ReactNode, useEffect, useRef, useState } from "react";

/**
 * A confirmation that dismisses itself. `durationMs` null keeps it open (use that
 * while an action is running, uncertain or has failed, so Retry is never lost).
 * Hovering or focusing the toast pauses the timer and the progress bar.
 */
export function Toast({
  label,
  durationMs,
  onExpire,
  className = "",
  children,
}: {
  label: string;
  durationMs: number | null;
  onExpire: () => void;
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
      () => expire.current(),
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
      {durationMs ? (
        <div className="toast-progress" aria-hidden="true">
          <span style={{ animationDuration: `${durationMs}ms` }} />
        </div>
      ) : null}
    </fieldset>
  );
}

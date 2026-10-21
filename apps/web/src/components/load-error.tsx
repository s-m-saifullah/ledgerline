import { cn } from "@ledgerline/ui";

/** A failed load with one way forward (ADR 0039): the message, and a bordered button that tries again. */
export function LoadError({
  message,
  onRetry,
  retryLabel = "Try again",
  className,
}: {
  message: string;
  onRetry: () => void;
  retryLabel?: string;
  className?: string;
}) {
  return (
    <div role="alert" className={cn("load-error", className)}>
      <p className="load-error-message">{message}</p>
      <button type="button" className="secondary-button" onClick={onRetry}>
        {retryLabel}
      </button>
    </div>
  );
}

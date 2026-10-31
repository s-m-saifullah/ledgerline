import { useEffect, useState } from "react";
import { Overlay } from "./overlay";

/**
 * What stands in for a sheet while what it shows is still loading. A quick load shows nothing at all (the sheet
 * simply opens once it has its data), so there is no placeholder to flash; a slow one shows a plain sheet, and a
 * failure shows at once with a way to try again. Never a centred dialog: the real sheet will take its place.
 */
export function LoadingSheet({
  open,
  title,
  description,
  loadingText,
  failedText,
  failed,
  onRetry,
  onDismiss,
  returnFocusId,
  delayMs = 250,
}: {
  open: boolean;
  title: string;
  description?: string;
  loadingText: string;
  failedText: string;
  failed: boolean;
  onRetry: () => void;
  onDismiss: () => void;
  returnFocusId: string;
  delayMs?: number;
}) {
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!open) {
      setLate(false);
      return;
    }
    const timer = setTimeout(() => setLate(true), delayMs);
    return () => clearTimeout(timer);
  }, [open, delayMs]);
  return (
    <Overlay
      open={open && (failed || late)}
      title={title}
      {...(description ? { description } : {})}
      busy={false}
      onDismiss={onDismiss}
      cancelLabel="Close"
      returnFocusId={returnFocusId}
      fallbackFocusId="main-content"
    >
      <p role={failed ? "alert" : "status"}>
        {failed ? failedText : loadingText}
      </p>
      {failed && (
        <button
          type="button"
          className="ui-btn ui-btn-secondary"
          onClick={onRetry}
        >
          Try again
        </button>
      )}
    </Overlay>
  );
}

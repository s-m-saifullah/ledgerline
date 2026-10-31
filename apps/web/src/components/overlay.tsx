import * as Dialog from "@radix-ui/react-dialog";
import { type ReactNode, useRef } from "react";
import "./overlay.css";

/** What a sheet may start on when no field is named: the first field, else the pinned button. Never Cancel. */
const focusable =
  'input:not([type="hidden"]), select, textarea, button, [href], [tabindex]:not([tabindex="-1"])';

/**
 * The one overlay of the web (ADR 0047). A **sheet** is a bottom sheet on a phone and a right-hand drawer from
 * 700 px (440 px, or 560 px for a wide form); the width decides in CSS, so the same markup serves both. Its
 * parts are always Cancel, a title, an optional action, the content, and one primary button pinned at the
 * bottom. A **question** (delete, archive, write off, sign out others) is a centred dialog with Cancel beside
 * its one confirming button. The focus rules are the editor dialog's, kept as they were: focus goes in, comes
 * back to the opener (or a fallback), Escape closes an open list inside before the dialog, a dialog opened from
 * inside owns its own Escape, and nothing dismisses it while a save is in flight.
 */
export function Overlay({
  open,
  title,
  description,
  busy,
  onDismiss,
  children,
  footer,
  action,
  cancelLabel = "Cancel",
  dismissible = true,
  kind = "sheet",
  size = "default",
  returnFocusId,
  fallbackFocusId,
  initialFocusId,
}: {
  open: boolean;
  title: string;
  /** Read aloud only: a hint is never drawn as a paragraph (ADR 0046). */
  description?: string | undefined;
  busy: boolean;
  onDismiss: () => void;
  children?: ReactNode;
  /** The primary button, pinned at the bottom of a sheet; for a question, the confirming button beside Cancel. */
  footer?: ReactNode;
  /** An optional action in a sheet's header, such as Reset. */
  action?: ReactNode;
  cancelLabel?: string;
  /** False for a step that must be finished, such as backup codes shown only once: no Cancel, and Escape and a click outside do nothing. */
  dismissible?: boolean;
  kind?: "sheet" | "question";
  size?: "default" | "wide";
  returnFocusId: string;
  fallbackFocusId: string;
  initialFocusId?: string | undefined;
}) {
  const opener = useRef<HTMLElement | null>(null);
  const content = useRef<HTMLDivElement | null>(null);
  const question = kind === "question";
  const cancel = (
    <button
      type="button"
      className="ui-btn ui-btn-text ui-sheet-cancel"
      disabled={busy}
      onClick={onDismiss}
    >
      {cancelLabel}
    </button>
  );
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy && dismissible) onDismiss();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="ui-scrim" />
        <Dialog.Content
          ref={content}
          {...(description ? {} : { "aria-describedby": undefined })}
          className={
            question
              ? "ui-question"
              : `ui-sheet${size === "wide" ? " ui-sheet-wide" : ""}`
          }
          onOpenAutoFocus={(event) => {
            opener.current =
              document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null;
            // A question has no body or footer, so it keeps Radix's own choice: Cancel, the safe one.
            const target = initialFocusId
              ? document.getElementById(initialFocusId)
              : content.current?.querySelector<HTMLElement>(
                  `.ui-sheet-body :is(${focusable}), .ui-sheet-foot :is(${focusable})`,
                );
            if (target && !target.matches(":disabled")) {
              event.preventDefault();
              target.focus();
            }
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const target = [
              document.getElementById(returnFocusId),
              opener.current,
              document.getElementById(fallbackFocusId),
            ].find(
              (element) =>
                element?.isConnected &&
                !element.matches(":disabled") &&
                (element.checkVisibility?.() ?? true),
            );
            target?.focus();
          }}
          onEscapeKeyDown={(event) => {
            // Escape closes an open category list first, not the dialog.
            const target = event.target;
            if (
              busy ||
              (target instanceof Element &&
                target.matches('[role="combobox"][aria-expanded="true"]'))
            )
              event.preventDefault();
            // A nested dialog (such as a date picker) owns its own Escape; it must never
            // also close this one, even if both layers see the same key press.
            const nested =
              target instanceof Element
                ? target.closest('[role="dialog"]')
                : null;
            if (nested && nested !== content.current) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (busy) event.preventDefault();
          }}
        >
          {description ? (
            <Dialog.Description className="sr-only">
              {description}
            </Dialog.Description>
          ) : null}
          {question ? (
            <>
              <Dialog.Title className="ui-question-title">{title}</Dialog.Title>
              {children}
              <div className="ui-question-actions">
                {cancel}
                {footer}
              </div>
            </>
          ) : (
            <>
              <div className="ui-grab" aria-hidden="true" />
              <div className="ui-sheet-head">
                {dismissible ? cancel : <span aria-hidden="true" />}
                <Dialog.Title className="ui-sheet-title">{title}</Dialog.Title>
                <div className="ui-sheet-action">{action}</div>
              </div>
              <div className="ui-sheet-body">{children}</div>
              {footer && <div className="ui-sheet-foot">{footer}</div>}
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

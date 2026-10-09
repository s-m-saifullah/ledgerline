import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { type ReactNode, useRef } from "react";

export function EditorDialog({
  open,
  title,
  description,
  busy,
  onDismiss,
  children,
  returnFocusId,
  closeLabel,
  fallbackFocusId,
  initialFocusId,
  contentClassName,
}: {
  open: boolean;
  title: string;
  description: string;
  busy: boolean;
  onDismiss: () => void;
  children: ReactNode;
  returnFocusId: string;
  closeLabel: string;
  fallbackFocusId: string;
  initialFocusId?: string | undefined;
  contentClassName?: string | undefined;
}) {
  const opener = useRef<HTMLElement | null>(null);
  const content = useRef<HTMLDivElement | null>(null);
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onDismiss();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          ref={content}
          className={`account-dialog${contentClassName ? ` ${contentClassName}` : ""}`}
          onOpenAutoFocus={(event) => {
            opener.current =
              document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null;
            if (initialFocusId) {
              const target = document.getElementById(initialFocusId);
              if (target && !target.matches(":disabled")) {
                event.preventDefault();
                target.focus();
              }
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
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Description className="muted">
            {description}
          </Dialog.Description>
          {children}
          <button
            type="button"
            className="dialog-close icon-button"
            aria-label={closeLabel}
            disabled={busy}
            onClick={onDismiss}
          >
            <X size={20} />
          </button>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

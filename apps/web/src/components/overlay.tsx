import * as Dialog from "@radix-ui/react-dialog";
import { type ReactNode, useLayoutEffect, useRef } from "react";
import "./overlay.css";
import { useSheetDrag } from "./sheet-drag";

/** What a sheet may start on when no field is named: the first field, else the pinned button. Never Cancel. */
const focusable =
  'input:not([type="hidden"]), select, textarea, button, [href], [tabindex]:not([tabindex="-1"])';

/** The longest a leaving overlay's animation can last (overlay.css says 0.2 s), so a missing `animationend` never leaves a copy behind. */
const LEAVE_MS = 400;

/** A sheet that was dragged off the screen has already left: it is not drawn again to slide out. */
const DRAGGED_AWAY = /translateY\((?!0(px)?\))/;

/** Puts a copy in the body, and takes it out when its own animation ends (a child's ending does not count) or after `LEAVE_MS`. */
function leave(copy: HTMLElement) {
  const remove = () => copy.remove();
  copy.addEventListener("animationend", (event) => {
    if (event.target === copy) remove();
  });
  setTimeout(remove, LEAVE_MS);
  document.body.append(copy);
}

/** Cloning copies what a person typed (the live values), so the sheet that slides away is the sheet that was there; a password must not be. */
function clearPasswords(copy: Element) {
  for (const field of copy.querySelectorAll('input[type="password"]')) {
    // The `value` attribute is kept in step with what was typed by React, and a clone copies it.
    field.removeAttribute("value");
    (field as HTMLInputElement).value = "";
  }
}

/**
 * Most sheets are not kept mounted while closed: their page simply stops drawing them, so Radix never gets to play an
 * exit animation and the dark overlay and the sheet itself would vanish in one frame. Two copies are left in the body
 * instead, in the same place: a bare copy of the dark overlay, and a picture of the sheet (its own class, `ui-sheet-out`,
 * so nothing that looks for the open sheet finds it). The CSS fades the first and slides the second out
 * (`data-state="closed"`, and they let every tap through), and each removes itself when its animation ends. The copy
 * of the sheet is hidden from assistive technology, cannot take focus, has no ids, and nothing marked `data-secret`
 * (a temporary password, backup codes, the authenticator key) or linking with it is copied. A person who asked for less
 * motion gets no copies, so nothing lingers.
 */
function leaveCopies({
  scrim,
  panel,
  question,
}: {
  scrim: HTMLElement | null;
  panel: HTMLElement | null;
  question: boolean;
}) {
  if (
    typeof matchMedia !== "function" ||
    matchMedia("(prefers-reduced-motion: reduce)").matches
  )
    return;
  if (scrim) {
    const copy = scrim.cloneNode(false) as HTMLElement;
    // Radix gives the overlay an inline `pointer-events: auto`, which would beat the CSS that lets taps through.
    copy.removeAttribute("style");
    copy.setAttribute("data-state", "closed");
    copy.setAttribute("aria-hidden", "true");
    leave(copy);
  }
  if (!panel || DRAGGED_AWAY.test(panel.style.transform)) return;
  const copy = panel.cloneNode(true) as HTMLElement;
  clearPasswords(copy);
  for (const secret of copy.querySelectorAll("[data-secret]"))
    secret.replaceChildren();
  for (const link of copy.querySelectorAll("[href]"))
    link.removeAttribute("href");
  for (const named of [copy, ...copy.querySelectorAll("[id]")])
    named.removeAttribute("id");
  copy.removeAttribute("style");
  copy.removeAttribute("role");
  copy.classList.replace(
    question ? "ui-question" : "ui-sheet",
    question ? "ui-question-out" : "ui-sheet-out",
  );
  copy.setAttribute("data-state", "closed");
  copy.setAttribute("aria-hidden", "true");
  copy.setAttribute("inert", "");
  leave(copy);
}

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
  const scrim = useRef<HTMLDivElement | null>(null);
  // The newest `open`, to see it go from open to closed (and to know, at an unmount, whether it was still open).
  const wasOpen = useRef(open);
  const alive = useRef(false);
  // Closed in place, the sheet is gone at once (the page behind is usable at that moment); its copy slides away. The
  // dark overlay of a sheet that stays mounted is faded out by Radix itself (overlay.css), so no copy of that is needed.
  useLayoutEffect(() => {
    if (wasOpen.current && !open)
      leaveCopies({
        scrim: null,
        panel: content.current,
        question: kindRef.current === "question",
      });
    wasOpen.current = open;
  }, [open]);
  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (!wasOpen.current) return;
      const copies = {
        scrim: scrim.current,
        panel: content.current,
        question: kindRef.current === "question",
      };
      // In development StrictMode runs this cleanup and the setup again at once: only a real unmount is still not
      // alive when the microtask runs.
      queueMicrotask(() => {
        if (!alive.current) leaveCopies(copies);
      });
    };
  }, []);
  const question = kind === "question";
  const kindRef = useRef(kind);
  kindRef.current = kind;
  // A sheet follows a finger dragged down from its handle or title bar, and closes when the handle is tapped (a drawer
  // has no handle, so nothing happens there). Not for a question, a step nobody may dismiss or a save in flight.
  const { gesture, tap } = useSheetDrag({
    sheet: content,
    enabled: !question && dismissible && !busy,
    onClose: onDismiss,
  });
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
        <Dialog.Overlay ref={scrim} className="ui-scrim" />
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
              {/* biome-ignore lint/a11y/noStaticElementInteractions: a pointer affordance; the keyboard's ways out are Cancel and Escape */}
              {/* biome-ignore lint/a11y/useKeyWithClickEvents: the same: a tap on the handle repeats what Cancel does */}
              <div
                className="ui-grab"
                aria-hidden="true"
                onClick={tap}
                {...gesture}
              />
              <div className="ui-sheet-head" {...gesture}>
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

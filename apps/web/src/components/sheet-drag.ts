import { type PointerEvent, type RefObject, useRef } from "react";

/** A press that moves less than this is a tap, not a drag. */
export const TAP_SLOP = 6;
/** A drag further than this share of the sheet's height closes it. */
const CLOSE_SHARE = 0.4;
/** A quicker, shorter drag (a flick) closes it too: pixels per millisecond over the last 150 ms, and the least distance. */
const FLICK_SPEED = 0.5;
const FLICK_DISTANCE = 24;
const FLICK_WINDOW_MS = 150;

/** What lifting the finger does after a drag down by `dy` px of a sheet `height` px tall. */
export function releaseOutcome({
  dy,
  height,
  speed,
}: {
  dy: number;
  height: number;
  speed: number;
}): "close" | "back" {
  if (dy >= height * CLOSE_SHARE) return "close";
  if (dy >= FLICK_DISTANCE && speed >= FLICK_SPEED) return "close";
  return "back";
}

/** Pixels per millisecond downwards over the last 150 ms of a drag, from `[time, y]` samples. */
export function dragSpeed(samples: readonly (readonly [number, number])[]) {
  const last = samples[samples.length - 1];
  if (!last) return 0;
  const first = samples.find(([time]) => last[0] - time <= FLICK_WINDOW_MS);
  if (!first || last[0] === first[0]) return 0;
  return (last[1] - first[1]) / (last[0] - first[0]);
}

const interactive =
  'button, a, input, select, textarea, [role="combobox"], [role="switch"]';
const reduced = () =>
  typeof matchMedia === "function" &&
  matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * A bottom sheet follows a finger (or a mouse) dragged down from its handle or its title bar, and either closes or
 * springs back; tapping the handle closes it. Whether the sheet is a bottom sheet or a drawer is decided by the CSS
 * (the handle is hidden from 700 px), so the same markup serves both and nothing here branches on the width: a
 * hidden handle means a drawer, and nothing happens. The body is never a drag area, so it scrolls as usual.
 * `enabled` is false for a question, for a step nobody may dismiss and while a save is in flight.
 */
export function useSheetDrag({
  sheet,
  enabled,
  onClose,
}: {
  sheet: RefObject<HTMLElement | null>;
  enabled: boolean;
  onClose: () => void;
}) {
  const drag = useRef<{
    pointer: number;
    startY: number;
    moved: boolean;
    samples: [number, number][];
  } | null>(null);
  const dragged = useRef(false);
  const closing = useRef(false);
  // Each press counts: a spring-back still finishing from the last drag must not clear the next one.
  const press = useRef(0);

  const isSheet = () => {
    const handle = sheet.current?.querySelector<HTMLElement>(".ui-grab");
    return !!handle && getComputedStyle(handle).display !== "none";
  };
  const settle = (node: HTMLElement, to: string, then: () => void) => {
    if (reduced()) {
      node.style.transform = to;
      then();
      return;
    }
    node.style.transition = "transform 0.18s ease-out";
    node.style.transform = to;
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      node.removeEventListener("transitionend", done);
      then();
    };
    node.addEventListener("transitionend", done);
    setTimeout(done, 260);
  };
  const clear = (node: HTMLElement) => {
    node.style.transform = "";
    node.style.transition = "";
    node.style.animation = "";
  };

  const start = (event: PointerEvent<HTMLElement>) => {
    const node = sheet.current;
    if (!enabled || !node || closing.current || event.button !== 0) return;
    if (!isSheet()) return;
    if (
      event.target instanceof Element &&
      event.currentTarget !== event.target &&
      event.target.closest(interactive)
    )
      return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    node.style.animation = "none";
    node.style.transition = "none";
    press.current += 1;
    drag.current = {
      pointer: event.pointerId,
      startY: event.clientY,
      moved: false,
      samples: [[event.timeStamp, event.clientY]],
    };
  };
  const move = (event: PointerEvent<HTMLElement>) => {
    const node = sheet.current;
    const current = drag.current;
    if (!node || !current || current.pointer !== event.pointerId) return;
    const delta = event.clientY - current.startY;
    if (Math.abs(delta) > TAP_SLOP) current.moved = true;
    current.samples.push([event.timeStamp, event.clientY]);
    if (current.samples.length > 12) current.samples.shift();
    // It follows the finger down; upward it stays where it is.
    node.style.transform = delta > 0 ? `translateY(${delta}px)` : "";
  };
  const end = (event: PointerEvent<HTMLElement>, cancelled: boolean) => {
    const node = sheet.current;
    const current = drag.current;
    if (!node || !current || current.pointer !== event.pointerId) return;
    drag.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (!current.moved) {
      clear(node);
      return;
    }
    // A drag that ends over the handle is followed by a click: it is not a tap.
    dragged.current = true;
    setTimeout(() => {
      dragged.current = false;
    }, 0);
    const dy = Math.max(0, event.clientY - current.startY);
    const height = node.getBoundingClientRect().height;
    const outcome = cancelled
      ? "back"
      : releaseOutcome({
          dy,
          height,
          // The lift counts as a sample: a finger that stopped before lifting is not a flick.
          speed: dragSpeed([
            ...current.samples,
            [event.timeStamp, event.clientY],
          ]),
        });
    if (outcome === "close") {
      closing.current = true;
      settle(node, `translateY(${height}px)`, () => {
        closing.current = false;
        onClose();
        // If the parent did not close it after all, it comes back rather than staying out of sight.
        setTimeout(() => {
          if (node.isConnected) clear(node);
        }, 400);
      });
    } else {
      const mine = press.current;
      settle(node, "translateY(0px)", () => {
        if (mine === press.current) clear(node);
      });
    }
  };

  const gesture = {
    onPointerDown: start,
    onPointerMove: move,
    onPointerUp: (event: PointerEvent<HTMLElement>) => end(event, false),
    onPointerCancel: (event: PointerEvent<HTMLElement>) => end(event, true),
  };
  return {
    gesture,
    /** Tapping the handle closes the sheet; the click that follows a drag is not a tap. */
    tap: () => {
      if (dragged.current) {
        dragged.current = false;
        return;
      }
      if (enabled && !closing.current && isSheet()) onClose();
    },
  };
}

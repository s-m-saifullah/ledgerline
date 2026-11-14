import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Toast, toastDuration } from "./toast";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

it("expires after its duration and shows a draining progress bar", () => {
  const expire = vi.fn();
  const { container } = render(
    <Toast label="Saved" durationMs={3000} onExpire={expire}>
      <p role="status">Saved.</p>
    </Toast>,
  );
  const bar = container.querySelector<HTMLElement>(".toast-progress span");
  expect(bar?.style.animationDuration).toBe("3000ms");
  advance(2999);
  expect(expire).not.toHaveBeenCalled();
  advance(1);
  expect(expire).toHaveBeenCalledOnce();
});
it("pauses while hovered or focused and resumes with the time that was left", () => {
  const expire = vi.fn();
  render(
    <Toast label="Saved" durationMs={5000} onExpire={expire}>
      <button type="button">Undo</button>
    </Toast>,
  );
  const toast = screen.getByRole("group", { name: "Saved" });
  advance(2000);
  fireEvent.mouseEnter(toast);
  expect(toast).toHaveAttribute("data-paused");
  advance(60_000);
  expect(expire).not.toHaveBeenCalled();
  fireEvent.mouseLeave(toast);
  advance(2999);
  expect(expire).not.toHaveBeenCalled();
  advance(1);
  expect(expire).toHaveBeenCalledOnce();
});
it("stays open and shows no bar while an action is running or uncertain (duration null)", () => {
  const expire = vi.fn();
  const { container, rerender } = render(
    <Toast label="Saved" durationMs={3000} onExpire={expire}>
      <p>Saved.</p>
    </Toast>,
  );
  advance(1000);
  rerender(
    <Toast label="Saved" durationMs={null} onExpire={expire}>
      <p>Saved.</p>
    </Toast>,
  );
  expect(container.querySelector(".toast-progress")).toBeNull();
  advance(60_000);
  expect(expire).not.toHaveBeenCalled();
  rerender(
    <Toast label="Saved" durationMs={3000} onExpire={expire}>
      <p>Saved.</p>
    </Toast>,
  );
  advance(3000);
  expect(expire).toHaveBeenCalledOnce();
});
it("always calls the latest onExpire without restarting the countdown", () => {
  const first = vi.fn();
  const second = vi.fn();
  const { rerender } = render(
    <Toast label="Saved" durationMs={3000} onExpire={first}>
      <p>Saved.</p>
    </Toast>,
  );
  advance(1500);
  rerender(
    <Toast label="Saved" durationMs={3000} onExpire={second}>
      <p>Saved.</p>
    </Toast>,
  );
  advance(1500);
  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledOnce();
});

it("has one Dismiss control, drawn as a cross on a phone and as the word from 700 px, that calls onDismiss", () => {
  const dismiss = vi.fn();
  const { container } = render(
    <Toast label="Saved" durationMs={4000} onDismiss={dismiss}>
      <p role="status">Saved.</p>
    </Toast>,
  );
  const button = screen.getByRole("button", { name: "Dismiss" });
  expect(button).toHaveClass("ui-btn", "ui-btn-secondary", "toast-dismiss");
  // One control holding both: the cross (hidden from assistive technology) and the word (what names it).
  expect(button.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  expect(button.querySelector(".toast-dismiss-word")).toHaveTextContent(
    "Dismiss",
  );
  expect(container.querySelectorAll(".toast-dismiss")).toHaveLength(1);
  fireEvent.click(button);
  expect(dismiss).toHaveBeenCalledOnce();
});
it("has no Dismiss control without onDismiss, and a disabled one while an action is running", () => {
  const { rerender } = render(
    <Toast label="Needs confirmation" durationMs={null}>
      <p role="status">A client action needs confirmation.</p>
    </Toast>,
  );
  expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
  rerender(
    <Toast label="Saved" durationMs={null} onDismiss={() => {}} dismissDisabled>
      <p role="status">Saved.</p>
    </Toast>,
  );
  expect(screen.getByRole("button", { name: "Dismiss" })).toBeDisabled();
});
it("never expires when it has no onExpire (a notice that must be resumed)", () => {
  render(
    <Toast label="Needs confirmation" durationMs={null}>
      <p role="status">Waiting.</p>
    </Toast>,
  );
  advance(120_000);
  expect(
    screen.getByRole("group", { name: "Needs confirmation" }),
  ).toBeTruthy();
});
it("has two lengths: 4 seconds, and 6 seconds when it holds an Undo", () => {
  expect(toastDuration(false)).toBe(4000);
  expect(toastDuration(true)).toBe(6000);
});

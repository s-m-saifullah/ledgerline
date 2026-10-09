import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Toast } from "./toast";

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

import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LoadingSheet } from "./loading-sheet";

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const sheet = (
  props: Partial<React.ComponentProps<typeof LoadingSheet>> = {},
) => (
  <LoadingSheet
    open
    title="Transaction details"
    loadingText="Loading entry…"
    failedText="Couldn't load this entry."
    failed={false}
    onRetry={() => {}}
    onDismiss={() => {}}
    returnFocusId="x"
    {...props}
  />
);

it("shows nothing while a load is quick, so a fast open never flashes a placeholder", () => {
  render(sheet());
  expect(screen.queryByRole("dialog")).toBeNull();
  act(() => vi.advanceTimersByTime(200));
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("shows a sheet once the load is slow", () => {
  render(sheet());
  act(() => vi.advanceTimersByTime(300));
  expect(
    screen.getByRole("dialog", { name: "Transaction details" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Loading entry…");
});

it("shows a failure at once, with a way to try again and to close", async () => {
  const onRetry = vi.fn();
  render(sheet({ failed: true, onRetry }));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Couldn't load this entry.",
  );
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(onRetry).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
});

it("is a sheet, never a centred dialog", () => {
  render(sheet({ failed: true }));
  expect(screen.getByRole("dialog").className).toContain("ui-sheet");
});

it("stays away when closed", () => {
  render(sheet({ open: false, failed: true }));
  expect(screen.queryByRole("dialog")).toBeNull();
});

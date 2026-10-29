import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { MonthControl } from "./month-control";

afterEach(cleanup);

it("shows the month in a polite live region", () => {
  render(<MonthControl month="2026-10" onChange={() => {}} />);
  const label = screen.getByText("October 2026");
  expect(label).toHaveAttribute("aria-live", "polite");
  expect(label).toHaveClass("ui-month-label");
});

it("moves a month back and forward with the same button names as before", async () => {
  const onChange = vi.fn();
  render(<MonthControl month="2026-01" onChange={onChange} />);
  await userEvent.click(screen.getByRole("button", { name: "Previous month" }));
  expect(onChange).toHaveBeenLastCalledWith("2025-12");
  await userEvent.click(screen.getByRole("button", { name: "Next month" }));
  expect(onChange).toHaveBeenLastCalledWith("2026-02");
});

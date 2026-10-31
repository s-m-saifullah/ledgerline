import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { MonthHead } from "./month-head";

afterEach(cleanup);

it("is the page's one h1 with the month control after it", () => {
  render(
    <MonthHead
      title="Budgets"
      id="budgets-title"
      month="2026-10"
      onChange={vi.fn()}
    />,
  );
  const title = screen.getByRole("heading", { level: 1, name: "Budgets" });
  expect(title).toHaveAttribute("id", "budgets-title");
  // Focusable for the shell to move focus to it after navigation.
  expect(title).toHaveAttribute("tabindex", "-1");
  expect(screen.getByText("October 2026")).toBeInTheDocument();
  expect(
    title.compareDocumentPosition(
      screen.getByRole("button", { name: "Previous month" }),
    ) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});

it("moves a month at a time, across a year", async () => {
  const onChange = vi.fn();
  render(
    <MonthHead
      title="Insights"
      id="insights-title"
      month="2026-01"
      onChange={onChange}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Previous month" }));
  expect(onChange).toHaveBeenLastCalledWith("2025-12");
  await userEvent.click(screen.getByRole("button", { name: "Next month" }));
  expect(onChange).toHaveBeenLastCalledWith("2026-02");
});

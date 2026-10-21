import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { LoadError } from "./load-error";

afterEach(cleanup);

it("shows the message as an alert with a bordered retry button", async () => {
  const retry = vi.fn();
  render(<LoadError message="Couldn't load clients." onRetry={retry} />);
  expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load clients.");
  const button = screen.getByRole("button", { name: "Try again" });
  expect(button).toHaveClass("secondary-button");
  await userEvent.click(button);
  expect(retry).toHaveBeenCalledTimes(1);
});

it("takes its own button label and an extra class", () => {
  render(
    <LoadError
      message="Couldn't load payment choices."
      onRetry={vi.fn()}
      retryLabel="Reload choices"
      className="shell-ledger-error"
    />,
  );
  expect(screen.getByRole("alert")).toHaveClass(
    "load-error",
    "shell-ledger-error",
  );
  expect(
    screen.getByRole("button", { name: "Reload choices" }),
  ).toBeInTheDocument();
});

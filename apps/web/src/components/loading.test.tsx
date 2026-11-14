import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { Loading } from "./loading";

afterEach(cleanup);

it("says what is loading, as a polite status", () => {
  render(<Loading what="tags" />);
  const status = screen.getByRole("status");
  expect(status).toHaveTextContent("Loading tags…");
  expect(status).toHaveAttribute("aria-live", "polite");
});

it("shows what it is given (a skeleton) under the words, hidden from assistive technology by its owner", () => {
  render(
    <Loading what="your overview">
      <div data-testid="skeleton" aria-hidden="true" />
    </Loading>,
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "Loading your overview…",
  );
  expect(screen.getByTestId("skeleton")).toBeInTheDocument();
});

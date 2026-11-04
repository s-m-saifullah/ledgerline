import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import { Fold } from "./fold";

afterEach(cleanup);

it("is shut by default, with its summary showing and its rows inside", () => {
  const { container } = render(
    <Fold summary="2 archived">
      <p>First</p>
      <p>Second</p>
    </Fold>,
  );
  const details = container.querySelector("details") as HTMLDetailsElement;
  expect(details.open).toBe(false);
  expect(details).toHaveClass("ui-card", "ui-fold");
  expect(screen.getByText("2 archived").closest("summary")).not.toBeNull();
  expect(details.querySelector(".ui-fold-body")).toHaveTextContent(
    "FirstSecond",
  );
});

it("opens and shuts when the summary is pressed", async () => {
  const user = userEvent.setup();
  const { container } = render(
    <Fold summary="1 recently deleted">
      <p>Row</p>
    </Fold>,
  );
  const details = container.querySelector("details") as HTMLDetailsElement;
  await user.click(screen.getByText("1 recently deleted"));
  expect(details.open).toBe(true);
  await user.click(screen.getByText("1 recently deleted"));
  expect(details.open).toBe(false);
});

it("hides the chevron from assistive technology", () => {
  const { container } = render(<Fold summary="x">y</Fold>);
  expect(container.querySelector("summary svg")).toHaveAttribute(
    "aria-hidden",
    "true",
  );
});

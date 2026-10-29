import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { TopBar } from "./top-bar";

afterEach(cleanup);

it("is the page's one heading", () => {
  render(<TopBar title="Budgets" />);
  expect(
    screen.getByRole("heading", { level: 1, name: "Budgets" }),
  ).toHaveClass("ui-topbar-title");
});

it("puts a back control before the title and the tools after it", () => {
  const { container } = render(
    <TopBar
      title="Clients"
      back={<a href="/more">Back to More</a>}
      tools={<button type="button">Hide amounts</button>}
    />,
  );
  const order = [...container.querySelectorAll("a, h1, button")].map(
    (node) => node.textContent,
  );
  expect(order).toEqual(["Back to More", "Clients", "Hide amounts"]);
});

it("has no tools wrapper when there are none", () => {
  const { container } = render(<TopBar title="Home" />);
  expect(container.querySelector(".ui-topbar-tools")).toBeNull();
});

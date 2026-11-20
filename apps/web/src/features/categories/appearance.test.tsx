import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CategoryMark } from "./appearance";

afterEach(cleanup);

// The mark in front of a category is the shared tile (WP-11e, the prototype's `tile`): the same 36 px soft-accent
// square as every other icon lead, with the chosen icon and a small dot in the chosen color.
describe("the mark in front of a category", () => {
  it("is the shared tile with the chosen icon and a dot in the chosen color", () => {
    const { container } = render(<CategoryMark icon="home" color="#2563EB" />);
    const mark = container.firstElementChild as HTMLElement;
    expect(mark).toHaveClass("ui-tile");
    expect(mark).toHaveAttribute("aria-hidden", "true");
    expect(mark.querySelector("svg")).not.toBeNull();
    const dots = mark.querySelectorAll<HTMLElement>("span");
    expect(dots).toHaveLength(1);
    expect(dots[0]?.style.backgroundColor).toBe("rgb(37, 99, 235)");
  });
  it("falls back to a plain circle and the muted dot", () => {
    const { container } = render(<CategoryMark icon={null} color={null} />);
    const mark = container.firstElementChild as HTMLElement;
    expect(mark).toHaveClass("ui-tile");
    expect(mark.querySelector("svg")).not.toBeNull();
    expect(mark.querySelector("span")?.style.backgroundColor).toBe(
      "var(--muted)",
    );
  });
  it("is not the old 40 px grey mark", () => {
    const { container } = render(<CategoryMark icon="home" color="#2563EB" />);
    expect(
      container.querySelector(".category-mark, .category-swatch"),
    ).toBeNull();
  });
});

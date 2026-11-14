import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SearchField } from "./search-field";

afterEach(cleanup);

it("is a search landmark with a hidden label, an icon and a search box", () => {
  const { container } = render(
    <SearchField
      id="client-search"
      label="Search clients"
      value="sam"
      onChange={vi.fn()}
    />,
  );
  // jsdom does not give the `search` element its landmark role, so look for the element.
  expect(container.querySelector("search.ui-search")).not.toBeNull();
  const box = screen.getByRole("searchbox", { name: "Search clients" });
  expect(box).toHaveValue("sam");
  expect(box).toHaveAttribute("id", "client-search");
  // The label is for screen readers; the placeholder shows the same words.
  expect(screen.getByText("Search clients", { selector: "label" })).toHaveClass(
    "sr-only",
  );
  expect(box).toHaveAttribute("placeholder", "Search clients");
  expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
});

it("reports what is typed, and takes its own placeholder and length", () => {
  const change = vi.fn();
  render(
    <SearchField
      id="tag-search"
      label="Search tags"
      placeholder="Find a tag"
      maxLength={40}
      value=""
      onChange={change}
    />,
  );
  const box = screen.getByRole("searchbox", { name: "Search tags" });
  expect(box).toHaveAttribute("placeholder", "Find a tag");
  expect(box).toHaveAttribute("maxlength", "40");
  expect(box).toHaveAttribute("autocomplete", "off");
  fireEvent.change(box, { target: { value: "trip" } });
  expect(change).toHaveBeenCalledWith("trip");
});

it("can sit in a form beside a button without being a landmark of its own", () => {
  render(
    <form aria-label="Find">
      <SearchField id="q" label="Search" value="" onChange={vi.fn()} />
      <button type="submit">Go</button>
    </form>,
  );
  expect(screen.getByRole("searchbox", { name: "Search" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Go" })).toBeTruthy();
});

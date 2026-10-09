import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { CategoryMark } from "./appearance";
import { category } from "./fixtures.test-helper";
import { CategoryPicker } from "./picker";

const root = category("Food");
const child = category("Groceries", { parentId: root.id });
const old = category("Archived", { archivedAt: "2026-10-07T00:00:00.000Z" });
const income = category("Salary", { kind: "income" });
afterEach(cleanup);
it("filters inside the field, excludes archives/wrong kinds and supports keyboard selection", async () => {
  const change = vi.fn();
  render(
    <CategoryPicker
      categories={[root, child, old, income]}
      kind="expense"
      value={null}
      onChange={change}
    />,
  );
  const box = screen.getByRole("combobox", { name: "Category" });
  expect(box).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByLabelText(/^Search/)).not.toBeInTheDocument();
  await userEvent.click(box);
  expect(box).toHaveAttribute("aria-expanded", "true");
  expect(screen.getAllByRole("option")).toHaveLength(2);
  expect(
    screen.queryByRole("option", { name: "Archived" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("option", { name: "Salary" }),
  ).not.toBeInTheDocument();
  await userEvent.type(box, "gro");
  expect(
    screen.getByRole("option", { name: "Food / Groceries" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("option", { name: "Food" }),
  ).not.toBeInTheDocument();
  await userEvent.keyboard("{Enter}");
  expect(change).toHaveBeenCalledWith(child.id);
  expect(box).toHaveAttribute("aria-expanded", "false");
});
it("moves with arrow keys, closes with Escape and shows an empty state", async () => {
  const change = vi.fn();
  render(
    <CategoryPicker
      categories={[root, child]}
      kind="expense"
      value={null}
      onChange={change}
    />,
  );
  const box = screen.getByRole("combobox", { name: "Category" });
  await userEvent.click(box);
  await userEvent.keyboard("{ArrowDown}{Enter}");
  expect(change).toHaveBeenCalledWith(child.id);
  await userEvent.click(box);
  await userEvent.keyboard("{Escape}");
  expect(box).toHaveAttribute("aria-expanded", "false");
  expect(change).toHaveBeenCalledTimes(1);
  await userEvent.type(box, "zzz");
  expect(screen.getByRole("status")).toHaveTextContent(
    "No matching active categories.",
  );
  await userEvent.keyboard("{Enter}");
  expect(change).toHaveBeenCalledTimes(1);
});
it("offers No parent only when allowed and keeps a selected archived label readable", async () => {
  const change = vi.fn();
  render(
    <CategoryPicker
      categories={[root, old]}
      kind="expense"
      value={old.id}
      allowNone
      onChange={change}
    />,
  );
  const box = screen.getByRole("combobox", { name: "Category" });
  expect(box).toHaveValue("Archived (archived)");
  await userEvent.click(box);
  await userEvent.click(
    screen.getByRole("option", { name: "No parent (top level)" }),
  );
  expect(change).toHaveBeenCalledWith(null);
});
it("limits parent choices to active roots and excludes the category itself", async () => {
  render(
    <CategoryPicker
      categories={[root, child, old, income]}
      kind="expense"
      value={null}
      rootsOnly
      allowNone
      excludeId={root.id}
      onChange={vi.fn()}
    />,
  );
  await userEvent.click(screen.getByRole("combobox"));
  expect(screen.getAllByRole("option")).toHaveLength(1);
  expect(
    screen.getByRole("option", { name: "No parent (top level)" }),
  ).toBeInTheDocument();
});

it("renders unknown and inherited-property icon names with a safe fallback", () => {
  const { container } = render(
    <CategoryMark icon="constructor" color="#2563EB" />,
  );
  expect(container.querySelector("svg")).toBeInTheDocument();
});
it("limits child merge destinations to active children of active parents while retaining their paths", async () => {
  const hidden = category("Hidden", { parentId: old.id });
  render(
    <CategoryPicker
      categories={[root, child, old, hidden, income]}
      kind="expense"
      value={null}
      childrenOnly
      onChange={vi.fn()}
    />,
  );
  await userEvent.click(screen.getByRole("combobox"));
  expect(
    screen.getByRole("option", { name: "Food / Groceries" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("option", { name: "Food" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("option", { name: /Hidden/ }),
  ).not.toBeInTheDocument();
});

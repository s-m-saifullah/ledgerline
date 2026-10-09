import { type Category, newId } from "@ledgerline/shared";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/** Open the category combobox, optionally type to filter, and pick an option by its (end of) label. */
export async function chooseCategory(label: string, name: string, filter = "") {
  const box = await screen.findByLabelText(label, { exact: true });
  await userEvent.click(box);
  if (filter) await userEvent.type(box, filter);
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const list = within(
    await screen.findByRole("listbox", { name: `${label} options` }),
  );
  const exact = list.queryByRole("option", { name });
  await userEvent.click(
    exact ??
      (await list.findByRole("option", {
        name: new RegExp(`(^|/ )${escaped}$`),
      })),
  );
}
export const ledgerId = newId();
export const category = (
  name: string,
  overrides: Partial<Category> = {},
): Category => ({
  id: newId(),
  ledgerId,
  name,
  kind: "expense",
  parentId: null,
  icon: "utensils",
  color: "#0D9488",
  sortOrder: 0,
  archivedAt: null,
  version: 1,
  createdAt: "2026-10-07T00:00:00.000Z",
  updatedAt: "2026-10-07T00:00:00.000Z",
  ...overrides,
});
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

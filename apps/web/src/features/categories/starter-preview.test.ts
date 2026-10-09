import { categoryStarterGroups } from "@ledgerline/shared";
import { expect, it } from "vitest";
import { categoryColors, categoryIcons } from "./appearance";

it("every starter icon and color is one the category editor can show", () => {
  for (const group of categoryStarterGroups) {
    expect(Object.hasOwn(categoryIcons, group.icon)).toBe(true);
    expect(categoryColors.some((color) => color.value === group.color)).toBe(
      true,
    );
  }
});

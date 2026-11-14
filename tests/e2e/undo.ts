import type { Page } from "@playwright/test";

/**
 * The Undo of a deleted transaction: the one in the history toast, or in the pill that stays after it. Two toasts can
 * be up at once (the one for a save has an Undo too), and every Undo is just called Undo, so a spec names which.
 */
export const deleteUndo = (page: Page) =>
  page
    .locator('[aria-label="Transaction history notification"], .undo-pill')
    .getByRole("button", { name: "Undo", exact: true });

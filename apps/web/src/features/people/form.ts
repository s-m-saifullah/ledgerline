import { type Category, parseMinorUnits } from "@ledgerline/shared";
import { cleanAmountText } from "../accounts/money";
export function paymentDefault(
  categories: Category[],
  remembered: string | null,
) {
  return (
    categories.find(
      (c) => c.id === remembered && c.kind === "income" && !c.archivedAt,
    )?.id ??
    categories.find(
      (c) =>
        !c.archivedAt &&
        c.kind === "income" &&
        !c.parentId &&
        c.name.trim().toLowerCase() === "services",
    )?.id ??
    ""
  );
}
export function positiveCents(text: string) {
  const cleaned = cleanAmountText(text);
  if (!/^\d+(?:\.\d{1,2})?$/.test(cleaned))
    throw new Error(
      "Enter a positive USD amount with up to two decimal places.",
    );
  const amount = parseMinorUnits(cleaned);
  if (amount <= 0) throw new Error("Enter a positive USD amount.");
  return { amount, currency: "USD" as const };
}

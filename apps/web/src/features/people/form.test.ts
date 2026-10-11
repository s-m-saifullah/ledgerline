import { categorySchema, newId } from "@ledgerline/shared";
import { describe, expect, it } from "vitest";
import { paymentDefault, positiveCents, positiveMoney } from "./form";

const category = (
  name: string,
  kind: "income" | "expense" = "income",
  archivedAt: string | null = null,
) =>
  categorySchema.parse({
    id: newId(),
    ledgerId: newId(),
    name,
    kind,
    parentId: null,
    icon: null,
    color: null,
    sortOrder: 0,
    archivedAt,
    version: 1,
    createdAt: "2026-10-07T00:00:00.000Z",
    updatedAt: "2026-10-07T00:00:00.000Z",
  });
describe("payment entry choices", () => {
  it("preserves exact decimal cents at maximum without rounding", () => {
    expect(positiveCents("90071992547409.91").amount).toBe(
      Number.MAX_SAFE_INTEGER,
    );
    for (const text of ["0", "-1", "1.001", "90071992547409.92"])
      expect(() => positiveCents(text)).toThrow();
  });
  it("defaults by eligible ID before Services; excludes archive and expense collisions", () => {
    const wrong = category("Services", "expense"),
      old = category("Services", "income", "2026-10-07T00:00:00.000Z"),
      services = category(" Services "),
      renamed = category("Consulting");
    expect(paymentDefault([wrong, old], old.id)).toBe("");
    expect(paymentDefault([wrong, old, services], null)).toBe(services.id);
    expect(paymentDefault([services, renamed], renamed.id)).toBe(renamed.id);
  });
});
describe("amounts in the item's own currency", () => {
  it("reads each currency's own decimal places", () => {
    expect(positiveMoney("12.34", "EUR")).toEqual({
      amount: 1234,
      currency: "EUR",
    });
    expect(positiveMoney("500", "JPY")).toEqual({
      amount: 500,
      currency: "JPY",
    });
    expect(positiveMoney("1.234", "BHD").amount).toBe(1234);
    for (const [text, code] of [
      ["1.5", "JPY"],
      ["1.234", "EUR"],
      ["0", "EUR"],
      ["-3", "EUR"],
      ["", "BDT"],
    ] as const)
      expect(() => positiveMoney(text, code)).toThrow();
  });
});

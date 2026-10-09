import { categorySchema, newId } from "@ledgerline/shared";
import { describe, expect, it } from "vitest";
import { paymentDefault, positiveCents } from "./form";

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

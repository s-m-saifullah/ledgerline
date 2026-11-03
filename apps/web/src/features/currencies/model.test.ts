import {
  type ExchangeRate,
  newId,
  type PinnedCurrency,
} from "@ledgerline/shared";
import { expect, it } from "vitest";
import { rateHint, refreshNotice, sourceLabel } from "./model";

const stamp = "2026-10-10T00:00:00.000Z";
const rate = (value: string, source: "api" | "manual"): ExchangeRate => ({
  id: newId(),
  ledgerId: newId(),
  code: "EUR",
  date: "2026-10-09",
  rate: value,
  source,
  version: 1,
  createdAt: stamp,
  updatedAt: stamp,
});
const pinned = (latestRate: ExchangeRate | null): PinnedCurrency => ({
  id: newId(),
  ledgerId: newId(),
  code: "EUR",
  version: 1,
  latestRate,
  createdAt: stamp,
  updatedAt: stamp,
});

it("hints the newest rate base first, with who set it", () => {
  expect(rateHint(pinned(rate("0.8", "manual")), "USD")).toBe(
    "1 USD = 1.25 EUR · set by you",
  );
  expect(rateHint(pinned(rate("1.1217", "api")), "USD")).toBe(
    "1 USD = 0.891504 EUR · fetched",
  );
});
it("says there is no rate yet in two words", () => {
  expect(rateHint(pinned(null), "USD")).toBe("No rate yet");
});
it("labels the source for the pill", () => {
  expect(sourceLabel(rate("1", "manual"))).toBe("Set by you");
  expect(sourceLabel(rate("1", "api"))).toBe("Fetched");
});
it("reports a refresh: updated, kept and not fetched", () => {
  expect(refreshNotice({ updated: 1, keptManual: 0, failed: [] })).toBe(
    "Updated 1 rate.",
  );
  expect(refreshNotice({ updated: 3, keptManual: 0, failed: [] })).toBe(
    "Updated 3 rates.",
  );
  expect(refreshNotice({ updated: 0, keptManual: 0, failed: [] })).toBe(
    "Rates are already up to date.",
  );
  expect(
    refreshNotice({ updated: 1, keptManual: 2, failed: ["JPY", "BDT"] }),
  ).toBe(
    "Updated 1 rate. Kept 2 you set yourself. Couldn't fetch JPY, BDT. You can set those by hand.",
  );
});

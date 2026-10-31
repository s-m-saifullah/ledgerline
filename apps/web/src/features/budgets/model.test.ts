import { type BudgetLine, newId } from "@ledgerline/shared";
import { describe, expect, it } from "vitest";
import {
  daysLeft,
  lineState,
  orderedLines,
  percentUsed,
  shareOf,
  splitLines,
  usedShare,
} from "./model";

const usd = (amount: number) => ({ amount, currency: "USD" as const });
const stamp = "2026-10-01T00:00:00.000Z";
function line(
  name: string,
  budget: number | null,
  spent: number,
  carriedIn = 0,
): BudgetLine {
  const categoryId = newId();
  return {
    categoryId,
    name,
    icon: null,
    color: null,
    archived: false,
    budget:
      budget === null
        ? null
        : {
            id: newId(),
            ledgerId: newId(),
            categoryId,
            month: "2026-10",
            amount: usd(budget),
            rollover: false,
            version: 1,
            createdAt: stamp,
            updatedAt: stamp,
          },
    carriedIn: usd(carriedIn),
    spent: usd(spent),
    left: budget === null ? null : usd(budget + carriedIn - spent),
  };
}

describe("shareOf", () => {
  it("is the used part of the allowance, capped at the whole", () => {
    expect(shareOf(5000, 10000)).toBe(0.5);
    expect(shareOf(30000, 10000)).toBe(1);
    expect(shareOf(0, 0)).toBe(0);
    expect(shareOf(100, 0)).toBe(1);
    expect(shareOf(500, -2000)).toBe(1);
  });
});

describe("usedShare", () => {
  it("caps the bar and handles a zero allowance", () => {
    expect(usedShare(line("A", 10000, 5000))).toBe(0.5);
    expect(usedShare(line("B", 10000, 30000))).toBe(1);
    expect(usedShare(line("C", 0, 0))).toBe(0);
    expect(usedShare(line("D", 0, 100))).toBe(1);
    expect(usedShare(line("E", 1000, 500, -2000))).toBe(1);
    expect(usedShare(line("F", null, 500))).toBe(0);
  });
  it("counts what was carried in as part of the allowance", () => {
    expect(usedShare(line("G", 10000, 6000, 2000))).toBe(0.5);
  });
});

describe("lineState", () => {
  it("is within, near at 90 per cent of the allowance, and over past it", () => {
    expect(lineState(line("A", 10000, 8999))).toBe("within");
    expect(lineState(line("B", 10000, 9000))).toBe("near");
    expect(lineState(line("C", 10000, 10000))).toBe("near");
    expect(lineState(line("D", 10000, 10001))).toBe("over");
  });
  it("is over when nothing was allowed and something was spent", () => {
    expect(lineState(line("E", 0, 100))).toBe("over");
    expect(lineState(line("F", 0, 0))).toBe("within");
  });
  it("counts the carried-in amount", () => {
    expect(lineState(line("G", 10000, 10500, 1000))).toBe("near");
    expect(lineState(line("H", 10000, 10000, -2000))).toBe("over");
  });
});

describe("orderedLines and splitLines", () => {
  const items = [
    line("Fun", 8000, 5499),
    line("Health", null, 1840),
    line("Transport", 15000, 21215, 1500),
    line("Food", 60000, 41635),
    line("Gifts", null, 0),
    line("Home", 170000, 159450),
  ];
  it("puts the overspent first, then the most spent", () => {
    expect(orderedLines(items).map((l) => l.name)).toEqual([
      "Transport",
      "Home",
      "Food",
      "Fun",
    ]);
  });
  it("keeps the server's order among equal lines", () => {
    const tied = [line("B", 1000, 500), line("A", 1000, 500)];
    expect(orderedLines(tied).map((l) => l.name)).toEqual(["B", "A"]);
    const tiedOver = [line("Y", 100, 500), line("X", 100, 500)];
    expect(orderedLines(tiedOver).map((l) => l.name)).toEqual(["Y", "X"]);
  });
  it("folds every category without a budget, spending or not", () => {
    const { budgeted, unbudgeted } = splitLines(items);
    expect(budgeted).toHaveLength(4);
    expect(unbudgeted.map((l) => l.name)).toEqual(["Health", "Gifts"]);
  });
  it("counts a budget of zero as a budget", () => {
    const { budgeted } = splitLines([line("Zero", 0, 0)]);
    expect(budgeted).toHaveLength(1);
  });
});

describe("percentUsed", () => {
  it("is spent over budget plus carried in, rounded, and may pass 100", () => {
    expect(percentUsed({ spent: 5000, allowance: 10000 })).toBe(50);
    expect(percentUsed({ spent: 12000, allowance: 10000 })).toBe(120);
    expect(percentUsed({ spent: 1, allowance: 3 })).toBe(33);
  });
  it("is 0 or 100 when nothing was allowed", () => {
    expect(percentUsed({ spent: 0, allowance: 0 })).toBe(0);
    expect(percentUsed({ spent: 100, allowance: 0 })).toBe(100);
  });
});

describe("daysLeft", () => {
  const day = (iso: string) => new Date(`${iso}T12:00:00`);
  it("counts the days after today in the current month only", () => {
    expect(daysLeft("2026-10", day("2026-10-28"))).toBe(3);
    expect(daysLeft("2026-10", day("2026-10-31"))).toBe(0);
    expect(daysLeft("2026-02", day("2026-02-10"))).toBe(18);
  });
  it("says nothing for another month", () => {
    expect(daysLeft("2026-09", day("2026-10-28"))).toBeNull();
    expect(daysLeft("2026-11", day("2026-10-28"))).toBeNull();
    expect(daysLeft("2025-10", day("2026-10-28"))).toBeNull();
  });
});

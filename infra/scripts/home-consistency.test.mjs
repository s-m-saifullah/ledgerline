import assert from "node:assert/strict";
import test from "node:test";
import { compareHome } from "./home-consistency.mjs";

const usd = (amount) => ({ amount, currency: "USD" });
const tx = (id, date, kind, amount, status = "cleared") => ({
  id,
  date,
  kind,
  status,
  amount: usd(amount),
});
// Hand-checked fixture (October 2026): checking 354000, cash 23725, card -39000, archived 50000.
const accounts = [
  { id: "a1", type: "bank", balance: usd(354000), archivedAt: null },
  { id: "a2", type: "cash", balance: usd(23725), archivedAt: null },
  { id: "a3", type: "card", balance: usd(-39000), archivedAt: null },
  {
    id: "a4",
    type: "savings",
    balance: usd(50000),
    archivedAt: "2026-10-01T00:00:00.000Z",
  },
];
const people = [
  { openBalance: usd(25000) },
  { openBalance: usd(3000) },
  { openBalance: usd(0) },
];
const transactions = [
  tx("t7", "2026-11-01", "expense", -800),
  tx("t6", "2026-10-07", "income", 15000),
  tx("t5", "2026-10-06", "expense", -2000, "pending"),
  tx("t4o", "2026-10-05", "transfer", -5000),
  tx("t4i", "2026-10-05", "transfer", 5000),
  tx("t3", "2026-10-04", "expense", -9000),
  tx("t2", "2026-10-03", "expense", -1275),
  tx("t1", "2026-10-01", "income", 250000),
  tx("t0", "2026-09-30", "expense", -700),
];
const home = {
  inHand: usd(377725),
  netWorth: usd(388725),
  liabilitiesOwed: usd(39000),
  // Cards and loans never appear on Home.
  accounts: accounts.filter((a) => !a.archivedAt && a.type !== "card"),
  otherActive: { count: 0, balance: usd(0) },
  archived: { count: 1, balance: usd(50000) },
  moneyIn: usd(265000),
  moneyOut: usd(10275),
  owed: { total: usd(28000), personCount: 2 },
  pendingCount: 1,
  latest: ["t7", "t6", "t5", "t4o", "t3"].map((id) => ({
    transaction: { id },
  })),
};
const input = {
  monthStart: "2026-10-01",
  monthEnd: "2026-10-31",
  home,
  accounts,
  people,
  transactions,
};

test("a consistent Home summary reports nothing", () => {
  assert.deepEqual(compareHome(input), []);
});
test("each wrong figure is named without revealing amounts", () => {
  const broken = {
    ...input,
    home: {
      ...home,
      inHand: usd(7),
      netWorth: usd(1),
      liabilitiesOwed: usd(8),
      moneyIn: usd(2),
      moneyOut: usd(3),
      owed: { total: usd(4), personCount: 9 },
      pendingCount: 7,
      latest: [{ transaction: { id: "t4i" } }],
    },
  };
  const problems = compareHome(broken);
  for (const name of [
    "net worth",
    "in hand",
    "owed on cards and loans",
    "money in",
    "money out",
    "owed total",
    "people owing",
    "pending count",
    "latest entries",
  ])
    assert.ok(problems.includes(name), name);
  assert.ok(problems.every((p) => !/\d{2,}/.test(p)));
});
test("month edges, transfers and pending rows never enter money in or out", () => {
  const edge = {
    ...input,
    transactions: [
      tx("a", "2026-09-30", "income", 100),
      tx("b", "2026-10-31", "income", 200),
      tx("c", "2026-11-01", "income", 400),
      tx("d", "2026-10-15", "income", 800, "pending"),
      tx("e", "2026-10-15", "transfer", 900),
    ],
  };
  const problems = compareHome({
    ...edge,
    home: {
      ...home,
      moneyIn: usd(200),
      moneyOut: usd(0),
      pendingCount: 1,
      latest: ["a", "b", "c", "d", "e"]
        .filter((id) => id !== "e")
        .map((id) => ({ transaction: { id } }))
        .slice(0, 4)
        .concat([]),
    },
  });
  assert.ok(!problems.includes("money in"));
  assert.ok(!problems.includes("money out"));
});

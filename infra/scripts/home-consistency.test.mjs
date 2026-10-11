import assert from "node:assert/strict";
import test from "node:test";
import { compareHome, readHomeRates } from "./home-consistency.mjs";

const usd = (amount) => ({ amount, currency: "USD" });
const tx = (id, date, kind, amount, status = "cleared") => ({
  id,
  date,
  kind,
  status,
  amount: usd(amount),
  baseAmount: usd(amount),
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
  { openBalance: usd(25000), openBalances: [usd(25000)] },
  { openBalance: usd(3000), openBalances: [usd(3000)] },
  { openBalance: usd(0), openBalances: [] },
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
  accounts: accounts
    .filter((a) => !a.archivedAt && a.type !== "card")
    .map((a) => ({ ...a, baseBalance: a.balance })),
  otherActive: { count: 0, balance: usd(0) },
  archived: { count: 1, balance: usd(50000) },
  moneyIn: usd(265000),
  moneyOut: usd(10275),
  owed: {
    total: usd(28000),
    personCount: 2,
    otherCurrencies: [],
    unconvertedCurrencies: [],
  },
  unconvertedCurrencies: [],
  pendingCount: 1,
  latest: ["t7", "t6", "t5", "t4o", "t3"].map((id) => ({
    transaction: { id },
  })),
};
const input = {
  baseCurrency: "USD",
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

const money = (amount, currency) => ({ amount, currency });
function currencyFixture() {
  const account = (id, type, amount, currency, archivedAt = null) => ({
    id,
    type,
    balance: money(amount, currency),
    archivedAt,
  });
  const rows = [
    account("usd", "bank", 100, "USD"),
    account("bdt", "bank", 150, "BDT"),
    account("overdrawn", "bank", -50, "BDT"),
    account("card", "card", -150, "BDT"),
    account("credit", "loan", 150, "BDT"),
    account("archived", "savings", 250, "BDT", "2026-10-01"),
    account("other", "wallet", 50, "BDT"),
    account("yen", "bank", 1, "JPY"),
    account("dinar", "savings", 5, "BHD"),
    account("no-rate", "bank", 10, "EUR"),
    account("no-debt-rate", "card", -1, "NZD"),
  ];
  const entries = [
    {
      ...tx("income", "2026-10-10", "income", 10000),
      amount: money(10000, "BDT"),
      baseAmount: usd(300),
    },
    {
      ...tx("expense", "2026-10-09", "expense", -1000),
      amount: money(-1000, "BDT"),
      baseAmount: usd(-20),
    },
  ];
  const baseBalances = {
    usd: 100,
    bdt: 2,
    overdrawn: -1,
    yen: 1,
    dinar: 1,
    "no-rate": null,
  };
  return {
    ...input,
    rates: new Map([
      ["BDT", "0.01"],
      ["JPY", "0.005"],
      ["BHD", "1"],
      ["EUR", null],
      ["NZD", null],
    ]),
    accounts: rows,
    people: [
      { openBalance: usd(10), openBalances: [usd(10), money(49, "BDT")] },
      { openBalance: usd(0), openBalances: [money(49, "BDT")] },
      { openBalance: usd(0), openBalances: [money(10, "EUR")] },
      { openBalance: usd(0), openBalances: [] },
    ],
    transactions: entries,
    home: {
      ...home,
      netWorth: usd(107),
      inHand: usd(105),
      liabilitiesOwed: usd(2),
      accounts: rows
        .filter((a) => Object.hasOwn(baseBalances, a.id))
        .map((a) => ({
          ...a,
          baseBalance:
            baseBalances[a.id] === null ? null : usd(baseBalances[a.id]),
        })),
      archived: { count: 1, balance: usd(3) },
      otherActive: { count: 1, balance: usd(1) },
      unconvertedCurrencies: ["EUR", "NZD"],
      owed: {
        total: usd(11),
        personCount: 3,
        otherCurrencies: ["BDT", "EUR"],
        unconvertedCurrencies: ["EUR"],
      },
      moneyIn: usd(300),
      moneyOut: usd(20),
      pendingCount: 0,
      latest: entries.map((transaction) => ({ transaction })),
    },
  };
}

test("foreign balances use current rates, currency digits and signed half-away rounding; flows stay frozen", () => {
  assert.deepEqual(compareHome(currencyFixture()), []);
});

test("owed amounts are combined by currency before rounding and unvalued people still count", () => {
  const fixture = currencyFixture();
  fixture.home.owed.total = usd(10); // Adding the already-rounded People values loses a cent.
  fixture.home.owed.personCount = 1;
  assert.deepEqual(compareHome(fixture), ["owed total", "people owing"]);
});

test("wrong foreign totals, itemized values and missing-rate notices still fail without leaking values", () => {
  const fixture = currencyFixture();
  fixture.home.netWorth = usd(999);
  fixture.home.inHand = usd(999);
  fixture.home.liabilitiesOwed = usd(999);
  fixture.home.archived.balance = usd(999);
  fixture.home.otherActive.balance = usd(999);
  fixture.home.accounts[1].baseBalance = usd(150);
  fixture.home.accounts[1].balance = usd(150);
  fixture.home.moneyIn = usd(10000);
  fixture.home.moneyOut = usd(1000);
  fixture.home.unconvertedCurrencies = [];
  fixture.home.owed.unconvertedCurrencies = [];
  fixture.home.owed.otherCurrencies = [];
  assert.deepEqual(compareHome(fixture), [
    "unconverted account currencies",
    "net worth",
    "in hand",
    "owed on cards and loans",
    "itemized account currency",
    "itemized base balance",
    "archived balance",
    "other accounts balance",
    "unconverted owed currencies",
    "other owed currencies",
    "money in",
    "money out",
  ]);
});

test("reads only the newest stored rate once per used currency, including owed-only currencies", async () => {
  const fixture = currencyFixture();
  fixture.people.push({ openBalances: [money(1, "CAD")] });
  const paths = [];
  const rates = await readHomeRates(fixture, async (path) => {
    paths.push(path);
    return path.includes("code=BDT") ? [{ rate: "0.01" }] : [];
  });
  assert.deepEqual(
    paths,
    ["BDT", "JPY", "BHD", "EUR", "NZD", "CAD"].map(
      (code) => `/exchange-rates?code=${code}&limit=1`,
    ),
  );
  assert.equal(rates.get("BDT"), "0.01");
  assert.equal(rates.get("CAD"), null);
  assert.equal(rates.has("USD"), false);
});

test("missing fetch inputs and malformed rates fail with fixed non-sensitive errors", () => {
  const fixture = currencyFixture();
  fixture.rates.delete("BDT");
  assert.throws(
    () => compareHome(fixture),
    /^Error: Missing comparison rate input$/,
  );
  for (const bad of ["0", "-1", "not-a-rate", "0.00000000001"]) {
    fixture.rates.set("BDT", bad);
    assert.throws(
      () => compareHome(fixture),
      /^Error: Invalid comparison rate$/,
    );
  }
});

test("large balances sum exactly even when intermediate sums exceed the safe range", () => {
  const fixture = currencyFixture();
  fixture.accounts.push(
    { id: "large1", type: "loan", balance: usd(Number.MAX_SAFE_INTEGER) },
    { id: "large2", type: "loan", balance: usd(10) },
    { id: "large3", type: "card", balance: usd(-Number.MAX_SAFE_INTEGER + 10) },
  );
  fixture.home.netWorth = usd(127);
  fixture.home.liabilitiesOwed = usd(Number.MAX_SAFE_INTEGER - 8);
  assert.deepEqual(compareHome(fixture), []);
});

test("out-of-range converted balances fail rather than silently rounding money", () => {
  const fixture = currencyFixture();
  fixture.accounts[1].balance.amount = Number.MAX_SAFE_INTEGER;
  fixture.rates.set("BDT", "2");
  assert.throws(
    () => compareHome(fixture),
    /^Error: Home comparison exceeds the exact money range$/,
  );
});

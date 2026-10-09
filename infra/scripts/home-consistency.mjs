// Compare the Home summary with what the Accounts, People and Transactions
// endpoints say. Pure and read-only: callers fetch the data; mismatches name the
// figure that differs, never an amount, payee or label.

const ASSET_TYPES = ["bank", "cash", "wallet", "savings"];

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

/**
 * @param {{ month: string, monthStart: string, monthEnd: string, home: any, accounts: any[], people: any[], transactions: any[] }} input
 * `transactions` is every non-deleted entry in list order (date desc, id desc).
 * @returns {string[]} names of figures that do not agree (empty when consistent)
 */
export function compareHome({
  monthStart,
  monthEnd,
  home,
  accounts,
  people,
  transactions,
}) {
  const problems = [];
  const check = (name, actual, expected) => {
    if (actual !== expected) problems.push(name);
  };
  const isAsset = (account) => ASSET_TYPES.includes(account.type);
  const assets = accounts.filter(isAsset);
  const activeAssets = assets.filter((a) => !a.archivedAt);
  check(
    "net worth",
    home.netWorth.amount,
    sum(accounts.map((a) => a.balance.amount)),
  );
  check(
    "in hand",
    home.inHand.amount,
    sum(activeAssets.map((a) => Math.max(a.balance.amount, 0))),
  );
  check(
    "owed on cards and loans",
    home.liabilitiesOwed.amount,
    -sum(
      accounts
        .filter((a) => !isAsset(a))
        .map((a) => Math.min(a.balance.amount, 0)),
    ),
  );
  for (const line of home.accounts) {
    const account = accounts.find((a) => a.id === line.id);
    check(
      "itemized account balance",
      line.balance.amount,
      account?.balance.amount,
    );
    // Cards and loans never appear on Home.
    check(
      "only money accounts on Home",
      account ? isAsset(account) : false,
      true,
    );
  }
  const itemized = new Set(home.accounts.map((a) => a.id));
  const archived = assets.filter((a) => a.archivedAt);
  check("archived accounts", home.archived.count, archived.length);
  check(
    "archived balance",
    home.archived.balance.amount,
    sum(archived.map((a) => a.balance.amount)),
  );
  const otherActive = activeAssets.filter((a) => !itemized.has(a.id));
  check("other accounts", home.otherActive.count, otherActive.length);
  check(
    "other accounts balance",
    home.otherActive.balance.amount,
    sum(otherActive.map((a) => a.balance.amount)),
  );
  check(
    "owed total",
    home.owed.total.amount,
    sum(people.map((p) => p.openBalance.amount)),
  );
  check(
    "people owing",
    home.owed.personCount,
    people.filter((p) => p.openBalance.amount > 0).length,
  );
  const inMonth = transactions.filter(
    (t) =>
      t.date >= monthStart &&
      t.date <= monthEnd &&
      t.status === "cleared" &&
      t.kind !== "transfer",
  );
  check(
    "money in",
    home.moneyIn.amount,
    sum(inMonth.filter((t) => t.kind === "income").map((t) => t.amount.amount)),
  );
  check(
    "money out",
    home.moneyOut.amount,
    -sum(
      inMonth.filter((t) => t.kind === "expense").map((t) => t.amount.amount),
    ),
  );
  check(
    "pending count",
    home.pendingCount,
    transactions.filter((t) => t.status === "pending").length,
  );
  // Latest five, each transfer shown once as its outgoing leg.
  const expected = transactions
    .filter((t) => t.kind !== "transfer" || t.amount.amount < 0)
    .slice(0, 5)
    .map((t) => t.id);
  check(
    "latest entries",
    JSON.stringify(home.latest.map((row) => row.transaction.id)),
    JSON.stringify(expected),
  );
  return problems;
}

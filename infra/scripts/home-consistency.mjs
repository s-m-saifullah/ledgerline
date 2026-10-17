// Compare the Home summary with what the Accounts, Clients and Transactions
// endpoints say. Pure and read-only: callers fetch the data; mismatches name the
// figure that differs, never an amount, payee or label.

const ASSET_TYPES = ["bank", "cash", "wallet", "savings"];

function sum(values) {
  return safe(values.reduce((total, value) => total + BigInt(value), 0n));
}

function safe(value) {
  if (
    value < BigInt(Number.MIN_SAFE_INTEGER) ||
    value > BigInt(Number.MAX_SAFE_INTEGER)
  )
    throw new Error("Home comparison exceeds the exact money range");
  return Number(value);
}

// Standalone integer arithmetic keeps this checker usable before dependencies are installed.
// ADR 0020: rate is base units per foreign unit; round half away from zero.
function valueInBase(money, baseCurrency, rates) {
  if (!Number.isSafeInteger(money.amount))
    throw new Error("Invalid comparison amount");
  if (money.currency === baseCurrency) return money.amount;
  if (!rates.has(money.currency))
    throw new Error("Missing comparison rate input");
  const rate = rates.get(money.currency);
  if (rate === null) return null;
  const match = /^(\d{1,10})(?:\.(\d{1,10}))?$/.exec(rate);
  if (!match) throw new Error("Invalid comparison rate");
  const fraction = match[2] ?? "";
  const scaled = BigInt(match[1] + fraction);
  if (scaled <= 0n) throw new Error("Invalid comparison rate");
  const digits = (currency) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).resolvedOptions().maximumFractionDigits;
  const numerator =
    BigInt(Math.abs(money.amount)) *
    scaled *
    10n ** BigInt(digits(baseCurrency));
  const denominator = 10n ** BigInt(fraction.length + digits(money.currency));
  const rounded = (numerator * 2n + denominator) / (denominator * 2n);
  return safe(money.amount < 0 ? -rounded : rounded);
}

/** Read the newest stored rates, including currencies that have since been unpinned. */
export async function readHomeRates(
  { accounts, clients, baseCurrency },
  readAll,
) {
  const codes = new Set([
    ...accounts.map((account) => account.balance.currency),
    ...clients.flatMap((client) =>
      client.openBalances.map((money) => money.currency),
    ),
  ]);
  codes.delete(baseCurrency);
  const rates = new Map();
  for (const code of codes) {
    const rows = await readAll(
      `/exchange-rates?code=${encodeURIComponent(code)}&limit=1`,
    );
    rates.set(code, rows[0]?.rate ?? null);
  }
  return rates;
}

/**
 * @param {{ baseCurrency: string, rates: Map<string, string | null>, monthStart: string, monthEnd: string, home: any, accounts: any[], clients: any[], transactions: any[] }} input
 * `transactions` is every non-deleted entry in list order (date desc, id desc).
 * @returns {string[]} names of figures that do not agree (empty when consistent)
 */
export function compareHome({
  baseCurrency,
  rates = new Map(),
  monthStart,
  monthEnd,
  home,
  accounts,
  clients,
  transactions,
}) {
  const problems = [];
  const check = (name, actual, expected) => {
    if (actual !== expected) problems.push(name);
  };
  const value = (money) => valueInBase(money, baseCurrency, rates);
  const valuedAccounts = new Map(
    accounts.map((account) => [account.id, value(account.balance)]),
  );
  const balance = (account) => valuedAccounts.get(account.id) ?? 0;
  const sameCodes = (name, actual, expected) =>
    check(
      name,
      JSON.stringify(actual),
      JSON.stringify([...new Set(expected)].sort()),
    );
  sameCodes(
    "unconverted account currencies",
    home.unconvertedCurrencies,
    accounts
      .filter((account) => valuedAccounts.get(account.id) === null)
      .map((account) => account.balance.currency),
  );
  const isAsset = (account) => ASSET_TYPES.includes(account.type);
  const assets = accounts.filter(isAsset);
  const activeAssets = assets.filter((a) => !a.archivedAt);
  check("net worth", home.netWorth.amount, sum(accounts.map(balance)));
  check(
    "in hand",
    home.inHand.amount,
    sum(activeAssets.map((a) => Math.max(balance(a), 0))),
  );
  // A client's balance account is money lent or borrowed, not a card or loan debt (ADR 0030).
  const clientLoans = accounts.filter((a) => a.contactId);
  check(
    "owed on cards and loans",
    home.liabilitiesOwed.amount,
    -sum(
      accounts
        .filter((a) => !isAsset(a) && !a.contactId)
        .map((a) => Math.min(balance(a), 0)),
    ),
  );
  check(
    "lent to clients",
    home.loans?.lent.amount ?? 0,
    sum(clientLoans.map((a) => Math.max(balance(a), 0))),
  );
  check(
    "borrowed from clients",
    home.loans?.borrowed.amount ?? 0,
    -sum(clientLoans.map((a) => Math.min(balance(a), 0))),
  );
  for (const line of home.accounts) {
    const account = accounts.find((a) => a.id === line.id);
    check(
      "itemized account balance",
      line.balance.amount,
      account?.balance.amount,
    );
    check(
      "itemized account currency",
      line.balance.currency,
      account?.balance.currency,
    );
    check(
      "itemized base balance",
      line.baseBalance?.amount ?? null,
      account ? valuedAccounts.get(account.id) : undefined,
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
    sum(archived.map(balance)),
  );
  const otherActive = activeAssets.filter((a) => !itemized.has(a.id));
  check("other accounts", home.otherActive.count, otherActive.length);
  check(
    "other accounts balance",
    home.otherActive.balance.amount,
    sum(otherActive.map(balance)),
  );
  // Home rounds once per currency across all clients, not once per client.
  const owedByCurrency = new Map();
  for (const client of clients) {
    for (const money of client.openBalances) {
      owedByCurrency.set(
        money.currency,
        (owedByCurrency.get(money.currency) ?? 0n) + BigInt(money.amount),
      );
    }
  }
  const owed = [...owedByCurrency].map(([currency, amount]) => ({
    currency,
    base: value({ currency, amount: safe(amount) }),
  }));
  sameCodes(
    "unconverted owed currencies",
    home.owed.unconvertedCurrencies,
    owed.filter((row) => row.base === null).map((row) => row.currency),
  );
  sameCodes(
    "other owed currencies",
    home.owed.otherCurrencies,
    owed
      .filter((row) => row.currency !== baseCurrency)
      .map((row) => row.currency),
  );
  check(
    "owed total",
    home.owed.total.amount,
    sum(owed.map((row) => row.base ?? 0)),
  );
  check(
    "clients owing",
    home.owed.personCount,
    clients.filter((p) => p.openBalances.some((money) => money.amount > 0))
      .length,
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
    sum(
      inMonth
        .filter((t) => t.kind === "income")
        .map((t) => t.baseAmount.amount),
    ),
  );
  check(
    "money out",
    home.moneyOut.amount,
    -sum(
      inMonth
        .filter((t) => t.kind === "expense")
        .map((t) => t.baseAmount.amount),
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

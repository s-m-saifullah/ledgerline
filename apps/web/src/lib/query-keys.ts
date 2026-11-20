/**
 * Every cached answer in the app has its key from here, so what a write has to refresh is one rule and not a list each
 * screen keeps (WP-12). Everything about one ledger sits under `["ledger", ledgerId, area, ...]`: refreshing the ledger
 * is one prefix, refreshing one area is a longer one, and another ledger is never touched. What belongs to the person
 * and not to a ledger (the session, the ledgers list, the change marker) stays outside that prefix.
 */
type Id = string | undefined;

const scoped = (ledgerId: Id, area: string, ...rest: readonly unknown[]) =>
  ["ledger", ledgerId, area, ...rest] as const;

/** The areas a write can refresh on their own. A key built from one of these starts with `["ledger", id, area]`. */
export const ledgerAreas = [
  "accounts",
  "budgets",
  "categories",
  "clientHistory",
  "contacts",
  "currencies",
  "home",
  "imports",
  "loans",
  "receivables",
  "recurring",
  "reports",
  "tags",
  "transactions",
] as const;
export type LedgerArea = (typeof ledgerAreas)[number];

export const queryKeys = {
  session: ["session"] as const,
  ledgers: ["ledgers"] as const,
  /** Who I am (name, email, admin, two-factor): belongs to the person, not to a ledger. */
  me: ["me"] as const,
  /** The people the admin manages, and under it the deleted ones, so refreshing the people refreshes both. */
  users: ["users"] as const,
  deletedUsers: ["users", "deleted"] as const,
  /** The devices signed in as the person. */
  devices: ["sessions"] as const,
  /** The ledger's change marker (ADR 0044); a reload never refreshes it. */
  changes: (ledgerId: Id) => ["changes", ledgerId] as const,
  /** Everything about the ledger. */
  ledger: (ledgerId: Id) => ["ledger", ledgerId] as const,

  accounts: (ledgerId: Id) => scoped(ledgerId, "accounts"),
  /** Every active account; screens that must not offer a client's balance account filter it when they read. */
  activeAccounts: (ledgerId: Id) => scoped(ledgerId, "accounts", "active"),
  /** Every account, archived ones too. */
  allAccounts: (ledgerId: Id) => scoped(ledgerId, "accounts", "all"),
  /** The Accounts page's own paged list (pages, not one array), so it never shares an entry with the two above. */
  accountPages: (ledgerId: Id) => scoped(ledgerId, "accounts", "pages"),
  categories: (ledgerId: Id) => scoped(ledgerId, "categories"),
  home: (ledgerId: Id, month?: string) =>
    month === undefined
      ? scoped(ledgerId, "home")
      : scoped(ledgerId, "home", month),
  transactions: (ledgerId: Id) => scoped(ledgerId, "transactions"),
  transactionList: (ledgerId: Id, filters: unknown) =>
    scoped(ledgerId, "transactions", "list", filters),
  transactionDetail: (ledgerId: Id, id: Id, sequence: number) =>
    scoped(ledgerId, "transactions", "detail", id, sequence),
  transferDetail: (
    ledgerId: Id,
    transferId: string | null | undefined,
    sequence: number,
  ) => scoped(ledgerId, "transactions", "transfer", transferId, sequence),
  budgets: (ledgerId: Id, month?: string) =>
    month === undefined
      ? scoped(ledgerId, "budgets")
      : scoped(ledgerId, "budgets", month),
  reports: (ledgerId: Id) => scoped(ledgerId, "reports"),
  report: (
    ledgerId: Id,
    kind: "spending" | "cash-flow" | "net-worth",
    month: string,
  ) => scoped(ledgerId, "reports", kind, month),

  contacts: (ledgerId: Id) => scoped(ledgerId, "contacts"),
  clientBook: (ledgerId: Id, month: string) =>
    scoped(ledgerId, "contacts", "book", month),
  clientChoices: (ledgerId: Id) => scoped(ledgerId, "contacts", "choices"),
  clientDetail: (ledgerId: Id, clientId: string, month: string) =>
    scoped(ledgerId, "contacts", "detail", clientId, month),
  receivables: (ledgerId: Id) => scoped(ledgerId, "receivables"),
  clientServices: (ledgerId: Id, clientId: string) =>
    scoped(ledgerId, "receivables", "client", clientId),
  servicePayments: (ledgerId: Id, serviceId: string) =>
    scoped(ledgerId, "receivables", "payments", serviceId),
  receiptPreview: (
    ledgerId: Id,
    clientId: string | undefined,
    currency: string,
    cents: number | null,
  ) =>
    scoped(
      ledgerId,
      "receivables",
      "receipt-preview",
      clientId,
      currency,
      cents,
    ),
  clientHistory: (ledgerId: Id, clientId?: string) =>
    clientId === undefined
      ? scoped(ledgerId, "clientHistory")
      : scoped(ledgerId, "clientHistory", clientId),

  loans: (ledgerId: Id) => scoped(ledgerId, "loans"),
  loansOf: (ledgerId: Id, personId: string | null) =>
    scoped(ledgerId, "loans", "of", personId),
  loanActivity: (ledgerId: Id, personId: string | null, accountIds: string[]) =>
    scoped(ledgerId, "loans", "activity", personId, accountIds),
  loanRemoveCheck: (ledgerId: Id, personId: string, accountId: string) =>
    scoped(ledgerId, "loans", "remove-check", personId, accountId),
  loanPeople: (ledgerId: Id) => scoped(ledgerId, "loans", "people"),
  loanPerson: (ledgerId: Id, personId: Id) =>
    scoped(ledgerId, "loans", "person", personId),

  currencies: (ledgerId: Id) => scoped(ledgerId, "currencies"),
  rateLookup: (ledgerId: Id, currency: string, date: string) =>
    scoped(ledgerId, "currencies", "rate-lookup", currency, date),
  imports: (ledgerId: Id) => scoped(ledgerId, "imports"),
  importPreview: (ledgerId: Id, payloadKey: string) =>
    scoped(ledgerId, "imports", "preview", payloadKey),
  tags: (ledgerId: Id) => scoped(ledgerId, "tags"),
  recurring: (ledgerId: Id) => scoped(ledgerId, "recurring"),
  recurringRuns: (ledgerId: Id, ruleId: Id) =>
    scoped(ledgerId, "recurring", "runs", ruleId),
};

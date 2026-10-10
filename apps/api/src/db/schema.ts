import { type JsonValue, newId } from "@ledgerline/shared";
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const audit = () => ({
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});
const primaryId = () => uuid("id").primaryKey().$defaultFn(newId);

export const user = pgTable("users", {
  id: primaryId(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  locale: text("locale").notNull().default("en-US"),
  baseCurrency: text("base_currency").notNull().default("USD"),
  ...audit(),
});
export const session = pgTable(
  "auth_sessions",
  {
    id: primaryId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    ...audit(),
  },
  (table) => [index("auth_sessions_user_idx").on(table.userId)],
);
export const account = pgTable(
  "auth_accounts",
  {
    id: primaryId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }),
    scope: text("scope"),
    password: text("password"),
    ...audit(),
  },
  (table) => [
    uniqueIndex("auth_accounts_provider_idx").on(
      table.providerId,
      table.accountId,
    ),
    index("auth_accounts_user_idx").on(table.userId),
  ],
);
export const verification = pgTable(
  "auth_verifications",
  {
    id: primaryId(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...audit(),
  },
  (table) => [index("auth_verifications_identifier_idx").on(table.identifier)],
);
export const ledgers = pgTable("ledgers", {
  id: primaryId(),
  name: text("name").notNull(),
  baseCurrency: text("base_currency").notNull().default("USD"),
  ...audit(),
});
export const ledgerMembers = pgTable(
  "ledger_members",
  {
    id: primaryId(),
    ledgerId: uuid("ledger_id")
      .notNull()
      .references(() => ledgers.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id),
    role: text("role", { enum: ["owner", "editor", "viewer"] }).notNull(),
    ...audit(),
  },
  (table) => [
    uniqueIndex("ledger_members_pair_idx").on(table.ledgerId, table.userId),
    index("ledger_members_user_idx").on(table.userId),
  ],
);

export const accounts = pgTable(
  "accounts",
  {
    id: primaryId(),
    ledgerId: uuid("ledger_id")
      .notNull()
      .references(() => ledgers.id),
    name: text("name").notNull(),
    type: text("type", {
      enum: ["bank", "cash", "card", "wallet", "loan", "savings"],
    }).notNull(),
    currency: text("currency").notNull().default("USD"),
    openingBalance: bigint("opening_balance", { mode: "number" }).notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    version: integer("version").notNull().default(1),
    ...audit(),
  },
  (table) => [
    uniqueIndex("accounts_ledger_id_id_idx").on(table.ledgerId, table.id),
    check(
      "accounts_name_check",
      sql`char_length(btrim(${table.name})) BETWEEN 1 AND 100`,
    ),
    check(
      "accounts_type_check",
      sql`${table.type} IN ('bank', 'cash', 'card', 'wallet', 'loan', 'savings')`,
    ),
    check("accounts_currency_check", sql`${table.currency} = 'USD'`),
    check(
      "accounts_opening_balance_check",
      sql`${table.openingBalance} BETWEEN -9007199254740991 AND 9007199254740991`,
    ),
    check("accounts_version_check", sql`${table.version} >= 1`),
  ],
);

export const writeReceipts = pgTable(
  "write_receipts",
  {
    id: primaryId(),
    ledgerId: uuid("ledger_id")
      .notNull()
      .references(() => ledgers.id),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => user.id),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    responseStatus: integer("response_status").notNull(),
    responseBody: jsonb("response_body").$type<JsonValue>(),
    ...audit(),
  },
  (table) => [
    uniqueIndex("write_receipts_scope_key_idx").on(
      table.actorId,
      table.ledgerId,
      table.key,
    ),
    check(
      "write_receipts_key_check",
      sql`${table.key} ~ '^[A-Za-z0-9._:-]{8,128}$'`,
    ),
    check(
      "write_receipts_hash_check",
      sql`${table.requestHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "write_receipts_status_check",
      sql`${table.responseStatus} BETWEEN 200 AND 299`,
    ),
  ],
);

export const categories = pgTable(
  "categories",
  {
    id: primaryId(),
    ledgerId: uuid("ledger_id")
      .notNull()
      .references(() => ledgers.id),
    parentId: uuid("parent_id").references((): AnyPgColumn => categories.id),
    name: text("name").notNull(),
    kind: text("kind").$type<"income" | "expense">().notNull(),
    icon: text("icon"),
    color: text("color"),
    sortOrder: integer("sort_order").notNull().default(0),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    version: integer("version").notNull().default(1),
    ...audit(),
  },
  (table) => [
    uniqueIndex("categories_scope_kind_id_idx").on(
      table.ledgerId,
      table.kind,
      table.id,
    ),
    foreignKey({
      name: "categories_scoped_parent_fk",
      columns: [table.ledgerId, table.kind, table.parentId],
      foreignColumns: [table.ledgerId, table.kind, table.id],
    }),
    index("categories_ledger_id_idx").on(table.ledgerId, table.id),
    uniqueIndex("categories_root_name_idx")
      .on(table.ledgerId, table.kind, sql`lower(btrim(${table.name}))`)
      .where(sql`${table.parentId} IS NULL AND ${table.deletedAt} IS NULL`),
    uniqueIndex("categories_child_name_idx")
      .on(
        table.ledgerId,
        table.kind,
        table.parentId,
        sql`lower(btrim(${table.name}))`,
      )
      .where(sql`${table.parentId} IS NOT NULL AND ${table.deletedAt} IS NULL`),
    check(
      "categories_name_check",
      sql`char_length(btrim(${table.name})) BETWEEN 1 AND 100`,
    ),
    check("categories_kind_check", sql`${table.kind} IN ('income', 'expense')`),
    check(
      "categories_parent_check",
      sql`${table.parentId} IS NULL OR ${table.parentId} <> ${table.id}`,
    ),
    check(
      "categories_icon_check",
      sql`${table.icon} IS NULL OR ${table.icon} ~ '^[a-z][a-z0-9-]{0,49}$'`,
    ),
    check(
      "categories_color_check",
      sql`${table.color} IS NULL OR ${table.color} ~ '^#[0-9a-fA-F]{6}$'`,
    ),
    check("categories_order_check", sql`${table.sortOrder} >= 0`),
    check("categories_version_check", sql`${table.version} >= 1`),
  ],
);

export const transactions = pgTable(
  "transactions",
  {
    id: primaryId(),
    ledgerId: uuid("ledger_id")
      .notNull()
      .references(() => ledgers.id),
    accountId: uuid("account_id").notNull(),
    categoryId: uuid("category_id"),
    kind: text("kind").$type<"expense" | "income" | "transfer">().notNull(),
    isSplit: boolean("is_split").notNull().default(false),
    date: date("date", { mode: "string" }).notNull(),
    time: text("time"),
    amount: bigint("amount", { mode: "number" }).notNull(),
    currency: text("currency").notNull().default("USD"),
    payee: text("payee"),
    note: text("note"),
    transferId: uuid("transfer_id"),
    receivablePaymentId: uuid("receivable_payment_id"),
    receivableId: uuid("receivable_id"),
    status: text("status")
      .$type<"cleared" | "pending">()
      .notNull()
      .default("cleared"),
    fxRate: integer("fx_rate").notNull().default(1),
    baseAmount: bigint("base_amount", { mode: "number" }).notNull(),
    version: integer("version").notNull().default(1),
    ...audit(),
  },
  (table) => [
    foreignKey({
      name: "transactions_scoped_account_fk",
      columns: [table.ledgerId, table.accountId],
      foreignColumns: [accounts.ledgerId, accounts.id],
    }),
    foreignKey({
      name: "transactions_scoped_payment_fk",
      columns: [table.ledgerId, table.receivablePaymentId],
      foreignColumns: paymentKey(),
    }),
    foreignKey({
      name: "transactions_scoped_receivable_fk",
      columns: [table.ledgerId, table.receivableId],
      foreignColumns: receivableKey(),
    }),
    uniqueIndex("transactions_payment_idx").on(
      table.ledgerId,
      table.receivablePaymentId,
    ),
    check(
      "transactions_payment_check",
      sql`(${table.receivablePaymentId} IS NULL AND ${table.receivableId} IS NULL) OR (${table.receivablePaymentId} IS NOT NULL AND ${table.receivableId} IS NOT NULL AND ${table.kind}='income' AND ${table.status}='cleared' AND NOT ${table.isSplit} AND ${table.transferId} IS NULL)`,
    ),
    foreignKey({
      name: "transactions_scoped_category_fk",
      columns: [table.ledgerId, table.kind, table.categoryId],
      foreignColumns: [categories.ledgerId, categories.kind, categories.id],
    }),
    uniqueIndex("transactions_scope_id_idx").on(table.ledgerId, table.id),
    index("transactions_ledger_date_id_idx").on(
      table.ledgerId,
      table.date,
      table.id,
    ),
    index("transactions_ledger_account_idx").on(
      table.ledgerId,
      table.accountId,
    ),
    index("transactions_ledger_category_idx").on(
      table.ledgerId,
      table.categoryId,
    ),
    check(
      "transactions_sign_check",
      sql`(${table.kind} = 'expense' AND ${table.amount} < 0) OR (${table.kind} = 'income' AND ${table.amount} > 0) OR (${table.kind} = 'transfer' AND ${table.amount} <> 0)`,
    ),
    check(
      "transactions_transfer_check",
      sql`(${table.kind} = 'transfer' AND ${table.transferId} IS NOT NULL AND ${table.categoryId} IS NULL AND ${table.status} = 'cleared' AND ${table.payee} IS NULL AND NOT ${table.isSplit}) OR (${table.kind} IN ('expense', 'income') AND ${table.transferId} IS NULL AND ((${table.isSplit} AND ${table.categoryId} IS NULL) OR (NOT ${table.isSplit} AND ${table.categoryId} IS NOT NULL)))`,
    ),
    uniqueIndex("transactions_transfer_direction_idx")
      .on(table.ledgerId, table.transferId, sql`(${table.amount} > 0)`)
      .where(sql`${table.transferId} IS NOT NULL`),
    check(
      "transactions_amount_check",
      sql`${table.amount} BETWEEN -9007199254740991 AND 9007199254740991`,
    ),
    check(
      "transactions_usd_check",
      sql`${table.currency} = 'USD' AND ${table.fxRate} = 1 AND ${table.baseAmount} = ${table.amount}`,
    ),
    check(
      "transactions_status_check",
      sql`${table.status} IN ('cleared', 'pending')`,
    ),
    check(
      "transactions_payee_check",
      sql`${table.payee} IS NULL OR char_length(${table.payee}) <= 200`,
    ),
    check(
      "transactions_note_check",
      sql`${table.note} IS NULL OR char_length(${table.note}) <= 2000`,
    ),
    check(
      "transactions_date_check",
      sql`${table.date} BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'`,
    ),
    check(
      "transactions_time_check",
      sql`${table.time} IS NULL OR ${table.time} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`,
    ),
    check("transactions_version_check", sql`${table.version} >= 1`),
  ],
);

export const transactionSplits = pgTable(
  "transaction_splits",
  {
    id: primaryId(),
    ledgerId: uuid("ledger_id")
      .notNull()
      .references(() => ledgers.id),
    transactionId: uuid("transaction_id").notNull(),
    categoryId: uuid("category_id").notNull(),
    kind: text("kind").$type<"expense" | "income">().notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    note: text("note"),
    position: integer("position").notNull(),
    version: integer("version").notNull().default(1),
    ...audit(),
  },
  (table) => [
    foreignKey({
      name: "splits_scoped_transaction_fk",
      columns: [table.ledgerId, table.transactionId],
      foreignColumns: [transactions.ledgerId, transactions.id],
    }),
    foreignKey({
      name: "splits_scoped_category_fk",
      columns: [table.ledgerId, table.kind, table.categoryId],
      foreignColumns: [categories.ledgerId, categories.kind, categories.id],
    }),
    index("splits_ledger_transaction_idx").on(
      table.ledgerId,
      table.transactionId,
    ),
    index("splits_ledger_category_idx").on(table.ledgerId, table.categoryId),
    check(
      "splits_sign_check",
      sql`(${table.kind} = 'expense' AND ${table.amount} < 0) OR (${table.kind} = 'income' AND ${table.amount} > 0)`,
    ),
    check(
      "splits_amount_check",
      sql`${table.amount} BETWEEN -9007199254740991 AND 9007199254740991`,
    ),
    check(
      "splits_note_check",
      sql`${table.note} IS NULL OR char_length(${table.note}) <= 2000`,
    ),
    check("splits_position_check", sql`${table.position} BETWEEN 0 AND 49`),
    check("splits_version_check", sql`${table.version} >= 1`),
  ],
);

function paymentKey(): [AnyPgColumn, AnyPgColumn] {
  return [receivablePayments.ledgerId, receivablePayments.id];
}
function receivableKey(): [AnyPgColumn, AnyPgColumn] {
  return [receivables.ledgerId, receivables.id];
}
/** One budget per expense category per month, in the ledger's base currency (ADR 0019). */
export const budgets = pgTable(
  "budgets",
  {
    id: primaryId(),
    ledgerId: uuid("ledger_id")
      .notNull()
      .references(() => ledgers.id),
    categoryId: uuid("category_id").notNull(),
    // Fixed to expense so the scoped category key below only matches expense categories.
    kind: text("kind").$type<"expense">().notNull().default("expense"),
    month: date("month", { mode: "string" }).notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    rollover: boolean("rollover").notNull().default(false),
    version: integer("version").notNull().default(1),
    ...audit(),
  },
  (table) => [
    foreignKey({
      name: "budgets_scoped_category_fk",
      columns: [table.ledgerId, table.kind, table.categoryId],
      foreignColumns: [categories.ledgerId, categories.kind, categories.id],
    }),
    uniqueIndex("budgets_category_month_idx")
      .on(table.ledgerId, table.categoryId, table.month)
      .where(sql`${table.deletedAt} IS NULL`),
    index("budgets_ledger_month_idx").on(table.ledgerId, table.month),
    check("budgets_kind_check", sql`${table.kind} = 'expense'`),
    check("budgets_month_check", sql`extract(day from ${table.month}) = 1`),
    check(
      "budgets_amount_check",
      sql`${table.amount} between 0 and 9007199254740991`,
    ),
    check("budgets_version_check", sql`${table.version} >= 1`),
  ],
);

/** Currencies a ledger has pinned besides its base currency (ADR 0022). */
export const currencies = pgTable(
  "currencies",
  {
    id: primaryId(),
    ledgerId: uuid("ledger_id")
      .notNull()
      .references(() => ledgers.id),
    code: text("code").notNull(),
    version: integer("version").notNull().default(1),
    ...audit(),
  },
  (table) => [
    uniqueIndex("currencies_ledger_code_idx")
      .on(table.ledgerId, table.code)
      .where(sql`${table.deletedAt} IS NULL`),
    check("currencies_code_check", sql`${table.code} ~ '^[A-Z]{3}$'`),
    check("currencies_version_check", sql`${table.version} >= 1`),
  ],
);

/** Base-currency value of one unit of `code` on a date. Manual rates are never overwritten. */
export const exchangeRates = pgTable(
  "exchange_rates",
  {
    id: primaryId(),
    ledgerId: uuid("ledger_id")
      .notNull()
      .references(() => ledgers.id),
    code: text("code").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    rate: numeric("rate", { precision: 20, scale: 10 }).notNull(),
    source: text("source").$type<"api" | "manual">().notNull(),
    version: integer("version").notNull().default(1),
    ...audit(),
  },
  (table) => [
    uniqueIndex("exchange_rates_ledger_code_date_idx")
      .on(table.ledgerId, table.code, table.date)
      .where(sql`${table.deletedAt} IS NULL`),
    check("exchange_rates_code_check", sql`${table.code} ~ '^[A-Z]{3}$'`),
    check("exchange_rates_rate_check", sql`${table.rate} > 0`),
    check(
      "exchange_rates_source_check",
      sql`${table.source} IN ('api', 'manual')`,
    ),
    check("exchange_rates_version_check", sql`${table.version} >= 1`),
  ],
);

export const contacts = pgTable(
  "contacts",
  {
    id: primaryId(),
    ledgerId: uuid("ledger_id")
      .notNull()
      .references(() => ledgers.id),
    name: text("name").notNull(),
    phone: text("phone"),
    email: text("email"),
    note: text("note"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    version: integer("version").notNull().default(1),
    ...audit(),
  },
  (t) => [
    uniqueIndex("contacts_scope_idx").on(t.ledgerId, t.id),
    check(
      "contacts_fields_check",
      sql`char_length(btrim(${t.name})) between 1 and 100 AND char_length(${t.phone}) <= 100 AND char_length(${t.email}) <= 254 AND char_length(${t.note}) <= 2000`,
    ),
    check("contacts_version_check", sql`${t.version} >= 1`),
  ],
);
export const receivables = pgTable(
  "receivables",
  {
    id: primaryId(),
    ledgerId: uuid("ledger_id")
      .notNull()
      .references(() => ledgers.id),
    contactId: uuid("contact_id").notNull(),
    description: text("description").notNull(),
    serviceDate: date("service_date", { mode: "string" }).notNull(),
    serviceTime: text("service_time"),
    dueDate: date("due_date", { mode: "string" }),
    amount: bigint("amount", { mode: "number" }).notNull(),
    currency: text("currency").notNull().default("USD"),
    writtenOffAt: timestamp("written_off_at", { withTimezone: true }),
    writtenOffAmount: bigint("written_off_amount", { mode: "number" }),
    writeOffReason: text("write_off_reason"),
    version: integer("version").notNull().default(1),
    ...audit(),
  },
  (t) => [
    uniqueIndex("receivables_scope_idx").on(t.ledgerId, t.id),
    index("receivables_contact_idx").on(t.ledgerId, t.contactId, t.id),
    foreignKey({
      name: "receivables_contact_fk",
      columns: [t.ledgerId, t.contactId],
      foreignColumns: [contacts.ledgerId, contacts.id],
    }),
    check(
      "receivables_money_check",
      sql`${t.amount} between 1 and 9007199254740991 AND ${t.currency}='USD'`,
    ),
    check(
      "receivables_fields_check",
      sql`char_length(btrim(${t.description})) between 1 and 2000 AND char_length(${t.writeOffReason}) <= 2000 AND ${t.serviceDate} between date '0001-01-01' and date '9999-12-31' AND (${t.dueDate} IS NULL OR ${t.dueDate} between date '0001-01-01' and date '9999-12-31')`,
    ),
    check(
      "receivables_waiver_check",
      sql`(${t.writtenOffAt} IS NULL AND ${t.writtenOffAmount} IS NULL AND ${t.writeOffReason} IS NULL) OR (${t.writtenOffAt} IS NOT NULL AND ${t.writtenOffAmount} between 1 and ${t.amount})`,
    ),
    check(
      "receivables_time_check",
      sql`${t.serviceTime} IS NULL OR ${t.serviceTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`,
    ),
    check("receivables_version_check", sql`${t.version} >= 1`),
  ],
);
export const receivablePayments = pgTable(
  "receivable_payments",
  {
    id: primaryId(),
    ledgerId: uuid("ledger_id")
      .notNull()
      .references(() => ledgers.id),
    receivableId: uuid("receivable_id").notNull(),
    transactionId: uuid("transaction_id").notNull(),
    receiptId: uuid("receipt_id"),
    amount: bigint("amount", { mode: "number" }).notNull(),
    currency: text("currency").notNull().default("USD"),
    version: integer("version").notNull().default(1),
    ...audit(),
  },
  (t) => [
    index("payments_receipt_idx").on(t.ledgerId, t.receiptId),
    uniqueIndex("payments_scope_idx").on(t.ledgerId, t.id),
    uniqueIndex("payments_transaction_idx").on(t.ledgerId, t.transactionId),
    index("payments_receivable_idx").on(t.ledgerId, t.receivableId, t.id),
    foreignKey({
      name: "payments_receivable_fk",
      columns: [t.ledgerId, t.receivableId],
      foreignColumns: [receivables.ledgerId, receivables.id],
    }),
    foreignKey({
      name: "payments_transaction_fk",
      columns: [t.ledgerId, t.transactionId],
      foreignColumns: [transactions.ledgerId, transactions.id],
    }),
    check(
      "payments_money_check",
      sql`${t.amount} between 1 and 9007199254740991 AND ${t.currency}='USD'`,
    ),
    check("payments_version_check", sql`${t.version} >= 1`),
  ],
);
export const receivableEvents = pgTable(
  "receivable_events",
  {
    id: primaryId(),
    ledgerId: uuid("ledger_id")
      .notNull()
      .references(() => ledgers.id),
    contactId: uuid("contact_id").notNull(),
    receivableId: uuid("receivable_id").notNull(),
    paymentId: uuid("payment_id"),
    transactionId: uuid("transaction_id"),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => user.id),
    action: text("action").notNull(),
    receivableVersion: integer("receivable_version").notNull(),
    before: jsonb("before").$type<JsonValue>(),
    after: jsonb("after").$type<JsonValue>().notNull(),
    ...audit(),
  },
  (t) => [
    index("events_contact_idx").on(t.ledgerId, t.contactId, t.id),
    foreignKey({
      name: "events_contact_fk",
      columns: [t.ledgerId, t.contactId],
      foreignColumns: [contacts.ledgerId, contacts.id],
    }),
    foreignKey({
      name: "events_receivable_fk",
      columns: [t.ledgerId, t.receivableId],
      foreignColumns: [receivables.ledgerId, receivables.id],
    }),
    foreignKey({
      name: "events_payment_fk",
      columns: [t.ledgerId, t.paymentId],
      foreignColumns: [receivablePayments.ledgerId, receivablePayments.id],
    }),
    foreignKey({
      name: "events_transaction_fk",
      columns: [t.ledgerId, t.transactionId],
      foreignColumns: [transactions.ledgerId, transactions.id],
    }),
    check(
      "events_action_check",
      sql`${t.action} IN ('created','edited','deleted','restored','writtenOff','reopened','paymentCreated','paymentEdited','paymentDeleted','paymentRestored')`,
    ),
    check("events_version_check", sql`${t.receivableVersion} >= 1`),
    check(
      "events_snapshot_check",
      sql`octet_length(${t.after}::text) <= 65536 AND (${t.before} IS NULL OR octet_length(${t.before}::text) <= 65536)`,
    ),
  ],
);

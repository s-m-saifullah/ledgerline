import {
  type JsonValue,
  type LoanMove,
  type LoanOpening,
  type LoanPeopleQuery,
  loanBalanceSchema,
  loanListSchema,
  loanPeopleSchema,
  loanResultSchema,
  type WaiveLoan,
} from "@ledgerline/shared";
import type { Database, DatabaseConnection } from "../../db/client";
import { ApiProblem } from "../../lib/problem";
import {
  type AccountRow,
  accountsForContact,
  createContactAccount,
  lockTransactionAccounts,
  setContactAccountOpening,
} from "../accounts/service";
import {
  contactForAssignment,
  loanPeopleRows,
  lockContacts,
} from "../contacts/service";
import { requireUsableCurrency } from "../currencies/service";
import { ledgerBaseCurrency, requireLedgerRead } from "../ledgers/service";
import {
  postedBalance,
  postedTransactionTotals,
} from "../transactions/balance-service";
import { createTransactionInContext } from "../transactions/service";
import { createTransferInContext } from "../transactions/transfer-service";
import {
  runFinancialWrite,
  type WriteContext,
  type WriteIdentity,
} from "../writes/service";
import { nextVersion, requireVersionUpdate } from "../writes/version";

type Row = AccountRow;

async function balanceDto(db: DatabaseConnection, ledgerId: string, row: Row) {
  const totals = await postedTransactionTotals(db, ledgerId, [row.id]);
  return loanBalanceSchema.parse({
    accountId: row.id,
    currency: row.currency,
    openingBalance: { amount: row.openingBalance, currency: row.currency },
    balance: {
      amount: postedBalance(row.openingBalance, totals.get(row.id)),
      currency: row.currency,
    },
    version: row.version,
  });
}
const conflict = (message: string, field?: string) =>
  new ApiProblem(
    409,
    "Conflict",
    message,
    field ? [{ field, message }] : undefined,
  );
const request = (body: object) => JSON.parse(JSON.stringify(body)) as JsonValue;

/** Everyone you lend to or borrow from: added for loans, or already holding a balance account. */
export async function listLoanPeople(
  db: Database,
  actorId: string,
  ledgerId: string,
  query: LoanPeopleQuery,
) {
  return db.transaction(
    async (tx) => {
      await requireLedgerRead(tx, actorId, ledgerId);
      const rows = await loanPeopleRows(tx, ledgerId, query);
      const page = rows.slice(0, query.limit);
      const items = [];
      for (const row of page) {
        const accounts = await accountsForContact(tx, ledgerId, row.id);
        items.push({
          id: row.id,
          name: row.name,
          origin: row.origin,
          archivedAt: row.archivedAt?.toISOString() ?? null,
          version: row.version,
          balances: await Promise.all(
            accounts.map((account) => balanceDto(tx, ledgerId, account)),
          ),
        });
      }
      return loanPeopleSchema.parse({
        items,
        nextCursor:
          rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
      });
    },
    { isolationLevel: "repeatable read" },
  );
}
export async function listLoans(
  db: Database,
  actorId: string,
  ledgerId: string,
  contactId: string,
) {
  return db.transaction(
    async (tx) => {
      await requireLedgerRead(tx, actorId, ledgerId);
      await contactForAssignment(tx, ledgerId, contactId);
      const rows = await accountsForContact(
        tx,
        ledgerId,
        contactId.toLowerCase(),
      );
      return loanListSchema.parse({
        items: await Promise.all(rows.map((r) => balanceDto(tx, ledgerId, r))),
      });
    },
    { isolationLevel: "repeatable read" },
  );
}
/** The client and its balance account for one currency, with both rows locked. */
async function open(
  context: WriteContext,
  contactId: string,
  currency: string,
) {
  const [contact] = await lockContacts(context.tx, context.ledgerId, [
    contactId,
  ]);
  if (!contact) throw new ApiProblem(404, "Not found", "Client not found.");
  if (contact.archivedAt)
    throw conflict("This client is archived. Unarchive it first.");
  await requireUsableCurrency(
    context.tx,
    context.ledgerId,
    await ledgerBaseCurrency(context.tx, context.actorId, context.ledgerId),
    currency,
    { field: "amount.currency", use: "for a loan" },
  );
  const account = (
    await accountsForContact(context.tx, context.ledgerId, contact.id, true)
  ).find((row) => row.currency === currency);
  return { contact, account };
}
async function ensureAccount(
  context: WriteContext,
  contactId: string,
  currency: string,
  openingBalance = 0,
) {
  const opened = await open(context, contactId, currency);
  const account =
    opened.account ??
    (await createContactAccount(context.tx, context.ledgerId, {
      contactId: opened.contact.id,
      name: opened.contact.name,
      currency,
      openingBalance,
    }));
  if (!account) throw new Error("Could not create the balance account");
  return { ...opened, account };
}
async function currentBalance(context: WriteContext, row: Row) {
  const totals = await postedTransactionTotals(context.tx, context.ledgerId, [
    row.id,
  ]);
  return postedBalance(row.openingBalance, totals.get(row.id));
}
async function ownAccount(context: WriteContext, id: string, currency: string) {
  const [account] = await lockTransactionAccounts(
    context.tx,
    context.ledgerId,
    [id],
  );
  if (!account) throw new ApiProblem(404, "Not found", "Account not found.");
  if (account.contactId)
    throw conflict("Choose one of your own accounts.", "accountId");
  if (account.currency !== currency)
    throw conflict(
      `This account uses ${account.currency}. Lend, borrow and repay in the account's currency.`,
      "amount.currency",
    );
  return account;
}

type MoveKind = "lend" | "borrow" | "repay";
export function moveLoan(
  db: Database,
  identity: WriteIdentity,
  contactId: string,
  kind: MoveKind,
  body: LoanMove,
) {
  return runFinancialWrite(
    db,
    {
      ...identity,
      operation: `POST contacts/${contactId.toLowerCase()}/loans/${kind}`,
      request: request(body),
    },
    async (context) => {
      const mine = await ownAccount(
        context,
        body.accountId,
        body.amount.currency,
      );
      const { account } = await ensureAccount(
        context,
        contactId,
        body.amount.currency,
      );
      let outward = kind === "lend";
      if (kind === "repay") {
        const balance = await currentBalance(context, account);
        if (balance === 0)
          throw conflict("Nothing is owed either way.", "amount.amount");
        if (body.amount.amount > Math.abs(balance))
          throw conflict(
            "That is more than what is open. Lend or borrow instead.",
            "amount.amount",
          );
        // They owe you (positive): money comes back to your account. You owe them: you pay out.
        outward = balance < 0;
      }
      const transfer = await createTransferInContext(context, {
        fromAccountId: outward ? mine.id : account.id,
        toAccountId: outward ? account.id : mine.id,
        amount: body.amount,
        date: body.date,
        time: body.time,
        note: body.note,
      });
      const fresh = (
        await accountsForContact(
          context.tx,
          context.ledgerId,
          account.contactId as string,
        )
      ).find((row) => row.id === account.id) as Row;
      return {
        status: 201,
        body: loanResultSchema.parse({
          balance: await balanceDto(context.tx, context.ledgerId, fresh),
          transferId: (transfer.body as { id: string }).id,
          transactionId: null,
        }) as JsonValue,
      };
    },
  );
}

export function waiveLoan(
  db: Database,
  identity: WriteIdentity,
  contactId: string,
  body: WaiveLoan,
) {
  return runFinancialWrite(
    db,
    {
      ...identity,
      operation: `POST contacts/${contactId.toLowerCase()}/loans/waive`,
      request: request(body),
    },
    async (context) => {
      const { contact, account } = await open(
        context,
        contactId,
        body.currency,
      );
      if (!account) throw new ApiProblem(404, "Not found", "Loan not found.");
      const balance = await currentBalance(context, account);
      if (balance === 0) throw conflict("There is nothing to waive.");
      // They owed you: you give it up (an expense). You owed them: they give it up (income).
      const entry = await createTransactionInContext(context, {
        accountId: account.id,
        categoryId: body.categoryId,
        kind: balance > 0 ? "expense" : "income",
        date: body.date,
        amount: { amount: -balance, currency: body.currency },
        status: "cleared",
        payee: contact.name,
        note: body.note,
      });
      return {
        status: 201,
        body: loanResultSchema.parse({
          balance: await balanceDto(context.tx, context.ledgerId, account),
          transferId: null,
          transactionId: (entry.body as { id: string }).id,
        }) as JsonValue,
      };
    },
  );
}

/** An existing loan: the balance before Ledgerline, with no money moved in any of your accounts. */
export function setLoanOpening(
  db: Database,
  identity: WriteIdentity,
  contactId: string,
  body: LoanOpening,
) {
  return runFinancialWrite(
    db,
    {
      ...identity,
      operation: `POST contacts/${contactId.toLowerCase()}/loans/opening`,
      request: request(body),
    },
    async (context) => {
      const currency = body.amount.currency;
      const opened = await open(context, contactId, currency);
      let account: Row | undefined;
      if (!opened.account) {
        if (body.expectedVersion !== undefined)
          throw new ApiProblem(404, "Not found", "Loan not found.");
        account = await createContactAccount(context.tx, context.ledgerId, {
          contactId: opened.contact.id,
          name: opened.contact.name,
          currency,
          openingBalance: body.amount.amount,
        });
      } else {
        if (body.expectedVersion === undefined)
          throw conflict(
            "This client already has a loan in this currency. Send its version to change it.",
            "expectedVersion",
          );
        const version = nextVersion(
          opened.account.version,
          body.expectedVersion,
        );
        account = requireVersionUpdate(
          await setContactAccountOpening(
            context.tx,
            context.ledgerId,
            opened.account.id,
            body.expectedVersion,
            body.amount,
            version,
          ),
        );
        // The balance must stay inside the exact money range with the entries already saved.
        await currentBalance(context, account);
      }
      if (!account) throw new Error("Could not save the balance account");
      return {
        status: 200,
        body: loanResultSchema.parse({
          balance: await balanceDto(context.tx, context.ledgerId, account),
          transferId: null,
          transactionId: null,
        }) as JsonValue,
      };
    },
  );
}

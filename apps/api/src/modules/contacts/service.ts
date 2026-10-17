import {
  type ClientListQuery,
  type CreateContact,
  contactSchema,
  type JsonValue,
  type LoanPeopleQuery,
  type UpdateContact,
} from "@ledgerline/shared";
import type { Database, DatabaseConnection } from "../../db/client";
import { ApiProblem } from "../../lib/problem";
import { accountsForContact, renameContactAccounts } from "../accounts/service";
import { requireLedgerRead } from "../ledgers/service";
import {
  clientBalances,
  requireNoReceivables,
} from "../receivables/balance-service";
import { runFinancialWrite, type WriteIdentity } from "../writes/service";
import { nextVersion } from "../writes/version";
import { type ContactRow, contactRepository } from "./repo";

const required = (r: ContactRow | undefined) => {
  if (!r) throw new ApiProblem(404, "Not found", "Client not found.");
  return r;
};
async function dto(
  db: DatabaseConnection,
  ledgerId: string,
  row: ContactRow,
  balances?: Awaited<ReturnType<typeof clientBalances>>,
) {
  const balance = (balances ?? (await clientBalances(db, ledgerId))).get(
    row.id,
  );
  return contactSchema.parse({
    ...row,
    // The base currency is USD for every ledger today (ADR 0020).
    openBalance: { amount: balance?.amount ?? 0, currency: "USD" },
    openBalances: balance?.amounts ?? [],
    unconvertedCurrencies: balance?.unconverted ?? [],
    oldestOpenServiceDate: balance?.oldest ?? null,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}
/** People added for loans or already holding a balance account (ADR 0030). */
export function loanPeopleRows(
  db: DatabaseConnection,
  ledgerId: string,
  query: LoanPeopleQuery,
) {
  return contactRepository(db, ledgerId).loanPeople(query);
}
export async function lockContacts(
  db: DatabaseConnection,
  ledgerId: string,
  ids: string[],
) {
  const rows: ContactRow[] = [];
  for (const id of [...new Set(ids.map((v) => v.toLowerCase()))].sort())
    rows.push(required(await contactRepository(db, ledgerId).find(id, true)));
  return rows;
}
export async function contactForAssignment(
  db: DatabaseConnection,
  ledgerId: string,
  id: string,
) {
  return required(await contactRepository(db, ledgerId).find(id));
}
export async function listContacts(
  db: Database,
  actorId: string,
  ledgerId: string,
  q: ClientListQuery,
) {
  return db.transaction(
    async (tx) => {
      await requireLedgerRead(tx, actorId, ledgerId);
      const rows = await contactRepository(tx, ledgerId).list(q);
      const balances = await clientBalances(tx, ledgerId);
      return {
        items: await Promise.all(
          rows.slice(0, q.limit).map((r) => dto(tx, ledgerId, r, balances)),
        ),
        nextCursor:
          rows.length > q.limit ? (rows[q.limit - 1]?.id ?? null) : null,
      };
    },
    { isolationLevel: "repeatable read" },
  );
}
export async function getContact(
  db: Database,
  actorId: string,
  ledgerId: string,
  id: string,
) {
  return db.transaction(
    async (tx) => {
      await requireLedgerRead(tx, actorId, ledgerId);
      return dto(
        tx,
        ledgerId,
        required(await contactRepository(tx, ledgerId).find(id)),
      );
    },
    { isolationLevel: "repeatable read" },
  );
}
export function saveContact(
  db: Database,
  identity: WriteIdentity,
  id: string | null,
  body: CreateContact | UpdateContact,
) {
  return runFinancialWrite(
    db,
    {
      ...identity,
      operation: `${id ? "PATCH" : "POST"} contacts${id ? `/${id.toLowerCase()}` : ""}`,
      request: body as JsonValue,
    },
    async (c) => {
      const repo = contactRepository(c.tx, c.ledgerId);
      if (!id)
        return {
          status: 201,
          body: await dto(c.tx, c.ledgerId, required(await repo.create(body))),
        };
      const current = required(await repo.find(id, true));
      const { expectedVersion, ...fields } = body as UpdateContact;
      const version = nextVersion(current.version, expectedVersion);
      // A client's balance accounts carry its name (ADR 0030).
      if (fields.name !== undefined && fields.name !== current.name)
        await renameContactAccounts(c.tx, c.ledgerId, current.id, fields.name);
      return {
        status: 200,
        body: await dto(
          c.tx,
          c.ledgerId,
          required(
            await repo.update(id, expectedVersion, { ...fields, version }),
          ),
        ),
      };
    },
  );
}
export function contactAction(
  db: Database,
  identity: WriteIdentity,
  id: string,
  expectedVersion: number,
  action: "archive" | "unarchive" | "delete",
) {
  return runFinancialWrite(
    db,
    {
      ...identity,
      operation: `${action === "delete" ? "DELETE" : "POST"} contacts/${id.toLowerCase()}${action === "delete" ? "" : `/${action}`}`,
      request: { expectedVersion },
    },
    async (c) => {
      const repo = contactRepository(c.tx, c.ledgerId),
        current = required(await repo.find(id, true));
      const version = nextVersion(current.version, expectedVersion);
      if (action === "delete") {
        await requireNoReceivables(c.tx, c.ledgerId, id);
        // Money lent or borrowed keeps its balance account, so the client stays (ADR 0030).
        if (
          (await accountsForContact(c.tx, c.ledgerId, id.toLowerCase()))
            .length > 0
        )
          throw new ApiProblem(
            409,
            "Conflict",
            "This client has a loan record. Archive the client instead.",
          );
      } else if (!!current.archivedAt === (action === "archive"))
        throw new ApiProblem(
          409,
          "Conflict",
          "This client already has that archive state.",
        );
      const row = required(
        await repo.update(id, expectedVersion, {
          version,
          ...(action === "delete"
            ? { deletedAt: new Date() }
            : { archivedAt: action === "archive" ? new Date() : null }),
        }),
      );
      return action === "delete"
        ? { status: 204, body: null }
        : { status: 200, body: await dto(c.tx, c.ledgerId, row) };
    },
  );
}

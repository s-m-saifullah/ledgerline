import {
  clearLedgerSchema,
  ledgerParamsSchema,
  ledgerSchema,
  updateLedgerSchema,
} from "@ledgerline/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { Config } from "../../config";
import type { Database } from "../../db/client";
import { errors, writeHeaders } from "../../lib/route-helpers";
import type { Auth } from "../auth/service";
import { financialWriteIdentity, sendFinancialWrite } from "../writes/http";
import { clearLedger, restoreLedger, updateLedger } from "./service";

export async function ledgerRoutes(
  instance: FastifyInstance,
  { db, config, auth }: { db: Database; config: Config; auth: Auth },
) {
  const app = instance.withTypeProvider<ZodTypeProvider>();
  app.patch(
    "/api/v1/ledgers/:ledgerId",
    {
      schema: {
        summary: "Set the ledger time zone",
        description:
          "Sets the IANA time zone that decides what today means for scheduled work such as recurring entries. Owner only; uses expectedVersion.",
        tags: ["Ledgers"],
        security: [{ sessionCookie: [] }],
        params: ledgerParamsSchema,
        headers: writeHeaders,
        body: updateLedgerSchema,
        response: { 200: ledgerSchema, ...errors },
      },
    },
    async (request, reply) =>
      sendFinancialWrite(
        reply,
        await updateLedger(
          db,
          await financialWriteIdentity(auth, config, request),
          request.body,
        ),
      ),
  );
  app.post(
    "/api/v1/ledgers/:ledgerId/clear",
    {
      schema: {
        summary: "Clear the ledger",
        description:
          'Empties the ledger so the owner can start fresh: every entry, account, category and the rest is removed from sight and can be restored for 30 days (`POST .../restore`). The ledger, its name, its currency and its members stay. The body must be `{ "confirm": "CLEAR" }`. One undo: clearing again removes the older one at once. Does nothing, and keeps the undo, when the ledger is already empty. Owner only; keys used before the clear no longer replay. Answers with the ledger, whose `clearedAt` says when.',
        tags: ["Ledgers"],
        security: [{ sessionCookie: [] }],
        params: ledgerParamsSchema,
        headers: writeHeaders,
        body: clearLedgerSchema,
        response: { 200: ledgerSchema, ...errors },
      },
    },
    async (request, reply) =>
      sendFinancialWrite(
        reply,
        await clearLedger(
          db,
          await financialWriteIdentity(auth, config, request),
          request.body,
        ),
      ),
  );
  app.post(
    "/api/v1/ledgers/:ledgerId/restore",
    {
      schema: {
        summary: "Restore the cleared ledger",
        description:
          'Brings back what the last clear removed, as it was: for 30 days after the clear, and only while nothing live is in the ledger (`409`, "Clear what is there now first."). Nothing to restore, or the 30 days over, is `409`. Owner only. Answers with the ledger.',
        tags: ["Ledgers"],
        security: [{ sessionCookie: [] }],
        params: ledgerParamsSchema,
        headers: writeHeaders,
        response: { 200: ledgerSchema, ...errors },
      },
    },
    async (request, reply) =>
      sendFinancialWrite(
        reply,
        await restoreLedger(
          db,
          await financialWriteIdentity(auth, config, request),
        ),
      ),
  );
}

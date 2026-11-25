import {
  clearLedgerSchema,
  ledgerParamsSchema,
  ledgerSchema,
  updateLedgerSchema,
} from "@ledgerline/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Config } from "../../config";
import type { Database } from "../../db/client";
import { ApiProblem } from "../../lib/problem";
import {
  createActor,
  errors,
  problems,
  readErrors,
  security,
  writeHeaders,
} from "../../lib/route-helpers";
import type { Auth } from "../auth/service";
import { financialWriteIdentity, sendFinancialWrite } from "../writes/http";
import {
  clearLedger,
  ledgerService,
  restoreLedger,
  updateLedger,
} from "./service";

export async function ledgerRoutes(
  instance: FastifyInstance,
  { db, config, auth }: { db: Database; config: Config; auth: Auth },
) {
  const app = instance.withTypeProvider<ZodTypeProvider>();
  const actor = createActor(auth);
  app.get(
    "/api/v1/ledgers",
    {
      schema: {
        summary: "List my ledgers",
        description:
          "Read-only. The ledgers I belong to. Other people's ledgers and deleted ones are never listed.",
        tags: ["Ledgers"],
        security,
        response: {
          200: z.object({ items: z.array(ledgerSchema) }),
          ...problems(401, 403, 500),
        },
      },
    },
    async (request) => ({
      items: await ledgerService(db, await actor(request)).list(),
    }),
  );
  app.get(
    "/api/v1/ledgers/:ledgerId",
    {
      schema: {
        summary: "Get a ledger",
        description:
          "Read-only. One of my ledgers; `404` for a ledger that is not mine, however it is named.",
        tags: ["Ledgers"],
        security,
        params: ledgerParamsSchema,
        response: { 200: ledgerSchema, ...readErrors },
      },
    },
    async (request) => {
      const ledger = await ledgerService(db, await actor(request)).find(
        request.params.ledgerId,
      );
      if (!ledger) throw new ApiProblem(404, "Not found", "Ledger not found.");
      return ledger;
    },
  );
  app.patch(
    "/api/v1/ledgers/:ledgerId",
    {
      schema: {
        summary: "Set the ledger time zone",
        description:
          "Sets the IANA time zone that decides what today means for scheduled work such as recurring entries. Owner only; uses expectedVersion.",
        tags: ["Ledgers"],
        security,
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
        security,
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
        security,
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

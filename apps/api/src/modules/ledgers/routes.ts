import {
  idempotencyKeySchema,
  ledgerParamsSchema,
  ledgerSchema,
  problemSchema,
  updateLedgerSchema,
} from "@ledgerline/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Config } from "../../config";
import type { Database } from "../../db/client";
import type { Auth } from "../auth/service";
import { financialWriteIdentity, sendFinancialWrite } from "../writes/http";
import { updateLedger } from "./service";

const errors = {
  400: problemSchema,
  401: problemSchema,
  403: problemSchema,
  404: problemSchema,
  409: problemSchema,
  500: problemSchema,
};
const writeHeaders = z.looseObject({ "idempotency-key": idempotencyKeySchema });

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
}

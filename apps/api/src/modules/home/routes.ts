import {
  homeParamsSchema,
  homeQuerySchema,
  homeSummarySchema,
} from "@ledgerline/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { Config } from "../../config";
import type { Database } from "../../db/client";
import { createActor, readErrors, security } from "../../lib/route-helpers";
import type { Auth } from "../auth/service";
import { getHomeSummary } from "./service";

export async function homeRoutes(
  instance: FastifyInstance,
  { db, auth }: { db: Database; config: Config; auth: Auth },
) {
  const app = instance.withTypeProvider<ZodTypeProvider>();
  const actor = createActor(auth);
  app.get(
    "/api/v1/ledgers/:ledgerId/home",
    {
      schema: {
        summary: "Get the Home summary",
        description:
          "Read-only snapshot for one calendar month (YYYY-MM): net worth, account balances, cleared income and spending, open owed total, pending count and the five latest entries. Pending entries, transfers and split lines never enter income or spending; owed money is excluded from net worth.",
        tags: ["Home"],
        security,
        params: homeParamsSchema,
        querystring: homeQuerySchema,
        response: { 200: homeSummarySchema, ...readErrors },
      },
    },
    async (request) =>
      getHomeSummary(
        db,
        await actor(request),
        request.params.ledgerId,
        request.query.month,
      ),
  );
}

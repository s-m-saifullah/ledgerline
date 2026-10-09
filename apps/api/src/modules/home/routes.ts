import {
  homeParamsSchema,
  homeQuerySchema,
  homeSummarySchema,
  problemSchema,
} from "@ledgerline/shared";
import { fromNodeHeaders } from "better-auth/node";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { Config } from "../../config";
import type { Database } from "../../db/client";
import { ApiProblem } from "../../lib/problem";
import type { Auth } from "../auth/service";
import { getHomeSummary } from "./service";

const errors = {
  400: problemSchema,
  401: problemSchema,
  404: problemSchema,
  409: problemSchema,
  500: problemSchema,
};

export async function homeRoutes(
  instance: FastifyInstance,
  { db, auth }: { db: Database; config: Config; auth: Auth },
) {
  const app = instance.withTypeProvider<ZodTypeProvider>();
  app.get(
    "/api/v1/ledgers/:ledgerId/home",
    {
      schema: {
        summary: "Get the Home summary",
        description:
          "Read-only snapshot for one calendar month (YYYY-MM): net worth, account balances, cleared income and spending, open owed total, pending count and the five latest entries. Pending entries, transfers and split lines never enter income or spending; owed money is excluded from net worth.",
        tags: ["Home"],
        security: [{ sessionCookie: [] }],
        params: homeParamsSchema,
        querystring: homeQuerySchema,
        response: { 200: homeSummarySchema, ...errors },
      },
    },
    async (request) => {
      const session = await auth.api.getSession({
        headers: fromNodeHeaders(request.headers),
      });
      if (!session)
        throw new ApiProblem(401, "Unauthorized", "Sign in to continue.");
      return getHomeSummary(
        db,
        session.user.id,
        request.params.ledgerId,
        request.query.month,
      );
    },
  );
}

import {
  exportParamsSchema,
  exportTransactionsQuerySchema,
  problemSchema,
} from "@ledgerline/shared";
import { fromNodeHeaders } from "better-auth/node";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Config } from "../../config";
import type { Database } from "../../db/client";
import { ApiProblem } from "../../lib/problem";
import type { Auth } from "../auth/service";
import { accountsCsv, categoriesCsv, transactionsCsv } from "./service";

const errors = {
  400: problemSchema,
  401: problemSchema,
  404: problemSchema,
  500: problemSchema,
};
const csvBody = z.string().describe("CSV file (UTF-8 with a byte-order mark).");

/** The file is built while it is sent and never stored anywhere (ADR 0033). */
function sendCsv(
  reply: FastifyReply,
  name: string,
  body: NodeJS.ReadableStream,
) {
  const day = new Date().toISOString().slice(0, 10);
  return reply
    .header("content-type", "text/csv; charset=utf-8")
    .header(
      "content-disposition",
      `attachment; filename="ledgerline-${name}-${day}.csv"`,
    )
    .header("cache-control", "no-store")
    .header("x-content-type-options", "nosniff")
    .send(body);
}

export async function exportRoutes(
  instance: FastifyInstance,
  { db, auth }: { db: Database; config: Config; auth: Auth },
) {
  const app = instance.withTypeProvider<ZodTypeProvider>();
  const actor = async (headers: Parameters<typeof fromNodeHeaders>[0]) => {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(headers),
    });
    if (!session)
      throw new ApiProblem(401, "Unauthorized", "Sign in to continue.");
    return session.user.id;
  };
  const schema = (summary: string, description: string) => ({
    summary,
    description: `${description} Read-only. The file is generated while it is sent from one consistent snapshot and is never stored on the server; nothing is cached (\`Cache-Control: no-store\`).`,
    tags: ["Exports"],
    security: [{ sessionCookie: [] }],
    params: exportParamsSchema,
    response: { 200: csvBody, ...errors },
  });
  app.get(
    "/api/v1/ledgers/:ledgerId/exports/transactions.csv",
    {
      schema: {
        ...schema(
          "Download transactions as CSV",
          "Entries oldest first, with the same filters as the transaction list (no paging). Amounts are positive decimal text in each currency's own digits and `type` is the direction. A transfer is one row (account to to_account, with received_amount when currencies differ); a split entry is one row per line sharing the entry id. Deleted entries are left out; pending ones carry status `pending`. Text that could run as a spreadsheet formula starts with an apostrophe.",
        ),
        querystring: exportTransactionsQuerySchema,
      },
    },
    async (request, reply) =>
      sendCsv(
        reply,
        "transactions",
        await transactionsCsv(
          db,
          await actor(request.headers),
          request.params.ledgerId,
          request.query,
        ),
      ),
  );
  app.get(
    "/api/v1/ledgers/:ledgerId/exports/accounts.csv",
    {
      schema: schema(
        "Download accounts as CSV",
        "Every account that is not deleted, archived ones included, with its opening balance.",
      ),
    },
    async (request, reply) =>
      sendCsv(
        reply,
        "accounts",
        await accountsCsv(
          db,
          await actor(request.headers),
          request.params.ledgerId,
        ),
      ),
  );
  app.get(
    "/api/v1/ledgers/:ledgerId/exports/categories.csv",
    {
      schema: schema(
        "Download categories as CSV",
        "Every category that is not deleted, archived ones included, with its parent's name.",
      ),
    },
    async (request, reply) =>
      sendCsv(
        reply,
        "categories",
        await categoriesCsv(
          db,
          await actor(request.headers),
          request.params.ledgerId,
        ),
      ),
  );
}

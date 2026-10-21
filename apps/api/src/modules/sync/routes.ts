import {
  syncParamsSchema,
  syncQuerySchema,
  syncResponseSchema,
} from "@ledgerline/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { Config } from "../../config";
import type { Database } from "../../db/client";
import { createActor, errors } from "../../lib/route-helpers";
import type { Auth } from "../auth/service";
import { getSyncPage } from "./service";

export async function syncRoutes(
  instance: FastifyInstance,
  { db, auth }: { db: Database; config: Config; auth: Auth },
) {
  const app = instance.withTypeProvider<ZodTypeProvider>();
  const actor = createActor(auth);
  app.get(
    "/api/v1/ledgers/:ledgerId/sync",
    {
      schema: {
        summary: "Changes for the Android app's offline mirror",
        description:
          "Read-only. Every account, category, tag, currency, exchange rate, entry, split line and entry tag changed after `cursor` (everything when it is omitted), deleted rows included as tombstones (`deletedAt` set), in one consistent snapshot, up to `limit` rows per table (default 500, at most 1000). Rows are the stored rows, not the joined shapes of the web screens: money is `{ amount, currency }`, an entry carries `accountId`, `categoryId` and no tag names, and the phone joins names itself. While `hasMore` is true, call again with the returned `cursor`; keep the last cursor for the next pull. The cursor deliberately runs about two minutes behind the newest row so a change that commits late is sent again: apply rows by id and ignore a row whose `version` (or, for entry tags, `updatedAt`) is not newer than the copy you hold. Viewers can read; a ledger the caller is not a member of is `404`; a cursor the server did not make is `400`.",
        tags: ["Sync"],
        security: [{ sessionCookie: [] }, { bearerAuth: [] }],
        params: syncParamsSchema,
        querystring: syncQuerySchema,
        response: { 200: syncResponseSchema, ...errors },
      },
    },
    async (request) =>
      getSyncPage(
        db,
        await actor(request),
        request.params.ledgerId,
        request.query.cursor,
        request.query.limit,
      ),
  );
}

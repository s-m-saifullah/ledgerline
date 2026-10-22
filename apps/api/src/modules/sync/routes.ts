import {
  syncParamsSchema,
  syncPushResponseSchema,
  syncPushSchema,
  syncQuerySchema,
  syncResponseSchema,
} from "@ledgerline/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { Config } from "../../config";
import type { Database } from "../../db/client";
import { createActor, errors, requireAppOrigin } from "../../lib/route-helpers";
import type { Auth } from "../auth/service";
import { pushMutations } from "./push-service";
import { getSyncPage } from "./service";

export async function syncRoutes(
  instance: FastifyInstance,
  { db, auth, config }: { db: Database; config: Config; auth: Auth },
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
  app.post(
    "/api/v1/ledgers/:ledgerId/sync",
    {
      schema: {
        summary: "Apply the Android app's offline changes",
        description:
          "Applies up to 50 mutations in order, each as its own idempotent write: the mutation `id` is the idempotency key, so a batch that is cut off and sent again changes nothing twice (`replayed`). Types: `transaction.create`, `transaction.update`, `transaction.delete`, `transfer.create`, `transfer.update`, `transfer.delete`. A create sends the fields of `POST /transactions` or `POST /transfers` as `body`, and its `id` becomes the new entry's id (a transfer's `transferId`); an update or delete names its `targetId` and the `baseVersion` the phone last saw (an entry update sends only the changed fields; a transfer update sends every field, as `PATCH /transfers/{id}` does). Last write wins per row: if the row is still at `baseVersion` the change applies; if it has changed, the later edit wins, comparing `editedAt` (capped at the time the server received it) with the row's last update, and a tie goes to the server. A change that loses is `superseded` and `rows` carries the server's version; editing a deleted row is `superseded`; deleting a deleted row is `applied`. A mutation that is not valid or not allowed is `rejected` with a `problem` and the rest still run. Each result's `rows` are the entry (or both legs of a transfer with its bonus and fee) as the server now has them. Viewers get `403` and a ledger the caller is not a member of `404` for the whole request; an invalid request body, an unknown type, more than 50 mutations or a repeated mutation id is `400`. Uses the `Origin` header like every write.",
        tags: ["Sync"],
        security: [{ sessionCookie: [] }, { bearerAuth: [] }],
        params: syncParamsSchema,
        body: syncPushSchema,
        response: { 200: syncPushResponseSchema, ...errors },
      },
    },
    async (request) => {
      const actorId = await actor(request);
      requireAppOrigin(request, config.APP_URL);
      return pushMutations(
        db,
        actorId,
        request.params.ledgerId,
        request.body.mutations,
      );
    },
  );
}

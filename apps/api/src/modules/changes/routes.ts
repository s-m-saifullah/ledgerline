import { changeMarkerSchema, ledgerParamsSchema } from "@ledgerline/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { Database } from "../../db/client";
import { createActor, errors } from "../../lib/route-helpers";
import type { Auth } from "../auth/service";
import { getChangeMarker } from "./service";

export async function changeRoutes(
  instance: FastifyInstance,
  { db, auth }: { db: Database; auth: Auth },
) {
  const app = instance.withTypeProvider<ZodTypeProvider>();
  const actor = createActor(auth);
  app.get(
    "/api/v1/ledgers/:ledgerId/changes",
    {
      schema: {
        summary: "A marker that moves when anything in the ledger changes",
        description:
          "Read-only and cheap, for open pages that want to follow changes made elsewhere (the Android app, another browser, a background job). `marker` is opaque: poll it now and then and reload when it differs from the last one. It moves on every insert, update, soft delete or hard delete of any row of the ledger and says nothing about what changed. Viewers can read; a ledger the caller is not a member of is `404`.",
        tags: ["Sync"],
        security: [{ sessionCookie: [] }, { bearerAuth: [] }],
        params: ledgerParamsSchema,
        response: { 200: changeMarkerSchema, ...errors },
      },
    },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      return getChangeMarker(db, await actor(request), request.params.ledgerId);
    },
  );
}

import {
  problemSchema,
  sessionListSchema,
  sessionParamsSchema,
} from "@ledgerline/shared";
import { fromNodeHeaders } from "better-auth/node";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Config } from "../../config";
import type { Database } from "../../db/client";
import { ApiProblem } from "../../lib/problem";
import { requireAppOrigin } from "../../lib/route-helpers";
import type { Auth } from "./service";
import {
  listSessions,
  revokeOtherSessions,
  revokeSession,
} from "./sessions-service";

const errors = {
  401: problemSchema,
  403: problemSchema,
  404: problemSchema,
  409: problemSchema,
  500: problemSchema,
};
const security = [{ sessionCookie: [] }, { bearerAuth: [] }];

/** The signed-in devices of the caller: list them and sign others out (ADR 0042). */
export async function sessionRoutes(
  instance: FastifyInstance,
  { db, auth, config }: { db: Database; config: Config; auth: Auth },
) {
  const app = instance.withTypeProvider<ZodTypeProvider>();
  const who = async (request: FastifyRequest) => {
    const found = await auth.api.getSession({
      headers: fromNodeHeaders(request.headers),
    });
    if (!found)
      throw new ApiProblem(401, "Unauthorized", "Sign in to continue.");
    return { userId: found.user.id, currentId: found.session.id };
  };
  app.get(
    "/api/v1/sessions",
    {
      schema: {
        summary: "Devices signed in as you",
        description:
          "Read-only. Your active sessions, newest use first (at most 100): a readable device name, whether it is the one making this request, and when it was created, last used (about once a day) and expires. Never returns tokens or addresses.",
        tags: ["Sessions"],
        security,
        response: { 200: sessionListSchema, ...errors },
      },
    },
    async (request) => {
      const { userId, currentId } = await who(request);
      return { items: await listSessions(db, userId, currentId) };
    },
  );
  app.delete(
    "/api/v1/sessions/:sessionId",
    {
      schema: {
        summary: "Sign one other device out",
        description:
          "Ends another session of yours; its token stops working at once. The session making the request is `409` (use sign out); an id that is not one of your active sessions is `404`. Needs `Origin` like every write.",
        tags: ["Sessions"],
        security,
        params: sessionParamsSchema,
        response: { 204: z.null(), ...errors },
      },
    },
    async (request, reply) => {
      const { userId, currentId } = await who(request);
      requireAppOrigin(request, config.APP_URL);
      await revokeSession(db, userId, currentId, request.params.sessionId);
      return reply.code(204).send(null);
    },
  );
  app.delete(
    "/api/v1/sessions",
    {
      schema: {
        summary: "Sign every other device out",
        description:
          "Ends all your sessions except the one making the request. Safe to repeat. Needs `Origin` like every write.",
        tags: ["Sessions"],
        security,
        response: { 204: z.null(), ...errors },
      },
    },
    async (request, reply) => {
      const { userId, currentId } = await who(request);
      requireAppOrigin(request, config.APP_URL);
      await revokeOtherSessions(db, userId, currentId);
      return reply.code(204).send(null);
    },
  );
}

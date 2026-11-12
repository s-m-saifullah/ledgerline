import {
  changePasswordSchema,
  meSchema,
  problemSchema,
  updateMeSchema,
} from "@ledgerline/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Config } from "../../config";
import type { Database } from "../../db/client";
import { ApiProblem } from "../../lib/problem";
import { requireAppOrigin } from "../../lib/route-helpers";
import { requestSession } from "../auth/request-session";
import type { Auth } from "../auth/service";
import {
  changePassword,
  createAttemptLimiter,
  readMe,
  renameMe,
} from "./service";

const errors = {
  401: problemSchema,
  403: problemSchema,
  429: problemSchema,
  500: problemSchema,
};
const security = [{ sessionCookie: [] }, { bearerAuth: [] }];

/**
 * The signed-in person's own account (ADR 0048). These are not about a ledger, so they take no Idempotency-Key:
 * a rename is safe to repeat, and a lost answer to a password change is retried with the new password as the
 * current one.
 */
export async function meRoutes(
  instance: FastifyInstance,
  {
    db,
    auth,
    config,
    now,
  }: { db: Database; config: Config; auth: Auth; now: () => Date },
) {
  const app = instance.withTypeProvider<ZodTypeProvider>();
  const limiter = createAttemptLimiter(now);
  const who = async (request: FastifyRequest) => {
    const found = await requestSession(auth, request);
    if (!found)
      throw new ApiProblem(401, "Unauthorized", "Sign in to continue.");
    return { userId: found.user.id, sessionId: found.session.id };
  };
  app.get(
    "/api/v1/me",
    {
      schema: {
        summary: "Who I am",
        description:
          "Read-only. My name, email, whether I am the admin, whether I am still on a temporary password (every other request is refused until I change it) and whether two-factor is on. Never returns a password, a hash or a token.",
        tags: ["Account"],
        security,
        response: { 200: meSchema, ...errors },
      },
    },
    async (request) => readMe(db, (await who(request)).userId),
  );
  app.patch(
    "/api/v1/me",
    {
      schema: {
        summary: "Change my name",
        description:
          "Changes only the name (1 to 100 characters). The email and the admin flag cannot be changed here; unknown fields are ignored. Needs `Origin` like every write.",
        tags: ["Account"],
        security,
        body: updateMeSchema,
        response: { 200: meSchema, 400: problemSchema, ...errors },
      },
    },
    async (request) => {
      const { userId } = await who(request);
      requireAppOrigin(request, config.APP_URL);
      return renameMe(db, userId, request.body.name);
    },
  );
  app.post(
    "/api/v1/me/password",
    {
      schema: {
        summary: "Change my password",
        description:
          "Needs the current password and a new one of 12 to 128 characters that differs from it. A wrong current password is `400` with a `currentPassword` field error; five wrong ones in fifteen minutes are `429` until the window passes. A person on a temporary password may use this route and read `/me`, nothing else. Ends my other sessions unless `signOutOtherDevices` is false (an app token ends with its session). Needs `Origin` like every write.",
        tags: ["Account"],
        security,
        body: changePasswordSchema,
        response: { 204: z.null(), 400: problemSchema, ...errors },
      },
    },
    async (request, reply) => {
      const { userId, sessionId } = await who(request);
      requireAppOrigin(request, config.APP_URL);
      await changePassword(db, limiter, {
        userId,
        sessionId,
        ...request.body,
      });
      return reply.code(204).send(null);
    },
  );
}

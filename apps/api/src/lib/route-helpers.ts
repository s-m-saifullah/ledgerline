import { idempotencyKeySchema, problemSchema } from "@ledgerline/shared";
import { fromNodeHeaders } from "better-auth/node";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import type { Auth } from "../modules/auth/service";
import { ApiProblem } from "./problem";

/** Error responses shared by the authenticated, ledger-scoped routes. */
export const errors = {
  400: problemSchema,
  401: problemSchema,
  403: problemSchema,
  404: problemSchema,
  409: problemSchema,
  500: problemSchema,
};

/** Validates and documents the write key while keeping cookies and origin. */
export const writeHeaders = z.looseObject({
  "idempotency-key": idempotencyKeySchema,
});

/** Returns a function that reads the signed-in user's id or throws 401. */
export function createActor(auth: Auth) {
  return async function actor(request: FastifyRequest) {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(request.headers),
    });
    if (!session)
      throw new ApiProblem(401, "Unauthorized", "Sign in to continue.");
    return session.user.id;
  };
}

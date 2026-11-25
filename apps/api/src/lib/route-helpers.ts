import { idempotencyKeySchema, problemSchema } from "@ledgerline/shared";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { requestSession } from "../modules/auth/request-session";
import type { Auth } from "../modules/auth/service";
import { ApiProblem } from "./problem";

/** A response map that answers each of the given codes with a problem document. */
export function problems<K extends number>(...codes: K[]) {
  return Object.fromEntries(
    codes.map((code) => [code, problemSchema]),
  ) as Record<K, typeof problemSchema>;
}

/** Error responses shared by the signed-in, ledger-scoped routes that change data (or can find a conflict). */
export const errors = problems(400, 401, 403, 404, 409, 500);

/** The same for a read that cannot conflict. 403 is there because the account guard can answer it on any route. */
export const readErrors = problems(400, 401, 403, 404, 500);

/**
 * Who may call a signed-in route: the browser's session cookie or the Android app's token. The server treats both
 * the same (the account guard and the session lookup read either), so every signed-in operation says both.
 */
export const security = [{ sessionCookie: [] }, { bearerAuth: [] }];

/** Validates and documents the write key while keeping cookies and origin. */
export const writeHeaders = z.looseObject({
  "idempotency-key": idempotencyKeySchema,
});

/** Returns a function that reads the signed-in user's id or throws 401. */
export function createActor(auth: Auth) {
  const who = createSessionActor(auth);
  return async function actor(request: FastifyRequest) {
    return (await who(request)).userId;
  };
}

/** The same, for a route that also needs to know which session is asking (the devices list, the account page). */
export function createSessionActor(auth: Auth) {
  return async function actor(request: FastifyRequest) {
    const session = await requestSession(auth, request);
    if (!session)
      throw new ApiProblem(401, "Unauthorized", "Sign in to continue.");
    return { userId: session.user.id, sessionId: session.session.id };
  };
}

/** Refuses a write whose Origin is not the app's own address (the same rule on every route that changes data). */
export function requireAppOrigin(request: FastifyRequest, appUrl: string) {
  if (request.headers.origin !== new URL(appUrl).origin)
    throw new ApiProblem(403, "Forbidden", "Request origin is not allowed.");
}

import { fromNodeHeaders } from "better-auth/node";
import type { FastifyRequest } from "fastify";
import type { Auth } from "./service";

type Found = Awaited<ReturnType<Auth["api"]["getSession"]>>;

const lookups = new WeakMap<FastifyRequest, Promise<Found>>();

/**
 * The session of a request, looked up once. The account guard runs first on every `/api/v1` route and the route then
 * needs to know who is asking too; both get the same answer from one read of the session table. Only the request's
 * own lifetime is covered (nothing is kept between requests), and a lookup that failed is forgotten so that asking
 * again tries again.
 */
export function requestSession(auth: Auth, request: FastifyRequest) {
  const known = lookups.get(request);
  if (known) return known;
  const lookup = auth.api.getSession({
    headers: fromNodeHeaders(request.headers),
  });
  lookups.set(request, lookup);
  lookup.catch(() => {
    if (lookups.get(request) === lookup) lookups.delete(request);
  });
  return lookup;
}

import { passwordChangeRequiredType } from "@ledgerline/shared";
import { fromNodeHeaders } from "better-auth/node";
import type { FastifyRequest } from "fastify";
import { ApiProblem } from "../../lib/problem";
import type { Auth } from "./service";

/** The only two routes a person on a temporary password may use besides the sign-in routes (ADR 0048). */
const openToTemporary = new Set(["GET /api/v1/me", "POST /api/v1/me/password"]);

/**
 * One check for every `/api/v1` route, so none can forget it. A person on a temporary password is refused
 * everywhere but changing it, and a person whose sign-in was stopped is refused everywhere. The sign-in routes
 * (`/api/v1/auth/*`) are not covered: a person must be able to sign in, see their session and sign out. A request
 * without a session passes, and the route answers 401 itself. Works the same for a cookie and for the app's token.
 */
export function accountGuard(auth: Auth) {
  return async function guard(request: FastifyRequest) {
    const route = request.routeOptions.url ?? "";
    if (!route.startsWith("/api/v1/") || route.startsWith("/api/v1/auth/"))
      return;
    const found = await auth.api.getSession({
      headers: fromNodeHeaders(request.headers),
    });
    if (!found) return;
    const person = found.user as {
      mustChangePassword?: boolean;
      disabledAt?: Date | null;
    };
    if (person.disabledAt)
      throw new ApiProblem(401, "Unauthorized", "Sign in to continue.");
    if (
      person.mustChangePassword &&
      !openToTemporary.has(`${request.method} ${route}`)
    )
      throw new ApiProblem(
        403,
        "Password change required",
        "Choose a new password to continue.",
        [],
        passwordChangeRequiredType,
      );
  };
}

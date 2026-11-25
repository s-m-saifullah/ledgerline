import { fromNodeHeaders } from "better-auth/node";
import type { FastifyInstance } from "fastify";
import type { Config } from "../../config";
import type { Database } from "../../db/client";
import { problem } from "../../lib/problem";
import { mayReceiveDeviceToken } from "./device-token";
import type { Auth } from "./service";
import { isSignInStopped } from "./sign-in-stopped";

/** The two-factor routes the browser may call (ADR 0038); every other auth route stays disabled. */
const twoFactorPaths = [
  "/api/v1/auth/two-factor/enable",
  "/api/v1/auth/two-factor/verify-totp",
  "/api/v1/auth/two-factor/verify-backup-code",
  "/api/v1/auth/two-factor/generate-backup-codes",
  "/api/v1/auth/two-factor/disable",
];

/**
 * The sign-in routes: a small, fixed window onto Better Auth (ADR 0038, ADR 0042). Only the routes below answer, every
 * one that changes something wants the app's own Origin, a person whose sign-in was stopped is turned away like a wrong
 * password, and a failure never shows Better Auth's own words.
 */
export async function authProxyRoutes(
  app: FastifyInstance,
  { db, config, auth }: { db: Database; config: Config; auth: Auth },
) {
  // Expose only the browser-session endpoints (Phase 0) and the two-factor routes of ADR 0038.
  app.route({
    method: ["GET", "POST"],
    url: "/api/v1/auth/*",
    schema: { hide: true },
    handler: async (request, reply) => {
      const path = new URL(request.url, config.APP_URL).pathname;
      const allowed =
        (request.method === "GET" && path === "/api/v1/auth/get-session") ||
        (request.method === "POST" &&
          [
            "/api/v1/auth/sign-in/email",
            "/api/v1/auth/sign-out",
            ...twoFactorPaths,
          ].includes(path));
      if (!allowed)
        return reply
          .code(404)
          .type("application/problem+json")
          .send(
            problem(
              404,
              "Not found",
              "This authentication endpoint is disabled.",
            ),
          );
      if (
        request.method === "POST" &&
        request.headers.origin !== new URL(config.APP_URL).origin
      ) {
        return reply
          .code(403)
          .type("application/problem+json")
          .send(problem(403, "Forbidden", "Request origin is not allowed."));
      }
      // A person whose sign-in was stopped gets the same answer as a wrong password (ADR 0048).
      if (
        path === "/api/v1/auth/sign-in/email" &&
        (await isSignInStopped(db, request.body))
      )
        return reply
          .code(401)
          .type("application/problem+json")
          .send(
            problem(
              401,
              "Authentication failed",
              "Check your credentials and try again.",
            ),
          );
      const response = await auth.handler(
        new Request(new URL(request.url, config.APP_URL), {
          method: request.method,
          headers: fromNodeHeaders(request.headers),
          ...(request.body
            ? {
                // No trusted-device cookie (ADR 0038): the verify routes never get to set one.
                body: JSON.stringify(
                  path.startsWith("/api/v1/auth/two-factor/verify-")
                    ? { ...(request.body as object), trustDevice: false }
                    : request.body,
                ),
              }
            : {}),
        }),
      );
      reply.code(response.status);
      // The bearer plugin adds the session token to the response whenever it sets the session cookie; only the
      // Android app may see it (ADR 0042), so a browser's JavaScript never gets the token behind its cookie.
      const sendToken = mayReceiveDeviceToken(
        request.headers,
        request.method,
        path,
      );
      for (const [key, value] of response.headers) {
        if (key === "set-cookie") continue;
        if (
          !sendToken &&
          (key === "set-auth-token" || key === "access-control-expose-headers")
        )
          continue;
        reply.header(key, value);
      }
      const cookies = response.headers.getSetCookie();
      if (cookies.length) reply.header("set-cookie", cookies);
      if (response.status >= 400)
        return reply
          .type("application/problem+json")
          .send(
            problem(
              response.status,
              "Authentication failed",
              response.status === 429
                ? "Too many attempts. Wait a few minutes and try again."
                : "Check your credentials and try again.",
            ),
          );
      return reply.send(await response.text());
    },
  });
}

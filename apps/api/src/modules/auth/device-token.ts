import type { IncomingHttpHeaders } from "node:http";

/** The header the Android app sends so the server knows it is the app and not a browser (ADR 0042). */
export const deviceClientHeader = "x-ledgerline-client";

/** The sign-in and two-factor verify routes: the only ones that may hand a new token to the app. */
const credentialPaths = [
  "/api/v1/auth/sign-in/email",
  "/api/v1/auth/two-factor/verify-totp",
  "/api/v1/auth/two-factor/verify-backup-code",
];

const hasBearer = (headers: IncomingHttpHeaders) =>
  /^bearer\s+\S/i.test(String(headers.authorization ?? ""));

/**
 * Whether a response may carry the session token in `set-auth-token`. The bearer plugin adds that header
 * whenever a session cookie is set, which would give page JavaScript the token behind the httpOnly cookie.
 * So it is passed on only to the app (marked with its client header) and only when that request is a
 * sign-in or code check, or already carries a bearer token; every other client has the header removed.
 */
export function mayReceiveDeviceToken(
  headers: IncomingHttpHeaders,
  method: string,
  path: string,
) {
  if (String(headers[deviceClientHeader] ?? "").toLowerCase() !== "android")
    return false;
  return (
    hasBearer(headers) || (method === "POST" && credentialPaths.includes(path))
  );
}

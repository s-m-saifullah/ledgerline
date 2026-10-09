import { newId } from "@ledgerline/shared";
import { betterAuth } from "better-auth";
import type { Config } from "../../config";
import type { Database } from "../../db/client";
import { authAdapter } from "./adapter";
import { hashPassword, verifyPassword } from "./password";

export function createAuth(db: Database, config: Config) {
  return betterAuth({
    appName: "Ledgerline",
    baseURL: config.APP_URL,
    basePath: "/api/v1/auth",
    secret: config.BETTER_AUTH_SECRET,
    trustedOrigins: [config.APP_URL],
    database: authAdapter(db),
    user: {
      additionalFields: {
        deletedAt: { type: "date", required: false, input: false },
        locale: { type: "string", defaultValue: "en-US", input: false },
        baseCurrency: { type: "string", defaultValue: "USD", input: false },
      },
    },
    session: {
      additionalFields: {
        deletedAt: { type: "date", required: false, input: false },
      },
    },
    account: {
      additionalFields: {
        deletedAt: { type: "date", required: false, input: false },
      },
    },
    verification: {
      additionalFields: {
        deletedAt: { type: "date", required: false, input: false },
      },
    },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      password: { hash: hashPassword, verify: verifyPassword },
    },
    advanced: {
      database: { generateId: () => newId() },
      useSecureCookies: config.NODE_ENV === "production",
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax" },
    },
    // Every page load asks for the session, so a fast browser-test run would trip the
    // production limit and look signed out. Production keeps the strict limit.
    rateLimit: {
      enabled: true,
      window: 60,
      max: config.NODE_ENV === "production" ? 30 : 1000,
    },
    logger: { disabled: true },
  });
}
export type Auth = ReturnType<typeof createAuth>;

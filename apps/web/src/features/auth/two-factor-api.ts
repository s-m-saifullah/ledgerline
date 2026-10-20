import { ApiError, api } from "../../lib/api";

export type TwoFactorSetup = { totpURI: string; backupCodes: string[] };

const post = <T>(path: string, body: Record<string, string>) =>
  api<T>(`/auth/two-factor/${path}`, {
    method: "POST",
    body: JSON.stringify(body),
  });

/** Starts setup: needs the password, returns the setup link and the backup codes; nothing is on yet. */
export const startTwoFactor = (password: string) =>
  post<TwoFactorSetup>("enable", { password });
/** One current code: finishes setup, or completes a sign-in that is waiting for a code. */
export const verifyCode = (code: string) =>
  post<unknown>("verify-totp", { code });
export const verifyBackupCode = (code: string) =>
  post<unknown>("verify-backup-code", { code });
export const makeBackupCodes = (password: string) =>
  post<{ backupCodes: string[] }>("generate-backup-codes", { password });
export const turnOffTwoFactor = (password: string) =>
  post<unknown>("disable", { password });

/** The base32 key inside a setup link, for typing into an authenticator by hand. */
export const secretFromUri = (totpURI: string) => {
  try {
    return new URL(totpURI).searchParams.get("secret") ?? "";
  } catch {
    return "";
  }
};

/** Plain wording for a failed step; the server only says "no" and how often to wait. */
export function twoFactorMessage(
  failure: unknown,
  what: "code" | "backup" | "password",
) {
  if (failure instanceof ApiError && failure.status === 429)
    return "Too many attempts. Wait a few minutes and try again.";
  if (failure instanceof ApiError && failure.status < 500) {
    if (what === "password") return "That password didn't match.";
    if (what === "backup")
      return "That backup code didn't work. Each one can be used only once.";
    return "That code didn't work. Check the clock on your phone and try again.";
  }
  return "We couldn't do that. Please try again.";
}

import {
  type JsonValue,
  ledgerSchema,
  passwordChangeRequiredType,
  problemSchema,
} from "@ledgerline/shared";
import { z } from "zod";
import { randomUuid } from "./random-uuid";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly fields: { field: string; message: string }[] = [],
    /** The problem's `type`, when the answer was a problem (ADR 0048 uses it to tell a required password change from any other 403). */
    readonly type?: string | undefined,
  ) {
    super(message);
  }
}

/** A 403 that says only a new password is missing: the person must see the first-sign-in card, whatever page asked (ADR 0048). */
export const isPasswordChangeRequired = (error: unknown) =>
  error instanceof ApiError &&
  error.status === 403 &&
  error.type === passwordChangeRequiredType;

let passwordChangeListener: (() => void) | null = null;
/** The one listener of the required-password-change refusal (the gate around the signed-in app). Returns how to stop listening. */
export function onPasswordChangeRequired(listener: () => void) {
  passwordChangeListener = listener;
  return () => {
    if (passwordChangeListener === listener) passwordChangeListener = null;
  };
}

/** The error a failed response stands for: the API's own message when it sent one. */
export async function apiError(response: Response) {
  const result = problemSchema.safeParse(
    await response.json().catch(() => null),
  );
  const message =
    response.status === 429
      ? "Too many attempts. Please wait a minute."
      : result.success
        ? result.data.detail
        : response.status === 401
          ? "Please sign in to continue."
          : "We couldn't complete that request. Please try again.";
  const error = new ApiError(
    response.status,
    message,
    result.success ? result.data.errors : [],
    result.success ? result.data.type : undefined,
  );
  if (isPasswordChangeRequired(error)) passwordChangeListener?.();
  return error;
}

export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type"))
    headers.set("Content-Type", "application/json");
  if (
    options.method &&
    options.method !== "GET" &&
    !headers.has("Idempotency-Key")
  )
    headers.set("Idempotency-Key", randomUuid());
  const response = await fetch(`/api/v1${path}`, {
    credentials: "same-origin",
    ...options,
    headers,
  });
  if (!response.ok) throw await apiError(response);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

/** Prepare once per user action, then reuse the returned function for retries. */
export function prepareFinancialWrite<T>(
  path: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  body?: JsonValue,
): () => Promise<T> {
  const options: RequestInit = {
    method,
    headers: { "Idempotency-Key": randomUuid() },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
  return () => api<T>(path, options);
}
export type Session = {
  user: {
    id: string;
    name: string;
    email: string;
    twoFactorEnabled?: boolean;
  };
};
export const getSession = () => api<Session | null>("/auth/get-session");
export const getLedgers = async () =>
  z.object({ items: z.array(ledgerSchema) }).parse(await api("/ledgers"));

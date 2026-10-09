import {
  type JsonValue,
  ledgerSchema,
  problemSchema,
} from "@ledgerline/shared";
import { z } from "zod";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly fields: { field: string; message: string }[] = [],
  ) {
    super(message);
  }
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
    headers.set("Idempotency-Key", crypto.randomUUID());
  const response = await fetch(`/api/v1${path}`, {
    credentials: "same-origin",
    ...options,
    headers,
  });
  if (!response.ok) {
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
    throw new ApiError(
      response.status,
      message,
      result.success ? result.data.errors : [],
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

/** Prepare once per user action, then reuse the returned function for retries. */
export function prepareFinancialWrite<T>(
  path: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: JsonValue,
): () => Promise<T> {
  const options: RequestInit = {
    method,
    headers: { "Idempotency-Key": crypto.randomUUID() },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
  return () => api<T>(path, options);
}
export type Session = { user: { id: string; name: string; email: string } };
export const getSession = () => api<Session | null>("/auth/get-session");
export const getLedgers = async () =>
  z.object({ items: z.array(ledgerSchema) }).parse(await api("/ledgers"));

import { afterEach, expect, it, vi } from "vitest";
import {
  ApiError,
  api,
  isPasswordChangeRequired,
  onPasswordChangeRequired,
  prepareFinancialWrite,
} from "./api";

afterEach(() => vi.unstubAllGlobals());

it("retains the same key and payload after a failed attempt, but separates new actions", async () => {
  const fetchMock = vi
    .fn()
    .mockRejectedValueOnce(new TypeError("Connection lost"))
    .mockImplementation(
      async () => new Response('{"ok":true}', { status: 201 }),
    );
  vi.stubGlobal("fetch", fetchMock);
  const body = { money: { amount: 29, currency: "USD" } };
  const write = prepareFinancialWrite("/test", "POST", body);
  body.money.amount = 99;
  await expect(write()).rejects.toThrow("Connection lost");
  await write();
  await prepareFinancialWrite("/test", "POST", body)();
  const requests = fetchMock.mock.calls.map((call) => call[1] as RequestInit);
  expect(new Headers(requests[0]?.headers).get("Idempotency-Key")).toBe(
    new Headers(requests[1]?.headers).get("Idempotency-Key"),
  );
  expect(new Headers(requests[1]?.headers).get("Idempotency-Key")).not.toBe(
    new Headers(requests[2]?.headers).get("Idempotency-Key"),
  );
  expect(requests[0]?.body).toBe(requests[1]?.body);
  expect(requests[1]?.body).toContain('"amount":29');
});

it("returns field-level conflict details without losing caller headers", async () => {
  const fetchMock = vi.fn<typeof fetch>(
    async () =>
      new Response(
        JSON.stringify({
          type: "about:blank",
          title: "Conflict",
          status: 409,
          detail: "This record changed.",
          errors: [
            { field: "expectedVersion", message: "Reload this record." },
          ],
        }),
        { status: 409 },
      ),
  );
  vi.stubGlobal("fetch", fetchMock);
  await expect(
    api("/test", {
      method: "PATCH",
      headers: new Headers({ "Idempotency-Key": "fixed-action-key" }),
    }),
  ).rejects.toMatchObject({
    status: 409,
    message: "This record changed.",
    fields: [{ field: "expectedVersion", message: "Reload this record." }],
  });
  expect(
    new Headers((fetchMock.mock.calls[0]?.[1] as RequestInit)?.headers).get(
      "Idempotency-Key",
    ),
  ).toBe("fixed-action-key");
});

it("handles no-content responses and non-JSON server failures", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response("proxy error", { status: 502 })),
  );
  await expect(
    api<void>("/test", { method: "DELETE" }),
  ).resolves.toBeUndefined();
  await expect(api("/test")).rejects.toBeInstanceOf(ApiError);
});

it("keeps the problem type on the error so a page can tell a required password change from any other 403", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            type: "urn:ledgerline:problem:password-change-required",
            title: "Forbidden",
            status: 403,
            detail: "Choose a new password first.",
          }),
          { status: 403 },
        ),
    ),
  );
  const error = (await api("/accounts").catch((caught) => caught)) as ApiError;
  expect(error).toBeInstanceOf(ApiError);
  expect(error.status).toBe(403);
  expect(error.type).toBe("urn:ledgerline:problem:password-change-required");
});

it("has no problem type when the answer was not a problem", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async () => new Response("nope", { status: 502 })),
  );
  const error = (await api("/accounts").catch((caught) => caught)) as ApiError;
  expect(error.type).toBeUndefined();
});

const required = "urn:ledgerline:problem:password-change-required";
it("isPasswordChangeRequired is true only for a 403 of the password-change-required type", () => {
  expect(isPasswordChangeRequired(new ApiError(403, "x", [], required))).toBe(
    true,
  );
  expect(
    isPasswordChangeRequired(new ApiError(403, "x", [], "about:blank")),
  ).toBe(false);
  expect(isPasswordChangeRequired(new ApiError(403, "x"))).toBe(false);
  expect(isPasswordChangeRequired(new ApiError(401, "x", [], required))).toBe(
    false,
  );
  expect(isPasswordChangeRequired(new Error("x"))).toBe(false);
  expect(isPasswordChangeRequired(null)).toBe(false);
});

const refuse = (type: string, status = 403) =>
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({ type, title: "Forbidden", status, detail: "No." }),
          { status },
        ),
    ),
  );

it("tells the listener, once per refused request, when a request is refused for a required password change", async () => {
  const heard = vi.fn();
  const stop = onPasswordChangeRequired(heard);
  refuse(required);
  await api("/accounts").catch(() => undefined);
  expect(heard).toHaveBeenCalledTimes(1);
  stop();
  await api("/accounts").catch(() => undefined);
  expect(heard).toHaveBeenCalledTimes(1);
});

it("does not tell the listener about any other refusal", async () => {
  const heard = vi.fn();
  const stop = onPasswordChangeRequired(heard);
  refuse("about:blank");
  await api("/users").catch(() => undefined);
  refuse(required, 401);
  await api("/users").catch(() => undefined);
  stop();
  expect(heard).not.toHaveBeenCalled();
});

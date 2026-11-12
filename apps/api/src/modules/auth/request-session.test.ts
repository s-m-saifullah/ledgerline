import type { FastifyRequest } from "fastify";
import { describe, expect, it, vi } from "vitest";
import { requestSession } from "./request-session";
import type { Auth } from "./service";

// One request looks its session up once, however many parts of it ask (the guard, the route's own check).
const request = (cookie = "a=1") =>
  ({ headers: { cookie } }) as unknown as FastifyRequest;
const authWith = (getSession: ReturnType<typeof vi.fn>) =>
  ({ api: { getSession } }) as unknown as Auth;

describe("the session of a request", () => {
  it("is looked up once per request and shared by everyone who asks", async () => {
    const getSession = vi.fn(async () => ({ user: { id: "u1" } }));
    const auth = authWith(getSession);
    const one = request();

    const [a, b] = await Promise.all([
      requestSession(auth, one),
      requestSession(auth, one),
    ]);
    const c = await requestSession(auth, one);

    expect(getSession).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(c).toBe(a);
  });

  it("is looked up again for another request, even with the same cookie", async () => {
    const getSession = vi.fn(async () => ({ user: { id: "u1" } }));
    const auth = authWith(getSession);

    await requestSession(auth, request("same=1"));
    await requestSession(auth, request("same=1"));

    expect(getSession).toHaveBeenCalledTimes(2);
  });

  it("remembers that there is no session, without asking again", async () => {
    const getSession = vi.fn(async () => null);
    const auth = authWith(getSession);
    const one = request();

    expect(await requestSession(auth, one)).toBeNull();
    expect(await requestSession(auth, one)).toBeNull();

    expect(getSession).toHaveBeenCalledTimes(1);
  });

  it("does not remember a failed lookup: the next ask tries again", async () => {
    const getSession = vi
      .fn()
      .mockRejectedValueOnce(new Error("database restarting"))
      .mockResolvedValueOnce({ user: { id: "u1" } });
    const auth = authWith(getSession);
    const one = request();

    await expect(requestSession(auth, one)).rejects.toThrow(
      "database restarting",
    );
    expect(await requestSession(auth, one)).toEqual({ user: { id: "u1" } });
    expect(getSession).toHaveBeenCalledTimes(2);
  });
});

import { describe, expect, it, vi } from "vitest";
import { createRateProvider } from "./provider";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
const primary = (rate: number, date = "2026-10-09") => [
  { date, base: "EUR", quote: "USD", rate },
];

describe("rate provider", () => {
  it("reads the primary source and asks only for codes and a date", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => json(primary(1.1217)));
    const found = await createRateProvider(fetcher)("EUR", "USD", "2026-10-09");
    expect(found).toEqual({ date: "2026-10-09", rate: "1.1217" });
    const url = new URL(String(fetcher.mock.calls[0]?.[0]));
    expect(url.host).toBe("api.frankfurter.dev");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      base: "EUR",
      quotes: "USD",
      date: "2026-10-09",
    });
    expect(fetcher.mock.calls[0]?.[1]?.redirect).toBe("error");
  });

  it("falls back when the primary fails, errors, or answers nonsense", async () => {
    const fallback = { date: "2026-10-10", eur: { usd: 1.1201766 } };
    for (const first of [
      () => json({}, 500),
      () => {
        throw new Error("network down");
      },
      () => json([{ date: "2026-10-09", base: "EUR", quote: "USD", rate: 0 }]),
      () => json("not rates"),
      () =>
        json([{ date: "2026-10-09", base: "GBP", quote: "USD", rate: 1.3 }]),
    ]) {
      const calls: string[] = [];
      const fetcher = vi.fn<typeof fetch>(async (url) => {
        calls.push(String(url));
        return calls.length === 1 ? first() : json(fallback);
      });
      const found = await createRateProvider(fetcher)("EUR", "USD");
      expect(found).toEqual({ date: "2026-10-10", rate: "1.1201766" });
      expect(calls[1]).toContain("cdn.jsdelivr.net");
      expect(calls[1]).toContain("/currencies/eur.json");
    }
  });

  it("returns null, without throwing, when every source fails", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => json({}, 503));
    expect(await createRateProvider(fetcher)("EUR", "USD")).toBeNull();
    const broken = vi.fn<typeof fetch>(async () => {
      throw new Error("offline");
    });
    expect(await createRateProvider(broken)("EUR", "USD")).toBeNull();
  });

  it("pins the fallback to the requested date", async () => {
    const calls: string[] = [];
    const fetcher = vi.fn<typeof fetch>(async (url) => {
      calls.push(String(url));
      return calls.length === 1
        ? json({}, 500)
        : json({ date: "2026-10-01", eur: { usd: 1.1 } });
    });
    await createRateProvider(fetcher)("EUR", "USD", "2026-10-01");
    expect(calls[1]).toContain("currency-api@2026-10-01");
  });
});

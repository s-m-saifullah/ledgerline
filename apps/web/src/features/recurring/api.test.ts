import { newId, type RecurringRule } from "@ledgerline/shared";
import { afterEach, expect, it, vi } from "vitest";
import { prepareRuleSave } from "./api";

const stamp = "2026-10-10T00:00:00.000Z";
const ledgerId = newId();
const rule: RecurringRule = {
  id: newId(),
  ledgerId,
  title: "Rent",
  kind: "expense",
  accountId: newId(),
  toAccountId: null,
  categoryId: newId(),
  amount: { amount: -120000, currency: "USD" },
  receivedAmount: null,
  bonus: null,
  fee: null,
  payee: null,
  note: null,
  tagIds: [],
  frequency: "month",
  interval: 1,
  startDate: "2026-11-01",
  endDate: null,
  nextDate: "2026-11-01",
  paused: false,
  pausedReason: null,
  needsAttention: 0,
  version: 4,
  createdAt: stamp,
  updatedAt: stamp,
};
const body = {
  title: "Rent 2",
  kind: rule.kind,
  accountId: rule.accountId,
  toAccountId: null,
  categoryId: rule.categoryId,
  amount: rule.amount,
  receivedAmount: null,
  bonus: null,
  fee: null,
  payee: null,
  note: null,
  tagIds: [],
  frequency: rule.frequency,
  interval: 1,
  startDate: rule.startDate,
  endDate: null,
} as Parameters<typeof prepareRuleSave>[2];
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
const key = (init?: RequestInit) =>
  new Headers(init?.headers).get("Idempotency-Key");
afterEach(() => vi.unstubAllGlobals());

it("only updates when the switch did not move", async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValue(json({ ...rule, version: 5 }));
  vi.stubGlobal("fetch", fetchMock);
  const saved = await prepareRuleSave(ledgerId, rule, body, null)();
  expect(saved.version).toBe(5);
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("PATCH");
});
it("only pauses or resumes when no field changed, on the rule's own version", async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValue(json({ ...rule, paused: true, version: 5 }));
  vi.stubGlobal("fetch", fetchMock);
  await prepareRuleSave(ledgerId, rule, null, "pause")();
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/pause");
  expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
    expectedVersion: 4,
  });
});
it("updates, then pauses on the version the update returned", async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(json({ ...rule, title: "Rent 2", version: 5 }))
    .mockResolvedValueOnce(json({ ...rule, paused: true, version: 6 }));
  vi.stubGlobal("fetch", fetchMock);
  const saved = await prepareRuleSave(ledgerId, rule, body, "pause")();
  expect(saved.paused).toBe(true);
  expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("PATCH");
  expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/pause");
  expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
    expectedVersion: 5,
  });
});
it("repeats the same requests with the same keys when an answer was lost", async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    // First try: the update answers, the pause's answer is lost.
    .mockResolvedValueOnce(json({ ...rule, title: "Rent 2", version: 5 }))
    .mockRejectedValueOnce(new TypeError("Connection lost"))
    // The retry: the update is replayed, then the pause goes through.
    .mockResolvedValueOnce(json({ ...rule, title: "Rent 2", version: 5 }))
    .mockResolvedValueOnce(json({ ...rule, paused: true, version: 6 }));
  vi.stubGlobal("fetch", fetchMock);
  const attempt = prepareRuleSave(ledgerId, rule, body, "pause");
  await expect(attempt()).rejects.toThrow();
  const saved = await attempt();
  expect(saved.paused).toBe(true);
  const calls = fetchMock.mock.calls;
  expect(key(calls[2]?.[1])).toBe(key(calls[0]?.[1]));
  expect(key(calls[3]?.[1])).toBe(key(calls[1]?.[1]));
  expect(key(calls[0]?.[1])).not.toBe(key(calls[1]?.[1]));
  expect(calls[3]?.[1]?.body).toBe(calls[1]?.[1]?.body);
});

import { idempotencyKeySchema } from "@ledgerline/shared";
import { afterEach, expect, it, vi } from "vitest";
import { randomUuid } from "./random-uuid";

const v4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => vi.unstubAllGlobals());

it("uses the native generator when the browser provides it", () => {
  const native = vi.fn(() => "11111111-1111-4111-8111-111111111111");
  vi.stubGlobal("crypto", { randomUUID: native, getRandomValues: vi.fn() });
  expect(randomUuid()).toBe("11111111-1111-4111-8111-111111111111");
  expect(native).toHaveBeenCalledOnce();
});

it("falls back to getRandomValues over plain HTTP, where randomUUID is missing", () => {
  const getRandomValues = vi.fn(<T extends ArrayBufferView>(array: T) => {
    const bytes = new Uint8Array(array.buffer);
    bytes.fill(0xff);
    return array;
  });
  vi.stubGlobal("crypto", { getRandomValues });
  expect(randomUuid()).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff");
  expect(getRandomValues).toHaveBeenCalledOnce();
});

it("makes unique, well-formed keys the API accepts without randomUUID", () => {
  vi.stubGlobal("crypto", {
    getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto),
  });
  const keys = Array.from({ length: 500 }, () => randomUuid());
  expect(new Set(keys).size).toBe(500);
  for (const key of keys) {
    expect(key).toMatch(v4);
    expect(idempotencyKeySchema.safeParse(key).success).toBe(true);
  }
});

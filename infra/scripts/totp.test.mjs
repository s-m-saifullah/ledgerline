import assert from "node:assert/strict";
import test from "node:test";
import { totpCode } from "./totp.mjs";

// RFC 6238 appendix B (SHA-1, key "12345678901234567890"), last six of the published eight digits.
const key = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const vectors = [
  [59, "287082"],
  [1111111109, "081804"],
  [1111111111, "050471"],
  [1234567890, "005924"],
  [2000000000, "279037"],
];
for (const [seconds, expected] of vectors)
  test(`matches the RFC 6238 value at ${seconds} s`, () => {
    assert.equal(totpCode(key, seconds * 1000), expected);
  });

test("ignores spaces, dashes and case in the key and keeps leading zeros", () => {
  assert.equal(
    totpCode("gezd gnbv-gy3t qojq gezd gnbv gy3t qojq", 1234567890 * 1000),
    "005924",
  );
});

test("refuses a key that is not base32", () => {
  assert.throws(() => totpCode("not-a-key-1!"), /not valid base32/);
});

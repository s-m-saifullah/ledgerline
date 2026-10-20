import { createHmac } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(text) {
  let bits = "";
  for (const char of text.toUpperCase().replace(/[\s=-]+/g, "")) {
    const value = ALPHABET.indexOf(char);
    if (value < 0) throw new Error("The authenticator key is not valid base32");
    bits += value.toString(2).padStart(5, "0");
  }
  return Buffer.from(
    (bits.match(/.{8}/g) ?? []).map((byte) => Number.parseInt(byte, 2)),
  );
}

/** A 6-digit authenticator code (RFC 6238: SHA-1, 30-second steps) for a base32 key, used by the smoke check. */
export function totpCode(secret, now = Date.now()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30000)));
  const digest = createHmac("sha1", base32Decode(secret))
    .update(counter)
    .digest();
  const at = digest[digest.length - 1] & 0x0f;
  const value =
    ((digest[at] & 0x7f) << 24) |
    ((digest[at + 1] & 0xff) << 16) |
    ((digest[at + 2] & 0xff) << 8) |
    (digest[at + 3] & 0xff);
  return String(value % 1_000_000).padStart(6, "0");
}

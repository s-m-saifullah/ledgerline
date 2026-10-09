/**
 * A random version 4 UUID for retry labels (Idempotency-Key) and dialog intents.
 *
 * `crypto.randomUUID()` only exists in secure contexts (HTTPS or localhost), so opening the dev
 * server from another device over plain HTTP would break every write. `crypto.getRandomValues()`
 * is available everywhere and is the same cryptographic source, so it is the fallback.
 * Never use `Math.random()` here.
 */
export function randomUuid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10).join(""),
  ].join("-");
}

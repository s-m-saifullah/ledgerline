/** A readable device name from a User-Agent header, for the signed-in devices list (ADR 0042). */
export function deviceName(userAgent: string | null | undefined) {
  const text = (userAgent ?? "").slice(0, 400);
  // The Android app names itself: "Ledgerline-Android/1.0 (Pixel 8)".
  const app = /Ledgerline-Android\/[\w.-]+(?:\s*\(([^)]{1,60})\))?/i.exec(text);
  if (app)
    return app[1]
      ? `Ledgerline Android app (${app[1].trim()})`
      : "Ledgerline Android app";
  const system = /iPhone/.test(text)
    ? "iOS"
    : /iPad/.test(text)
      ? "iPadOS"
      : /Android/.test(text)
        ? "Android"
        : /Windows/.test(text)
          ? "Windows"
          : /Mac OS X|Macintosh/.test(text)
            ? "macOS"
            : /CrOS/.test(text)
              ? "ChromeOS"
              : /Linux/.test(text)
                ? "Linux"
                : null;
  const browser = /Edg(?:e|A|iOS)?\//.test(text)
    ? "Edge"
    : /OPR\/|Opera/.test(text)
      ? "Opera"
      : /Firefox\/|FxiOS\//.test(text)
        ? "Firefox"
        : /Chrome\/|CriOS\//.test(text)
          ? "Chrome"
          : /Safari\//.test(text)
            ? "Safari"
            : null;
  if (browser && system) return `${browser} on ${system}`;
  if (browser) return browser;
  if (system) return system;
  return "Unknown device";
}

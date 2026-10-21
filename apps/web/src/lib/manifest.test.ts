import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const publicDir = resolve(__dirname, "../../public");
const manifest = JSON.parse(
  readFileSync(resolve(publicDir, "manifest.webmanifest"), "utf8"),
) as {
  name: string;
  start_url: string;
  scope: string;
  display: string;
  icons: { src: string; sizes: string; type: string; purpose?: string }[];
};

/** Width and height from a PNG's header. */
function pngSize(file: string) {
  const bytes = readFileSync(file);
  return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
}

describe("web app manifest (ADR 0041)", () => {
  it("opens as a standalone app at the root", () => {
    expect(manifest.name).toBe("Ledgerline");
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
  });

  it("lists icons that exist at the sizes they claim, including a maskable one", () => {
    expect(manifest.icons.length).toBeGreaterThanOrEqual(3);
    for (const icon of manifest.icons) {
      const file = resolve(publicDir, icon.src.replace(/^\//, ""));
      expect(existsSync(file), icon.src).toBe(true);
      expect(pngSize(file), icon.src).toBe(icon.sizes);
    }
    expect(manifest.icons.some((icon) => icon.purpose === "maskable")).toBe(
      true,
    );
    expect(manifest.icons.some((icon) => icon.sizes === "192x192")).toBe(true);
  });

  it("is linked from the page", () => {
    const html = readFileSync(resolve(publicDir, "../index.html"), "utf8");
    expect(html).toContain('rel="manifest" href="/manifest.webmanifest"');
  });
});

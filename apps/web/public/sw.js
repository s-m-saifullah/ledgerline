// Ledgerline service worker (ADR 0041). Keeps the app shell and its hashed files so the installed app opens
// without a network, and nothing else: it never handles anything under /api, any request that is not a
// same-origin GET, or the worker file itself, so no financial data is ever stored by the browser cache.
// The build replaces the placeholder with the release version, so every release has its own cache.
const VERSION = "__APP_VERSION__";
const CACHE = `ledgerline-${VERSION}`;
const SHELL = "/";

/** True for requests this worker may answer: same-origin GETs outside /api and not the worker itself. */
function isHandled(request, origin) {
  if (request.method !== "GET") return false;
  const url = new URL(request.url);
  if (url.origin !== origin) return false;
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return false;
  return url.pathname !== "/sw.js";
}

/** The hashed files the shell page loads, read from its HTML. */
function assetUrls(html) {
  const found = new Set();
  for (const match of html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g))
    found.add(match[1]);
  return [...found];
}

/**
 * True when a unicode-range covers the letter "a": no range at all, or a range whose interval holds it. A minifier may
 * write U+0000-00FF as U+?? (a "?" stands for any digit), so the digits are read, not the text.
 */
function coversLatin(range) {
  if (range === undefined) return true;
  return range.split(",").some((part) => {
    const token = part.trim().replace(/^u\+/i, "");
    const [from, to = from] = token.split("-");
    const low = Number.parseInt(from.replaceAll("?", "0"), 16);
    const high = Number.parseInt(to.replaceAll("?", "F"), 16);
    return low <= 0x61 && 0x61 <= high;
  });
}

/**
 * The font files a style sheet loads that are worth keeping: the woff2 file of each face that covers basic Latin text.
 * The other scripts and the Latin extended face are fetched by a browser only when a glyph needs them, so keeping them
 * would be a release's worth of downloads nobody reads; offline, such a glyph falls back to the system font. The old woff
 * files are never asked for by a browser that has woff2.
 */
function fontUrls(css) {
  const found = [];
  for (const face of css.matchAll(/@font-face\s*\{[^}]*\}/g)) {
    const range = /unicode-range:\s*([^;}]*)/.exec(face[0]);
    if (!coversLatin(range ? range[1] : undefined)) continue;
    for (const url of face[0].matchAll(
      /url\(\s*["']?(\/assets\/[^"')\s]+\.woff2)["']?\s*\)/g,
    ))
      found.push(url[1]);
  }
  return found;
}

function isHtml(response) {
  return (response.headers.get("content-type") || "").includes("text/html");
}

async function precache() {
  const cache = await caches.open(CACHE);
  const response = await fetch(SHELL, { cache: "reload" });
  if (!response.ok || !isHtml(response)) return;
  const html = await response.clone().text();
  await cache.put(SHELL, response);
  const keep = async (url) => {
    try {
      const asset = await fetch(url, { cache: "reload" });
      if (!asset.ok) return [];
      const copy = asset.clone();
      await cache.put(url, asset);
      // Style sheets name their font files; keep those too so text looks right offline.
      return url.endsWith(".css") ? fontUrls(await copy.text()) : [];
    } catch {
      return [];
    }
  };
  const fonts = (await Promise.all(assetUrls(html).map(keep))).flat();
  await Promise.all(fonts.map(keep));
}

async function pageLoad(request) {
  try {
    const response = await fetch(request);
    if (response.ok && isHtml(response)) {
      const cache = await caches.open(CACHE);
      await cache.put(SHELL, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(SHELL);
    if (cached) return cached;
    throw error;
  }
}

async function hashedAsset(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && response.type === "basic") {
    const cache = await caches.open(CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    precache()
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith("ledgerline-") && name !== CACHE)
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (!isHandled(request, self.location.origin)) return;
  if (request.mode === "navigate") {
    event.respondWith(pageLoad(request));
  } else if (new URL(request.url).pathname.startsWith("/assets/")) {
    event.respondWith(hashedAsset(request));
  }
});

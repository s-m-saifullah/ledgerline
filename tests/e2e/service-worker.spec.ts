import { execFileSync } from "node:child_process";
import {
  createReadStream,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { expect, test } from "@playwright/test";

// ADR 0041: the installed app opens offline, never caches /api, and a new release replaces the old shell.
// Builds the web app twice (two release versions) and serves them from a tiny local server that
// stands in for the web container; no database or API is involved.
test.use({ storageState: { cookies: [], origins: [] } });

const types: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ico": "image/x-icon",
};
const work = mkdtempSync(join(tmpdir(), "ledgerline-sw-"));
const builds = { v1: join(work, "v1"), v2: join(work, "v2") };
let root = builds.v1;
let apiCalls = 0;
let server: Server;
let origin = "";

test.beforeAll(async () => {
  test.setTimeout(180000);
  for (const [version, outDir] of Object.entries(builds))
    execFileSync(
      "pnpm",
      [
        "--filter",
        "@ledgerline/web",
        "exec",
        "vite",
        "build",
        "--outDir",
        outDir,
        "--emptyOutDir",
      ],
      {
        env: { ...process.env, NODE_ENV: "production", APP_VERSION: version },
        stdio: "ignore",
      },
    );
  server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://local").pathname;
    if (path.startsWith("/api/")) {
      apiCalls += 1;
      response.writeHead(200, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    let file = join(root, normalize(path));
    const asset = existsSync(file) && statSync(file).isFile();
    if (!asset && path === "/sw.js") {
      response.writeHead(404).end();
      return;
    }
    if (!asset) file = join(root, "index.html");
    const headers: Record<string, string> = {
      "content-type": types[extname(file)] ?? "application/octet-stream",
    };
    if (file.endsWith("index.html") || path === "/sw.js")
      headers["cache-control"] = "no-store";
    response.writeHead(200, headers);
    createReadStream(file).pipe(response);
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  origin = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

test.afterAll(async () => {
  await new Promise((done) => server?.close(done));
  rmSync(work, { recursive: true, force: true });
});

const mainScript = (version: "v1" | "v2") =>
  /src="(\/assets\/index-[^"]+\.js)"/.exec(
    readFileSync(join(builds[version], "index.html"), "utf8"),
  )?.[1];

test("the worker keeps the shell for offline use, never caches /api, and a new release replaces it", async ({
  page,
  context,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop");
  test.setTimeout(120000);

  root = builds.v1;
  await page.goto(`${origin}/`);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
  const cacheNames = () => page.evaluate(() => caches.keys());
  await expect.poll(cacheNames).toEqual(["ledgerline-v1"]);

  // An /api request goes to the network, and nothing under /api is ever stored.
  const before = apiCalls;
  expect(
    await page.evaluate(async () => (await fetch("/api/v1/ping")).status),
  ).toBe(200);
  expect(
    await page.evaluate(async () => (await fetch("/api/v1/ping")).status),
  ).toBe(200);
  expect(apiCalls - before).toBe(2);
  const stored = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys())
      for (const request of await (await caches.open(name)).keys())
        urls.push(new URL(request.url).pathname);
    return urls;
  });
  expect(stored.length).toBeGreaterThan(1);
  expect(stored.filter((url) => url.startsWith("/api"))).toEqual([]);

  // Offline: the shell still opens, and an /api request fails instead of being answered from a cache.
  await context.setOffline(true);
  await page.reload();
  await expect(page).toHaveTitle(/Ledgerline/);
  expect(
    await page.evaluate(
      () => document.getElementById("root")?.childElementCount ?? 0,
    ),
  ).toBeGreaterThan(0);
  expect(
    await page.evaluate(() =>
      fetch("/api/v1/ping").then(
        () => "answered",
        () => "failed",
      ),
    ),
  ).toBe("failed");
  await context.setOffline(false);

  // A new release replaces the old shell and its cache on the next load.
  root = builds.v2;
  await page.reload();
  await expect.poll(cacheNames, { timeout: 30000 }).toEqual(["ledgerline-v2"]);
  await page.reload();
  const script = await page.evaluate(() =>
    document
      .querySelector<HTMLScriptElement>("script[type=module]")
      ?.getAttribute("src"),
  );
  expect(script).toBe(mainScript("v2"));
  expect(script).not.toBe(mainScript("v1"));
});

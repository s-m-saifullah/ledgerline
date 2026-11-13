import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";

// Runs the real web image's Caddy with the real Caddyfile in front of a small static folder, and asks it for
// things over HTTP. Skipped when Docker is not available (the CI runner has it).
const docker = (args, options = {}) =>
  spawnSync("docker", args, { encoding: "utf8", ...options });
const available = docker(["info"]).status === 0;
const dockerfile = readFileSync(
  new URL("../../infra/docker/web.Dockerfile", import.meta.url),
  "utf8",
);
const image = dockerfile.match(/^FROM (caddy:\S+) AS runtime$/m)?.[1];
const caddyfile = new URL("../docker/Caddyfile", import.meta.url).pathname;

describe("the web container's Caddyfile", { skip: !available }, () => {
  let id = "";
  let base = "";
  const get = (path) => fetch(`${base}${path}`, { redirect: "manual" });

  before(async () => {
    assert.ok(image, "no Caddy image in web.Dockerfile");
    const srv = mkdtempSync(join(tmpdir(), "caddy-srv-"));
    mkdirSync(join(srv, "assets"));
    writeFileSync(join(srv, "index.html"), "<html>the app page</html>");
    writeFileSync(join(srv, "sw.js"), "self.skipWaiting()");
    writeFileSync(join(srv, "manifest.webmanifest"), "{}");
    writeFileSync(join(srv, "assets", "app-abc123.js"), "console.log(1)");
    const run = docker([
      "run",
      "-d",
      "--rm",
      "-p",
      "127.0.0.1::80",
      "-v",
      `${caddyfile}:/etc/caddy/Caddyfile:ro`,
      "-v",
      `${srv}:/srv:ro`,
      image,
    ]);
    assert.equal(run.status, 0, run.stderr);
    id = run.stdout.trim();
    const port = docker(["port", id, "80/tcp"]).stdout.match(
      /:(\d+)\s*$/m,
    )?.[1];
    assert.ok(port, "no published port");
    base = `http://127.0.0.1:${port}`;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        if ((await get("/")).status === 200) return;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert.fail(`Caddy did not start: ${docker(["logs", id]).stderr}`);
  });
  after(() => {
    if (id) docker(["rm", "-f", id]);
  });

  test("hashed assets are cached for a year and never revalidated", async () => {
    const response = await get("/assets/app-abc123.js");
    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get("cache-control"),
      "public, max-age=31536000, immutable",
    );
    assert.equal(await response.text(), "console.log(1)");
  });

  test("a missing asset is a real 404, never the app page", async () => {
    assert.equal((await get("/assets/")).status, 404);
    const response = await get("/assets/app-gone.js");
    assert.equal(response.status, 404);
    assert.doesNotMatch(await response.text(), /the app page/);
    assert.doesNotMatch(
      response.headers.get("cache-control") ?? "",
      /immutable/,
      "a 404 must not be cached for a year",
    );
  });

  test("the app page is served for every route and never cached", async () => {
    for (const path of [
      "/",
      "/transactions",
      "/budgets/2026-11",
      "/index.html",
    ]) {
      const response = await get(path);
      assert.equal(response.status, 200, path);
      assert.match(await response.text(), /the app page/, path);
      assert.equal(response.headers.get("cache-control"), "no-store", path);
    }
  });

  test("the service worker and the manifest are never cached", async () => {
    for (const path of ["/sw.js", "/manifest.webmanifest"]) {
      const response = await get(path);
      assert.equal(response.status, 200, path);
      assert.equal(response.headers.get("cache-control"), "no-store", path);
    }
  });

  test("the security headers are on every kind of answer", async () => {
    for (const path of ["/", "/assets/app-abc123.js", "/assets/app-gone.js"]) {
      const response = await get(path);
      assert.match(
        response.headers.get("content-security-policy") ?? "",
        /default-src 'self'/,
        path,
      );
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
      assert.equal(response.headers.get("server"), null, path);
    }
  });

  test("/api is never answered with the app page", async () => {
    const response = await get("/api/health");
    assert.ok(response.status >= 500, `status ${response.status}`);
    assert.doesNotMatch(await response.text(), /the app page/);
  });
});

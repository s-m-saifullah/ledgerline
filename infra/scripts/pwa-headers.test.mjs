import assert from "node:assert/strict";
import test from "node:test";
import { pwaHeaderProblems } from "./pwa-headers.mjs";

const manifest = {
  status: 200,
  headers: {
    "content-type": "application/manifest+json",
    "cache-control": "no-store",
  },
};
const worker = {
  status: 200,
  headers: {
    "content-type": "text/javascript; charset=utf-8",
    "cache-control": "no-store",
  },
};

test("a correct setup has no problems", () => {
  assert.deepEqual(
    pwaHeaderProblems({
      manifest,
      worker,
      missingWorker: { status: 404, headers: {} },
    }),
    [],
  );
});

test("a cacheable worker, a wrong type and a missing file are reported", () => {
  assert.deepEqual(
    pwaHeaderProblems({
      manifest: {
        status: 200,
        headers: { "content-type": "text/html", "cache-control": "max-age=60" },
      },
      worker: { status: 404, headers: {} },
      missingWorker: { status: 200, headers: {} },
    }),
    [
      "manifest has the wrong type",
      "manifest is cacheable",
      "service worker is not served",
      "a missing worker file is not a 404",
    ],
  );
  assert.deepEqual(
    pwaHeaderProblems({
      manifest,
      worker: { status: 200, headers: { "content-type": "text/javascript" } },
    }),
    ["service worker is cacheable"],
  );
});

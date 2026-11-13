import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// The checks (setup-node reads `.node-version`) must run on the Node that serves production (the images). One value:
// when Dependabot raises the Node tag in a Dockerfile, this fails until `.node-version` is raised with it.
const read = (path) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const wanted = read(".node-version").trim();
const tags = (path) =>
  [...read(path).matchAll(/^FROM node:(\S+?)-bookworm-slim\b/gm)].map(
    (match) => match[1],
  );

test(".node-version is one exact version", () => {
  assert.match(wanted, /^\d+\.\d+\.\d+$/);
});

for (const path of [
  "infra/docker/api.Dockerfile",
  "infra/docker/web.Dockerfile",
])
  test(`${path} uses the version of .node-version`, () => {
    const found = tags(path);
    assert.ok(found.length >= 1, "no node base image found");
    for (const tag of found)
      assert.equal(
        tag,
        wanted,
        `${path} runs node ${tag}, .node-version says ${wanted}`,
      );
  });

test("every workflow that sets up Node reads .node-version", () => {
  for (const name of [
    "ci.yml",
    "android-release.yml",
    "release.yml",
    "health-watch.yml",
  ]) {
    const text = read(`.github/workflows/${name}`);
    assert.doesNotMatch(
      text,
      /node-version:\s*['"]?\d/,
      `${name} sets a literal node version`,
    );
  }
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// The deploy key belongs in the protected `production` environment (a required reviewer and `v*` tags only), not in
// the repository's secrets, where any workflow could read it. This pins the default of the one-time setup script.
const text = readFileSync(
  new URL("./configure-deploy.py", import.meta.url),
  "utf8",
);

test("the deploy secrets go to the production environment unless another one is named", () => {
  assert.match(text, /"--github-environment",\s*default="production"/);
});

test("the help says where the secrets go and how to use the repository instead", () => {
  assert.match(text, /GitHub environment that holds the secrets/);
  assert.match(text, /empty/i);
});

test("an empty name still means repository secrets", () => {
  assert.match(text, /if args\.github_environment:/);
});

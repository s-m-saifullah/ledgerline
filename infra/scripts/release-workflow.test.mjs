import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const text = readFileSync(
  new URL("../../.github/workflows/release.yml", import.meta.url),
  "utf8",
);

// The text of one job: from its name line to the next job (two-space indent) or the end.
function job(name) {
  const lines = text.split("\n");
  const start = lines.indexOf(`  ${name}:`);
  assert.ok(start >= 0, `job ${name} not found`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1)
    if (/^ {2}\S/.test(lines[i])) {
      end = i;
      break;
    }
  return lines.slice(start, end).join("\n");
}

test("a first job refuses a tag that is not on main, with the whole history to compare", () => {
  const body = job("tag-on-main");
  assert.match(body, /fetch-depth: 0/);
  assert.match(body, /ref: \$\{\{ inputs\.version \|\| github\.ref \}\}/);
  assert.match(
    body,
    /infra\/scripts\/tag-on-main\.sh "\$\(git rev-parse HEAD\)"/,
  );
  assert.match(body, /permissions:\n\s+contents: read\n/);
});

test("nothing is built, tested or deployed before that check", () => {
  assert.match(job("checks"), /needs: tag-on-main/);
  assert.match(job("images"), /needs: \[tag-on-main, checks\]/);
  assert.match(job("deploy"), /needs: images/);
});

test("the deploy still waits in the production environment and says what that means", () => {
  const body = job("deploy");
  assert.match(body, /environment: production/);
  assert.doesNotMatch(text, /an unprotected one changes nothing/);
  assert.match(
    text,
    /holds the deploy secrets and waits for the owner's approval/,
  );
});

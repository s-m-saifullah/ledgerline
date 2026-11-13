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
  assert.match(body, /permissions:\n\s+contents: read\n/);
  // The tag's commit is looked up by name, from the version typed in or the tag that started the run.
  assert.match(
    body,
    /VERSION: \$\{\{ inputs\.version \|\| github\.ref_name \}\}/,
  );
  assert.match(
    body,
    /git fetch --no-tags origin "refs\/tags\/\$VERSION:refs\/tags\/\$VERSION"/,
  );
  assert.match(
    body,
    /infra\/scripts\/tag-on-main\.sh "\$\(git rev-parse "refs\/tags\/\$VERSION\^\{commit\}"\)"/,
  );
});

// A manual run can redeploy an older release (a rollback). Older tags do not hold the script, so the job must run the
// script from the workflow's own commit and never check the tag out as the working tree.
test("the tag check runs the script from the workflow's own commit, so an older tag can still be redeployed", () => {
  const body = job("tag-on-main");
  assert.doesNotMatch(body, /^\s+ref:/m);
  assert.doesNotMatch(body, /inputs\.version \|\| github\.ref \}\}/);
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

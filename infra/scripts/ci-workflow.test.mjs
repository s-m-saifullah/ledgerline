import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const text = readFileSync(
  new URL("../../.github/workflows/ci.yml", import.meta.url),
  "utf8",
);

// A quick second merge used to cancel the first commit's check on main, and an Android tag on that commit was then
// refused by main-check-passed.sh. Only a pull request's superseded run is cancelled.
test("only a pull request's older run is cancelled, never a run on main or a release's checks", () => {
  const rule = text.match(
    /^concurrency:\n\s+group: (.+)\n(?:\s+#.*\n)*\s+cancel-in-progress: (.+)$/m,
  );
  assert.ok(rule, "no concurrency block");
  const expression = ["${{", "github.event_name", "==", "'pull_request'", "}}"];
  assert.equal(rule[2].trim(), expression.join(" "));
});

test("the browser shards write a JSON report and a step lists the tests that passed only on retry", () => {
  assert.match(
    text,
    /node infra\/scripts\/flaky-report\.mjs playwright-report\/results\.json/,
  );
  const step = text.slice(
    text.indexOf("flaky-report.mjs") - 400,
    text.indexOf("flaky-report.mjs") + 100,
  );
  assert.match(step, /if: always\(\)/);
});

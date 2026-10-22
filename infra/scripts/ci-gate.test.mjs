import assert from "node:assert/strict";
import test from "node:test";
import { gateProblems } from "./ci-gate.mjs";

const ok = { result: "success" };
const skipped = { result: "skipped" };
const all = { unit: true, e2e: true, android: true };

test("everything that had to run passed", () => {
  assert.deepEqual(
    gateProblems({
      needs: { scope: ok, unit: ok, e2e: ok, android: ok },
      expected: all,
    }),
    [],
  );
});
test("a documentation-only change skips every optional job", () => {
  assert.deepEqual(
    gateProblems({
      needs: { scope: ok, unit: skipped, e2e: skipped, android: skipped },
      expected: { unit: false, e2e: false, android: false },
    }),
    [],
  );
});
test("an Android-only change may skip the web suites, and vice versa", () => {
  assert.deepEqual(
    gateProblems({
      needs: { scope: ok, unit: skipped, e2e: skipped, android: ok },
      expected: { unit: false, e2e: false, android: true },
    }),
    [],
  );
  assert.deepEqual(
    gateProblems({
      needs: { scope: ok, unit: ok, e2e: ok, android: skipped },
      expected: { unit: true, e2e: true, android: false },
    }),
    [],
  );
});
test("a job that had to run but was skipped fails the check", () => {
  const problems = gateProblems({
    needs: { scope: ok, unit: ok, e2e: skipped, android: ok },
    expected: all,
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^e2e: skipped/);
});
test("a failed or cancelled job fails the check even when it was optional", () => {
  for (const result of ["failure", "cancelled"]) {
    assert.equal(
      gateProblems({
        needs: { scope: ok, unit: { result }, e2e: skipped, android: skipped },
        expected: { unit: false, e2e: false, android: false },
      }).length,
      1,
      result,
    );
  }
});
test("a failed scope job fails the check", () => {
  assert.equal(
    gateProblems({
      needs: { scope: { result: "failure" }, unit: skipped },
      expected: { unit: false },
    }).length,
    1,
  );
});
test("missing results fail the check", () => {
  assert.equal(
    gateProblems({ needs: {}, expected: all }).length,
    4,
    "scope plus the three required jobs",
  );
});
test("one failed shard of the browser tests fails the check", () => {
  // GitHub reports a matrix job as one result: failure if any shard failed.
  assert.equal(
    gateProblems({
      needs: { scope: ok, unit: ok, e2e: { result: "failure" }, android: ok },
      expected: all,
    }).length,
    1,
  );
});

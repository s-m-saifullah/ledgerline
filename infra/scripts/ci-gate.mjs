/** biome-ignore-all lint/suspicious/noUndeclaredEnvVars: This CI helper runs directly under Node, outside cached Turbo tasks. */
import { pathToFileURL } from "node:url";

/**
 * The final `check` job of the Checks workflow: decides whether the parallel jobs together count as a pass.
 * A job that should have run must have succeeded; a job that should not have run (the change cannot affect
 * it) may be skipped; any failure or cancellation fails the check. Takes plain objects so it can be tested
 * without GitHub, and returns the problems found.
 *
 * @param {{ needs: Record<string, { result?: string } | undefined>, expected: Record<string, boolean> }} input
 *   `needs` is the `needs` context of the job; `expected` says which of the optional jobs had to run.
 * @returns {string[]}
 */
export function gateProblems({ needs, expected }) {
  const problems = [];
  if (needs.scope?.result !== "success")
    problems.push(
      `scope: ${needs.scope?.result ?? "missing"} (the scope job decides what must run)`,
    );
  for (const [name, mustRun] of Object.entries(expected)) {
    const result = needs[name]?.result;
    if (result === "success") continue;
    if (result === "skipped" && !mustRun) continue;
    problems.push(
      `${name}: ${result ?? "missing"}${mustRun ? " (it had to pass)" : ""}`,
    );
  }
  return problems;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  let problems;
  try {
    problems = gateProblems({
      needs: JSON.parse(process.env.NEEDS ?? "{}"),
      expected: {
        unit: process.env.EXPECT_UNIT === "true",
        e2e: process.env.EXPECT_E2E === "true",
        android: process.env.EXPECT_ANDROID === "true",
      },
    });
  } catch {
    problems = ["could not read the job results"];
  }
  if (problems.length) {
    for (const problem of problems) console.error(`::error::${problem}`);
    process.exit(1);
  }
  console.log("Every job that had to run passed.");
}

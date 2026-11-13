/** biome-ignore-all lint/suspicious/noUndeclaredEnvVars: This CI helper runs directly under Node, outside cached Turbo tasks. */
import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// Playwright retries a failed browser test once in CI, so a test that fails and then passes leaves no trace in the
// log. This reads the JSON report and lists those tests (status `flaky`) as warnings and in the step summary. It
// only reports: it always exits 0, so it never turns a pass into a failure.
//
//   flaky-report.mjs <results.json> [folder of the specs, for the annotation paths]
const clean = (text) =>
  text.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");

export function flakyTests(report) {
  const found = [];
  const walk = (suite) => {
    for (const spec of suite.specs ?? [])
      for (const test of spec.tests ?? [])
        if (test.status === "flaky")
          found.push({
            title: spec.title,
            file: spec.file ?? suite.file ?? "",
            line: spec.line ?? 0,
            project: test.projectName ?? "",
          });
    for (const child of suite.suites ?? [])
      walk({ ...child, file: child.file ?? suite.file });
  };
  for (const suite of report.suites ?? []) walk(suite);
  return found;
}

export function describeFlaky(found, folder = "") {
  const prefix = folder ? `${folder.replace(/\/$/, "")}/` : "";
  const lines = found.map(
    (item) =>
      `::warning file=${prefix}${item.file},line=${item.line}::Flaky test (failed, then passed on retry): ${clean(item.title)} [${item.project}]`,
  );
  lines.push(
    found.length
      ? `${found.length} flaky test(s) passed only on a retry.`
      : "No flaky tests: nothing needed a retry.",
  );
  return lines;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [file, folder] = process.argv.slice(2);
  let report;
  try {
    report = JSON.parse(readFileSync(file ?? "", "utf8"));
  } catch {
    console.log(
      "No report to read, so no flaky-test list (the browser run may not have started).",
    );
    process.exit(0);
  }
  const found = flakyTests(report);
  const lines = describeFlaky(found, folder);
  console.log(lines.join("\n"));
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) {
    const body = found.length
      ? `### Flaky browser tests\n\n${found.map((item) => `- ${item.title} (${item.file}:${item.line}, ${item.project})`).join("\n")}\n`
      : "### Flaky browser tests\n\nNone.\n";
    appendFileSync(summary, body);
  }
}

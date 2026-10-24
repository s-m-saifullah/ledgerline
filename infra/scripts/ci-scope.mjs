/** biome-ignore-all lint/suspicious/noUndeclaredEnvVars: This CI helper runs directly under Node, outside cached Turbo tasks. */
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const rootDocs = new Set([
  "AGENTS.md",
  "CLAUDE.md",
  "CONTRIBUTING.md",
  "README.md",
]);
const sha = /^[0-9a-f]{40,64}$/i;
// Without a reliable list of changed paths every check runs: the web and API suites and the Android build.
const full = (reason, { android = true, web = true } = {}) => ({
  application: true,
  android,
  web,
  reason,
});
const git = (args) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });

export function isDocumentation(path) {
  return (
    rootDocs.has(path) || (path.startsWith("docs/") && path.endsWith(".md"))
  );
}

// What the Android build depends on besides apps/android: the API contract its types are checked against,
// the design tokens its colours come from (and the script that converts them) and this workflow.
const androidInputs = new Set([
  "docs/openapi.json",
  "packages/ui/src/tokens.css",
  "infra/scripts/android-tokens.mjs",
  "infra/scripts/android-release-notes.mjs",
  "infra/scripts/android-verify-apk.sh",
  ".github/workflows/ci.yml",
]);

export function affectsAndroid(path) {
  return path.startsWith("apps/android/") || androidInputs.has(path);
}

// The web, API and browser suites cannot be affected by documentation or by files that only the Android build uses.
export function affectsWebOrApi(path) {
  return !isDocumentation(path) && !path.startsWith("apps/android/");
}

export function classifyChanges({
  eventName,
  event,
  head,
  forceFull = false,
  runGit = git,
}) {
  if (forceFull) return full("Release checks always run the full suite.");
  let base;
  if (eventName === "pull_request") base = event.pull_request?.base?.sha;
  else if (eventName === "push" && event.ref === "refs/heads/main")
    base = event.before;
  else return full("This event requires the full suite.");
  if (!sha.test(base ?? "") || /^0+$/.test(base) || !sha.test(head ?? ""))
    return full("No reliable comparison is available; running the full suite.");
  try {
    // NUL separators preserve unusual filenames; both sides of renames are checked.
    const paths = runGit([
      "diff",
      "--name-only",
      "--no-renames",
      "-z",
      base,
      head,
      "--",
    ])
      .split("\0")
      .filter(Boolean);
    if (paths.length === 0 || !paths.every(isDocumentation))
      return full(
        "Application, configuration or contract changes require the full suite.",
        {
          android: paths.length === 0 || paths.some(affectsAndroid),
          web: paths.length === 0 || paths.some(affectsWebOrApi),
        },
      );
    return {
      application: false,
      android: false,
      web: false,
      base,
      reason:
        "Only allowlisted Markdown documentation changed; application checks skipped.",
    };
  } catch {
    return full("Could not inspect the complete diff; running the full suite.");
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  let result;
  try {
    result = classifyChanges({
      eventName: process.env.GITHUB_EVENT_NAME,
      event: JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")),
      head: git(["rev-parse", "HEAD"]).trim(),
      forceFull: process.env.FORCE_FULL_CHECKS === "true",
    });
  } catch {
    result = full("Could not read CI context; running the full suite.");
  }
  const output = `application=${result.application}\nandroid=${result.android}\nweb=${result.web}\n${result.base ? `base=${result.base}\n` : ""}`;
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, output);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${result.reason}\n`);
  console.log(result.reason);
}

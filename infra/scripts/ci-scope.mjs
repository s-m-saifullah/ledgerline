/** biome-ignore-all lint/suspicious/noUndeclaredEnvVars: This CI helper runs directly under Node, outside cached Turbo tasks. */
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const rootDocs = new Set(["AGENTS.md", "CLAUDE.md", "README.md"]);
const sha = /^[0-9a-f]{40,64}$/i;
const full = (reason) => ({ application: true, reason });
const git = (args) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });

export function isDocumentation(path) {
  return (
    rootDocs.has(path) || (path.startsWith("docs/") && path.endsWith(".md"))
  );
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
      );
    return {
      application: false,
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
  const output = `application=${result.application}\n${result.base ? `base=${result.base}\n` : ""}`;
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, output);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${result.reason}\n`);
  console.log(result.reason);
}

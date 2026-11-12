import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

// The daily health watch must be able to run unattended, so it must not use the protected `production`
// environment (a reviewer would have to approve it every day) and must not hold the deploy key.
const path = new URL(
  "../../.github/workflows/health-watch.yml",
  import.meta.url,
);
const text = existsSync(path) ? readFileSync(path, "utf8") : "";
const release = readFileSync(
  new URL("../../.github/workflows/release.yml", import.meta.url),
  "utf8",
);

// The text of one job: from its name line to the next job (two-space indent) or the end.
function job(name) {
  const lines = text.split("\n");
  const start = lines.indexOf(`  ${name}:`);
  assert.ok(start >= 0, `job ${name} not found`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^ {2}\S/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

test("the workflow exists", () => {
  assert.ok(text.length > 0, "health-watch.yml is missing");
});

test("it runs once a day and by hand, and on nothing else", () => {
  assert.match(text, /^ {2}schedule:\n {4}- cron: '0 9 \* \* \*'/m);
  assert.match(text, /^ {2}workflow_dispatch:/m);
  assert.doesNotMatch(text, /^ {2}(push|pull_request|pull_request_target):/m);
});

test("by hand it takes the two limits, so one run can be made to fail", () => {
  assert.match(text, /max_dump_hours:/);
  assert.match(text, /max_disk_pct:/);
});

test("it can only read the repository", () => {
  assert.match(text, /^permissions:\n {2}contents: read\n/m);
  assert.doesNotMatch(text, /(write|admin)$/m);
});

test("it never uses the production environment or the deploy secrets", () => {
  assert.doesNotMatch(text, /environment: production/);
  assert.doesNotMatch(text, /VPS_SSH_KEY|VPS_KNOWN_HOSTS|VPS_HOST/);
  assert.doesNotMatch(text, /secrets\.GITHUB_TOKEN/);
});

test("the public check uses no secrets and no hard-coded address", () => {
  const publicJob = job("public");
  assert.doesNotMatch(publicJob, /secrets\./);
  assert.doesNotMatch(publicJob, /environment:/);
  assert.match(publicJob, /vars\.PUBLIC_URL/);
  assert.match(publicJob, /\/api\/health/);
  assert.match(publicJob, /curl[^\n]*--fail/);
  assert.match(publicJob, /openssl/);
  assert.doesNotMatch(text, /https?:\/\/(?!example\.)[a-z0-9.-]+\.[a-z]{2,}/i);
});

test("the server check runs in the monitoring environment with its own secrets", () => {
  const serverJob = job("server");
  assert.match(serverJob, /^ {4}environment: monitoring$/m);
  assert.match(serverJob, /secrets\.MONITOR_SSH_KEY/);
  assert.match(serverJob, /secrets\.MONITOR_KNOWN_HOSTS/);
  assert.match(serverJob, /secrets\.MONITOR_HOST/);
  assert.doesNotMatch(serverJob, /StrictHostKeyChecking=no/);
});

test("the server check runs only the report, with the two limits and nothing else", () => {
  const serverJob = job("server");
  assert.match(serverJob, /ssh [^\n]*check /);
  assert.doesNotMatch(serverJob, /\bscp\b|docker|sudo/);
});

test("the two checks are independent, so one failing does not hide the other", () => {
  assert.doesNotMatch(job("server"), /needs:/);
  assert.doesNotMatch(job("public"), /needs:/);
});

test("the release copies the report to the server", () => {
  assert.match(release, /infra\/scripts\/health-report\.sh/);
});

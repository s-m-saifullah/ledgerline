import { lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

// Generic checks for anything that must not appear in a public tree. The personal denylist lives
// outside the repository (see denylist-audit.mjs). Findings carry the file, line and rule name,
// never the matched text, so a report cannot leak what it found.
const exampleDomains =
  /^((.*\.)?example\.(com|org|net)|localhost|users\.noreply\.github\.com|.*\.(invalid|test|example))$/i;
const assetSuffix =
  /\.(png|jpe?g|gif|webp|svg|ico|avif|woff2?|ttf|css|js|mjs|json|map)$/i;
const lineRules = [
  ["private-key", /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/],
  [
    "github-token",
    /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/,
  ],
  ["aws-access-key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ["slack-token", /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/],
  [
    "private-ip",
    /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/,
  ],
];
const emailPattern = /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g;
const pathRules = [
  ["env-file", /(^|\/)\.env(\.(?!example$)[^/]*)?$/],
  [
    "key-file",
    /(^|\/)(id_(rsa|ed25519|ecdsa)(\.pub)?|[^/]*\.(pem|key|p12|pfx|dump))$/,
  ],
  ["private-folder", /(^|\/)\.private(\/|$)/],
];

// Package versions such as name@1.2.3 look like addresses, and the lockfile never holds people's emails.
const skipsEmails = (path) => path.endsWith("pnpm-lock.yaml");
const looksLikeDomain = (domain) =>
  /\.[A-Za-z]{2,}$/.test(domain) && /[A-Za-z]/.test(domain.split(".")[0]);

export function auditText(path, text) {
  const findings = [];
  text.split("\n").forEach((line, index) => {
    for (const [rule, pattern] of lineRules)
      if (pattern.test(line))
        findings.push({ file: path, line: index + 1, rule });
    if (skipsEmails(path)) return;
    for (const match of line.matchAll(emailPattern)) {
      const domain = match[1];
      if (
        !looksLikeDomain(domain) ||
        exampleDomains.test(domain) ||
        assetSuffix.test(domain)
      )
        continue;
      findings.push({ file: path, line: index + 1, rule: "email-address" });
      break;
    }
  });
  return findings;
}

export function auditPath(path) {
  return pathRules
    .filter(([, pattern]) => pattern.test(path))
    .map(([rule]) => ({ file: path, line: 0, rule }));
}

export function listFiles(root) {
  const files = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === ".git" || entry.name === "node_modules") continue;
        walk(full);
      } else files.push(relative(root, full).split("\\").join("/"));
    }
  };
  walk(root);
  return files.sort();
}

export function isBinary(buffer) {
  return buffer.subarray(0, 8000).includes(0);
}

export function auditTree(root) {
  const findings = [];
  for (const path of listFiles(root)) {
    findings.push(...auditPath(path));
    const full = join(root, path);
    if (lstatSync(full).isSymbolicLink()) {
      findings.push({ file: path, line: 0, rule: "symbolic-link" });
      continue;
    }
    if (statSync(full).size > 5_000_000) continue;
    const buffer = readFileSync(full);
    if (!isBinary(buffer))
      findings.push(...auditText(path, buffer.toString("utf8")));
  }
  return findings;
}

export function formatFindings(findings) {
  return findings
    .map((item) => `${item.file}:${item.line} ${item.rule}`)
    .join("\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const root = process.argv[2];
  if (!root) {
    console.error("Usage: node infra/scripts/public-audit.mjs <directory>");
    process.exit(2);
  }
  const findings = auditTree(root);
  if (findings.length) {
    console.error(
      `Public audit found ${findings.length} issue(s):\n${formatFindings(findings)}`,
    );
    process.exit(1);
  }
  console.log(
    "Public audit passed: no keys, private addresses, personal emails or private files.",
  );
}

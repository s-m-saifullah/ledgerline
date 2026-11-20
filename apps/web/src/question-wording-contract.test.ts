import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Questions and the words for closing a sheet are said one way (WP-11c): a delete question has Cancel and Delete,
// Delete is the only word for deleting, and a sheet closes with Cancel or Close. These read the source, like
// `toast-states-contract.test.ts`, so a screen cannot drift back into "Keep entry" or "Remove loan".
const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
};
const files = walk(resolve(__dirname))
  .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
  .filter((file) => !/[\\/](gallery|test-support)[\\/]/.test(file));
const rel = (file: string) => relative(__dirname, file).replaceAll("\\", "/");
// Comments may quote the old words ("Delete now": ...); only what a person can read counts.
const text = (file: string) =>
  readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
const offenders = (pattern: RegExp, allowed: string[] = []) =>
  files
    .filter((file) => !allowed.includes(rel(file)) && pattern.test(text(file)))
    .map(rel);

describe("the words of a question", () => {
  it("Cancel is never 'Keep entry', 'Keep transfer', 'Keep loan' or 'Keep them'", () => {
    expect(offenders(/["'`>]\s*Keep (entry|transfer|loan|them)\b/)).toEqual([]);
  });
  it("a sheet or question closes with Cancel or Close: no 'Close for now', no 'Done', nothing else", () => {
    const strange: string[] = [];
    for (const file of files) {
      for (const match of text(file).matchAll(
        /cancelLabel=(\{[^}]*\}|"[^"]*")/g,
      )) {
        for (const word of (match[1] as string).matchAll(/"([^"]*)"/g))
          if (!["Cancel", "Close"].includes(word[1] as string))
            strange.push(`${rel(file)}: ${word[1]}`);
      }
    }
    expect(strange).toEqual([]);
    expect(offenders(/Close for now/)).toEqual([]);
  });
  it("the confirming button of a delete says Delete: not 'Confirm delete', 'Delete tag', 'Delete these entries' or 'Delete now'", () => {
    expect(offenders(/["'`>]\s*Confirm delete\b/)).toEqual([]);
    expect(
      offenders(/["'`]Delete (tag|these entries|these|now|entry|loan)["'`]/),
    ).toEqual([]);
  });
  it("a question never says Working…, and a delete never says Removing…", () => {
    expect(offenders(/["'`>]\s*(Working|Removing)…/)).toEqual([]);
  });
  it("Delete is the only word for deleting: no Remove, Removed or Removing as a button, title or toast", () => {
    // A tag chip's cross takes the tag off a transaction; nothing is deleted, so it keeps "Remove".
    expect(
      offenders(/["'`>]\s*Remov(e|ed|ing)\b/, ["components/tag-picker.tsx"]),
    ).toEqual([]);
  });
});

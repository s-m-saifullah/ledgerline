/**
 * The release build's shrinker (R8) must not delete a type the API returns (ADR 0043).
 *
 * Retrofit finds the type a suspend function answers with in the method's generic signature. When the app never reads
 * a field of an answer (a lend, borrow, repay or client payment only passes it along), R8 sees the class as unused and
 * deletes it, the signature turns into plain `Object`, and the first call crashes the app with "Unable to create
 * converter for class java.lang.Object". The debug build is not shrunk, so tests and a debug run never see it.
 *
 * R8 writes what it removed to `usage.txt`: a class removed whole is a line with no indent and no colon; a class that
 * only lost members is `Name:` followed by indented lines. This reads that report and fails when a type named as the
 * answer of a `LedgerlineApi` method was removed whole.
 *
 *   node infra/scripts/android-r8-check.mjs <LedgerlineApi.kt> <usage.txt>
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// Names that appear in an answer's type but are not the app's own classes.
const notModels = new Set([
  "Unit",
  "Response",
  "List",
  "Map",
  "Set",
  "String",
  "Int",
  "Long",
  "Boolean",
  "Any",
]);

/** The model types the interface answers with: the type after `): ` at the end of a function's signature. */
export function responseTypes(source) {
  const found = new Set();
  const answer = /\)\s*:\s*([A-Za-z_][\w.]*(?:<[^>\n]*>)?\??)[ \t]*$/gm;
  for (const match of source.matchAll(answer)) {
    for (const name of match[1].match(/[A-Za-z_]\w*/g) ?? []) {
      if (!notModels.has(name)) found.add(name);
    }
  }
  return found;
}

/** The classes R8 removed whole (full names, nested classes and serializers included). */
export function removedClasses(usage) {
  const removed = new Set();
  for (const line of usage.split("\n")) {
    if (/^[\w.$]+$/.test(line)) removed.add(line);
  }
  return removed;
}

/** The response types of [source] that [usage] says R8 removed; throws when the source names none. */
export function checkR8(source, usage) {
  const types = responseTypes(source);
  if (types.size === 0) {
    throw new Error(
      "found no response types in the API interface: the check cannot run",
    );
  }
  const pkg = /^package\s+([\w.]+)/m.exec(source)?.[1];
  const removed = removedClasses(usage);
  return [...types]
    .filter((name) => removed.has(pkg ? `${pkg}.${name}` : name))
    .sort();
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [apiFile, usageFile] = process.argv.slice(2);
  try {
    if (!apiFile || !usageFile) {
      throw new Error(
        "usage: android-r8-check.mjs <LedgerlineApi.kt> <usage.txt>",
      );
    }
    const usage = readFileSync(usageFile, "utf8");
    if (usage.trim() === "") {
      throw new Error(
        `${usageFile} is empty: R8 did not report, so nothing was checked`,
      );
    }
    const removed = checkR8(readFileSync(apiFile, "utf8"), usage);
    if (removed.length > 0) {
      throw new Error(
        `R8 removed ${removed.join(", ")}, which the API returns. The release app would crash on the call ` +
          '("Unable to create converter for class java.lang.Object"). Keep the type in apps/android/app/proguard-rules.pro.',
      );
    }
    process.stdout.write("R8 kept every type the API returns\n");
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}

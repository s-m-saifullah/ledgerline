/** biome-ignore-all lint/suspicious/noUndeclaredEnvVars: This CI helper runs directly under Node, outside cached Turbo tasks. */
/**
 * The Android release notes (ADR 0043, in-app update): the app shows what is new from the GitHub Release's text, so
 * every release tag needs a hand-written file `apps/android/release-notes/X.Y.Z.md`. The release body is that text,
 * then a line holding only `---`, then the APK and certificate fingerprints. The app shows only what is above the
 * first `---` line, so the notes themselves may not contain such a line.
 *
 *   node infra/scripts/android-release-notes.mjs check 0.1.3             fails unless the notes file is usable
 *   node infra/scripts/android-release-notes.mjs check-all               checks every file in the notes folder
 *   node infra/scripts/android-release-notes.mjs body 0.1.3 <apk-sha256> <cert-sha256>   prints the release body
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const maxNotesLength = 4000;
// RELEASE_NOTES_DIR lets the pull-request check try the script on sample notes without adding a release's file.
export const notesFolder =
  process.env.RELEASE_NOTES_DIR ||
  join(
    dirname(fileURLToPath(import.meta.url)),
    "../../apps/android/release-notes",
  );

const versionPattern = /^(0|[1-9]\d{0,2})\.(0|[1-9]\d?)\.(0|[1-9]\d?)$/;
const hexPattern = /^[0-9a-f]{64}$/;

/** The marker line between the notes and the fingerprints; the app cuts the text at the first one. */
export const marker = "---";

/** Returns the trimmed notes, or throws when they are empty, too long or hold the marker line. */
export function validateNotes(text, label = "The release notes") {
  const notes = text.replace(/\r\n/g, "\n").trim();
  if (notes === "") throw new Error(`${label} are empty`);
  if (notes.length > maxNotesLength) {
    throw new Error(
      `${label} are ${notes.length} characters; the most the update screen shows is ${maxNotesLength}`,
    );
  }
  if (notes.split("\n").some((line) => line.trim() === marker)) {
    throw new Error(
      `${label} contain a line with only "${marker}", which separates the notes from the fingerprints`,
    );
  }
  return notes;
}

export function notesPath(version, folder = notesFolder) {
  if (!versionPattern.test(version ?? "")) {
    throw new Error(`"${version}" is not a version X.Y.Z`);
  }
  return join(folder, `${version}.md`);
}

/** Reads and validates the notes for a version. */
export function readNotes(version, folder = notesFolder) {
  const file = notesPath(version, folder);
  if (!existsSync(file)) {
    throw new Error(
      `No release notes: add apps/android/release-notes/${version}.md (plain sentences about what changed for the owner) before tagging android-v${version}`,
    );
  }
  return validateNotes(
    readFileSync(file, "utf8"),
    `apps/android/release-notes/${version}.md`,
  );
}

/** The GitHub Release text: the notes, the marker, then the fingerprints. */
export function releaseBody({ version, notes, apkSha256, certSha256 }) {
  const apk = (apkSha256 ?? "").toLowerCase();
  const cert = (certSha256 ?? "").replace(/:/g, "").toLowerCase();
  if (!hexPattern.test(apk))
    throw new Error("The APK SHA-256 is not 64 hex digits");
  if (!hexPattern.test(cert))
    throw new Error("The certificate SHA-256 is not 64 hex digits");
  return [
    notes,
    "",
    marker,
    "",
    `Signed release APK of Ledgerline for Android ${version}.`,
    "",
    `- APK SHA-256: \`${apk}\``,
    `- Signing certificate SHA-256: \`${cert}\``,
    "",
    "Install it over the existing app; Android accepts it only with the same key and a higher version code.",
    "",
  ].join("\n");
}

/** Checks every notes file: the name is X.Y.Z.md and the text is usable. Returns the problems. */
export function checkAll(folder = notesFolder) {
  if (!existsSync(folder)) return [];
  const problems = [];
  for (const name of readdirSync(folder).sort()) {
    const match = /^(.*)\.md$/.exec(name);
    if (!match || !versionPattern.test(match[1])) {
      problems.push(`${name}: the name must be X.Y.Z.md`);
      continue;
    }
    try {
      readNotes(match[1], folder);
    } catch (error) {
      problems.push(error.message);
    }
  }
  return problems;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [command, ...rest] = process.argv.slice(2);
  try {
    if (command === "check") {
      readNotes(rest[0]);
    } else if (command === "check-all") {
      const problems = checkAll();
      if (problems.length > 0) throw new Error(problems.join("\n"));
    } else if (command === "body") {
      const [version, apkSha256, certSha256] = rest;
      process.stdout.write(
        releaseBody({
          version,
          notes: readNotes(version),
          apkSha256,
          certSha256,
        }),
      );
    } else {
      throw new Error(
        "Usage: android-release-notes.mjs check <X.Y.Z> | check-all | body <X.Y.Z> <apk-sha256> <cert-sha256>",
      );
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}

/**
 * The Android release version rule (ADR 0043, slice 5): a tag `android-vX.Y.Z` gives the version name `X.Y.Z` and
 * the version code `X*10000 + Y*100 + Z`, so every later release has a higher code (Android refuses an update with
 * a lower or equal one). Minor and patch stay below 100 so the codes never collide.
 *
 *   node infra/scripts/android-version.mjs android-v1.2.3    prints name=1.2.3 and code=10203 (for $GITHUB_OUTPUT)
 */
import { pathToFileURL } from "node:url";

const tagPattern = /^android-v(0|[1-9]\d{0,2})\.(0|[1-9]\d?)\.(0|[1-9]\d?)$/;

/** Parses an Android release tag; throws when it is not exactly `android-vX.Y.Z` with minor and patch below 100. */
export function parseAndroidTag(tag) {
  const match = tagPattern.exec(tag ?? "");
  if (!match) {
    throw new Error(
      `"${tag}" is not an Android release tag: use android-vX.Y.Z (X up to 999, Y and Z up to 99, no leading zeros)`,
    );
  }
  const [major, minor, patch] = match.slice(1).map(Number);
  return { name: `${major}.${minor}.${patch}`, code: major * 10000 + minor * 100 + patch };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { name, code } = parseAndroidTag(process.argv[2]);
    process.stdout.write(`name=${name}\ncode=${code}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}

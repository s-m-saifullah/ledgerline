import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const compose = read("infra/compose/docker-compose.yml");

// The text of one service: from "  name:" to the next service or the next top-level key.
function service(name) {
  const lines = compose.split("\n");
  const start = lines.indexOf(`  ${name}:`);
  assert.ok(start >= 0, `service ${name} not found`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^ {2}\S/.test(lines[i]) || /^\S/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

test("every service rotates its log, so a small disk cannot fill with it", () => {
  for (const name of ["db", "api", "web"]) {
    const text = service(name);
    assert.match(text, /^ {4}logging:\n/m, `${name} has no logging block`);
    assert.match(text, /driver: json-file/, name);
    assert.match(text, /max-size: ['"]?10m['"]?/, name);
    assert.match(text, /max-file: ['"]?3['"]?/, name);
  }
});

test("the images are pinned to a version, not a floating tag", () => {
  assert.match(service("db"), /image: postgres:\d+\.\d+\n/);
});

test("the restore drill uses the same database image as the compose file", () => {
  const tag = service("db").match(/image: (postgres:[\d.]+)\n/)?.[1];
  assert.ok(tag, "the compose file has no pinned postgres image");
  const drill = read("infra/scripts/restore-drill.sh");
  const used = [...drill.matchAll(/\bpostgres:[\w.-]+/g)].map((m) => m[0]);
  assert.ok(used.length > 0, "the drill names no postgres image");
  for (const image of used) assert.equal(image, tag);
});

test("every script that starts a postgres image names the pinned one", () => {
  const tag = service("db").match(/image: (postgres:[\d.]+)\n/)?.[1];
  for (const file of [
    "infra/scripts/restore-drill.sh",
    "infra/scripts/backup.sh",
    "infra/scripts/offsite-restore.sh",
  ]) {
    for (const image of read(file).matchAll(/\bpostgres:[\w.-]+/g))
      assert.equal(image[0], tag, `${file} names ${image[0]}`);
  }
});

test("the web image is built on a pinned Caddy", () => {
  assert.match(
    read("infra/docker/web.Dockerfile"),
    /^FROM caddy:\d+\.\d+\.\d+-alpine AS runtime$/m,
  );
});

test("the off-site restore uses a pinned docker client image", () => {
  const text = read("infra/scripts/offsite-restore.sh");
  assert.match(text, /OFFSITE_DRILL_IMAGE:-docker:\d+\.\d+\.\d+-cli/);
});

test("Dependabot watches the compose file as well as the Dockerfiles", () => {
  const text = read(".github/dependabot.yml");
  assert.match(
    text,
    /package-ecosystem: docker-compose\n\s+directory: \/infra\/compose\n/,
  );
  assert.match(
    text,
    /package-ecosystem: docker\n\s+directory: \/infra\/docker\n/,
  );
});

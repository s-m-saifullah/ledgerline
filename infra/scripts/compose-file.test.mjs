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

// Container hardening: what a compromised web or API process could do is limited to what it needs.
const lines = (name) => service(name).split("\n");
const has = (name, pattern) => pattern.test(service(name));

test("the web container keeps only the capability to bind its port", () => {
  assert.match(service("web"), /cap_drop: \[ALL\]/);
  assert.match(service("web"), /cap_add: \[NET_BIND_SERVICE\]/);
  assert.doesNotMatch(
    service("web").replace(/cap_add: \[NET_BIND_SERVICE\]/, ""),
    /cap_add/,
  );
});

test("the api container still drops every capability", () => {
  assert.match(service("api"), /cap_drop: \[ALL\]/);
  assert.doesNotMatch(service("api"), /cap_add/);
});

test("both application containers have a read-only filesystem and no new privileges", () => {
  for (const name of ["api", "web"]) {
    assert.match(service(name), /^ {4}read_only: true$/m, name);
    assert.match(service(name), /no-new-privileges:true/, name);
  }
});

test("the only writable places are small memory-backed folders", () => {
  assert.match(service("api"), /tmpfs:\n {6}- \/tmp(:[\w=,]+)?\n/);
  for (const folder of ["/tmp", "/data", "/config"])
    assert.match(
      service("web"),
      new RegExp(
        `tmpfs:[\\s\\S]*- ${folder.replace("/", "\\/")}(:[\\w=,]+)?\\n`,
      ),
      `web ${folder}`,
    );
});

test("the database container's filesystem is left writable (it is the database)", () => {
  assert.doesNotMatch(service("db"), /read_only/);
});

test("the web container cannot reach the database: two networks", () => {
  const networks = (name) => {
    const text = lines(name).join("\n");
    const block = text.match(/^ {4}networks:\n((?: {6}- \w+\n?)+)/m)?.[1] ?? "";
    return [...block.matchAll(/- (\w+)/g)].map((m) => m[1]).sort();
  };
  assert.deepEqual(networks("web"), ["front"]);
  assert.deepEqual(networks("api"), ["back", "front"]);
  assert.deepEqual(networks("db"), ["back"]);
  assert.match(compose, /^networks:\n {2}front:\n {2}back:\n/m);
});

test("the database network has no way out to the host's network", () => {
  assert.match(compose, /^ {2}back:\n {4}internal: true$/m);
});

test("only the web container publishes a port, on the loopback address", () => {
  const ports = compose.match(/^ {4}ports:\n {6}- "[^"]+"/gm) ?? [];
  assert.equal(ports.length, 1);
  assert.match(service("web"), /- "127\.0\.0\.1:8080:80"/);
});

test("no capabilities are added anywhere but the web container's one", () => {
  const adds = compose.match(/cap_add:.*/g) ?? [];
  assert.deepEqual(adds, ["cap_add: [NET_BIND_SERVICE]"]);
  void has;
});

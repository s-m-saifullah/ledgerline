import assert from "node:assert/strict";
import test from "node:test";
import { readSmokeConfig } from "./smoke-config.mjs";

test("a base URL is required and a trailing slash is removed", () => {
  assert.throws(() => readSmokeConfig({}), /SMOKE_BASE_URL/);
  assert.throws(
    () =>
      readSmokeConfig({ SMOKE_BASE_URL: "not a url", SMOKE_SSH_TARGET: "h" }),
    /SMOKE_BASE_URL/,
  );
  const config = readSmokeConfig({
    SMOKE_BASE_URL: "https://ledgerline.example.com/",
    SMOKE_SSH_TARGET: "deploy-host",
  });
  assert.equal(config.baseURL, "https://ledgerline.example.com");
});
test("credentials come directly or over SSH, with generic defaults", () => {
  const base = { SMOKE_BASE_URL: "https://ledgerline.example.com" };
  assert.throws(() => readSmokeConfig(base), /SMOKE_SSH_TARGET/);
  assert.deepEqual(
    readSmokeConfig({
      ...base,
      SMOKE_OWNER_EMAIL: "owner@example.com",
      SMOKE_OWNER_PASSWORD: "secret",
    }).credentials,
    { kind: "direct", email: "owner@example.com", password: "secret" },
  );
  assert.deepEqual(
    readSmokeConfig({ ...base, SMOKE_SSH_TARGET: "deploy-host" }).credentials,
    {
      kind: "ssh",
      target: "deploy-host",
      user: "ledgerline",
      envFile: "/opt/ledgerline/.env",
    },
  );
});

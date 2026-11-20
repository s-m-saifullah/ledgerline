import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { checkR8, removedClasses, responseTypes } from "./android-r8-check.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "android-r8-check.mjs");
const realApi = join(
  here,
  "../../apps/android/api-client/src/main/kotlin/app/ledgerline/api/LedgerlineApi.kt",
);

const api = `package app.ledgerline.api

interface LedgerlineApi {
    @GET("api/health")
    suspend fun health(): Health

    @POST("api/v1/ledgers/{ledgerId}/things")
    suspend fun makeThing(
        @Path("ledgerId") ledgerId: String,
        @Body body: ThingMove,
    ): ThingResult

    @DELETE("api/v1/ledgers/{ledgerId}/things/{id}")
    suspend fun deleteThing(@Path("id") id: String)

    @GET("api/v1/ledgers/{ledgerId}/things")
    suspend fun things(@Path("ledgerId") ledgerId: String): ThingList

    @POST("api/v1/sync")
    suspend fun other(): Response<Unit>
}
`;

test("the response types are the ones the interface returns", () => {
  assert.deepEqual([...responseTypes(api)].sort(), [
    "Health",
    "ThingList",
    "ThingResult",
  ]);
});

test("a class R8 removed whole is listed, one that only lost members is not", () => {
  const usage = [
    "app.ledgerline.api.ThingResult$$serializer",
    "app.ledgerline.api.ThingResult$Companion",
    "app.ledgerline.api.ThingResult",
    "app.ledgerline.api.ThingList:",
    "    22:22:int getSize()",
    "other.Library",
  ].join("\n");
  assert.deepEqual(
    [...removedClasses(usage)].sort(),
    [
      "app.ledgerline.api.ThingResult",
      "app.ledgerline.api.ThingResult$$serializer",
      "app.ledgerline.api.ThingResult$Companion",
      "other.Library",
    ].sort(),
  );
});

test("a returned type that R8 removed is reported by name; an unrelated removal is not", () => {
  const usage = [
    "app.ledgerline.api.ThingResult",
    "app.ledgerline.api.NeverReturned",
    "app.ledgerline.api.ThingList:",
    "    1:1:void <init>()",
  ].join("\n");
  assert.deepEqual(checkR8(api, usage), ["ThingResult"]);
});

test("nothing is reported when every returned type is kept", () => {
  const usage = "app.ledgerline.api.NeverReturned\n";
  assert.deepEqual(checkR8(api, usage), []);
});

test("a source with no response types is an error, not a pass", () => {
  assert.throws(
    () => checkR8("package app.ledgerline.api\n", "x\n"),
    /no response types/,
  );
});

test("the parser reads the real interface, including the loan and receipt writes", () => {
  const types = responseTypes(readFileSync(realApi, "utf8"));
  for (const name of [
    "LoanResult",
    "Receipt",
    "ServicePayment",
    "HomeSummary",
  ]) {
    assert.ok(types.has(name), `${name} is a response type`);
  }
  assert.ok(types.size >= 20, `found ${types.size} response types`);
});

function run(apiText, usageText) {
  const dir = mkdtempSync(join(tmpdir(), "r8-check-"));
  try {
    mkdirSync(dir, { recursive: true });
    const apiFile = join(dir, "Api.kt");
    const usageFile = join(dir, "usage.txt");
    writeFileSync(apiFile, apiText);
    if (usageText !== null) writeFileSync(usageFile, usageText);
    return spawnSync("node", [script, apiFile, usageFile], {
      encoding: "utf8",
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the command fails and names the type when R8 removed a response type", () => {
  const result = run(api, "app.ledgerline.api.ThingResult\n");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /ThingResult/);
  assert.match(result.stderr, /proguard-rules\.pro/);
});

test("the command passes when every response type is kept", () => {
  const result = run(api, "app.ledgerline.api.NeverReturned\n");
  assert.equal(result.status, 0, result.stderr);
});

test("the command fails when R8's report is missing or empty", () => {
  assert.equal(run(api, null).status, 1);
  const empty = run(api, "");
  assert.equal(empty.status, 1);
  assert.match(empty.stderr, /empty/);
});

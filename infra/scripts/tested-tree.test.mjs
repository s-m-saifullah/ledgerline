import assert from "node:assert/strict";
import test from "node:test";
import { findTestedPullRequest, TESTED_TREE_CONTEXT } from "./tested-tree.mjs";

const sha = "a".repeat(40);
const head = "b".repeat(40);
const treeSha = "c".repeat(40);
const pull = (over = {}) => ({
  number: 7,
  merged_at: "2026-10-09T00:00:00Z",
  merge_commit_sha: sha,
  head: { sha: head },
  ...over,
});
const passed = (over = {}) => ({
  context: TESTED_TREE_CONTEXT,
  state: "success",
  description: treeSha,
  ...over,
});
const find = (pulls, statuses, tree = treeSha) =>
  findTestedPullRequest({
    sha,
    tree,
    pulls,
    getStatuses: async (requested) => {
      assert.equal(requested, head);
      return statuses;
    },
  });

test("a merged pull request whose passed check covered this exact tree is trusted", async () => {
  assert.deepEqual(await find([pull()], [passed()]), { number: 7 });
});
test("a different tree, a failed or missing status or another context is not trusted", async () => {
  assert.equal(
    await find([pull()], [passed({ description: "d".repeat(40) })]),
    null,
  );
  assert.equal(await find([pull()], [passed({ state: "failure" })]), null);
  assert.equal(await find([pull()], [passed({ state: "pending" })]), null);
  assert.equal(await find([pull()], [passed({ context: "other" })]), null);
  assert.equal(await find([pull()], []), null);
  assert.equal(await find([pull()], undefined), null);
});
test("only a pull request merged into exactly this commit counts", async () => {
  assert.equal(await find([], [passed()]), null);
  assert.equal(await find(undefined, [passed()]), null);
  assert.equal(await find([pull({ merged_at: null })], [passed()]), null);
  assert.equal(
    await find([pull({ merge_commit_sha: "e".repeat(40) })], [passed()]),
    null,
  );
  assert.equal(await find([pull(), pull({ number: 8 })], [passed()]), null);
  assert.equal(await find([pull({ head: {} })], [passed()]), null);
});
test("an unusable tree id is never trusted", async () => {
  assert.equal(await find([pull()], [passed({ description: "" })], ""), null);
  assert.equal(await find([pull()], [passed({ description: "x" })], "x"), null);
});
test("a failing statuses lookup surfaces so the caller can fall back to the full suite", async () => {
  await assert.rejects(
    findTestedPullRequest({
      sha,
      tree: treeSha,
      pulls: [pull()],
      getStatuses: async () => {
        throw new Error("down");
      },
    }),
  );
});

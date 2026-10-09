/** biome-ignore-all lint/suspicious/noUndeclaredEnvVars: This CI helper runs directly under Node, outside cached Turbo tasks. */
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// A green pull-request check records which source tree it tested. When that exact tree lands on
// main, the post-merge run has nothing new to prove and is skipped. Every doubt means "run it".
export const TESTED_TREE_CONTEXT = "ci/tested-tree";
const tree = /^[0-9a-f]{40,64}$/i;

/**
 * @param {{ sha: string, tree: string, pulls: any[], getStatuses: (sha: string) => Promise<any[]> }} input
 * `pulls` are the pull requests GitHub associates with the pushed commit.
 * @returns {Promise<{ number: number } | null>} the pull request whose passed check covered this exact tree
 */
export async function findTestedPullRequest({
  sha,
  tree: pushedTree,
  pulls,
  getStatuses,
}) {
  if (!tree.test(pushedTree ?? "")) return null;
  // Only a pull request that was merged into exactly this commit can vouch for it.
  const merged = (pulls ?? []).filter(
    (pull) => pull?.merged_at && pull.merge_commit_sha === sha,
  );
  if (merged.length !== 1) return null;
  const [pull] = merged;
  const headSha = pull?.head?.sha;
  if (!headSha) return null;
  const statuses = await getStatuses(headSha);
  const passed = (statuses ?? []).some(
    (status) =>
      status?.context === TESTED_TREE_CONTEXT &&
      status.state === "success" &&
      status.description === pushedTree,
  );
  return passed ? { number: pull.number } : null;
}

const git = (args) => execFileSync("git", args, { encoding: "utf8" }).trim();

function github() {
  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!repository || !token) throw new Error("Missing GitHub context.");
  const call = async (path, init = {}) => {
    const response = await fetch(
      `https://api.github.com/repos/${repository}${path}`,
      {
        ...init,
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${token}`,
          "x-github-api-version": "2022-11-28",
          ...(init.body ? { "content-type": "application/json" } : {}),
        },
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!response.ok)
      throw new Error(`GitHub API returned ${response.status}.`);
    return response.status === 204 ? null : response.json();
  };
  return call;
}

function output(lines, summary) {
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `${lines}\n`);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  console.log(summary);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const mode = process.argv[2];
  if (mode === "check") {
    // Push to main: was this exact tree already tested green on its pull request?
    let skip = false;
    let reason = "Could not confirm an earlier pass; running the full suite.";
    try {
      const call = github();
      const sha = git(["rev-parse", "HEAD"]);
      const found = await findTestedPullRequest({
        sha,
        tree: git(["rev-parse", "HEAD^{tree}"]),
        pulls: await call(`/commits/${sha}/pulls?per_page=100`),
        getStatuses: (head) => call(`/commits/${head}/statuses?per_page=100`),
      });
      if (found) {
        skip = true;
        reason = `This exact source tree already passed the full suite on pull request #${found.number}; the post-merge run is skipped.`;
      }
    } catch {
      // Fail safe: any error means the full suite runs.
    }
    output(`skip=${skip}`, reason);
  } else if (mode === "record") {
    // Pull request, after every check passed: remember which tree was tested.
    const call = github();
    const head = process.env.PR_HEAD_SHA;
    const tested = git(["rev-parse", "HEAD^{tree}"]);
    if (!tree.test(head ?? "") || !tree.test(tested))
      throw new Error("Missing pull request context.");
    await call(`/statuses/${head}`, {
      method: "POST",
      body: JSON.stringify({
        state: "success",
        context: TESTED_TREE_CONTEXT,
        description: tested,
      }),
    });
    console.log("Recorded the tested source tree for this pull request head.");
  } else {
    throw new Error('Use "check" or "record".');
  }
}

# CI checks and documentation changes

## One run per PR update

The Checks workflow runs for PRs targeting `main` and for pushes to `main`. Feature-branch pushes do not start a second workflow alongside the PR check. Open a PR (a draft is fine) when remote checks are needed; a feature branch without a PR has no automatic checks. The post-merge `main` check validates the actual merged commit. New commits cancel superseded runs for the same ref.

Before merging, review the final PR head and its single successful `check` job. Do not require two duplicate push/PR runs or manually rerun a passing suite without a change, failure or unresolved concern. A new application change still requires checks on its new head. Never push directly to `main`; a successful check is not merge or deployment authorization.

## Post-merge runs skip work that already passed

A green full `check` on a pull request records the exact source tree it tested as a commit status (`ci/tested-tree`) on the PR head. When that PR is merged and the merged tree is identical (the target branch had not moved), the push check on `main` finds the status through the PR GitHub associates with the pushed commit, skips the full suite and still reports a successful `check` job. This saves about 12 minutes of runner time per merge (decided 2026-10-09 to stay inside the free Actions allowance).

Every doubt means the full suite runs: no associated PR, a different tree (for example `main` moved after the PR check), a missing or failed status, more than one candidate PR, or any API error. Release runs (explicit checkout ref) always run the full suite and never use this shortcut. Fork PRs cannot write the status, so their merges run the full suite. The logic and its tests live in `infra/scripts/tested-tree.mjs`; the PR job needs `statuses: write` and `pull-requests: read`, which `release.yml` grants to the reused workflow.

## Documentation-only changes

A change is documentation-only when every changed path is one of:

- `README.md`, `AGENTS.md` or `CLAUDE.md` at the repository root.
- A Markdown (`.md`) file under `docs/`, including plans, handoffs and ADRs.

These changes run the lightweight CI scope-policy tests and a whitespace check. They skip dependency installation, PostgreSQL, application lint/typechecks, unit/integration tests, builds, OpenAPI generation, Chromium installation and browser tests. Local verification should likewise review the content and links and run `git diff --check`; application regressions need not be repeated for prose alone.

The workflow still starts and reports a successful `check` job. Do not use workflow-level `paths-ignore` or `[skip ci]` to implement this shortcut: skipped required workflows can remain pending and block merges ([GitHub documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onpushpull_requestpull_request_targetpathspaths-ignore)).

`docs/openapi.json` is an API contract, so it requires the full suite. Code, dependencies, configuration, workflows, scripts, non-Markdown documentation assets and mixed changes also require the full suite. Classification considers the complete PR diff or pushed commit range, including deleted files and both sides of renames. An unavailable base, empty diff, unknown event or failed classification falls back to full checks; the last commit being documentation-only is insufficient.

## Releases and policy changes

Release calls supply an explicit checkout ref and always run the full suite, even when the last commit changes only documentation. Preserve this rule and the locked Node 24 stack. Browser worker settings are unchanged by this optimization.

CI-policy changes require `node --test infra/scripts/ci-scope.test.mjs` (the Checks job runs every `infra/scripts/*.test.mjs` file, including the deploy, backup-pruning, Home-consistency, tested-tree, smoke-configuration and audit script tests), workflow syntax validation, and the full PR check. The policy tests cover documentation/mixed/contract paths, full PR/push ranges, renames, deletions, missing comparisons and forced release validation.

## Public audit

The public repository also runs `node infra/scripts/public-audit.mjs .` in every check. It fails on private keys, common token shapes, private network addresses, email addresses other than placeholders (`example.com` and similar), `.env` and key files, and a `.private` folder. It reports the file, line and rule only, never the matched text.

# CI checks and documentation changes

## One run per PR update

The Checks workflow runs for PRs targeting `main` and for pushes to `main`. Feature-branch pushes do not start a second workflow alongside the PR check. Open a PR (a draft is fine) when remote checks are needed; a feature branch without a PR has no automatic checks. The post-merge `main` check validates the actual merged commit. New commits cancel superseded runs for the same ref.

Before merging, review the final PR head and its single successful `check` job (the one required result; it gates the parallel jobs described below). Do not require two duplicate push/PR runs or manually rerun a passing suite without a change, failure or unresolved concern. A new application change still requires checks on its new head. Never push directly to `main`; a successful check is not merge or deployment authorization.

## Parallel jobs behind one required `check`

The workflow runs its suites side by side so a pull request waits for the slowest one, not the sum (decided 2026-10-22 after full runs reached about 17 minutes; the repository is public, so the extra runner time is free):

| Job | What it does | Runs when |
| --- | --- | --- |
| `scope` | Classifies the change, runs the script tests and the public audit, decides what must run, and does the documentation whitespace check | always |
| `unit` | Lint, typecheck, unit and integration tests, build, the API contract and its version note | the web or API suites are affected |
| `e2e` | The browser tests, split in two shards on separate runners (each with its own database); Chromium and the system libraries it needs are installed every run, with no cache (a pull request can read only caches saved on itself or on `main`, and `main` skips this suite, so the cache never hit; the download takes seconds, and the occasional slow run is Ubuntu's package mirror serving one runner slowly) | the web or API suites are affected |
| `android` | The Android build and tests and the debug APK | the Android build is affected (next section) |
| `check` | The one required result: passes only when every job that had to run passed, and records the tested tree | always |

`infra/scripts/ci-scope.mjs` writes the `web` and `android` outputs. The web and API suites are skipped only when every changed path is documentation or under `apps/android/`; the contract (`docs/openapi.json`), the design tokens, the workflow and every other path run them, and so does any doubt (unknown paths, releases). `check` uses `infra/scripts/ci-gate.mjs` (tested in `ci-gate.test.mjs`): a job that had to run but was skipped, failed or was cancelled fails the check, so a skipped suite can never turn into a pass. First measurements (2026-10-22): a full run about 7.5 minutes (it was 17.5; the slower browser shard about 7), an Android-only change about 4.5, documentation-only about 15 seconds. Keep the job named `check`; the repository ruleset refers to it. Shards run in separate databases, so a spec must not depend on another spec's data (the specs that need a blank ledger create their own, see `CONTRIBUTING.md`).

## Post-merge runs skip work that already passed

A green full `check` on a pull request records the exact source tree it tested as a commit status (`ci/tested-tree`) on the PR head. When that PR is merged and the merged tree is identical (the target branch had not moved), the push check on `main` finds the status through the PR GitHub associates with the pushed commit, skips the full suite and still reports a successful `check` job. This saves about 12 minutes of runner time per merge (decided 2026-10-09 to stay inside the free Actions allowance).

Every doubt means the full suite runs: no associated PR, a different tree (for example `main` moved after the PR check), a missing or failed status, more than one candidate PR, or any API error. Release runs (explicit checkout ref) always run the full suite and never use this shortcut. Fork PRs cannot write the status, so their merges run the full suite. The logic and its tests live in `infra/scripts/tested-tree.mjs`; the PR job needs `statuses: write` and `pull-requests: read`, which `release.yml` grants to the reused workflow.

## Documentation-only changes

A change is documentation-only when every changed path is one of:

- `README.md`, `AGENTS.md`, `CLAUDE.md` or `CONTRIBUTING.md` at the repository root.
- A Markdown (`.md`) file under `docs/`, including plans, handoffs and ADRs.

These changes run the lightweight CI scope-policy tests and a whitespace check. They skip dependency installation, PostgreSQL, application lint/typechecks, unit/integration tests, builds, OpenAPI generation, Chromium installation and browser tests. Local verification should likewise review the content and links and run `git diff --check`; application regressions need not be repeated for prose alone.

The workflow still starts and reports a successful `check` job. Do not use workflow-level `paths-ignore` or `[skip ci]` to implement this shortcut: skipped required workflows can remain pending and block merges ([GitHub documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onpushpull_requestpull_request_targetpathspaths-ignore)).

`docs/openapi.json` is an API contract, so it requires the full suite. Code, dependencies, configuration, workflows, scripts, non-Markdown documentation assets and mixed changes also require the full suite. Classification considers the complete PR diff or pushed commit range, including deleted files and both sides of renames. An unavailable base, empty diff, unknown event or failed classification falls back to full checks; the last commit being documentation-only is insufficient.

## The Android build

The Android app ([ADR 0043](adr/0043-android-app.md)) has its own `android` job in the same workflow, so its build cannot slow or disturb the browser tests (it ran in the same job before and coincided with retried browser tests). `infra/scripts/ci-scope.mjs` also writes an `android` output: it is true when a changed path is under `apps/android/` or is one of the files the build depends on (`docs/openapi.json`, which its API types are checked against, `packages/ui/src/tokens.css` and `infra/scripts/android-tokens.mjs`, which its colours come from, and `.github/workflows/ci.yml`), and always when the changed paths are unknown (the same fallbacks as the full suite, so releases include it). The job runs only when the full suite runs and `android` is true: Temurin 17, Gradle with the checked wrapper, the SDK platform, then the API and app unit tests (including the contract test), Android lint, and the debug and release builds. The debug-signed APK is kept for 14 days as the `ledgerline-android-debug` workflow artifact so it can be sideloaded; it contains no secrets (the signed release APK is built by the separate workflow below). Documentation-only changes never run it. A post-merge run that reuses a passed pull request check skips it with the rest of the suite.

## The Android release

`.github/workflows/android-release.yml` starts on a tag `android-vX.Y.Z` and is separate from the server's `v*` release (it needs no server release, and the server's release workflow ignores these tags). Jobs: `version` (the tag must be exactly `android-vX.Y.Z` and its commit must be on `main`; `infra/scripts/android-version.mjs` derives the version name `X.Y.Z` and the version code `X*10000 + Y*100 + Z`), `checks` (the full suite on the tag through `ci.yml`, as a server release runs it), then `release`, which waits for the owner's approval in the `android-release` environment. Only that job can read the signing secrets (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`). It writes the keystore to the runner's temporary folder, builds `assembleRelease`, deletes the key (also when the build fails), checks the signature with `apksigner` (and the certificate against the repository variable `ANDROID_CERT_SHA256` when it is set) and publishes a GitHub Release with the APK and its SHA-256, not marked as the repository's latest release. The signature check is `infra/scripts/android-verify-apk.sh` (build-tools 36.0.0, the version the workflows install; it prints only the certificate digest, because the log is public). Pull requests build the release variant unsigned, apart from one step of the `android` job that signs a build with a throwaway key and runs the same script on the runner, so a change in `apksigner`'s output fails the pull request rather than a release; the real key is read only by the release job. The owner's one-time steps (key, backup, environment, secrets) and the release command are in `apps/android/README.md`.

## Releases and policy changes

Release calls supply an explicit checkout ref and always run the full suite, even when the last commit changes only documentation. Preserve this rule and the locked Node 24 stack. Browser worker settings are unchanged by this optimization.

CI-policy changes require `node --test infra/scripts/ci-scope.test.mjs infra/scripts/ci-gate.test.mjs` (the `scope` job runs every `infra/scripts/*.test.mjs` file, including the deploy, backup-pruning, Home-consistency, tested-tree, smoke-configuration and audit script tests), workflow syntax validation, and the full PR check. The policy tests cover documentation/mixed/contract paths, full PR/push ranges, renames, deletions, missing comparisons and forced release validation.

## Public audit

The public repository also runs `node infra/scripts/public-audit.mjs .` in every check. It fails on private keys, common token shapes, private network addresses, email addresses other than placeholders (`example.com` and similar), `.env` and key files, and a `.private` folder. It reports the file, line and rule only, never the matched text.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->

# Ledgerline CI guidance

Follow [docs/CI.md](docs/CI.md). Checks run once per PR update and on pushes to `main`; feature pushes do not need a duplicate run, and the push check on `main` is skipped when the merged tree already passed on its PR (releases always run the full suite). Review the final PR head's single successful `check` job before merging. For allowlisted Markdown-only documentation changes, review content/links and check whitespace without repeating application tests. Code, configuration, OpenAPI and releases still require full checks. Never use `[skip ci]` to bypass a required check, and never push directly to `main`.

# ADR 0018: Public repository built by allowlist export

Date: 2026-10-09. Status: accepted by the owner (decisions 1 to 7 of the public repository plan).

## Decision

- The public repository is a fresh single-commit copy of the product, not a flipped or history-rewritten repository. The private repository stays as an archive.
- The public tree is built by `infra/scripts/export-public.mjs` from `main` by **allowlist** (deny by default), then files from `public-overlay/` (public-only documents) are copied over it. The script reads tracked files only, refuses an output inside the repository and writes a report listing every included, overlay and excluded file.
- The overlay holds the README, the AGPL-3.0 license, security and contributing documents, issue and pull request templates, CODEOWNERS and Dependabot configuration, the self-hosting and user guides, generic plan documents and generic `CLAUDE.md` and `AGENTS.md`.
- Two audits guard the result. The generic `public-audit.mjs` ships in the public repository and runs in its CI. The personal denylist (names, emails, domain, hosts, aliases, personal vocabulary) lives only outside the repository and is applied by `denylist-audit.mjs` at export time; the script refuses a denylist inside the audited tree or tracked by Git and prints only file, line and pattern number.
- The copyright line reads "Ledgerline contributors". The deploy job uses a protected `production` environment so the public repository can require approval; deploy secrets live only there.

## Consequences

- A new file is private until an allowlist rule or an overlay file names it.
- After the cutover, development continues in the public repository; the private archive is not synchronized.
- The public plan and guides are separate from the private originals, so they are maintained in the public repository from then on.

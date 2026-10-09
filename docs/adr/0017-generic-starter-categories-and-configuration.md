# ADR 0017: Generic starter categories, add-ons and configuration-driven deployment

Date: 2026-10-09. Status: accepted. Part of the move to a clean public repository.

## Decision

- The starter category set shipped in `packages/shared` is a neutral two-level default (18 groups, 37 categories). Situation-specific extras are **optional add-ons** (students, shared household, gig and hourly work, sending money abroad) shown unticked in the preview dialog and created only when named in `groups`.
- The API keeps `basic` and accepts `personal` as the original name of the default set. `default` is the new canonical name. No personal group keys remain.
- The owner's former personal starter set is not part of the product; it can be recreated in the app.
- Domain, SSH alias, image owner, install directory and deploy user are not hardcoded. The release workflow derives image names from the repository and reads `PUBLIC_URL`, `DEPLOY_DIR` and `DEPLOY_USER` from repository variables. `deploy.sh` requires `IMAGE_REPOSITORY`. The smoke script reads `SMOKE_*` environment variables. Provisioning scripts take arguments.
- Host-specific files move to `infra/examples/` as generic samples. ADR 0002 is rewritten as a generic co-hosted service decision.

## Consequences

- Existing production data is unaffected: only a first-run owner name default changed, and existing accounts are never reset.
- The next release of the private repository needs `PUBLIC_URL` set as a repository variable for the HTTPS health check (it is skipped with a warning otherwise); `DEPLOY_DIR` and `DEPLOY_USER` default to the current values.
- OpenAPI version 0.1.18.

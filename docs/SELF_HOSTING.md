# Self-hosting Ledgerline

This guide installs Ledgerline on one Linux server with Docker. Replace the example domain `ledgerline.example.com`, the account `your-account` and the placeholders in angle brackets with your own values. Nothing in the repository is specific to one server.

## What you need

- An ARM64 (aarch64) Ubuntu server with a public IP, 2 GB of free RAM or more and a few GB of disk. The release workflow builds `linux/arm64` images; for x86-64 change the `platforms` line in `.github/workflows/release.yml`.
- A domain name with an A record pointing at the server.
- A GitHub repository (a fork or a copy) with Actions enabled, and a container registry (the workflow uses GitHub Container Registry, private by default).
- An SSH alias on your computer for an administrator account on the server.

## Layout on the server

Ledgerline lives in one directory (default `/opt/ledgerline`) owned by its own Linux user (default `ledgerline`) with mode 0700. It holds `.env` (mode 0600), `docker-compose.yml`, the deploy and backup scripts and `backups/`. Containers: `web` (Caddy, serves the static build and proxies `/api`, bound to `127.0.0.1:8080`), `api`, and `db` (PostgreSQL 18). The API and database have no host ports. Memory limits are 512 MB, 1 GB and 128 MB.

A reverse proxy on the host owns ports 80/443 and routes your domain to `127.0.0.1:8080`. A sample site block is in `infra/examples/shared-proxy-site.caddy.example`.

## First-time setup

1. **Install Docker and the Ledgerline user** (as root on the server): `DEPLOY_USER=ledgerline DEPLOY_DIR=/opt/ledgerline bash infra/scripts/install-vps.sh`.
2. **Route the domain** (as root): `bash infra/scripts/configure-proxy.sh ledgerline.example.com`. It backs up the existing Caddyfile, adds a site block, validates it and reloads. If another service already owns 80/443, this adds one more site next to it.
3. **Provision the deploy key and owner environment** from your computer:

   ```bash
   python3 infra/scripts/configure-deploy.py --repo your-account/ledgerline --ssh-alias my-server \
     --domain ledgerline.example.com --owner-email you@example.com
   ```

   It creates a dedicated restricted SSH key, stores the GitHub secrets `VPS_HOST`, `VPS_KNOWN_HOSTS` and `VPS_SSH_KEY`, and writes a private `.env` with generated passwords on the server. Nothing secret is printed.
4. **Set repository variables** (Settings, Secrets and variables, Actions, Variables): `PUBLIC_URL` (for example `https://ledgerline.example.com`, used for the final health check), and optionally `DEPLOY_DIR` and `DEPLOY_USER` if you changed the defaults.
5. **Release:** push a version tag such as `v0.1.0` from a commit whose checks passed. The workflow runs the full checks, builds and pushes `ghcr.io/<owner>/<repo>-api` and `-web`, uploads the deployment files, deploys over SSH and checks `/api/health`. If you protect the `production` environment (recommended), a reviewer must approve the deploy job.
6. **Sign in:** read the generated owner password in your own terminal, never in chat or logs:

   ```bash
   ssh my-server "sudo -u ledgerline sed -n 's/^OWNER_PASSWORD=//p' /opt/ledgerline/.env"
   ```

   Sign in at your domain with the `OWNER_EMAIL` you chose. Public sign-up is off; the owner account is created once on first start and later edits to `.env` never reset it.

## Configuration

`.env.example` documents each setting. Production requires `APP_URL` (your public address), `DATABASE_URL`, `BETTER_AUTH_SECRET` (32+ random characters), `OWNER_EMAIL`, `OWNER_PASSWORD` and the image names. Keep `.env` out of Git and out of backups you share.

## Updating and rolling back

Each tagged release repeats step 5. The deploy script takes a verified backup first and stops if it fails, pulls the new images, waits for health and restores the previous images if the health check fails. Migrations run when the API starts and are not reversed by an image rollback, so migrations are written to stay backward compatible.

Manual rollback to an earlier release:

```bash
ssh my-server 'sudo -u ledgerline env IMAGE_REPOSITORY=ghcr.io/<owner>/<repo> bash /opt/ledgerline/deploy.sh v0.1.0'
```

Never delete the PostgreSQL volume to roll back.

## Backups and the restore drill

`backup.sh` writes a private `pg_dump` and a snapshot of key totals. `restore-drill.sh <dump>` restores it into a throwaway PostgreSQL container with no network, compares fingerprints and balances recorded at dump time, and checks transfers, splits, linked payments and receipts. It never touches the running database.

Schedule both from the deploy user's crontab, for example daily and weekly:

```cron
15 3 * * * /opt/ledgerline/scheduled-backup.sh >> /opt/ledgerline/backups/cron.log 2>&1
45 3 * * 0 /opt/ledgerline/scheduled-backup.sh drill >> /opt/ledgerline/backups/cron.log 2>&1
```

`prune-backups.sh` keeps seven days and always the newest three. Dumps stay on the server, so also copy them somewhere else you control (encrypted off-site backups are planned). Before every release, and after any hotfix, take a backup and run the drill on it.

## Sharing the server with other services

Give Ledgerline its own user, directory and compose project. If another service runs under an account with passwordless sudo, restrict it so it cannot reach this stack: see [ADR 0002](adr/0002-co-hosted-service-isolation.md) and the sample in `infra/examples/co-hosted-service-isolation.conf.example`. Do not add other users to the `docker` group.

## Verifying a deployment

`node infra/scripts/production-smoke.mjs` signs in over HTTPS, checks secure httpOnly cookies, the Home heading, sign-out and anonymous denial, and compares Home's totals with the accounts, people and transactions it reads (GET requests only). Configure it with `SMOKE_BASE_URL` and either `SMOKE_OWNER_EMAIL` plus `SMOKE_OWNER_PASSWORD`, or `SMOKE_SSH_TARGET` to read the two owner lines from the server. Add `--expect-version=<api version>` to assert the published API version. It prints no secrets or amounts.

## Firewall

Allow only 80, 443 and SSH. If your provider has its own network rules (a security list or cloud firewall), open the ports there and in the host firewall. Keep PostgreSQL and the API on the internal Docker network.

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

The API also runs background jobs on the same PostgreSQL database (pg-boss, in its own `pgboss` schema): an hourly tick that refreshes exchange rates once per ledger day and, later, creates recurring entries. They need no extra container or setting; `JOBS_ENABLED=false` switches them off for debugging. The backup and restore drill include the schema, and what is due is always worked out from your data, so the job tables carry nothing you could lose.

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

`prune-backups.sh` keeps seven days and always the newest three. Dumps stay on the server unless you turn on the off-site copy below. Before every release, and after any hotfix, take a backup and run the drill on it.

## Off-site encrypted backups

A dump on the same server as the database does not survive losing the server. The off-site copy encrypts each backup before it leaves the server and stores it in a private bucket on S3-compatible storage (these steps use Backblaze B2; its free tier covers a small ledger). The server only holds your **public** key and a **write-only** bucket key, so it can add backups but cannot read, list or delete them, and someone who breaks into the server cannot read old backups or erase them. Design: [ADR 0037](adr/0037-offsite-encrypted-backups.md).

**Set it up once**

1. **Make the encryption key on your own computer** (not the server): install [age](https://github.com/FiloSottile/age) (`brew install age`) and run `age-keygen -o ledgerline-backup.key`. It prints a public key starting with `age1`. Keep the key file in **two** safe places (for example a password manager and a printed copy). If you lose it, every off-site backup is unreadable; nobody, including the server, can recover it.
2. **Create a private bucket** in your Backblaze account (turn on its two-factor sign-in first) with a unique name. Leave Object Lock off. Add a lifecycle rule to hide files 90 days after upload and delete them one day later, so old copies expire without the server deleting anything.
3. **Create a write-only key:** App Keys, Add a New Application Key, limited to that bucket, type **Write Only**. Copy the key ID and the key once into your password manager. Note the bucket's S3 endpoint and region (on the bucket page).
4. **Put the settings on the server:** copy [infra/examples/offsite.env.example](../infra/examples/offsite.env.example) to `offsite.env` in the deploy directory, fill it in with the public key, endpoint, bucket and the write-only key, and set mode 0600 owned by the deploy user. Type the key into the file on the server yourself rather than pasting it into a chat or a script.
5. **Take the first off-site copy:** `ssh my-server 'sudo -u ledgerline bash /opt/ledgerline/offsite-upload.sh'`. It builds a small tool image on first use, then prints `Off-site copy uploaded as ...`. From then on the daily `scheduled-backup.sh` and every release upload automatically.

**Check it** (the server's newest result is in `backups/offsite.status`: `result=ok` and a recent `last_ok`). A failed upload is also printed in `backups/cron.log` and makes the daily job exit with an error; it never deletes or changes a local backup, and a failed upload during a release only warns.

**Prove a restore works** on your own computer, now and then monthly. Make a **second, Read Only** key for the bucket and a file `restore.env` with `OFFSITE_S3_ENDPOINT`, `OFFSITE_S3_REGION`, `OFFSITE_BUCKET`, `OFFSITE_PREFIX`, `OFFSITE_KEY_ID` and `OFFSITE_APP_KEY` (the read-only key). Never put that key on the server. Then, with Docker running:

```bash
bash infra/scripts/offsite-restore.sh --config restore.env --identity ledgerline-backup.key
```

It downloads the newest archive, decrypts it, checks the checksum and runs the restore drill in a throwaway container, then deletes the decrypted files (they hold real data). It never touches a running database. Restoring into the running database still means a manual `pg_restore` that only you should authorise.

## If two-factor locks you out

Two-factor is optional and turned on per user in Settings ([ADR 0038](adr/0038-two-factor-totp.md)). When you turn it on you are shown ten one-time backup codes; keep them with your password. If you lose your authenticator and your backup codes, the server's administrator can turn it off for the owner account (this never touches financial data):

```bash
ssh -t my-server 'sudo -u ledgerline bash /opt/ledgerline/reset-two-factor.sh'
```

It asks you to type `RESET`, turns two-factor off for the owner, signs out every session and prints how many it changed; then sign in with the password and set two-factor up again. The same command is the way back if `BETTER_AUTH_SECRET` is ever changed, because the stored authenticator secrets are encrypted with it. Rolling back to a release older than 0.1.44 leaves the data alone but ignores two-factor, so sign-in becomes password-only until you roll forward again.

## Sharing the server with other services

Give Ledgerline its own user, directory and compose project. If another service runs under an account with passwordless sudo, restrict it so it cannot reach this stack: see [ADR 0002](adr/0002-co-hosted-service-isolation.md) and the sample in `infra/examples/co-hosted-service-isolation.conf.example`. Do not add other users to the `docker` group.

## Verifying a deployment

`node infra/scripts/production-smoke.mjs` signs in over HTTPS, checks secure httpOnly cookies, the Home heading, sign-out and anonymous denial, and compares Home's totals with the accounts, clients and transactions it reads (GET requests only). Configure it with `SMOKE_BASE_URL` and either `SMOKE_OWNER_EMAIL` plus `SMOKE_OWNER_PASSWORD`, or `SMOKE_SSH_TARGET` to read the two owner lines from the server. If the owner turned on two-factor, also set `SMOKE_TOTP_SECRET` to the authenticator key (the text key shown at setup, kept in your private local environment and never in the repository); the check then types the current code itself. Add `--expect-version=<api version>` to assert the published API version. Add `--expect-pwa` (releases from the installable-app change on) to check that the manifest and the service worker are served and never cached. It prints no secrets or amounts.

## Firewall

Allow only 80, 443 and SSH. If your provider has its own network rules (a security list or cloud firewall), open the ports there and in the host firewall. Keep PostgreSQL and the API on the internal Docker network.

## Android sign-in (bearer tokens)

The Android app signs in with the same address as the web app and keeps a session token instead of a cookie (ADR 0042). Nothing needs configuring on the server. For each request the app sends `Origin` set to your `APP_URL`; to get a token it also sends `X-Ledgerline-Client: android` on the sign-in and, if two-factor is on, the code check, and reads the token from the `set-auth-token` response header. The token is a normal 7-day session extended on use, so signing out (or the Settings devices list, once it exists) ends it, and the recovery commands for the password and two-factor work exactly as before. A browser never receives the token.

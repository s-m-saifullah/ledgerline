# Self-hosting Ledgerline

This guide installs Ledgerline on one Linux server with Docker. Replace the example domain `ledgerline.example.com`, the account `your-account` and the placeholders in angle brackets with your own values. Nothing in the repository is specific to one server.

## What you need

- An ARM64 (aarch64) Ubuntu server with a public IP, 2 GB of free RAM or more and a few GB of disk. The release workflow builds `linux/arm64` images; for x86-64 change the `platforms` line in `.github/workflows/release.yml`.
- A domain name with an A record pointing at the server.
- A GitHub repository (a fork or a copy) with Actions enabled, and a container registry (the workflow uses GitHub Container Registry, private by default).
- An SSH alias on your computer for an administrator account on the server.

## Layout on the server

Ledgerline lives in one directory (default `/opt/ledgerline`) owned by its own Linux user (default `ledgerline`) with mode 0700. It holds `.env` (mode 0600), `docker-compose.yml`, the deploy and backup scripts and `backups/`. Containers: `web` (Caddy, serves the static build and proxies `/api`, bound to `127.0.0.1:8080`), `api`, and `db` (PostgreSQL 18). The API and database have no host ports. Memory limits are 512 MB, 1 GB and 128 MB. The web and API containers run with a read-only filesystem (only small memory-backed `/tmp`, and for Caddy `/data` and `/config`, are writable) and the web container keeps one capability, binding its port. There are two networks: the web container shares one with the API only, and the database sits on an internal one with the API only, so a compromised web container cannot reach the database and the database cannot reach the internet. The first deploy after this change leaves the old `ledgerline_default` network behind, unused; remove it once with `docker network rm ledgerline_default`. Each container's log is rotated (three files of 10 MB), the health check is left out of the API's request log, and every API answer carries `Cache-Control: no-store`. The PostgreSQL and Caddy images are pinned to a version (Dependabot proposes patch updates); the restore drill starts the same PostgreSQL image, so change both together (a script test fails until they match).

A reverse proxy on the host owns ports 80/443 and routes your domain to `127.0.0.1:8080`. A sample site block is in `infra/examples/shared-proxy-site.caddy.example`. The host proxy must pass each visitor's address in `X-Forwarded-For` (Caddy does this by itself; with nginx add `proxy_set_header X-Forwarded-For $remote_addr;`). The web container trusts private addresses only, reads the chain from the right and gives the API that one address, because the API limits sign-ins per visitor (three tries in ten seconds); a proxy that sends no address makes every visitor look like the proxy, so one person's bad tries would stop everyone.

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

`.env.example` documents each setting. Production requires `APP_URL` (your public address), `DATABASE_URL`, `BETTER_AUTH_SECRET` (32+ random characters), `OWNER_EMAIL`, `OWNER_PASSWORD` and the image names. Keep `.env` out of Git and out of backups you share, but keep your own copy in a password manager: it is in no backup, and without `BETTER_AUTH_SECRET` the stored two-factor secrets can no longer be read after a rebuild.

The API also runs background jobs on the same PostgreSQL database (pg-boss, in its own `pgboss` schema): an hourly tick that refreshes exchange rates once per ledger day, creates recurring entries and removes what has passed its 30-day undo. They need no extra container or setting; `JOBS_ENABLED=false` switches them all off for debugging. The backup and restore drill include the schema, and what is due is always worked out from your data, so the job tables carry nothing you could lose.

## What leaves the server

Nothing about your money, ever, and no analytics or trackers. The server makes one kind of outside call: the daily exchange-rate fetch, which asks Frankfurter (and, if that fails, a public package CDN) for a rate, sending only a currency code, the base currency and a date, and so also revealing your server's address to those hosts. It runs only for ledgers that pinned another currency. Set `RATES_ENABLED=false` in `.env` to switch it off: nothing then leaves the server, the manual rate refresh lists every currency as not fetched, and you set each rate by hand ([ADR 0051](adr/0051-the-rate-fetch-is-an-outside-call.md)). The Android app's update check is the other outside call (it asks the repository's public releases whether a newer version exists).

## Updating and rolling back

Each tagged release repeats step 5. The deploy script first takes a backup and runs the restore drill on that exact dump, and stops, with nothing changed, if either fails. It then pulls the new images, waits for health (retrying while the web container starts) and restores the previous images if the health check fails. A server with a database volume (`ledgerline_db`) always gets the backup, even if the database container is stopped, which the script starts first; only a server with neither a volume nor a database container is treated as a fresh install. If the volume has another name (you set `COMPOSE_PROJECT_NAME`), set the same value when you run the script, or it stops and says so. After the release the workflow takes another backup and drills it, and that step fails if the backup does. Migrations run when the API starts and are not reversed by an image rollback, so migrations are written to stay backward compatible. Deploying the same version again keeps the older release as the rollback target.

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

`prune-backups.sh` keeps seven days and always the newest three finished dumps (a dump without its checksum, left by a full disk, does not count). The daily script prunes first, so a full disk cannot stop the backups for good, then checks the free space: below 200 MB (`MIN_FREE_MB`) it writes `Low disk space` to `cron.log` and exits 1, and it still tries the backup. A failed backup or drill also exits 1, and the cron log is the only place that shows it, so read it now and then. Dumps stay on the server unless you turn on the off-site copy below. `backup-and-drill.sh` takes a backup and drills the dump it just took; the deploy and the release workflow use it, and you can run it by hand before a hotfix.

## Rebuild on a new server

Keep these outside the server: your `.env` (the password manager), the off-site backup's private key (`ledgerline-backup.key`), the read-only bucket settings (`restore.env`) and your repository with its Actions secrets. Then, after a lost or ruined server:

1. On the new server, do steps 1 to 4 of First-time setup (install, route the domain, deploy key and variables). Step 3 writes a new `.env`: replace it with your saved one (same `BETTER_AUTH_SECRET` and database settings), mode 0600, owned by the deploy user.
2. On your computer, fetch and check the newest off-site backup and keep the decrypted dump: `bash infra/scripts/offsite-restore.sh --config restore.env --identity ledgerline-backup.key --keep`. It prints where it kept the files. They hold real data: delete them when you are done.
3. Copy the dump to the new server (`scp`, into `backups/`, mode 0600) and start only the empty database there: `docker compose --env-file .env -f docker-compose.yml up -d --wait db`.
4. Restore into that empty database, and only an empty one: `docker compose --env-file .env -f docker-compose.yml exec -T db sh -c 'exec pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --exit-on-error' < backups/<the dump>`.
5. Run the release workflow for your current version tag (step 5 of First-time setup). The deploy takes a backup of the restored data and drills it before it pulls the images; the migrations already in the dump are not run again.
6. Sign in, check a balance you know, and, if you use two-factor, sign in with a code (it proves the saved `.env` is the right one). Delete the decrypted dump from your computer and from the server.

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

## Health watch

Nothing on the server tells you when it fails; the cron log only helps if you read it. The `Health watch` workflow (`.github/workflows/health-watch.yml`) runs every day at 09:00 UTC and fails, so GitHub emails you, when:

- `PUBLIC_URL/api/health` does not answer, or the certificate has less than 14 days left;
- the newest finished backup is 26 hours old or more (the nightly backup runs at 03:15);
- the off-site copy is on and its last upload failed or is 48 hours old or more;
- disk use where backups are kept is 85% or more.

It sends nothing about money. The server answers one read-only script, `health-report.sh`, which prints ages and percentages only (it is copied with each release, or copy it by hand the first time).

**Set it up once** (the server commands are yours):

1. On your computer, make a key used for nothing else: `ssh-keygen -t ed25519 -N '' -C health-watch -f health-watch-key`.
2. On the server, in the deploy user's `~/.ssh/authorized_keys`, add the public half locked to that one command. `restrict` turns off every other use (no shell, no forwarding):

   ```text
   restrict,command="bash /opt/ledgerline/health-report.sh" ssh-ed25519 AAAA... health-watch
   ```

3. In the repository's Settings, Environments, make a new environment named `monitoring` **with no required reviewer** (a reviewer would have to approve it every day). Add three secrets to it: `MONITOR_SSH_KEY` (the private key file's text), `MONITOR_KNOWN_HOSTS` (the server's line from `ssh-keyscan`) and `MONITOR_HOST` (the server's address). The deploy user comes from the `DEPLOY_USER` variable, as for releases. Then delete the key files from your computer.
4. Make sure GitHub emails you about failed workflow runs (your profile's Settings, Notifications, Actions).
5. Prove it: Actions, Health watch, Run workflow, once with the defaults (green), and once with `max_dump_hours` set to `0` (red, and an email arrives).

Run the report by hand on the server with `bash /opt/ledgerline/health-report.sh`. GitHub stops scheduled workflows in a repository with no activity for 60 days; a green run now and then, or any commit, keeps it going.

## Adding people

The admin can add people in the app (More, then Users, [ADR 0048](adr/0048-profile-and-managed-users.md)). Each person has their own account and their own empty ledger, and the admin never sees anyone's money. The browser makes a temporary password (three words and a number) for the admin to read out or copy; it is shown once and never stored. The person chooses their own at first sign-in. From a person's row the admin can reset their password, turn off their two-factor, sign out their devices, stop their sign-in or delete them. A deleted person moves to "Recently deleted" for 30 days: the admin can restore them with all their data, exactly as they were, or delete them at once; after 30 days the server removes them and their data for good and frees their email ([ADR 0049](adr/0049-deleted-people-and-cleared-ledgers.md)). Each person can clear their own ledger in Settings to start fresh, and the admin can clear a person's ledger from their row; either can be undone for 30 days, and the admin never sees what a ledger holds. A purge cannot reach backups already taken: they keep that data until they age out (seven days on the server, 90 days off-site). Whoever runs the server can still read the database and its backups, so tell the people you add who that is.

## If the admin forgets their password

The account the server was set up with is the admin ([ADR 0048](adr/0048-profile-and-managed-users.md)). Once the password has been changed in the app, the `OWNER_PASSWORD` in `.env` no longer works (it is read only on the first start), so a forgotten password needs the server's administrator:

```bash
ssh -t my-server 'sudo -u ledgerline bash /opt/ledgerline/reset-password.sh'
```

It asks you to type `RESET`, sets a new temporary password for the admin account, signs out every session and prints the password once on your terminal (read it there; do not paste it anywhere). Sign in with it and you are asked to choose a new one before anything else. It never touches financial data.

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

The Android app signs in with the same address as the web app and keeps a session token instead of a cookie (ADR 0042). Nothing needs configuring on the server. For each request the app sends `Origin` set to your `APP_URL`; to get a token it also sends `X-Ledgerline-Client: android` on the sign-in and, if two-factor is on, the code check, and reads the token from the `set-auth-token` response header. The token is a normal 7-day session extended on use, so signing out (or removing the device under Settings, Signed-in devices) ends it, and the recovery commands for the password and two-factor work exactly as before. A browser never receives the token.

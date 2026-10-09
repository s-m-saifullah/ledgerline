# Security policy

Ledgerline handles personal financial data, so security reports are welcome and taken seriously.

## Reporting a vulnerability

Please **do not open a public issue** for a vulnerability. Use GitHub's private vulnerability reporting: open the repository's **Security** tab and choose **Report a vulnerability**. Include what you found, steps to reproduce it, the version (`/api/v1/openapi.json` shows the API version) and the impact you expect.

You can expect an acknowledgement within a few days and a status update as the report is investigated. Please allow reasonable time for a fix before disclosing details publicly.

## Supported versions

Only the latest release receives security fixes. Self-hosters should upgrade to new releases promptly and keep their server, Docker and operating system patched.

## Scope

In scope: authentication and sessions, ledger isolation (one ledger reading or writing another's data), money handling, the REST API, the web app, the Docker images and the deployment scripts in this repository.

Out of scope: vulnerabilities in your own server configuration, third-party services you connect, social engineering, and denial-of-service by volume.

## Please do not

Access data that is not yours, or test against someone else's installation without permission. Never include real financial data in a report; use synthetic examples.

## Hardening notes for operators

Keep `.env` private (mode 0600) and out of Git, use unique long passwords, expose only ports 80/443 and SSH, keep PostgreSQL and the API off public interfaces, and verify your backups with the restore drill described in [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md).

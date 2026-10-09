# 0002: Isolate co-hosted services from the finance stack

Status: accepted. Applies to any server that runs Ledgerline next to other services.

## Context

A server may also run another long-lived service, for example an automation agent or a web app, under an account that has passwordless sudo. A separate Linux user for Ledgerline and private file permissions cannot stop a process running as that account from elevating to root and reading finance credentials, the database volume or the container sockets.

## Decision

- Ledgerline runs under its own Linux user with its own install directory (mode 0700) and its own `.env` (mode 0600). That user is the only one in the `docker` group besides administrators.
- Any co-hosted service that runs under a privileged account gets a service-manager drop-in that sets `NoNewPrivileges=true` and hides the Ledgerline directory, the Ledgerline user's home, the Docker socket and the containerd socket from that service's filesystem namespace.
- A shared host reverse proxy owns ports 80/443. Ledgerline's web container binds `127.0.0.1:8080` only, and the proxy routes the domain to it.
- Future access by other services to finance data goes through an explicitly authorized, read-only Ledgerline API token, never through host privileges.

A sample drop-in is in `infra/examples/co-hosted-service-isolation.conf.example`, and a sample proxy site block is in `infra/examples/shared-proxy-site.caddy.example`. Adapt the service name and paths to your server.

## Consequences

- Workflows of the isolated service that need sudo stop working. This is intentional.
- The restricted service must be restarted once after the drop-in is installed. Verify afterwards that its process reports `NoNewPrivs: 1`, that reads of the Ledgerline directory and the Docker socket from its namespace fail, and that its own endpoint still responds.
- The administrator's own SSH account keeps its privileges outside the restricted service.
- Keep the drop-in in place when you change the deployment. Removing it re-opens the elevation path.

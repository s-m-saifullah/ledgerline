#!/usr/bin/env bash
# Adds a site block for Ledgerline to a host Caddy that already serves ports 80/443.
# Usage (as root): configure-proxy.sh ledgerline.example.com   (optional UPSTREAM, default 127.0.0.1:8080)
set -euo pipefail
test "$(id -u)" -eq 0
domain="${1:?Usage: configure-proxy.sh <domain>, for example ledgerline.example.com}"
[[ "$domain" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]] || { echo 'Enter a plain domain name'; exit 1; }
upstream="${UPSTREAM:-127.0.0.1:8080}"
backup="/etc/caddy/Caddyfile.ledgerline-backup-$(date -u +%Y%m%dT%H%M%SZ)"
cp -p /etc/caddy/Caddyfile "$backup"
cat > /etc/caddy/ledgerline.caddy <<CADDY
$domain {
  header Strict-Transport-Security "max-age=31536000"
  reverse_proxy $upstream
}
CADDY
if ! grep -q '^import /etc/caddy/ledgerline.caddy$' /etc/caddy/Caddyfile; then
  printf '\nimport /etc/caddy/ledgerline.caddy\n' >> /etc/caddy/Caddyfile
fi
if ! caddy validate --config /etc/caddy/Caddyfile; then cp -p "$backup" /etc/caddy/Caddyfile; exit 1; fi
if ! systemctl reload caddy; then cp -p "$backup" /etc/caddy/Caddyfile; systemctl reload caddy; exit 1; fi
echo 'Ledgerline proxy route configured; original Caddyfile backed up.'

#!/usr/bin/env bash
# Run as root on an Ubuntu ARM64 server. Existing host proxy routes stay in place.
# Optional environment: DEPLOY_USER (default ledgerline), DEPLOY_DIR (default /opt/ledgerline).
set -euo pipefail
deploy_user="${DEPLOY_USER:-ledgerline}"
deploy_dir="${DEPLOY_DIR:-/opt/ledgerline}"
test "$(id -u)" -eq 0
test "$(uname -m)" = aarch64
if ! command -v docker >/dev/null; then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  . /etc/os-release
  printf 'Types: deb\nURIs: https://download.docker.com/linux/ubuntu\nSuites: %s\nComponents: stable\nArchitectures: arm64\nSigned-By: /etc/apt/keyrings/docker.asc\n' "$VERSION_CODENAME" > /etc/apt/sources.list.d/docker.sources
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
id "$deploy_user" >/dev/null 2>&1 || useradd --create-home --shell /bin/bash "$deploy_user"
usermod -aG docker "$deploy_user"
install -d -o "$deploy_user" -g "$deploy_user" -m 0700 "$deploy_dir"
install -d -o "$deploy_user" -g "$deploy_user" -m 0700 "/home/$deploy_user/.ssh"
docker compose version

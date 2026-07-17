#!/usr/bin/env bash
set -euo pipefail

# Idempotency: apt installs, sysctl reconciliation, mkdir, and the conditional
# Bun install are naturally repeatable; a completion marker records success.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=host/lib.sh
source "${SCRIPT_DIR}/lib.sh"
sb_load_config

sb_log "Installing base host packages."
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y \
  curl \
  git \
  jq \
  unzip \
  zfsutils-linux \
  build-essential \
  ca-certificates \
  openssl

if [[ ! -x /usr/local/bin/bun ]]; then
  sb_log "Installing Bun system-wide."
  install -d -m 0755 /usr/local/lib/bun
  curl -fsSL https://bun.sh/install | env BUN_INSTALL=/usr/local/lib/bun bash
  ln -sfn /usr/local/lib/bun/bin/bun /usr/local/bin/bun
fi

cat > /etc/sysctl.d/99-speedbuild.conf <<'EOF'
fs.inotify.max_user_instances=1024
fs.inotify.max_user_watches=1048576
EOF
sysctl --system

mkdir -p /var/lib/speedbuild/{markers,models,state}
sb_done_marker 00-base
sb_log "Base host setup complete."

#!/usr/bin/env bash
set -euo pipefail

# Idempotency: application files, production dependencies, environment, and the
# systemd unit are reconciled on every run; systemd enable/restart is repeatable.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=host/lib.sh
source "${SCRIPT_DIR}/lib.sh"
sb_load_config

source_dir="${SB_REPO_ROOT}/packages/host-agent"
install_dir=/opt/speedbuild/host-agent
[[ -d "${source_dir}" ]] || sb_die "Required source directory does not exist: ${source_dir}"

install -d -m 0755 "${install_dir}"
cp -a "${source_dir}/." "${install_dir}/"
(
  cd "${install_dir}"
  /usr/local/bin/bun install --production
)

# Challenge briefs the host-agent pushes into participants on reveal
# (CONTENT_DIR = /opt/speedbuild/challenges-content in host-agent config).
content_src="${SB_REPO_ROOT}/packages/challenges-content"
content_dst=/opt/speedbuild/challenges-content
[[ -d "${content_src}" ]] || sb_die "Required content directory does not exist: ${content_src}"
install -d -m 0755 "${content_dst}"
cp -a "${content_src}/." "${content_dst}/"
install -m 0644 "${SB_REPO_ROOT}/docs/PLAYERS_GUIDE.md" "${content_dst}/PLAYERS_GUIDE.md"

install -m 0600 "${SB_REPO_ROOT}/config/speedbuild.env" /etc/speedbuild.env
cat > /etc/systemd/system/sb-host-agent.service <<'EOF'
[Unit]
Description=Speedbuild host agent
After=incus.service network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/speedbuild/host-agent
EnvironmentFile=/etc/speedbuild.env
ExecStart=/usr/local/bin/bun run /opt/speedbuild/host-agent/src/index.ts
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now sb-host-agent.service
systemctl restart sb-host-agent.service

sb_done_marker 40-host-agent
sb_log "Host agent installed and running."

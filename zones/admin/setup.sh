#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "zones/admin/setup.sh must run as root" >&2
  exit 1
fi

if [[ ! -r /etc/speedbuild.env ]]; then
  echo "/etc/speedbuild.env is missing or unreadable" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
source /etc/speedbuild.env
set +a

export DEBIAN_FRONTEND=noninteractive
apt-get update
# Docker Engine intentionally comes from Ubuntu's docker.io package. Do not switch
# to docker-ce 29.x: that release has a known Docker-in-Incus nesting regression.
apt-get install -y --no-install-recommends \
  ca-certificates \
  curl \
  git \
  jq \
  openssl \
  unzip \
  uuid-runtime \
  docker.io \
  docker-compose-v2

systemctl enable --now docker

if ! command -v bun >/dev/null 2>&1; then
  curl -fsSL https://bun.sh/install | bash
  install -m 0755 /root/.bun/bin/bun /usr/local/bin/bun
fi

install -d -m 0755 /opt/asciinema
cp -a /opt/zone/asciinema/. /opt/asciinema/
install -m 0755 /opt/zone/provision-stream.sh /usr/local/bin/provision-stream

if grep -Eq '(^|[^0-9])4002([^0-9]|$)' /opt/asciinema/docker-compose.yml; then
  echo "Refusing to start asciinema: docker-compose.yml publishes unauthenticated port 4002" >&2
  exit 1
fi

ASCIINEMA_ENV=/opt/asciinema/.env
umask 077
touch "${ASCIINEMA_ENV}"
chmod 0600 "${ASCIINEMA_ENV}"
if ! grep -q '^SECRET_KEY_BASE=' "${ASCIINEMA_ENV}"; then
  printf 'SECRET_KEY_BASE=%s\n' "$(openssl rand -hex 64)" >> "${ASCIINEMA_ENV}"
fi
if ! grep -q '^ASCIINEMA_SERVER_TAG=' "${ASCIINEMA_ENV}"; then
  printf 'ASCIINEMA_SERVER_TAG=latest\n' >> "${ASCIINEMA_ENV}"
fi

docker compose --project-directory /opt/asciinema -f /opt/asciinema/docker-compose.yml up -d

asciinema_deadline=$((SECONDS + 180))
while true; do
  if curl -fsS http://localhost:4000/ >/dev/null; then
    break
  fi
  if (( SECONDS >= asciinema_deadline )); then
    echo "asciinema-server did not become healthy within 180 seconds" >&2
    exit 1
  fi
  sleep 2
done

admin_marker=/var/lib/.estate-asciinema-admin
admin_tokens=/var/lib/estate-asciinema-admin.tokens
if [[ ! -f ${admin_marker} ]]; then
  tokens=$(provision-stream estate-admin)
  printf '%s\n' "${tokens}" >"${admin_tokens}"
  chmod 0600 "${admin_tokens}"
  install -m 0600 /dev/null "${admin_marker}"
fi

cd /opt/packages/admin-dashboard
bun install
bun run build

cat > /etc/systemd/system/sb-dashboard.service <<'UNIT'
[Unit]
Description=Speedbuild Estate admin dashboard
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/packages/admin-dashboard
EnvironmentFile=/etc/speedbuild.env
Environment=PORT=3000
Environment=HOST=0.0.0.0
ExecStart=/usr/local/bin/bun ./build/index.js
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now sb-dashboard.service

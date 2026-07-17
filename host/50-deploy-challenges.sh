#!/usr/bin/env bash
set -euo pipefail

# Idempotency: the health wait is read-only and the zone's deployment pipeline
# owns idempotent deployment reconciliation; a marker records a successful run.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=host/lib.sh
source "${SCRIPT_DIR}/lib.sh"
sb_load_config

sb_surfpool_healthy() {
  curl -fsS -X POST \
    -H 'Content-Type: application/json' \
    --data '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' \
    "http://${SB_IP_CHALLENGES}:8899" 2>/dev/null \
    | jq -e '.result == "ok"' >/dev/null
}

sb_wait_for 300 "Surfpool JSON-RPC health" sb_surfpool_healthy
sb_log "Deploying challenge programs and state."
sb_container_exec challenges bash -lc 'cd /opt/zone && bash run-deploy.sh'

host_lan_ip="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i <= NF; i++) if ($i == "src") {print $(i + 1); exit}}')"
if [[ -z "${host_lan_ip}" ]]; then
  host_lan_ip="$(hostname -I | awk '{print $1}')"
fi
[[ -n "${host_lan_ip}" ]] || host_lan_ip='<SUNBURST-LAN-IP>'

participant_count="$(sb_effective_participant_count)"
ssh_port_first="$((SB_SSH_PORT_BASE + 1))"
ssh_port_last="$((SB_SSH_PORT_BASE + participant_count))"

cat <<EOF

Speedbuild bootstrap summary
----------------------------
Dashboard:     http://${host_lan_ip}:8080
Asciinema:     http://${host_lan_ip}:4000
Surfpool RPC:  http://${host_lan_ip}:8899
Participant SSH ports: ${ssh_port_first}-${ssh_port_last}

Keep SB_ESTATE_SECRET, SB_ADMIN_TOKEN, and SB_HOST_AGENT_TOKEN private.
Use the configured admin and host-agent tokens to access their protected services.
EOF

sb_done_marker 50-deploy-challenges

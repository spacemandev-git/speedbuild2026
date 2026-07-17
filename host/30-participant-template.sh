#!/usr/bin/env bash
set -euo pipefail

# Idempotency: the template is launched only once, then restarted as needed;
# config and zone files are refreshed before rerunning its setup and stopping it.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=host/lib.sh
source "${SCRIPT_DIR}/lib.sh"
sb_load_config

sb_template_has_profile() {
  local profile="$1"
  incus query /1.0/instances/p-template |
    jq -e --arg profile "${profile}" '.metadata.profiles | index($profile) != null' >/dev/null
}

if ! incus info p-template >/dev/null 2>&1; then
  sb_log "Launching participant template."
  if sb_sriov_active; then
    # shellcheck disable=SC2046 # sb_launch_flags emits one argument or nothing.
    incus launch images:ubuntu/24.04/cloud p-template $(sb_launch_flags) --profile sb-participant --profile sb-vf
  else
    # shellcheck disable=SC2046 # sb_launch_flags emits one argument or nothing.
    incus launch images:ubuntu/24.04/cloud p-template $(sb_launch_flags) --profile sb-participant
  fi
else
  if sb_sriov_active && ! sb_template_has_profile sb-vf; then
    incus profile add p-template sb-vf
  elif ! sb_sriov_active && sb_template_has_profile sb-vf; then
    incus profile remove p-template sb-vf
  fi
  incus start p-template 2>/dev/null || true
fi

sb_wait_for_agent p-template
sb_container_exec p-template bash -lc 'cloud-init status --wait >/dev/null 2>&1 || true'
incus file push "${SB_REPO_ROOT}/config/speedbuild.env" p-template/etc/speedbuild.env
sb_push_tree p-template "${SB_REPO_ROOT}/zones/participant" /opt/zone

sb_container_exec p-template bash /opt/zone/setup.sh
incus stop p-template 2>/dev/null || true

sb_done_marker 30-participant-template
sb_log "Participant template is ready and stopped."

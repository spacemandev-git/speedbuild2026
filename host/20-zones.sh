#!/usr/bin/env bash
set -euo pipefail

# Idempotency: instances are launched only if absent; limits, IPs, files, disk,
# and proxy devices are reconciled before each zone's idempotent setup script.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=host/lib.sh
source "${SCRIPT_DIR}/lib.sh"
sb_load_config

sb_instance_exists() {
  incus info "$1" >/dev/null 2>&1
}

sb_local_device_exists() {
  local container="$1"
  local device="$2"
  incus config device show "${container}" | grep -qE "^[[:space:]]*${device}:$"
}

sb_instance_has_profile() {
  local instance="$1"
  local profile="$2"
  incus query "/1.0/instances/${instance}" |
    jq -e --arg profile "${profile}" '.metadata.profiles | index($profile) != null' >/dev/null
}

sb_prepare_zone() {
  local zone="$1"
  local ip_address="$2"
  local cpus memory current_ip

  if ! sb_instance_exists "${zone}"; then
    sb_log "Launching ${zone} zone."
    if sb_sriov_active; then
      # shellcheck disable=SC2046 # sb_launch_flags emits one argument or nothing.
      incus launch images:ubuntu/24.04/cloud "${zone}" $(sb_launch_flags) --profile default --profile sb-vf
    else
      # shellcheck disable=SC2046 # sb_launch_flags emits one argument or nothing.
      incus launch images:ubuntu/24.04/cloud "${zone}" $(sb_launch_flags) --profile default
    fi
  elif sb_sriov_active && ! sb_instance_has_profile "${zone}" sb-vf; then
    incus profile add "${zone}" sb-vf
  elif ! sb_sriov_active && sb_instance_has_profile "${zone}" sb-vf; then
    incus profile remove "${zone}" sb-vf
  fi

  read -r cpus memory < <(sb_zone_limits "${zone}")
  incus config set "${zone}" limits.cpu "${cpus}"
  incus config set "${zone}" limits.memory "${memory}"

  current_ip="$(incus config device get "${zone}" eth0 ipv4.address 2>/dev/null || true)"
  if [[ "${current_ip}" != "${ip_address}" ]]; then
    if sb_local_device_exists "${zone}" eth0; then
      incus config device set "${zone}" eth0 ipv4.address "${ip_address}"
    else
      incus config device override "${zone}" eth0 ipv4.address="${ip_address}"
    fi
    incus restart "${zone}"
  else
    incus start "${zone}" 2>/dev/null || true
  fi

  sb_wait_for_agent "${zone}"
  sb_container_exec "${zone}" bash -lc 'cloud-init status --wait >/dev/null 2>&1 || true'
}

sb_ensure_proxy() {
  local container="$1"
  local device="$2"
  local listen="$3"
  local connect="$4"

  if sb_local_device_exists "${container}" "${device}"; then
    incus config device set "${container}" "${device}" listen "${listen}"
    incus config device set "${container}" "${device}" connect "${connect}"
  else
    incus config device add "${container}" "${device}" proxy listen="${listen}" connect="${connect}"
  fi
}

sb_prepare_zone admin "${SB_IP_ADMIN}"
# nesting only takes effect on (re)start — restart before admin setup installs docker
if [[ "$(sb_tenant_mode)" == container && "$(incus config get admin security.nesting || true)" != "true" ]]; then
  incus config set admin security.nesting true
  incus restart admin
  sb_wait_for_agent admin
fi

sb_prepare_zone challenges "${SB_IP_CHALLENGES}"
sb_prepare_zone inference "${SB_IP_INFERENCE}"

mkdir -p "${SB_MODELS_DIR}"
# In container mode the host dir is uid-shifted and appears as nobody:nogroup
# inside the unprivileged container, so container-root cannot write the model
# cache. World-writable keeps it writable under both container (shifted) and VM
# (virtiofs root) tenant modes without a mode-specific device flag.
chmod 0777 "${SB_MODELS_DIR}"
if sb_local_device_exists inference models; then
  incus config device set inference models source "${SB_MODELS_DIR}"
  incus config device set inference models path /models
else
  incus config device add inference models disk source="${SB_MODELS_DIR}" path=/models
fi

for zone in admin challenges inference; do
  incus file push "${SB_REPO_ROOT}/config/speedbuild.env" "${zone}/etc/speedbuild.env"
  sb_push_tree "${zone}" "${SB_REPO_ROOT}/zones/${zone}" /opt/zone
done

sb_push_tree challenges "${SB_REPO_ROOT}/packages/bureau-api" /opt/packages/bureau-api
sb_push_tree challenges "${SB_REPO_ROOT}/packages/bureau-registry" /opt/packages/bureau-registry
sb_push_tree admin "${SB_REPO_ROOT}/packages/admin-dashboard" /opt/packages/admin-dashboard

for zone in admin challenges inference; do
  sb_log "Running ${zone} zone setup."
  sb_container_exec "${zone}" bash /opt/zone/setup.sh
done

sb_ensure_proxy admin dashboard tcp:0.0.0.0:8080 tcp:127.0.0.1:3000
sb_ensure_proxy admin asciinema tcp:0.0.0.0:4000 tcp:127.0.0.1:4000
sb_ensure_proxy challenges surfpool-rpc tcp:0.0.0.0:8899 tcp:127.0.0.1:8899
sb_ensure_proxy challenges surfpool-ws tcp:0.0.0.0:8900 tcp:127.0.0.1:8900

sb_done_marker 20-zones
sb_log "Zone setup complete."

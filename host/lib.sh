#!/usr/bin/env bash
set -euo pipefail

# Shared host-side helpers. Configuration is reloaded on every script run;
# marker files record successful completion without hiding later config changes.

SB_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SB_REPO_ROOT="$(cd "${SB_LIB_DIR}/.." && pwd)"
SB_MARKER_DIR=/var/lib/speedbuild/markers

sb_log() {
  printf '[speedbuild] %s\n' "$*"
}

sb_die() {
  printf '[speedbuild] ERROR: %s\n' "$*" >&2
  exit 1
}

sb_load_config() {
  local config_file="${SB_REPO_ROOT}/config/speedbuild.env"
  local key
  local -a required_keys=(
    SB_PARTICIPANT_COUNT
    SB_SSH_PORT_BASE
    SB_BRIDGE_NAME
    SB_SUBNET_PREFIX
    SB_ESTATE_SECRET
    SB_ADMIN_TOKEN
    SB_HOST_AGENT_TOKEN
    SB_ZPOOL_SIZE
    SB_MODELS_DIR
    SB_MODEL_HF_REPO
    SB_MODEL_QUANT
    SB_MODEL_ALIAS
    SB_LLAMA_THREADS
    SB_LLAMA_PARALLEL
    SB_LLAMA_CTX_TOTAL
    SB_INFER_CPUS
    SB_INFER_MEM
    SB_CHAL_CPUS
    SB_CHAL_MEM
    SB_ADMIN_CPUS
    SB_ADMIN_MEM
    SB_PART_CPUS
    SB_PART_MEM
    SB_PART_DISK
    SB_TENANT_MODE
    SB_SRIOV_ENABLE
    SB_SRIOV_VF_COUNT
    SB_SMOKE_TEST
  )

  [[ -f "${config_file}" ]] || sb_die "Missing ${config_file}; copy config/speedbuild.env.example and fill in the required secrets."

  set -a
  # shellcheck disable=SC1090
  source "${config_file}"
  set +a

  for key in "${required_keys[@]}"; do
    [[ -n "${!key:-}" ]] || sb_die "Required config key ${key} is blank or missing in ${config_file}."
  done

  [[ "${SB_PARTICIPANT_COUNT}" =~ ^[0-9]+$ ]] || sb_die "SB_PARTICIPANT_COUNT must be an integer."
  [[ "${SB_SSH_PORT_BASE}" =~ ^[0-9]+$ ]] || sb_die "SB_SSH_PORT_BASE must be an integer."
  [[ "${SB_TENANT_MODE}" == vm || "${SB_TENANT_MODE}" == container ]] || sb_die "SB_TENANT_MODE must be vm or container."
  [[ "${SB_SRIOV_ENABLE}" == 0 || "${SB_SRIOV_ENABLE}" == 1 ]] || sb_die "SB_SRIOV_ENABLE must be 0 or 1."
  [[ "${SB_SRIOV_VF_COUNT}" =~ ^[0-9]+$ ]] || sb_die "SB_SRIOV_VF_COUNT must be an integer."
  (( 10#${SB_SRIOV_VF_COUNT} > 0 )) || sb_die "SB_SRIOV_VF_COUNT must be greater than zero."
  [[ "${SB_SMOKE_TEST}" == 0 || "${SB_SMOKE_TEST}" == 1 ]] || sb_die "SB_SMOKE_TEST must be 0 or 1."

  SB_IP_HOST=10.61.0.1
  SB_IP_ADMIN=10.61.0.10
  SB_IP_CHALLENGES=10.61.0.20
  SB_IP_INFERENCE=10.61.0.30
  export SB_IP_HOST SB_IP_ADMIN SB_IP_CHALLENGES SB_IP_INFERENCE
}

sb_tenant_mode() {
  if [[ "${SB_SMOKE_TEST}" == 1 || "${SB_TENANT_MODE}" == container ]]; then
    printf 'container\n'
  else
    printf 'vm\n'
  fi
}

# Consume this helper with intentional word splitting: $(sb_launch_flags).
# Its output is either the single argument --vm or an empty string.
sb_launch_flags() {
  if [[ "$(sb_tenant_mode)" == vm ]]; then
    printf '%s\n' '--vm'
  else
    printf '\n'
  fi
}

sb_sriov_active() {
  [[ "${SB_SRIOV_ENABLE}" == 1 && "${SB_SMOKE_TEST}" != 1 ]]
}

# Host Ubuntu codename (noble, resolute, …), for apt suites that must match the
# host release. Zabbly publishes per-suite; picking the wrong one breaks apt.
sb_host_codename() {
  local codename=""
  if [[ -r /etc/os-release ]]; then
    codename="$(. /etc/os-release && printf '%s' "${VERSION_CODENAME:-}")"
  fi
  [[ -n "${codename}" ]] || codename="$(lsb_release -cs 2>/dev/null || true)"
  [[ -n "${codename}" ]] || sb_die "Could not determine the host Ubuntu codename from /etc/os-release."
  printf '%s\n' "${codename}"
}

sb_participant_ip() {
  local participant_number="${1:?participant number is required}"
  [[ "${participant_number}" =~ ^[0-9]+$ ]] || sb_die "Participant number must be an integer."
  printf '%s.%d\n' "${SB_SUBNET_PREFIX}" "$((100 + 10#${participant_number}))"
}

sb_participant_ssh_port() {
  local participant_number="${1:?participant number is required}"
  [[ "${participant_number}" =~ ^[0-9]+$ ]] || sb_die "Participant number must be an integer."
  printf '%d\n' "$((SB_SSH_PORT_BASE + 10#${participant_number}))"
}

sb_effective_participant_count() {
  if [[ "${SB_SMOKE_TEST}" == 1 ]]; then
    printf '2\n'
  else
    printf '%s\n' "${SB_PARTICIPANT_COUNT}"
  fi
}

sb_zone_limits() {
  local zone="${1:?zone name is required}"

  if [[ "${SB_SMOKE_TEST}" == 1 ]]; then
    case "${zone}" in
      inference) printf '8 16GiB\n' ;;
      challenges) printf '4 8GiB\n' ;;
      admin) printf '2 4GiB\n' ;;
      *) sb_die "Unknown zone for limits: ${zone}" ;;
    esac
    return
  fi

  case "${zone}" in
    inference) printf '%s %s\n' "${SB_INFER_CPUS}" "${SB_INFER_MEM}" ;;
    challenges) printf '%s %s\n' "${SB_CHAL_CPUS}" "${SB_CHAL_MEM}" ;;
    admin) printf '%s %s\n' "${SB_ADMIN_CPUS}" "${SB_ADMIN_MEM}" ;;
    *) sb_die "Unknown zone for limits: ${zone}" ;;
  esac
}

sb_marker() {
  local name="${1:?marker name is required}"
  [[ -f "${SB_MARKER_DIR}/${name}" ]]
}

sb_done_marker() {
  local name="${1:?marker name is required}"
  install -d -m 0755 "${SB_MARKER_DIR}"
  touch "${SB_MARKER_DIR}/${name}"
}

sb_wait_for() {
  local timeout_seconds="${1:?timeout in seconds is required}"
  local description="${2:?description is required}"
  local started_at=${SECONDS}
  shift 2

  [[ "${timeout_seconds}" =~ ^[0-9]+$ ]] || sb_die "Wait timeout must be an integer."
  (( $# > 0 )) || sb_die "sb_wait_for requires a command."

  sb_log "Waiting up to ${timeout_seconds}s for ${description}..."
  until "$@"; do
    if (( SECONDS - started_at >= timeout_seconds )); then
      sb_die "Timed out waiting for ${description}."
    fi
    sleep 2
  done
  sb_log "Ready: ${description}."
}

sb_wait_for_agent() {
  local instance="${1:?instance name is required}"
  sb_wait_for 180 "${instance} Incus agent" incus exec "${instance}" -- true
}

sb_container_exec() {
  local container="${1:?container name is required}"
  shift
  incus exec "${container}" -- "$@"
}

# Push the CONTENTS of a local directory into a container directory via a tar
# pipe: `incus file push -r` nests the source basename inside the target, and
# we also want build artifacts excluded.
sb_push_tree() {
  local container="${1:?container name is required}"
  local source_dir="${2:?source directory is required}"
  local destination="${3:?destination is required}"

  [[ -d "${source_dir}" ]] || sb_die "Required source directory does not exist: ${source_dir}"
  sb_container_exec "${container}" mkdir -p "${destination}"
  tar -C "${source_dir}" \
    --exclude ./node_modules --exclude './*/node_modules' \
    --exclude ./target --exclude ./.git \
    --exclude ./.svelte-kit --exclude ./dist \
    -cf - . | incus exec "${container}" -- tar -C "${destination}" -xf -
}

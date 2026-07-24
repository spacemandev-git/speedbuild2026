#!/usr/bin/env bash
set -euo pipefail

# Idempotency: this orchestrator delegates to independently rerunnable host
# steps; --only and --from make safe targeted reconciliation possible.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${REPO_ROOT}"

current_step=initialization
# shellcheck disable=SC2154
trap 'status=$?; printf "[speedbuild] ERROR: bootstrap failed during %s (command: %s, exit: %d). Fix the issue and rerun this step with --only %s.\n" "${current_step}" "${BASH_COMMAND}" "${status}" "${current_step}" >&2; exit "${status}"' ERR

if (( EUID != 0 )); then
  printf '[speedbuild] ERROR: bootstrap must run as root (use sudo ./bootstrap.sh).\n' >&2
  exit 1
fi

if [[ -f /var/lib/speedbuild/markers/needs-reboot ]]; then
  early_reboot_resume=0
  if (( $# == 2 )) && [[ "$1" == --from || "$1" == --only ]]; then
    case "$2" in
      12|sriov|12-sriov|12-sriov.sh|host/12-sriov.sh) early_reboot_resume=1 ;;
    esac
  fi
  if (( early_reboot_resume == 0 )); then
    printf '[speedbuild] ERROR: a reboot is pending from a previous step; reboot then rerun --from 12-sriov\n' >&2
    exit 1
  fi
fi

# (not cp -n: it exits non-zero when the target exists on coreutils >= 9.2)
if [[ ! -f config/speedbuild.env ]]; then
  cp config/speedbuild.env.example config/speedbuild.env
fi

set -a
# shellcheck disable=SC1091 # Runtime config is created from the checked example.
source config/speedbuild.env
set +a

blank_secrets=()
for secret_key in SB_BUREAU_SECRET SB_ADMIN_TOKEN SB_HOST_AGENT_TOKEN; do
  if [[ -z "${!secret_key:-}" ]]; then
    blank_secrets+=("${secret_key}")
  fi
done
if (( ${#blank_secrets[@]} > 0 )); then
  printf '[speedbuild] ERROR: fill in these required secrets in config/speedbuild.env: %s\n' "${blank_secrets[*]}" >&2
  printf '[speedbuild] Generate each value with: openssl rand -hex 32\n' >&2
  exit 1
fi
chmod 0600 config/speedbuild.env

# shellcheck source=host/lib.sh
source host/lib.sh
sb_load_config

steps=(
  host/00-base.sh
  host/10-incus.sh
  host/12-sriov.sh
  host/20-zones.sh
  host/30-participant-template.sh
  host/40-host-agent.sh
  host/50-deploy-challenges.sh
)

only_step=''
from_step=''

usage() {
  printf 'Usage: %s [--only <step> | --from <step>]\n' "$0"
  printf 'Steps: 00-base, 10-incus, 12-sriov, 20-zones, 30-participant-template, 40-host-agent, 50-deploy-challenges\n'
}

while (( $# > 0 )); do
  case "$1" in
    --only)
      (( $# >= 2 )) || sb_die '--only requires a step name.'
      only_step="$2"
      shift 2
      ;;
    --from)
      (( $# >= 2 )) || sb_die '--from requires a step name.'
      from_step="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      sb_die "Unknown argument: $1"
      ;;
  esac
done

[[ -z "${only_step}" || -z "${from_step}" ]] || sb_die '--only and --from are mutually exclusive.'

step_matches() {
  local requested="$1"
  local script="$2"
  local basename without_extension numeric_prefix short_name
  basename="${script##*/}"
  without_extension="${basename%.sh}"
  numeric_prefix="${without_extension%%-*}"
  short_name="${without_extension#*-}"
  [[ "${requested}" == "${script}" ||
     "${requested}" == "${basename}" ||
     "${requested}" == "${without_extension}" ||
     "${requested}" == "${numeric_prefix}" ||
     "${requested}" == "${short_name}" ]]
}

reboot_resume=0
if [[ -n "${only_step}" ]] && step_matches "${only_step}" host/12-sriov.sh; then
  reboot_resume=1
elif [[ -n "${from_step}" ]] && step_matches "${from_step}" host/12-sriov.sh; then
  reboot_resume=1
fi

if [[ -f "${SB_MARKER_DIR}/needs-reboot" ]] && (( reboot_resume == 0 )); then
  sb_die 'a reboot is pending from a previous step; reboot then rerun --from 12-sriov'
fi

run_step() {
  local script="$1"
  current_step="${script##*/}"
  "${REPO_ROOT}/${script}"

  if [[ -f "${SB_MARKER_DIR}/needs-reboot" ]]; then
    sb_log 'Bootstrap paused: reboot, then rerun sudo ./bootstrap.sh --from 12-sriov.'
    exit 0
  fi
}

if [[ -n "${only_step}" ]]; then
  found=0
  for script in "${steps[@]}"; do
    if step_matches "${only_step}" "${script}"; then
      found=1
      run_step "${script}"
      break
    fi
  done
  (( found == 1 )) || sb_die "Unknown step: ${only_step}"
elif [[ -n "${from_step}" ]]; then
  found=0
  for script in "${steps[@]}"; do
    if (( found == 0 )) && step_matches "${from_step}" "${script}"; then
      found=1
    fi
    if (( found == 1 )); then
      run_step "${script}"
    fi
  done
  (( found == 1 )) || sb_die "Unknown step: ${from_step}"
else
  for script in "${steps[@]}"; do
    run_step "${script}"
  done
fi

current_step=complete
sb_log 'Bootstrap complete.'

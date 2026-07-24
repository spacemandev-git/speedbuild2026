#!/usr/bin/env bash
# Bureau rebrand deploy — run as root on the speedbuild host.
# 1) deletes pre-rebrand smoke participants p01..p07 (operator-approved)
# 2) stops/disables the old executor-api.service in the challenges zone
# 3) re-runs bootstrap stages from 20-zones (zones, participant template,
#    host-agent, challenge deployment) against the freshly synced ~/speedbuild
set -uo pipefail

REPO=/home/ubuntu/speedbuild
log() { printf '\n[bureau-deploy %s] %s\n' "$(date +%H:%M:%S)" "$*"; }

log "step 1/3: delete smoke participants p01..p07 via host-agent"
set -a
# shellcheck disable=SC1091
source "${REPO}/config/speedbuild.env"
set +a
for n in 01 02 03 04 05 06 07; do
  code=$(curl -sS -X DELETE \
    -H "Authorization: Bearer ${SB_HOST_AGENT_TOKEN}" \
    -o /dev/null -w '%{http_code}' \
    "http://10.61.0.1:7000/participants/p$n" || echo fail)
  log "  p$n -> ${code}"
done
incus list -c ns -f csv | grep '^p' || true

log "step 2/3: stop old executor-api.service in challenges zone"
incus exec challenges -- systemctl stop executor-api.service 2>/dev/null || true
incus exec challenges -- systemctl disable executor-api.service 2>/dev/null || true
incus exec challenges -- rm -f /etc/systemd/system/executor-api.service || true
incus exec challenges -- systemctl daemon-reload || true

log "step 3/3: bootstrap --from 20-zones"
cd "${REPO}"
./bootstrap.sh --from 20-zones
rc=$?
log "bootstrap exited rc=${rc}"
exit "${rc}"

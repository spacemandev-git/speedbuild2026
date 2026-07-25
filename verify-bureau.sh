#!/usr/bin/env bash
# Post-deploy verification for the Bureau stack. Run on the speedbuild host:
#   bash /tmp/verify-bureau.sh 2>&1 | tee /tmp/bureau-verify.log
# Provisions two fresh operative boxes, reveals room1 to the first, and
# exercises every service surface. Never prints tokens or passwords.
set -uo pipefail
set -a
# shellcheck disable=SC1091
source "$HOME/speedbuild/config/speedbuild.env"
set +a
HA="http://10.61.0.1:7000"
ADMIN="http://10.61.0.20:8710"
PUB="http://10.61.0.20:8700"
ha()    { curl -sS -m 300 -H "Authorization: Bearer ${SB_HOST_AGENT_TOKEN}" "$@"; }
admin() { curl -sS -m 30  -H "Authorization: Bearer ${SB_ADMIN_TOKEN}" "$@"; }

echo "== zones health"
ha "${HA}/zones" | jq -r '.zones[]? // .[] | "\(.name // .zone): \(.status // .ok // .)"' 2>/dev/null || ha "${HA}/zones" | jq .

echo "== bureau-api health + locks"
admin "${ADMIN}/health" | jq .
admin "${ADMIN}/locks" | jq '{pool, lockCount: (.locks|length), first: .locks[0], fifth: .locks[4]}'

echo "== provision two operatives (passwords withheld from log)"
for i in 1 2; do
  ha -X POST -H "Content-Type: application/json" -d '{}' "${HA}/participants" \
    | jq '{name, operativeId, ip, sshPort, status, warnings}'
done

echo "== reveal room1 to p01 only"
ha -X POST -H "Content-Type: application/json" -d '{"room":"room1"}' "${HA}/participants/p01/reveal" \
  | jq '{name, operativeId, revealedRooms, warnings}'

echo "== brief endpoint: revealed operative gets params, unrevealed gets 404"
curl -sS -m 5 "${PUB}/brief/room1?operative=OPERATIVE-01" | jq .
curl -sS -m 5 -o /dev/null -w 'OPERATIVE-02 room1 -> HTTP %{http_code}\n' "${PUB}/brief/room1?operative=OPERATIVE-02"

echo "== inside p01: user, env, brief file"
incus exec p01 -- bash -lc 'id -un operative; grep -o "OPERATIVE_ID\|SOLANA_KEYPAIR" /home/operative/.bureau-env | sort -u; ls /home/operative/bureau/rooms/room1/'

echo "== admin state summary"
admin "${ADMIN}/state" | jq '{operatives: (.operatives|length), reveals: (.reveals|length), roomsComplete, lastEvents: [.recentEvents[-4:][] | .type]}'

echo "== VERIFY DONE"

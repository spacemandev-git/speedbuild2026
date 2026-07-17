#!/usr/bin/env bash
set -euo pipefail

ZONE_DIR=/opt/zone
RPC_URL=${RPC_URL:-http://127.0.0.1:8899}
ESTATE_DEPLOYER=${ESTATE_DEPLOYER:-/var/lib/estate/deployer.json}

if [[ ${1:-} == "--help" || ${1:-} == "-h" ]]; then
  cat <<'EOF'
Usage: /opt/zone/run-deploy.sh [claimants.json]

Installs deploy-package dependencies, ensures the SPL programs and SCRIP mint,
deploys/initializes estate_registry, seeds optional claimants and teams, then
starts executor-api. The default seed file is /var/lib/estate/claimants.json.
EOF
  exit 0
fi

if [[ ${EUID} -ne 0 ]]; then
  echo "run-deploy.sh must be run as root" >&2
  exit 1
fi

if [[ -f /etc/speedbuild.env ]]; then
  set -a
  # The config contract is shell-compatible KEY=VALUE.
  # shellcheck disable=SC1091
  source /etc/speedbuild.env
  set +a
fi

export RPC_URL ESTATE_DEPLOYER

for attempt in {1..30}; do
  if curl -fsS -X POST -H 'content-type: application/json' \
    --data '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' \
    "${RPC_URL}" | jq -e '.result == "ok"' >/dev/null; then
    break
  fi
  if [[ ${attempt} -eq 30 ]]; then
    echo "Surfpool did not become healthy at ${RPC_URL}" >&2
    exit 1
  fi
  sleep 2
done

cd "${ZONE_DIR}/deploy"
bun install
bun run src/00-ensure-spl.ts
bun run src/10-mint-scrip.ts
bun run src/20-deploy-registry.ts
bun run src/30-fund-and-seed.ts "${1:-/var/lib/estate/claimants.json}"

systemctl start executor-api.service
echo "Estate deployment complete; executor-api.service is started."

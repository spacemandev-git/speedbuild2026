#!/usr/bin/env bash
set -euo pipefail

SURFPOOL_VERSION=v1.5.0
ZONE_DIR=/opt/zone
RUSTUP_HOME=/opt/rustup
CARGO_HOME=/opt/cargo
SOLANA_INSTALL_DIR=/opt/solana
BUN_INSTALL=/opt/bun

if [[ ${EUID} -ne 0 ]]; then
  echo "setup.sh must be run as root" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
export RUSTUP_HOME CARGO_HOME SOLANA_INSTALL_DIR BUN_INSTALL
export PATH="${BUN_INSTALL}/bin:${CARGO_HOME}/bin:${SOLANA_INSTALL_DIR}/active_release/bin:${PATH}"

apt-get update
apt-get install -y --no-install-recommends \
  build-essential \
  ca-certificates \
  curl \
  git \
  jq \
  libssl-dev \
  libudev-dev \
  pkg-config \
  unzip

if [[ ! -x ${BUN_INSTALL}/bin/bun ]]; then
  curl -fsSL https://bun.sh/install | bash
fi
ln -sfn "${BUN_INSTALL}/bin/bun" /usr/local/bin/bun

curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y --no-install-recommends nodejs
if [[ $(node --version) != v22.* ]]; then
  echo "NodeSource installation did not provide Node 22" >&2
  exit 1
fi

if [[ ! -x ${CARGO_HOME}/bin/rustup ]]; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
    | sh -s -- -y --no-modify-path --default-toolchain stable
fi
"${CARGO_HOME}/bin/rustup" default stable

if [[ ! -x ${SOLANA_INSTALL_DIR}/active_release/bin/solana ]]; then
  mkdir -p "${SOLANA_INSTALL_DIR}"
  curl --proto '=https' --tlsv1.2 -sSfL https://release.anza.xyz/stable/install | sh
  if [[ ! -x ${SOLANA_INSTALL_DIR}/active_release/bin/solana ]]; then
    agave_default_release=/root/.local/share/solana/install/active_release
    if [[ ! -x ${agave_default_release}/bin/solana ]]; then
      echo "Agave installer completed but its active release could not be located" >&2
      exit 1
    fi
    mkdir -p "${SOLANA_INSTALL_DIR}/active_release"
    cp -a "${agave_default_release}/." "${SOLANA_INSTALL_DIR}/active_release/"
  fi
fi
"${SOLANA_INSTALL_DIR}/active_release/bin/solana" --version
ln -sfn "${SOLANA_INSTALL_DIR}/active_release/bin/solana" /usr/local/bin/solana
ln -sfn "${SOLANA_INSTALL_DIR}/active_release/bin/solana-keygen" /usr/local/bin/solana-keygen

cat >/etc/profile.d/speedbuild-chain.sh <<'EOF'
export RUSTUP_HOME=/opt/rustup
export CARGO_HOME=/opt/cargo
export SOLANA_INSTALL_DIR=/opt/solana
export BUN_INSTALL=/opt/bun
export PATH="/opt/bun/bin:/opt/cargo/bin:/opt/solana/active_release/bin:$PATH"
EOF
chmod 0644 /etc/profile.d/speedbuild-chain.sh

# Install Anchor directly from its pinned git tag with Cargo. This avoids a
# per-user AVM installation and gives system services one stable binary path.
if [[ ! -x ${CARGO_HOME}/bin/anchor ]] \
  || ! "${CARGO_HOME}/bin/anchor" --version 2>/dev/null | grep -q '1\.1\.2'; then
  "${CARGO_HOME}/bin/cargo" install \
    --git https://github.com/coral-xyz/anchor \
    --tag v1.1.2 \
    anchor-cli \
    --locked \
    --force
fi
ln -sfn "${CARGO_HOME}/bin/anchor" /usr/local/bin/anchor

if ! command -v surfpool >/dev/null 2>&1 \
  || ! surfpool --version 2>/dev/null | grep -q "${SURFPOOL_VERSION#v}"; then
  surfpool_tmp=$(mktemp -d)
  trap 'rm -rf -- "${surfpool_tmp}"' EXIT
  surfpool_archive="${surfpool_tmp}/surfpool-linux-x64.tar.gz"
  curl -fL \
    "https://github.com/solana-foundation/surfpool/releases/download/${SURFPOOL_VERSION}/surfpool-linux-x64.tar.gz" \
    -o "${surfpool_archive}"
  tar -xzf "${surfpool_archive}" -C "${surfpool_tmp}"
  surfpool_binary=$(find "${surfpool_tmp}" -type f -name surfpool -print -quit)
  if [[ -z ${surfpool_binary} ]]; then
    echo "surfpool archive did not contain an executable named 'surfpool'" >&2
    exit 1
  fi
  install -m 0755 "${surfpool_binary}" /usr/local/bin/surfpool
  rm -rf -- "${surfpool_tmp}"
  trap - EXIT
fi
surfpool --version

mkdir -p /var/lib/surfpool /var/lib/estate /var/lib/executor
chmod 0700 /var/lib/estate
if [[ ! -s /var/lib/estate/deployer.json ]]; then
  solana-keygen new \
    --no-bip39-passphrase \
    --silent \
    --force \
    -o /var/lib/estate/deployer.json
fi
chmod 0600 /var/lib/estate/deployer.json

install -m 0644 "${ZONE_DIR}/surfpool.service" /etc/systemd/system/surfpool.service
install -m 0644 "${ZONE_DIR}/executor-api.service" /etc/systemd/system/executor-api.service
systemctl daemon-reload
systemctl enable --now surfpool.service
systemctl enable executor-api.service

cd /opt/packages/executor-api
bun install

cd "${ZONE_DIR}/deploy"
bun install

echo "Challenges zone setup complete. Run ${ZONE_DIR}/run-deploy.sh to deploy and seed the estate."

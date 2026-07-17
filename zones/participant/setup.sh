#!/usr/bin/env bash
set -euo pipefail

NODE_MAJOR=22
ANCHOR_VERSION=1.1.2
ASCIINEMA_VERSION=3.2.0
AGAVE_CHANNEL=stable

RUSTUP_HOME=/opt/rustup
CARGO_HOME=/opt/cargo
ANCHOR_HOME=/opt/anchor
BUN_INSTALL=/opt/bun
export RUSTUP_HOME CARGO_HOME BUN_INSTALL
export PATH="/opt/anchor/bin:/opt/solana/bin:/opt/cargo/bin:/usr/local/bin:$PATH"

if [[ $EUID -ne 0 ]]; then
  echo "setup.sh must run as root" >&2
  exit 1
fi

if [[ ! -r /etc/speedbuild.env ]]; then
  echo "/etc/speedbuild.env is missing or unreadable" >&2
  exit 1
fi

# shellcheck source=/dev/null
source /etc/speedbuild.env
: "${SB_MODEL_ALIAS:?SB_MODEL_ALIAS must be set}"
: "${SB_LLAMA_CTX_TOTAL:?SB_LLAMA_CTX_TOTAL must be set}"
: "${SB_LLAMA_PARALLEL:?SB_LLAMA_PARALLEL must be set}"
if (( SB_LLAMA_PARALLEL <= 0 )); then
  echo "SB_LLAMA_PARALLEL must be greater than zero" >&2
  exit 1
fi
SB_OPENCODE_CTX=$((SB_LLAMA_CTX_TOTAL / SB_LLAMA_PARALLEL))
export SB_MODEL_ALIAS SB_OPENCODE_CTX

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
WORK_DIR=$(mktemp -d)
cleanup() {
  rm -rf -- "$WORK_DIR"
}
trap cleanup EXIT

install_managed_file() {
  local source_file=$1
  local destination=$2
  local mode=$3
  local owner=$4
  local group=$5

  if [[ ! -f $destination ]] || ! cmp -s -- "$source_file" "$destination"; then
    install -o "$owner" -g "$group" -m "$mode" "$source_file" "$destination"
  else
    chown "$owner:$group" "$destination"
    chmod "$mode" "$destination"
  fi
}

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends \
  build-essential \
  git \
  jq \
  curl \
  unzip \
  pkg-config \
  libssl-dev \
  libudev-dev \
  python3 \
  ca-certificates \
  openssh-server \
  vim \
  nano \
  tmux \
  gettext-base \
  gnupg

if ! command -v node >/dev/null 2>&1 \
  || [[ $(node --version) != v${NODE_MAJOR}.* ]]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y --no-install-recommends nodejs
fi

if [[ ! -x /usr/local/bin/bun ]]; then
  curl -fsSL https://bun.sh/install | bash
  install -m 0755 "$BUN_INSTALL/bin/bun" /usr/local/bin/bun
fi

if [[ ! -x "$CARGO_HOME/bin/rustup" ]]; then
  curl --proto '=https' --tlsv1.2 -fsSL https://sh.rustup.rs \
    | sh -s -- -y --no-modify-path --profile minimal --default-toolchain stable
fi
"$CARGO_HOME/bin/rustup" toolchain install stable --profile minimal
"$CARGO_HOME/bin/rustup" default stable

if [[ ! -x /opt/solana/bin/solana ]]; then
  agave_home="$WORK_DIR/agave-home"
  mkdir -p "$agave_home"
  HOME="$agave_home" sh -c \
    "$(curl -fsSL "https://release.anza.xyz/${AGAVE_CHANNEL}/install")"
  agave_release=$(readlink -f \
    "$agave_home/.local/share/solana/install/active_release")
  if [[ ! -d $agave_release ]]; then
    echo "Agave installer did not produce an active release" >&2
    exit 1
  fi
  mv "$agave_release" /opt/solana
fi

# Use the allowed direct anchor-cli fallback instead of AVM for a reproducible system install.
if [[ ! -x "$ANCHOR_HOME/bin/anchor" ]] \
  || ! "$ANCHOR_HOME/bin/anchor" --version | grep -Fq "$ANCHOR_VERSION"; then
  "$CARGO_HOME/bin/cargo" install --locked anchor-cli \
    --version "$ANCHOR_VERSION" --root "$ANCHOR_HOME" --force
fi

if ! command -v spl-token >/dev/null 2>&1; then
  "$CARGO_HOME/bin/cargo" install --locked spl-token-cli
fi

if ! command -v pay >/dev/null 2>&1; then
  npm install -g @solana/pay
fi

# Release 3.2.0 provides this static musl executable directly (not as an archive).
if [[ ! -x /usr/local/bin/asciinema ]] \
  || ! /usr/local/bin/asciinema --version | grep -Fq "$ASCIINEMA_VERSION"; then
  curl -fsSL \
    "https://github.com/asciinema/asciinema/releases/download/v${ASCIINEMA_VERSION}/asciinema-x86_64-unknown-linux-musl" \
    -o "$WORK_DIR/asciinema"
  install -m 0755 "$WORK_DIR/asciinema" /usr/local/bin/asciinema
fi

if [[ ! -x /usr/local/bin/opencode ]]; then
  export OPENCODE_INSTALL_DIR=/usr/local/bin
  curl -fsSL https://opencode.ai/install | bash
  unset OPENCODE_INSTALL_DIR
fi

cat >"$WORK_DIR/estate-path.sh" <<'EOF'
# System-wide Speedbuild participant toolchain.
export PATH="/opt/anchor/bin:/opt/solana/bin:/opt/cargo/bin:/usr/local/bin:$PATH"
EOF
install_managed_file "$WORK_DIR/estate-path.sh" /etc/profile.d/estate-path.sh 0644 root root

if [[ ! -s "$SCRIPT_DIR/rec-shell" ]]; then
  echo "$SCRIPT_DIR/rec-shell is missing or empty" >&2
  exit 1
fi
install_managed_file "$SCRIPT_DIR/rec-shell" /usr/local/bin/rec-shell 0755 root root
if ! grep -Fxq /usr/local/bin/rec-shell /etc/shells; then
  echo /usr/local/bin/rec-shell >>/etc/shells
fi

if ! id claimant >/dev/null 2>&1; then
  useradd --create-home --shell /usr/local/bin/rec-shell claimant
else
  usermod --shell /usr/local/bin/rec-shell claimant
fi

install -d -o claimant -g claimant -m 0755 \
  /home/claimant/estate \
  /home/claimant/estate/rooms \
  /home/claimant/.config/asciinema \
  /home/claimant/.config/solana/cli \
  /home/claimant/.config/opencode
install -d -o root -g root -m 1777 /var/log/sessions

cat >"$WORK_DIR/asciinema-config.toml" <<'EOF'
[server]
url = "http://10.61.0.10:4000"
EOF
install_managed_file "$WORK_DIR/asciinema-config.toml" \
  /home/claimant/.config/asciinema/config.toml 0644 claimant claimant

cat >"$WORK_DIR/solana-config.yml" <<'EOF'
json_rpc_url: http://10.61.0.20:8899
websocket_url: ws://10.61.0.20:8900
keypair_path: /home/claimant/.config/solana/id.json
EOF
install_managed_file "$WORK_DIR/solana-config.yml" \
  /home/claimant/.config/solana/cli/config.yml 0600 claimant claimant

if [[ ! -s "$SCRIPT_DIR/opencode.json.template" ]]; then
  echo "$SCRIPT_DIR/opencode.json.template is missing or empty" >&2
  exit 1
fi
# Only these two SB_ variables may be expanded; the OpenCode {env:...} token must survive.
# shellcheck disable=SC2016
envsubst '$SB_MODEL_ALIAS $SB_OPENCODE_CTX' \
  <"$SCRIPT_DIR/opencode.json.template" >"$WORK_DIR/opencode.json"
jq -e . "$WORK_DIR/opencode.json" >/dev/null
install_managed_file "$WORK_DIR/opencode.json" \
  /home/claimant/.config/opencode/opencode.json 0600 claimant claimant

cat >"$WORK_DIR/estate-readme.md" <<'EOF'
# Welcome to the Estate

Challenge rooms appear under `~/estate/rooms/` as they are revealed.

The Solana RPC endpoint is `http://10.61.0.20:8899`.

OpenCode is preconfigured for the Estate inference service. Run `opencode` here to start.

Interactive terminal sessions are recorded for competition administration.
EOF
install_managed_file "$WORK_DIR/estate-readme.md" \
  /home/claimant/estate/README.md 0644 claimant claimant

touch /home/claimant/.profile
if ! grep -Fq '# Speedbuild estate environment' /home/claimant/.profile; then
  cat >>/home/claimant/.profile <<'EOF'

# Speedbuild estate environment (written later by the host agent).
if [ -f "$HOME/.estate-env" ]; then
  . "$HOME/.estate-env"
fi
EOF
fi
chown claimant:claimant /home/claimant/.profile
chmod 0644 /home/claimant/.profile

cat >"$WORK_DIR/estate-sshd.conf" <<'EOF'
Match User claimant
    PasswordAuthentication yes
Match all
EOF
install_managed_file "$WORK_DIR/estate-sshd.conf" \
  /etc/ssh/sshd_config.d/estate.conf 0644 root root
# sshd -t (and sshd itself) needs the privilege-separation dir, which is not
# yet populated in a freshly configured container that has not booted ssh.
install -d -m 0755 /run/sshd
sshd -t
systemctl enable ssh
systemctl restart ssh

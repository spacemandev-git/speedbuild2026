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
  curl -fsSL https://opencode.ai/install | bash
  # The installer places the binary under /root/.opencode/bin regardless of
  # OPENCODE_INSTALL_DIR (and /root is unreadable by operative); publish the
  # self-contained binary to a system path every user can execute.
  for cand in /root/.opencode/bin/opencode "$HOME/.opencode/bin/opencode"; do
    if [[ -x "$cand" ]]; then
      install -m 0755 "$cand" /usr/local/bin/opencode
      break
    fi
  done
  command -v opencode >/dev/null || { echo "opencode install failed" >&2; exit 1; }
fi

# The OpenCode installer (curl | bash) clears /tmp on a fresh install, which can
# delete our mktemp WORK_DIR; recreate it before writing staged config files.
mkdir -p "$WORK_DIR"

cat >"$WORK_DIR/bureau-path.sh" <<'EOF'
# System-wide Speedbuild participant toolchain.
# RUSTUP_HOME/CARGO_HOME must be exported for every user or rustup cannot find
# the system-installed default toolchain (cargo/rustc fail with "no default
# toolchain configured"), which breaks `anchor build`/`cargo build`.
export RUSTUP_HOME=/opt/rustup
export CARGO_HOME=/opt/cargo
export PATH="/opt/anchor/bin:/opt/solana/bin:/opt/cargo/bin:/usr/local/bin:$PATH"
EOF
install_managed_file "$WORK_DIR/bureau-path.sh" /etc/profile.d/bureau-path.sh 0644 root root

# profile.d only applies to login shells. OpenCode's bash tool (and any other
# non-login child) needs the toolchain on PATH too, so also set it in
# /etc/environment, which PAM loads for every session type. RUSTUP_HOME/CARGO_HOME
# go here as well so cargo/anchor work from those non-login contexts.
cat >"$WORK_DIR/environment" <<'EOF'
PATH="/opt/anchor/bin:/opt/solana/bin:/opt/cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
RUSTUP_HOME="/opt/rustup"
CARGO_HOME="/opt/cargo"
EOF
install_managed_file "$WORK_DIR/environment" /etc/environment 0644 root root

# Login banner. pam_motd prints /etc/motd for every ssh session on Ubuntu, so no
# sshd_config change is needed.
cat >"$WORK_DIR/motd" <<'EOF'

  BUREAU OPERATIVE WORKSTATION -- authorized personnel only.

  Run  opencode  to start your AI coding agent. It is already configured:
  no login, no API key, no setup. Start it from  ~/bureau .

  Read  ~/PLAYERS_GUIDE.md  first. It covers this box, your wallet and tools.
  Room briefs land in  ~/bureau/rooms/  as they are revealed to you.
  Your funded Solana keypair is at  ~/.config/solana/id.json .

  This terminal is recorded. The Bureau thanks you for your cooperation.

EOF
install_managed_file "$WORK_DIR/motd" /etc/motd 0644 root root

# Ubuntu's dynamic motd fragments would bury the banner above. Disabling the
# noisy ones is idempotent and safe when a fragment is absent.
for motd_fragment in \
  /etc/update-motd.d/00-header \
  /etc/update-motd.d/10-help-text \
  /etc/update-motd.d/50-motd-news; do
  [[ -e $motd_fragment ]] && chmod -x "$motd_fragment" 2>/dev/null || true
done

if [[ ! -s "$SCRIPT_DIR/rec-shell" ]]; then
  echo "$SCRIPT_DIR/rec-shell is missing or empty" >&2
  exit 1
fi
install_managed_file "$SCRIPT_DIR/rec-shell" /usr/local/bin/rec-shell 0755 root root
if ! grep -Fxq /usr/local/bin/rec-shell /etc/shells; then
  echo /usr/local/bin/rec-shell >>/etc/shells
fi

if ! id operative >/dev/null 2>&1; then
  useradd --create-home --shell /usr/local/bin/rec-shell operative
else
  usermod --shell /usr/local/bin/rec-shell operative
fi

install -d -o operative -g operative -m 0755 \
  /home/operative/bureau \
  /home/operative/bureau/rooms \
  /home/operative/.config/asciinema \
  /home/operative/.config/solana/cli \
  /home/operative/.config/opencode
install -d -o root -g root -m 1777 /var/log/sessions

cat >"$WORK_DIR/asciinema-config.toml" <<'EOF'
[server]
url = "http://10.61.0.10:4000"
EOF
install_managed_file "$WORK_DIR/asciinema-config.toml" \
  /home/operative/.config/asciinema/config.toml 0644 operative operative

cat >"$WORK_DIR/solana-config.yml" <<'EOF'
json_rpc_url: http://10.61.0.20:8899
websocket_url: ws://10.61.0.20:8900
keypair_path: /home/operative/.config/solana/id.json
EOF
install_managed_file "$WORK_DIR/solana-config.yml" \
  /home/operative/.config/solana/cli/config.yml 0600 operative operative

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
  /home/operative/.config/opencode/opencode.json 0600 operative operative

cat >"$WORK_DIR/bureau-readme.md" <<'EOF'
# Speed Build workspace

Room briefs appear under `~/bureau/rooms/` as they are revealed. OpenCode is preconfigured for the Bureau inference service; run `opencode` here.
First login? Start with `~/PLAYERS_GUIDE.md` — the practical guide to your box and tools.
EOF
install_managed_file "$WORK_DIR/bureau-readme.md" \
  /home/operative/bureau/README.md 0644 operative operative

touch /home/operative/.profile
if ! grep -Fq '# Speedbuild bureau environment' /home/operative/.profile; then
  cat >>/home/operative/.profile <<'EOF'

# Speedbuild bureau environment
if [ -f "$HOME/.bureau-env" ]; then
  . "$HOME/.bureau-env"
fi
EOF
fi
chown operative:operative /home/operative/.profile
chmod 0644 /home/operative/.profile

cat >"$WORK_DIR/bureau-sshd.conf" <<'EOF'
Match User operative
    PasswordAuthentication yes
Match all
EOF
install_managed_file "$WORK_DIR/bureau-sshd.conf" \
  /etc/ssh/sshd_config.d/bureau.conf 0644 root root
# sshd -t (and sshd itself) needs the privilege-separation dir, which is not
# yet populated in a freshly configured container that has not booted ssh.
install -d -m 0755 /run/sshd
sshd -t
systemctl enable ssh
systemctl restart ssh

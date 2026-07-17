#!/usr/bin/env bash
set -euo pipefail

# Pin this to a release tag or commit after the first successful 2026 build.
LLAMACPP_REF="${LLAMACPP_REF:-master}"

export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y --no-install-recommends \
  build-essential \
  ca-certificates \
  cmake \
  curl \
  gettext-base \
  git \
  jq \
  libcurl4-openssl-dev \
  openssl \
  pipx \
  python3-pip

# Install hf in a system-wide pipx location so root-run services/scripts find it.
if ! command -v hf >/dev/null 2>&1; then
  PIPX_HOME=/opt/pipx PIPX_BIN_DIR=/usr/local/bin \
    pipx install "huggingface_hub[cli]"
fi

llama_dir=/opt/llama.cpp
build_marker="${llama_dir}/build/.speedbuild-ref"

if [[ -x "${llama_dir}/build/bin/llama-server" ]] \
  && [[ -f "$build_marker" ]] \
  && [[ "$(<"$build_marker")" == "$LLAMACPP_REF" ]]; then
  echo "llama.cpp build for ${LLAMACPP_REF} already exists; skipping build"
else
  if [[ ! -d "${llama_dir}/.git" ]]; then
    if [[ -e "$llama_dir" ]]; then
      echo "error: ${llama_dir} exists but is not a git checkout" >&2
      exit 1
    fi
    git clone https://github.com/ggerganov/llama.cpp.git "$llama_dir"
  fi

  git -C "$llama_dir" fetch --prune --tags origin
  if git -C "$llama_dir" rev-parse --verify --quiet \
    "refs/remotes/origin/${LLAMACPP_REF}^{commit}" >/dev/null; then
    git -C "$llama_dir" checkout --detach "origin/${LLAMACPP_REF}"
  else
    git -C "$llama_dir" checkout --detach "$LLAMACPP_REF"
  fi

  (
    cd "$llama_dir"
    cmake -B build -DBUILD_SHARED_LIBS=OFF -DGGML_NATIVE=ON
    cmake --build build --config Release -j --target llama-server llama-cli
  )
  printf '%s\n' "$LLAMACPP_REF" >"$build_marker"
fi

install -d -m 0755 /etc/llama
if [[ ! -e /etc/llama/api-keys.txt ]]; then
  keys_tmp="$(mktemp /etc/llama/api-keys.txt.XXXXXX)"
  chmod 0600 "$keys_tmp"
  for ((key_number = 1; key_number <= 64; key_number++)); do
    printf 'sb-%s\n' "$(openssl rand -hex 16)" >>"$keys_tmp"
  done
  mv "$keys_tmp" /etc/llama/api-keys.txt
fi
chmod 0600 /etc/llama/api-keys.txt

if [[ ! -f /etc/speedbuild.env ]]; then
  echo "error: /etc/speedbuild.env is missing" >&2
  exit 1
fi

set -a
# shellcheck source=/dev/null
source /etc/speedbuild.env
set +a

bash /opt/zone/download-model.sh

if [[ ! -s /models/ACTIVE_MODEL ]]; then
  echo "error: /models/ACTIVE_MODEL was not written" >&2
  exit 1
fi
MODEL_PATH="$(</models/ACTIVE_MODEL)"
if [[ ! -s "$MODEL_PATH" ]]; then
  echo "error: active model does not exist or is empty: ${MODEL_PATH}" >&2
  exit 1
fi

: "${SB_MODEL_ALIAS:?SB_MODEL_ALIAS must be set in /etc/speedbuild.env}"
if [[ "${SB_SMOKE_TEST:-0}" == "1" ]]; then
  SB_LLAMA_THREADS=4
  SB_LLAMA_CTX_TOTAL=16384
  SB_LLAMA_PARALLEL=2
else
  : "${SB_LLAMA_THREADS:?SB_LLAMA_THREADS must be set in /etc/speedbuild.env}"
  : "${SB_LLAMA_CTX_TOTAL:?SB_LLAMA_CTX_TOTAL must be set in /etc/speedbuild.env}"
  : "${SB_LLAMA_PARALLEL:?SB_LLAMA_PARALLEL must be set in /etc/speedbuild.env}"
fi
export MODEL_PATH SB_MODEL_ALIAS SB_LLAMA_THREADS SB_LLAMA_CTX_TOTAL SB_LLAMA_PARALLEL

unit_tmp="$(mktemp /tmp/llama-server.service.XXXXXX)"
envsubst "\${MODEL_PATH} \${SB_MODEL_ALIAS} \${SB_LLAMA_THREADS} \${SB_LLAMA_CTX_TOTAL} \${SB_LLAMA_PARALLEL}" \
  </opt/zone/llama-server.service.template >"$unit_tmp"
install -m 0644 "$unit_tmp" /etc/systemd/system/llama-server.service
rm -f "$unit_tmp"

install -m 0755 /dev/stdin /usr/local/bin/llama-health <<'HEALTH_HELPER'
#!/usr/bin/env bash
set -euo pipefail

api_key="$(sed -n '1p' /etc/llama/api-keys.txt)"
exit_status=0

for endpoint in health slots; do
  printf '%s:\n' "$endpoint"
  if ! curl -fsS \
    -H "Authorization: Bearer ${api_key}" \
    "http://localhost:8080/${endpoint}"; then
    exit_status=1
  fi
  printf '\n'
done

exit "$exit_status"
HEALTH_HELPER

systemctl daemon-reload
systemctl enable llama-server.service
systemctl restart llama-server.service

echo "Inference setup complete; active model: ${MODEL_PATH}"

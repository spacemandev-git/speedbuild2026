#!/usr/bin/env bash
set -euo pipefail

if [[ ! -f /etc/speedbuild.env ]]; then
  echo "error: /etc/speedbuild.env is missing" >&2
  exit 1
fi

# shellcheck source=/dev/null
source /etc/speedbuild.env

# /models is a host-mounted disk device (the container may not own the mount
# root to re-mode it); just ensure it exists, never chmod it.
mkdir -p /models

model_files=()

refresh_model_files() {
  mapfile -d '' -t model_files < <(
    find "$model_dir" -type f -name "$model_pattern" -print0 | LC_ALL=C sort -z
  )
}

model_files_are_complete() {
  ((${#model_files[@]} > 0)) || return 1

  local file name
  local shard_count=0
  local expected_shards=0
  local current_total

  for file in "${model_files[@]}"; do
    [[ -s "$file" ]] || return 1
    name="$(basename "$file")"
    if [[ "$name" =~ -([0-9]{5})-of-([0-9]{5})\.gguf$ ]]; then
      current_total=$((10#${BASH_REMATCH[2]}))
      if ((expected_shards != 0 && expected_shards != current_total)); then
        return 1
      fi
      expected_shards=$current_total
      ((shard_count += 1))
    fi
  done

  if ((shard_count > 0)); then
    ((shard_count == expected_shards && shard_count == ${#model_files[@]})) || return 1
  fi
}

if [[ "${SB_SMOKE_TEST:-0}" == "1" ]]; then
  model_repo=Qwen/Qwen2.5-0.5B-Instruct-GGUF
  smoke_file=qwen2.5-0.5b-instruct-q4_k_m.gguf
  model_dir=/models/smoke
  model_pattern="$smoke_file"
  install -d -m 0755 "$model_dir"

  refresh_model_files
  if model_files_are_complete; then
    echo "Smoke model already present; skipping download"
  else
    hf download "$model_repo" "$smoke_file" --local-dir "$model_dir"
  fi
else
  : "${SB_MODEL_HF_REPO:?SB_MODEL_HF_REPO must be set in /etc/speedbuild.env}"
  : "${SB_MODEL_QUANT:?SB_MODEL_QUANT must be set in /etc/speedbuild.env}"

  model_repo="$SB_MODEL_HF_REPO"
  model_dir="/models/$(basename "$model_repo")"
  model_pattern="*${SB_MODEL_QUANT}*.gguf"
  install -d -m 0755 "$model_dir"

  refresh_model_files
  if model_files_are_complete; then
    echo "Model files already present; skipping download"
  else
    hf download "$model_repo" \
      --include "*${SB_MODEL_QUANT}*" \
      --local-dir "$model_dir"
  fi
fi

refresh_model_files
if ! model_files_are_complete; then
  echo "error: no complete, non-empty GGUF model set found in ${model_dir}" >&2
  exit 1
fi

primary_model=
for model_file in "${model_files[@]}"; do
  if [[ "$(basename "$model_file")" =~ -00001-of-[0-9]{5}\.gguf$ ]]; then
    primary_model="$model_file"
    break
  fi
done
if [[ -z "$primary_model" ]]; then
  primary_model="${model_files[0]}"
fi

printf '%s\n' "$primary_model" >/models/ACTIVE_MODEL
printf '%s\n' "$primary_model"

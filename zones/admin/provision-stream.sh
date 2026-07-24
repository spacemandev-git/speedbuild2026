#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: provision-stream.sh [--dry-run] <username>" >&2
}

dry_run=0
if [[ ${1:-} == "--dry-run" ]]; then
  dry_run=1
  shift
fi

if [[ $# -ne 1 ]]; then
  usage
  exit 2
fi

username=$1
if [[ ! ${username} =~ ^[a-z0-9][a-z0-9-]{0,31}$ ]]; then
  echo "provision-stream: username must match [a-z0-9][a-z0-9-]{0,31}" >&2
  exit 2
fi

if ! command -v uuidgen >/dev/null 2>&1; then
  echo "provision-stream: uuidgen is unavailable (install uuid-runtime)" >&2
  exit 1
fi

install_id=$(uuidgen | tr 'A-F' 'a-f')
compose_file=/opt/asciinema/docker-compose.yml
server_service=asciinema
release=/opt/app/bin/asciinema

primary_rpc=$(cat <<EOF
{:ok, u} = Asciinema.Accounts.create_user(%{username: "${username}", email: "${username}@bureau.local"})
{:ok, _} = Asciinema.Accounts.claim_cli(u, "${install_id}")
{:ok, s} = Asciinema.Streaming.create_stream(u, %{visibility: :unlisted})
IO.puts(s.public_token <> " " <> s.producer_token)
EOF
)

fallback_rpc=$(cat <<EOF
case Asciinema.Accounts.create_user(%{username: "${username}", email: "${username}@bureau.local"}) do
  {:ok, u} ->
    {:ok, _} = Asciinema.Accounts.claim_cli(u, "${install_id}")
    {:ok, s} = Asciinema.Streaming.create_stream(u, %{visibility: :unlisted})
    IO.puts(s.public_token <> " " <> s.producer_token)
  {:error, _} ->
    u = Asciinema.Repo.get_by!(Asciinema.Accounts.User, username: "${username}")
    {:ok, _} = Asciinema.Accounts.claim_cli(u, "${install_id}")
    s = Asciinema.Repo.get_by(Asciinema.Streaming.Stream, user_id: u.id) || elem(Asciinema.Streaming.create_stream(u, %{visibility: :unlisted}), 1)
    IO.puts(s.public_token <> " " <> s.producer_token)
end
EOF
)

print_command() {
  local code=$1
  printf "docker compose -f %s exec -T %s %s rpc '%s'\n" \
    "${compose_file}" "${server_service}" "${release}" "${code}"
}

if (( dry_run )); then
  echo "# primary RPC"
  print_command "${primary_rpc}"
  echo "# existing-user fallback RPC"
  print_command "${fallback_rpc}"
  exit 0
fi

run_rpc() {
  local code=$1
  docker compose -f "${compose_file}" exec -T "${server_service}" "${release}" rpc "${code}"
}

rpc_output=''
if ! rpc_output=$(run_rpc "${primary_rpc}" 2>&1); then
  echo "provision-stream: initial create failed; trying existing-user lookup" >&2
  printf '%s\n' "${rpc_output}" >&2
  if ! rpc_output=$(run_rpc "${fallback_rpc}" 2>&1); then
    echo "provision-stream: asciinema RPC failed for ${username}" >&2
    printf '%s\n' "${rpc_output}" >&2
    exit 1
  fi
fi

token_line=$(printf '%s\n' "${rpc_output}" | awk 'NF { line = $0 } END { print line }')
read -r public_token producer_token extra <<<"${token_line}"
if [[ ! ${public_token:-} =~ ^[[:alnum:]]{16}$ ]] \
  || [[ ! ${producer_token:-} =~ ^[[:alnum:]]{16}$ ]] \
  || [[ -n ${extra:-} ]]; then
  echo "provision-stream: RPC returned an invalid token line for ${username}: ${token_line}" >&2
  exit 1
fi

printf '%s %s %s\n' "${install_id}" "${public_token}" "${producer_token}"

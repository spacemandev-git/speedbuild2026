#!/usr/bin/env bash
set -euo pipefail

# Idempotency: repository files and profile settings are reconciled on every
# run; Incus preseed runs only when the managed default-profile marker is absent.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=host/lib.sh
source "${SCRIPT_DIR}/lib.sh"
sb_load_config

export DEBIAN_FRONTEND=noninteractive
install -d -m 0755 /etc/apt/keyrings
curl -fsSL https://pkgs.zabbly.com/key.asc -o /etc/apt/keyrings/zabbly.asc

architecture="$(dpkg --print-architecture)"
codename="$(sb_host_codename)"
cat > /etc/apt/sources.list.d/zabbly-incus-lts-7.0.sources <<EOF
Enabled: yes
Types: deb
URIs: https://pkgs.zabbly.com/incus/lts-7.0
Suites: ${codename}
Components: main
Architectures: ${architecture}
Signed-By: /etc/apt/keyrings/zabbly.asc
EOF

apt-get update
apt-get install -y incus

profile_marker='Speedbuild managed default profile'
if ! incus profile show default 2>/dev/null | grep -Fq "${profile_marker}"; then
  sb_log "Initializing Incus storage, network, and default profile."
  incus admin init --preseed <<EOF
config: {}
networks:
- name: ${SB_BRIDGE_NAME}
  type: bridge
  config:
    ipv4.address: 10.61.0.1/24
    ipv4.dhcp.ranges: 10.61.0.200-10.61.0.254
    ipv4.nat: "true"
    ipv6.address: none
storage_pools:
- name: sbpool
  driver: zfs
  config:
    size: ${SB_ZPOOL_SIZE}
profiles:
- name: default
  description: ${profile_marker}
  config: {}
  devices:
    root:
      type: disk
      path: /
      pool: sbpool
    eth0:
      type: nic
      name: eth0
      network: ${SB_BRIDGE_NAME}
projects: []
cluster: null
EOF
fi

incus profile create sb-participant 2>/dev/null || true
incus profile set sb-participant limits.cpu "${SB_PART_CPUS}"
incus profile set sb-participant limits.memory "${SB_PART_MEM}"

if incus profile device show sb-participant | grep -qE '^[[:space:]]*root:$'; then
  incus profile device set sb-participant root pool sbpool
  incus profile device set sb-participant root path /
  incus profile device set sb-participant root size "${SB_PART_DISK}"
else
  incus profile device add sb-participant root disk pool=sbpool path=/ size="${SB_PART_DISK}"
fi

if incus profile device show sb-participant | grep -qE '^[[:space:]]*eth0:$'; then
  incus profile device set sb-participant eth0 network "${SB_BRIDGE_NAME}"
  incus profile device set sb-participant eth0 name eth0
else
  incus profile device add sb-participant eth0 nic name=eth0 network="${SB_BRIDGE_NAME}"
fi

# The sb-vf profile is attached to instances in 20-zones/30-participant-template,
# not here, after the host has completed the SR-IOV capability checks.
if sb_sriov_active; then
  incus profile create sb-vf 2>/dev/null || true
  incus profile set sb-vf cloud-init.network-config - <<'EOF'
version: 2
ethernets:
  eth0:
    match:
      name: eth0
    set-name: eth0
    dhcp4: true
  eth1:
    match:
      name: eth1
    set-name: eth1
    dhcp4: true
    dhcp4-overrides:
      use-routes: false
      use-dns: false
EOF

  while IFS= read -r profile_device; do
    if [[ "${profile_device}" != eth1 ]]; then
      incus profile device remove sb-vf "${profile_device}"
    fi
  done < <(incus profile device show sb-vf | sed -n 's/^\([^[:space:]][^:]*\):$/\1/p')

  if incus profile device show sb-vf | grep -qE '^[[:space:]]*eth1:$'; then
    incus profile device set sb-vf eth1 nictype sriov
    incus profile device set sb-vf eth1 parent "${SB_SRIOV_PF}"
    incus profile device set sb-vf eth1 name eth1
    incus profile device unset sb-vf eth1 hwaddr 2>/dev/null || true
  else
    incus profile device add sb-vf eth1 nic nictype=sriov parent="${SB_SRIOV_PF}" name=eth1
  fi
fi

sb_done_marker 10-incus
sb_log "Incus setup complete."

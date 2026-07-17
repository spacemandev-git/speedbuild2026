#!/usr/bin/env bash
set -euo pipefail

# Idempotency: boot configuration, persistent VF configuration, and the live VF
# count are reconciled; markers record boot mutations and successful completion.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=host/lib.sh
source "${SCRIPT_DIR}/lib.sh"
sb_load_config

if ! sb_sriov_active; then
  if [[ "${SB_SMOKE_TEST}" == 1 ]]; then
    sb_log "WARNING: SR-IOV setup is skipped in smoke-test container mode."
  else
    sb_log "SR-IOV setup is disabled; skipping host VF enablement."
  fi
  exit 0
fi

[[ -n "${SB_SRIOV_PF:-}" ]] || sb_die "SB_SRIOV_PF must name the SR-IOV-capable NIC PF (e.g. an Intel E810 ice port like enp1s0f0np0) when SR-IOV is enabled for production VMs."
[[ "${SB_SRIOV_PF}" =~ ^[[:alnum:]_.:-]+$ ]] || sb_die "SB_SRIOV_PF contains invalid netdev characters: ${SB_SRIOV_PF}"
pf_driver="$(basename "$(readlink -f "/sys/class/net/${SB_SRIOV_PF}/device/driver" 2>/dev/null)" 2>/dev/null || echo unknown)"
sb_log "SR-IOV target PF ${SB_SRIOV_PF} uses driver: ${pf_driver}"

if [[ ! -e "/sys/class/net/${SB_SRIOV_PF}" && -d /sys/module/idpf ]]; then
  reload_marker="12-sriov-idpf-reload-${SB_SRIOV_PF}"
  if ! sb_marker "${reload_marker}"; then
    sb_log "E2100 PF ${SB_SRIOV_PF} is missing while idpf is loaded; reloading idpf once."
    modprobe -r idpf
    modprobe idpf
    sb_done_marker "${reload_marker}"
  fi
fi

if [[ ! -e "/sys/class/net/${SB_SRIOV_PF}" ]]; then
  if [[ "${SB_SMOKE_TEST}" == 1 ]]; then
    sb_log "WARNING: E2100 PF ${SB_SRIOV_PF} is absent; skipping SR-IOV in smoke mode."
    exit 0
  fi
  sb_die "E2100 PF netdev ${SB_SRIOV_PF} does not exist under /sys/class/net. Check the idpf driver and SB_SRIOV_PF."
fi

export DEBIAN_FRONTEND=noninteractive
# The HWE meta-package matures idpf on 24.04; only 24.04 (noble) ships it. On
# newer releases (e.g. 26.04) the GA kernel already post-dates those fixes, so
# the running kernel is used as-is.
hwe_pkg="linux-generic-hwe-$(. /etc/os-release && printf '%s' "${VERSION_ID:-}")"
if [[ "$(sb_host_codename)" == noble ]]; then
  if ! sb_marker 12-sriov-hwe-kernel || ! dpkg-query -W -f='${Status}' "${hwe_pkg}" 2>/dev/null | grep -Fq 'install ok installed'; then
    sb_log "Installing ${hwe_pkg} for idpf maturity."
    apt-get install -y "${hwe_pkg}"
    sb_done_marker 12-sriov-hwe-kernel
  fi
else
  sb_log "Non-24.04 host ($(sb_host_codename)); using the GA kernel for idpf (no HWE package)."
fi

shopt -s nullglob
kernel_images=(/boot/vmlinuz-*)
shopt -u nullglob
(( ${#kernel_images[@]} > 0 )) || sb_die "No installed kernels were found under /boot/vmlinuz-*."

kernel_versions=()
for kernel_image in "${kernel_images[@]}"; do
  kernel_versions+=("${kernel_image##*/vmlinuz-}")
done
newest_kernel="$(printf '%s\n' "${kernel_versions[@]}" | sort -V | tail -n 1)"
running_kernel="$(uname -r)"
reboot_needed=0

if dpkg --compare-versions "${newest_kernel}" gt "${running_kernel}"; then
  sb_log "A newer installed kernel (${newest_kernel}) is staged; running kernel is ${running_kernel}."
  reboot_needed=1
fi

grub_defaults=/etc/default/grub
[[ -f "${grub_defaults}" ]] || sb_die "Missing ${grub_defaults}; cannot persist iommu=pt."
grub_cmdline="$(sed -n 's/^GRUB_CMDLINE_LINUX_DEFAULT="\([^"]*\)".*/\1/p' "${grub_defaults}" | tail -n 1)"
if [[ ! "${grub_cmdline}" =~ (^|[[:space:]])iommu=pt($|[[:space:]]) ]]; then
  sb_log "Adding iommu=pt to GRUB_CMDLINE_LINUX_DEFAULT."
  if grep -q '^GRUB_CMDLINE_LINUX_DEFAULT=""' "${grub_defaults}"; then
    sed -i 's/^GRUB_CMDLINE_LINUX_DEFAULT=""/GRUB_CMDLINE_LINUX_DEFAULT="iommu=pt"/' "${grub_defaults}"
  elif grep -q '^GRUB_CMDLINE_LINUX_DEFAULT="' "${grub_defaults}"; then
    sed -i 's/^GRUB_CMDLINE_LINUX_DEFAULT="\([^"]*\)"/GRUB_CMDLINE_LINUX_DEFAULT="\1 iommu=pt"/' "${grub_defaults}"
  else
    printf '%s\n' 'GRUB_CMDLINE_LINUX_DEFAULT="iommu=pt"' >> "${grub_defaults}"
  fi
  update-grub
  sb_done_marker 12-sriov-grub-iommu-pt
  reboot_needed=1
fi

running_cmdline=" $(< /proc/cmdline) "
if [[ ! "${running_cmdline}" =~ (^|[[:space:]])iommu=pt($|[[:space:]]) ]]; then
  reboot_needed=1
fi

if (( reboot_needed == 1 )); then
  install -d -m 0755 "${SB_MARKER_DIR}"
  touch "${SB_MARKER_DIR}/needs-reboot"
  cat <<'EOF'
[speedbuild] SR-IOV boot configuration is ready, but a reboot is required.
[speedbuild] Reboot this host now, then resume with:
[speedbuild]   sudo ./bootstrap.sh --from 12-sriov
EOF
  exit 0
fi

if sb_marker needs-reboot; then
  rm -f "${SB_MARKER_DIR}/needs-reboot"
  sb_log "The requested kernel and iommu=pt are active; cleared the reboot marker."
fi

vf_count_path="/sys/class/net/${SB_SRIOV_PF}/device/sriov_numvfs"
[[ -w "${vf_count_path}" ]] || sb_die "${vf_count_path} is unavailable or not writable; the E2100 PF does not expose SR-IOV controls."

current_vfs="$(< "${vf_count_path}")"
if [[ "${current_vfs}" != 0 ]]; then
  echo 0 > "${vf_count_path}"
fi

probe_error=''
probe_failed=0
if ! probe_error="$( (echo 2 > "${vf_count_path}") 2>&1)"; then
  probe_failed=1
fi
dmesg_tail="$(dmesg 2>/dev/null | tail -n 100 || true)"
if (( probe_failed == 1 )) || grep -Fqi 'SR-IOV is not supported on this device' <<<"${dmesg_tail}"; then
  echo 0 > "${vf_count_path}" 2>/dev/null || true
  if [[ "${pf_driver}" == idpf ]]; then
    sb_die "SR-IOV capability probe failed on idpf PF ${SB_SRIOV_PF}${probe_error:+: ${probe_error}}. On an E2100 IPU the control plane must advertise VIRTCHNL2_CAP_SRIOV in cp_init.cfg (configure via Intel MEV-ts/IMC)."
  fi
  sb_die "SR-IOV capability probe failed on PF ${SB_SRIOV_PF} (driver ${pf_driver})${probe_error:+: ${probe_error}}. Enable SR-IOV/IOMMU/ACS in BIOS and confirm the NIC firmware permits VFs."
fi
echo 0 > "${vf_count_path}"

pf_pci_address="$(basename "$(readlink -f "/sys/class/net/${SB_SRIOV_PF}/device")")"
lspci_details="$(lspci -s "${pf_pci_address}" -vvv)"
total_vfs="$(grep -oE 'Total VFs: [0-9]+' <<<"${lspci_details}" | awk 'NR == 1 { print $3 }' || true)"
[[ "${total_vfs}" =~ ^[0-9]+$ ]] || sb_die "Could not parse Total VFs from lspci -vvv for PF ${pf_pci_address}."
if (( 10#${SB_SRIOV_VF_COUNT} > 10#${total_vfs} )); then
  sb_die "SB_SRIOV_VF_COUNT=${SB_SRIOV_VF_COUNT} exceeds the PF Total VFs limit of ${total_vfs}."
fi

netplan_file=/etc/netplan/60-sriov.yaml
cat > "${netplan_file}" <<EOF
network:
  version: 2
  ethernets:
    ${SB_SRIOV_PF}:
      virtual-function-count: ${SB_SRIOV_VF_COUNT}
EOF
chmod 0600 "${netplan_file}"

pf_device_unit="$(systemd-escape --path --suffix=device "/sys/subsystem/net/devices/${SB_SRIOV_PF}")"
cat > /etc/systemd/system/sriov-vfs.service <<EOF
[Unit]
Description=Create Speedbuild SR-IOV virtual functions
BindsTo=${pf_device_unit}
After=${pf_device_unit}

[Service]
Type=oneshot
ExecStart=/bin/sh -c 'current=\$\$(cat ${vf_count_path}); if [ "\$\$current" != "${SB_SRIOV_VF_COUNT}" ]; then echo 0 > ${vf_count_path}; echo ${SB_SRIOV_VF_COUNT} > ${vf_count_path}; fi'
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable sriov-vfs.service

current_vfs="$(< "${vf_count_path}")"
if [[ "${current_vfs}" != "${SB_SRIOV_VF_COUNT}" ]]; then
  echo 0 > "${vf_count_path}"
  echo "${SB_SRIOV_VF_COUNT}" > "${vf_count_path}"
fi

sb_wait_for 30 "first SR-IOV VF on ${SB_SRIOV_PF}" test -e "/sys/class/net/${SB_SRIOV_PF}/device/virtfn0"
vf_pci_path="$(readlink -f "/sys/class/net/${SB_SRIOV_PF}/device/virtfn0")"
vf_pci_address="${vf_pci_path##*/}"
iommu_group_link="${vf_pci_path}/iommu_group"
if [[ -e "${iommu_group_link}" ]]; then
  iommu_group_path="$(readlink -f "${iommu_group_link}")"
  iommu_group_number="${iommu_group_path##*/}"
  shopt -s nullglob
  iommu_group_devices=("${iommu_group_path}"/devices/*)
  shopt -u nullglob
  unrelated_devices=()
  for group_device in "${iommu_group_devices[@]}"; do
    group_address="${group_device##*/}"
    if [[ "${group_address}" != "${vf_pci_address}" ]]; then
      unrelated_devices+=("${group_address}")
    fi
  done
  if (( ${#unrelated_devices[@]} > 0 )); then
    sb_log "WARNING: IOMMU GROUP NOT VIABLE: VF ${vf_pci_address} shares group ${iommu_group_number} with ${unrelated_devices[*]}; VM SR-IOV passthrough may fail with 'group not viable'. Check BIOS ACS/IOMMU settings."
  fi
else
  sb_log "WARNING: IOMMU GROUP NOT VIABLE: VF ${vf_pci_address} has no iommu_group; VM SR-IOV passthrough may fail with 'group not viable'. Check BIOS IOMMU/ACS settings."
fi

iommu_status="$(dmesg 2>/dev/null | grep -im1 'AMD-Vi' || true)"
[[ -n "${iommu_status}" ]] || iommu_status='AMD-Vi status not found in dmesg'
sb_done_marker 12-sriov
sb_log "SR-IOV setup complete: PF=${SB_SRIOV_PF}, VFs=${SB_SRIOV_VF_COUNT}, kernel=${running_kernel}, IOMMU=${iommu_status}"

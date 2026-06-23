#!/usr/bin/env bash
# install-zero.sh — set up a Raspberry Pi Zero W v1.1 with the
# Waveshare 7inch HDMI LCD (C) and the gea-embedded runtime.
#
# Assumes Raspberry Pi OS Lite (Bookworm or Trixie) is already flashed
# and the device is reachable at pi@<host>.
#
# Usage:
#   ./targets/rpi-display-1/scripts/install-zero.sh [user@host]
#
# Examples:
#   ./targets/rpi-display-1/scripts/install-zero.sh pi@192.168.1.42
#   ./targets/rpi-display-1/scripts/install-zero.sh pi@raspberrypi.local
#   ./targets/rpi-display-1/scripts/install-zero.sh        # default: pi@raspberrypi.local
#
# Authentication: the script runs 'sudo' on the remote host.
#   - If passwordless sudo is available for the user (default on most
#     Raspberry Pi OS installs), every command runs non-interactively.
#   - Otherwise, all sudo commands run inside ONE ssh session with a
#     forced TTY (-tt), so sudo prompts once and reuses the timestamp
#     for the rest of the session.
#
# To make this script non-interactive, enable passwordless sudo on the
# Pi once:
#   ssh pi@raspberrypi.local 'echo "pi ALL=(ALL) NOPASSWD: ALL" | sudo tee /etc/sudoers.d/pi-nopasswd'

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GEA_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"

host="${1:-pi@raspberrypi.local}"
ssh_opts=(-o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new)

gea_log() {
    printf "\n>> %s\n" "$*"
}

# Decide whether we need an interactive TTY for sudo.
needs_tty=1
if ssh "${ssh_opts[@]}" "${host}" "sudo -n true" 2>/dev/null; then
    needs_tty=0
    gea_log "passwordless sudo detected on ${host}"
else
    gea_log "passwordless sudo not available; will prompt via TTY (one session)"
fi

# Wrapper: run a single command (no sudo). Forces TTY if needed.
remote_run() {
    local cmd="$1"
    if [ "$needs_tty" = "1" ]; then
        ssh -tt "${ssh_opts[@]}" "${host}" "$cmd"
    else
        ssh "${ssh_opts[@]}" "${host}" "$cmd"
    fi
}

# Wrapper: run a single sudo command. When TTY is needed, every call
# gets its own password prompt (less ideal) — prefer running the whole
# install inside a single session via remote_sudo_session below.
remote_sudo() {
    local cmd="$1"
    if [ "$needs_tty" = "1" ]; then
        ssh -tt "${ssh_opts[@]}" "${host}" "sudo $cmd"
    else
        ssh "${ssh_opts[@]}" "${host}" "sudo $cmd"
    fi
}

# Run a multi-line script on the remote host inside ONE ssh session.
# When TTY is needed, sudo prompts once at the start and the cached
# timestamp covers the rest of the script.
remote_session() {
    local script="$1"
    if [ "$needs_tty" = "1" ]; then
        ssh -tt "${ssh_opts[@]}" "${host}" "bash -s" <<< "$script"
    else
        ssh "${ssh_opts[@]}" "${host}" "bash -s" <<< "$script"
    fi
}

gea_log "checking host: ${host}"
remote_run "test -f /etc/os-release && cat /etc/os-release | head -5"

# Pre-stage the systemd unit into /tmp on the remote host. The actual
# install into /etc/systemd/system/ happens inside the sudo session
# below, so the user only types the sudo password once.
gea_log "uploading systemd unit to ${host}:/tmp/"
scp "${ssh_opts[@]}" "${GEA_ROOT}/targets/rpi-display-1/systemd/gea-embedded.service" \
    "${host}:/tmp/gea-embedded.service"

# All sudo work goes through a single session so the user types the
# password at most once.
gea_log "running install steps in a single session on ${host}"

remote_session '
set -e
sudo true
sudo DEBIAN_FRONTEND=noninteractive apt-get update -y
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        build-essential cmake ninja-build pkg-config \
        libdrm-dev libinput-dev libudev-dev \
        libcurl4-openssl-dev libevdev-dev \
        git ca-certificates
sudo cp /boot/firmware/config.txt /boot/firmware/config.txt.gea-backup
sudo tee /boot/firmware/config.txt.gea > /dev/null <<EOF
# gea-embedded — Waveshare 7inch HDMI LCD (C)
hdmi_group=2
hdmi_mode=16
hdmi_drive=1
hdmi_force_hotplug=1
disable_overscan=1
max_usb_current=1
gpu_mem=64
dtparam=audio=off
EOF
sudo cp /boot/firmware/config.txt.gea /boot/firmware/config.txt
echo "vm.swappiness=10" | sudo tee /etc/sysctl.d/90-gea.conf > /dev/null
sudo mkdir -p /opt/gea-embedded/{apps,bin,logs}
sudo chown -R pi:pi /opt/gea-embedded
sudo usermod -aG video,input pi
sudo mv /tmp/gea-embedded.service /etc/systemd/system/gea-embedded.service
sudo systemctl daemon-reload
'

cat <<EOF

============================================================
DONE. ${host} hazır.
============================================================
Sonraki adımlar:

  1) Pi'yi yeniden başlat (HDMI mode uygulansın):
     ssh ${host} 'sudo reboot'

  2) Host'ta binary'yi derle (çapraz derleme önerilir):
     ./targets/rpi-display-1/scripts/geat-rpi.sh cross ./rpi-sysroot

  3) Binary'yi Pi'ye yükle:
     ./targets/rpi-display-1/scripts/geat-rpi.sh install ${host}

  4) Çalıştır (interaktif):
     ./targets/rpi-display-1/scripts/geat-rpi.sh run ${host}

  5) Ya da systemd ile kalıcı başlat:
     ssh ${host} 'sudo systemctl enable --now gea-embedded'

Ayrıntılar: targets/rpi-display-1/docs/try-on-pi.md
============================================================
EOF

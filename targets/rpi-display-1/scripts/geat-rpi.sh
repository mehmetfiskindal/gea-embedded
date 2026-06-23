#!/usr/bin/env bash
# geat-rpi.sh — build / install / run / log helpers for the Pi target.
#
# Mirrors the role of scripts/esp32s3-touch-amoled-2.06.sh but for the
# Linux/Raspberry Pi target. Works either on the Pi itself (native armhf
# compile) or on a cross-compile host.
#
# Usage:
#   geat-rpi.sh <command> [args...] [--app=ID]
#
# Commands:
#   build                      Build the current app for native armhf (Pi)
#   cross SYSDIR               Cross-compile with the given sysroot
#   sync HOST                  rsync the source tree to the Pi (for native build)
#   install HOST               rsync the binary to /opt/gea-embedded/apps/<app>/
#   run HOST                   ssh + run interactively
#   log HOST                   ssh + tail the log
#   status HOST                ssh + show service status
#   start HOST                 systemctl enable --now
#   stop HOST                  systemctl stop
#   help                       Show this help

set -euo pipefail

# Resolve repo root from the script's own location
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GEA_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
TARGET_DIR="${GEA_ROOT}/targets/rpi-display-1"
BUILD_DIR="${GEA_ROOT}/build/rpi"
APP="tic-tac-toe"

# Parse --app=ID and --app ID from anywhere in the argument list
ARGS=()
for arg in "$@"; do
    case "$arg" in
        --app=*) APP="${arg#--app=}" ;;
        --app)   # handled below; consume next
                  ;;
        *)       ARGS+=("$arg") ;;
    esac
done
# Re-parse with --app ID form
NEW_ARGS=()
SKIP=0
for i in "${!ARGS[@]}"; do
    if [ "$SKIP" = "1" ]; then SKIP=0; continue; fi
    arg="${ARGS[$i]}"
    if [ "$arg" = "--app" ]; then
        next="${ARGS[$((i+1))]:-tic-tac-toe}"
        APP="$next"
        SKIP=1
    else
        NEW_ARGS+=("$arg")
    fi
done
set -- "${NEW_ARGS[@]}"

cmd="${1:-help}"
shift || true

case "$cmd" in
    build)
        skip_vite=0
        for arg in "$@"; do
            case "$arg" in
                --skip-vite) skip_vite=1 ;;
            esac
        done
        echo ">> building ${APP} for Pi (linuxfb, armhf host, skip-vite=${skip_vite})"
        # If cache was configured for cross-compilation, clean it
        if [ -f "${BUILD_DIR}/CMakeCache.txt" ]; then
            if grep -q "arm-linux-gnueabihf" "${BUILD_DIR}/CMakeCache.txt"; then
                echo ">> removing cross-compilation cache..."
                rm -f "${BUILD_DIR}/CMakeCache.txt"
            fi
        fi
        extra_args=()
        if [ "$skip_vite" = "1" ]; then
            extra_args+=(-DGEA_RPI_SKIP_VITE=ON)
            # No need to pre-create stub files here: CMake's configure
            # step writes proper function stubs into build/rpi/apps/<id>/
            # when the files don't exist. Pre-creating a broken stub
            # here would defeat the if-NOT-EXISTS guard.
        fi
        cmake -S "${TARGET_DIR}" -B "${BUILD_DIR}" \
              -DCMAKE_BUILD_TYPE=Release \
              -DGEA_EMBEDDED_APP="${APP}" \
              "${extra_args[@]}"
        cmake --build "${BUILD_DIR}" -j
        ;;

    cross)
        sysroot_raw="${1:?usage: cross SYSDIR}"
        sysroot="$(cd "${sysroot_raw}" && pwd)"
        echo ">> cross-compile for Pi Zero W v1.1 (armhf), sysroot=${sysroot}, app=${APP}"
        # If cache was configured for native compilation, clean it
        if [ -f "${BUILD_DIR}/CMakeCache.txt" ]; then
            if ! grep -q "arm-linux-gnueabihf" "${BUILD_DIR}/CMakeCache.txt"; then
                echo ">> removing native build cache..."
                rm -f "${BUILD_DIR}/CMakeCache.txt"
            fi
        fi
        cmake -S "${TARGET_DIR}" -B "${BUILD_DIR}" \
              -DCMAKE_TOOLCHAIN_FILE="${TARGET_DIR}/cmake/rpi.toolchain.cmake" \
              -DCMAKE_SYSROOT="${sysroot}" \
              -DCMAKE_BUILD_TYPE=Release \
              -DGEA_EMBEDDED_APP="${APP}"
        cmake --build "${BUILD_DIR}" -j
        ;;

    sync)
        host="${1:?usage: sync HOST}"
        with_apps=0
        for arg in "$@"; do
            case "$arg" in
                --with-apps) with_apps=1 ;;
            esac
        done
        remote_dir="~/gea-embedded"
        echo ">> syncing source to ${host}:${remote_dir}"
        
        sync_opts=()
        if [ "$with_apps" = "1" ]; then
            sync_opts+=(
                --include="build/"
                --include="build/rpi/"
                --include="build/rpi/apps/"
                --include="build/rpi/apps/**"
                --exclude="build/**"
            )
        else
            sync_opts+=(--exclude="build")
        fi
        
        rsync -avz --delete \
              --exclude='.git' \
              "${sync_opts[@]}" \
              --exclude='node_modules' \
              --exclude='*.log' \
              "${GEA_ROOT}/" "${host}:${remote_dir}/"
        echo ">> synced"
        ;;

    install)
        host="${1:?usage: install HOST}"
        bin="${BUILD_DIR}/geat-app-${APP}"
        remote_path="/opt/gea-embedded/apps/${APP}/geat-app"
        remote_bin="~/gea-embedded/build/rpi/geat-app-${APP}"

        # Decide whether the local binary is usable, or whether we need
        # to fetch the remote one.
        local_bin_arch=""
        if [[ -x "${bin}" ]]; then
            local_bin_arch=$(file -b "${bin}" 2>/dev/null | head -1)
        fi
        remote_arch=$(ssh "${host}" "uname -m" 2>/dev/null || echo "unknown")

        # Cross-arch mismatch (e.g. local x86_64, remote arm*): try to
        # fetch the remote ARM binary via a single ssh connection.
        if [[ -z "${local_bin_arch}" ]] || \
           { [[ "${local_bin_arch}" == *"x86-64"* && "${remote_arch}" == *"arm"* ]]; } || \
           { [[ "${local_bin_arch}" == *"ARM"*  && "${remote_arch}" == *"x86_64"* ]]; }; then
            if [[ -z "${local_bin_arch}" ]]; then
                echo ">> no local binary; will try to fetch from ${host}"
            else
                echo ">> local arch (${local_bin_arch}) does not match remote (${remote_arch}); will fetch from ${host}"
            fi
            # Fetch via a single ssh session using cat + redirect, so the
            # user only types the password once (instead of once for
            # ssh test + once for scp).
            rm -f "${bin}"
            if ssh "${host}" "cat $remote_bin" > "${bin}" 2>/dev/null && [[ -s "${bin}" ]]; then
                chmod +x "${bin}"
                local_bin_arch=$(file -b "${bin}" 2>/dev/null | head -1)
            else
                cat <<EOF >&2
!! binary not built
   local:  ${bin} (missing or wrong arch: ${local_bin_arch:-none})
   remote: ${remote_bin} (missing or scp failed)
   Build first, then run install:
     - locally:  ./targets/rpi-display-1/scripts/geat-rpi.sh build
     - cross:    ./targets/rpi-display-1/scripts/geat-rpi.sh cross <sysroot>
     - on Pi:    ssh ${host} 'cd gea-embedded && ./targets/rpi-display-1/scripts/geat-rpi.sh build'
EOF
                exit 1
            fi
        fi

        # Final sanity check.
        if [[ -z "${local_bin_arch}" ]]; then
            echo "!! could not determine local binary arch; aborting" >&2
            exit 1
        fi

        echo ">> installing to ${host}:${remote_path} (arch: ${local_bin_arch})"
        # If NOPASSWD sudo is available on the Pi, use a single ssh
        # session with cat | sudo tee. Otherwise use the scp + sudo mv
        # path which lets sudo prompt interactively via -tt.
        if ssh "${host}" "sudo -n true" 2>/dev/null; then
            echo "   (NOPASSWD sudo detected; using stream install)"
            if ! cat "${bin}" | ssh "${host}" \
                 "sudo mkdir -p '${remote_path%/*}' && \
                  sudo tee '${remote_path}.tmp' >/dev/null && \
                  sudo mv -f '${remote_path}.tmp' '${remote_path}' && \
                  sudo chmod +x '${remote_path}' && \
                  echo INSTALLED" \
                 | grep -q INSTALLED; then
                cat <<EOF >&2
!! install failed on ${host}
   manual recovery:
     ssh ${host} 'sudo mkdir -p ${remote_path%/*}'
     scp ${bin} ${host}:/tmp/geat-app
     ssh ${host} 'sudo mv /tmp/geat-app ${remote_path} && sudo chmod +x ${remote_path}'
EOF
                exit 1
            fi
        else
            echo "   (NOPASSWD sudo NOT available; using scp + sudo mv)"
            echo "   (you'll be prompted for the sudo password)"
            ssh -tt "${host}" "sudo mkdir -p '${remote_path%/*}'" || {
                echo "!! failed to create install dir; aborting" >&2
                exit 1
            }
            scp "${bin}" "${host}:/tmp/geat-app"
            ssh -tt "${host}" \
                "sudo mv /tmp/geat-app '${remote_path}' && \
                 sudo chmod +x '${remote_path}' && \
                 sudo chown pi:pi '${remote_path}'" || {
                echo "!! failed to install binary; aborting" >&2
                exit 1
            }
        fi
        echo ">> installed: ${host}:${remote_path}"
        ;;

    run)
        host="${1:?usage: run HOST}"
        debug_level=0
        # Filter for --debug=N, leaving positional args in $@
        filtered=()
        for arg in "$@"; do
            case "$arg" in
                --debug=*) debug_level="${arg#--debug=}" ;;
                --debug)    debug_level=2 ;;
                *)          filtered+=("$arg") ;;
            esac
        done
        if [[ ${#filtered[@]} -gt 0 ]]; then
            host="${filtered[0]}"
        fi
        remote_bin="/opt/gea-embedded/apps/${APP}/geat-app"
        if ! ssh "${host}" "test -x '$remote_bin'" 2>/dev/null; then
            cat <<EOF >&2
!! binary not installed on ${host}
   run 'geat-rpi.sh install ${host} --app=${APP}' first
   (or use 'cross <sysroot>' if you haven't built for armhf yet)
EOF
            exit 1
        fi
        echo ">> running ${APP} on ${host} (Ctrl-C to stop)"
        if [[ "${debug_level}" -gt 0 ]]; then
            echo "   GEA_RPI_DEBUG_PANEL=${debug_level}"
        fi
        ssh -t "${host}" \
            "GEA_RPI_APP_ID=${APP} GEA_RPI_POLL_MS=200 \
             GEA_RPI_DEBUG_PANEL=${debug_level} \
             ${remote_bin}"
        ;;

    log)
        host="${1:?usage: log HOST}"
        ssh "${host}" "tail -F /tmp/geat-${APP}.log"
        ;;

    status)
        host="${1:?usage: status HOST}"
        ssh "${host}" "systemctl status gea-embedded --no-pager -l"
        ;;

    start)
        host="${1:?usage: start HOST}"
        ssh "${host}" "sudo systemctl enable --now gea-embedded"
        ;;

    stop)
        host="${1:?usage: stop HOST}"
        ssh "${host}" "sudo systemctl stop gea-embedded"
        ;;

    help|-h|--help|"")
        cat <<EOF
geat-rpi.sh — build/install/run/log helpers for the Pi target

  build                      Build the current app for native armhf (Pi)
  cross SYSDIR               Cross-compile with the given sysroot
  sync HOST                  rsync the source tree to the Pi
  install HOST               scp the binary to /opt/gea-embedded/apps/<app>/
  run HOST                   ssh + run interactively
  run HOST --debug=1         force full-panel push (no border) — see app render
  run HOST --debug=2         full-panel push + red border — verify blit math
  log HOST                   ssh + tail the log
  status HOST                ssh + show service status
  start HOST                 systemctl enable --now gea-embedded
  stop HOST                  systemctl stop gea-embedded
  help                       Show this help

Options (place anywhere in the argument list):
  --app=ID or --app ID       App id (default: tic-tac-toe)

Examples:
  geat-rpi.sh build
  geat-rpi.sh cross ./rpi-sysroot
  geat-rpi.sh install pi@raspberrypi.local
  geat-rpi.sh run    pi@raspberrypi.local --app=analog-clock

For full setup instructions, see:
  targets/rpi-display-1/docs/try-on-pi.md
EOF
        ;;

    *)
        echo "unknown command: ${cmd}" >&2
        echo "run 'geat-rpi.sh help' for usage" >&2
        exit 2
        ;;
esac

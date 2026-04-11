#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TARGET_DIR="$REPO_ROOT/targets/esp32-s3-touch-amoled-2.06"

usage() {
    echo "Usage: $0 <command> [--app=<name>] [--resident-apps=<ids|auto|none>] [PORT|auto|IP]"
    echo ""
    echo "  setup                    Set target to esp32s3 (run once)"
    echo "  build [--app=<name>]     Compile xsc + firmware (default: tic-tac-toe)"
    echo "  --resident-apps=<ids>    Comma-separated app-render ids to link into app-launcher"
    echo "  flash [PORT|auto]        Flash firmware to board via USB and reset"
    echo "  flash-image [PORT|auto] --image=<bin>"
    echo "                           Flash bootloader, partition table, OTA data, and a prebuilt app image"
    echo "  flash-images [PORT|auto] --slot-image=ota_<n>=<bin>..."
    echo "                           Flash bootloader, partition table, OTA data, and prebuilt app images"
    echo "  stage [PORT|auto] --app=<name> --slot=ota_<n>"
    echo "                           Write only the app image to one OTA slot over USB"
    echo "  stage-image [PORT|auto] --image=<bin> --slot=ota_<n>"
    echo "                           Write a prebuilt app image to one OTA slot over USB"
    echo "  stage-ota <IP> --app=<name> --slot=ota_<n>"
    echo "                           Write only the app image to one OTA slot over WiFi"
    echo "  stage-image-ota <IP> --image=<bin> --slot=ota_<n>"
    echo "                           Write a prebuilt app image to one OTA slot over WiFi"
    echo "  restore-boot [PORT|auto] Restore launcher OTA boot metadata over USB"
    echo "  erase-slot [PORT|auto] --slot=ota_<n>"
    echo "                           Erase one OTA app slot over USB"
    echo "  erase-slot-ota <IP> --slot=ota_<n>"
    echo "                           Erase one OTA app slot over WiFi"
    echo "  --no-reset               Leave the device in bootloader after USB flashing"
    echo "  monitor [PORT|auto]      Open serial monitor"
    echo "  flash-monitor [PORT|auto]  Flash and open monitor"
    echo "  ota <IP> [--app=<name>]  Build and flash wirelessly via WiFi OTA"
    echo "  ota-monitor <IP> [--app=<name>]  OTA flash then stream logs over WiFi"
    echo "  list-apps                Print ESP32-enabled example ids"
    echo "  fullclean                Remove all build artifacts"
}

esp_idf_major_minor() {
    local idf_dir="$1"
    local version_file="$idf_dir/tools/cmake/version.cmake"
    local major=""
    local minor=""

    if [ -f "$version_file" ]; then
        major="$(awk '/set\(IDF_VERSION_MAJOR/ { gsub(/\)/, "", $2); print $2; exit }' "$version_file")"
        minor="$(awk '/set\(IDF_VERSION_MINOR/ { gsub(/\)/, "", $2); print $2; exit }' "$version_file")"
    fi

    if [ -n "$major" ] && [ -n "$minor" ]; then
        echo "$major.$minor"
        return
    fi

    basename "$idf_dir" | sed -n 's/^esp-idf-v\([0-9][0-9]*\.[0-9][0-9]*\).*/\1/p'
}

prepare_esp_idf_python_env() {
    local export_script="$1"

    if [ -n "${IDF_PYTHON_ENV_PATH:-}" ] && [ -x "$IDF_PYTHON_ENV_PATH/bin/python" ]; then
        PATH="$IDF_PYTHON_ENV_PATH/bin:$PATH"
        export PATH
        return
    fi

    local idf_dir
    idf_dir="$(cd "$(dirname "$export_script")" && pwd)"

    local idf_version
    idf_version="$(esp_idf_major_minor "$idf_dir")"
    if [ -z "$idf_version" ]; then
        return
    fi

    local env_root="${IDF_TOOLS_PATH:-$HOME/.espressif}/python_env"
    local candidate
    for candidate in "$env_root/idf${idf_version}"_py*_env; do
        if [ -x "$candidate/bin/python" ]; then
            IDF_PYTHON_ENV_PATH="$candidate"
            PATH="$candidate/bin:$PATH"
            export IDF_PYTHON_ENV_PATH PATH
            echo "Using ESP-IDF Python env: $candidate"
            return
        fi
    done
}

try_source_esp_idf() {
    if command -v idf.py >/dev/null 2>&1; then
        return
    fi

    local candidates=()
    if [ -n "${IDF_PATH:-}" ]; then
        candidates+=("$IDF_PATH/export.sh")
    fi
    if [ -n "${GEA_EMBEDDED_IDF_EXPORT:-}" ]; then
        candidates+=("$GEA_EMBEDDED_IDF_EXPORT")
    fi
    if [ -n "${ESP_IDF_EXPORT:-}" ]; then
        candidates+=("$ESP_IDF_EXPORT")
    fi

    candidates+=(
        "$HOME/esp/esp-idf/export.sh"
        "$HOME/esp32/esp-idf/export.sh"
        "$HOME/esp-idf/export.sh"
        "$HOME/esp32/esp-idf-v5.5.1/export.sh"
        "$HOME/esp32/esp-idf-v5.4.2/export.sh"
    )

    local export_script
    for export_script in "$HOME"/esp/esp-idf-v*/export.sh "$HOME"/esp32/esp-idf-v*/export.sh; do
        if [ -f "$export_script" ]; then
            candidates+=("$export_script")
        fi
    done

    for export_script in "${candidates[@]}"; do
        if [ -f "$export_script" ]; then
            echo "Sourcing ESP-IDF environment: $export_script"
            prepare_esp_idf_python_env "$export_script"
            # shellcheck disable=SC1090
            . "$export_script"
            return
        fi
    done
}

require_esp_idf() {
    try_source_esp_idf
    if [ -z "${IDF_PATH:-}" ] || ! command -v idf.py >/dev/null 2>&1; then
        echo "ERROR: ESP-IDF is not ready in this shell."
        echo "  Install ESP-IDF v5.4+ and source the export script:"
        echo "    . \$HOME/esp/esp-idf/export.sh"
        echo ""
        echo "  For VS Code launches, set GEA_EMBEDDED_IDF_EXPORT to your export.sh path"
        echo "  or install ESP-IDF in one of the common locations this script checks."
        exit 1
    fi
}

is_vscode_input_placeholder() {
    case "$1" in
        '${input:'*|'\${input:'*) return 0 ;;
        *) return 1 ;;
    esac
}

normalize_optional_port() {
    case "$PORT" in
        ""|auto|AUTO|Auto|"<auto>")
            PORT=""
            ;;
        *)
            if is_vscode_input_placeholder "$PORT"; then
                PORT=""
            fi
            ;;
    esac
}

require_value() {
    local value="$1"
    local label="$2"

    if [ -z "$value" ] || is_vscode_input_placeholder "$value"; then
        echo "ERROR: Missing $label."
        usage
        exit 1
    fi
}

ensure_sdkconfig_value() {
    local key="$1"
    local value="$2"
    local file="sdkconfig"

    if [ ! -f "$file" ]; then
        return
    fi

    if grep -q "^$key=$value$" "$file"; then
        return
    fi

    local tmp
    tmp="$(mktemp "${file}.XXXXXX")"
    awk -v key="$key" -v value="$value" '
        BEGIN { written = 0 }
        $0 ~ "^" key "=" {
            print key "=" value
            written = 1
            next
        }
        { print }
        END {
            if (!written) print key "=" value
        }
    ' "$file" > "$tmp"
    mv "$tmp" "$file"
}

ACTION="${1:-build}"
shift || true

# Parse --app=<name> from remaining args; default to tic-tac-toe
GEA_EMBEDDED_APP=""
GEA_EMBEDDED_RESIDENT_APPS=""
OTA_SLOT=""
IMAGE_PATH=""
SLOT_IMAGES=()
OTA_BOOT=0
OTA_REBOOT=0
AFTER_FLASH_RESET="hard_reset"
POSITIONAL=()
for arg in "$@"; do
    case "$arg" in
        --app=*) GEA_EMBEDDED_APP="${arg#--app=}" ;;
        --resident-apps=*) GEA_EMBEDDED_RESIDENT_APPS="${arg#--resident-apps=}" ;;
        --slot=*) OTA_SLOT="${arg#--slot=}" ;;
        --image=*) IMAGE_PATH="${arg#--image=}" ;;
        --slot-image=*) SLOT_IMAGES+=("${arg#--slot-image=}") ;;
        --boot) OTA_BOOT=1 ;;
        --reboot) OTA_REBOOT=1 ;;
        --no-reset) AFTER_FLASH_RESET="no_reset" ;;
        *) POSITIONAL+=("$arg") ;;
    esac
done
PORT="${POSITIONAL[0]:-}"
normalize_optional_port

if is_vscode_input_placeholder "$GEA_EMBEDDED_APP"; then
    echo "ERROR: VS Code did not resolve the example picker input."
    echo "Try running 'Gea Embedded: regenerate VS Code configs' and launch again."
    exit 1
fi

if [ -z "$GEA_EMBEDDED_APP" ]; then
    case "$ACTION" in
        build|flash|flash-monitor|ota|ota-monitor)
            GEA_EMBEDDED_APP="tic-tac-toe"
            ;;
    esac
fi

case "$ACTION" in
    list-apps)
        node -e "const fs=require('fs'); const m=JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); console.log(m.apps.filter(a=>a.targets&&a.targets.esp32&&a.targets.esp32.enabled).map(a=>a.id).join('\n'))" "$REPO_ROOT/examples/apps.json"
        exit 0
        ;;
    help|--help|-h)
        usage
        exit 0
        ;;
    setup|build|flash|flash-image|flash-images|stage|stage-image|stage-ota|stage-image-ota|restore-boot|erase-slot|erase-slot-ota|monitor|flash-monitor|ota|ota-monitor|fullclean)
        ;;
    *)
        usage
        exit 1
        ;;
esac

case "$ACTION" in
    ota|ota-monitor|stage-ota|stage-image-ota|erase-slot-ota)
        require_value "$PORT" "board IP address"
        ;;
    stage|stage-ota)
        require_value "$GEA_EMBEDDED_APP" "app id (--app=<name>)"
        require_value "$OTA_SLOT" "OTA slot (--slot=ota_<n>)"
        ;;
    flash-image)
        require_value "$IMAGE_PATH" "app image (--image=<bin>)"
        ;;
    flash-images)
        if [ "${#SLOT_IMAGES[@]}" -eq 0 ]; then
            echo "ERROR: Missing app images (--slot-image=ota_<n>=<bin>)." >&2
            usage
            exit 1
        fi
        ;;
    stage-image|stage-image-ota)
        require_value "$IMAGE_PATH" "app image (--image=<bin>)"
        require_value "$OTA_SLOT" "OTA slot (--slot=ota_<n>)"
        ;;
    erase-slot|erase-slot-ota)
        require_value "$OTA_SLOT" "OTA slot (--slot=ota_<n>)"
        ;;
esac

require_esp_idf
cd "$TARGET_DIR"
ensure_sdkconfig_value "CONFIG_ESP_MAIN_TASK_STACK_SIZE" "16384"
ensure_sdkconfig_value "CONFIG_SPIRAM_ALLOW_BSS_SEG_EXTERNAL_MEMORY" "y"

IDF_APP_ARGS=()
if [ -n "$GEA_EMBEDDED_APP" ]; then
    IDF_APP_ARGS+=("-DGEA_EMBEDDED_APP=$GEA_EMBEDDED_APP")
fi
if [ -n "$GEA_EMBEDDED_RESIDENT_APPS" ]; then
    IDF_APP_ARGS+=("-DGEA_EMBEDDED_RESIDENT_APPS=$GEA_EMBEDDED_RESIDENT_APPS")
elif [ "$GEA_EMBEDDED_APP" = "app-launcher" ]; then
    IDF_APP_ARGS+=("-DGEA_EMBEDDED_RESIDENT_APPS=auto")
else
    IDF_APP_ARGS+=("-DGEA_EMBEDDED_RESIDENT_APPS=none")
fi

build_firmware() {
    if [ -n "$GEA_EMBEDDED_APP" ]; then
        echo "Building firmware for app '$GEA_EMBEDDED_APP'..."
        idf.py "${IDF_APP_ARGS[@]}" reconfigure
        idf.py "${IDF_APP_ARGS[@]}" build
    else
        echo "Building firmware..."
        idf.py build
    fi
}

flash_prebuilt_firmware() {
    local bootloader_image="build/bootloader/bootloader.bin"
    local partition_table_image="build/partition_table/partition-table.bin"
    local ota_data_image="build/ota_data_initial.bin"

    if [ ! -f "$IMAGE_PATH" ]; then
        echo "ERROR: App image not found: $IMAGE_PATH" >&2
        exit 1
    fi

    for required_image in "$bootloader_image" "$partition_table_image" "$ota_data_image"; do
        if [ ! -f "$required_image" ]; then
            echo "ERROR: $required_image was not found. Build the launcher once first." >&2
            exit 1
        fi
    done

    local app_offset
    local app_slot_size
    local otadata_offset
    app_offset="$(partition_field "ota_0" 4 "offset")"
    app_slot_size="$(partition_field "ota_0" 5 "size")"
    otadata_offset="$(partition_field "otadata" 4 "offset")"

    local image_size
    image_size="$(wc -c < "$IMAGE_PATH" | tr -d ' ')"
    if (( image_size > app_slot_size )); then
        echo "ERROR: App image is $image_size bytes but ota_0 only has $app_slot_size bytes." >&2
        echo "Regenerate a partition plan with fewer apps or larger slots." >&2
        exit 1
    fi

    local app_label="${GEA_EMBEDDED_APP:-prebuilt image}"
    echo "Flashing '$app_label' from $IMAGE_PATH to ota_0 ($app_offset) over USB..."
    echo "Writing bootloader, partition table, OTA boot metadata, and app image."

    local esptool_args=(
        --chip esp32s3
        --before default_reset
        --after "$AFTER_FLASH_RESET"
    )
    if [ -n "$PORT" ]; then
        esptool_args+=(-p "$PORT")
    fi
    esptool_args+=(
        -b 460800
        write_flash
        --flash_mode dio
        --flash_freq 80m
        --flash_size 32MB
        0x0
        "$bootloader_image"
        "$app_offset"
        "$IMAGE_PATH"
        0x8000
        "$partition_table_image"
        "$otadata_offset"
        "$ota_data_image"
    )

    esptool_command "${esptool_args[@]}"
    echo "Flashed '$app_label' in ota_0 and restored launcher boot metadata."
}

flash_prebuilt_firmware_set() {
    local bootloader_image="build/bootloader/bootloader.bin"
    local partition_table_image="build/partition_table/partition-table.bin"
    local ota_data_image="build/ota_data_initial.bin"

    for required_image in "$bootloader_image" "$partition_table_image" "$ota_data_image"; do
        if [ ! -f "$required_image" ]; then
            echo "ERROR: $required_image was not found. Build the launcher once first." >&2
            exit 1
        fi
    done

    local otadata_offset
    otadata_offset="$(partition_field "otadata" 4 "offset")"

    local flash_pairs=(
        0x0
        "$bootloader_image"
        0x8000
        "$partition_table_image"
        "$otadata_offset"
        "$ota_data_image"
    )

    local entry
    for entry in "${SLOT_IMAGES[@]}"; do
        local slot="${entry%%=*}"
        local image_path="${entry#*=}"
        if [ "$slot" = "$entry" ] || [ -z "$slot" ] || [ -z "$image_path" ]; then
            echo "ERROR: Invalid --slot-image value '$entry'. Use --slot-image=ota_<n>=<bin>." >&2
            exit 1
        fi

        slot="$(normalize_ota_slot "$slot")"
        if [ ! -f "$image_path" ]; then
            echo "ERROR: App image not found for $slot: $image_path" >&2
            exit 1
        fi

        local offset
        local slot_size
        local image_size
        offset="$(ota_slot_offset "$slot")"
        slot_size="$(ota_slot_size "$slot")"
        image_size="$(wc -c < "$image_path" | tr -d ' ')"
        if (( image_size > slot_size )); then
            echo "ERROR: App image for $slot is $image_size bytes but the slot only has $slot_size bytes." >&2
            echo "Regenerate a partition plan with fewer apps or larger slots." >&2
            exit 1
        fi

        flash_pairs+=("$offset" "$image_path")
    done

    echo "Flashing ${#SLOT_IMAGES[@]} prebuilt app image(s) over USB..."
    echo "Writing bootloader, partition table, OTA boot metadata, and app images."

    local esptool_args=(
        --chip esp32s3
        --before default_reset
        --after "$AFTER_FLASH_RESET"
    )
    if [ -n "$PORT" ]; then
        esptool_args+=(-p "$PORT")
    fi
    esptool_args+=(
        -b 460800
        write_flash
        --flash_mode dio
        --flash_freq 80m
        --flash_size 32MB
        "${flash_pairs[@]}"
    )

    esptool_command "${esptool_args[@]}"
    if [ "$AFTER_FLASH_RESET" = "no_reset" ]; then
        echo "Flashed app images. Device was not reset after flashing."
    else
        echo "Flashed app images. Device was reset after flashing."
    fi
}

ota_slot_offset() {
    partition_field "$(normalize_ota_slot "$1")" 4 "offset"
}

ota_slot_size() {
    partition_field "$(normalize_ota_slot "$1")" 5 "size"
}

normalize_ota_slot() {
    case "$1" in
        ota_*) echo "$1" ;;
        [0-9]*) echo "ota_$1" ;;
        *) echo "$1" ;;
    esac
}

partition_field() {
    local partition
    local field
    local label
    partition="$1"
    field="$2"
    label="$3"

    local value
    if ! value="$(awk -F, -v partition="$partition" -v field="$field" '
        function trim(s) { gsub(/^[ \t]+|[ \t]+$/, "", s); return s }
        /^[ \t]*#/ || NF < field { next }
        {
            name = trim($1)
            if (name == partition) {
                print trim($field)
                found = 1
                exit
            }
        }
        END { if (!found) exit 1 }
    ' partitions.csv)"; then
        echo "ERROR: Partition '$partition' was not found in partitions.csv." >&2
        echo "Run: npm run install-app <app-id>   or   npm run install-app all" >&2
        exit 1
    fi

    if [ -z "$value" ]; then
        echo "ERROR: Partition '$partition' has no $label in partitions.csv." >&2
        exit 1
    fi

    echo "$value"
}

esptool_command() {
    if command -v esptool.py >/dev/null 2>&1; then
        esptool.py "$@"
    else
        python -m esptool "$@"
    fi
}

ota_base_url() {
    case "$1" in
        http://*|https://*) printf "%s" "${1%/}" ;;
        *:*) printf "http://%s" "$1" ;;
        *) printf "http://%s:8080" "$1" ;;
    esac
}

stage_app_image() {
    local offset
    local slot_size
    offset="$(ota_slot_offset "$OTA_SLOT")"
    slot_size="$(ota_slot_size "$OTA_SLOT")"

    build_firmware

    local image_size
    image_size="$(wc -c < build/gea_embedded.bin | tr -d ' ')"
    if (( image_size > slot_size )); then
        echo "ERROR: App image is $image_size bytes but $OTA_SLOT only has $slot_size bytes." >&2
        echo "Regenerate a partition plan with fewer apps or larger slots." >&2
        exit 1
    fi

    echo "Staging app '$GEA_EMBEDDED_APP' to $OTA_SLOT ($offset) over USB..."
    echo "Writing app image only; bootloader, partition table, and otadata are unchanged."

    local esptool_args=(
        --chip esp32s3
        --before default_reset
        --after "$AFTER_FLASH_RESET"
    )
    if [ -n "$PORT" ]; then
        esptool_args+=(-p "$PORT")
    fi
    esptool_args+=(
        -b 460800
        write_flash
        --flash_mode dio
        --flash_freq 80m
        --flash_size 32MB
        "$offset"
        build/gea_embedded.bin
    )

    esptool_command "${esptool_args[@]}"
    echo "Staged '$GEA_EMBEDDED_APP' in $OTA_SLOT. Boot selection was not changed."
}

stage_prebuilt_image() {
    OTA_SLOT="$(normalize_ota_slot "$OTA_SLOT")"

    local offset
    local slot_size
    offset="$(ota_slot_offset "$OTA_SLOT")"
    slot_size="$(ota_slot_size "$OTA_SLOT")"

    if [ ! -f "$IMAGE_PATH" ]; then
        echo "ERROR: App image not found: $IMAGE_PATH" >&2
        exit 1
    fi

    local image_size
    image_size="$(wc -c < "$IMAGE_PATH" | tr -d ' ')"
    if (( image_size > slot_size )); then
        echo "ERROR: App image is $image_size bytes but $OTA_SLOT only has $slot_size bytes." >&2
        echo "Regenerate a partition plan with fewer apps or larger slots." >&2
        exit 1
    fi

    local app_label="${GEA_EMBEDDED_APP:-prebuilt image}"
    echo "Staging '$app_label' from $IMAGE_PATH to $OTA_SLOT ($offset) over USB..."
    echo "Writing app image only; bootloader, partition table, and otadata are unchanged."

    local esptool_args=(
        --chip esp32s3
        --before default_reset
        --after "$AFTER_FLASH_RESET"
    )
    if [ -n "$PORT" ]; then
        esptool_args+=(-p "$PORT")
    fi
    esptool_args+=(
        -b 460800
        write_flash
        --flash_mode dio
        --flash_freq 80m
        --flash_size 32MB
        "$offset"
        "$IMAGE_PATH"
    )

    esptool_command "${esptool_args[@]}"
    echo "Staged '$app_label' in $OTA_SLOT. Boot selection was not changed."
}

restore_boot_metadata() {
    local ota_data_image="build/ota_data_initial.bin"
    if [ ! -f "$ota_data_image" ]; then
        echo "ERROR: $ota_data_image was not found. Flash the launcher once first." >&2
        exit 1
    fi

    local offset
    offset="$(partition_field "otadata" 4 "offset")"

    echo "Restoring OTA boot metadata at $offset..."

    local esptool_args=(
        --chip esp32s3
        --before default_reset
        --after "$AFTER_FLASH_RESET"
    )
    if [ -n "$PORT" ]; then
        esptool_args+=(-p "$PORT")
    fi
    esptool_args+=(
        -b 460800
        write_flash
        --flash_mode dio
        --flash_freq 80m
        --flash_size 32MB
        "$offset"
        "$ota_data_image"
    )

    esptool_command "${esptool_args[@]}"
    echo "Launcher OTA boot metadata restored."
}

erase_slot_image() {
    OTA_SLOT="$(normalize_ota_slot "$OTA_SLOT")"

    local offset
    local slot_size
    offset="$(ota_slot_offset "$OTA_SLOT")"
    slot_size="$(ota_slot_size "$OTA_SLOT")"

    echo "Erasing $OTA_SLOT ($offset, $slot_size bytes) over USB..."

    local esptool_args=(
        --chip esp32s3
        --before default_reset
        --after "$AFTER_FLASH_RESET"
    )
    if [ -n "$PORT" ]; then
        esptool_args+=(-p "$PORT")
    fi
    esptool_args+=(
        -b 460800
        erase_region
        "$offset"
        "$slot_size"
    )

    esptool_command "${esptool_args[@]}"
    echo "Erased $OTA_SLOT."
}

stage_app_image_ota() {
    OTA_SLOT="$(normalize_ota_slot "$OTA_SLOT")"

    local slot_size
    slot_size="$(ota_slot_size "$OTA_SLOT")"

    build_firmware

    local image_size
    image_size="$(wc -c < build/gea_embedded.bin | tr -d ' ')"
    if (( image_size > slot_size )); then
        echo "ERROR: App image is $image_size bytes but $OTA_SLOT only has $slot_size bytes." >&2
        echo "Regenerate a partition plan with fewer apps or larger slots." >&2
        exit 1
    fi

    local url
    url="$(ota_base_url "$PORT")/ota?slot=$OTA_SLOT&boot=$OTA_BOOT&reboot=$OTA_REBOOT"
    echo "Staging app '$GEA_EMBEDDED_APP' to $OTA_SLOT over WiFi OTA..."
    curl --fail -X POST "$url" --data-binary @build/gea_embedded.bin
    echo ""
    echo "Staged '$GEA_EMBEDDED_APP' in $OTA_SLOT over OTA. Boot selection was not changed."
}

stage_prebuilt_image_ota() {
    OTA_SLOT="$(normalize_ota_slot "$OTA_SLOT")"

    local slot_size
    slot_size="$(ota_slot_size "$OTA_SLOT")"

    if [ ! -f "$IMAGE_PATH" ]; then
        echo "ERROR: App image not found: $IMAGE_PATH" >&2
        exit 1
    fi

    local image_size
    image_size="$(wc -c < "$IMAGE_PATH" | tr -d ' ')"
    if (( image_size > slot_size )); then
        echo "ERROR: App image is $image_size bytes but $OTA_SLOT only has $slot_size bytes." >&2
        echo "Regenerate a partition plan with fewer apps or larger slots." >&2
        exit 1
    fi

    local app_label="${GEA_EMBEDDED_APP:-prebuilt image}"
    local url
    url="$(ota_base_url "$PORT")/ota?slot=$OTA_SLOT&boot=$OTA_BOOT&reboot=$OTA_REBOOT"
    echo "Staging '$app_label' from $IMAGE_PATH to $OTA_SLOT over WiFi OTA..."
    curl --fail -X POST "$url" --data-binary @"$IMAGE_PATH"
    echo ""
    echo "Staged '$app_label' in $OTA_SLOT over OTA. Boot selection was not changed."
}

erase_slot_image_ota() {
    OTA_SLOT="$(normalize_ota_slot "$OTA_SLOT")"

    local url
    url="$(ota_base_url "$PORT")/ota/erase?slot=$OTA_SLOT"
    echo "Erasing $OTA_SLOT over WiFi OTA..."
    curl --fail -X POST "$url"
    echo ""
    echo "Erased $OTA_SLOT over OTA."
}

case "$ACTION" in
    setup)
        echo "Setting target to esp32s3..."
        idf.py set-target esp32s3
        echo "Done. Run: $0 build"
        ;;
    build)
        build_firmware
        ;;
    flash)
        build_firmware
        IMAGE_PATH="build/gea_embedded.bin"
        flash_prebuilt_firmware
        ;;
    flash-image)
        flash_prebuilt_firmware
        ;;
    flash-images)
        flash_prebuilt_firmware_set
        ;;
    stage)
        stage_app_image
        ;;
    stage-image)
        stage_prebuilt_image
        ;;
    stage-ota)
        stage_app_image_ota
        ;;
    stage-image-ota)
        stage_prebuilt_image_ota
        ;;
    restore-boot)
        restore_boot_metadata
        ;;
    erase-slot)
        erase_slot_image
        ;;
    erase-slot-ota)
        erase_slot_image_ota
        ;;
    monitor)
        if [ -z "$PORT" ]; then
            idf.py monitor
        else
            idf.py -p "$PORT" monitor
        fi
        ;;
    flash-monitor)
        build_firmware
        if [ -z "$PORT" ]; then
            idf.py "${IDF_APP_ARGS[@]}" flash monitor
        else
            idf.py "${IDF_APP_ARGS[@]}" -p "$PORT" flash monitor
        fi
        ;;
    ota)
        IP="$PORT"
        build_firmware
        echo "Sending OTA update to $IP..."
        curl -X POST "$(ota_base_url "$IP")/ota" --data-binary @build/gea_embedded.bin
        echo ""
        echo "OTA complete. Board is rebooting."
        ;;
    ota-monitor)
        IP="$PORT"
        build_firmware
        echo "Sending OTA update to $IP..."
        curl -X POST "$(ota_base_url "$IP")/ota" --data-binary @build/gea_embedded.bin
        echo ""
        echo "OTA sent. Waiting for reboot + WiFi reconnect..."
        sleep 8
        echo "Connecting to diagnostics stream at $IP:8081 (Ctrl+C to exit)"
        set +e
        while true; do
            python3 - "$IP" <<'PY'
import socket
import sys

ip = sys.argv[1]
port = 8081

sock = socket.create_connection((ip, port), timeout=10)
sock.settimeout(10)
buffer = b""

try:
    while True:
        chunk = sock.recv(4096)
        if not chunk:
            break
        buffer += chunk
        while len(buffer) >= 4:
            channel = buffer[0]
            payload_len = buffer[2] | (buffer[3] << 8)
            frame_len = 4 + payload_len
            if len(buffer) < frame_len:
                break
            payload = buffer[4:frame_len]
            buffer = buffer[frame_len:]
            if channel == 1 and payload:
                sys.stdout.buffer.write(payload)
                sys.stdout.buffer.flush()
finally:
    sock.close()
PY
            sleep 1
        done
        ;;
    fullclean)
        echo "Removing build directory..."
        idf.py fullclean
        ;;
    *)
        usage
        exit 1
        ;;
esac

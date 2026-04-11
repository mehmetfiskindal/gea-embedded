# ESP32 Target

The current hardware target is:

```text
targets/esp32-s3-touch-amoled-2.06/
```

It targets the Waveshare ESP32-S3-Touch-AMOLED-2.06 board with a 410x502 display.

## Prerequisites

- Node.js and npm
- Host C compiler
- ESP-IDF v5.4 or newer

Emscripten is not required for ESP32-only work.

Source ESP-IDF in each ESP32 build shell:

```bash
. ~/esp/esp-idf/export.sh
idf.py --version
```

If ESP-IDF lives in a custom path:

```bash
export GEA_EMBEDDED_IDF_EXPORT=/absolute/path/to/esp-idf/export.sh
```

The helper script auto-sources common ESP-IDF install locations.

## Helper Script

From the repo root:

```bash
./scripts/esp32s3-touch-amoled-2.06.sh <command> [--app=<name>] [PORT|auto|IP]
```

Commands:

```text
setup                       Set target to esp32s3
build [--app=<name>]        Compile firmware
flash [PORT|auto]           Build and flash via USB
monitor [PORT|auto]         Open serial monitor
flash-monitor [PORT|auto]   Build, flash, then monitor
ota <IP>                    Build and upload firmware to port 8080
ota-monitor <IP>            OTA upload, then follow TCP logs on port 8081
list-apps                   Print ESP32-enabled app ids
fullclean                   Remove ESP-IDF build artifacts
```

Default app is `tic-tac-toe`.

List available apps:

```bash
./scripts/esp32s3-touch-amoled-2.06.sh list-apps
```

## First USB Flash

```bash
./scripts/esp32s3-touch-amoled-2.06.sh setup
./scripts/esp32s3-touch-amoled-2.06.sh flash-monitor auto --app=tic-tac-toe
```

Press `Ctrl-]` to exit the ESP-IDF serial monitor.

## Launcher Installs

Use the root install helper to flash the launcher plus a small set of staged apps:

```bash
npm run install-app tic-tac-toe -- --port=/dev/cu.usbmodem101
npm run install-app tic-tac-toe button-tetris -- --port=/dev/cu.usbmodem101
```

The launcher install scripts use the board's 32 MB flash. The target enables ESP-IDF's experimental bootloader cache support for 32-bit DIO flash addressing so generated USB install layouts can place bootable app slots above the old 16 MB mapping boundary. Use `--dry-run` to inspect the generated slot sizes before flashing; installing every example at once can still make the slots too small for current app images.

## Launcher Button

On the Waveshare ESP32-S3-Touch-AMOLED-2.06, the reliable programmable side button is BOOT. Waveshare documents BOOT as GPIO0 during normal operation, with a low level while pressed. When a launcher-installed staged app is running, press BOOT to select `app-launcher` and restart into it.

The reset/download path is still useful for flashing recovery, but it is not treated as the primary in-app launcher shortcut. If an app is too stuck to process the BOOT button, run:

```bash
npm run recover-apps
```

## Wi-Fi Config

Create the local Wi-Fi header:

```bash
cp targets/esp32-s3-touch-amoled-2.06/main/include/wifi_config.h.example \
   targets/esp32-s3-touch-amoled-2.06/main/include/wifi_config.h
```

Edit `wifi_config.h` with your SSID and password. The file is gitignored.

Flash once over USB after changing credentials:

```bash
./scripts/esp32s3-touch-amoled-2.06.sh flash-monitor auto --app=tic-tac-toe
```

Watch logs for the board IP.

## OTA

After the board has valid Wi-Fi credentials:

```bash
./scripts/esp32s3-touch-amoled-2.06.sh ota <board-ip> --app=tic-tac-toe
```

OTA with wireless logs:

```bash
./scripts/esp32s3-touch-amoled-2.06.sh ota-monitor <board-ip> --app=tic-tac-toe
```

The helper builds before sending the firmware.

## Network Ports

```text
8080  HTTP OTA upload endpoint, POST /ota
8081  TCP log stream
8082  TCP store mirror stream for app-render apps
```

Quick probes:

```bash
nc -vz <board-ip> 8080
nc <board-ip> 8081
nc <board-ip> 8082
```

## Build Flow

ESP-IDF resolves the app from `examples/apps.json` through `GEA_EMBEDDED_APP`.

For `app-render` apps:

```text
app package npm build
    |
    +--> dist/index.js
    +--> build/gea_embedded_app_generated.c
    +--> build/gea_embedded_font_generated.c/h
    |
ESP-IDF builds generated C with shared UI/raster/display code
```

For `screen` apps:

```text
app package npm build
    |
    +--> dist/index.js
    |
host xsc compiles dist/index.js to XS bytecode
ESP-IDF builds XS runtime + native screen host functions
```

The target always builds a host `xsc` compiler from `vendor/xs/tools/xsc.c` into the ESP-IDF build directory.

## Pure C Versus XS

`app-render` apps define `GEA_EMBEDDED_PURE_C`. The frame loop, touch handlers, stores, layout, and render updates run through generated C and shared C runtime code.

`screen` apps use the XS JavaScript runtime on the device and call C host functions for drawing, timers, Wi-Fi, BLE, IMU, images, and fetch.

## Device Mirror

The ESP32 starts the store mirror server only for `app-render` apps and only when Wi-Fi is ready.

Use `bouncing-balls-jsx` for the bouncing balls mirror test:

```bash
./targets/web/build-web.sh bouncing-balls-jsx
./scripts/esp32s3-touch-amoled-2.06.sh ota-monitor <board-ip> --app=bouncing-balls-jsx
```

Then run the simulator in `Device mirror` transport mode.

## Common ESP-IDF Commands

The helper script wraps these, but raw commands can be useful:

```bash
cd targets/esp32-s3-touch-amoled-2.06
idf.py set-target esp32s3
idf.py -DGEA_EMBEDDED_APP=tic-tac-toe reconfigure
idf.py build
idf.py flash monitor
idf.py fullclean
```

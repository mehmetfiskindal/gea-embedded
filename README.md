# Gea Embedded

Gea Embedded is a small UI pipeline for generating embedded app UIs from TSX and rendering them with a C layout and raster engine.

At a high level, the flow is:

1. Write an app in TSX using `mount`, HTML-style UI tags such as `div`, `span`, `p`, headings, and optional `Image` / `Button` components.
2. Compile that TSX into:
   - thin JavaScript for app state and event glue
   - generated C that builds the UI tree
3. Render with the C engine on:
   - the ESP32 device target (AMOLED display)
   - the Raspberry Pi target (specifically Raspberry Pi Zero W v1.1 + Waveshare 7" LCD)
   - the browser-hosted WASM simulator

## Repo Layout

- `examples/` — Canonical app source packages (`tic-tac-toe/`, `tilt-breakout/`, `button-tetris/`, `analog-clock/`, `watch-face/`, and more).
- `examples/apps.json` — App manifest declaring which examples are simulator/device-capable.
- `simulator/` — Browser-hosted viewer for inspecting WASM-rendered output.
- `lib/` — Type declarations for `gea-embedded` and the TSX-to-C Vite plugin.
- `targets/esp32-s3-touch-amoled-2.06/` — Device target for the ESP32 AMOLED board.
- `targets/rpi-display-1/` — Device target for the Raspberry Pi Zero W v1.1 (or Pi 1) + Waveshare 7" LCD.
- `targets/shared/` — Shared runtime, UI, raster, and driver code used by multiple targets.
- `targets/web/` — WebAssembly target and build script.
- `vendor/` — Vendored third-party runtime code.

## License

Project code outside `vendor/` is licensed under the GNU General Public License version 3 only (`GPL-3.0-only`). See `LICENSE`.

Vendored third-party code keeps its original licenses and notices. See `THIRD_PARTY.md` for provenance and license notes, especially for the vendored Moddable XS runtime in `vendor/xs/`.

GPLv3 permits commercial use and sale under GPL terms. It does not permit proprietary redistribution of this project, or products/firmware that form a GPL-covered combined work with it, without satisfying GPLv3 obligations such as providing Corresponding Source and preserving recipients' GPL rights. Commercial or proprietary terms outside GPLv3 require a separate commercial license from the relevant copyright holders. For the vendored XS/Moddable components, see [Moddable's commercial licensing information](https://www.moddable.com/license).

## Development Environment

The repo has per-package JavaScript installs and target-specific native toolchains. If you only work on one target, you only need that target's native toolchain.

| Tool | Required for | Notes |
| ---- | ------------ | ----- |
| Node.js + npm | All example builds, tests, simulator UI, and target app selection | Current lockfiles use Vite 8, which requires Node.js `^20.19.0 || >=22.12.0`. Node 22+ is the simplest choice. |
| Host C compiler (`cc`, `gcc`, or `clang`) | ESP32 firmware builds | The ESP32 build compiles the vendored XS `xsc` bytecode compiler on your development machine. On macOS, install Xcode Command Line Tools with `xcode-select --install`. |
| ESP-IDF v5.4+ | ESP32 firmware build, flash, monitor, and OTA | Required only for the ESP32 target. `./install.sh esp32s3` installs the ESP32-S3 toolchain and ESP-IDF Python tools. |
| arm-linux-gnueabihf-gcc / g++ | Raspberry Pi Zero W / Pi 1 cross-builds | Required only for cross-compiling for the Raspberry Pi target on the host machine. |
| Emscripten SDK (`emsdk` / `emcc`) | Browser simulator WASM builds | Required for `targets/web/build-web.sh` and `targets/web/build-screen-runtime.sh`. Not required for ESP32 or Raspberry Pi device work. |

JavaScript dependencies are installed where you work. The root `package.json` only exposes repo-level helper commands; example dependencies still live in each example package:

```bash
cd examples/tic-tac-toe
npm install

cd ../../simulator
npm install
```

### ESP-IDF

Install ESP-IDF once, then source its environment in every terminal where you build or flash ESP32 firmware:

```bash
mkdir -p ~/esp && cd ~/esp
git clone -b v5.4.2 --recursive https://github.com/espressif/esp-idf.git
cd esp-idf
./install.sh esp32s3

# Every ESP32 build/flash terminal:
. ~/esp/esp-idf/export.sh
idf.py --version
```

If ESP-IDF is installed somewhere else, set `GEA_EMBEDDED_IDF_EXPORT` to the full path of `export.sh` before using the VS Code launch configs.

### Emscripten / emsdk

Install Emscripten only if you want to build the browser simulator's WASM artifacts:

```bash
mkdir -p ~/emscripten && cd ~/emscripten
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk
./emsdk install latest
./emsdk activate latest

# Every web/WASM build terminal:
source ~/emscripten/emsdk/emsdk_env.sh
emcc --version
```

`emsdk` is the officially supported Emscripten install path. It provides `emcc`, which this repo uses to compile the shared C runtime and generated app C into `.wasm` files for the browser simulator.

### Quick Verification

```bash
node --version
npm --version
cc --version
idf.py --version    # after sourcing ESP-IDF export.sh
emcc --version      # after sourcing emsdk_env.sh, only needed for WASM
```

## Getting Started

### 1. Build an example app

Each example is a self-contained npm package. Pick one and install + build:

```bash
cd examples/tic-tac-toe
npm install
npm run build
```

This produces `dist/index.js` (thin JS) and `gea_embedded_app_generated.c` (generated C) via the Vite plugin.

### 2. Run tests and type checks

```bash
npm test -- --run test/vite-plugin-gea-embedded.test.ts
npm run check
```

### 3. Choose a target

From here you can flash to the ESP32 board, deploy to the Raspberry Pi target, or preview in the browser simulator.

## ESP32 Target

Targets the [Waveshare ESP32-S3-Touch-AMOLED-2.06](https://www.waveshare.com/wiki/ESP32-S3-Touch-AMOLED-2.06) board using the vendored XS JavaScript engine with a custom minimal platform layer (no Moddable SDK build system).

### Prerequisites

For ESP32-only work, you need Node.js/npm, a host C compiler, and ESP-IDF. You do not need Emscripten unless you also build the browser simulator's WASM artifacts.

1. **ESP-IDF v5.4+**

```bash
mkdir -p ~/esp && cd ~/esp
git clone -b v5.4.2 --recursive https://github.com/espressif/esp-idf.git
cd esp-idf
./install.sh esp32s3
```

2. **Source the ESP-IDF environment** (every terminal session):

```bash
. ~/esp/esp-idf/export.sh
```

3. **Host C compiler** — `cc` / `gcc` / `clang` on your PATH, used to build the `xsc` bytecode compiler on your development machine.

### USB Flash (first time)

```bash
# One-time target setup
./scripts/esp32s3-touch-amoled-2.06.sh setup

# Build firmware
./scripts/esp32s3-touch-amoled-2.06.sh build

# Flash and monitor (plug in board via USB-C first)
./scripts/esp32s3-touch-amoled-2.06.sh flash-monitor
```

Press `Ctrl-]` to exit the serial monitor.

### Install Launcher Apps Over USB

To install the launcher plus one or more resident apps, use the root helper:

```bash
npm run install-app button-tetris
npm run install-app button-tetris tilt-breakout
```

The installer only accepts ESP32-enabled `app-render` apps. It links those apps into the launcher firmware as resident apps, regenerates `targets/esp32-s3-touch-amoled-2.06/partitions.csv` with two firmware OTA partitions, and flashes the launcher image into `ota_0`. One slot runs the launcher and resident apps; the other remains the normal inactive OTA update slot. The target enables ESP-IDF's experimental bootloader cache support for 32-bit DIO flash addressing, so the two-slot layout can use the full 32 MB flash instead of stopping at the old 16 MB mapping boundary. Built launcher images are cached under the ESP-IDF build directory and reused when their source/config/resident-app hash is unchanged. USB installs write the launcher image plus bootloader, partition table, and OTA metadata in one `esptool` transaction and reset the device after flashing. Use `-- --port=<port>` if auto-detect does not pick the right USB serial device:

```bash
npm run install-app button-tetris tilt-breakout -- --port=/dev/cu.usbmodem101
```

To leave the board in bootloader mode instead of resetting after USB flashing:

```bash
npm run install-app button-tetris -- --no-reset
```

To preview the generated resident app plan and two-slot firmware layout without flashing:

```bash
npm run install-app button-tetris tilt-breakout -- --dry-run
```

To force a fresh launcher image instead of using the cache:

```bash
npm run install-app button-tetris -- --rebuild
```

Once the board already has the two-slot resident launcher layout, you can refresh the launcher and resident apps over WiFi OTA:

```bash
npm run install-app button-tetris -- --ota=<board-ip>
```

OTA installs use the board's existing partition table. If the board still has the old per-app OTA slot layout, run the install once over USB so the two-slot partition table can be flashed, then use `--ota` for later launcher refreshes.

If the board gets stuck on an old per-app firmware slot, restore launcher boot selection without rebuilding or erasing flash:

```bash
npm run recover-apps
npm run recover-apps -- --port=/dev/cu.usbmodem101
```

With launcher-style installs, short-press the board's BOOT side button while a resident app is running to return to `app-launcher`. A long press toggles the settings overlay for app-render apps that initialize `Settings`. Waveshare documents BOOT as GPIO0 under normal operation, active-low when pressed, so the firmware treats the debounced BOOT button as the reliable launcher shortcut. Launcher-initiated resident app starts do not reboot the board.

If the launcher image itself is stale or corrupted, reflash it during recovery:

```bash
npm run recover-apps -- --flash-launcher
```

To uninstall one or more apps:

```bash
npm run uninstall-app button-tetris
npm run uninstall-app button-tetris tilt-breakout
npm run uninstall-app all
```

USB uninstall regenerates the resident app plan without those apps and flashes the updated launcher into `ota_0`. OTA uninstall keeps the existing two-slot partition table and updates the inactive launcher slot:

```bash
npm run uninstall-app button-tetris -- --ota=<board-ip>
npm run uninstall-app all -- --ota=<board-ip>
```

To format the launcher app area back to a clean launcher-only resident plan:

```bash
npm run format-apps
npm run format-apps -- --ota=<board-ip>
```

USB format regenerates the two-slot launcher partition table and flashes launcher-only firmware into `ota_0`. OTA format cannot rewrite the partition table; it only erases legacy non-launcher slots when you are still running an older layout.

Or with raw `idf.py`:

```bash
cd targets/esp32-s3-touch-amoled-2.06
idf.py set-target esp32s3   # one-time
idf.py build
idf.py -p /dev/cu.usbmodem* flash monitor
```

### WiFi OTA Flash (wireless)

Once the board has been USB-flashed at least once with WiFi credentials, subsequent updates can be sent wirelessly.

**1. Set up WiFi credentials** (one-time):

```bash
cp targets/esp32-s3-touch-amoled-2.06/main/include/wifi_config.h.example \
   targets/esp32-s3-touch-amoled-2.06/main/include/wifi_config.h
```

Edit `wifi_config.h` with your SSID and password. This file is gitignored.

**2. Build and flash via USB** (first time with WiFi):

```bash
./scripts/esp32s3-touch-amoled-2.06.sh flash-monitor
```

The board will connect to WiFi and print its IP address and OTA readiness in the serial log.

**3. OTA update** (all subsequent flashes):

```bash
./scripts/esp32s3-touch-amoled-2.06.sh ota <board-ip>
```

This builds the firmware and sends it wirelessly. The board reboots automatically.

**4. OTA with log streaming**:

```bash
./scripts/esp32s3-touch-amoled-2.06.sh ota-monitor <board-ip>
```

Same as `ota`, but after the reboot it connects to the board's TCP log stream on port 8081 so you can see console output without a USB cable.

### Changing the App Source

Edit your app source and re-flash. The `ota` command builds automatically before sending:

```bash
./scripts/esp32s3-touch-amoled-2.06.sh ota <board-ip>
```

To build a different example, pass `--app`:

```bash
./scripts/esp32s3-touch-amoled-2.06.sh ota <board-ip> --app=static-card
```

### VS Code Deploy

The repo includes generated VS Code Run/Debug and Task configs for ESP32-enabled apps in `examples/apps.json`.

From the **Run and Debug** panel:

1. Choose `Gea Embedded: USB flash + monitor selected example`.
2. Click Run.
3. Pick an example when prompted.
4. Accept `auto` to let ESP-IDF auto-detect the serial port, or enter a port such as `/dev/cu.usbmodem1101`.

For wireless deploys, choose `Gea Embedded: OTA selected example + logs` and enter the board IP printed by the firmware.

If you add, remove, or retarget examples, regenerate the VS Code picker lists:

```bash
node scripts/generate-vscode-config.mjs
```

The deploy script auto-sources ESP-IDF from common install locations. If your ESP-IDF lives somewhere custom, set `GEA_EMBEDDED_IDF_EXPORT` to the full path of `export.sh` before launching VS Code.

### Build Flow

```
examples/tic-tac-toe/index.tsx
        |
        v
  [Vite + gea-embedded plugin]
        |
        ├──> dist/index.js        (thin JS)
        └──> gea_embedded_app_generated.c (generated C)
        |
        v
  [host xsc]  ── built from vendor/xs/tools/xsc.c
        |
        v
  index.xs.c  ── XS bytecode as C arrays
        |
        v
  ESP-IDF app ── links XS runtime + bytecode + UI engine
        |
        v
  firmware.bin ── flashed to board (USB or OTA)
```

### Script Reference

```
./scripts/esp32s3-touch-amoled-2.06.sh <command> [--app=<name>] [--resident-apps=<ids|auto|none>] [PORT|auto|IP]

  setup                    Set target to esp32s3 (run once)
  build [--app=<name>]     Compile xsc + firmware (default: tic-tac-toe)
  --resident-apps=<ids>    Comma-separated app-render ids to link into app-launcher
  flash [PORT|auto]        Flash firmware to board via USB
  flash-image [PORT|auto] --image=<bin>
                           Flash bootloader, partition table, OTA data, and a prebuilt app image
  flash-images [PORT|auto] --slot-image=ota_<n>=<bin>...
                           Flash bootloader, partition table, OTA data, and prebuilt app images
  stage [PORT|auto] --app=<name> --slot=ota_<n>
                           Write only the app image to one OTA slot over USB
  stage-image [PORT|auto] --image=<bin> --slot=ota_<n>
                           Write a prebuilt app image to one OTA slot over USB
  stage-ota <IP> --app=<name> --slot=ota_<n>
                           Write only the app image to one OTA slot over WiFi
  stage-image-ota <IP> --image=<bin> --slot=ota_<n>
                           Write a prebuilt app image to one OTA slot over WiFi
  restore-boot [PORT|auto] Restore launcher OTA boot metadata over USB
  erase-slot [PORT|auto] --slot=ota_<n>
                           Erase one OTA app slot over USB
  erase-slot-ota <IP> --slot=ota_<n>
                           Erase one OTA app slot over WiFi
  monitor [PORT|auto]      Open serial monitor
  flash-monitor [PORT|auto]  Flash and open monitor
  ota <IP> [--app=<name>]  Build and flash wirelessly via WiFi OTA
  ota-monitor <IP> [--app=<name>]  OTA flash then stream logs over WiFi
  fullclean                Remove all build artifacts
```

The `--app` flag selects which example to build by its id in `examples/apps.json` (e.g. `--app=static-card`). If omitted, defaults to `tic-tac-toe`.

### Troubleshooting

**No serial output after flashing** — This board uses native USB (not a UART bridge). The firmware defaults to `CONFIG_ESP_CONSOLE_USB_SERIAL_JTAG`. Try unplugging and replugging USB-C. Verify the device is visible (`ls /dev/cu.usbmodem*` on macOS, `ls /dev/ttyACM*` on Linux). If the board uses USB CDC, change the console channel in `idf.py menuconfig` under **Component config > ESP System Settings**.

**Boot loops or flash errors** — The board may need octal flash mode. In `idf.py menuconfig`, set **Serial flasher config > Flash type** to **Octal flash** and **Flash size** to **32 MB**.

**WiFi not connecting** — Make sure `wifi_config.h` exists with the correct SSID and password. The board falls back to USB-only mode if WiFi fails.

## Raspberry Pi Target

Targets Raspberry Pi (specifically Raspberry Pi Zero W v1.1 or Pi 1 with 512 MB memory) + Waveshare 7inch HDMI LCD (C) (1024×600 USB capacitive touch) using the POSIX `/dev/fb0` linuxfb backend.

### Prerequisites

For Raspberry Pi work, you need Node.js/npm on your host, a cross-compiler on your host, and a configured Raspberry Pi Zero.

1. **Install Cross-Compiler** (Debian/Ubuntu host example):
   ```bash
   sudo apt-get install -y gcc-arm-linux-gnueabihf g++-arm-linux-gnueabihf cmake rsync
   ```
2. **Raspberry Pi OS Lite** (32-bit recommended) installed on the SD card, with SSH and Wi-Fi enabled.

### One-Time Target Setup

1. **Configure Pi Zero device** (WiFi, graphics configuration, libraries):
   ```bash
   ./targets/rpi-display-1/scripts/install-zero.sh pi@raspberrypi.local
   ```
   *Note: This copies the config, modifies `/boot/firmware/config.txt` for the Waveshare 7inch HDMI LCD (C), installs needed library packages, and reboots.*

2. **Prepare local Sysroot** on host (for cross-compilation header & library matching via Docker):
   ```bash
   docker create --name rpi-sysroot balenalib/raspberry-pi-debian:bookworm-run
   docker cp rpi-sysroot:/usr ./rpi-sysroot
   docker rm rpi-sysroot
   ```

### Cross-Build, Install, and Run (Hybrid Approach - Recommended for Pi Zero W v1.1)

Standard host-side cross-compilers (`gcc-arm-linux-gnueabihf`) often package compiler runtime startup files (`crtbegin.o`, `libgcc.a`) compiled for ARMv7. To prevent `Illegal instruction` crashes on Pi Zero's ARMv6 processor, the recommended flow is a **hybrid build**: run Vite on the host, and compile C natively on the Pi (skipping Node.js).

1. **Build the app assets locally on host**:
   ```bash
   cd examples/tic-tac-toe
   npm install
   GEA_EMBEDDED_TARGET=rpi npm run build
   cd ../..
   ```

2. **Sync the source and Vite assets to the Pi**:
   ```bash
   ./targets/rpi-display-1/scripts/geat-rpi.sh sync pi@raspberrypi.local --with-apps
   ```

3. **Compile C natively on the Pi (skipping Vite)**:
   SSH to the Pi, go to the repository, and run the native build:
   ```bash
   ssh pi@raspberrypi.local
   cd ~/gea-embedded
   ./targets/rpi-display-1/scripts/geat-rpi.sh build --app=tic-tac-toe --skip-vite
   ```

4. **Install the compiled binary (on the Pi)**:
   ```bash
   sudo mkdir -p /opt/gea-embedded/apps/tic-tac-toe
   sudo cp build/rpi/geat-app-tic-tac-toe /opt/gea-embedded/apps/tic-tac-toe/geat-app
   sudo chown -R pi:pi /opt/gea-embedded
   ```

5. **Run the app on the Pi**:
   ```bash
   GEA_RPI_APP_ID=tic-tac-toe /opt/gea-embedded/apps/tic-tac-toe/geat-app
   ```

6. **Stop running app / View logs**:
   Use standard systemd unit commands or check logs directly:
   ```bash
   tail -F /tmp/geat-tic-tac-toe.log
   ```

> [!TIP]
> **Troubleshooting (Black Screen / Changes Not Compiled)**: If the app starts but the screen remains black (`vp_nonblack=0`), or C changes aren't compiled on the Pi (`100% Built target` immediately), run `touch build/rpi/apps/tic-tac-toe/gea_embedded_*` on the Pi. This updates the synced file timestamps and forces CMake to rebuild the C sources.

For detailed instructions, troubleshooting, and pure cross-compilation alternatives, see [targets/rpi-display-1/README.md](file:///home/mehmet/gea-embedded/targets/rpi-display-1/README.md) and [Gerçek Cihazda Test Rehberi](file:///home/mehmet/gea-embedded/targets/rpi-display-1/docs/try-on-pi.md).

## Browser Simulator

The browser simulator renders apps using the same C layout and raster engine compiled to WebAssembly. The browser only presents the framebuffer — it does not perform layout or text rendering.

Prerequisites: Node.js/npm plus Emscripten `emcc` on your PATH. Source `emsdk_env.sh` before running `targets/web/build-web.sh` or `targets/web/build-screen-runtime.sh`.

### 1. Install the example app's dependencies

```bash
cd examples/tic-tac-toe
npm install
```

### 2. Build the web-targeted app + WASM module

```bash
cd /path/to/gea-embedded
./targets/web/build-web.sh tic-tac-toe
```

This reads `examples/apps.json`, runs `GEA_EMBEDDED_TARGET=web vite build` in the example to produce `app.js` + generated C, then compiles WASM with Emscripten.

To build every browser-enabled app for simulator testing:

```bash
./targets/web/build-screen-runtime.sh
node -e "const m=require('./examples/apps.json'); for (const a of m.apps.filter(a => a.targets?.web?.enabled)) console.log(a.id)" \
  | xargs -n1 ./targets/web/build-web.sh
```

### 3. Build the viewer

```bash
cd simulator
npm install
npm run build
```

### 4. Start the viewer

```bash
npm start
```

This serves the built simulator on a local port. Open the printed URL in your browser.

For development with hot-reload, use `npm run dev` instead.

The viewer discovers apps from `examples/apps.json` and chooses a runtime based on the app's `"runtime"` field.

For `app-render` apps, the viewer can run in either transport mode:

- `Direct framebuffer` runs the app WASM in the simulator page and paints the framebuffer immediately.
- `Device mirror` connects to ESP32 hardware through the simulator relay, receives store snapshots/diffs, applies them to a local WASM copy of the app, and paints the framebuffer locally.

The simulator sidebar includes a Wi-Fi panel. Changing the connected checkbox, SSID, IP, or RSSI feeds the app-facing Wi-Fi APIs in both `app-render` WASM apps and `screen` apps.

In `app-render` TSX apps, import the Wi-Fi singleton from `gea-embedded`:

```ts
import { WiFi } from 'gea-embedded'

if (WiFi.isConnected()) {
  console.log(WiFi.getSSID(), WiFi.getIP(), WiFi.getRSSI())
}
```

Available calls: `WiFi.isConnected()`, `WiFi.getSSID()`, `WiFi.getIP()`, `WiFi.getRSSI()`, `WiFi.getMAC()`, and `WiFi.configure(ssid, password)`.

In `screen` apps, the simulator exposes the same `WiFi` singleton on `globalThis`, so raw drawing apps can call it directly.

Screen-runtime apps can also use `fetch()` on ESP32. The embedded shim is intentionally small but browser-shaped:

```ts
const response = await fetch('https://api.example.com/state.json', {
  headers: { Authorization: 'Bearer ...' }
})

if (response.ok) {
  const data = await response.json()
}
```

POST/PUT/PATCH-style requests can send a string, `ArrayBuffer`, typed array, or `DataView` body:

```ts
await fetch('https://api.example.com/state', {
  method: 'POST',
  headers: {
    Authorization: 'Bearer ...',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ score: 42 })
})
```

Request headers are passed as a plain object and can use arbitrary header names. Response headers are available through `response.headers.get(name)`, `response.headers.has(name)`, and `response.headers.forEach((value, key) => ...)`; lookups are case-insensitive.

Supported response fields/methods: `ok`, `status`, `url`, `headers`, `text()`, `json()`, and `arrayBuffer()`. The ESP32 implementation uses `esp_http_client`, supports common request methods, and caps response bodies at 2 MB.

### Simulator Runtimes

The simulator supports two runtime modes, selected per-app via the `"runtime"` field in `examples/apps.json`:

| `runtime`              | Description                                                                                                                | WASM source                                 | Examples                     |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ---------------------------- |
| `app-render` (default) | gea-embedded TSX apps that call `mount(App)`. The simulator loads a per-app WASM module compiled from generated C.          | `targets/web/dist/<app>/module.js`          | `typography`, `tic-tac-toe` |
| `screen`               | Raw drawing apps that use `screen.*` and `requestAnimationFrame`. The simulator loads a shared generic screen WASM module. | `targets/web/dist/screen-runtime/module.js` | `bouncing-balls`             |

For `screen` apps, build the shared runtime once:

```bash
./targets/web/build-screen-runtime.sh
```

The `build-web.sh` script skips per-app WASM compilation for `screen` runtime apps (they have no generated C).

### Web Build Artifacts

For `app-render` apps, the build produces:

- `simulator/public/apps/<app>/app.js` — thin JS app bundle
- `simulator/public/apps/<app>/module.wasm` — per-app WASM binary
- `targets/web/generated/<app>/gea_embedded_app_generated.c` — generated C
- `targets/web/dist/<app>/module.js` + `module.wasm` — generated WASM bootstrap + binary

For `screen` apps, the build produces:

- `simulator/public/apps/<app>/app.js` — thin JS app bundle (no generated C)
- `simulator/public/screen-runtime/module.wasm` — shared screen runtime WASM (built once by `build-screen-runtime.sh`)

### Example Gallery

- `typography` — app-render showcase for `div`, `span`, `p`, and `h1` through `h6` authoring.
- `analog-clock` — JSX analog clock with smooth CSS-transform hands and tick marks.
- `tilt-breakout` — app-render brick game. On ESP32 it reads IMU tilt through the `Accelerometer` helper. In the simulator, arrow keys or WASD simulate tilt.
- `button-tetris` — app-render falling-block game with on-screen buttons for left, rotate, right, and drop.
- `watch-face` — web-only app-render Apple Watch-style face with step counting, battery dial, Wi-Fi-backed weather, and calendar status.

`watch-face` is marked web-only in `examples/apps.json` because its live data is simulator-oriented for now.

### Framebuffer Contract

The canonical framebuffer format is tightly packed RGB565 (row-major, 2 bytes/pixel, no row padding, `stride_bytes == width * 2`). Viewer display helpers convert RGB565 to RGBA only for canvas presentation.

## Sensor API

For app-render and screen-runtime apps, `gea-embedded` exposes a singleton `Accelerometer`. It supports `start()`, `stop()`, `calibrate()`, `x`, `y`, `z`, `timestamp`, `activated`, and `hasReading`.

Gea Embedded also adds `tiltX` and `tiltY` convenience properties in the `-100..100` range for games and simple controls:

```ts
import { Accelerometer } from 'gea-embedded'

Accelerometer.start()

function tick() {
  const paddleVelocity = Accelerometer.tiltX / 10
  const acceleration = { x: Accelerometer.x, y: Accelerometer.y, z: Accelerometer.z }
}
```

For screen-runtime apps and regular JavaScript, synchronous polling is also available through `Accelerometer.read()`:

```ts
import { Accelerometer } from 'gea-embedded'

const reading = Accelerometer.read()
console.log(reading.x, reading.y, reading.z, reading.tiltX, reading.tiltY)
```

For pointer-style HID apps, the singleton also exposes `startMouse()`, `stopMouse()`, `setMouseButtons(buttons)`, and `getMouseButtons()`.

## Image Support

Gea Embedded supports JPG, PNG, GIF, and animated GIF images through a shared native decoder pipeline using [stb_image](https://github.com/nothings/stb/blob/master/stb_image.h) (vendored under `vendor/stb/`).

### gea-embedded `<Image />` Component

For app-render TSX apps, use the `Image` component with an image object from `loadImage`:

```tsx
import { Component, Image, loadImage, mount } from 'gea-embedded'

const image = await loadImage('https://example.com/photo.jpg')

class App extends Component {
  template() {
    return (
      <div style={{ width: 410, height: 502 }}>
        <Image src={image} fit="contain" style={{ width: 200, height: 200 }} />
      </div>
    )
  }
}

mount(App)
```

Props: `src` (URL, byte buffer, or `GeaEmbeddedImage`), `fit` (`fill` | `contain` | `cover` | `none` | `scale-down`), plus all standard `style` props.

### Input Components

Lowercase `<input>` is a core app-render primitive for text-entry flows. The system keyboard is created lazily when an input receives focus, hidden on blur, and owns backspace, space, printable characters, password masking, focus, blur, and `input(value)` dispatch.

```tsx
import { Component, Store, mount } from 'gea-embedded'

class FormStore extends Store {
  value = ''
  lastKey = 0

  focus() {}

  update(value: string) {
    this.value = value
  }

  keydown(code: number) {
    this.lastKey = code
  }
}

const form = new FormStore()

class App extends Component {
  template() {
    return (
      <div style={{ width: 410, height: 502 }}>
        <input value={form.value} placeholder="Type here" focus={() => form.focus()} input={value => form.update(value)} keydown={code => form.keydown(code)} />
      </div>
    )
  }
}

mount(App)
```

### Low-level Screen API

For screen-runtime apps, use the `__gea_embedded_image` global:

```ts
const id = await __gea_embedded_image.loadUrl('https://example.com/photo.jpg')
__gea_embedded_image.draw(id, 0, 0)

// Animated GIF playback
requestAnimationFrame(function loop() {
  if (__gea_embedded_image.advance(id, 16)) {
    __gea_embedded_image.draw(id, 0, 0)
  }
  requestAnimationFrame(loop)
})
```

Available methods: `loadUrl(url)`, `loadBytes(buffer)`, `width(id)`, `height(id)`, `frameCount(id)`, `isAnimated(id)`, `setPlaying(id, flag)`, `seek(id, frame)`, `advance(id, deltaMs)`, `draw(id, x, y)`, `drawScaled(id, x, y, w, h)`, `dispose(id)`.

### Supported Formats

| Format | Static | Animated | Notes                              |
| ------ | ------ | -------- | ---------------------------------- |
| JPEG   | Yes    | —        | Baseline and progressive           |
| PNG    | Yes    | —        | 1-16 bpc, with alpha               |
| GIF    | Yes    | Yes      | Full frame timing and loop support |

### Runtime Loading

Images are loaded at runtime from HTTP/HTTPS URLs or raw byte buffers. On ESP32, `esp_http_client` handles network fetches. On the web simulator, the browser's `fetch()` API provides bytes to the native WASM decoder.

### Current Limitations

- No automated device-vs-WASM pixel diff harness yet.
- Image decode runs synchronously on ESP32 — large images may briefly block the UI.
- Maximum 32 simultaneous image handles (`GEA_EMBEDDED_IMAGE_MAX`).

# Gea Embedded Developer Guide

This guide collects the day-to-day commands for building examples, running the browser simulator, flashing the ESP32 target, and using the hardware device mirror.

The root `README.md` explains the project shape. This file is the operational playbook.

## Documentation Map

- [Architecture](architecture.md): how examples, generated code, targets, and simulator pieces fit together.
- [App Authoring](app-authoring.md): how to write `app-render` TSX apps with stores, components, styles, input, and native APIs.
- [Screen Apps](screen-apps.md): how raw `screen.*` apps differ from `app-render` apps.
- [Simulator](simulator.md): simulator setup, transports, artifacts, controls, and mirror relay endpoints.
- [ESP32 Target](esp32-target.md): hardware setup, firmware build, USB flash, OTA, logging, and ports.
- [Device Mirror Protocol](device-mirror-protocol.md): TCP JSON store snapshots/diffs and the simulator relay.
- [Generated Code](generated-code.md): what the Vite plugin emits and how the C runtime is structured.
- [Testing](testing.md): useful checks by area and before-change smoke matrices.
- [Troubleshooting](troubleshooting.md): symptom-oriented fixes for common build, simulator, OTA, and mirror problems.
- [Adding A Target](adding-a-target.md): checklist for bringing up another hardware or runtime target.

## Quick Command Reference

From the repo root:

```bash
# List ESP32-capable apps
./scripts/esp32s3-touch-amoled-2.06.sh list-apps

# Build an app for the browser simulator
./targets/web/build-web.sh tic-tac-toe

# Build the shared screen runtime used by screen apps
./targets/web/build-screen-runtime.sh

# Build every browser-enabled app for simulator testing
./targets/web/build-screen-runtime.sh
node -e "const m=require('./examples/apps.json'); for (const a of m.apps.filter(a => a.targets?.web?.enabled)) console.log(a.id)" \
  | xargs -n1 ./targets/web/build-web.sh

# Start the simulator in dev mode
cd simulator
npm install
npm run dev

# Build ESP32 firmware for an app
cd ..
./scripts/esp32s3-touch-amoled-2.06.sh build --app=tic-tac-toe

# Flash over USB and open serial logs
./scripts/esp32s3-touch-amoled-2.06.sh flash-monitor auto --app=tic-tac-toe

# OTA flash over Wi-Fi
./scripts/esp32s3-touch-amoled-2.06.sh ota <board-ip> --app=tic-tac-toe

# OTA flash, then stream logs over Wi-Fi
./scripts/esp32s3-touch-amoled-2.06.sh ota-monitor <board-ip> --app=tic-tac-toe
```

## Toolchain Setup

JavaScript dependencies are installed per package. There is no root `npm install`.

Minimum tools:

- Node.js and npm for examples, generated code, tests, and simulator UI.
- A host C compiler for ESP32 builds because the build compiles the XS bytecode compiler locally.
- ESP-IDF v5.4 or newer for ESP32 build, flash, monitor, and OTA.
- Emscripten `emcc` for browser simulator WASM builds.

Typical package installs:

```bash
cd examples/tic-tac-toe
npm install

cd ../../simulator
npm install
```

ESP-IDF must be available in the shell for ESP32 commands. The helper script auto-sources common install paths, but you can also source it yourself:

```bash
. ~/esp/esp-idf/export.sh
idf.py --version
```

If ESP-IDF lives somewhere custom, set:

```bash
export GEA_EMBEDDED_IDF_EXPORT=/absolute/path/to/esp-idf/export.sh
```

Emscripten must be on `PATH` for web builds:

```bash
source ~/emscripten/emsdk/emsdk_env.sh
emcc --version
```

## App Types

Apps are declared in `examples/apps.json`.

There are two simulator runtime types:

- `app-render`: TSX apps using `mount(App)`. These compile to generated C plus thin JS. Examples: `typography`, `tic-tac-toe`, `bouncing-balls-jsx`, `tilt-breakout`, `settings`, `analog-clock`.
- `screen`: raw drawing apps using `screen.*` and `requestAnimationFrame`. These use the shared screen runtime. Examples: `bouncing-balls`, `image-demo`.

The device mirror described below works for `app-render` store-backed apps. Use `bouncing-balls-jsx` for the bouncing balls mirror test, not raw `bouncing-balls`.

## Building Examples

Build an example package by entering the example directory:

```bash
cd examples/bouncing-balls-jsx
npm install
npm run build
```

For `app-render` examples, the Vite plugin emits:

- `dist/index.js`: thin JavaScript bundle for ESP32.
- `gea_embedded_app_generated.c`: generated C app runtime, usually routed into a target build directory.

For browser simulation, use the root web target script instead:

```bash
./targets/web/build-web.sh bouncing-balls-jsx
```

This produces:

- `simulator/public/apps/<app>/app.js`
- `simulator/public/apps/<app>/module.wasm`
- `targets/web/generated/<app>/gea_embedded_app_generated.c`
- `targets/web/dist/<app>/module.js`
- `targets/web/dist/<app>/module.wasm`

For `screen` apps, build the shared runtime once:

```bash
./targets/web/build-screen-runtime.sh
./targets/web/build-web.sh bouncing-balls
```

The `build-web.sh` script skips per-app WASM for `screen` apps because they use `simulator/public/screen-runtime/module.wasm`.

## Browser Simulator

The simulator is in `simulator/`.

```bash
cd simulator
npm install
npm run dev
```

Open the printed local URL. For a production-style local preview:

```bash
npm run build
npm start
```

The simulator reads `examples/apps.json` and lets you pick an app, viewport size, zoom level, and transport.

### Simulator Transports

`Direct framebuffer`

Runs the app WASM inside the simulator page and paints the local framebuffer directly. This is the simplest mode for checking rendering and input.

`Device mirror`

Connects to an ESP32 through the simulator's Node/Vite backend. The ESP32 streams store snapshots and diffs over TCP. The browser applies those store updates to its own local WASM app and renders the framebuffer locally. This is the hardware mirror mode.

The browser cannot accept raw TCP connections from the board, so the simulator dev/preview server provides a relay:

- Browser connects to `/mirror/events` with Server-Sent Events.
- Browser posts connect/disconnect requests to `/mirror/connect` and `/mirror/disconnect`.
- Node connects to the board TCP mirror server at `<board-ip>:8082`.

## ESP32 Workflow

The ESP32 target is `targets/esp32-s3-touch-amoled-2.06/`.

Use the helper script from the repo root:

```bash
./scripts/esp32s3-touch-amoled-2.06.sh <command> [--app=<name>] [PORT|auto|IP]
```

Commands:

```text
setup                    Set ESP-IDF target to esp32s3
build [--app=<name>]     Compile firmware
flash [PORT|auto]        Build and flash via USB
monitor [PORT|auto]      Open serial monitor
flash-monitor [PORT]     Build, flash, then monitor via USB
ota <IP>                 Build and flash wirelessly through port 8080
ota-monitor <IP>         OTA flash, then connect to log stream on port 8081
list-apps                Print ESP32-enabled app ids
fullclean                Remove ESP-IDF build artifacts
```

The `--app` value is an app id from `examples/apps.json`. If omitted, the script defaults to `tic-tac-toe`.

First-time setup and USB flash:

```bash
./scripts/esp32s3-touch-amoled-2.06.sh setup
./scripts/esp32s3-touch-amoled-2.06.sh flash-monitor auto --app=bouncing-balls-jsx
```

Press `Ctrl-]` to exit the ESP-IDF serial monitor.

## Wi-Fi And OTA

For wireless OTA and hardware mirror, the board must join the same network as your computer.

Create Wi-Fi config once:

```bash
cp targets/esp32-s3-touch-amoled-2.06/main/include/wifi_config.h.example \
   targets/esp32-s3-touch-amoled-2.06/main/include/wifi_config.h
```

Edit `wifi_config.h` with your SSID and password. This file is gitignored.

Flash once over USB so the credentials are on the board:

```bash
./scripts/esp32s3-touch-amoled-2.06.sh flash-monitor auto --app=bouncing-balls-jsx
```

Watch the serial log for the board IP. After that, you can OTA:

```bash
./scripts/esp32s3-touch-amoled-2.06.sh ota <board-ip> --app=bouncing-balls-jsx
```

Or OTA and follow logs wirelessly:

```bash
./scripts/esp32s3-touch-amoled-2.06.sh ota-monitor <board-ip> --app=bouncing-balls-jsx
```

Network ports used by the firmware:

```text
8080  OTA firmware upload endpoint
8081  TCP log stream
8082  TCP store mirror stream for app-render device mirror
```

## Device Mirror

Device mirror is for live mirrored UI from hardware without streaming pixels.

Architecture:

```text
ESP32 runs the app authoritatively
        |
        | store snapshot/diff JSON lines over TCP :8082
        v
Simulator Node/Vite backend
        |
        | Server-Sent Events to browser
        v
Browser simulator applies store updates to local WASM
        |
        v
Local framebuffer render
```

The ESP32 does not stream the RGB565 framebuffer. It streams store state. The simulator already has the same generated C/WASM app, so it can rebuild the UI locally from those store updates.

### Mirror Bouncing Balls

Build the browser app:

```bash
./targets/web/build-web.sh bouncing-balls-jsx
```

Flash the hardware app:

```bash
./scripts/esp32s3-touch-amoled-2.06.sh flash-monitor auto --app=bouncing-balls-jsx
```

Or, after the board is already on Wi-Fi:

```bash
./scripts/esp32s3-touch-amoled-2.06.sh ota-monitor <board-ip> --app=bouncing-balls-jsx
```

Start the simulator:

```bash
cd simulator
npm run dev
```

In the simulator:

1. App: `bouncing-balls-jsx`
2. Transport: `Device mirror`
3. Board IP: the IP printed by the ESP32 logs
4. Port: `8082`
5. Click `Render`

Expected status text looks like:

```text
Device mirror bouncing-balls-jsx: diff, 1 field, 50 items.
```

If the mirror connects but the simulator view does not move, confirm the ESP32 is running the same app id you built for web. Device mirror expects matching generated store field ids.

### Mirror Limitations

- Works for `app-render` store-backed apps.
- Does not mirror raw `screen` drawing apps yet.
- The browser does not send touch events back to the device in mirror mode yet.
- The ESP32 stream is newline-delimited JSON over TCP, not WebSocket.
- The Node relay is part of the simulator Vite dev/preview server.

## Testing And Checks

Simulator checks:

```bash
cd simulator
npm run check
npm test
npm run build
```

Focused simulator tests:

```bash
npm test -- --run src/app-runtime.test.ts src/manifest.test.ts
```

Plugin TypeScript check:

```bash
cd lib
npx tsc --noEmit
```

Example package check:

```bash
cd examples/tic-tac-toe
npm run check
npm test -- --run test/vite-plugin-gea-embedded.test.ts
```

ESP32 build check:

```bash
./scripts/esp32s3-touch-amoled-2.06.sh build --app=bouncing-balls-jsx
```

## Troubleshooting

`Missing built WASM module`

Run the web build for the selected app:

```bash
./targets/web/build-web.sh <app-id>
```

`Missing screen runtime WASM module`

Build the shared screen runtime:

```bash
./targets/web/build-screen-runtime.sh
```

`ESP-IDF is not ready in this shell`

Source ESP-IDF or set `GEA_EMBEDDED_IDF_EXPORT`:

```bash
. ~/esp/esp-idf/export.sh
```

`Device mirror cannot connect`

Check:

- The ESP32 is running an `app-render` app.
- The board and computer are on the same Wi-Fi network.
- The board IP is correct.
- Port `8082` is reachable from the computer.
- You started the simulator through `npm run dev` or `npm start`, not by opening `dist/index.html` directly.

You can test the raw mirror stream from a terminal:

```bash
nc <board-ip> 8082
```

You should see newline-delimited JSON containing a `snapshot` first, then `diff` messages as the app state changes.

`OTA fails`

Check that the board is reachable and that it was first flashed with Wi-Fi credentials:

```bash
ping <board-ip>
nc -vz <board-ip> 8080
```

`Logs do not stream after OTA`

The `ota-monitor` command reconnects with `nc <board-ip> 8081` after a short delay. If Wi-Fi reconnect is slow, run:

```bash
nc <board-ip> 8081
```

`Device mirror shows stale or wrong UI`

Rebuild both sides with the same app id:

```bash
./targets/web/build-web.sh bouncing-balls-jsx
./scripts/esp32s3-touch-amoled-2.06.sh ota-monitor <board-ip> --app=bouncing-balls-jsx
```

The mirror protocol uses generated store field ids, so mismatched app builds can apply the wrong values.

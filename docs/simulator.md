# Simulator

The simulator is a browser UI for running and inspecting apps through WASM.

It lives in `simulator/` and reads app metadata from `examples/apps.json`.

## Setup

```bash
cd simulator
npm install
npm run dev
```

Open the local URL printed by Vite.

For a production-style local preview:

```bash
npm run build
npm start
```

## App Artifacts

For `app-render` apps, build app-specific WASM before selecting the app:

```bash
./targets/web/build-web.sh tic-tac-toe
```

Expected outputs:

```text
simulator/public/apps/<app>/app.js
simulator/public/apps/<app>/module.wasm
targets/web/generated/<app>/gea_embedded_app_generated.c
targets/web/dist/<app>/module.js
targets/web/dist/<app>/module.wasm
```

For `screen` apps, build the shared screen runtime first:

```bash
./targets/web/build-screen-runtime.sh
./targets/web/build-web.sh bouncing-balls
```

Expected shared output:

```text
simulator/public/screen-runtime/module.wasm
```

To refresh every browser-enabled app in the simulator:

```bash
./targets/web/build-screen-runtime.sh
node -e "const m=require('./examples/apps.json'); for (const a of m.apps.filter(a => a.targets?.web?.enabled)) console.log(a.id)" \
  | xargs -n1 ./targets/web/build-web.sh
```

## Controls

The simulator UI lets you choose:

- app id
- viewport width and height
- zoom
- transport
- device mirror host and port
- simulated Wi-Fi state

For `app-render` apps, pointer input is sent through the app touch and hit-test entrypoints in direct mode. In Device mirror mode, the board is authoritative and browser touches are not sent back to hardware yet.

Keyboard tilt uses arrow keys or WASD. The simulator exposes tilt and acceleration through the web IMU shim.

## Direct Framebuffer

Direct mode loads the app WASM in the page:

```text
browser page -> app WASM -> RGB565 framebuffer -> canvas
```

Use this for quick UI checks and input testing.

## Device Mirror

Device mirror connects to ESP32 hardware through the simulator Vite backend:

```text
ESP32 :8082 -> Vite TCP relay -> /mirror/events SSE -> browser -> local app WASM
```

Steps:

```bash
./targets/web/build-web.sh bouncing-balls-jsx
./scripts/esp32s3-touch-amoled-2.06.sh ota-monitor <board-ip> --app=bouncing-balls-jsx

cd simulator
npm run dev
```

Then select:

```text
App: bouncing-balls-jsx
Transport: Device mirror
Board IP: <board-ip>
Port: 8082
```

Click `Render`.

The mirror mode is available for `app-render` apps only. If you select a `screen` app, the simulator falls back to direct mode and reports that Device mirror is only available for `app-render`.

## Mirror Relay API

The Vite config installs middleware for:

```text
GET  /mirror/events
GET  /mirror/status
POST /mirror/connect
POST /mirror/disconnect
```

Quick status probe:

```bash
curl http://127.0.0.1:5173/mirror/status
```

The port may differ if Vite chooses another one.

## Common Blank-Screen Causes

- The selected app has not been built with `./targets/web/build-web.sh <app-id>`.
- A `screen` app is selected but `./targets/web/build-screen-runtime.sh` was not run.
- Browser cached old app assets; rebuild and hard-refresh.
- The app id in `examples/apps.json` does not match the Vite config app id.
- The web build and ESP32 firmware were built from different store definitions.

## Useful Checks

```bash
cd simulator
npm run check
npm test
npm run build
```

Focused transport tests:

```bash
npm test -- --run src/app-runtime.test.ts src/manifest.test.ts
```

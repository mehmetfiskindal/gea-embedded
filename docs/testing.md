# Testing

There is no single root test command. Run checks for the area you changed.

## Simulator

```bash
cd simulator
npm install
npm run check
npm test
npm run build
```

Focused simulator smoke:

```bash
npm test -- --run src/app-runtime.test.ts src/manifest.test.ts
```

Run these when changing:

- simulator UI
- app manifest loading
- WASM runtime exports
- direct framebuffer presentation
- device mirror browser runtime or Vite relay

## Vite Plugin And Generated Code

```bash
cd lib
npm install
npx tsc --noEmit
```

Compiler behavior is mostly covered by example package tests. A common focused check:

```bash
cd examples/tic-tac-toe
npm install
npm run check
npm test -- --run test/vite-plugin-gea-embedded.test.ts
```

Run these when changing:

- AST collection
- store compiler
- JSX/template compiler
- generated C
- generated fonts
- public `gea-embedded` types

## Web/WASM Builds

For an `app-render` app:

```bash
./targets/web/build-web.sh bouncing-balls-jsx
```

For a `screen` app:

```bash
./targets/web/build-screen-runtime.sh
./targets/web/build-web.sh bouncing-balls
```

Run these when changing:

- generated C exports
- web display shims
- WASM exported functions
- shared UI/raster/image code
- simulator app loading

## ESP32 Build

```bash
./scripts/esp32s3-touch-amoled-2.06.sh build --app=bouncing-balls-jsx
```

For raw screen runtime coverage:

```bash
./scripts/esp32s3-touch-amoled-2.06.sh build --app=bouncing-balls
```

Run these when changing:

- ESP32 target code
- shared C runtime
- generated C signatures
- Wi-Fi, OTA, log, mirror server code
- display or touch integration

## Hardware Smoke

USB:

```bash
./scripts/esp32s3-touch-amoled-2.06.sh flash-monitor auto --app=tic-tac-toe
```

OTA:

```bash
./scripts/esp32s3-touch-amoled-2.06.sh ota-monitor <board-ip> --app=tic-tac-toe
```

Device mirror:

```bash
./targets/web/build-web.sh bouncing-balls-jsx
./scripts/esp32s3-touch-amoled-2.06.sh ota-monitor <board-ip> --app=bouncing-balls-jsx
cd simulator
npm run dev
```

Then select `bouncing-balls-jsx` and `Device mirror`.

## Suggested Matrix

Compiler-only change:

```text
lib typecheck
example compiler test
one app-render web build
one app-render ESP32 build
```

Simulator transport change:

```text
simulator typecheck
simulator tests
simulator production build
manual direct framebuffer smoke
manual Device mirror smoke if the mirror transport changed
```

Shared C runtime change:

```text
one app-render web build
one screen runtime web build
one app-render ESP32 build
one screen ESP32 build
manual simulator smoke
```

ESP32 networking change:

```text
ESP32 app-render build
USB flash-monitor once
OTA or ota-monitor
nc probes for ports 8080, 8081, 8082
```

Docs-only change:

```text
markdown sanity read
no build required unless commands were changed
```

## Before Trusting Device Mirror

1. Build web app:

```bash
./targets/web/build-web.sh bouncing-balls-jsx
```

2. Build or flash the same app id to ESP32:

```bash
./scripts/esp32s3-touch-amoled-2.06.sh build --app=bouncing-balls-jsx
```

3. Check raw mirror output:

```bash
nc <board-ip> 8082
```

4. Run simulator and connect through Device mirror.

If the raw stream looks right but the UI is stale, rebuild both sides from the same source.

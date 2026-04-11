# Troubleshooting

This page is organized by symptom.

## App Missing From Simulator

Check `examples/apps.json`:

- app id exists
- `targets.web.enabled` is `true`
- `runtime` is `app-render` or `screen`
- `root` and `entry` point to real files

Then restart the simulator dev server.

## Missing Built WASM Module

For an `app-render` app:

```bash
./targets/web/build-web.sh <app-id>
```

Confirm:

```text
simulator/public/apps/<app-id>/module.wasm
```

## Missing Screen Runtime WASM

For a `screen` app:

```bash
./targets/web/build-screen-runtime.sh
./targets/web/build-web.sh <app-id>
```

Confirm:

```text
simulator/public/screen-runtime/module.wasm
```

## Web Build Says Unknown App

The app id passed to `build-web.sh` must match `examples/apps.json` exactly:

```bash
./targets/web/build-web.sh tic-tac-toe
```

Use:

```bash
node -e "const m=require('./examples/apps.json'); console.log(m.apps.map(a=>a.id).join('\n'))"
```

## ESP-IDF Is Not Ready

Source ESP-IDF:

```bash
. ~/esp/esp-idf/export.sh
```

Or set:

```bash
export GEA_EMBEDDED_IDF_EXPORT=/absolute/path/to/esp-idf/export.sh
```

Then retry:

```bash
./scripts/esp32s3-touch-amoled-2.06.sh build --app=tic-tac-toe
```

## ESP32 Build Cannot Find App

Check the manifest:

- app id exists
- `targets.esp32.enabled` is `true`
- app package has dependencies installed
- app package has a valid `npm run build`

Then force CMake to re-resolve the app:

```bash
./scripts/esp32s3-touch-amoled-2.06.sh build --app=<app-id>
```

The helper passes `-DGEA_EMBEDDED_APP=<app-id>` and runs `idf.py reconfigure`.

## USB Flash Cannot Find Port

Try auto first:

```bash
./scripts/esp32s3-touch-amoled-2.06.sh flash-monitor auto --app=tic-tac-toe
```

If that fails, list serial devices and pass the port explicitly:

```bash
ls /dev/cu.*
./scripts/esp32s3-touch-amoled-2.06.sh flash-monitor /dev/cu.usbmodem1101 --app=tic-tac-toe
```

## OTA Fails

Check reachability:

```bash
ping <board-ip>
nc -vz <board-ip> 8080
```

Make sure the board was first flashed over USB with a valid `wifi_config.h`.

The OTA endpoint is:

```text
POST http://<board-ip>:8080/ota
```

The helper command sends:

```bash
curl -X POST "http://<board-ip>:8080/ota" --data-binary @build/gea_embedded.bin
```

## Logs Do Not Stream After OTA

The board may still be rebooting or reconnecting to Wi-Fi.

Try:

```bash
nc <board-ip> 8081
```

If that works, rerun:

```bash
./scripts/esp32s3-touch-amoled-2.06.sh ota-monitor <board-ip> --app=<app-id>
```

## Device Mirror Cannot Connect

Check:

- ESP32 is running an `app-render` app.
- Board and computer are on the same Wi-Fi network.
- Board IP is correct.
- Port `8082` is reachable.
- Simulator was started with `npm run dev` or `npm start`.

Probe:

```bash
nc -vz <board-ip> 8082
```

Then inspect the raw stream:

```bash
nc <board-ip> 8082
```

You should see a `snapshot` JSON line first.

Reconnect should open a fresh TCP connection and replace the previous mirror client on the board. If reconnect still appears inert, restart the simulator relay and confirm the board logs show a new `Store mirror client connected` line.

If board logs show `Store mirror send backpressure: errno=11`, the browser/relay side is not draining the TCP stream as quickly as the board is producing mirror messages. The firmware keeps the current JSON line pending, backs off, and retries instead of dropping the connection.

Older firmware logged `Store mirror client disconnected during diff: errno=11` for the same condition. Rebuild and OTA the firmware if you still see that line repeatedly.

## Device Mirror Connects But UI Does Not Move

Most likely web WASM and ESP32 firmware were built from different generated store definitions.

Rebuild both sides:

```bash
./targets/web/build-web.sh bouncing-balls-jsx
./scripts/esp32s3-touch-amoled-2.06.sh ota-monitor <board-ip> --app=bouncing-balls-jsx
```

Also confirm the simulator selected the same app id that was flashed.

For `app-launcher`, rebuild both sides with `app-launcher`. The launcher mirror is heavier than a single demo app because its generated store ids include all compiled panels, so mismatched web/firmware builds are easier to notice.

## Device Mirror Shows Wrong Colors In Array Items

Current mirror setters apply numeric array subfields but do not apply string array subfields. Initialize array strings consistently on both sides, or keep mirrored array state numeric until string array setter support is added.

## Screen App Does Not Mirror

Expected. Device mirror only supports `app-render` store-backed apps.

Use the JSX app variant, for example:

```text
bouncing-balls-jsx
```

## Simulator Port Conflict

Vite may pick another port automatically. Use the URL printed by `npm run dev`.

If you are probing mirror status, adjust the port:

```bash
curl http://127.0.0.1:<vite-port>/mirror/status
```

## Generated C Looks Stale

Rebuild from the app package or target script:

```bash
cd examples/<app>
npm run build
```

For web-generated C:

```bash
./targets/web/build-web.sh <app-id>
```

For ESP32-generated C:

```bash
./scripts/esp32s3-touch-amoled-2.06.sh build --app=<app-id>
```

Do not patch generated C by hand.

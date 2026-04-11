# Device Mirror Protocol

Device mirror provides a live hardware-backed simulator view without streaming framebuffer pixels.

The ESP32 runs the app authoritatively. It streams generated store state. The simulator already has the same generated app compiled to WASM, so the browser applies the store updates locally and renders its own framebuffer.

## Transport

```text
ESP32 diagnostics TCP server :8081
    |
    | framed binary stream (logs + mirror)
    v
Simulator Vite backend relay
    |
    | decoded mirror records over SSE
    v
Browser mirror runtime
    |
    | mirror setters into local WASM
    v
Local framebuffer render
```

The browser does not open a raw TCP socket. The simulator dev/preview server acts as the relay.

## Firmware Server

The ESP32 target starts the mirror server for `app-render` apps after Wi-Fi is ready.

Constants in `targets/esp32-s3-touch-amoled-2.06/main/app_main.c`:

```text
DIAG_PORT               8081
DIAG_MAX_FRAME_PAYLOAD 1024
DIAG_MIRROR_INTERVAL_MS 100
```

The diagnostics server serves one active TCP client at a time. A new connection replaces the previous client so simulator reconnects can recover from stale sockets.

Frame header:

```text
byte 0: channel
byte 1: type (currently informational)
byte 2: payload length (low byte)
byte 3: payload length (high byte)
```

Channels:

- `1`: log bytes
- `2`: mirror records

Mirror streaming is enabled lazily by sending command byte `M` from client to device. Without that command, the server only streams logs and does not allocate mirror staging memory.

## Simulator Relay Endpoints

Implemented in `simulator/vite.config.ts`:

```text
GET  /mirror/events       SSE stream to browser
GET  /mirror/status       Current relay status JSON
POST /mirror/connect      Body: {"host":"<board-ip>","port":8081}
POST /mirror/disconnect   Close current TCP connection
```

The browser mirror runtime opens `/mirror/events`, then posts to `/mirror/connect`.

If the TCP socket closes while the browser still has an active SSE subscriber, the relay retries the board connection automatically.

When the last browser mirror viewer closes, the relay also closes its board TCP socket so the board is not streaming into an unwatched relay.

## Mirror Record Format

The board sends mirror records as binary payloads on diagnostics channel `2`.

Record kinds:

```text
1  begin      [kind=1][messageType][appIdLen][appId bytes]
2  int        [kind=2][field u16][value i32]
3  string     [kind=3][field u16][len u16][utf8 bytes]
4  array_len  [kind=4][field u16][len u16]
5  array_int  [kind=5][field u16][index u16][subfield u8][value i32]
6  end        [kind=6]
7  error      [kind=7][messageLen u8][utf8 bytes]
8  scroll     [kind=8][node u16][scrollY i32]
```

`field` is generated from store instance order and field order. It is the stable mirror key used by local WASM mirror setters for a matching build.
`node` is the generated UI node id for a scrollable view. It is applied only against a matching app build, just like store fields.

## Generated C API

Generated app C exports:

```c
int gea_embedded_app_mirror_begin_snapshot(void);
int gea_embedded_app_mirror_begin_diff(void);
int gea_embedded_app_mirror_next_record(unsigned char *dst, int cap);
void gea_embedded_app_mirror_clear_dirty(void);
void gea_embedded_app_mirror_set_int(int field, int value);
void gea_embedded_app_mirror_set_string(int field, const char *value);
void gea_embedded_app_mirror_set_array_len(int field, int len);
void gea_embedded_app_mirror_set_array_int(int field, int index, int subfield, int value);
void gea_embedded_app_mirror_commit(void);
```

On hardware, mirror begin/next stream small binary records instead of full JSON snapshots.

In the simulator, the web target exposes wrapper names through Emscripten:

```text
app_mirror_set_int
app_mirror_set_string
app_mirror_set_array_len
app_mirror_set_array_int
app_mirror_commit
```

The browser calls these wrappers via `ccall`, then calls `app_mirror_commit` to run a local binding update and render the new framebuffer.

## Dirty Fields

Generated stores track two dirty bitsets:

- normal render dirty fields
- mirror dirty fields

This lets hardware render and mirror diffing proceed independently. A snapshot clears mirror dirty state so the next message only contains changes after the client connected.

Large apps such as `app-launcher` can produce much larger snapshots and diffs because they include store state from every compiled panel. The ESP32 target therefore mirrors at a lower cadence than the display frame loop and uses a larger line buffer than simple demos need.

## Manual Inspection

After flashing an `app-render` app with Wi-Fi enabled:

```bash
nc <board-ip> 8081
```

Expected behavior:

1. Binary frame headers and payloads stream continuously.
2. Log channel frames are printable as UTF-8.
3. Mirror channel frames are binary records; relay decodes them for browser SSE.

## Compatibility Rules

- Build the same app id for web and ESP32 before testing.
- Do not mix old simulator WASM with freshly flashed firmware.
- Do not rename or reorder store fields without rebuilding both sides.
- Protocol consumers should ignore unknown fields and unknown top-level properties.
- Version `1` does not include browser-to-device input.

## Current Limitations

- One-way state flow from hardware to browser.
- No touch forwarding from simulator to device.
- No raw framebuffer streaming.
- No mirror for `screen` apps.
- Array string subfield application is not implemented in the browser mirror setters.

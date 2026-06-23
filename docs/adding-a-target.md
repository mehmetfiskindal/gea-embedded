# Adding A Target

This is a checklist for adding another hardware target or runtime target.

Start by deciding which app families the target will support:

- `app-render`: generated C UI runtime.
- `screen`: XS JavaScript runtime with raw drawing host functions.
- both.

Supporting `app-render` first is usually simpler for a UI device because the app loop, input dispatch, layout, render, stores, and mirror helpers are generated C.

## Target Directory

Create a target directory under `targets/`:

```text
targets/<target-name>/
  CMakeLists.txt or build files
  main/
    app_main.c or equivalent entrypoint
    display.c
    include/display.h
    touch.c
    include/touch.h
```

Use the ESP32 target as the current reference:

```text
targets/esp32-s3-touch-amoled-2.06/
```

## Display Contract

The shared UI and raster code expect display functions like:

```c
void gea_embedded_display_clear(void);
void gea_embedded_display_flush(void);
void gea_embedded_display_fill_rect(int x, int y, int w, int h, uint16_t color);
void gea_embedded_display_stroke_rect(int x, int y, int w, int h, uint16_t color);
void gea_embedded_display_fill_circle(int cx, int cy, int r, uint16_t color);
void gea_embedded_display_stroke_circle(int cx, int cy, int r, uint16_t color);
void gea_embedded_display_draw_line(int x0, int y0, int x1, int y1, uint16_t color);
void gea_embedded_display_draw_text(const char *text, int x, int y, uint16_t color, float scale);
void gea_embedded_display_set_pixel(int x, int y, uint16_t color);
```

Also implement clipping, alpha, rounded rects, and image blitting if you want parity with current examples.

Color format is RGB565.

## App-Render Entrypoints

Generated app C provides:

```c
void gea_embedded_app_init(int w, int h);
void gea_embedded_app_frame(int timestamp_ms);
void gea_embedded_app_touch(int press_id);
void gea_embedded_app_touch_start_element(int press_id, int x, int y);
void gea_embedded_app_touch_end_element(int press_id, int x, int y);
void gea_embedded_app_touch_move_element(int press_id, int x, int y);
void gea_embedded_app_touch_start(int x, int y);
void gea_embedded_app_touch_move(int x, int y);
void gea_embedded_app_touch_end(int x, int y);
```

A target frame loop should:

1. initialize display and input
2. call `gea_embedded_app_init(width, height)`
3. call `gea_embedded_app_frame(timestamp_ms)` on a timer
4. call touch entrypoints from input events
5. flush display as needed

Use `gea_embedded_ui_hit_test(x, y)` to resolve press ids for touch-up/click behavior.

## Screen Runtime Support

To support `screen` apps, expose host functions for the screen drawing API and run the app JS through XS or another JS runtime.

The ESP32 target registers native functions for:

- `screen.print`
- `screen.clear`
- `screen.fillRect`
- `screen.strokeRect`
- `screen.fillCircle`
- `screen.strokeCircle`
- `screen.drawLine`
- `screen.drawArc`
- `screen.fillTriangle`
- `screen.drawText`
- `screen.setPixel`
- `screen.color`
- `screen.flush`
- `screen.pushClip`
- `screen.popClip`
- `screen.setAlpha`
- `screen.fillRoundedRect`
- `screen.strokeRoundedRect`

## Manifest Integration

Add a target flag to apps that support the new target:

```json
"targets": {
  "web": { "enabled": true },
  "esp32": { "enabled": true },
  "myTarget": { "enabled": true }
}
```

Then add a script or build resolver that reads `examples/apps.json`, validates the app id, checks the target flag, and passes the selected app into the target build.

## Generated C Output

Each app Vite config controls where generated C is written through `cOutput`.

For a new target, decide where target builds should expect:

```text
gea_embedded_app_generated.c
gea_embedded_app_config.h
gea_embedded_font_generated.c
gea_embedded_font_generated.h
```

Then update app Vite configs or create a target build path that sets the correct environment variables.

## Native API Shims

Implement or stub the native APIs apps can import:

- time: `gea_embedded_now_ms`
- image decode/draw
- Wi-Fi state
- BLE state and HID helpers
- accelerometer/IMU
- touch
- fetch/networking if screen apps need it

Stubs are acceptable for early bring-up if they fail harmlessly.

## Device Mirror Support

If the target supports `app-render`, device mirror can be added by exposing a transport around generated mirror stream functions:

```c
gea_embedded_app_mirror_begin_snapshot(...)
gea_embedded_app_mirror_begin_diff(...)
gea_embedded_app_mirror_next_record(...)
gea_embedded_app_mirror_clear_dirty()
```

For browser simulator compatibility, either:

- serve newline-delimited JSON over TCP like the ESP32 target, or
- add a new simulator relay for the target transport.

Keep the same JSON message schema where possible.

## Bring-Up Order

1. Compile shared C runtime with a blank generated app.
2. Initialize display and draw primitive test shapes.
3. Run `gea_embedded_app_init` for a static `app-render` app.
4. Add frame timer and touch dispatch.
5. Build and run a simple store app such as `tic-tac-toe`.
6. Add image/font support.
7. Add Wi-Fi/BLE/IMU shims as needed.
8. Add device mirror if the target has networking or another relayable transport.
9. Add target docs and tests.

## Verification

At minimum:

```text
static app-render app builds
animated app-render app builds
touch app works
screen app builds, if supported
simulator web build still works
target clean build works from repo root
```

## Worked Example: Raspberry Pi (Pi Zero W v1.1 + Waveshare 7" LCD (C))

The `targets/rpi-display-1/` target is the canonical reference for a
**Linux userspace** target. Where the ESP32 AMOLED target is bare-metal
FreeRTOS with custom SPI/QSPI drivers, the Pi target uses `/dev/fb0`,
`/dev/input/eventN`, and glibc. Most of the bring-up sequence is the
same; the differences are listed here so future maintainers can follow
the path.

### What changed versus the ESP32 target

| Concern | ESP32 | Pi |
| ------- | ----- | -- |
| App | `app_main()` over FreeRTOS, with separate `display_task` and `touch_task` | Single `main()` with a `poll()` loop on one thread |
| Display driver | `esp_lcd_panel_*` with QSPI DMA | `mmap` on `/dev/fb0` + occasional `FBIO_WAITFORVSYNC` |
| Input | `i2c_master` over FT6x36 | `read()` on `/dev/input/eventN` with MT-B filtering |
| JS runtime | Moddable XS, AOT bytecode | QuickJS (vendored under `vendor/quickjs/`) |
| HTTP fetch | `esp_http_client` (HTTPS via mbedtls) | `libcurl` (HTTPS optional, default off on Pi Zero) |
| OTA | Two-slot A/B partition table | None in v1; `geat-rpi.sh install` does `rsync` |
| Mirror | TCP 8082 + simulator relay | TCP 8082, identical JSON schema |

### Files unique to the Pi target

```
targets/rpi-display-1/
├── CMakeLists.txt                # system compiler, conditional KMS / libcurl
├── cmake/
│   ├── rpi.toolchain.cmake       # arm-linux-gnueabihf
│   ├── FindKMS.cmake
│   ├── FindQuickJS.cmake
│   └── FindLibInput.cmake
├── main/
│   ├── app_main.c                # poll-based loop, dirty-rect aware
│   ├── app_main_screen.c         # QuickJS entry (screen runtime)
│   ├── display.c                 # dispatcher; binds shared/raster to a 410×502 (compat) or 1024×600 (native) surface
│   ├── display_linuxfb.c         # primary; mmap fb, ARGB→RGB565 swizzle LUT
│   ├── display_kms.c             # stub (Phase 2)
│   ├── input.c                   # evdev + MT-B filter
│   ├── platform.c                # POSIX time / sleep / mmap
│   ├── log.c                     # leveled + TCP stream on 8081
│   ├── wifi.c                    # nmcli parser
│   ├── imu.c, mirror.c, ota.c    # stubs
│   ├── assets.c                  # load from /opt/gea-embedded/apps/<id>/
│   ├── quickjs_shim.{c,h}        # screen.* / WiFi.* host bindings
│   └── include/                  # display.h, input.h, log.h, ...
├── scripts/
│   ├── geat-rpi.sh
│   └── install-zero.sh
├── systemd/
│   └── gea-embedded.service
└── README.md
```

### Display contract adaptations

The shared `display.c` binds `gea_embedded_raster_t` to a back buffer
sized either 410×502 (compat viewport, letterboxed) or 1024×600
(native). The ESP32 display contract — `gea_embedded_display_fill_rect`,
`_draw_text`, etc. — is preserved 1-for-1; the wrappers in `display.c`
just forward to `gea_embedded_raster_*`. The actual panel push lives
in `display_linuxfb.c` (or `display_kms.c` when KMS lands).

`display_linuxfb.c` allocates two 16-bit shadows: one for the app
viewport (compat or native) and one for the panel. The linuxfb backend
converts RGB565 to the panel's native pixel format (RGB565 or ARGB8888)
via a 64 K-entry LUT, copies only the dirty region, and uses
`FBIO_WAITFORVSYNC` for vsync when the kernel supports it.

### Compat viewport and 410×502 letterbox

The existing app-render apps hardcode `<div style={{ width: 410, height: 502 }}>`.
To avoid re-authoring 16 apps, the Pi target runs them in **compat
viewport** mode: the raster binds to a 410×502 surface, the app
renders into it, and on `flush()` the linuxfb backend copies the
dirty region centered into the 1024×600 panel buffer (with letterbox
padding). The resulting framebuffer, when compared pixel-for-pixel
against the simulator output for a centered 410×502 region, matches
exactly.

### Build flow

The Pi target's `CMakeLists.txt` mirrors the ESP32 one's `vite_build`
custom command: when app sources change, `npm run build` runs in the
app directory and produces the generated C plus thin JS. For
app-render apps (the v1 default), the JS bundle is not linked. For
screen-runtime apps, the JS bundle is fed through `qjsc` to produce
bytecode that is linked into the binary as a C array.

The v1 build system compiles natively on the Pi (arm-linux-gnueabihf
host toolchain), and cross-compile is supported via
`cmake/rpi.toolchain.cmake` plus a sysroot extracted from
`balenalib/raspberry-pi-debian:bookworm-run`.

### Bringing up a new app

After the target compiles, adding a new app is identical to the
ESP32 path:

1. Add `targets.rpi` block to `examples/apps.json`:
   ```json
   "rpi": { "enabled": true, "viewport": "compat", "min_fps": 30 }
   ```
2. Build with `--app=<id>`:
   ```bash
   ./targets/rpi-display-1/scripts/geat-rpi.sh build --app=<id>
   ```
3. Run on the Pi:
   ```bash
   ./targets/rpi-display-1/scripts/geat-rpi.sh install pi@raspberrypi.local --app=<id>
   ./targets/rpi-display-1/scripts/geat-rpi.sh run    pi@raspberrypi.local --app=<id>
   ```

The simulator and ESP32 target are unaffected: their `targets` flags
in `apps.json` are independent of the new `rpi` block.

### Verification at bring-up

- [ ] Display init logs `using linuxfb backend (viewport 1024x600)` at boot.
- [ ] `tvservice -s` on the Pi reports 1024×768 60Hz (reduced blank).
- [ ] `evtest /dev/input/eventN` shows ABS_MT_* events from the LCD.
- [ ] `tic-tac-toe` runs, USB mouse moves through the letterboxed viewport.
- [ ] Framebuffer capture diff against simulator `tic-tac-toe` is 0 pixels.

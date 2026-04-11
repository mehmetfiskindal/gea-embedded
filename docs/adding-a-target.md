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

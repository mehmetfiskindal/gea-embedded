# Screen Apps

`screen` apps draw directly into a framebuffer through a JavaScript global named `screen`.

Use this runtime when you want low-level drawing control or a simple demo without the retained TSX UI tree.

Use `app-render` when you want components, layout, stores, input bindings, generated C, or device mirror.

## Manifest Entry

```json
{
  "id": "bouncing-balls",
  "root": "examples/bouncing-balls",
  "entry": "index.ts",
  "runtime": "screen",
  "targets": {
    "web": { "enabled": true },
    "esp32": { "enabled": true }
  }
}
```

## Basic Shape

```ts
declare const screen: {
  readonly width: number
  readonly height: number
  color(r: number, g: number, b: number): number
  clear(): void
  fillCircle(x: number, y: number, r: number, color: number): void
}

declare function requestAnimationFrame(cb: (timestampMs: number) => void): number

const red = screen.color(255, 0, 0)

requestAnimationFrame(function frame() {
  screen.clear()
  screen.fillCircle(80, 80, 12, red)
})
```

`examples/bouncing-balls` wraps these globals in a tiny `src/runtime.ts` helper so the rest of the code can import `display` and `requestFrame`.

## Drawing API

The target exposes drawing primitives backed by `targets/shared/raster.c` and target display code.

Common methods:

- `screen.color(r, g, b)`
- `screen.clear()`
- `screen.flush()`
- `screen.fillRect(x, y, w, h, color)`
- `screen.strokeRect(x, y, w, h, color)`
- `screen.fillCircle(x, y, r, color)`
- `screen.strokeCircle(x, y, r, color)`
- `screen.drawLine(x0, y0, x1, y1, color)`
- `screen.drawArc(cx, cy, r, startDeg, endDeg, color)`
- `screen.fillTriangle(x0, y0, x1, y1, x2, y2, color)`
- `screen.drawText(text, x, y, color, scale)`
- `screen.setPixel(x, y, color)`
- `screen.pushClip(x, y, w, h)` and `screen.popClip()`
- `screen.setAlpha(alpha)`
- `screen.fillRoundedRect(...)`
- `screen.strokeRoundedRect(...)`

Image helpers are also exposed by the screen runtime for decoded image drawing.

## Browser Simulator Build

Build the generic screen WASM runtime once:

```bash
./targets/web/build-screen-runtime.sh
```

Then build the screen app bundle:

```bash
./targets/web/build-web.sh bouncing-balls
```

For `screen` apps, `build-web.sh` skips per-app WASM and writes the app JS into `simulator/public/apps/<app>/app.js`. The simulator loads `simulator/public/screen-runtime/module.wasm`.

## ESP32 Build

```bash
./scripts/esp32s3-touch-amoled-2.06.sh build --app=bouncing-balls
./scripts/esp32s3-touch-amoled-2.06.sh flash-monitor auto --app=bouncing-balls
```

On ESP32, screen apps run through the XS JavaScript runtime and call native host functions for drawing.

## Limitations

- Device mirror does not support `screen` apps yet.
- `screen` apps do not use generated store field ids or TSX bindings.
- Simulator Device mirror is available for `app-render` apps only.
- Input is lower-level than `app-render`; there is no retained UI hit testing unless you build it yourself.

If you need a mirrored bouncing balls demo, use `bouncing-balls-jsx`.

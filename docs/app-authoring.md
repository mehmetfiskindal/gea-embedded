# App Authoring

Use `app-render` for TSX apps that should run through the generated C UI runtime and support the hardware device mirror.

Good starting examples:

- `examples/tic-tac-toe`
- `examples/bouncing-balls-jsx`
- `examples/settings`
- `examples/button-tetris`

## Manifest Entry

Every app is listed in `examples/apps.json`:

```json
{
  "id": "my-app",
  "root": "examples/my-app",
  "entry": "index.tsx",
  "runtime": "app-render",
  "targets": {
    "web": { "enabled": true },
    "esp32": { "enabled": true }
  }
}
```

`id` is what build scripts, simulator app selection, and ESP32 `--app` use. Keep it stable.

## Minimal App Shape

```tsx
import { Component, mount } from 'gea-embedded'

class App extends Component {
  template() {
    return (
      <div style={{ width: 410, height: 502, justifyContent: 'center', alignItems: 'center' }}>
        <span>Hello</span>
      </div>
    )
  }
}

mount(App)
```

The root app must be a `Component` class passed to `mount(App)`.

Function components are fine inside the mounted tree:

```tsx
function Label() {
  return <span>Ready</span>
}
```

## Elements

Examples use a small HTML-style element set that maps onto the embedded UI tree:

- `div` creates a view node.
- `span` creates a text node.
- `p` creates a block text container with wrapping inline children.
- `h1` through `h6` create block text containers with default heading sizes.

Paragraphs and headings are view-backed blocks, so they can contain plain text and `span` children while still taking block-style layout defaults. App styles and classes override the defaults.

`View` and `Text` remain supported for older code and for authors who prefer a React Native-style vocabulary; they lower to the same view and text node types as `div` and `span`.

## Stores

Stores are classes extending `Store`. Export a singleton instance and reference it from components.

```tsx
import { Store } from 'gea-embedded'

class CounterStore extends Store {
  count = 0
  label = 'Count'

  inc() {
    this.count++
  }
}

export const counter = new CounterStore()
```

The compiler infers C fields from initial values. Prefer simple, static initializers:

- numbers become integer fields.
- strings become fixed-size C strings.
- arrays of object literals become fixed-capacity arrays with subfields.

For arrays, initialize with a representative element so the compiler can infer subfields:

```tsx
class BallStore extends Store {
  balls = [{ x: 0, y: 0, dx: 0, dy: 0, color: '#FF0000' }]
}
```

Then set the desired length at runtime:

```tsx
this.balls.length = 10
```

Store methods are compiled to C. Keep them straightforward and deterministic. Prefer loops, assignments, math, string operations, and calls to other compiled store methods.

## Animation

Use `requestAnimationFrame` from the entry file and call a store method:

```tsx
requestAnimationFrame(function loop(timestampMs) {
  balls.tick(timestampMs)
  requestAnimationFrame(loop)
})
```

The compiler recognizes this pattern and emits an app frame entrypoint that calls the store method.

## Input

Use `onPress` for tap/click behavior:

```tsx
<div onPress={() => game.play(index)}>
  <span>{game.board[index]}</span>
</div>
```

Touch handlers are also available on `div` and `Button`:

```tsx
<div
  onTouchStart={(x, y) => drag.start(x, y)}
  onTouchMove={(x, y) => drag.move(x, y)}
  onTouchEnd={(x, y) => drag.end(x, y)}
/>
```

Inputs are supported through the intrinsic `input` element:

```tsx
<input
  value={form.text}
  placeholder="SSID"
  onInput={event => form.update(event.target.value)}
/>
```

## Styles

Styles can be inline or CSS classes imported by the app. Inline style values should be static literals or simple expressions the compiler can lower.

Common properties include:

- layout: `display`, `flexDirection`, `justifyContent`, `alignItems`, `gap`, `flex`
- size: `width`, `height`, `minWidth`, `maxWidth`
- spacing: `padding`, `margin`
- position: `position`, `top`, `left`, `right`, `bottom`, `zIndex`
- color: `backgroundColor`, `color`, `opacity`
- text: `fontFamily`, `fontSize`, `textAlign`
- borders: `borderWidth`, `borderColor`, `borderRadius`
- transform: `transform`, `rotate`, `transformOrigin`

Use the declarations in `lib/gea-embedded/index.d.ts` as the public type reference.

## Native APIs

`gea-embedded` exposes small native APIs that are backed by target shims:

- `Settings`
- `WiFi`
- `BLE`
- `BLEServer`
- `Accelerometer`
- BLE HID helpers such as `gea_embedded_ble_key_tap`
- `loadImage` and `Image`

The simulator provides mock Wi-Fi, BLE, and accelerometer state. The ESP32 target provides the hardware-backed versions where implemented.

## Vite Config

Each app package uses `geaEmbeddedPlugin` and aliases `gea-embedded` to the local library:

```ts
import { defineConfig } from 'vite'
import { resolve } from 'path'
import { geaEmbeddedPlugin } from '../../lib/vite-plugin-gea-embedded'

const web = process.env.GEA_EMBEDDED_TARGET === 'web'
const appId = 'my-app'

export default defineConfig({
  plugins: [
    geaEmbeddedPlugin({
      cOutput: web
        ? `../../targets/web/generated/${appId}/gea_embedded_app_generated.c`
        : '../../targets/esp32-s3-touch-amoled-2.06/build/gea_embedded_app_generated.c'
    })
  ],
  resolve: {
    alias: {
      'gea-embedded': resolve(__dirname, '../../lib/gea-embedded')
    }
  },
  build: {
    lib: {
      entry: 'index.tsx',
      formats: [web ? 'es' : 'iife'],
      ...(web ? {} : { name: 'gea_embedded' }),
      fileName: () => (web ? 'app.js' : 'index.js')
    },
    outDir: web ? `../../simulator/public/apps/${appId}` : 'dist',
    emptyOutDir: !web,
    minify: false
  }
})
```

## Build Checks

From the app package:

```bash
npm install
npm run build
npm run check
```

For simulator WASM:

```bash
./targets/web/build-web.sh my-app
```

For ESP32:

```bash
./scripts/esp32s3-touch-amoled-2.06.sh build --app=my-app
```

## Authoring Notes

- Prefer explicit app sizes for the 410x502 display.
- Keep store state serializable and simple if it needs to mirror.
- Rebuild both web and ESP32 with the same app id before testing device mirror.
- Avoid relying on browser-only APIs inside compiled store methods.
- Treat generated files as artifacts; fix source or compiler code instead of hand-editing generated C.

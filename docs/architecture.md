# Architecture

Gea Embedded turns small TSX apps into embedded UI programs that can run on hardware and in the browser simulator.

The project has two app runtime families:

- `app-render`: TSX apps using `gea-embedded` components, stores, layout, and generated C.
- `screen`: lower-level apps that call `screen.*` drawing APIs directly from JavaScript.

Most new UI work should start as `app-render`. Raw `screen` apps are useful for direct framebuffer demos and experiments.

## Main Flow

```text
examples/<app>
    |
    | Vite + vite-plugin-gea-embedded
    v
thin JS bundle + generated C + generated fonts
    |
    +--> ESP32 target
    |        generated C + shared UI/raster C + optional XS bytecode
    |
    +--> Web target
             generated C + shared UI/raster C compiled to WASM
```

For `app-render` apps, the generated C is the authoritative UI runtime. It owns the UI tree, store structs, dirty fields, bindings, event entrypoints, and mirror protocol helpers.

For `screen` apps, the app remains JavaScript and calls native drawing functions exposed by the target runtime.

## Key Directories

```text
examples/
  apps.json                         App manifest and target eligibility
  <app>/                            App package, Vite config, source, tests

lib/
  gea-embedded/                     Public component and native API types
  vite-plugin-gea-embedded/         TSX-to-C compiler

targets/shared/
  ui/                               Shared retained UI tree, layout, input, render
  raster.c, image.c, font_8x16.c    Shared drawing and image support

targets/web/
  build-web.sh                      Builds app WASM for simulator
  build-screen-runtime.sh           Builds shared WASM runtime for screen apps
  main/                             Web shims and WASM entrypoints

targets/esp32-s3-touch-amoled-2.06/
  main/                             ESP32 display, touch, Wi-Fi, OTA, logs, mirror
  partitions.csv, sdkconfig.defaults

simulator/
  src/                              Browser UI, WASM loaders, transports
  vite.config.ts                    Vite config plus device mirror TCP relay
```

## `app-render` Runtime

An `app-render` app starts with `mount(App)`, where `App` is a `Component` class with a `template()` method.

The Vite plugin:

1. Parses `.tsx` files that import from `gea-embedded`.
2. Collects component templates, store classes, store instances, styles, font use, handlers, and `requestAnimationFrame` store calls.
3. Emits generated C for stores, UI nodes, bindings, input handlers, render entrypoints, and mirror helpers.
4. Replaces the original app with thin JavaScript glue for targets that still need a JS bundle.
5. Writes generated font C/H files next to the generated app C.

On web, Emscripten compiles generated app C with `targets/shared` and `targets/web/main` into `module.wasm`.

On ESP32, ESP-IDF builds the generated C into firmware. The target also builds a host `xsc` compiler from `vendor/xs` and compiles the thin JS bundle to XS bytecode. For `app-render`, the UI loop itself is pure C.

## `screen` Runtime

A `screen` app is a direct drawing app. It imports or declares the global `screen` object and calls drawing methods such as `clear`, `fillCircle`, `drawLine`, and `flush`.

On ESP32, `screen` apps run through the XS JavaScript runtime and call native host functions.

In the simulator, `screen` apps share one generic WASM runtime from:

```bash
./targets/web/build-screen-runtime.sh
```

Then each screen app only needs its JavaScript bundle:

```bash
./targets/web/build-web.sh bouncing-balls
```

## Simulator Transports

`Direct framebuffer` runs an `app-render` WASM module inside the page and paints the framebuffer directly.

`Device mirror` connects to real ESP32 hardware through the simulator Vite server. The ESP32 streams store snapshots and diffs over TCP. The browser applies those store updates to its own local WASM copy of the app and renders the framebuffer locally.

## Device Mirror Position

Device mirror deliberately does not stream pixels:

```text
ESP32 store state
    |
    | TCP newline-delimited JSON on :8082
    v
Simulator Node/Vite relay
    |
    | Server-Sent Events
    v
Browser local WASM app
    |
    v
Local framebuffer render
```

This means the simulator must have a matching web build for the same app id. If field ids differ between the ESP32 firmware and local WASM build, store diffs can apply to the wrong fields.

## Data Boundaries

- App source and `examples/apps.json` are the source of truth.
- Generated C, generated fonts, app WASM, and ESP32 build output are build artifacts.
- The simulator never opens raw TCP from the browser. It uses the Vite backend as a TCP-to-SSE relay.
- The current mirror path is one-way: hardware state flows to the browser. Browser touch events are not sent back to the board in mirror mode yet.

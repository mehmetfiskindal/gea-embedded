# Generated Code

The `vite-plugin-gea-embedded` compiler lowers `app-render` TSX into C plus a thin JavaScript bundle.

Source of truth:

- app source under `examples/<app>/`
- compiler source under `lib/vite-plugin-gea-embedded/`
- shared runtime under `targets/shared/`

Generated files are build artifacts.

## Compiler Entry

The Vite plugin lives at:

```text
lib/vite-plugin-gea-embedded/index.ts
lib/vite-plugin-gea-embedded/compile.ts
```

`compileGeaEmbeddedTsx` only transforms `.tsx` files that import from `gea-embedded` and mount a component class.

High-level order:

```text
collectCompilerDefinitions()
loadCssAssets()
emitTemplate()
generateCSource()
generateThinJs()
writeGeneratedFonts()
```

## Definitions

`definitions.ts` walks the TSX AST and collects:

- store classes and store singleton instances
- mounted component
- component classes and function components
- `requestAnimationFrame` store call
- CSS imports
- module constants
- native API usage
- init store calls

These definitions drive both template emission and C generation.

## Template Emission

The template compiler emits UI node creation and bindings for:

- `div` and `View` as view nodes
- `span` and `Text` as text nodes
- `p` and `h1` through `h6` as view-backed block text containers
- `Image`
- `Button`
- intrinsic `input`
- list rendering with `.map`
- style bindings
- text bindings
- press/touch handlers
- input keyboard bindings
- font use

The output is a `TemplateEmission` object consumed by C generation.

## C Generation

`lib/vite-plugin-gea-embedded/c/generate.ts` emits the generated app C in this order:

```text
preamble
store declarations
runtime dirty state
binding runtime
methods and app entrypoints
mirror runtime
```

Important exported app entrypoints:

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

The generated C also includes mirror helpers documented in `device-mirror-protocol.md`.

## Store Runtime

Each store singleton becomes a C struct instance. Store fields become C fields.

Example:

```tsx
class GameStore extends Store {
  board = '         '
  turn = 'X'
  winner = ''
}

export const game = new GameStore()
```

Conceptually becomes:

```c
typedef struct {
    char board[...];
    char turn[...];
    char winner[...];
} game_store_t;

static game_store_t game_store = { ... };
```

Generated code assigns global field ids:

```c
enum { FIELD_BOARD = 0, FIELD_TURN = 1, FIELD_WINNER = 2, FIELD_COUNT = 3 };
```

Dirty bitsets track which bindings need to update after store methods run.

## Store Methods

Store methods are compiled to C functions. Writes to store fields mark those fields dirty.

The method compiler handles the supported subset of TypeScript/JavaScript used by the examples: assignments, conditionals, loops, math, string operations, simple arrays, local variables, returns, and cross-store method calls.

When adding language support, update compiler tests under an example package before relying on the new pattern in apps.

## Thin JavaScript

`thin-js.ts` emits a small JS bundle that keeps app initialization shape for targets that still load a JS bundle.

For `app-render` on ESP32, the UI work is pure C. The target still builds XS bytecode from `dist/index.js` as part of its current build flow.

For web `app-render`, the simulator loads the generated WASM module through `targets/web/dist/<app>/module.js` and serves `module.wasm` from `simulator/public/apps/<app>/module.wasm`. The web build also writes `app.js` into `simulator/public/apps/<app>/`, but direct `app-render` execution is driven by the WASM module. For `screen` apps, the simulator loads the app `app.js` bundle and the shared screen runtime WASM.

## Font Generation

CSS font use is collected and written as:

```text
gea_embedded_font_generated.c
gea_embedded_font_generated.h
```

The shared display/text runtime looks up generated font ids at render time.

## Web Target Wrappers

`targets/web/main/web_main.c` wraps generated app C functions with Emscripten exports:

```text
app_init
app_frame
app_touch
app_hit_test
app_touch_down
app_touch_up
app_touch_start
app_touch_move
app_touch_end
app_mirror_set_int
app_mirror_set_string
app_mirror_set_array_len
app_mirror_set_array_int
app_mirror_set_scroll
app_mirror_commit
get_framebuffer_ptr
get_framebuffer_width
get_framebuffer_height
get_framebuffer_stride_bytes
```

`targets/web/build-web.sh` must list any new exported wrapper in `EXPORTED_FUNCTIONS`.

## ESP32 Integration

The ESP32 target includes generated files from its build directory:

```text
build/gea_embedded_app_generated.c
build/gea_embedded_font_generated.c
build/gea_embedded_font_generated.h
build/gea_embedded_app_config.h
```

For `app-render`, `gea_embedded_app_config.h` defines `GEA_EMBEDDED_PURE_C`.

## Inspecting Generated C

For web:

```bash
./targets/web/build-web.sh tic-tac-toe
sed -n '1,240p' targets/web/generated/tic-tac-toe/gea_embedded_app_generated.c
```

For ESP32:

```bash
./scripts/esp32s3-touch-amoled-2.06.sh build --app=tic-tac-toe
sed -n '1,240p' targets/esp32-s3-touch-amoled-2.06/build/gea_embedded_app_generated.c
```

Do not hand-edit generated output. Change app source or compiler code and rebuild.

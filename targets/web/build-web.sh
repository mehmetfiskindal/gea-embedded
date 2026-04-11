#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
APP_ID="${1:-tic-tac-toe}"
MANIFEST="$ROOT_DIR/examples/apps.json"

if [[ ! -f "$MANIFEST" ]]; then
  echo "Missing app manifest: $MANIFEST" >&2
  exit 1
fi

APP_META=$(node -e "
  const m = require('$MANIFEST');
  const app = m.apps.find(a => a.id === '$APP_ID');
  if (!app) { console.error('Unknown app: $APP_ID'); process.exit(1); }
  if (!app.targets.web.enabled) { console.error('App $APP_ID has web target disabled'); process.exit(1); }
  console.log(app.root + ' ' + (app.runtime || 'app-render'));
")
APP_ROOT="${APP_META%% *}"
APP_RUNTIME="${APP_META##* }"

echo "Building web app '$APP_ID' from $APP_ROOT..."

# Step 1: Vite build to produce app.js + generated C
cd "$ROOT_DIR/$APP_ROOT"
GEA_EMBEDDED_TARGET=web node_modules/.bin/vite build
cd "$ROOT_DIR"

PUBLIC_DIR="$ROOT_DIR/simulator/public/apps/$APP_ID"
mkdir -p "$PUBLIC_DIR"

if [[ "$APP_RUNTIME" == "screen" ]]; then
  echo "App '$APP_ID' uses screen runtime — skipping per-app WASM build."
  echo "Run targets/web/build-screen-runtime.sh to build the shared screen WASM module."
else
  # Step 2: Compile WASM from generated C
  GENERATED_C="$ROOT_DIR/targets/web/generated/$APP_ID/gea_embedded_app_generated.c"
  GENERATED_FONT_C="$ROOT_DIR/targets/web/generated/$APP_ID/gea_embedded_font_generated.c"
  DIST_DIR="$ROOT_DIR/targets/web/dist/$APP_ID"
  SHARED_UI_DIR="$ROOT_DIR/targets/shared/ui"

  if [[ ! -f "$GENERATED_C" ]]; then
    echo "Missing generated C for app '$APP_ID': $GENERATED_C" >&2
    exit 1
  fi

  mkdir -p "$DIST_DIR"

  FONT_SOURCES=""
  if [[ -f "$GENERATED_FONT_C" ]]; then
    FONT_SOURCES="$GENERATED_FONT_C"
  fi

  emcc \
    "$ROOT_DIR/targets/shared/raster.c" \
    "$ROOT_DIR/targets/shared/image.c" \
    "$ROOT_DIR/vendor/AnimatedGIF/AnimatedGIF.c" \
    "$ROOT_DIR/targets/web/main/web_apps.c" \
    "$ROOT_DIR/targets/web/main/web_audio.c" \
    "$ROOT_DIR/targets/web/main/web_display.c" \
    "$ROOT_DIR/targets/web/main/web_main.c" \
    "$ROOT_DIR/targets/web/main/web_ble_shim.c" \
    "$ROOT_DIR/targets/web/main/web_imu_shim.c" \
    "$ROOT_DIR/targets/web/main/web_wifi_shim.c" \
    "$ROOT_DIR/targets/web/main/web_touch_shim.c" \
    "$SHARED_UI_DIR/core.c" \
    "$SHARED_UI_DIR/view.c" \
    "$SHARED_UI_DIR/text.c" \
    "$SHARED_UI_DIR/image.c" \
    "$SHARED_UI_DIR/layout.c" \
    "$SHARED_UI_DIR/render.c" \
    "$SHARED_UI_DIR/input.c" \
    "$ROOT_DIR/targets/shared/font_8x16.c" \
    "$GENERATED_C" \
    $FONT_SOURCES \
    -I"$ROOT_DIR/targets/web/include" \
    -I"$ROOT_DIR/targets/shared" \
    -I"$ROOT_DIR/targets/shared/include" \
    -I"$ROOT_DIR/targets/web/generated/$APP_ID" \
    -I"$ROOT_DIR/vendor/stb" \
    -I"$ROOT_DIR/vendor/AnimatedGIF" \
    -ffile-prefix-map="$ROOT_DIR=gea-embedded" \
    -O2 \
    -s NO_FILESYSTEM=1 \
    -s ENVIRONMENT=web \
    -s ALLOW_MEMORY_GROWTH=1 \
    -s MODULARIZE=1 \
    -s EXPORT_ES6=1 \
    -s EXPORTED_FUNCTIONS='["_app_init","_app_frame","_app_touch","_app_touch_start_element","_app_touch_end_element","_app_touch_move_element","_app_hit_test","_app_touch_down","_app_touch_up","_app_touch_start","_app_touch_move","_app_touch_end","_app_mirror_set_int","_app_mirror_set_string","_app_mirror_set_array_len","_app_mirror_set_array_int","_app_mirror_set_scroll","_app_mirror_commit","_app_mirror_get_field_count","_app_mirror_get_schema_hash","_get_framebuffer_ptr","_get_framebuffer_width","_get_framebuffer_height","_get_framebuffer_stride_bytes","_gea_embedded_image_decode","_gea_embedded_image_advance","_gea_embedded_imu_web_set_tilt","_gea_embedded_wifi_web_set_state","_gea_embedded_wifi_web_set_scan_count","_gea_embedded_wifi_web_set_scan_entry","_malloc","_free"]' \
    -s EXPORTED_RUNTIME_METHODS='["ccall","HEAPU8","HEAPU16"]' \
    -o "$DIST_DIR/module.js"

  cp "$DIST_DIR/module.wasm" "$PUBLIC_DIR/module.wasm"
  rm -f "$PUBLIC_DIR/module.js"
fi

echo "Done: $APP_ID web build complete."

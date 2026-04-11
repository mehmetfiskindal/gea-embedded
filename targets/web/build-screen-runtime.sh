#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
DIST_DIR="$ROOT_DIR/targets/web/dist/screen-runtime"
PUBLIC_DIR="$ROOT_DIR/simulator/public/screen-runtime"

mkdir -p "$DIST_DIR" "$PUBLIC_DIR"

echo "Building generic screen runtime WASM module..."

emcc \
  "$ROOT_DIR/targets/shared/raster.c" \
  "$ROOT_DIR/targets/shared/image.c" \
  "$ROOT_DIR/vendor/AnimatedGIF/AnimatedGIF.c" \
  "$ROOT_DIR/targets/web/main/web_display.c" \
  "$ROOT_DIR/targets/web/main/web_screen_runtime.c" \
  "$ROOT_DIR/targets/shared/font_8x16.c" \
  -I"$ROOT_DIR/targets/web/include" \
  -I"$ROOT_DIR/targets/shared/include" \
  -I"$ROOT_DIR/vendor/stb" \
  -I"$ROOT_DIR/vendor/AnimatedGIF" \
  -ffile-prefix-map="$ROOT_DIR=gea-embedded" \
  -O2 \
  -s NO_FILESYSTEM=1 \
  -s ENVIRONMENT=web \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s MODULARIZE=1 \
  -s EXPORT_ES6=1 \
  -s EXPORTED_FUNCTIONS='[
    "_screen_init",
    "_screen_get_framebuffer_ptr","_screen_get_width","_screen_get_height","_screen_get_stride_bytes",
    "_screen_color","_screen_clear","_screen_flush",
    "_screen_fill_rect","_screen_stroke_rect",
    "_screen_fill_circle","_screen_stroke_circle",
    "_screen_draw_line","_screen_draw_arc",
    "_screen_fill_triangle","_screen_draw_text","_screen_set_pixel",
    "_screen_push_clip","_screen_pop_clip",
    "_screen_set_alpha","_screen_get_alpha",
    "_screen_fill_rounded_rect","_screen_stroke_rounded_rect",
    "_screen_image_decode","_screen_image_width","_screen_image_height",
    "_screen_image_frame_count","_screen_image_is_animated",
    "_screen_image_set_playing","_screen_image_seek",
    "_screen_image_advance","_screen_image_draw","_screen_image_draw_scaled",
    "_screen_image_dispose",
    "_malloc","_free"
  ]' \
  -s EXPORTED_RUNTIME_METHODS='["ccall","HEAPU8","HEAPU16"]' \
  -o "$DIST_DIR/module.js"

cp "$DIST_DIR/module.wasm" "$PUBLIC_DIR/module.wasm"

echo "Done: screen runtime WASM module built."

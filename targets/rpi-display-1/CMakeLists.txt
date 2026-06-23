cmake_minimum_required(VERSION 3.22)
project(gea_embedded_rpi C)

# =============================================================================
# Gea Embedded — Raspberry Pi Target
# Primary device: Raspberry Pi Zero W v1.1 + Waveshare 7inch HDMI LCD (C)
# Resolution: 1024x600 USB capacitive touch
# =============================================================================

set(GEA_EMBEDDED_ROOT "${CMAKE_CURRENT_LIST_DIR}/../..")

# ---- App selection (must match an id in examples/apps.json) ----
set(GEA_EMBEDDED_APP "tic-tac-toe" CACHE STRING "Example app id to build")
set(GEA_EMBEDDED_RUNTIME "auto" CACHE STRING "auto|app-render|screen")
set(GEA_EMBEDDED_RESIDENT_APPS "none" CACHE STRING "Resident app id list (semicolon- or comma-separated)")

# ---- Target options (Pi Zero defaults are conservative) ----
option(GEA_RPI_HTTPS       "libcurl HTTPS support"                OFF)
option(GEA_RPI_BLE         "BlueZ HID support"                    OFF)
option(GEA_RPI_IMU         "I2C IMU support"                      OFF)
option(GEA_RPI_MIRROR      "Device mirror server"                 ON)
option(GEA_RPI_DIRTY_RECT  "Partial flush / dirty-rect optimization" ON)
option(GEA_RPI_JS_RUNTIME  "Link the JS runtime (QuickJS)"        ON)
option(GEA_RPI_LOG_STREAM  "TCP log stream on port 8081"          ON)

# ---- Display backend selection ----
set(GEA_RPI_DISPLAY_BACKEND "auto" CACHE STRING "auto|linuxfb|kms")

# ---- Module path ----
list(APPEND CMAKE_MODULE_PATH "${CMAKE_CURRENT_LIST_DIR}/cmake")

# ---- Required deps ----
find_package(Threads REQUIRED)
find_package(QuickJS)

# ---- Optional deps (KMS for Pi 3/4/5 with new firmware) ----
find_package(KMS)
if(KMS_FOUND)
    message(STATUS "libdrm/KMS found — KMS backend available")
else()
    message(STATUS "libdrm/KMS not found — linuxfb only")
endif()

# ---- Optional deps (libinput as alternative to evdev) ----
find_package(LibInput)

# ---- Optional deps (libcurl for HTTP fetch) ----
if(GEA_RPI_HTTPS)
    find_package(CURL)
    if(NOT CURL_FOUND)
        message(WARNING "libcurl not found; GEA_RPI_HTTPS will be disabled")
        set(GEA_RPI_HTTPS OFF CACHE BOOL "libcurl HTTPS support" FORCE)
    endif()
endif()

# ---- Resolve app metadata from examples/apps.json ----
execute_process(
    COMMAND node -e "
        const m = require('${GEA_EMBEDDED_ROOT}/examples/apps.json');
        const app = m.apps.find(a => a.id === '${GEA_EMBEDDED_APP}');
        if (!app) { console.error('Unknown app: ${GEA_EMBEDDED_APP}'); process.exit(1); }
        if (!app.targets || !app.targets.rpi || !app.targets.rpi.enabled) {
            console.error('App ${GEA_EMBEDDED_APP} has rpi target disabled');
            process.exit(1);
        }
        const vp = (app.targets.rpi && app.targets.rpi.viewport) || 'compat';
        console.log(app.root + ';' + app.entry + ';' + app.runtime + ';' + vp);
    "
    OUTPUT_VARIABLE GEA_EMBEDDED_APP_META
    OUTPUT_STRIP_TRAILING_WHITESPACE
    RESULT_VARIABLE GEA_EMBEDDED_APP_META_RESULT
)
if(NOT GEA_EMBEDDED_APP_META_RESULT EQUAL 0)
    message(FATAL_ERROR "Failed to resolve app '${GEA_EMBEDDED_APP}' from examples/apps.json")
endif()

string(REPLACE ";" ";" GEA_EMBEDDED_APP_META_LIST "${GEA_EMBEDDED_APP_META}")
list(GET GEA_EMBEDDED_APP_META_LIST 0 GEA_EMBEDDED_APP_ROOT)
list(GET GEA_EMBEDDED_APP_META_LIST 1 GEA_EMBEDDED_APP_ENTRY)
list(GET GEA_EMBEDDED_APP_META_LIST 2 GEA_EMBEDDED_APP_RUNTIME)
list(GET GEA_EMBEDDED_APP_META_LIST 3 GEA_EMBEDDED_APP_VIEWPORT)

if(GEA_EMBEDDED_RUNTIME STREQUAL "auto")
    set(GEA_EMBEDDED_RUNTIME "${GEA_EMBEDDED_APP_RUNTIME}")
endif()

set(GEA_EMBEDDED_APP_DIR "${GEA_EMBEDDED_ROOT}/${GEA_EMBEDDED_APP_ROOT}")

# =============================================================================
# Generated file paths (defined up front so target_sources can reference them)
# =============================================================================
set(GENERATED_APP_DIR "${CMAKE_BINARY_DIR}/apps/${GEA_EMBEDDED_APP}")
file(MAKE_DIRECTORY "${GENERATED_APP_DIR}")
set(JS_APP            "${GENERATED_APP_DIR}/dist/index.js")
set(GENERATED_C       "${GENERATED_APP_DIR}/gea_embedded_app_generated.c")
set(GENERATED_FONT_C  "${GENERATED_APP_DIR}/gea_embedded_font_generated.c")
set(GENERATED_FONT_H  "${GENERATED_APP_DIR}/gea_embedded_font_generated.h")
set(GENERATED_CONFIG_H "${GENERATED_APP_DIR}/gea_embedded_app_config.h")
set(BYTECODE_C        "${GENERATED_APP_DIR}/app_bytecode.c")

# Stub files for first-time configure; vite_build overwrites them.
if(NOT EXISTS "${GENERATED_C}")
    file(WRITE "${GENERATED_C}" "
#include \"ui/ui.h\"
#include \"gea_embedded_font_generated.h\"
void gea_embedded_app_init(int w, int h) { (void)w; (void)h; }
void gea_embedded_app_frame(int ts) { (void)ts; }
void gea_embedded_app_touch(int press_id) { (void)press_id; }
void gea_embedded_app_touch_start_element(int press_id, int x, int y) { (void)press_id; (void)x; (void)y; }
void gea_embedded_app_touch_end_element(int press_id, int x, int y) { (void)press_id; (void)x; (void)y; }
void gea_embedded_app_touch_move_element(int press_id, int x, int y) { (void)press_id; (void)x; (void)y; }
void gea_embedded_app_touch_start(int x, int y) { (void)x; (void)y; }
void gea_embedded_app_touch_move(int x, int y) { (void)x; (void)y; }
void gea_embedded_app_touch_end(int x, int y) { (void)x; (void)y; }
void gea_embedded_app_settings_toggle(void) {}
")
endif()
if(NOT EXISTS "${GENERATED_FONT_H}")
    file(WRITE "${GENERATED_FONT_H}" "
#pragma once
#define GEA_EMBEDDED_HAS_GENERATED_FONTS 1
#include <stdint.h>
typedef struct { uint8_t codepoint; uint16_t atlas_x, atlas_y; uint8_t width, height, advance; int8_t bearing_x, bearing_y; } gea_embedded_glyph_t;
typedef struct { int id, size_px, line_height, ascender, descender, glyph_count; const gea_embedded_glyph_t *glyphs; int atlas_w, atlas_h; const uint8_t *atlas; } gea_embedded_font_t;
#define GEA_EMBEDDED_FONT_COUNT 0
extern const gea_embedded_font_t gea_embedded_fonts[1];
const gea_embedded_font_t *gea_embedded_font_lookup(int font_id);
")
endif()
if(NOT EXISTS "${GENERATED_FONT_C}")
    file(WRITE "${GENERATED_FONT_C}" "
#include \"gea_embedded_font_generated.h\"
const gea_embedded_font_t gea_embedded_fonts[1] = {{ 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 }};
const gea_embedded_font_t *gea_embedded_font_lookup(int font_id) { return &gea_embedded_fonts[0]; }
")
endif()
if(NOT EXISTS "${GENERATED_CONFIG_H}")
    file(WRITE "${GENERATED_CONFIG_H}" "#pragma once\n#define GEA_EMBEDDED_PURE_C 1\n")
endif()
if(NOT EXISTS "${BYTECODE_C}")
    if(GEA_EMBEDDED_RUNTIME STREQUAL "screen")
        file(WRITE "${BYTECODE_C}" "/* placeholder; vite_build will overwrite */\nconst unsigned char app_bytecode[1] = {0};\nconst unsigned long app_bytecode_size = 0;\n")
    else()
        file(WRITE "${BYTECODE_C}" "/* pure-C app; no JS bytecode */\nconst unsigned char app_bytecode[1] = {0};\nconst unsigned long app_bytecode_size = 0;\n")
    endif()
endif()

message(STATUS "App:           ${GEA_EMBEDDED_APP}")
message(STATUS "Runtime:       ${GEA_EMBEDDED_RUNTIME}")
message(STATUS "Viewport:      ${GEA_EMBEDDED_APP_VIEWPORT}")
message(STATUS "Display:       ${GEA_RPI_DISPLAY_BACKEND}")
message(STATUS "Dirty-rect:    ${GEA_RPI_DIRTY_RECT}")
message(STATUS "Mirror:        ${GEA_RPI_MIRROR}")
message(STATUS "JS runtime:    ${GEA_RPI_JS_RUNTIME}")

# ---- Resolve target binaries ----
# The entry point depends on the runtime: app-render apps use app_main.c,
# screen apps use app_main_screen.c. Exactly one is included per binary.
set(_RPI_ENTRYPOINT main/app_main.c)
if(GEA_EMBEDDED_RUNTIME STREQUAL "screen" AND GEA_RPI_JS_RUNTIME)
    set(_RPI_ENTRYPOINT main/app_main_screen.c)
endif()

add_executable(geat-app-${GEA_EMBEDDED_APP}
    ${_RPI_ENTRYPOINT}
    main/display.c
    main/display_linuxfb.c
    main/platform.c
    main/input.c
    main/assets.c
    main/wifi.c
    main/imu.c
    main/ota.c
    main/mirror.c
    main/log.c
    main/crt_tm_stubs.c       # empty TM-clone helpers; see file
    ${GENERATED_C}            # app entrypoints (init/frame/touch_*)
    ${GENERATED_FONT_C}       # gea_embedded_font_lookup
    ${GEA_EMBEDDED_ROOT}/targets/shared/ui/core.c
    ${GEA_EMBEDDED_ROOT}/targets/shared/ui/view.c
    ${GEA_EMBEDDED_ROOT}/targets/shared/ui/text.c
    ${GEA_EMBEDDED_ROOT}/targets/shared/ui/image.c
    ${GEA_EMBEDDED_ROOT}/targets/shared/ui/layout.c
    ${GEA_EMBEDDED_ROOT}/targets/shared/ui/render.c
    ${GEA_EMBEDDED_ROOT}/targets/shared/ui/input.c
    ${GEA_EMBEDDED_ROOT}/targets/shared/raster.c
    ${GEA_EMBEDDED_ROOT}/targets/shared/image.c
    ${GEA_EMBEDDED_ROOT}/targets/shared/font_8x16.c
    ${GEA_EMBEDDED_ROOT}/vendor/AnimatedGIF/AnimatedGIF.c
)

# Conditional KMS backend
if(KMS_FOUND)
    target_sources(geat-app-${GEA_EMBEDDED_APP} PRIVATE main/display_kms.c)
endif()

# Conditional screen runtime entry point
if(GEA_EMBEDDED_RUNTIME STREQUAL "screen" AND GEA_RPI_JS_RUNTIME)
    target_sources(geat-app-${GEA_EMBEDDED_APP} PRIVATE
        main/app_main_screen.c
        main/quickjs_shim.c
        ${QUICKJS_SOURCES}
        ${BYTECODE_C}
    )
    target_include_directories(geat-app-${GEA_EMBEDDED_APP} PRIVATE ${QUICKJS_INCLUDE_DIRS})
    target_link_libraries(geat-app-${GEA_EMBEDDED_APP} PRIVATE ${QUICKJS_LIBRARIES})
    target_compile_definitions(geat-app-${GEA_EMBEDDED_APP} PRIVATE
        GEA_EMBEDDED_JS_RUNTIME=1
    )
endif()

# Conditional app-render generated C (added by app build step)
if(GEA_EMBEDDED_RUNTIME STREQUAL "app-render")
    target_compile_definitions(geat-app-${GEA_EMBEDDED_APP} PRIVATE
        GEA_EMBEDDED_PURE_C=1
        UI_MAX_NODES=256
    )
endif()

target_include_directories(geat-app-${GEA_EMBEDDED_APP} PRIVATE
    main/include
    ${GEA_EMBEDDED_ROOT}/targets/shared
    ${GEA_EMBEDDED_ROOT}/targets/shared/include
    ${GEA_EMBEDDED_ROOT}/vendor/stb
    ${GEA_EMBEDDED_ROOT}/vendor/AnimatedGIF
    ${CMAKE_BINARY_DIR}/apps/${GEA_EMBEDDED_APP}
    ${CMAKE_BINARY_DIR}
)

target_compile_definitions(geat-app-${GEA_EMBEDDED_APP} PRIVATE
    GEA_EMBEDDED_NATIVE_WIDTH=1024
    GEA_EMBEDDED_NATIVE_HEIGHT=600
    GEA_EMBEDDED_COMPAT_WIDTH=410
    GEA_EMBEDDED_COMPAT_HEIGHT=502
    GEA_EMBEDDED_GIF_C_API=1     # expose GIF_begin / GIF_openRAM / etc. in AnimatedGIF
    __LINUX__=1                 # linux-style platform code in vendored libs
)

# Enforce ARMv6 (Pi Zero W v1.1 = ARM1176JZF-S with VFPv2). The Fedora
# cross-compiler's libgcc.a is built for ARMv7 by default and would
# otherwise silently tag the binary as ARMv7 even when -march=armv6zk
# is passed for the C compile. -static-libgcc forces the linker to use
# the same libgcc that was compiled for the target arch. On non-ARM
# hosts (e.g. x86_64 Fedora dev box) these flags are no-ops.
if(CMAKE_SYSTEM_PROCESSOR MATCHES "arm" OR CMAKE_SYSTEM_PROCESSOR MATCHES "aarch64")
    target_compile_options(geat-app-${GEA_EMBEDDED_APP} PRIVATE
        -march=armv6zk
        -mfpu=vfp
        -mfloat-abi=hard
    )
    target_link_options(geat-app-${GEA_EMBEDDED_APP} PRIVATE
        -static-libgcc
    )
    message(STATUS "Enforcing ARMv6 with VFPv2 (Pi Zero W v1.1 target)")
endif()

if(GEA_RPI_DIRTY_RECT)
    target_compile_definitions(geat-app-${GEA_EMBEDDED_APP} PRIVATE
        GEA_EMBEDDED_DIRTY_RECT=1
    )
endif()

if(KMS_FOUND)
    target_compile_definitions(geat-app-${GEA_EMBEDDED_APP} PRIVATE
        GEA_EMBEDDED_HAS_KMS=1
    )
endif()

if(GEA_RPI_MIRROR)
    target_compile_definitions(geat-app-${GEA_EMBEDDED_APP} PRIVATE
        GEA_EMBEDDED_MIRROR=1
    )
endif()

if(GEA_RPI_LOG_STREAM)
    target_compile_definitions(geat-app-${GEA_EMBEDDED_APP} PRIVATE
        GEA_EMBEDDED_LOG_STREAM=1
    )
endif()

if(GEA_RPI_IMU)
    target_compile_definitions(geat-app-${GEA_EMBEDDED_APP} PRIVATE
        GEA_EMBEDDED_IMU=1
    )
endif()

if(GEA_RPI_BLE)
    target_compile_definitions(geat-app-${GEA_EMBEDDED_APP} PRIVATE
        GEA_EMBEDDED_BLE=1
    )
endif()

# ---- Link libraries ----
target_link_libraries(geat-app-${GEA_EMBEDDED_APP} PRIVATE
    Threads::Threads
    m
    dl
)

if(KMS_FOUND)
    target_link_libraries(geat-app-${GEA_EMBEDDED_APP} PRIVATE ${KMS_LIBRARIES})
endif()

if(LIBINPUT_FOUND)
    target_link_libraries(geat-app-${GEA_EMBEDDED_APP} PRIVATE ${LIBINPUT_LIBRARIES})
endif()

if(GEA_RPI_HTTPS AND CURL_FOUND)
    target_link_libraries(geat-app-${GEA_EMBEDDED_APP} PRIVATE ${CURL_LIBRARIES})
    target_compile_definitions(geat-app-${GEA_EMBEDDED_APP} PRIVATE GEA_EMBEDDED_HTTPS=1)
endif()

# ---- Suppress noisy warnings (matches ESP32 target style) ----
target_compile_options(geat-app-${GEA_EMBEDDED_APP} PRIVATE
    -Wno-unused-parameter
    -Wno-sign-compare
    -Wno-missing-field-initializers
    -Wno-implicit-fallthrough
    -Wno-old-style-declaration
    -Wno-misleading-indentation
    -Wno-type-limits
    -Wno-maybe-uninitialized
    -Wno-calloc-transposed-args
    -Wno-unused-function
)

# =============================================================================
# App build step: Vite + qjsc (mirrors ESP32 target's vite_build + xsc flow)
# =============================================================================

# Note: paths and stub-file writes are above (before add_executable) so
# target_sources can reference them and the stub files exist on disk.

# Vite build step
set(_VITE_STAMP "${CMAKE_BINARY_DIR}/vite_build.stamp")

# When GEA_RPI_SKIP_VITE is set (e.g. ARMv6 Pi Zero where Node.js isn't
# installable), skip the vite step and just touch the stamp file. The
# caller is responsible for having synced build/rpi/apps/<id>/ from a
# host that ran vite (e.g. via 'geat-rpi.sh build' on Fedora).
if(GEA_RPI_SKIP_VITE)
    message(STATUS "GEA_RPI_SKIP_VITE=ON: skipping vite build; using pre-generated files")
    add_custom_command(
        OUTPUT ${_VITE_STAMP}
        COMMAND ${CMAKE_COMMAND} -E touch ${_VITE_STAMP}
        DEPENDS ${_APP_SOURCES}
        BYPRODUCTS
            ${JS_APP}
            ${GENERATED_C}
            ${GENERATED_FONT_C}
            ${GENERATED_FONT_H}
            ${GENERATED_CONFIG_H}
        COMMENT "Touching vite stamp (vite skipped); ensure build/rpi/apps/${GEA_EMBEDDED_APP}/* is populated"
        VERBATIM
    )
else()
    file(GLOB _APP_SOURCES CONFIGURE_DEPENDS "${GEA_EMBEDDED_APP_DIR}/*")
    add_custom_command(
        OUTPUT ${_VITE_STAMP}
        COMMAND ${CMAKE_COMMAND} -E env
            GEA_EMBEDDED_C_OUTPUT=${GENERATED_C}
            GEA_EMBEDDED_FONT_C_OUTPUT=${GENERATED_FONT_C}
            GEA_EMBEDDED_FONT_H_OUTPUT=${GENERATED_FONT_H}
            GEA_EMBEDDED_CONFIG_OUTPUT=${GENERATED_CONFIG_H}
            GEA_EMBEDDED_TARGET=rpi
            npm run build
        COMMAND ${CMAKE_COMMAND} -E touch ${_VITE_STAMP}
    WORKING_DIRECTORY "${GEA_EMBEDDED_APP_DIR}"
    DEPENDS ${_APP_SOURCES}
    BYPRODUCTS
        ${JS_APP}
        ${GENERATED_C}
        ${GENERATED_FONT_C}
        ${GENERATED_FONT_H}
        ${GENERATED_CONFIG_H}
    COMMENT "Compiling ${GEA_EMBEDDED_APP}: TSX -> C + thin JS"
    VERBATIM
    )
endif()
add_custom_target(vite_build ALL DEPENDS ${_VITE_STAMP})

# qjsc step (only for screen runtime)
if(GEA_EMBEDDED_RUNTIME STREQUAL "screen" AND GEA_RPI_JS_RUNTIME)
    if(NOT QJSC_BINARY)
        message(FATAL_ERROR "qjsc not found; required for screen runtime")
    endif()
    set(_QJSC_STAMP "${CMAKE_BINARY_DIR}/qjsc.stamp")
    add_custom_command(
        OUTPUT ${_QJSC_STAMP} ${BYTECODE_C}
        COMMAND ${QJSC_BINARY} -e -o ${BYTECODE_C} ${JS_APP}
        COMMAND ${CMAKE_COMMAND} -E touch ${_QJSC_STAMP}
        DEPENDS ${_VITE_STAMP} ${JS_APP} ${QJSC_BINARY}
        BYPRODUCTS ${BYTECODE_C}
        COMMENT "Compiling ${JS_APP} -> QuickJS bytecode"
        VERBATIM
    )
    add_custom_target(qjsc_compile ALL DEPENDS ${_QJSC_STAMP})
    add_dependencies(geat-app-${GEA_EMBEDDED_APP} qjsc_compile)
endif()

add_dependencies(geat-app-${GEA_EMBEDDED_APP} vite_build)

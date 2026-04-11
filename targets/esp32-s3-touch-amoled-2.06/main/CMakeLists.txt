set(GEA_EMBEDDED_ROOT "${CMAKE_CURRENT_LIST_DIR}/../../..")
cmake_path(ABSOLUTE_PATH GEA_EMBEDDED_ROOT NORMALIZE)

set(GEA_EMBEDDED_APP "tic-tac-toe" CACHE STRING "Example app to build (must match an id in examples/apps.json)")
set(GEA_EMBEDDED_RESIDENT_APPS "auto" CACHE STRING "Semicolon/comma-separated app-render app ids to link into app-launcher, 'auto', or 'none'")
set(GEA_EMBEDDED_HTTPS_SUPPORT "auto" CACHE STRING "Enable HTTPS fetch support: auto, on, or off")

# Write a file only when its content would change. Preserves mtime when content matches,
# so downstream make/ninja rules don't see spurious changes on every reconfigure.
function(_gea_write_if_different FILE_PATH CONTENT)
    set(_should_write 1)
    if(EXISTS "${FILE_PATH}")
        file(READ "${FILE_PATH}" _existing)
        if("${_existing}" STREQUAL "${CONTENT}")
            set(_should_write 0)
        endif()
    endif()
    if(_should_write)
        file(WRITE "${FILE_PATH}" "${CONTENT}")
    endif()
endfunction()

# Enumerate files under DIR matching one of the source extensions / config filenames, pruning
# node_modules / dist / .vite at directory boundaries. CMake's file(GLOB_RECURSE) walks every file
# in the tree before filtering — for example dirs that's ~1000 stat calls per node_modules. find(1)
# prunes at the directory level, so configure stays under a second instead of half a minute.
function(_gea_find_sources OUT_VAR DIR)
    execute_process(
        COMMAND find -L "${DIR}"
            -type d \( -name node_modules -o -name dist -o -name .vite -o -name build \) -prune
            -o -type f \(
                -name "*.tsx" -o -name "*.ts" -o -name "*.jsx" -o -name "*.js"
                -o -name "*.css" -o -name "*.html"
                -o -name "package.json" -o -name "tsconfig.json" -o -name "vite.config.ts"
            \) -print
        OUTPUT_VARIABLE _output
        OUTPUT_STRIP_TRAILING_WHITESPACE
    )
    if(_output STREQUAL "")
        set(${OUT_VAR} "" PARENT_SCOPE)
    else()
        string(REPLACE "\n" ";" _list "${_output}")
        set(${OUT_VAR} "${_list}" PARENT_SCOPE)
    endif()
endfunction()

function(_gea_collect_app_sources OUT_VAR APP_DIR)
    _gea_find_sources(_src "${APP_DIR}")
    set(${OUT_VAR} "${_src}" PARENT_SCOPE)
endfunction()

# Source files of the gea-embedded vite plugin and shared lib. Changes here invalidate every app's
# vite output, so they are part of every vite_build's DEPENDS.
_gea_find_sources(_GEA_VITE_PLUGIN_SRCS "${GEA_EMBEDDED_ROOT}/lib")
list(APPEND _GEA_VITE_PLUGIN_SRCS
    "${GEA_EMBEDDED_ROOT}/lib/vite-plugin-gea-embedded.ts"
    "${GEA_EMBEDDED_ROOT}/lib/package.json"
)

file(GLOB _GEA_FONT_ASSETS
    "${GEA_EMBEDDED_ROOT}/assets/fonts/*.ttf"
    "${GEA_EMBEDDED_ROOT}/assets/fonts/*.otf"
    "${GEA_EMBEDDED_ROOT}/assets/fonts/*.woff"
    "${GEA_EMBEDDED_ROOT}/assets/fonts/*.woff2"
)

execute_process(
    COMMAND node -e "
        const m = require('${GEA_EMBEDDED_ROOT}/examples/apps.json');
        const app = m.apps.find(a => a.id === '${GEA_EMBEDDED_APP}');
        if (!app) { console.error('Unknown app: ${GEA_EMBEDDED_APP}'); process.exit(1); }
        if (!app.targets.esp32.enabled) { console.error('App ${GEA_EMBEDDED_APP} has esp32 target disabled'); process.exit(1); }
        console.log(app.root + ';' + app.entry + ';' + app.runtime);
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

set(GEA_EMBEDDED_APP_DIR "${GEA_EMBEDDED_ROOT}/${GEA_EMBEDDED_APP_ROOT}")

set(XS_DIR "${GEA_EMBEDDED_ROOT}/vendor/xs")
set(JS_APP_SRC "${GEA_EMBEDDED_APP_DIR}/${GEA_EMBEDDED_APP_ENTRY}")
set(XS_GEN_DIR "${CMAKE_BINARY_DIR}/xs_generated")
file(MAKE_DIRECTORY "${XS_GEN_DIR}")
set(XS_COMPILED_SOURCE "${XS_GEN_DIR}/index.xs.c")

# Each example's vite output goes under build/apps/<appId>/ — keeps the active app's outputs
# separate from any resident_vite_X target running npm in the same example dir, so the two never
# race on dist/index.js or the .vite cache.
set(GENERATED_APP_DIR "${CMAKE_BINARY_DIR}/apps/${GEA_EMBEDDED_APP}")
file(MAKE_DIRECTORY "${GENERATED_APP_DIR}")
set(JS_APP "${GENERATED_APP_DIR}/dist/index.js")
set(GENERATED_C "${GENERATED_APP_DIR}/gea_embedded_app_generated.c")
set(GENERATED_FONT_C "${GENERATED_APP_DIR}/gea_embedded_font_generated.c")
set(GENERATED_FONT_H "${GENERATED_APP_DIR}/gea_embedded_font_generated.h")
set(GENERATED_CONFIG_H "${GENERATED_APP_DIR}/gea_embedded_app_config.h")
set(GENERATED_INSTALLED_APPS_H "${CMAKE_BINARY_DIR}/gea_embedded_installed_apps_generated.h")
set(RESIDENT_APPS_REGISTRY_C "${CMAKE_BINARY_DIR}/gea_embedded_resident_apps_generated.c")
set(RESIDENT_APPS_LF "${CMAKE_BINARY_DIR}/gea_embedded_resident_apps.lf")

set(_RESIDENT_APPS_REGISTRY_STUB [[
#include "resident_apps.h"
int gea_embedded_resident_apps_is_enabled(void) { return 0; }
const char *gea_embedded_resident_apps_active_id(void) { return 0; }
int gea_embedded_resident_apps_select(const char *app_id) { (void)app_id; return 0; }
int gea_embedded_resident_apps_request_launch(const char *app_id) { (void)app_id; return 0; }
int gea_embedded_resident_apps_consume_launch(char *dst, size_t cap) { (void)dst; (void)cap; return 0; }
int gea_embedded_resident_apps_return_to_launcher(const char *trigger) { (void)trigger; return 0; }
]])
# The launcher build path below writes the real registry via generate-resident-app-registry.mjs;
# the stub is written when no resident apps are configured. Both paths use write-if-different so
# the file's mtime only changes when the content actually changes — and crucially, switching from
# a launcher build back to a regular app build replaces the stale real registry with the stub.

execute_process(
    COMMAND node
        "${GEA_EMBEDDED_ROOT}/scripts/generate-installed-app-plan.mjs"
        "${CMAKE_CURRENT_LIST_DIR}/../partitions.csv"
        "${GENERATED_INSTALLED_APPS_H}"
    RESULT_VARIABLE GEA_EMBEDDED_INSTALLED_APPS_RESULT
)
if(NOT GEA_EMBEDDED_INSTALLED_APPS_RESULT EQUAL 0)
    message(FATAL_ERROR "Failed to generate installed app plan from partitions.csv")
endif()

# The app source owns app-level defaults. On a fresh configure, create only a minimal
# placeholder; vite_build overwrites it with the app-derived config before native compile.
if(NOT EXISTS "${GENERATED_CONFIG_H}")
    if(GEA_EMBEDDED_APP_RUNTIME STREQUAL "app-render")
        _gea_write_if_different("${GENERATED_CONFIG_H}" "#pragma once\n#define GEA_EMBEDDED_PURE_C 1\n")
    else()
        _gea_write_if_different("${GENERATED_CONFIG_H}" "#pragma once\n")
    endif()
endif()
# Stub C/font sources exist solely to satisfy idf_component_register's SRCS validation on a fresh
# build. vite_build below overwrites them with real generated content; reconfigure must not
# clobber that real content, hence the guards.
if(NOT EXISTS "${GENERATED_C}")
    file(WRITE "${GENERATED_C}" [[
#include "ui/ui.h"
#include "xsAll.h"
#include "xs.h"
#include "gea_embedded_font_generated.h"
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
void gea_embedded_app_setup(xsMachine *the, int viewport_w, int viewport_h) {
    (void)the; (void)viewport_w; (void)viewport_h;
}
]])
endif()
if(NOT EXISTS "${GENERATED_FONT_H}")
    file(WRITE "${GENERATED_FONT_H}" [[
#pragma once
#define GEA_EMBEDDED_HAS_GENERATED_FONTS 1
#include <stdint.h>
typedef struct { uint8_t codepoint; uint16_t atlas_x, atlas_y; uint8_t width, height, advance; int8_t bearing_x, bearing_y; } gea_embedded_glyph_t;
typedef struct { int id, size_px, line_height, ascender, descender, glyph_count; const gea_embedded_glyph_t *glyphs; int atlas_w, atlas_h; const uint8_t *atlas; } gea_embedded_font_t;
#define GEA_EMBEDDED_FONT_COUNT 0
extern const gea_embedded_font_t gea_embedded_fonts[1];
const gea_embedded_font_t *gea_embedded_font_lookup(int font_id);
]])
endif()
if(NOT EXISTS "${GENERATED_FONT_C}")
    file(WRITE "${GENERATED_FONT_C}" [[
#include "gea_embedded_font_generated.h"
const gea_embedded_font_t gea_embedded_fonts[1] = {{ 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 }};
const gea_embedded_font_t *gea_embedded_font_lookup(int font_id) { return &gea_embedded_fonts[0]; }
]])
endif()

set(GEA_EMBEDDED_RESIDENT_APP_IDS "")
if(GEA_EMBEDDED_RESIDENT_APPS STREQUAL "auto")
    if(GEA_EMBEDDED_APP STREQUAL "app-launcher")
        execute_process(
            COMMAND node -e "
                const m = require('${GEA_EMBEDDED_ROOT}/examples/apps.json');
                console.log(m.apps
                    .filter(a => a.runtime === 'app-render' && a.targets && a.targets.esp32 && a.targets.esp32.enabled)
                    .map(a => a.id)
                    .join(';'));
            "
            OUTPUT_VARIABLE GEA_EMBEDDED_RESIDENT_APP_IDS
            OUTPUT_STRIP_TRAILING_WHITESPACE
            RESULT_VARIABLE GEA_EMBEDDED_RESIDENT_APPS_RESULT
        )
        if(NOT GEA_EMBEDDED_RESIDENT_APPS_RESULT EQUAL 0)
            message(FATAL_ERROR "Failed to resolve resident app list from examples/apps.json")
        endif()
    endif()
elseif(NOT GEA_EMBEDDED_RESIDENT_APPS STREQUAL "" AND NOT GEA_EMBEDDED_RESIDENT_APPS STREQUAL "none")
    string(REPLACE "," ";" GEA_EMBEDDED_RESIDENT_APP_IDS "${GEA_EMBEDDED_RESIDENT_APPS}")
endif()

set(APP_GENERATED_SOURCES ${GENERATED_C} ${GENERATED_FONT_C} ${RESIDENT_APPS_REGISTRY_C})
set(RESIDENT_BUILD_TARGETS "")
set(RESIDENT_APP_SOURCE_FILES "")
set(RESIDENT_APP_FONT_FILES "")
set(LD_FRAGMENT_ARGS "")

if(GEA_EMBEDDED_RESIDENT_APP_IDS)
    if(NOT GEA_EMBEDDED_APP_RUNTIME STREQUAL "app-render")
        message(FATAL_ERROR "Resident app linking requires an app-render launcher build")
    endif()

    set(APP_GENERATED_SOURCES ${RESIDENT_APPS_REGISTRY_C})

    execute_process(
        COMMAND node
            "${GEA_EMBEDDED_ROOT}/scripts/generate-resident-app-registry.mjs"
            "${GEA_EMBEDDED_ROOT}/examples/apps.json"
            "${RESIDENT_APPS_REGISTRY_C}"
            ${GEA_EMBEDDED_RESIDENT_APP_IDS}
        RESULT_VARIABLE GEA_EMBEDDED_RESIDENT_REGISTRY_RESULT
    )
    if(NOT GEA_EMBEDDED_RESIDENT_REGISTRY_RESULT EQUAL 0)
        message(FATAL_ERROR "Failed to generate resident app registry")
    endif()

    set(_RESIDENT_APPS_LF_CONTENT [[
[scheme:resident_app_ext]
entries:
    text -> flash_text
    rodata -> flash_rodata
    data -> dram0_data
    bss -> extern_ram
    common -> extern_ram

[mapping:resident_apps]
archive: libmain.a
entries:
]])

    foreach(RESIDENT_APP_ID IN LISTS GEA_EMBEDDED_RESIDENT_APP_IDS)
        execute_process(
            COMMAND node -e "
                const m = require('${GEA_EMBEDDED_ROOT}/examples/apps.json');
                const app = m.apps.find(a => a.id === '${RESIDENT_APP_ID}');
                if (!app) { console.error('Unknown resident app: ${RESIDENT_APP_ID}'); process.exit(1); }
                if (app.runtime !== 'app-render') { console.error('Resident app ${RESIDENT_APP_ID} is not app-render'); process.exit(1); }
                if (!app.targets.esp32.enabled) { console.error('Resident app ${RESIDENT_APP_ID} has esp32 target disabled'); process.exit(1); }
                console.log(app.root + ';' + app.entry + ';' + app.runtime);
            "
            OUTPUT_VARIABLE RESIDENT_APP_META
            OUTPUT_STRIP_TRAILING_WHITESPACE
            RESULT_VARIABLE RESIDENT_APP_META_RESULT
        )
        if(NOT RESIDENT_APP_META_RESULT EQUAL 0)
            message(FATAL_ERROR "Failed to resolve resident app '${RESIDENT_APP_ID}' from examples/apps.json")
        endif()

        string(REPLACE ";" ";" RESIDENT_APP_META_LIST "${RESIDENT_APP_META}")
        list(GET RESIDENT_APP_META_LIST 0 RESIDENT_APP_ROOT)
        set(RESIDENT_APP_DIR "${GEA_EMBEDDED_ROOT}/${RESIDENT_APP_ROOT}")
        string(REGEX REPLACE "[^A-Za-z0-9_]" "_" RESIDENT_APP_SAFE_ID "${RESIDENT_APP_ID}")
        set(RESIDENT_APP_PREFIX "gea_resident_${RESIDENT_APP_SAFE_ID}")
        set(RESIDENT_APP_GEN_DIR "${CMAKE_BINARY_DIR}/resident_apps/${RESIDENT_APP_ID}")
        set(RESIDENT_APP_C "${RESIDENT_APP_GEN_DIR}/${RESIDENT_APP_SAFE_ID}_app.c")
        set(RESIDENT_APP_FONT_GENERATED_C "${RESIDENT_APP_GEN_DIR}/gea_embedded_font_generated.c")
        set(RESIDENT_APP_FONT_C "${RESIDENT_APP_GEN_DIR}/${RESIDENT_APP_SAFE_ID}_font.c")
        set(RESIDENT_APP_FONT_H "${RESIDENT_APP_GEN_DIR}/gea_embedded_font_generated.h")
        set(RESIDENT_APP_CONFIG_H "${RESIDENT_APP_GEN_DIR}/gea_embedded_app_config.h")

        file(MAKE_DIRECTORY "${RESIDENT_APP_GEN_DIR}")
        # Stub sources only have to exist so cmake can validate them as SRCS — vite_build
        # overwrites them with real generated content. Guard against reconfigure clobbering
        # real content with the empty stub.
        if(NOT EXISTS "${RESIDENT_APP_C}")
            file(WRITE "${RESIDENT_APP_C}" [[
#include "ui/ui.h"
#include "gea_embedded_font_generated.h"
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
int gea_embedded_app_mirror_begin_snapshot(void) { return 0; }
int gea_embedded_app_mirror_begin_diff(void) { return 0; }
int gea_embedded_app_mirror_next_record(unsigned char *dst, int cap) { (void)dst; (void)cap; return 0; }
void gea_embedded_app_mirror_clear_dirty(void) {}
void gea_embedded_app_mirror_set_int(int field, int value) { (void)field; (void)value; }
void gea_embedded_app_mirror_set_string(int field, const char *value) { (void)field; (void)value; }
void gea_embedded_app_mirror_set_array_len(int field, int len) { (void)field; (void)len; }
void gea_embedded_app_mirror_set_array_int(int field, int index, int subfield, int value) { (void)field; (void)index; (void)subfield; (void)value; }
void gea_embedded_app_mirror_commit(void) {}
int gea_embedded_app_mirror_get_field_count(void) { return 0; }
unsigned int gea_embedded_app_mirror_get_schema_hash(void) { return 0; }
void gea_embedded_app_ble_connected(void) {}
void gea_embedded_app_ble_disconnected(void) {}
void gea_embedded_app_ble_bound(void) {}
]])
        endif()
        if(NOT EXISTS "${RESIDENT_APP_FONT_H}")
            file(WRITE "${RESIDENT_APP_FONT_H}" [[
#pragma once
#define GEA_EMBEDDED_HAS_GENERATED_FONTS 1
#include <stdint.h>
typedef struct { uint8_t codepoint; uint16_t atlas_x, atlas_y; uint8_t width, height, advance; int8_t bearing_x, bearing_y; } gea_embedded_glyph_t;
typedef struct { int id, size_px, line_height, ascender, descender, glyph_count; const gea_embedded_glyph_t *glyphs; int atlas_w, atlas_h; const uint8_t *atlas; } gea_embedded_font_t;
#define GEA_EMBEDDED_FONT_COUNT 0
extern const gea_embedded_font_t gea_embedded_fonts[1];
const gea_embedded_font_t *gea_embedded_font_lookup(int font_id);
]])
        endif()
        if(NOT EXISTS "${RESIDENT_APP_FONT_GENERATED_C}")
            file(WRITE "${RESIDENT_APP_FONT_GENERATED_C}" [[
#include "gea_embedded_font_generated.h"
const gea_embedded_font_t gea_embedded_fonts[1] = {{ 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 }};
const gea_embedded_font_t *gea_embedded_font_lookup(int font_id) { return &gea_embedded_fonts[0]; }
]])
        endif()
        if(NOT EXISTS "${RESIDENT_APP_FONT_C}")
            file(WRITE "${RESIDENT_APP_FONT_C}" [[
#include "gea_embedded_font_generated.h"
const gea_embedded_font_t gea_embedded_fonts[1] = {{ 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 }};
const gea_embedded_font_t *gea_embedded_font_lookup(int font_id) { return &gea_embedded_fonts[0]; }
]])
        endif()
        _gea_write_if_different("${RESIDENT_APP_CONFIG_H}" "#pragma once\n#define GEA_EMBEDDED_PURE_C 1\n")

        # Stamp file in the build dir is the canonical OUTPUT — its mtime tracks the last
        # successful vite run, so reruns only happen when DEPENDS-listed sources are newer.
        # Real generated files are listed as BYPRODUCTS for parallel-build correctness.
        set(_RESIDENT_VITE_STAMP "${RESIDENT_APP_GEN_DIR}/vite_build.stamp")
        _gea_collect_app_sources(_RESIDENT_APP_SRCS "${RESIDENT_APP_DIR}")
        # `--outDir` redirects vite's dist/ output to a per-resident folder so this build never
        # collides with vite_build for the same example dir (the case when active app is also
        # listed as resident, e.g. app-launcher building itself + every other resident app).
        add_custom_command(
            OUTPUT ${_RESIDENT_VITE_STAMP}
            COMMAND ${CMAKE_COMMAND} -E env
                GEA_EMBEDDED_C_OUTPUT=${RESIDENT_APP_C}
                npm run build -- --outDir=${RESIDENT_APP_GEN_DIR}/dist
            COMMAND ${CMAKE_COMMAND} -E copy_if_different
                "${RESIDENT_APP_FONT_GENERATED_C}"
                "${RESIDENT_APP_FONT_C}"
            COMMAND ${CMAKE_COMMAND} -E touch ${_RESIDENT_VITE_STAMP}
            WORKING_DIRECTORY "${RESIDENT_APP_DIR}"
            DEPENDS
                ${_RESIDENT_APP_SRCS}
                ${_GEA_VITE_PLUGIN_SRCS}
                ${_GEA_FONT_ASSETS}
            BYPRODUCTS
                "${RESIDENT_APP_C}"
                "${RESIDENT_APP_FONT_GENERATED_C}"
                "${RESIDENT_APP_FONT_C}"
                "${RESIDENT_APP_FONT_H}"
                "${RESIDENT_APP_CONFIG_H}"
            COMMENT "Compiling resident app ${RESIDENT_APP_ID}: JSX -> C"
            VERBATIM
        )
        add_custom_target(resident_vite_${RESIDENT_APP_SAFE_ID} ALL
            DEPENDS ${_RESIDENT_VITE_STAMP}
        )
        list(APPEND RESIDENT_BUILD_TARGETS resident_vite_${RESIDENT_APP_SAFE_ID})

        set(RESIDENT_ENTRY_DEFINES
            gea_embedded_app_init=${RESIDENT_APP_PREFIX}_init
            gea_embedded_app_frame=${RESIDENT_APP_PREFIX}_frame
            gea_embedded_app_touch=${RESIDENT_APP_PREFIX}_touch
            gea_embedded_app_touch_start_element=${RESIDENT_APP_PREFIX}_touch_start_element
            gea_embedded_app_touch_end_element=${RESIDENT_APP_PREFIX}_touch_end_element
            gea_embedded_app_touch_move_element=${RESIDENT_APP_PREFIX}_touch_move_element
            gea_embedded_app_touch_start=${RESIDENT_APP_PREFIX}_touch_start
            gea_embedded_app_touch_move=${RESIDENT_APP_PREFIX}_touch_move
            gea_embedded_app_touch_end=${RESIDENT_APP_PREFIX}_touch_end
            gea_embedded_app_settings_toggle=${RESIDENT_APP_PREFIX}_settings_toggle
            gea_embedded_app_mirror_begin_snapshot=${RESIDENT_APP_PREFIX}_mirror_begin_snapshot
            gea_embedded_app_mirror_begin_diff=${RESIDENT_APP_PREFIX}_mirror_begin_diff
            gea_embedded_app_mirror_next_record=${RESIDENT_APP_PREFIX}_mirror_next_record
            gea_embedded_app_mirror_clear_dirty=${RESIDENT_APP_PREFIX}_mirror_clear_dirty
            gea_embedded_app_mirror_set_int=${RESIDENT_APP_PREFIX}_mirror_set_int
            gea_embedded_app_mirror_set_string=${RESIDENT_APP_PREFIX}_mirror_set_string
            gea_embedded_app_mirror_set_array_len=${RESIDENT_APP_PREFIX}_mirror_set_array_len
            gea_embedded_app_mirror_set_array_int=${RESIDENT_APP_PREFIX}_mirror_set_array_int
            gea_embedded_app_mirror_commit=${RESIDENT_APP_PREFIX}_mirror_commit
            gea_embedded_app_mirror_get_field_count=${RESIDENT_APP_PREFIX}_mirror_get_field_count
            gea_embedded_app_mirror_get_schema_hash=${RESIDENT_APP_PREFIX}_mirror_get_schema_hash
            gea_embedded_app_ble_connected=${RESIDENT_APP_PREFIX}_ble_connected
            gea_embedded_app_ble_disconnected=${RESIDENT_APP_PREFIX}_ble_disconnected
            gea_embedded_app_ble_bound=${RESIDENT_APP_PREFIX}_ble_bound
        )
        set(RESIDENT_FONT_DEFINES
            gea_embedded_fonts=${RESIDENT_APP_PREFIX}_fonts
            gea_embedded_font_lookup=${RESIDENT_APP_PREFIX}_font_lookup
        )
        set_source_files_properties("${RESIDENT_APP_C}" PROPERTIES COMPILE_DEFINITIONS "${RESIDENT_ENTRY_DEFINES}")
        set_source_files_properties("${RESIDENT_APP_FONT_C}" PROPERTIES COMPILE_DEFINITIONS "${RESIDENT_FONT_DEFINES}")
        string(APPEND _RESIDENT_APPS_LF_CONTENT "    ${RESIDENT_APP_SAFE_ID}_app (resident_app_ext)\n")

        list(APPEND RESIDENT_APP_SOURCE_FILES "${RESIDENT_APP_C}")
        list(APPEND RESIDENT_APP_FONT_FILES "${RESIDENT_APP_FONT_C}")
    endforeach()

    _gea_write_if_different("${RESIDENT_APPS_LF}" "${_RESIDENT_APPS_LF_CONTENT}")

    list(APPEND APP_GENERATED_SOURCES ${RESIDENT_APP_SOURCE_FILES} ${RESIDENT_APP_FONT_FILES})
    set(LD_FRAGMENT_ARGS "${RESIDENT_APPS_LF}")
    message(STATUS "Resident app-render apps: ${GEA_EMBEDDED_RESIDENT_APP_IDS}")
elseif(NOT CMAKE_SCRIPT_MODE_FILE)
    # IDF runs every component's CMakeLists.txt in script mode (component_get_requirements.cmake)
    # to extract REQUIRES. In that pass, cache STRING defaults win — GEA_EMBEDDED_APP resolves to
    # "tic-tac-toe" not the user's chosen app, so this else branch fires and would clobber the
    # real launcher registry with the stub on every reconfigure. Skipping the write in script mode
    # keeps file mtimes stable when nothing actually changed.
    _gea_write_if_different("${RESIDENT_APPS_REGISTRY_C}" "${_RESIDENT_APPS_REGISTRY_STUB}")
endif()

set(GEA_EMBEDDED_HTTPS_REQUIRES "")
set(GEA_EMBEDDED_HTTPS_COMPILE_DEFINITIONS "")
string(TOLOWER "${GEA_EMBEDDED_HTTPS_SUPPORT}" _GEA_EMBEDDED_HTTPS_SUPPORT_MODE)
set(_GEA_EMBEDDED_ENABLE_HTTPS 0)
if(_GEA_EMBEDDED_HTTPS_SUPPORT_MODE STREQUAL "auto")
    set(_GEA_EMBEDDED_HTTPS_SCAN_APP_IDS "${GEA_EMBEDDED_APP}")
    list(APPEND _GEA_EMBEDDED_HTTPS_SCAN_APP_IDS ${GEA_EMBEDDED_RESIDENT_APP_IDS})
    execute_process(
        COMMAND node
            "${GEA_EMBEDDED_ROOT}/scripts/detect-app-https-support.mjs"
            "${GEA_EMBEDDED_ROOT}/examples/apps.json"
            ${_GEA_EMBEDDED_HTTPS_SCAN_APP_IDS}
        OUTPUT_VARIABLE _GEA_EMBEDDED_HTTPS_SCAN_RESULT
        OUTPUT_STRIP_TRAILING_WHITESPACE
        RESULT_VARIABLE _GEA_EMBEDDED_HTTPS_SCAN_STATUS
    )
    if(NOT _GEA_EMBEDDED_HTTPS_SCAN_STATUS EQUAL 0)
        message(FATAL_ERROR "Failed to detect HTTPS support requirements")
    endif()
    if(_GEA_EMBEDDED_HTTPS_SCAN_RESULT STREQUAL "1")
        set(_GEA_EMBEDDED_ENABLE_HTTPS 1)
    endif()
elseif(_GEA_EMBEDDED_HTTPS_SUPPORT_MODE STREQUAL "on"
        OR _GEA_EMBEDDED_HTTPS_SUPPORT_MODE STREQUAL "true"
        OR _GEA_EMBEDDED_HTTPS_SUPPORT_MODE STREQUAL "yes"
        OR _GEA_EMBEDDED_HTTPS_SUPPORT_MODE STREQUAL "1")
    set(_GEA_EMBEDDED_ENABLE_HTTPS 1)
elseif(_GEA_EMBEDDED_HTTPS_SUPPORT_MODE STREQUAL "off"
        OR _GEA_EMBEDDED_HTTPS_SUPPORT_MODE STREQUAL "false"
        OR _GEA_EMBEDDED_HTTPS_SUPPORT_MODE STREQUAL "no"
        OR _GEA_EMBEDDED_HTTPS_SUPPORT_MODE STREQUAL "0")
    set(_GEA_EMBEDDED_ENABLE_HTTPS 0)
else()
    message(FATAL_ERROR "GEA_EMBEDDED_HTTPS_SUPPORT must be auto, on, or off")
endif()

if(_GEA_EMBEDDED_ENABLE_HTTPS)
    list(APPEND GEA_EMBEDDED_HTTPS_REQUIRES mbedtls)
    list(APPEND GEA_EMBEDDED_HTTPS_COMPILE_DEFINITIONS GEA_EMBEDDED_ENABLE_HTTPS=1)
endif()

set(XS_RUNTIME_SOURCES
    ${XS_DIR}/sources/xsAll.c
    ${XS_DIR}/sources/xsAPI.c
    ${XS_DIR}/sources/xsArguments.c
    ${XS_DIR}/sources/xsArray.c
    ${XS_DIR}/sources/xsAtomics.c
    ${XS_DIR}/sources/xsBigInt.c
    ${XS_DIR}/sources/xsBoolean.c
    ${XS_DIR}/sources/xsCode.c
    ${XS_DIR}/sources/xsCommon.c
    ${XS_DIR}/sources/xsDataView.c
    ${XS_DIR}/sources/xsDate.c
    ${XS_DIR}/sources/xsDebug.c
    ${XS_DIR}/sources/xsDefaults.c
    ${XS_DIR}/sources/xsdtoa.c
    ${XS_DIR}/sources/xsError.c
    ${XS_DIR}/sources/xsFunction.c
    ${XS_DIR}/sources/xsGenerator.c
    ${XS_DIR}/sources/xsGlobal.c
    ${XS_DIR}/sources/xsJSON.c
    ${XS_DIR}/sources/xsLexical.c
    ${XS_DIR}/sources/xsLockdown.c
    ${XS_DIR}/sources/xsMapSet.c
    ${XS_DIR}/sources/xsMarshall.c
    ${XS_DIR}/sources/xsMath.c
    ${XS_DIR}/sources/xsMemory.c
    ${XS_DIR}/sources/xsModule.c
    ${XS_DIR}/sources/xsNumber.c
    ${XS_DIR}/sources/xsObject.c
    ${XS_DIR}/sources/xsPlatforms.c
    ${XS_DIR}/sources/xsProfile.c
    ${XS_DIR}/sources/xsPromise.c
    ${XS_DIR}/sources/xsProperty.c
    ${XS_DIR}/sources/xsProxy.c
    ${XS_DIR}/sources/xsRegExp.c
    ${XS_DIR}/sources/xsRun.c
    ${XS_DIR}/sources/xsScope.c
    ${XS_DIR}/sources/xsScript.c
    ${XS_DIR}/sources/xsSnapshot.c
    ${XS_DIR}/sources/xsSourceMap.c
    ${XS_DIR}/sources/xsString.c
    ${XS_DIR}/sources/xsSymbol.c
    ${XS_DIR}/sources/xsSyntaxical.c
    ${XS_DIR}/sources/xsTree.c
    ${XS_DIR}/sources/xsType.c
    ${XS_DIR}/sources/xsre.c
    ${XS_DIR}/sources/xsmc.c
)

idf_component_register(
    SRCS
        "app_main.c"
        "apps.c"
        "audio.c"
        "display.c"
        "touch.c"
        "${GEA_EMBEDDED_ROOT}/targets/shared/platform.c"
        "${GEA_EMBEDDED_ROOT}/targets/shared/font_8x16.c"
        "${GEA_EMBEDDED_ROOT}/targets/shared/ui/core.c"
        "${GEA_EMBEDDED_ROOT}/targets/shared/ui/view.c"
        "${GEA_EMBEDDED_ROOT}/targets/shared/ui/text.c"
        "${GEA_EMBEDDED_ROOT}/targets/shared/ui/image.c"
        "${GEA_EMBEDDED_ROOT}/targets/shared/ui/layout.c"
        "${GEA_EMBEDDED_ROOT}/targets/shared/ui/render.c"
        "${GEA_EMBEDDED_ROOT}/targets/shared/ui/input.c"
        "${GEA_EMBEDDED_ROOT}/targets/shared/raster.c"
        "${GEA_EMBEDDED_ROOT}/targets/shared/image.c"
        "${GEA_EMBEDDED_ROOT}/targets/shared/ble.c"
        "${GEA_EMBEDDED_ROOT}/targets/shared/imu.c"
        "${GEA_EMBEDDED_ROOT}/vendor/AnimatedGIF/AnimatedGIF.c"
        ${XS_RUNTIME_SOURCES}
        ${XS_COMPILED_SOURCE}
        ${APP_GENERATED_SOURCES}
    INCLUDE_DIRS
        "include"
        "${GEA_EMBEDDED_ROOT}/targets/shared"
        "${GEA_EMBEDDED_ROOT}/targets/shared/include"
        "${GEA_EMBEDDED_ROOT}/vendor/stb"
        "${GEA_EMBEDDED_ROOT}/vendor/AnimatedGIF"
        ${XS_DIR}/includes
        ${XS_DIR}/sources
        ${XS_GEN_DIR}
        ${GENERATED_APP_DIR}
        ${CMAKE_BINARY_DIR}
    REQUIRES
        esp_system
        esp_timer
        freertos
        lwip
        esp_wifi
        esp_http_server
        esp_http_client
        ${GEA_EMBEDDED_HTTPS_REQUIRES}
        app_update
        esp_netif
        esp_event
        nvs_flash
        esp_lcd
        driver
        esp_driver_i2c
        esp_driver_i2s
        esp_codec_dev
        bt
    LDFRAGMENTS
        ${LD_FRAGMENT_ARGS}
)

target_compile_definitions(${COMPONENT_LIB} PRIVATE
    INCLUDE_XSPLATFORM=1
    mxRun=1
    mxParse=1
    UI_MAX_NODES=256
    ${GEA_EMBEDDED_HTTPS_COMPILE_DEFINITIONS}
)

if(GEA_EMBEDDED_APP_RUNTIME STREQUAL "app-render")
    target_compile_definitions(${COMPONENT_LIB} PRIVATE
        GEA_EMBEDDED_PURE_C=1
    )
else()
    target_compile_definitions(${COMPONENT_LIB} PRIVATE
        UI_MAX_CHILDREN=32
        UI_MAX_FLEX_LINES=8
        DISPLAY_LIST_MAX=128
    )
endif()

target_compile_options(${COMPONENT_LIB} PRIVATE
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
    -Wno-clobbered
)

# --- Host xsc build + JS compilation (after idf_component_register) ---

set(XSC_BUILD_DIR "${CMAKE_BINARY_DIR}/host_tools")
set(XSC_BINARY "${XSC_BUILD_DIR}/xsc")

set(XSC_SOURCES
    ${XS_DIR}/sources/xsBigInt.c
    ${XS_DIR}/sources/xsCode.c
    ${XS_DIR}/sources/xsCommon.c
    ${XS_DIR}/sources/xsdtoa.c
    ${XS_DIR}/sources/xsLexical.c
    ${XS_DIR}/sources/xsre.c
    ${XS_DIR}/sources/xsScope.c
    ${XS_DIR}/sources/xsScript.c
    ${XS_DIR}/sources/xsSourceMap.c
    ${XS_DIR}/sources/xsSyntaxical.c
    ${XS_DIR}/sources/xsTree.c
    ${XS_DIR}/tools/xsc.c
)

file(MAKE_DIRECTORY ${XSC_BUILD_DIR})
file(MAKE_DIRECTORY ${XS_GEN_DIR})

add_custom_command(
    OUTPUT ${XSC_BINARY}
    COMMAND cc -O2 -DmxCompile=1
            -I${XS_DIR}/includes
            -I${XS_DIR}/platforms
            -I${XS_DIR}/sources
            -I${XS_DIR}/tools
            ${XSC_SOURCES}
            -lm -o ${XSC_BINARY}
    DEPENDS ${XSC_SOURCES}
    COMMENT "Building host xsc compiler"
    VERBATIM
)

# Stamp file in build dir is the canonical OUTPUT. The real vite outputs (dist/index.js plus the
# generated C/H files written by the gea-embedded plugin) are listed as BYPRODUCTS so cmake/make
# know to expect them. DEPENDS lists every source that influences vite output, so a no-op rebuild
# touches nothing.
set(_VITE_BUILD_STAMP "${CMAKE_BINARY_DIR}/vite_build.stamp")
_gea_collect_app_sources(_ACTIVE_APP_SRCS "${GEA_EMBEDDED_APP_DIR}")
add_custom_command(
    OUTPUT ${_VITE_BUILD_STAMP}
    COMMAND npm run build
    COMMAND ${CMAKE_COMMAND} -E touch ${_VITE_BUILD_STAMP}
    WORKING_DIRECTORY "${GEA_EMBEDDED_APP_DIR}"
    DEPENDS
        ${_ACTIVE_APP_SRCS}
        ${_GEA_VITE_PLUGIN_SRCS}
        ${_GEA_FONT_ASSETS}
    BYPRODUCTS
        ${JS_APP}
        ${GENERATED_C}
        ${GENERATED_FONT_C}
        ${GENERATED_FONT_H}
        ${GENERATED_CONFIG_H}
    COMMENT "Compiling ${GEA_EMBEDDED_APP}: JSX -> C + thin JS"
    VERBATIM
)
add_custom_target(vite_build ALL DEPENDS ${_VITE_BUILD_STAMP})

add_custom_command(
    OUTPUT ${XS_COMPILED_SOURCE} ${XS_GEN_DIR}/index.xs.h
    COMMAND ${XSC_BINARY} "${JS_APP}" -o "${XS_GEN_DIR}" -r index -p
    DEPENDS ${XSC_BINARY} "${JS_APP}"
    COMMENT "Compiling ${JS_APP} -> XS bytecode"
    VERBATIM
)

add_custom_target(xs_compiled_app DEPENDS ${XS_COMPILED_SOURCE})
add_dependencies(xs_compiled_app vite_build)
add_dependencies(${COMPONENT_LIB} xs_compiled_app)
if(RESIDENT_BUILD_TARGETS)
    add_dependencies(${COMPONENT_LIB} ${RESIDENT_BUILD_TARGETS})
endif()

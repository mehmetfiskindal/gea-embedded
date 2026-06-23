/*
 * quickjs_shim.c — registers the screen.*, WiFi.*, Accelerometer.* and
 * image host functions on a QuickJS context, then runs the loaded
 * bytecode.
 *
 * This is a stub for Phase 1: the full bindings (mirroring the ESP32
 * XS host functions) land in Phase 4 once the JS-side shim is
 * stabilized.
 */

#if GEA_EMBEDDED_JS_RUNTIME

#include "quickjs_shim.h"
#include "display.h"
#include "log.h"

#include "quickjs.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static JSRuntime *g_rt = NULL;
static JSContext *g_ctx = NULL;

static JSValue js_screen_clear(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
    (void)this_val; (void)argc; (void)argv;
    gea_embedded_display_clear(0x0000);
    return JS_UNDEFINED;
}

static JSValue js_screen_flush(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
    (void)ctx; (void)this_val; (void)argc; (void)argv;
    gea_embedded_display_flush();
    return JS_UNDEFINED;
}

int gea_embedded_qjs_init(int viewport_w, int viewport_h) {
    g_rt = JS_NewRuntime();
    if (!g_rt) return -1;
    /* 4 MiB heap, mirrors the budget in Bölüm 4.2. */
    JS_SetMemoryLimit(g_rt, 4 * 1024 * 1024);
    JS_SetMaxStackSize(g_rt, 256 * 1024);

    g_ctx = JS_NewContext(g_rt);
    if (!g_ctx) {
        JS_FreeRuntime(g_rt); g_rt = NULL;
        return -1;
    }

    JSValue screen = JS_NewObject(g_ctx);
    JS_SetPropertyStr(g_ctx, screen, "clear", JS_NewCFunction(g_ctx, js_screen_clear, "clear", 0));
    JS_SetPropertyStr(g_ctx, screen, "flush", JS_NewCFunction(g_ctx, js_screen_flush, "flush", 0));
    JS_SetPropertyStr(g_ctx, screen, "width",  JS_NewInt32(g_ctx, viewport_w));
    JS_SetPropertyStr(g_ctx, screen, "height", JS_NewInt32(g_ctx, viewport_h));
    JSValue global = JS_GetGlobalObject(g_ctx);
    JS_SetPropertyStr(g_ctx, global, "screen", screen);
    JS_FreeValue(g_ctx, global);

    gea_logi("quickjs: context ready (viewport %dx%d)", viewport_w, viewport_h);
    return 0;
}

int gea_embedded_qjs_load_bytecode(const unsigned char *data, size_t size) {
    if (!g_ctx || !data || size == 0) return -1;
    JSValue val = JS_ReadObject(g_ctx, data, size, JS_READ_OBJ_BYTECODE);
    if (JS_IsException(val)) {
        gea_loge("quickjs: bytecode load failed");
        JS_FreeValue(g_ctx, val);
        return -1;
    }
    JSValue ret = JS_EvalFunction(g_ctx, val);
    if (JS_IsException(ret)) {
        JSValue exc = JS_GetException(g_ctx);
        const char *str = JS_ToCString(g_ctx, exc);
        gea_loge("quickjs: eval error: %s", str ? str : "(unknown)");
        if (str) JS_FreeCString(g_ctx, str);
        JS_FreeValue(g_ctx, exc);
        JS_FreeValue(g_ctx, ret);
        return -1;
    }
    JS_FreeValue(g_ctx, ret);
    return 0;
}

void gea_embedded_qjs_tick(void) {
    if (g_rt) JS_RunGC(g_rt);
}

void gea_embedded_qjs_shutdown(void) {
    if (g_ctx) { JS_FreeContext(g_ctx); g_ctx = NULL; }
    if (g_rt)  { JS_FreeRuntime(g_rt);  g_rt  = NULL; }
}

#endif /* GEA_EMBEDDED_JS_RUNTIME */

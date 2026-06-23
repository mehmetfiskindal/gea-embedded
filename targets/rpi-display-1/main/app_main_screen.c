/*
 * app_main_screen.c — entry point for screen-runtime apps.
 *
 * Boots QuickJS, loads the bytecode emitted by `qjsc`, registers the
 * screen.* / WiFi.* / Accelerometer.* / __gea_embedded_image.* host
 * functions, then pumps the JS event loop.
 *
 * This file is only compiled when GEA_RPI_JS_RUNTIME=ON and the app's
 * runtime is "screen".
 */

#if GEA_EMBEDDED_JS_RUNTIME

#include "display.h"
#include "input.h"
#include "log.h"
#include "platform.h"
#include "quickjs_shim.h"
#include "wifi.h"

#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

extern const unsigned char app_bytecode[];
extern const unsigned long  app_bytecode_size;

static volatile int g_running = 1;
static void on_signal(int s) { (void)s; g_running = 0; }

int main(int argc, char **argv) {
    (void)argc; (void)argv;
    signal(SIGINT,  on_signal);
    signal(SIGTERM, on_signal);
    signal(SIGPIPE, SIG_IGN);

    const char *app_id = getenv("GEA_RPI_APP_ID");
    if (!app_id || !*app_id) app_id = "screen-app";

    char log_path[512];
    snprintf(log_path, sizeof(log_path), "/tmp/geat-%s.log", app_id);
    gea_embedded_log_init(app_id, log_path);

    gea_rpi_display_backend_t backend  = gea_embedded_display_backend_from_env(
        getenv("GEA_RPI_DISPLAY_BACKEND"));
    gea_rpi_viewport_t viewport = gea_embedded_display_viewport_from_env(
        getenv("GEA_RPI_VIEWPORT"));
    if (gea_embedded_display_init(backend, viewport) != 0) {
        gea_loge("display init failed; aborting");
        return 1;
    }
    gea_embedded_input_set_panel_size(gea_embedded_display_get_panel_width(),
                                      gea_embedded_display_get_panel_height());
    gea_embedded_input_set_viewport_size(gea_embedded_display_viewport_width(),
                                          gea_embedded_display_viewport_height());

    gea_embedded_input_callbacks_t cbs = { 0 };
    gea_embedded_input_init(GEA_RPI_INPUT_BACKEND_EVDEV, &cbs);

    if (gea_embedded_qjs_init(gea_embedded_display_viewport_width(),
                               gea_embedded_display_viewport_height()) != 0) {
        gea_loge("quickjs init failed");
        return 1;
    }
    if (gea_embedded_qjs_load_bytecode(app_bytecode, (size_t)app_bytecode_size) != 0) {
        gea_loge("quickjs load failed");
        return 1;
    }

    int poll_ms = 16;
    const char *poll_env = getenv("GEA_RPI_POLL_MS");
    if (poll_env) poll_ms = atoi(poll_env);
    if (poll_ms < 1) poll_ms = 1;

    while (g_running) {
        uint32_t t0 = gea_embedded_platform_now_ms();
        gea_embedded_input_poll(0);
        gea_embedded_qjs_tick();
        gea_embedded_display_flush();
        uint32_t dt = gea_embedded_platform_now_ms() - t0;
        if (dt < (uint32_t)poll_ms) gea_embedded_platform_sleep_ms(poll_ms - dt);
    }

    gea_embedded_qjs_shutdown();
    gea_embedded_input_shutdown();
    gea_embedded_display_shutdown();
    gea_embedded_log_shutdown();
    return 0;
}

#endif /* GEA_EMBEDDED_JS_RUNTIME */

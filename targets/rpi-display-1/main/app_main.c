/*
 * app_main.c — Raspberry Pi target entry point.
 *
 * Boots the display backend, optionally the JS runtime, the input
 * stack, the mirror/log servers, then runs a single-threaded poll
 * loop at GEA_RPI_POLL_MS intervals.
 *
 * For pure-C app-render apps, the JS runtime is not started and
 * the active runtime is app-render only.
 */

#include "display.h"
#include "input.h"
#include "log.h"
#include "mirror.h"
#include "ota.h"
#include "platform.h"
#include "wifi.h"
#include "assets.h"
#include "ui/ui.h"

#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/time.h>
#include <unistd.h>

/* These are provided by the Vite plugin / app build step. */
extern void gea_embedded_app_init(int w, int h);
extern void gea_embedded_app_frame(int timestamp_ms);
extern void gea_embedded_app_touch(int press_id);
extern void gea_embedded_app_touch_start(int x, int y);
extern void gea_embedded_app_touch_move(int x, int y);
extern void gea_embedded_app_touch_end(int x, int y);
extern void gea_embedded_app_touch_start_element(int press_id, int x, int y);
extern void gea_embedded_app_touch_move_element(int press_id, int x, int y);
extern void gea_embedded_app_touch_end_element(int press_id, int x, int y);

/* ---- Run-state ---- */

static volatile int g_running = 1;
static int g_pressed = 0;
static int g_touch_start_x = 0, g_touch_start_y = 0;
static int g_touch_dragged = 0;
static int g_touch_press_id = -1;

#define GEA_RPI_TAP_DRAG_THRESHOLD_PX 10

static void on_signal(int sig) {
    (void)sig;
    g_running = 0;
}

static void install_signal_handlers(void) {
    struct sigaction sa = { 0 };
    sa.sa_handler = on_signal;
    sigemptyset(&sa.sa_mask);
    sigaction(SIGINT,  &sa, NULL);
    sigaction(SIGTERM, &sa, NULL);
    signal(SIGPIPE, SIG_IGN);
}

/* ---- Input callbacks ---- */

static void on_touch_start(int x, int y, void *user) {
    (void)user;
    g_pressed = 1;
    g_touch_start_x = x;
    g_touch_start_y = y;
    g_touch_dragged = 0;
    g_touch_press_id = gea_embedded_ui_hit_test(x, y);
    gea_embedded_ui_touch_down(x, y);
    gea_embedded_app_touch_start(x, y);
    if (g_touch_press_id >= 0) {
        gea_embedded_app_touch_start_element(g_touch_press_id, x, y);
    }
}

static void on_touch_move(int x, int y, void *user) {
    (void)user;
    if (!g_pressed) return;
    if (!g_touch_dragged) {
        int dx = x - g_touch_start_x;
        int dy = y - g_touch_start_y;
        if (dx >  GEA_RPI_TAP_DRAG_THRESHOLD_PX || dx < -GEA_RPI_TAP_DRAG_THRESHOLD_PX ||
            dy >  GEA_RPI_TAP_DRAG_THRESHOLD_PX || dy < -GEA_RPI_TAP_DRAG_THRESHOLD_PX) {
            g_touch_dragged = 1;
        }
    }
    gea_embedded_app_touch_move(x, y);
    if (g_touch_press_id >= 0) {
        gea_embedded_app_touch_move_element(g_touch_press_id, x, y);
    }
}

static void on_touch_end(int x, int y, void *user) {
    (void)user;
    if (g_pressed) {
        gea_embedded_ui_touch_up();
    }
    g_pressed = 0;
    gea_embedded_app_touch_end(x, y);
    if (g_touch_press_id >= 0) {
        gea_embedded_app_touch_end_element(g_touch_press_id, x, y);
    }
    if (!g_touch_dragged) {
        int cb_id = gea_embedded_ui_hit_test(x, y);
        if (cb_id >= 0) {
            gea_embedded_app_touch(cb_id);
        }
    }
    g_touch_press_id = -1;
    g_touch_dragged = 0;
}

static void on_key(int code, int pressed, void *user) {
    (void)user;
    /* ESC / q → quit (matches the dev contract from the plan). */
    if (pressed && (code == 1 /* ESC */ || code == 16 /* q */)) {
        gea_logi("app: quit requested via key");
        g_running = 0;
    }
}

/* ---- Frame loop ---- */

static void run_frame_loop(int poll_ms) {
    uint32_t last_frame = 0;
    int wakeup_fd = -1;

    while (g_running) {
        uint32_t t0 = gea_embedded_platform_now_ms();

        gea_embedded_input_poll(0);    /* non-blocking drain */
        gea_embedded_mirror_tick();
        gea_embedded_log_stream_tick();

        /* Cap frame rate at 1/period; render only when a new frame is due. */
        if (t0 - last_frame >= (uint32_t)poll_ms) {
            gea_embedded_app_frame((int)t0);
            gea_embedded_display_flush();
            last_frame = t0;
        }

        /* Sleep until next frame is due. */
        uint32_t elapsed = gea_embedded_platform_now_ms() - t0;
        if (elapsed < (uint32_t)poll_ms) {
            gea_embedded_platform_sleep_ms((uint32_t)poll_ms - elapsed);
        }
    }
    (void)wakeup_fd;
}

int main(int argc, char **argv) {
    (void)argc; (void)argv;

    install_signal_handlers();

    /* Initialize asset root and logging first. */
    const char *app_id = getenv("GEA_RPI_APP_ID");
    if (!app_id || !*app_id) app_id = "tic-tac-toe";

    char log_path[512];
    snprintf(log_path, sizeof(log_path), "/tmp/geat-%s.log", app_id);
    gea_embedded_log_init(app_id, log_path);
    gea_embedded_assets_init(NULL);

    /* Build banner so we can confirm the binary version on the Pi. */
    const char *dbg = getenv("GEA_RPI_DEBUG_PANEL");
    gea_logi("=== %s starting (linuxfb-rpi, build 2026-06-22, debug_panel=%s) ===",
             app_id, dbg ? dbg : "0");

    /* ---- Display ---- */
    const char *backend_env = getenv("GEA_RPI_DISPLAY_BACKEND");
    const char *viewport_env = getenv("GEA_RPI_VIEWPORT");
    gea_rpi_display_backend_t backend  = gea_embedded_display_backend_from_env(backend_env);
    gea_rpi_viewport_t        viewport = gea_embedded_display_viewport_from_env(viewport_env);
    if (gea_embedded_display_init(backend, viewport) != 0) {
        gea_loge("display init failed; aborting");
        return 1;
    }
    gea_embedded_input_set_panel_size(gea_embedded_display_get_panel_width(),
                                      gea_embedded_display_get_panel_height());
    gea_embedded_input_set_viewport_size(gea_embedded_display_viewport_width(),
                                          gea_embedded_display_viewport_height());

    /* ---- Input ---- */
    gea_rpi_input_callbacks_t cbs = {
        .on_touch_start = on_touch_start,
        .on_touch_move  = on_touch_move,
        .on_touch_end   = on_touch_end,
        .on_key         = on_key,
    };
    if (gea_embedded_input_init(GEA_RPI_INPUT_BACKEND_EVDEV, &cbs) != 0) {
        gea_logw("input: no devices found; running headless");
    }

    /* ---- Optional services ---- */
#if GEA_EMBEDDED_MIRROR
    const char *mirror_port_env = getenv("GEA_RPI_MIRROR_PORT");
    uint16_t mirror_port = mirror_port_env ? (uint16_t)atoi(mirror_port_env) : 8082;
    gea_embedded_mirror_init(mirror_port);
#endif
#if GEA_EMBEDDED_LOG_STREAM
    const char *log_port_env = getenv("GEA_RPI_LOG_PORT");
    uint16_t log_port = log_port_env ? (uint16_t)atoi(log_port_env) : 8081;
    gea_embedded_log_stream_init(log_port);
#endif
    gea_embedded_ota_init();
    (void)gea_embedded_wifi_is_connected;  /* keep link-time happy */

    /* ---- App init ---- */
    int vw = gea_embedded_display_viewport_width();
    int vh = gea_embedded_display_viewport_height();
    gea_embedded_display_clear();
    gea_embedded_app_init(vw, vh);

    /* ---- Run ---- */
    const char *poll_env = getenv("GEA_RPI_POLL_MS");
    int poll_ms = poll_env ? atoi(poll_env) : 33;  /* 30 Hz default on Pi Zero */
    if (poll_ms < 1) poll_ms = 1;
    if (poll_ms > 200) poll_ms = 200;

    gea_logi("main: entering frame loop (period %d ms)", poll_ms);
    run_frame_loop(poll_ms);

    /* ---- Shutdown ---- */
    gea_logi("main: shutting down");
#if GEA_EMBEDDED_MIRROR
    gea_embedded_mirror_shutdown();
#endif
#if GEA_EMBEDDED_LOG_STREAM
    gea_embedded_log_stream_shutdown();
#endif
    gea_embedded_input_shutdown();
    gea_embedded_display_shutdown();
    gea_embedded_log_shutdown();
    return 0;
}

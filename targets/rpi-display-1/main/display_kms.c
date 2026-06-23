/*
 * display_kms.c — KMS/DRM dumb-buffer backend (placeholder).
 *
 * This file is only compiled when libdrm is found (GEA_EMBEDDED_HAS_KMS=1).
 * It provides the same API surface as display_linuxfb.c so the dispatcher
 * in display.c can route flushes accordingly. The actual KMS bring-up is
 * Phase 2 work; for now the init returns -1 to force fallback to linuxfb.
 */

#include "display.h"
#include "log.h"

#include <stdlib.h>
#include <string.h>
#include <time.h>


/* ---- State ---- */
static int g_kms_initialized = 0;
static int g_kms_w = 0, g_kms_h = 0;

int gea_embedded_display_kms_init(void) {
    /* TODO(phase-2): open /dev/dri/card0, pick a connected connector, pick
     * a 1024x600 mode, create 2x dumb buffers, mmap them, set CRTC. Until
     * this lands, return -1 to let display.c fall back to linuxfb. */
    gea_logw("kms: backend not yet implemented; falling back");
    (void)g_kms_initialized;
    (void)g_kms_w;
    (void)g_kms_h;
    return -1;
}

void gea_embedded_display_kms_shutdown(void) {
    g_kms_initialized = 0;
    g_kms_w = 0; g_kms_h = 0;
}

void gea_embedded_display_kms_set_flush_config(int chunk_rows, int queue_depth) {
    (void)chunk_rows; (void)queue_depth;
}

int gea_embedded_display_kms_wait_vsync(int timeout_ms) {
    /* Page-flip event-based vsync; until KMS is implemented, sleep. */
    struct timespec ts = { 0, (long)(timeout_ms > 0 ? timeout_ms : 16) * 1000000L };
    nanosleep(&ts, NULL);
    return 0;
}

void gea_embedded_display_kms_flush_region(int x, int y, int w, int h) {
    /* When implemented: drmModeAddFB2 + drmModePageFlip on the dirty region. */
    (void)x; (void)y; (void)w; (void)h;
}

/*
 * display.c — display backend dispatcher + raster wrappers
 *
 * Allocates the framebuffer, binds a shared gea_embedded_raster_t to it,
 * and routes every draw API to the raster. linuxfb (or KMS) is responsible
 * for the actual scanout.
 */

#define _POSIX_C_SOURCE 200809L

#include "display.h"
#include "display_linuxfb.h"
#include "log.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <pthread.h>

#include "raster.h"

#if __has_include("gea_embedded_font_generated.h")
#include "gea_embedded_font_generated.h"
#endif

/* The visible surface: for native viewport this IS the framebuffer; for
 * compat viewport this is a 410x502 shadow that the app renders into,
 * and the linuxfb backend upscales/blits it into the panel buffer. */
static gea_embedded_raster_t g_raster = { 0 };
static gea_rpi_viewport_t    g_viewport = GEA_RPI_VIEWPORT_COMPAT;
static int                   g_viewport_w = GEA_RPI_COMPAT_WIDTH;
static int                   g_viewport_h = GEA_RPI_COMPAT_HEIGHT;

static gea_rpi_display_backend_t g_active_backend = GEA_RPI_DISPLAY_BACKEND_AUTO;

/* ---- Backend / viewport env parsing ---- */

gea_rpi_display_backend_t gea_embedded_display_backend_from_env(const char *env_value) {
    if (!env_value || !*env_value) return GEA_RPI_DISPLAY_BACKEND_AUTO;
    if (strcasecmp(env_value, "kms")     == 0) return GEA_RPI_DISPLAY_BACKEND_KMS;
    if (strcasecmp(env_value, "linuxfb") == 0) return GEA_RPI_DISPLAY_BACKEND_LINUXFB;
    if (strcasecmp(env_value, "auto")    == 0) return GEA_RPI_DISPLAY_BACKEND_AUTO;
    gea_logw("display: unknown backend '%s', falling back to auto", env_value);
    return GEA_RPI_DISPLAY_BACKEND_AUTO;
}

gea_rpi_viewport_t gea_embedded_display_viewport_from_env(const char *env_value) {
    if (!env_value || !*env_value) return GEA_RPI_VIEWPORT_COMPAT;
    if (strcasecmp(env_value, "native") == 0) return GEA_RPI_VIEWPORT_NATIVE;
    if (strcasecmp(env_value, "compat") == 0) return GEA_RPI_VIEWPORT_COMPAT;
    gea_logw("display: unknown viewport '%s', falling back to compat", env_value);
    return GEA_RPI_VIEWPORT_COMPAT;
}

void gea_embedded_display_set_viewport(gea_rpi_viewport_t vp) {
    g_viewport = vp;
    if (vp == GEA_RPI_VIEWPORT_NATIVE) {
        g_viewport_w = GEA_RPI_PANEL_WIDTH;
        g_viewport_h = GEA_RPI_PANEL_HEIGHT;
    } else {
        g_viewport_w = GEA_RPI_COMPAT_WIDTH;
        g_viewport_h = GEA_RPI_COMPAT_HEIGHT;
    }
}

gea_rpi_viewport_t gea_embedded_display_get_viewport(void) { return g_viewport; }
int gea_embedded_display_viewport_width(void)             { return g_viewport_w;  }
int gea_embedded_display_viewport_height(void)            { return g_viewport_h; }

/* ---- Lifecycle ---- */

int gea_embedded_display_init(gea_rpi_display_backend_t backend, gea_rpi_viewport_t viewport) {
    gea_embedded_display_set_viewport(viewport);
    g_active_backend = backend;

    int rc = -1;
#if GEA_EMBEDDED_HAS_KMS
    if (backend == GEA_RPI_DISPLAY_BACKEND_KMS ||
        backend == GEA_RPI_DISPLAY_BACKEND_AUTO) {
        rc = gea_embedded_display_kms_init();
        if (rc == 0) {
            g_active_backend = GEA_RPI_DISPLAY_BACKEND_KMS;
            gea_logi("display: using KMS backend");
            goto backend_ok;
        } else if (backend == GEA_RPI_DISPLAY_BACKEND_KMS) {
            gea_loge("display: KMS requested but init failed (rc=%d)", rc);
            return rc;
        } else {
            gea_logw("display: KMS init failed (rc=%d), falling back to linuxfb", rc);
        }
    }
#endif
    rc = gea_embedded_display_linuxfb_init(g_viewport_w, g_viewport_h);
    if (rc == 0) {
        g_active_backend = GEA_RPI_DISPLAY_BACKEND_LINUXFB;
        gea_logi("display: using linuxfb backend (viewport %dx%d)", g_viewport_w, g_viewport_h);
    } else {
        gea_loge("display: linuxfb init failed (rc=%d)", rc);
        return rc;
    }

backend_ok: {
    uint16_t *pixels = gea_embedded_display_linuxfb_get_back_buffer();
    if (!pixels) {
        gea_loge("display: back buffer is NULL after init");
        return -1;
    }
    gea_embedded_raster_bind(&g_raster, pixels, g_viewport_w, g_viewport_h);
    gea_embedded_display_reset_dirty();
    gea_embedded_raster_reset_clip(&g_raster);
    return 0;
}
}

void gea_embedded_display_shutdown(void) {
    if (g_active_backend == GEA_RPI_DISPLAY_BACKEND_LINUXFB) {
        gea_embedded_display_linuxfb_shutdown();
#if GEA_EMBEDDED_HAS_KMS
    } else if (g_active_backend == GEA_RPI_DISPLAY_BACKEND_KMS) {
        gea_embedded_display_kms_shutdown();
#endif
    }
    memset(&g_raster, 0, sizeof(g_raster));
}

/* ---- Surface access ---- */

gea_rpi_surface_t *gea_embedded_display_get_surface(void) {
    static gea_rpi_surface_t s;
    s.width        = g_viewport_w;
    s.height       = g_viewport_h;
    s.stride_bytes = g_viewport_w * (int)sizeof(uint16_t);
    s.pixels       = gea_embedded_raster_pixels(&g_raster);
    return &s;
}

uint16_t *gea_embedded_display_get_back_buffer(void) { return gea_embedded_raster_pixels(&g_raster); }
int       gea_embedded_display_get_width(void)        { return gea_embedded_raster_width(&g_raster); }
int       gea_embedded_display_get_height(void)       { return gea_embedded_raster_height(&g_raster); }
int       gea_embedded_display_get_stride_bytes(void) { return gea_embedded_raster_stride_bytes(&g_raster); }

int gea_embedded_display_get_panel_width(void) {
    if (g_active_backend == GEA_RPI_DISPLAY_BACKEND_LINUXFB) {
        return gea_embedded_display_linuxfb_get_panel_width();
    }
    return GEA_RPI_PANEL_WIDTH;
}

int gea_embedded_display_get_panel_height(void) {
    if (g_active_backend == GEA_RPI_DISPLAY_BACKEND_LINUXFB) {
        return gea_embedded_display_linuxfb_get_panel_height();
    }
    return GEA_RPI_PANEL_HEIGHT;
}

/* ---- Dirty-rect ---- */

void gea_embedded_display_mark_dirty(int x, int y, int w, int h) {
    if (w <= 0 || h <= 0) return;
    if (x < 0) { w += x; x = 0; }
    if (y < 0) { h += y; y = 0; }
    if (x >= g_viewport_w || y >= g_viewport_h) return;
    if (x + w > g_viewport_w) w = g_viewport_w - x;
    if (y + h > g_viewport_h) h = g_viewport_h - y;
    gea_embedded_raster_mark_dirty(&g_raster, x, y, x + w - 1, y + h - 1);
}

int gea_embedded_display_get_dirty(int *x, int *y, int *w, int *h) {
    int x0, y0, x1, y1;
    if (!gea_embedded_raster_get_dirty(&g_raster, &x0, &y0, &x1, &y1)) {
        return 0;
    }
    if (x) *x = x0;
    if (y) *y = y0;
    if (w) *w = x1 - x0;
    if (h) *h = y1 - y0;
    return 1;
}

void gea_embedded_display_reset_dirty(void) {
    gea_embedded_raster_reset_dirty(&g_raster);
}

/* ---- Frame ---- */

void gea_embedded_display_clear(void) {
    gea_embedded_raster_clear(&g_raster, 0x0000);
    gea_embedded_display_mark_dirty(0, 0, g_viewport_w, g_viewport_h);
}

void gea_embedded_display_flush(void) {
    int x0, y0, w, h;
    if (!gea_embedded_display_get_dirty(&x0, &y0, &w, &h)) {
        return;  /* static scene; skip the blit */
    }

    if (g_active_backend == GEA_RPI_DISPLAY_BACKEND_LINUXFB) {
        gea_embedded_display_linuxfb_flush_region(x0, y0, w, h, g_viewport);
#if GEA_EMBEDDED_HAS_KMS
    } else if (g_active_backend == GEA_RPI_DISPLAY_BACKEND_KMS) {
        gea_embedded_display_kms_flush_region(x0, y0, w, h);
#endif
    }

    gea_embedded_display_reset_dirty();
}

void gea_embedded_display_set_flush_config(int chunk_rows, int queue_depth) {
    gea_embedded_display_linuxfb_set_flush_config(chunk_rows, queue_depth);
#if GEA_EMBEDDED_HAS_KMS
    gea_embedded_display_kms_set_flush_config(chunk_rows, queue_depth);
#endif
}

int gea_embedded_display_wait_vsync(int timeout_ms) {
#if GEA_EMBEDDED_HAS_KMS
    if (g_active_backend == GEA_RPI_DISPLAY_BACKEND_KMS) {
        return gea_embedded_display_kms_wait_vsync(timeout_ms);
    }
#endif
    return gea_embedded_display_linuxfb_wait_vsync(timeout_ms);
}

/* ---- Brightness ---- */

int  gea_embedded_display_get_brightness(void)        { return 100; }
void gea_embedded_display_set_brightness(int percent) { (void)percent; }

/* ---- Raster draw API ---- */

void gea_embedded_display_set_pixel(int x, int y, uint16_t color) { gea_embedded_raster_set_pixel(&g_raster, x, y, color); }
void gea_embedded_display_fill_rect(int x, int y, int w, int h, uint16_t color) { gea_embedded_raster_fill_rect(&g_raster, x, y, w, h, color); }
void gea_embedded_display_stroke_rect(int x, int y, int w, int h, uint16_t color) { gea_embedded_raster_stroke_rect(&g_raster, x, y, w, h, color); }
void gea_embedded_display_fill_circle(int cx, int cy, int r, uint16_t color) { gea_embedded_raster_fill_circle(&g_raster, cx, cy, r, color); }
void gea_embedded_display_stroke_circle(int cx, int cy, int r, uint16_t color) { gea_embedded_raster_stroke_circle(&g_raster, cx, cy, r, color); }
void gea_embedded_display_draw_line(int x0, int y0, int x1, int y1, uint16_t color) { gea_embedded_raster_draw_line(&g_raster, x0, y0, x1, y1, color); }
void gea_embedded_display_draw_arc(int cx, int cy, int r, int start_deg, int end_deg, uint16_t color) { gea_embedded_raster_draw_arc(&g_raster, cx, cy, r, start_deg, end_deg, color); }
void gea_embedded_display_fill_triangle(int x0, int y0, int x1, int y1, int x2, int y2, uint16_t color) { gea_embedded_raster_fill_triangle(&g_raster, x0, y0, x1, y1, x2, y2, color); }
void gea_embedded_display_draw_text(const char *text, int x, int y, uint16_t color, float scale) { gea_embedded_raster_draw_text(&g_raster, text, x, y, color, scale); }
#ifdef GEA_EMBEDDED_HAS_GENERATED_FONTS
void gea_embedded_display_draw_text_font(const char *text, int x, int y, uint16_t color, int font_id) { gea_embedded_raster_draw_text_font(&g_raster, text, x, y, color, font_id); }
#endif
void gea_embedded_display_fill_rounded_rect(int x, int y, int w, int h, int tl, int tr, int br, int bl, uint16_t color) { gea_embedded_raster_fill_rounded_rect(&g_raster, x, y, w, h, tl, tr, br, bl, color); }
void gea_embedded_display_stroke_rounded_rect(int x, int y, int w, int h, int tl, int tr, int br, int bl, int lw, uint16_t color) { gea_embedded_raster_stroke_rounded_rect(&g_raster, x, y, w, h, tl, tr, br, bl, lw, color); }
void gea_embedded_display_blit_image(const uint16_t *src, int src_w, int src_h, int dx, int dy) { gea_embedded_raster_blit(&g_raster, src, src_w, src_h, dx, dy); }
void gea_embedded_display_blit_image_scaled(const uint16_t *src, int src_w, int src_h, int dx, int dy, int dst_w, int dst_h) { gea_embedded_raster_blit_scaled(&g_raster, src, src_w, src_h, dx, dy, dst_w, dst_h); }

/* ---- Clipping / alpha ---- */

void gea_embedded_display_push_clip(int x, int y, int w, int h) { gea_embedded_raster_push_clip(&g_raster, x, y, w, h); }
void gea_embedded_display_pop_clip(void)                        { gea_embedded_raster_pop_clip(&g_raster); }
void gea_embedded_display_reset_clip(void)                      { gea_embedded_raster_reset_clip(&g_raster); }
void gea_embedded_display_get_clip(int *x0, int *y0, int *x1, int *y1) { gea_embedded_raster_get_clip(&g_raster, x0, y0, x1, y1); }
void       gea_embedded_display_set_alpha(uint8_t a) { gea_embedded_raster_set_alpha(&g_raster, a); }
uint8_t    gea_embedded_display_get_alpha(void)      { return gea_embedded_raster_get_alpha(&g_raster); }

#pragma once

#include <stdint.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Native display panel: Waveshare 7inch HDMI LCD (C). */
#define GEA_EMBEDDED_PANEL_WIDTH   1024
#define GEA_EMBEDDED_PANEL_HEIGHT  600
#define GEA_RPI_PANEL_WIDTH        GEA_EMBEDDED_PANEL_WIDTH
#define GEA_RPI_PANEL_HEIGHT       GEA_EMBEDDED_PANEL_HEIGHT

/* Compat (legacy 410x502) viewport for the existing app-render apps. */
#define GEA_EMBEDDED_COMPAT_WIDTH  410
#define GEA_EMBEDDED_COMPAT_HEIGHT 502
#define GEA_RPI_COMPAT_WIDTH       GEA_EMBEDDED_COMPAT_WIDTH
#define GEA_RPI_COMPAT_HEIGHT      GEA_EMBEDDED_COMPAT_HEIGHT

/* Fallback 8x16 monospace font. The ESP32 target exposes the same
 * symbols from its display.h; the shared ui/text.c references them. */
#define FONT_W 8
#define FONT_H 16

/* RGB565 packed; same contract as the simulator and ESP32 target. */
typedef uint16_t gea_rpi_color_t;

typedef enum {
    GEA_RPI_DISPLAY_BACKEND_AUTO    = 0,
    GEA_RPI_DISPLAY_BACKEND_LINUXFB = 1,
    GEA_RPI_DISPLAY_BACKEND_KMS     = 2,
} gea_rpi_display_backend_t;

typedef enum {
    GEA_RPI_VIEWPORT_NATIVE = 0,   /* 1024x600, full panel                       */
    GEA_RPI_VIEWPORT_COMPAT = 1,   /* 410x502 letterboxed into 1024x600           */
} gea_rpi_viewport_t;

typedef struct {
    int width;
    int height;
    int stride_bytes;
    gea_rpi_color_t *pixels;       /* back buffer (compat shadow) or mmap'd fb    */
} gea_rpi_surface_t;

/* ---- Lifecycle (no-arg init/clear to match the existing shared/ contract) ---- */
int  gea_embedded_display_init(gea_rpi_display_backend_t backend,
                                gea_rpi_viewport_t viewport);
void gea_embedded_display_shutdown(void);
void gea_embedded_display_clear(void);          /* uses default BG */

/* ---- Backend / viewport selection (env override honored at init) ---- */
gea_rpi_display_backend_t gea_embedded_display_backend_from_env(const char *env_value);
gea_rpi_viewport_t        gea_embedded_display_viewport_from_env(const char *env_value);

void              gea_embedded_display_set_viewport(gea_rpi_viewport_t vp);
gea_rpi_viewport_t gea_embedded_display_get_viewport(void);
int               gea_embedded_display_viewport_width(void);
int               gea_embedded_display_viewport_height(void);

/* ---- Surface access ---- */
gea_rpi_surface_t *gea_embedded_display_get_surface(void);
uint16_t          *gea_embedded_display_get_back_buffer(void);
int                gea_embedded_display_get_width(void);
int                gea_embedded_display_get_height(void);
int                gea_embedded_display_get_stride_bytes(void);
int                gea_embedded_display_get_panel_width(void);
int                gea_embedded_display_get_panel_height(void);

/* ---- Dirty-rect (Pi Zero optimization) ---- */
void gea_embedded_display_mark_dirty(int x, int y, int w, int h);
int  gea_embedded_display_get_dirty(int *x, int *y, int *w, int *h);
void gea_embedded_display_reset_dirty(void);

/* ---- Frame ---- */
void gea_embedded_display_flush(void);
void gea_embedded_display_set_flush_config(int chunk_rows, int queue_depth);

/* ---- Vsync / wait ---- */
int  gea_embedded_display_wait_vsync(int timeout_ms);

/* ---- Brightness (no-op on linuxfb) ---- */
int  gea_embedded_display_get_brightness(void);
void gea_embedded_display_set_brightness(int brightness_percent);

/* ---- Raster draw API (used by app-render generated C and shared/raster.c) ---- */
void gea_embedded_display_set_pixel(int x, int y, uint16_t color);
void gea_embedded_display_fill_rect(int x, int y, int w, int h, uint16_t color);
void gea_embedded_display_stroke_rect(int x, int y, int w, int h, uint16_t color);
void gea_embedded_display_fill_circle(int cx, int cy, int r, uint16_t color);
void gea_embedded_display_stroke_circle(int cx, int cy, int r, uint16_t color);
void gea_embedded_display_draw_line(int x0, int y0, int x1, int y1, uint16_t color);
void gea_embedded_display_draw_arc(int cx, int cy, int r, int start_deg, int end_deg, uint16_t color);
void gea_embedded_display_fill_triangle(int x0, int y0, int x1, int y1, int x2, int y2, uint16_t color);
void gea_embedded_display_draw_text(const char *text, int x, int y, uint16_t color, float scale);
void gea_embedded_display_draw_text_font(const char *text, int x, int y, uint16_t color, int font_id);
void gea_embedded_display_fill_rounded_rect(int x, int y, int w, int h, int tl, int tr, int br, int bl, uint16_t color);
void gea_embedded_display_stroke_rounded_rect(int x, int y, int w, int h, int tl, int tr, int br, int bl, int lw, uint16_t color);
void gea_embedded_display_blit_image(const uint16_t *src, int src_w, int src_h, int dx, int dy);
void gea_embedded_display_blit_image_scaled(const uint16_t *src, int src_w, int src_h, int dx, int dy, int dst_w, int dst_h);

/* ---- Clipping / alpha passthroughs ---- */
void gea_embedded_display_push_clip(int x, int y, int w, int h);
void gea_embedded_display_pop_clip(void);
void gea_embedded_display_reset_clip(void);
void gea_embedded_display_get_clip(int *x0, int *y0, int *x1, int *y1);
void gea_embedded_display_set_alpha(uint8_t a);
uint8_t gea_embedded_display_get_alpha(void);

#ifdef __cplusplus
}
#endif

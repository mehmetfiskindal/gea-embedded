#pragma once

#include "esp_err.h"
#include <stdint.h>

#define DISPLAY_WIDTH 410
#define DISPLAY_HEIGHT 502
#define FONT_W 8
#define FONT_H 16
#define FONT_SCALE 3
#define GLYPH_W (FONT_W * FONT_SCALE)          /* 24 */
#define GLYPH_H (FONT_H * FONT_SCALE)          /* 48 */
#define SCREEN_COLS (DISPLAY_WIDTH / GLYPH_W)  /* 17 */
#define SCREEN_ROWS (DISPLAY_HEIGHT / GLYPH_H) /* 10 */

esp_err_t gea_embedded_display_init(void);
void gea_embedded_display_clear(void);
void gea_embedded_display_print(const char *text);
void gea_embedded_display_flush(void);
void gea_embedded_display_set_flush_config(int chunk_rows, int queue_depth);

void gea_embedded_display_push_clip(int x, int y, int w, int h);
void gea_embedded_display_pop_clip(void);
void gea_embedded_display_reset_clip(void);

void gea_embedded_display_set_alpha(uint8_t a);
uint8_t gea_embedded_display_get_alpha(void);
int gea_embedded_display_get_brightness(void);
void gea_embedded_display_set_brightness(int brightness_percent);
void gea_embedded_display_get_clip(int *x0, int *y0, int *x1, int *y1);

void gea_embedded_display_fill_rect(int x, int y, int w, int h, uint16_t color);
void gea_embedded_display_stroke_rect(int x, int y, int w, int h, uint16_t color);
void gea_embedded_display_fill_circle(int cx, int cy, int r, uint16_t color);
void gea_embedded_display_stroke_circle(int cx, int cy, int r, uint16_t color);
void gea_embedded_display_draw_line(int x0, int y0, int x1, int y1, uint16_t color);
void gea_embedded_display_draw_arc(int cx, int cy, int r, int start_deg, int end_deg, uint16_t color);
void gea_embedded_display_fill_triangle(int x0, int y0, int x1, int y1, int x2, int y2, uint16_t color);
void gea_embedded_display_draw_text(const char *text, int x, int y, uint16_t color, float scale);
void gea_embedded_display_draw_text_font(const char *text, int x, int y, uint16_t color, int font_id);
void gea_embedded_display_set_pixel(int x, int y, uint16_t color);

void gea_embedded_display_fill_rounded_rect(int x, int y, int w, int h,
                                     int tl, int tr, int br, int bl,
                                     uint16_t color);
void gea_embedded_display_stroke_rounded_rect(int x, int y, int w, int h,
                                       int tl, int tr, int br, int bl,
                                       int lw, uint16_t color);

void gea_embedded_display_blit_image(const uint16_t *src, int src_w, int src_h,
                              int dx, int dy);
void gea_embedded_display_blit_image_scaled(const uint16_t *src, int src_w, int src_h,
                                     int dx, int dy, int dst_w, int dst_h);

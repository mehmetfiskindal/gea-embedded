#pragma once

#include <stdint.h>

#define GEA_EMBEDDED_RASTER_MAX_CLIP_DEPTH 32

typedef struct
{
	int x0, y0, x1, y1;
} gea_embedded_clip_rect_t;

typedef struct
{
	int width;
	int height;
	int stride_bytes;
	uint16_t *pixels;

	int dirty_x0, dirty_y0, dirty_x1, dirty_y1;
	uint8_t global_alpha;

	gea_embedded_clip_rect_t clip_stack[GEA_EMBEDDED_RASTER_MAX_CLIP_DEPTH];
	int clip_depth;
} gea_embedded_raster_t;

void gea_embedded_raster_bind(gea_embedded_raster_t *raster, uint16_t *pixels, int width, int height);
uint16_t *gea_embedded_raster_pixels(gea_embedded_raster_t *raster);
const uint16_t *gea_embedded_raster_pixels_const(const gea_embedded_raster_t *raster);
int gea_embedded_raster_width(const gea_embedded_raster_t *raster);
int gea_embedded_raster_height(const gea_embedded_raster_t *raster);
int gea_embedded_raster_stride_bytes(const gea_embedded_raster_t *raster);

void gea_embedded_raster_reset_dirty(gea_embedded_raster_t *raster);
void gea_embedded_raster_mark_dirty(gea_embedded_raster_t *raster, int x0, int y0, int x1, int y1);
int gea_embedded_raster_get_dirty(const gea_embedded_raster_t *raster, int *x0, int *y0, int *x1, int *y1);

void gea_embedded_raster_reset_clip(gea_embedded_raster_t *raster);
void gea_embedded_raster_push_clip(gea_embedded_raster_t *raster, int x, int y, int w, int h);
void gea_embedded_raster_pop_clip(gea_embedded_raster_t *raster);
void gea_embedded_raster_get_clip(const gea_embedded_raster_t *raster, int *x0, int *y0, int *x1, int *y1);

void gea_embedded_raster_set_alpha(gea_embedded_raster_t *raster, uint8_t alpha);
uint8_t gea_embedded_raster_get_alpha(const gea_embedded_raster_t *raster);

void gea_embedded_raster_clear(gea_embedded_raster_t *raster, uint16_t color);
void gea_embedded_raster_set_pixel(gea_embedded_raster_t *raster, int x, int y, uint16_t color);
void gea_embedded_raster_fill_rect(gea_embedded_raster_t *raster, int x, int y, int w, int h, uint16_t color);
void gea_embedded_raster_stroke_rect(gea_embedded_raster_t *raster, int x, int y, int w, int h, uint16_t color);
void gea_embedded_raster_fill_circle(gea_embedded_raster_t *raster, int cx, int cy, int r, uint16_t color);
void gea_embedded_raster_stroke_circle(gea_embedded_raster_t *raster, int cx, int cy, int r, uint16_t color);
void gea_embedded_raster_draw_line(gea_embedded_raster_t *raster, int x0, int y0, int x1, int y1, uint16_t color);
void gea_embedded_raster_draw_arc(gea_embedded_raster_t *raster, int cx, int cy, int r, int start_deg, int end_deg, uint16_t color);
void gea_embedded_raster_fill_triangle(gea_embedded_raster_t *raster, int x0, int y0, int x1, int y1, int x2, int y2, uint16_t color);
void gea_embedded_raster_draw_text(gea_embedded_raster_t *raster, const char *text, int x, int y, uint16_t color, float scale);

#if __has_include("gea_embedded_font_generated.h")
#include "gea_embedded_font_generated.h"
#endif

#ifdef GEA_EMBEDDED_HAS_GENERATED_FONTS
void gea_embedded_raster_draw_text_font(gea_embedded_raster_t *raster, const char *text, int x, int y, uint16_t color, int font_id);
void gea_embedded_raster_measure_text_font(const char *text, int max_width, int font_id, int *out_w, int *out_h);
#endif
void gea_embedded_raster_fill_rounded_rect(
		gea_embedded_raster_t *raster,
		int x, int y, int w, int h,
		int tl, int tr, int br, int bl,
		uint16_t color);
void gea_embedded_raster_stroke_rounded_rect(
		gea_embedded_raster_t *raster,
		int x, int y, int w, int h,
		int tl, int tr, int br, int bl,
		int lw,
		uint16_t color);

void gea_embedded_raster_blit(
		gea_embedded_raster_t *raster,
		const uint16_t *src, int src_w, int src_h,
		int dx, int dy);

void gea_embedded_raster_blit_scaled(
		gea_embedded_raster_t *raster,
		const uint16_t *src, int src_w, int src_h,
		int dx, int dy, int dst_w, int dst_h);

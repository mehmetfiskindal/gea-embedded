#if __has_include("gea_embedded_font_generated.h")
#include "gea_embedded_font_generated.h"
#endif
#include "raster.h"

#include <math.h>
#include <stdlib.h>
#include <string.h>

#define FONT_W 8
#define FONT_H 16

extern const uint8_t gea_embedded_font_8x16[95][16];

static inline int gea_embedded_min_i(int a, int b) { return a < b ? a : b; }

static int gea_embedded_isqrt(int n)
{
	if (n <= 0) return 0;
	int x = n, y = (x + 1) / 2;
	while (y < x) { x = y; y = (x + n / x) / 2; }
	return x;
}

static inline void gea_embedded_raster_write_pixel(gea_embedded_raster_t *raster, int x, int y, uint16_t fg)
{
	if (!raster || !raster->pixels) return;
	if (x < 0 || x >= raster->width || y < 0 || y >= raster->height) return;
	if (x < raster->clip_stack[raster->clip_depth].x0 || x > raster->clip_stack[raster->clip_depth].x1 ||
	    y < raster->clip_stack[raster->clip_depth].y0 || y > raster->clip_stack[raster->clip_depth].y1)
		return;

	uint16_t *pixel = &raster->pixels[y * raster->width + x];
	if (raster->global_alpha == 255) {
		*pixel = fg;
	} else if (raster->global_alpha != 0) {
		uint16_t bg = *pixel;
		int br = (bg >> 11) & 0x1F, bgg = (bg >> 5) & 0x3F, bb = bg & 0x1F;
		int fr = (fg >> 11) & 0x1F, fgg = (fg >> 5) & 0x3F, fb = fg & 0x1F;
		int a = raster->global_alpha, ia = 255 - a;
		*pixel = (uint16_t)((((fr * a + br * ia) / 255) << 11) |
		                    (((fgg * a + bgg * ia) / 255) << 5) |
		                    ((fb * a + bb * ia) / 255));
	}
}

void gea_embedded_raster_bind(gea_embedded_raster_t *raster, uint16_t *pixels, int width, int height)
{
	if (!raster) return;
	raster->width = width;
	raster->height = height;
	raster->stride_bytes = width > 0 ? width * (int)sizeof(uint16_t) : 0;
	raster->pixels = pixels;
	raster->global_alpha = 255;
	gea_embedded_raster_reset_dirty(raster);
	gea_embedded_raster_reset_clip(raster);
}

uint16_t *gea_embedded_raster_pixels(gea_embedded_raster_t *raster) { return raster ? raster->pixels : NULL; }
const uint16_t *gea_embedded_raster_pixels_const(const gea_embedded_raster_t *raster) { return raster ? raster->pixels : NULL; }
int gea_embedded_raster_width(const gea_embedded_raster_t *raster) { return raster ? raster->width : 0; }
int gea_embedded_raster_height(const gea_embedded_raster_t *raster) { return raster ? raster->height : 0; }
int gea_embedded_raster_stride_bytes(const gea_embedded_raster_t *raster) { return raster ? raster->stride_bytes : 0; }

void gea_embedded_raster_reset_dirty(gea_embedded_raster_t *raster)
{
	if (!raster) return;
	raster->dirty_x0 = raster->width;
	raster->dirty_y0 = raster->height;
	raster->dirty_x1 = -1;
	raster->dirty_y1 = -1;
}

void gea_embedded_raster_mark_dirty(gea_embedded_raster_t *raster, int x0, int y0, int x1, int y1)
{
	if (!raster || raster->width <= 0 || raster->height <= 0) return;
	if (x0 < 0) x0 = 0;
	if (y0 < 0) y0 = 0;
	if (x1 >= raster->width) x1 = raster->width - 1;
	if (y1 >= raster->height) y1 = raster->height - 1;
	if (x0 > x1 || y0 > y1) return;
	if (x0 < raster->dirty_x0) raster->dirty_x0 = x0;
	if (y0 < raster->dirty_y0) raster->dirty_y0 = y0;
	if (x1 > raster->dirty_x1) raster->dirty_x1 = x1;
	if (y1 > raster->dirty_y1) raster->dirty_y1 = y1;
}

int gea_embedded_raster_get_dirty(const gea_embedded_raster_t *raster, int *x0, int *y0, int *x1, int *y1)
{
	if (!raster || raster->dirty_x0 > raster->dirty_x1 || raster->dirty_y0 > raster->dirty_y1) return 0;
	if (x0) *x0 = raster->dirty_x0;
	if (y0) *y0 = raster->dirty_y0;
	if (x1) *x1 = raster->dirty_x1;
	if (y1) *y1 = raster->dirty_y1;
	return 1;
}

void gea_embedded_raster_reset_clip(gea_embedded_raster_t *raster)
{
	if (!raster) return;
	raster->clip_depth = 0;
	raster->clip_stack[0].x0 = 0;
	raster->clip_stack[0].y0 = 0;
	raster->clip_stack[0].x1 = raster->width > 0 ? raster->width - 1 : 0;
	raster->clip_stack[0].y1 = raster->height > 0 ? raster->height - 1 : 0;
}

void gea_embedded_raster_push_clip(gea_embedded_raster_t *raster, int x, int y, int w, int h)
{
	if (!raster) return;
	int nx0 = x, ny0 = y, nx1 = x + w - 1, ny1 = y + h - 1;
	const gea_embedded_clip_rect_t *current = &raster->clip_stack[raster->clip_depth];
	if (nx0 < current->x0) nx0 = current->x0;
	if (ny0 < current->y0) ny0 = current->y0;
	if (nx1 > current->x1) nx1 = current->x1;
	if (ny1 > current->y1) ny1 = current->y1;
	if (raster->clip_depth < GEA_EMBEDDED_RASTER_MAX_CLIP_DEPTH - 1) raster->clip_depth++;
	raster->clip_stack[raster->clip_depth].x0 = nx0;
	raster->clip_stack[raster->clip_depth].y0 = ny0;
	raster->clip_stack[raster->clip_depth].x1 = nx1;
	raster->clip_stack[raster->clip_depth].y1 = ny1;
}

void gea_embedded_raster_pop_clip(gea_embedded_raster_t *raster)
{
	if (raster && raster->clip_depth > 0) raster->clip_depth--;
}

void gea_embedded_raster_get_clip(const gea_embedded_raster_t *raster, int *x0, int *y0, int *x1, int *y1)
{
	if (!raster) return;
	const gea_embedded_clip_rect_t *c = &raster->clip_stack[raster->clip_depth];
	if (x0) *x0 = c->x0;
	if (y0) *y0 = c->y0;
	if (x1) *x1 = c->x1;
	if (y1) *y1 = c->y1;
}

void gea_embedded_raster_set_alpha(gea_embedded_raster_t *raster, uint8_t alpha)
{
	if (raster) raster->global_alpha = alpha;
}

uint8_t gea_embedded_raster_get_alpha(const gea_embedded_raster_t *raster)
{
	return raster ? raster->global_alpha : 255;
}

void gea_embedded_raster_clear(gea_embedded_raster_t *raster, uint16_t color)
{
	if (!raster || !raster->pixels) return;
	for (int i = 0; i < raster->width * raster->height; i++) raster->pixels[i] = color;
	gea_embedded_raster_mark_dirty(raster, 0, 0, raster->width - 1, raster->height - 1);
}

void gea_embedded_raster_set_pixel(gea_embedded_raster_t *raster, int x, int y, uint16_t color)
{
	gea_embedded_raster_write_pixel(raster, x, y, color);
	gea_embedded_raster_mark_dirty(raster, x, y, x, y);
}

void gea_embedded_raster_fill_rect(gea_embedded_raster_t *raster, int x, int y, int w, int h, uint16_t color)
{
	if (!raster || !raster->pixels) return;

	const gea_embedded_clip_rect_t *clip = &raster->clip_stack[raster->clip_depth];
	int x0 = x, y0 = y, x1 = x + w - 1, y1 = y + h - 1;

	if (x0 < clip->x0) x0 = clip->x0;
	if (y0 < clip->y0) y0 = clip->y0;
	if (x1 > clip->x1) x1 = clip->x1;
	if (y1 > clip->y1) y1 = clip->y1;
	if (x0 < 0) x0 = 0;
	if (y0 < 0) y0 = 0;
	if (x1 >= raster->width) x1 = raster->width - 1;
	if (y1 >= raster->height) y1 = raster->height - 1;
	if (x0 > x1 || y0 > y1) return;

	if (raster->global_alpha == 255) {
		for (int row = y0; row <= y1; row++) {
			uint16_t *dst = &raster->pixels[row * raster->width + x0];
			for (int n = x1 - x0 + 1; n > 0; n--)
				*dst++ = color;
		}
	} else if (raster->global_alpha != 0) {
		int a = raster->global_alpha, ia = 255 - a;
		int fr = (color >> 11) & 0x1F, fgg = (color >> 5) & 0x3F, fb = color & 0x1F;
		for (int row = y0; row <= y1; row++) {
			uint16_t *dst = &raster->pixels[row * raster->width + x0];
			for (int col = x0; col <= x1; col++, dst++) {
				uint16_t bg = *dst;
				int br = (bg >> 11) & 0x1F, bgg = (bg >> 5) & 0x3F, bb = bg & 0x1F;
				*dst = (uint16_t)((((fr * a + br * ia) / 255) << 11) |
				                  (((fgg * a + bgg * ia) / 255) << 5) |
				                  ((fb * a + bb * ia) / 255));
			}
		}
	}
	gea_embedded_raster_mark_dirty(raster, x0, y0, x1, y1);
}

void gea_embedded_raster_stroke_rect(gea_embedded_raster_t *raster, int x, int y, int w, int h, uint16_t color)
{
	if (w <= 0 || h <= 0) return;
	gea_embedded_raster_fill_rect(raster, x, y, w, 1, color);
	gea_embedded_raster_fill_rect(raster, x, y + h - 1, w, 1, color);
	if (h > 2) {
		gea_embedded_raster_fill_rect(raster, x, y + 1, 1, h - 2, color);
		gea_embedded_raster_fill_rect(raster, x + w - 1, y + 1, 1, h - 2, color);
	}
}

void gea_embedded_raster_fill_circle(gea_embedded_raster_t *raster, int cx, int cy, int r, uint16_t color)
{
	if (!raster || !raster->pixels || r <= 0) return;
	for (int dy = -r; dy <= r; dy++) {
		int py = cy + dy;
		if (py < 0 || py >= raster->height) continue;
		int dx = gea_embedded_isqrt(r * r - dy * dy);
		int x0 = cx - dx;
		int x1 = cx + dx;
		if (x0 < 0) x0 = 0;
		if (x1 >= raster->width) x1 = raster->width - 1;
		for (int px = x0; px <= x1; px++) gea_embedded_raster_write_pixel(raster, px, py, color);
	}
	gea_embedded_raster_mark_dirty(raster, cx - r, cy - r, cx + r, cy + r);
}

void gea_embedded_raster_stroke_circle(gea_embedded_raster_t *raster, int cx, int cy, int r, uint16_t color)
{
	if (!raster || !raster->pixels || r <= 0) return;
	int x = r, y = 0, d = 1 - r;
	while (x >= y) {
		gea_embedded_raster_write_pixel(raster, cx + x, cy + y, color);
		gea_embedded_raster_write_pixel(raster, cx - x, cy + y, color);
		gea_embedded_raster_write_pixel(raster, cx + x, cy - y, color);
		gea_embedded_raster_write_pixel(raster, cx - x, cy - y, color);
		gea_embedded_raster_write_pixel(raster, cx + y, cy + x, color);
		gea_embedded_raster_write_pixel(raster, cx - y, cy + x, color);
		gea_embedded_raster_write_pixel(raster, cx + y, cy - x, color);
		gea_embedded_raster_write_pixel(raster, cx - y, cy - x, color);
		y++;
		if (d <= 0) d += 2 * y + 1;
		else { x--; d += 2 * (y - x) + 1; }
	}
	gea_embedded_raster_mark_dirty(raster, cx - r, cy - r, cx + r, cy + r);
}

void gea_embedded_raster_draw_line(gea_embedded_raster_t *raster, int x0, int y0, int x1, int y1, uint16_t color)
{
	if (!raster || !raster->pixels) return;
	int dx = abs(x1 - x0);
	int dy = -abs(y1 - y0);
	int sx = x0 < x1 ? 1 : -1;
	int sy = y0 < y1 ? 1 : -1;
	int err = dx + dy;
	int mx0 = x0 < x1 ? x0 : x1, my0 = y0 < y1 ? y0 : y1;
	int mx1 = x0 > x1 ? x0 : x1, my1 = y0 > y1 ? y0 : y1;
	gea_embedded_raster_mark_dirty(raster, mx0, my0, mx1, my1);
	while (1) {
		gea_embedded_raster_write_pixel(raster, x0, y0, color);
		if (x0 == x1 && y0 == y1) break;
		int e2 = 2 * err;
		if (e2 >= dy) { err += dy; x0 += sx; }
		if (e2 <= dx) { err += dx; y0 += sy; }
	}
}

void gea_embedded_raster_draw_arc(gea_embedded_raster_t *raster, int cx, int cy, int r, int start_deg, int end_deg, uint16_t color)
{
	if (!raster || !raster->pixels || r <= 0) return;
	start_deg = ((start_deg % 360) + 360) % 360;
	end_deg = ((end_deg % 360) + 360) % 360;
	gea_embedded_raster_mark_dirty(raster, cx - r, cy - r, cx + r, cy + r);
	int x = r, y = 0, d = 1 - r;
	while (x >= y) {
		int points[8][2] = {
			{cx+x, cy-y}, {cx+y, cy-x}, {cx-y, cy-x}, {cx-x, cy-y},
			{cx-x, cy+y}, {cx-y, cy+x}, {cx+y, cy+x}, {cx+x, cy+y},
		};
		for (int i = 0; i < 8; i++) {
			int px = points[i][0], py = points[i][1];
			if (px < 0 || px >= raster->width || py < 0 || py >= raster->height) continue;
			float a = atan2f(-(float)(py - cy), (float)(px - cx));
			a = a * (180.0f / 3.14159265f);
			if (a < 0) a += 360.0f;
			int deg = (int)(a + 0.5f);
			if (deg >= 360) deg -= 360;
			int in_range = (start_deg <= end_deg) ? (deg >= start_deg && deg <= end_deg) : (deg >= start_deg || deg <= end_deg);
			if (in_range) gea_embedded_raster_write_pixel(raster, px, py, color);
		}
		y++;
		if (d <= 0) d += 2 * y + 1;
		else { x--; d += 2 * (y - x) + 1; }
	}
}

void gea_embedded_raster_fill_triangle(gea_embedded_raster_t *raster, int x0, int y0, int x1, int y1, int x2, int y2, uint16_t color)
{
	if (!raster || !raster->pixels) return;
#define TRI_SWAP(a, b) do { int t_ = a; a = b; b = t_; } while (0)
	if (y0 > y1) { TRI_SWAP(x0, x1); TRI_SWAP(y0, y1); }
	if (y0 > y2) { TRI_SWAP(x0, x2); TRI_SWAP(y0, y2); }
	if (y1 > y2) { TRI_SWAP(x1, x2); TRI_SWAP(y1, y2); }
#undef TRI_SWAP
	int total_h = y2 - y0;
	if (total_h == 0) {
		int mn = x0 < x1 ? (x0 < x2 ? x0 : x2) : (x1 < x2 ? x1 : x2);
		int mx = x0 > x1 ? (x0 > x2 ? x0 : x2) : (x1 > x2 ? x1 : x2);
		gea_embedded_raster_fill_rect(raster, mn, y0, mx - mn + 1, 1, color);
		return;
	}
	int min_x = x0 < x1 ? (x0 < x2 ? x0 : x2) : (x1 < x2 ? x1 : x2);
	int max_x = x0 > x1 ? (x0 > x2 ? x0 : x2) : (x1 > x2 ? x1 : x2);
	gea_embedded_raster_mark_dirty(raster, min_x, y0, max_x, y2);
	for (int y = y0; y <= y2; y++) {
		if (y < 0 || y >= raster->height) continue;
		int second = (y >= y1);
		int seg_h = second ? (y2 - y1) : (y1 - y0);
		if (seg_h == 0) seg_h = 1;
		float al = (float)(y - y0) / total_h;
		float beta = second ? (float)(y - y1) / seg_h : (float)(y - y0) / seg_h;
		int ax = x0 + (int)((x2 - x0) * al);
		int bx = second ? x1 + (int)((x2 - x1) * beta) : x0 + (int)((x1 - x0) * beta);
		if (ax > bx) { int t = ax; ax = bx; bx = t; }
		if (ax < 0) ax = 0;
		if (bx >= raster->width) bx = raster->width - 1;
		if (ax > bx) continue;
		for (int px = ax; px <= bx; px++) gea_embedded_raster_write_pixel(raster, px, y, color);
	}
}

void gea_embedded_raster_draw_text(gea_embedded_raster_t *raster, const char *text, int x, int y, uint16_t color, float scale)
{
	if (!raster || !raster->pixels || !text) return;
	if (scale < 0.1f) scale = 1.0f;
	int glyph_w = (int)(FONT_W * scale + 0.5f);
	int glyph_h = (int)(FONT_H * scale + 0.5f);
	if (glyph_w < 1) glyph_w = 1;
	if (glyph_h < 1) glyph_h = 1;

	const gea_embedded_clip_rect_t *clip = &raster->clip_stack[raster->clip_depth];
	int pen_x = x;
	for (const char *p = text; *p; p++) {
		if (*p == '\n') { pen_x = x; y += glyph_h; continue; }
		char c = *p;
		if (c < 0x20 || c > 0x7E) c = '?';
		if (pen_x > clip->x1 || y > clip->y1 ||
		    pen_x + glyph_w - 1 < clip->x0 || y + glyph_h - 1 < clip->y0) {
			pen_x += glyph_w;
			continue;
		}
		const uint8_t *glyph = gea_embedded_font_8x16[c - 0x20];

		int dy_start = 0, dy_end = glyph_h - 1;
		int dx_start = 0, dx_end = glyph_w - 1;
		if (y + dy_start < clip->y0) dy_start = clip->y0 - y;
		if (y + dy_end > clip->y1)   dy_end = clip->y1 - y;
		if (pen_x + dx_start < clip->x0) dx_start = clip->x0 - pen_x;
		if (pen_x + dx_end > clip->x1)   dx_end = clip->x1 - pen_x;
		if (y + dy_start < 0) dy_start = -y;
		if (pen_x + dx_start < 0) dx_start = -pen_x;
		if (y + dy_end >= raster->height) dy_end = raster->height - 1 - y;
		if (pen_x + dx_end >= raster->width) dx_end = raster->width - 1 - pen_x;

		if (raster->global_alpha == 255) {
			for (int srow = 0; srow < FONT_H; srow++) {
				uint8_t bits = glyph[srow];
				if (!bits) continue;
				int by0 = srow * glyph_h / FONT_H;
				int by1 = (srow + 1) * glyph_h / FONT_H - 1;
				if (by0 > dy_end || by1 < dy_start) continue;
				if (by0 < dy_start) by0 = dy_start;
				if (by1 > dy_end) by1 = dy_end;
				for (int scol = 0; scol < FONT_W; scol++) {
					if (!(bits & (0x80 >> scol))) continue;
					int bx0 = scol * glyph_w / FONT_W;
					int bx1 = (scol + 1) * glyph_w / FONT_W - 1;
					if (bx0 > dx_end || bx1 < dx_start) continue;
					if (bx0 < dx_start) bx0 = dx_start;
					if (bx1 > dx_end) bx1 = dx_end;
					int span = bx1 - bx0 + 1;
					for (int by = by0; by <= by1; by++) {
						uint16_t *dst = &raster->pixels[(y + by) * raster->width + pen_x + bx0];
						for (int n = span; n > 0; n--) *dst++ = color;
					}
				}
			}
		} else if (raster->global_alpha != 0) {
			uint8_t a = raster->global_alpha, ia = 255 - a;
			int fr = (color >> 11) & 0x1F, fgg = (color >> 5) & 0x3F, fb = color & 0x1F;
			for (int srow = 0; srow < FONT_H; srow++) {
				uint8_t bits = glyph[srow];
				if (!bits) continue;
				int by0 = srow * glyph_h / FONT_H;
				int by1 = (srow + 1) * glyph_h / FONT_H - 1;
				if (by0 > dy_end || by1 < dy_start) continue;
				if (by0 < dy_start) by0 = dy_start;
				if (by1 > dy_end) by1 = dy_end;
				for (int scol = 0; scol < FONT_W; scol++) {
					if (!(bits & (0x80 >> scol))) continue;
					int bx0 = scol * glyph_w / FONT_W;
					int bx1 = (scol + 1) * glyph_w / FONT_W - 1;
					if (bx0 > dx_end || bx1 < dx_start) continue;
					if (bx0 < dx_start) bx0 = dx_start;
					if (bx1 > dx_end) bx1 = dx_end;
					for (int by = by0; by <= by1; by++) {
						uint16_t *dst = &raster->pixels[(y + by) * raster->width + pen_x + bx0];
						for (int dx = bx0; dx <= bx1; dx++) {
							uint16_t bg = *dst;
							int br = (bg >> 11) & 0x1F, bgg2 = (bg >> 5) & 0x3F, bb = bg & 0x1F;
							*dst++ = (uint16_t)((((fr * a + br * ia) / 255) << 11) |
							                    (((fgg * a + bgg2 * ia) / 255) << 5) |
							                    ((fb * a + bb * ia) / 255));
						}
					}
				}
			}
		}
		gea_embedded_raster_mark_dirty(raster, pen_x + dx_start, y + dy_start,
		                        pen_x + dx_end, y + dy_end);
		pen_x += glyph_w;
	}
}

#ifdef GEA_EMBEDDED_HAS_GENERATED_FONTS
/* ---- Atlas-based font rendering ---- */

static const gea_embedded_glyph_t *font_glyph_lookup(const gea_embedded_font_t *f, int codepoint)
{
	for (int i = 0; i < f->glyph_count; i++) {
		if (f->glyphs[i].codepoint == codepoint) return &f->glyphs[i];
	}
	if (f->glyph_count > 0 && codepoint != '?') {
		for (int i = 0; i < f->glyph_count; i++) {
			if (f->glyphs[i].codepoint == '?') return &f->glyphs[i];
		}
		return &f->glyphs[0];
	}
	return NULL;
}

void gea_embedded_raster_draw_text_font(gea_embedded_raster_t *raster, const char *text, int x, int y, uint16_t color, int font_id)
{
	if (!raster || !raster->pixels || !text) return;
	const gea_embedded_font_t *f = gea_embedded_font_lookup(font_id);
	if (!f || !f->atlas || f->glyph_count == 0) return;

	const gea_embedded_clip_rect_t *clip = &raster->clip_stack[raster->clip_depth];
	int fr = (color >> 11) & 0x1F;
	int fg = (color >> 5) & 0x3F;
	int fb = color & 0x1F;

	int pen_x = x;
	int pen_y = y;

	for (const char *p = text; *p; p++) {
		if (*p == '\n') { pen_x = x; pen_y += f->line_height; continue; }
		int cp = (unsigned char)*p;
		const gea_embedded_glyph_t *g = font_glyph_lookup(f, cp);
		if (!g) { pen_x += f->size_px / 2; continue; }

		int gx = pen_x + g->bearing_x;
		int gy = pen_y + f->ascender - g->bearing_y;

		/* Skip glyph entirely if outside clip */
		if (gx > clip->x1 || gy > clip->y1 ||
		    gx + g->width - 1 < clip->x0 || gy + g->height - 1 < clip->y0) {
			pen_x += g->advance;
			continue;
		}

		/* Clip glyph row/col ranges */
		int row_start = 0, row_end = g->height - 1;
		int col_start = 0, col_end = g->width - 1;
		if (gy + row_start < clip->y0) row_start = clip->y0 - gy;
		if (gy + row_end > clip->y1)   row_end = clip->y1 - gy;
		if (gx + col_start < clip->x0) col_start = clip->x0 - gx;
		if (gx + col_end > clip->x1)   col_end = clip->x1 - gx;
		if (gy + row_start < 0) row_start = -gy;
		if (gx + col_start < 0) col_start = -gx;
		if (gy + row_end >= raster->height) row_end = raster->height - 1 - gy;
		if (gx + col_end >= raster->width)  col_end = raster->width - 1 - gx;

		for (int row = row_start; row <= row_end; row++) {
			int py = gy + row;
			const uint8_t *atlas_row = &f->atlas[(g->atlas_y + row) * f->atlas_w + g->atlas_x];
			uint16_t *fb_row = &raster->pixels[py * raster->width + gx];
			for (int col = col_start; col <= col_end; col++) {
				int alpha = atlas_row[col];
				if (alpha == 0) continue;

				uint8_t a = (raster->global_alpha == 255) ? alpha : (alpha * raster->global_alpha) / 255;
				if (a == 0) continue;

				uint16_t *pixel = &fb_row[col];
				if (a == 255) {
					*pixel = color;
				} else {
					uint16_t bg = *pixel;
					int br = (bg >> 11) & 0x1F, bgg = (bg >> 5) & 0x3F, bb = bg & 0x1F;
					int ia = 255 - a;
					*pixel = (uint16_t)((((fr * a + br * ia) / 255) << 11) |
					                    (((fg * a + bgg * ia) / 255) << 5) |
					                    ((fb * a + bb * ia) / 255));
				}
			}
		}
		gea_embedded_raster_mark_dirty(raster, gx + col_start, gy + row_start,
		                        gx + col_end, gy + row_end);
		pen_x += g->advance;
	}
}

void gea_embedded_raster_measure_text_font(const char *text, int max_width, int font_id, int *out_w, int *out_h)
{
	*out_w = 0;
	*out_h = 0;
	if (!text || !text[0]) return;

	const gea_embedded_font_t *f = gea_embedded_font_lookup(font_id);
	if (!f || f->glyph_count == 0) return;

	int line_w = 0, max_line_w = 0, lines = 1;
	if (max_width <= 0) max_width = 32767;

	for (const char *p = text; *p; p++) {
		if (*p == '\n') {
			if (line_w > max_line_w) max_line_w = line_w;
			line_w = 0;
			lines++;
			continue;
		}
		int cp = (unsigned char)*p;
		const gea_embedded_glyph_t *g = font_glyph_lookup(f, cp);
		int adv = g ? g->advance : (f->size_px / 2);
		int next_w = line_w + adv;
		if (next_w > max_width && line_w > 0) {
			if (line_w > max_line_w) max_line_w = line_w;
			line_w = adv;
			lines++;
		} else {
			line_w = next_w;
		}
	}
	if (line_w > max_line_w) max_line_w = line_w;
	*out_w = max_line_w;
	*out_h = lines * f->line_height;
}
#endif /* GEA_EMBEDDED_HAS_GENERATED_FONTS */

static void gea_embedded_fill_quarter_circle(gea_embedded_raster_t *raster, int cx, int cy, int r, int quadrant, uint16_t color)
{
	if (!raster || !raster->pixels || r <= 0) return;
	const gea_embedded_clip_rect_t *clip = &raster->clip_stack[raster->clip_depth];

	for (int dy = 0; dy <= r; dy++) {
		int dx = gea_embedded_isqrt(r * r - dy * dy);
		int sx0, sx1, sy;
		switch (quadrant) {
		case 0: sx0 = cx;      sx1 = cx + dx; sy = cy - dy; break;
		case 1: sx0 = cx - dx; sx1 = cx;      sy = cy - dy; break;
		case 2: sx0 = cx - dx; sx1 = cx;      sy = cy + dy; break;
		case 3: sx0 = cx;      sx1 = cx + dx; sy = cy + dy; break;
		default: return;
		}
		if (sy < clip->y0 || sy > clip->y1) continue;
		if (sy < 0 || sy >= raster->height) continue;
		if (sx0 < clip->x0) sx0 = clip->x0;
		if (sx1 > clip->x1) sx1 = clip->x1;
		if (sx0 < 0) sx0 = 0;
		if (sx1 >= raster->width) sx1 = raster->width - 1;
		if (sx0 > sx1) continue;

		uint16_t *dst = &raster->pixels[sy * raster->width + sx0];
		if (raster->global_alpha == 255) {
			for (int n = sx1 - sx0 + 1; n > 0; n--) *dst++ = color;
		} else if (raster->global_alpha != 0) {
			int a = raster->global_alpha, ia = 255 - a;
			int fr = (color >> 11) & 0x1F, fgg = (color >> 5) & 0x3F, fb = color & 0x1F;
			for (int px = sx0; px <= sx1; px++) {
				uint16_t bg = *dst;
				int br = (bg >> 11) & 0x1F, bgg = (bg >> 5) & 0x3F, bb = bg & 0x1F;
				*dst++ = (uint16_t)((((fr * a + br * ia) / 255) << 11) |
				                    (((fgg * a + bgg * ia) / 255) << 5) |
				                    ((fb * a + bb * ia) / 255));
			}
		}
	}
}

#define GEA_EMBEDDED_CIRCLE_SPAN_MAX 32
#define GEA_EMBEDDED_CIRCLE_SPAN_SLOT_COUNT ((GEA_EMBEDDED_CIRCLE_SPAN_MAX / 2) + 1)

static uint8_t circle_span_cache[GEA_EMBEDDED_CIRCLE_SPAN_SLOT_COUNT][GEA_EMBEDDED_CIRCLE_SPAN_MAX][2];
static uint32_t circle_span_cache_ready = 0;

static const uint8_t (*gea_embedded_circle_spans(int size))[2]
{
	if (size <= 0 || size > GEA_EMBEDDED_CIRCLE_SPAN_MAX || (size & 1)) return NULL;
	int slot = size / 2;
	uint32_t bit = 1u << slot;
	if (!(circle_span_cache_ready & bit)) {
		int radius2 = size * size;
		for (int row = 0; row < size; row++) {
			int dy2 = row * 2 + 1 - size;
			int dx2 = gea_embedded_isqrt(radius2 - dy2 * dy2);
			circle_span_cache[slot][row][0] = (uint8_t)((size - dx2) / 2);
			circle_span_cache[slot][row][1] = (uint8_t)((size + dx2 - 1) / 2);
		}
		circle_span_cache_ready |= bit;
	}
	return circle_span_cache[slot];
}

static void gea_embedded_raster_fill_circle_box(gea_embedded_raster_t *raster, int x, int y, int size, uint16_t color)
{
	if (!raster || !raster->pixels) return;
	const uint8_t (*spans)[2] = gea_embedded_circle_spans(size);
	if (!spans) return;
	const gea_embedded_clip_rect_t *clip = &raster->clip_stack[raster->clip_depth];

	if (x > clip->x1 || y > clip->y1 || x + size - 1 < clip->x0 || y + size - 1 < clip->y0) return;

	for (int row = 0; row < size; row++) {
		int sy = y + row;
		if (sy < clip->y0 || sy > clip->y1) continue;
		if (sy < 0 || sy >= raster->height) continue;

		int sx0 = x + spans[row][0];
		int sx1 = x + spans[row][1];
		if (sx0 < clip->x0) sx0 = clip->x0;
		if (sx1 > clip->x1) sx1 = clip->x1;
		if (sx0 < 0) sx0 = 0;
		if (sx1 >= raster->width) sx1 = raster->width - 1;
		if (sx0 > sx1) continue;

		uint16_t *dst = &raster->pixels[sy * raster->width + sx0];
		if (raster->global_alpha == 255) {
			for (int n = sx1 - sx0 + 1; n > 0; n--) *dst++ = color;
		} else if (raster->global_alpha != 0) {
			int a = raster->global_alpha, ia = 255 - a;
			int fr = (color >> 11) & 0x1F, fgg = (color >> 5) & 0x3F, fb = color & 0x1F;
			for (int px = sx0; px <= sx1; px++) {
				uint16_t bg = *dst;
				int br = (bg >> 11) & 0x1F, bgg = (bg >> 5) & 0x3F, bb = bg & 0x1F;
				*dst++ = (uint16_t)((((fr * a + br * ia) / 255) << 11) |
				                    (((fgg * a + bgg * ia) / 255) << 5) |
				                    ((fb * a + bb * ia) / 255));
			}
		}
	}
	gea_embedded_raster_mark_dirty(raster, x, y, x + size - 1, y + size - 1);
}

void gea_embedded_raster_fill_rounded_rect(gea_embedded_raster_t *raster, int x, int y, int w, int h, int tl, int tr, int br, int bl, uint16_t color)
{
	if (!raster || !raster->pixels || w <= 0 || h <= 0) return;
	int max_r = gea_embedded_min_i(w / 2, h / 2);
	if (tl > max_r) tl = max_r;
	if (tr > max_r) tr = max_r;
	if (br > max_r) br = max_r;
	if (bl > max_r) bl = max_r;
	if (tl < 0) tl = 0;
	if (tr < 0) tr = 0;
	if (br < 0) br = 0;
	if (bl < 0) bl = 0;
	if (w == h && tl == w / 2 && tr == w / 2 && br == w / 2 && bl == w / 2 && gea_embedded_circle_spans(w)) {
		gea_embedded_raster_fill_circle_box(raster, x, y, w, color);
		return;
	}
	int top_r = tl > tr ? tl : tr;
	int bot_r = bl > br ? bl : br;
	if (h - top_r - bot_r > 0) gea_embedded_raster_fill_rect(raster, x, y + top_r, w, h - top_r - bot_r, color);
	if (top_r > 0) {
		int left_edge = x + tl;
		int right_edge = x + w - tr;
		if (right_edge > left_edge) gea_embedded_raster_fill_rect(raster, left_edge, y, right_edge - left_edge, top_r, color);
	}
	if (bot_r > 0) {
		int left_edge = x + bl;
		int right_edge = x + w - br;
		if (right_edge > left_edge) gea_embedded_raster_fill_rect(raster, left_edge, y + h - bot_r, right_edge - left_edge, bot_r, color);
	}
	if (tl > 0 && tl < top_r) gea_embedded_raster_fill_rect(raster, x, y + tl, tl, top_r - tl, color);
	if (tr > 0 && tr < top_r) gea_embedded_raster_fill_rect(raster, x + w - tr, y + tr, tr, top_r - tr, color);
	if (bl > 0 && bl < bot_r) gea_embedded_raster_fill_rect(raster, x, y + h - bot_r, bl, bot_r - bl, color);
	if (br > 0 && br < bot_r) gea_embedded_raster_fill_rect(raster, x + w - br, y + h - bot_r, br, bot_r - br, color);
	if (tl > 0) gea_embedded_fill_quarter_circle(raster, x + tl, y + tl, tl, 1, color);
	if (tr > 0) gea_embedded_fill_quarter_circle(raster, x + w - 1 - tr, y + tr, tr, 0, color);
	if (bl > 0) gea_embedded_fill_quarter_circle(raster, x + bl, y + h - 1 - bl, bl, 2, color);
	if (br > 0) gea_embedded_fill_quarter_circle(raster, x + w - 1 - br, y + h - 1 - br, br, 3, color);
	gea_embedded_raster_mark_dirty(raster, x, y, x + w - 1, y + h - 1);
}

void gea_embedded_raster_stroke_rounded_rect(gea_embedded_raster_t *raster, int x, int y, int w, int h, int tl, int tr, int br, int bl, int lw, uint16_t color)
{
	if (!raster || !raster->pixels || w <= 0 || h <= 0 || lw <= 0) return;
	int max_r = gea_embedded_min_i(w / 2, h / 2);
	if (tl > max_r) tl = max_r;
	if (tr > max_r) tr = max_r;
	if (br > max_r) br = max_r;
	if (bl > max_r) bl = max_r;
	if (tl < 0) tl = 0;
	if (tr < 0) tr = 0;
	if (br < 0) br = 0;
	if (bl < 0) bl = 0;
	gea_embedded_raster_fill_rect(raster, x + tl, y, w - tl - tr, lw, color);
	gea_embedded_raster_fill_rect(raster, x + bl, y + h - lw, w - bl - br, lw, color);
	gea_embedded_raster_fill_rect(raster, x, y + tl, lw, h - tl - bl, color);
	gea_embedded_raster_fill_rect(raster, x + w - lw, y + tr, lw, h - tr - br, color);
	for (int q = 0; q < 4; q++) {
		int r, cx, cy;
		switch (q) {
		case 0: r = tr; cx = x + w - 1 - r; cy = y + r; break;
		case 1: r = tl; cx = x + r;         cy = y + r; break;
		case 2: r = bl; cx = x + r;         cy = y + h - 1 - r; break;
		case 3: r = br; cx = x + w - 1 - r; cy = y + h - 1 - r; break;
		default: continue;
		}
		if (r <= 0) continue;
		int ri = r - lw;
		if (ri < 0) ri = 0;
		for (int dy = 0; dy <= r; dy++) {
			int dx_outer = gea_embedded_isqrt(r * r - dy * dy);
			int dx_inner = (dy <= ri) ? gea_embedded_isqrt(ri * ri - dy * dy) : 0;
			int sx0, sx1, sy;
			switch (q) {
			case 0: sx0 = cx + dx_inner; sx1 = cx + dx_outer; sy = cy - dy; break;
			case 1: sx0 = cx - dx_outer; sx1 = cx - dx_inner; sy = cy - dy; break;
			case 2: sx0 = cx - dx_outer; sx1 = cx - dx_inner; sy = cy + dy; break;
			case 3: sx0 = cx + dx_inner; sx1 = cx + dx_outer; sy = cy + dy; break;
			default: continue;
			}
			if (sy < 0 || sy >= raster->height) continue;
			if (sx0 < 0) sx0 = 0;
			if (sx1 >= raster->width) sx1 = raster->width - 1;
			for (int px = sx0; px <= sx1; px++) gea_embedded_raster_write_pixel(raster, px, sy, color);
		}
	}
	gea_embedded_raster_mark_dirty(raster, x, y, x + w - 1, y + h - 1);
}

void gea_embedded_raster_blit(
	gea_embedded_raster_t *raster,
	const uint16_t *src, int src_w, int src_h,
	int dx, int dy)
{
	if (!raster || !raster->pixels || !src) return;
	for (int sy = 0; sy < src_h; sy++) {
		int py = dy + sy;
		if (py < 0 || py >= raster->height) continue;
		for (int sx = 0; sx < src_w; sx++) {
			int px = dx + sx;
			if (px < 0 || px >= raster->width) continue;
			uint16_t c = src[sy * src_w + sx];
			if (c != 0x0000 || raster->global_alpha == 255)
				gea_embedded_raster_write_pixel(raster, px, py, c);
		}
	}
	gea_embedded_raster_mark_dirty(raster, dx, dy, dx + src_w - 1, dy + src_h - 1);
}

void gea_embedded_raster_blit_scaled(
	gea_embedded_raster_t *raster,
	const uint16_t *src, int src_w, int src_h,
	int dx, int dy, int dst_w, int dst_h)
{
	if (!raster || !raster->pixels || !src) return;
	if (dst_w <= 0 || dst_h <= 0 || src_w <= 0 || src_h <= 0) return;

	for (int y = 0; y < dst_h; y++) {
		int py = dy + y;
		if (py < 0 || py >= raster->height) continue;
		int sy = (y * src_h) / dst_h;
		if (sy >= src_h) sy = src_h - 1;
		for (int x = 0; x < dst_w; x++) {
			int px = dx + x;
			if (px < 0 || px >= raster->width) continue;
			int sx = (x * src_w) / dst_w;
			if (sx >= src_w) sx = src_w - 1;
			uint16_t c = src[sy * src_w + sx];
			if (c != 0x0000 || raster->global_alpha == 255)
				gea_embedded_raster_write_pixel(raster, px, py, c);
		}
	}
	gea_embedded_raster_mark_dirty(raster, dx, dy, dx + dst_w - 1, dy + dst_h - 1);
}

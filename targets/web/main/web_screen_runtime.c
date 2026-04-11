#include <stdint.h>

#include <emscripten/emscripten.h>

#include "display.h"
#include "image.h"
#include "web_display.h"

EMSCRIPTEN_KEEPALIVE
int screen_init(int width, int height)
{
	if (width <= 0 || height <= 0) return 0;
	return web_display_resize(width, height);
}

EMSCRIPTEN_KEEPALIVE
const uint16_t *screen_get_framebuffer_ptr(void)
{
	return web_display_pixels();
}

EMSCRIPTEN_KEEPALIVE
int screen_get_width(void)
{
	return web_display_width();
}

EMSCRIPTEN_KEEPALIVE
int screen_get_height(void)
{
	return web_display_height();
}

EMSCRIPTEN_KEEPALIVE
int screen_get_stride_bytes(void)
{
	return web_display_stride_bytes();
}

EMSCRIPTEN_KEEPALIVE
uint16_t screen_color(int r, int g, int b)
{
	return (uint16_t)(((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3));
}

EMSCRIPTEN_KEEPALIVE
void screen_clear(void)
{
	gea_embedded_display_clear();
}

EMSCRIPTEN_KEEPALIVE
void screen_flush(void)
{
	gea_embedded_display_flush();
}

EMSCRIPTEN_KEEPALIVE
void screen_fill_rect(int x, int y, int w, int h, uint16_t color)
{
	gea_embedded_display_fill_rect(x, y, w, h, color);
}

EMSCRIPTEN_KEEPALIVE
void screen_stroke_rect(int x, int y, int w, int h, uint16_t color)
{
	gea_embedded_display_stroke_rect(x, y, w, h, color);
}

EMSCRIPTEN_KEEPALIVE
void screen_fill_circle(int cx, int cy, int r, uint16_t color)
{
	gea_embedded_display_fill_circle(cx, cy, r, color);
}

EMSCRIPTEN_KEEPALIVE
void screen_stroke_circle(int cx, int cy, int r, uint16_t color)
{
	gea_embedded_display_stroke_circle(cx, cy, r, color);
}

EMSCRIPTEN_KEEPALIVE
void screen_draw_line(int x0, int y0, int x1, int y1, uint16_t color)
{
	gea_embedded_display_draw_line(x0, y0, x1, y1, color);
}

EMSCRIPTEN_KEEPALIVE
void screen_draw_arc(int cx, int cy, int r, int start_deg, int end_deg, uint16_t color)
{
	gea_embedded_display_draw_arc(cx, cy, r, start_deg, end_deg, color);
}

EMSCRIPTEN_KEEPALIVE
void screen_fill_triangle(int x0, int y0, int x1, int y1, int x2, int y2, uint16_t color)
{
	gea_embedded_display_fill_triangle(x0, y0, x1, y1, x2, y2, color);
}

EMSCRIPTEN_KEEPALIVE
void screen_draw_text(const char *text, int x, int y, uint16_t color, float scale)
{
	gea_embedded_display_draw_text(text, x, y, color, scale);
}

EMSCRIPTEN_KEEPALIVE
void screen_set_pixel(int x, int y, uint16_t color)
{
	gea_embedded_display_set_pixel(x, y, color);
}

EMSCRIPTEN_KEEPALIVE
void screen_push_clip(int x, int y, int w, int h)
{
	gea_embedded_display_push_clip(x, y, w, h);
}

EMSCRIPTEN_KEEPALIVE
void screen_pop_clip(void)
{
	gea_embedded_display_pop_clip();
}

EMSCRIPTEN_KEEPALIVE
void screen_set_alpha(uint8_t a)
{
	gea_embedded_display_set_alpha(a);
}

EMSCRIPTEN_KEEPALIVE
uint8_t screen_get_alpha(void)
{
	return gea_embedded_display_get_alpha();
}

EMSCRIPTEN_KEEPALIVE
void screen_fill_rounded_rect(int x, int y, int w, int h, int tl, int tr, int br, int bl, uint16_t color)
{
	gea_embedded_display_fill_rounded_rect(x, y, w, h, tl, tr, br, bl, color);
}

EMSCRIPTEN_KEEPALIVE
void screen_stroke_rounded_rect(int x, int y, int w, int h, int tl, int tr, int br, int bl, int lw, uint16_t color)
{
	gea_embedded_display_stroke_rounded_rect(x, y, w, h, tl, tr, br, bl, lw, color);
}

EMSCRIPTEN_KEEPALIVE
int screen_image_decode(const uint8_t *data, int len)
{
	return gea_embedded_image_decode(data, len, -1);
}

EMSCRIPTEN_KEEPALIVE
int screen_image_width(int id)
{
	return gea_embedded_image_width(id);
}

EMSCRIPTEN_KEEPALIVE
int screen_image_height(int id)
{
	return gea_embedded_image_height(id);
}

EMSCRIPTEN_KEEPALIVE
int screen_image_frame_count(int id)
{
	return gea_embedded_image_frame_count(id);
}

EMSCRIPTEN_KEEPALIVE
int screen_image_is_animated(int id)
{
	return gea_embedded_image_is_animated(id);
}

EMSCRIPTEN_KEEPALIVE
void screen_image_set_playing(int id, int playing)
{
	gea_embedded_image_set_playing(id, playing);
}

EMSCRIPTEN_KEEPALIVE
void screen_image_seek(int id, int frame)
{
	gea_embedded_image_seek(id, frame);
}

EMSCRIPTEN_KEEPALIVE
int screen_image_advance(int id, int delta_ms)
{
	return gea_embedded_image_advance(id, delta_ms);
}

EMSCRIPTEN_KEEPALIVE
void screen_image_draw(int id, int dx, int dy)
{
	const uint16_t *pixels = gea_embedded_image_current_pixels(id);
	if (pixels) {
		int w = gea_embedded_image_width(id);
		int h = gea_embedded_image_height(id);
		gea_embedded_display_blit_image(pixels, w, h, dx, dy);
	}
}

EMSCRIPTEN_KEEPALIVE
void screen_image_draw_scaled(int id, int dx, int dy, int dw, int dh)
{
	const uint16_t *pixels = gea_embedded_image_current_pixels(id);
	if (pixels) {
		int w = gea_embedded_image_width(id);
		int h = gea_embedded_image_height(id);
		gea_embedded_display_blit_image_scaled(pixels, w, h, dx, dy, dw, dh);
	}
}

EMSCRIPTEN_KEEPALIVE
void screen_image_dispose(int id)
{
	gea_embedded_image_dispose(id);
}

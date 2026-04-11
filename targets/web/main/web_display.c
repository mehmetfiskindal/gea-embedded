#include "display.h"

#include <stdlib.h>
#include <string.h>

#include <emscripten.h>

#if __has_include("gea_embedded_font_generated.h")
#include "gea_embedded_font_generated.h"
#endif
#include "raster.h"

static gea_embedded_raster_t raster = { 0 };
static uint16_t *framebuffer = NULL;
static int display_brightness = 100;

EM_JS(void, web_display_publish_brightness, (int brightness_percent), {
  globalThis.__gea_embedded_display_brightness = brightness_percent;
});

int web_display_resize(int width, int height)
{
	if (width <= 0 || height <= 0) return 0;

	size_t pixel_count = (size_t)width * (size_t)height;
	uint16_t *next = realloc(framebuffer, pixel_count * sizeof(uint16_t));
	if (!next) return 0;

	framebuffer = next;
	memset(framebuffer, 0, pixel_count * sizeof(uint16_t));
	gea_embedded_raster_bind(&raster, framebuffer, width, height);
	web_display_publish_brightness(display_brightness);
	return 1;
}

const uint16_t *web_display_pixels(void)
{
	return gea_embedded_raster_pixels_const(&raster);
}

int web_display_width(void)
{
	return gea_embedded_raster_width(&raster);
}

int web_display_height(void)
{
	return gea_embedded_raster_height(&raster);
}

int web_display_stride_bytes(void)
{
	return gea_embedded_raster_stride_bytes(&raster);
}

void gea_embedded_display_clear(void)
{
	gea_embedded_raster_clear(&raster, 0x0000);
}

void gea_embedded_display_flush(void)
{
	/* Browser presentation reads directly from the framebuffer. */
}

void gea_embedded_display_push_clip(int x, int y, int w, int h) { gea_embedded_raster_push_clip(&raster, x, y, w, h); }
void gea_embedded_display_pop_clip(void) { gea_embedded_raster_pop_clip(&raster); }
void gea_embedded_display_reset_clip(void) { gea_embedded_raster_reset_clip(&raster); }
void gea_embedded_display_get_clip(int *x0, int *y0, int *x1, int *y1) { gea_embedded_raster_get_clip(&raster, x0, y0, x1, y1); }
void gea_embedded_display_set_alpha(uint8_t a) { gea_embedded_raster_set_alpha(&raster, a); }
uint8_t gea_embedded_display_get_alpha(void) { return gea_embedded_raster_get_alpha(&raster); }
int gea_embedded_display_get_brightness(void) { return display_brightness; }
void gea_embedded_display_set_brightness(int brightness_percent)
{
	if (brightness_percent < 0) brightness_percent = 0;
	if (brightness_percent > 100) brightness_percent = 100;
	display_brightness = brightness_percent;
	web_display_publish_brightness(display_brightness);
}
void gea_embedded_display_fill_rect(int x, int y, int w, int h, uint16_t color) { gea_embedded_raster_fill_rect(&raster, x, y, w, h, color); }
void gea_embedded_display_stroke_rect(int x, int y, int w, int h, uint16_t color) { gea_embedded_raster_stroke_rect(&raster, x, y, w, h, color); }
void gea_embedded_display_fill_circle(int cx, int cy, int r, uint16_t color) { gea_embedded_raster_fill_circle(&raster, cx, cy, r, color); }
void gea_embedded_display_stroke_circle(int cx, int cy, int r, uint16_t color) { gea_embedded_raster_stroke_circle(&raster, cx, cy, r, color); }
void gea_embedded_display_draw_line(int x0, int y0, int x1, int y1, uint16_t color) { gea_embedded_raster_draw_line(&raster, x0, y0, x1, y1, color); }
void gea_embedded_display_draw_arc(int cx, int cy, int r, int start_deg, int end_deg, uint16_t color) { gea_embedded_raster_draw_arc(&raster, cx, cy, r, start_deg, end_deg, color); }
void gea_embedded_display_fill_triangle(int x0, int y0, int x1, int y1, int x2, int y2, uint16_t color) { gea_embedded_raster_fill_triangle(&raster, x0, y0, x1, y1, x2, y2, color); }
void gea_embedded_display_draw_text(const char *text, int x, int y, uint16_t color, float scale) { gea_embedded_raster_draw_text(&raster, text, x, y, color, scale); }
#ifdef GEA_EMBEDDED_HAS_GENERATED_FONTS
void gea_embedded_display_draw_text_font(const char *text, int x, int y, uint16_t color, int font_id) { gea_embedded_raster_draw_text_font(&raster, text, x, y, color, font_id); }
#endif
void gea_embedded_display_set_pixel(int x, int y, uint16_t color) { gea_embedded_raster_set_pixel(&raster, x, y, color); }
void gea_embedded_display_fill_rounded_rect(int x, int y, int w, int h, int tl, int tr, int br, int bl, uint16_t color) { gea_embedded_raster_fill_rounded_rect(&raster, x, y, w, h, tl, tr, br, bl, color); }
void gea_embedded_display_stroke_rounded_rect(int x, int y, int w, int h, int tl, int tr, int br, int bl, int lw, uint16_t color) { gea_embedded_raster_stroke_rounded_rect(&raster, x, y, w, h, tl, tr, br, bl, lw, color); }
void gea_embedded_display_blit_image(const uint16_t *src, int src_w, int src_h, int dx, int dy) { gea_embedded_raster_blit(&raster, src, src_w, src_h, dx, dy); }
void gea_embedded_display_blit_image_scaled(const uint16_t *src, int src_w, int src_h, int dx, int dy, int dst_w, int dst_h) { gea_embedded_raster_blit_scaled(&raster, src, src_w, src_h, dx, dy, dst_w, dst_h); }

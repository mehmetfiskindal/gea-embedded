#include "display.h"

#include <stdlib.h>
#include <string.h>

#if __has_include("gea_embedded_font_generated.h")
#include "gea_embedded_font_generated.h"
#endif
#if __has_include("gea_embedded_app_config.h")
#include "gea_embedded_app_config.h"
#endif
#include "raster.h"
#include "esp_err.h"
#include "esp_heap_caps.h"
#include "esp_lcd_co5300.h"
#include "esp_lcd_panel_io.h"
#include "esp_lcd_panel_ops.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "driver/gpio.h"
#include "driver/spi_master.h"

static const char *TAG = "display";

#define LCD_HOST    SPI2_HOST
#define PIN_CS      12
#define PIN_PCLK    11
#define PIN_DATA0   4
#define PIN_DATA1   5
#define PIN_DATA2   6
#define PIN_DATA3   7
#define PIN_RST     8

#define FG_COLOR    0xFFFF
#define BG_COLOR    0x0000
#ifndef GEA_EMBEDDED_DISPLAY_FLUSH_CHUNK_MAX
#define GEA_EMBEDDED_DISPLAY_FLUSH_CHUNK_MAX 32
#endif
#ifndef GEA_EMBEDDED_DISPLAY_FLUSH_QUEUE_DEPTH
#define GEA_EMBEDDED_DISPLAY_FLUSH_QUEUE_DEPTH 4
#endif
#ifndef GEA_EMBEDDED_DISPLAY_FLUSH_CHUNK_LIMIT
#if GEA_EMBEDDED_DISPLAY_FLUSH_CHUNK_MAX > 32
#define GEA_EMBEDDED_DISPLAY_FLUSH_CHUNK_LIMIT GEA_EMBEDDED_DISPLAY_FLUSH_CHUNK_MAX
#else
#define GEA_EMBEDDED_DISPLAY_FLUSH_CHUNK_LIMIT 32
#endif
#endif
#ifndef GEA_EMBEDDED_DISPLAY_FLUSH_QUEUE_DEPTH_LIMIT
#if GEA_EMBEDDED_DISPLAY_FLUSH_QUEUE_DEPTH > 4
#define GEA_EMBEDDED_DISPLAY_FLUSH_QUEUE_DEPTH_LIMIT GEA_EMBEDDED_DISPLAY_FLUSH_QUEUE_DEPTH
#else
#define GEA_EMBEDDED_DISPLAY_FLUSH_QUEUE_DEPTH_LIMIT 4
#endif
#endif

#define FLUSH_CHUNK_DEFAULT GEA_EMBEDDED_DISPLAY_FLUSH_CHUNK_MAX
#define FLUSH_CHUNK_LIMIT GEA_EMBEDDED_DISPLAY_FLUSH_CHUNK_LIMIT
#define FLUSH_CHUNK_MIN 8
#define FLUSH_QUEUE_DEPTH_DEFAULT GEA_EMBEDDED_DISPLAY_FLUSH_QUEUE_DEPTH
#define FLUSH_QUEUE_DEPTH_LIMIT GEA_EMBEDDED_DISPLAY_FLUSH_QUEUE_DEPTH_LIMIT

extern const uint8_t gea_embedded_font_8x16[95][16];

static esp_lcd_panel_handle_t panel = NULL;
static gea_embedded_raster_t raster = { 0 };
static uint16_t *framebuf = NULL;
static uint16_t *flush_bufs[FLUSH_QUEUE_DEPTH_LIMIT] = { NULL };
static int flush_buf_capacity = 0;
static int flush_buf_idx = 0;
static SemaphoreHandle_t flush_slots = NULL;
static int flush_chunk_rows = FLUSH_CHUNK_DEFAULT;
static int flush_queue_depth = FLUSH_QUEUE_DEPTH_DEFAULT;
static int cursor_row = 0;
static int cursor_col = 0;
static int display_brightness = 100;

static bool IRAM_ATTR flush_done_cb(esp_lcd_panel_io_handle_t io, esp_lcd_panel_io_event_data_t *edata, void *user_ctx)
{
	(void)io;
	(void)edata;
	(void)user_ctx;
	if (!flush_slots) return false;
	BaseType_t need_yield = pdFALSE;
	xSemaphoreGiveFromISR(flush_slots, &need_yield);
	return need_yield == pdTRUE;
}

static void flush_region(int x, int y, int w, int h)
{
	gea_embedded_raster_mark_dirty(&raster, x, y, x + w - 1, y + h - 1);
	gea_embedded_display_flush();
}

static int normalize_flush_chunk_rows(int rows)
{
	if (rows <= 0) rows = FLUSH_CHUNK_DEFAULT;
	if (rows < FLUSH_CHUNK_MIN) rows = FLUSH_CHUNK_MIN;
	if (rows > FLUSH_CHUNK_LIMIT) rows = FLUSH_CHUNK_LIMIT;
	return rows;
}

static int normalize_flush_queue_depth(int depth)
{
	if (depth <= 0) depth = FLUSH_QUEUE_DEPTH_DEFAULT;
	if (depth < 1) depth = 1;
	if (depth > FLUSH_QUEUE_DEPTH_LIMIT) depth = FLUSH_QUEUE_DEPTH_LIMIT;
	return depth;
}

static int next_smaller_chunk(int chunk)
{
	if (chunk <= FLUSH_CHUNK_MIN) return 0;
	chunk /= 2;
	return chunk < FLUSH_CHUNK_MIN ? FLUSH_CHUNK_MIN : chunk;
}

static void free_flush_buffers(void)
{
	for (int slot = 0; slot < FLUSH_QUEUE_DEPTH_LIMIT; slot++) {
		if (flush_bufs[slot]) {
			free(flush_bufs[slot]);
			flush_bufs[slot] = NULL;
		}
	}
	flush_buf_capacity = 0;
	flush_buf_idx = 0;
}

static int wait_for_flush_idle(void)
{
	if (!flush_slots || flush_queue_depth <= 0) return 1;

	int taken = 0;
	for (int i = 0; i < flush_queue_depth; i++) {
		if (xSemaphoreTake(flush_slots, pdMS_TO_TICKS(1000)) != pdTRUE) {
			for (int j = 0; j < taken; j++) xSemaphoreGive(flush_slots);
			ESP_LOGE(TAG, "Timed out waiting for LCD flush pipeline to idle");
			return 0;
		}
		taken++;
	}
	return 1;
}

static esp_err_t configure_flush_pipeline(int requested_rows, int requested_depth)
{
	int target_rows = normalize_flush_chunk_rows(requested_rows);
	int target_depth = normalize_flush_queue_depth(requested_depth);

	if (flush_slots && flush_chunk_rows == target_rows && flush_queue_depth == target_depth && flush_bufs[0]) return ESP_OK;
	if (!wait_for_flush_idle()) return ESP_ERR_TIMEOUT;

	if (flush_slots) {
		vSemaphoreDelete(flush_slots);
		flush_slots = NULL;
	}
	free_flush_buffers();

	for (int depth = target_depth; depth >= 1; depth--) {
		for (int chunk = target_rows; chunk > 0; chunk = next_smaller_chunk(chunk)) {
			bool ok = true;
			for (int slot = 0; slot < depth; slot++) {
				flush_bufs[slot] = heap_caps_malloc(DISPLAY_WIDTH * chunk * sizeof(uint16_t), MALLOC_CAP_DMA | MALLOC_CAP_INTERNAL);
				if (!flush_bufs[slot]) {
					ok = false;
					break;
				}
			}
			if (ok) {
				flush_slots = xSemaphoreCreateCounting(depth, depth);
				if (!flush_slots) {
					ESP_LOGE(TAG, "Failed to create LCD flush semaphore");
					free_flush_buffers();
					return ESP_ERR_NO_MEM;
				}
				flush_chunk_rows = chunk;
				flush_queue_depth = depth;
				flush_buf_capacity = DISPLAY_WIDTH * chunk;
				flush_buf_idx = 0;
				if (chunk != target_rows || depth != target_depth) {
					ESP_LOGW(TAG, "LCD flush pipeline reduced to %d rows, %d-deep pipeline", chunk, depth);
				}
				ESP_LOGI(TAG, "LCD flush pipeline: %d rows, %d-deep pipeline", chunk, depth);
				return ESP_OK;
			}
			free_flush_buffers();
		}
	}

	ESP_LOGE(TAG, "Failed to allocate LCD flush buffers");
	return ESP_ERR_NO_MEM;
}

static void render_char_to_fb(int col, int row, char c)
{
	if (!framebuf) return;
	if (c < 0x20 || c > 0x7E) c = '?';
	const uint8_t *glyph = gea_embedded_font_8x16[c - 0x20];
	int ox = col * GLYPH_W;
	int oy = row * GLYPH_H;
	for (int frow = 0; frow < FONT_H; frow++) {
		uint8_t bits = glyph[frow];
		for (int fbit = 0; fbit < FONT_W; fbit++) {
			uint16_t color = (bits & (0x80 >> fbit)) ? FG_COLOR : BG_COLOR;
			for (int sy = 0; sy < FONT_SCALE; sy++) {
				int py = oy + frow * FONT_SCALE + sy;
				if (py >= DISPLAY_HEIGHT) break;
				for (int sx = 0; sx < FONT_SCALE; sx++) {
					int px = ox + fbit * FONT_SCALE + sx;
					if (px < DISPLAY_WIDTH) framebuf[py * DISPLAY_WIDTH + px] = color;
				}
			}
		}
	}
}

static void scroll_up(void)
{
	cursor_row = SCREEN_ROWS - 1;
	cursor_col = 0;
	gea_embedded_raster_clear(&raster, BG_COLOR);
	gea_embedded_display_flush();
}

static void newline(void)
{
	cursor_col = 0;
	cursor_row++;
	if (cursor_row >= SCREEN_ROWS) scroll_up();
}

void gea_embedded_display_reset_clip(void) { gea_embedded_raster_reset_clip(&raster); }
void gea_embedded_display_push_clip(int x, int y, int w, int h) { gea_embedded_raster_push_clip(&raster, x, y, w, h); }
void gea_embedded_display_pop_clip(void) { gea_embedded_raster_pop_clip(&raster); }
void gea_embedded_display_get_clip(int *x0, int *y0, int *x1, int *y1) { gea_embedded_raster_get_clip(&raster, x0, y0, x1, y1); }
void gea_embedded_display_set_alpha(uint8_t a) { gea_embedded_raster_set_alpha(&raster, a); }
uint8_t gea_embedded_display_get_alpha(void) { return gea_embedded_raster_get_alpha(&raster); }

int gea_embedded_display_get_brightness(void)
{
	return display_brightness;
}

void gea_embedded_display_set_brightness(int brightness_percent)
{
	if (brightness_percent < 0) brightness_percent = 0;
	if (brightness_percent > 100) brightness_percent = 100;
	display_brightness = brightness_percent;
	if (!panel) return;

	esp_err_t err = esp_lcd_panel_co5300_set_brightness(panel, (uint8_t)display_brightness);
	if (err != ESP_OK) {
		ESP_LOGW(TAG, "Failed to set LCD brightness to %d%%: %s", display_brightness, esp_err_to_name(err));
	}
}

void gea_embedded_display_set_flush_config(int chunk_rows, int queue_depth)
{
	esp_err_t err = configure_flush_pipeline(chunk_rows, queue_depth);
	if (err != ESP_OK) {
		ESP_LOGE(TAG, "Failed to configure LCD flush pipeline: %s", esp_err_to_name(err));
	}
}

void gea_embedded_display_flush(void)
{
	if (!panel || !framebuf || !flush_bufs[0] || !flush_slots || flush_queue_depth <= 0) return;
	int x0, y0, x1, y1;
	if (!gea_embedded_raster_get_dirty(&raster, &x0, &y0, &x1, &y1)) return;
	x0 &= ~1;
	y0 &= ~1;
	x1 |= 1;
	y1 |= 1;
	if (x1 >= DISPLAY_WIDTH) x1 = DISPLAY_WIDTH - 1;
	if (y1 >= DISPLAY_HEIGHT) y1 = DISPLAY_HEIGHT - 1;
	int w = x1 - x0 + 1;
	bool ok = true;
	for (int row = y0; row <= y1; row += flush_chunk_rows) {
		int ch = flush_chunk_rows;
		if (row + ch > DISPLAY_HEIGHT) ch = DISPLAY_HEIGHT - row;
		if (ch <= 0) break;
		int pixel_count = w * ch;
		if (pixel_count > flush_buf_capacity) {
			ESP_LOGE(TAG, "LCD chunk too large: %d > %d", pixel_count, flush_buf_capacity);
			ok = false;
			break;
		}

		if (xSemaphoreTake(flush_slots, pdMS_TO_TICKS(1000)) != pdTRUE) {
			ESP_LOGE(TAG, "LCD draw timed out waiting for slot");
			ok = false;
			break;
		}
		uint16_t *buf = flush_bufs[flush_buf_idx];
		flush_buf_idx = (flush_buf_idx + 1) % flush_queue_depth;

		for (int ry = 0; ry < ch; ry++) {
			memcpy(&buf[ry * w], &framebuf[(row + ry) * DISPLAY_WIDTH + x0], w * sizeof(uint16_t));
		}
		for (int i = 0; i < pixel_count; i++) {
			buf[i] = __builtin_bswap16(buf[i]);
		}

		esp_err_t err = esp_lcd_panel_draw_bitmap(panel, x0, row, x1 + 1, row + ch, buf);
		if (err != ESP_OK) {
			ESP_LOGE(TAG, "LCD draw failed: %s", esp_err_to_name(err));
			xSemaphoreGive(flush_slots);
			ok = false;
			break;
		}
	}
	if (ok) gea_embedded_raster_reset_dirty(&raster);
}

void gea_embedded_display_clear(void)
{
	if (!framebuf) return;
	gea_embedded_raster_clear(&raster, BG_COLOR);
	gea_embedded_display_flush();
	cursor_row = 0;
	cursor_col = 0;
}

void gea_embedded_display_print(const char *text)
{
	if (!panel || !framebuf || !text) return;
	for (const char *p = text; *p; p++) {
		if (*p == '\n') {
			flush_region(0, cursor_row * GLYPH_H, DISPLAY_WIDTH, GLYPH_H);
			newline();
			continue;
		}
		render_char_to_fb(cursor_col, cursor_row, *p);
		cursor_col++;
		if (cursor_col >= SCREEN_COLS) {
			flush_region(0, cursor_row * GLYPH_H, DISPLAY_WIDTH, GLYPH_H);
			newline();
		}
	}
	if (cursor_col > 0) flush_region(0, cursor_row * GLYPH_H, DISPLAY_WIDTH, GLYPH_H);
}

esp_err_t gea_embedded_display_init(void)
{
	ESP_LOGI(TAG, "Initializing CO5300 QSPI display (%dx%d, %dx scale)", DISPLAY_WIDTH, DISPLAY_HEIGHT, FONT_SCALE);
	framebuf = heap_caps_malloc(DISPLAY_WIDTH * DISPLAY_HEIGHT * sizeof(uint16_t), MALLOC_CAP_SPIRAM);
	if (!framebuf) {
		ESP_LOGE(TAG, "Failed to allocate framebuffer in PSRAM");
		return ESP_ERR_NO_MEM;
	}
	memset(framebuf, 0, DISPLAY_WIDTH * DISPLAY_HEIGHT * sizeof(uint16_t));
	gea_embedded_raster_bind(&raster, framebuf, DISPLAY_WIDTH, DISPLAY_HEIGHT);
	ESP_LOGI(TAG, "Framebuffer allocated: %d bytes in PSRAM", DISPLAY_WIDTH * DISPLAY_HEIGHT * (int)sizeof(uint16_t));

	esp_err_t flush_err = configure_flush_pipeline(FLUSH_CHUNK_DEFAULT, FLUSH_QUEUE_DEPTH_DEFAULT);
	if (flush_err != ESP_OK) return flush_err;

	const spi_bus_config_t buscfg = CO5300_PANEL_BUS_QSPI_CONFIG(
		PIN_PCLK, PIN_DATA0, PIN_DATA1, PIN_DATA2, PIN_DATA3, DISPLAY_WIDTH * 80 * sizeof(uint16_t));
	ESP_ERROR_CHECK(spi_bus_initialize(LCD_HOST, &buscfg, SPI_DMA_CH_AUTO));

	esp_lcd_panel_io_handle_t io_handle = NULL;
	esp_lcd_panel_io_spi_config_t io_config = CO5300_PANEL_IO_QSPI_CONFIG(PIN_CS, flush_done_cb, NULL);
	io_config.trans_queue_depth = FLUSH_QUEUE_DEPTH_LIMIT;
	ESP_ERROR_CHECK(esp_lcd_new_panel_io_spi(LCD_HOST, &io_config, &io_handle));

	co5300_vendor_config_t vendor_config = { .flags = { .use_qspi_interface = 1 } };
	const esp_lcd_panel_dev_config_t panel_config = {
		.reset_gpio_num = PIN_RST,
		.rgb_ele_order = LCD_RGB_ELEMENT_ORDER_RGB,
		.bits_per_pixel = 16,
		.vendor_config = &vendor_config,
	};
	ESP_ERROR_CHECK(esp_lcd_new_panel_co5300(io_handle, &panel_config, &panel));
	ESP_ERROR_CHECK(esp_lcd_panel_reset(panel));
	ESP_ERROR_CHECK(esp_lcd_panel_init(panel));
	ESP_ERROR_CHECK(esp_lcd_panel_disp_on_off(panel, true));
	ESP_ERROR_CHECK(esp_lcd_panel_set_gap(panel, 22, 0));
	gea_embedded_display_set_brightness(display_brightness);

	gea_embedded_display_clear();
	ESP_LOGI(TAG, "Display ready (%d cols x %d rows)", SCREEN_COLS, SCREEN_ROWS);
	return ESP_OK;
}

void gea_embedded_display_set_pixel(int x, int y, uint16_t color) { gea_embedded_raster_set_pixel(&raster, x, y, color); }
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
void gea_embedded_display_fill_rounded_rect(int x, int y, int w, int h, int tl, int tr, int br, int bl, uint16_t color) { gea_embedded_raster_fill_rounded_rect(&raster, x, y, w, h, tl, tr, br, bl, color); }
void gea_embedded_display_stroke_rounded_rect(int x, int y, int w, int h, int tl, int tr, int br, int bl, int lw, uint16_t color) { gea_embedded_raster_stroke_rounded_rect(&raster, x, y, w, h, tl, tr, br, bl, lw, color); }
void gea_embedded_display_blit_image(const uint16_t *src, int src_w, int src_h, int dx, int dy) { gea_embedded_raster_blit(&raster, src, src_w, src_h, dx, dy); }
void gea_embedded_display_blit_image_scaled(const uint16_t *src, int src_w, int src_h, int dx, int dy, int dst_w, int dst_h) { gea_embedded_raster_blit_scaled(&raster, src, src_w, src_h, dx, dy, dst_w, dst_h); }

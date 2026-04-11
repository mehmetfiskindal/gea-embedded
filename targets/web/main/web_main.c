#include <stdint.h>

#include <emscripten/emscripten.h>

#include "ui/ui.h"
#include "web_display.h"

extern void gea_embedded_app_init(int width, int height);
extern void gea_embedded_app_frame(int timestampMs);
extern void gea_embedded_app_touch(int press_id);
extern void gea_embedded_app_touch_start_element(int press_id, int x, int y);
extern void gea_embedded_app_touch_end_element(int press_id, int x, int y);
extern void gea_embedded_app_touch_move_element(int press_id, int x, int y);
extern void gea_embedded_app_touch_start(int x, int y);
extern void gea_embedded_app_touch_move(int x, int y);
extern void gea_embedded_app_touch_end(int x, int y);
extern void gea_embedded_app_mirror_set_int(int field, int value);
extern void gea_embedded_app_mirror_set_string(int field, const char *value);
extern void gea_embedded_app_mirror_set_array_len(int field, int len);
extern void gea_embedded_app_mirror_set_array_int(int field, int index, int subfield, int value);
extern void gea_embedded_app_mirror_commit(void);
extern int gea_embedded_app_mirror_get_field_count(void);
extern unsigned int gea_embedded_app_mirror_get_schema_hash(void);

int gea_embedded_now_ms(void)
{
	return (int)emscripten_get_now();
}

EMSCRIPTEN_KEEPALIVE
int app_init(int width, int height)
{
	if (width <= 0 || height <= 0) return 1;
	if (!web_display_resize(width, height)) return 2;

	gea_embedded_app_init(width, height);
	return 0;
}

EMSCRIPTEN_KEEPALIVE
void app_frame(int timestampMs)
{
	gea_embedded_app_frame(timestampMs);
}

EMSCRIPTEN_KEEPALIVE
void app_touch(int press_id)
{
	gea_embedded_app_touch(press_id);
}

EMSCRIPTEN_KEEPALIVE
void app_touch_start_element(int press_id, int x, int y)
{
	gea_embedded_app_touch_start_element(press_id, x, y);
}

EMSCRIPTEN_KEEPALIVE
void app_touch_end_element(int press_id, int x, int y)
{
	gea_embedded_app_touch_end_element(press_id, x, y);
}

EMSCRIPTEN_KEEPALIVE
void app_touch_move_element(int press_id, int x, int y)
{
	gea_embedded_app_touch_move_element(press_id, x, y);
}

EMSCRIPTEN_KEEPALIVE
int app_hit_test(int x, int y)
{
	return gea_embedded_ui_hit_test(x, y);
}

EMSCRIPTEN_KEEPALIVE
void app_touch_down(int x, int y)
{
	gea_embedded_ui_touch_down(x, y);
}

EMSCRIPTEN_KEEPALIVE
int app_touch_up(void)
{
	return gea_embedded_ui_touch_up();
}

EMSCRIPTEN_KEEPALIVE
void app_touch_start(int x, int y)
{
	gea_embedded_app_touch_start(x, y);
}

EMSCRIPTEN_KEEPALIVE
void app_touch_move(int x, int y)
{
	gea_embedded_ui_touch_move(x, y);
	gea_embedded_app_touch_move(x, y);
}

EMSCRIPTEN_KEEPALIVE
void app_touch_end(int x, int y)
{
	gea_embedded_app_touch_end(x, y);
}

EMSCRIPTEN_KEEPALIVE
const uint16_t *get_framebuffer_ptr(void)
{
	return web_display_pixels();
}

EMSCRIPTEN_KEEPALIVE
int get_framebuffer_width(void)
{
	return web_display_width();
}

EMSCRIPTEN_KEEPALIVE
int get_framebuffer_height(void)
{
	return web_display_height();
}

EMSCRIPTEN_KEEPALIVE
int get_framebuffer_stride_bytes(void)
{
	return web_display_stride_bytes();
}

EMSCRIPTEN_KEEPALIVE
void app_mirror_set_int(int field, int value)
{
	gea_embedded_app_mirror_set_int(field, value);
}

EMSCRIPTEN_KEEPALIVE
void app_mirror_set_string(int field, const char *value)
{
	gea_embedded_app_mirror_set_string(field, value);
}

EMSCRIPTEN_KEEPALIVE
void app_mirror_set_array_len(int field, int len)
{
	gea_embedded_app_mirror_set_array_len(field, len);
}

EMSCRIPTEN_KEEPALIVE
void app_mirror_set_array_int(int field, int index, int subfield, int value)
{
	gea_embedded_app_mirror_set_array_int(field, index, subfield, value);
}

EMSCRIPTEN_KEEPALIVE
void app_mirror_set_scroll(int node, int scroll_y)
{
	gea_embedded_ui_mirror_set_scroll_y(node, scroll_y);
}

EMSCRIPTEN_KEEPALIVE
void app_mirror_commit(void)
{
	gea_embedded_app_mirror_commit();
}

EMSCRIPTEN_KEEPALIVE
int app_mirror_get_field_count(void)
{
	return gea_embedded_app_mirror_get_field_count();
}

EMSCRIPTEN_KEEPALIVE
unsigned int app_mirror_get_schema_hash(void)
{
	return gea_embedded_app_mirror_get_schema_hash();
}

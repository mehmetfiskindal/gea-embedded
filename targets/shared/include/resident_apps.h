#pragma once

#include <stddef.h>

#if __has_include("gea_embedded_font_generated.h")
#include "gea_embedded_font_generated.h"
#else
typedef struct gea_embedded_font_t gea_embedded_font_t;
#endif

typedef struct
{
	const char *id;
	int display_flush_chunk_rows;
	int display_flush_queue_depth;
	void (*init)(int w, int h);
	void (*frame)(int timestamp_ms);
	void (*touch)(int press_id);
	void (*touch_start_element)(int press_id, int x, int y);
	void (*touch_end_element)(int press_id, int x, int y);
	void (*touch_move_element)(int press_id, int x, int y);
	void (*touch_start)(int x, int y);
	void (*touch_move)(int x, int y);
	void (*touch_end)(int x, int y);
	void (*settings_toggle)(void);
	int (*mirror_begin_snapshot)(void);
	int (*mirror_begin_diff)(void);
	int (*mirror_next_record)(unsigned char *dst, int cap);
	void (*mirror_clear_dirty)(void);
	const gea_embedded_font_t *(*font_lookup)(int font_id);
	void (*ble_connected)(void);
	void (*ble_disconnected)(void);
	void (*ble_bound)(void);
} gea_embedded_resident_app_t;

int gea_embedded_resident_apps_is_enabled(void);
const char *gea_embedded_resident_apps_active_id(void);
int gea_embedded_resident_apps_select(const char *app_id);
int gea_embedded_resident_apps_request_launch(const char *app_id);
int gea_embedded_resident_apps_consume_launch(char *dst, size_t cap);
int gea_embedded_resident_apps_return_to_launcher(const char *trigger);

#pragma once

#include <stdint.h>
#include <string.h>

#ifndef UI_MAX_NODES
#define UI_MAX_NODES 512
#endif
#define UI_UNSET (-32768)
#define UI_SCROLL_DIRTY_WORD_COUNT ((UI_MAX_NODES + 63) / 64)

typedef struct {
	int8_t type;

	int8_t display;
	int8_t flex_direction;
	int8_t flex_wrap;
	int8_t justify_content;
	int8_t align_items;
	int8_t align_self;
	int16_t gap;

	int16_t width, height;
	int16_t min_width, min_height;
	int16_t max_width, max_height;
	int16_t flex;

	int16_t padding[4];
	int16_t margin[4];

	int8_t position;
	int16_t pos_offsets[4];
	int16_t z_index;

	uint16_t bg_color;
	int8_t has_bg;
	uint16_t active_bg_color;
	int8_t has_active_bg;
	uint16_t text_color;
	uint8_t opacity;
	int16_t blink_interval_ms;
	int32_t blink_started_ms;
	uint8_t blink_visible;

	int16_t border_width;
	uint16_t border_color;
	int16_t border_radius[4];

	int16_t transform_rotate;
	int16_t transform_origin_x;
	int16_t transform_origin_y;

	int16_t font_id;
	int16_t font_size;
	int8_t text_align;
	int8_t overflow;
	int16_t scroll_y;
	int16_t scroll_content_h;
	char text[64];

	int16_t image_id;
	int8_t image_fit;

	int16_t parent;
	int16_t first_child, last_child;
	int16_t next_sibling, prev_sibling;

	int16_t layout_x, layout_y;
	int16_t layout_w, layout_h;

	int16_t on_press_id;

	int16_t prev_layout_x, prev_layout_y;
	int16_t prev_layout_w, prev_layout_h;
	int16_t prev_transform_rotate;
	int16_t prev_transform_origin_x;
	int16_t prev_transform_origin_y;
	uint8_t dirty;
} ui_node_t;

extern ui_node_t gea_embedded_ui_nodes[UI_MAX_NODES];

enum ui_prop {
	UI_PROP_DISPLAY = 0,
	UI_PROP_FLEX_DIRECTION,
	UI_PROP_FLEX_WRAP,
	UI_PROP_JUSTIFY_CONTENT,
	UI_PROP_ALIGN_ITEMS,
	UI_PROP_ALIGN_SELF,
	UI_PROP_GAP,
	UI_PROP_WIDTH,
	UI_PROP_HEIGHT,
	UI_PROP_MIN_WIDTH,
	UI_PROP_MIN_HEIGHT,
	UI_PROP_MAX_WIDTH,
	UI_PROP_MAX_HEIGHT,
	UI_PROP_FLEX,
	UI_PROP_PADDING_TOP,
	UI_PROP_PADDING_RIGHT,
	UI_PROP_PADDING_BOTTOM,
	UI_PROP_PADDING_LEFT,
	UI_PROP_MARGIN_TOP,
	UI_PROP_MARGIN_RIGHT,
	UI_PROP_MARGIN_BOTTOM,
	UI_PROP_MARGIN_LEFT,
	UI_PROP_POSITION,
	UI_PROP_TOP,
	UI_PROP_RIGHT,
	UI_PROP_BOTTOM,
	UI_PROP_LEFT,
	UI_PROP_Z_INDEX,
	UI_PROP_BG_COLOR,
	UI_PROP_HAS_BG,
	UI_PROP_ACTIVE_BG_COLOR,
	UI_PROP_HAS_ACTIVE_BG,
	UI_PROP_COLOR,
	UI_PROP_OPACITY,
	UI_PROP_BLINK_INTERVAL,
	UI_PROP_BORDER_WIDTH,
	UI_PROP_BORDER_COLOR,
	UI_PROP_BORDER_RADIUS_TL,
	UI_PROP_BORDER_RADIUS_TR,
	UI_PROP_BORDER_RADIUS_BR,
	UI_PROP_BORDER_RADIUS_BL,
	UI_PROP_FONT_ID,
	UI_PROP_FONT_SIZE,
	UI_PROP_TEXT_ALIGN,
	UI_PROP_OVERFLOW,
	UI_PROP_IMAGE_ID,
	UI_PROP_IMAGE_FIT,
	UI_PROP_TRANSFORM_ROTATE,
	UI_PROP_TRANSFORM_ORIGIN_X,
	UI_PROP_TRANSFORM_ORIGIN_Y,
	UI_PROP_COUNT
};

int  gea_embedded_ui_create_view(void);
int  gea_embedded_ui_create_text(void);
int  gea_embedded_ui_create_image(void);
void gea_embedded_ui_set_parent(int child, int parent);
void gea_embedded_ui_set_style(int node, int prop, int value);
void gea_embedded_ui_set_text(int node, const char *text);
void gea_embedded_ui_set_on_press(int node, int callback_id);
void gea_embedded_ui_mount(int root, int width, int height);
void gea_embedded_ui_refresh(int root, int width, int height);
void gea_embedded_ui_frame(int timestamp_ms);
void gea_embedded_ui_clear(void);
void gea_embedded_ui_remove_node(int node);
int  gea_embedded_ui_hit_test(int x, int y);
void gea_embedded_ui_touch_down(int x, int y);
int  gea_embedded_ui_touch_move(int x, int y);
int  gea_embedded_ui_touch_up(void);
int  gea_embedded_ui_mirror_scroll_dirty_any(void);
void gea_embedded_ui_mirror_copy_scroll_dirty(uint64_t *dst, int word_count);
void gea_embedded_ui_mirror_clear_scroll_dirty(void);
int  gea_embedded_ui_mirror_node_is_scrollable(int node);
int  gea_embedded_ui_mirror_get_scroll_y(int node);
void gea_embedded_ui_mirror_set_scroll_y(int node, int scroll_y);

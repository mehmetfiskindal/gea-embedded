#pragma once

#include "ui.h"
#include <stdint.h>

#define UI_TYPE_VIEW 0
#define UI_TYPE_TEXT 1
#define UI_TYPE_IMAGE 2

#ifndef UI_MAX_CHILDREN
#define UI_MAX_CHILDREN 256
#endif

#ifndef UI_MAX_FLEX_LINES
#define UI_MAX_FLEX_LINES 32
#endif

extern int gea_embedded_ui_node_count;
extern int gea_embedded_ui_mounted_root;
extern int gea_embedded_ui_mounted_w;
extern int gea_embedded_ui_mounted_h;

int gea_embedded_ui_create_node(int type);

enum ui_display_cmd_type
{
	CMD_PUSH_CLIP,
	CMD_POP_CLIP,
	CMD_SET_ALPHA,
	CMD_FILL_RECT,
	CMD_FILL_ROUNDED_RECT,
	CMD_FILL_QUAD,
	CMD_STROKE_RECT,
	CMD_STROKE_ROUNDED_RECT,
	CMD_DRAW_TEXT,
	CMD_BLIT_IMAGE,
	CMD_BLIT_IMAGE_SCALED
};

typedef struct
{
	uint8_t type;
	int16_t bx, by, bw, bh;
	union
	{
		struct
		{
			int16_t x, y, w, h;
		} clip;
		struct
		{
			uint8_t alpha;
		} alpha;
		struct
		{
			int16_t x, y, w, h;
			uint16_t color;
		} fill;
		struct
		{
			int16_t x, y, w, h;
			int16_t tl, tr, br, bl;
			uint16_t color;
		} fill_rr;
		struct
		{
			int16_t x0, y0, x1, y1, x2, y2, x3, y3;
			uint16_t color;
		} quad;
		struct
		{
			int16_t x, y, w, h;
			uint16_t color;
		} stroke;
		struct
		{
			int16_t x, y, w, h;
			int16_t tl, tr, br, bl;
			int16_t lw;
			uint16_t color;
		} stroke_rr;
		struct
		{
			const char *text;
			int16_t x, y, max_w;
			uint16_t color;
			float scale;
			int8_t align;
			int16_t container_w;
			int16_t font_id;
		} text;
		struct
		{
			const uint16_t *pixels;
			int16_t src_w, src_h, dx, dy;
		} blit;
		struct
		{
			const uint16_t *pixels;
			int16_t src_w, src_h, dx, dy, dw, dh;
		} blit_s;
	};
} ui_display_cmd_t;

ui_display_cmd_t *gea_embedded_ui_display_list_append(void);
void gea_embedded_ui_display_list_clear(void);
void gea_embedded_ui_record_node(int id, uint8_t parent_alpha);
void gea_embedded_ui_replay_display_list(void);
int gea_embedded_ui_can_replay_direct_dirty_regions(int width, int height);
void gea_embedded_ui_replay_direct_dirty_region(int x0, int y0, int x1, int y1);
void gea_embedded_ui_transformed_bounds(const ui_node_t *n, int use_prev, int *x0, int *y0, int *x1, int *y1);

int gea_embedded_ui_clamp_size(int size, int min_s, int max_s);
int gea_embedded_ui_collect_children(int parent, int *out, int max, int skip_abs);
void gea_embedded_ui_layout_node(int id, int avail_w, int avail_h);
void gea_embedded_ui_reposition_children(int id);
void gea_embedded_ui_resolve_absolute_coords(int id, int parent_x, int parent_y);

int gea_embedded_ui_view_record_clip_begin(const ui_node_t *n);
void gea_embedded_ui_view_record_clip_end(const ui_node_t *n);
void gea_embedded_ui_view_record_box(const ui_node_t *n);
void gea_embedded_ui_view_record_scrollbar(const ui_node_t *n);
int gea_embedded_ui_scroll_max_y(const ui_node_t *n);
void gea_embedded_ui_mark_scroll_dirty(int node);

void gea_embedded_ui_text_layout(int id, int avail_w);
void gea_embedded_ui_text_record(const ui_node_t *n);
void gea_embedded_ui_text_draw_wrapped(const char *text, int x, int y,
																			 int max_width, uint16_t color, float scale,
																			 int text_align, int container_w, int font_id);

void gea_embedded_ui_image_layout(int id);
void gea_embedded_ui_image_record(const ui_node_t *n);

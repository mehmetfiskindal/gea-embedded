#include "internal.h"
#include "display.h"

#include <stdlib.h>

#if __has_include("esp_heap_caps.h")
#include "esp_heap_caps.h"
#endif

#ifndef DISPLAY_LIST_MAX
#define DISPLAY_LIST_MAX 2048
#endif

static ui_display_cmd_t *display_list = NULL;
static int display_list_len = 0;
static uint8_t replay_clip_pushed[DISPLAY_LIST_MAX];
static int16_t node_draw_start[UI_MAX_NODES];
static int16_t node_draw_end[UI_MAX_NODES];
static int16_t draw_node_order[UI_MAX_NODES];
static int draw_node_order_len = 0;

#ifndef UI_SCRATCH_DEPTH
#define UI_SCRATCH_DEPTH 16
#endif

static int record_depth = 0;
static int *record_children_scratch = NULL;

static void *ui_scratch_alloc(size_t size)
{
#if __has_include("esp_heap_caps.h")
	void *ptr = heap_caps_malloc(size, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
	if (ptr) return ptr;
#endif
	return malloc(size);
}

static int *record_children_for_depth(int depth)
{
	if (depth < 0 || depth >= UI_SCRATCH_DEPTH) return NULL;
	if (!record_children_scratch)
		record_children_scratch = ui_scratch_alloc(sizeof(int) * UI_SCRATCH_DEPTH * UI_MAX_CHILDREN);
	if (!record_children_scratch) return NULL;
	return record_children_scratch + depth * UI_MAX_CHILDREN;
}

ui_display_cmd_t *gea_embedded_ui_display_list_append(void)
{
	if (!display_list)
		display_list = ui_scratch_alloc(sizeof(ui_display_cmd_t) * DISPLAY_LIST_MAX);
	if (!display_list) return NULL;
	if (display_list_len >= DISPLAY_LIST_MAX) return NULL;
	return &display_list[display_list_len++];
}

void gea_embedded_ui_display_list_clear(void)
{
	display_list_len = 0;
	draw_node_order_len = 0;
	for (int i = 0; i < gea_embedded_ui_node_count; i++) {
		node_draw_start[i] = -1;
		node_draw_end[i] = -1;
	}
}

static void sort_children_by_z_index(int *children, int child_count)
{
	for (int i = 1; i < child_count; i++) {
		int key = children[i];
		int j = i - 1;
		while (j >= 0 && gea_embedded_ui_nodes[children[j]].z_index > gea_embedded_ui_nodes[key].z_index) {
			children[j + 1] = children[j];
			j--;
		}
		children[j + 1] = key;
	}
}

void gea_embedded_ui_record_node(int id, uint8_t parent_alpha)
{
	ui_node_t *n = &gea_embedded_ui_nodes[id];
	if (n->display == 1) {
		node_draw_start[id] = -1;
		node_draw_end[id] = -1;
		return;
	}
	if (n->blink_interval_ms > 0 && !n->blink_visible) {
		node_draw_start[id] = -1;
		node_draw_end[id] = -1;
		return;
	}

	int x = n->layout_x;
	int y = n->layout_y;
	int w = n->layout_w;
	int h = n->layout_h;

	int pushed_clip = gea_embedded_ui_view_record_clip_begin(n);
	uint8_t cur_alpha = parent_alpha;

	if (n->opacity < 255) {
		cur_alpha = (parent_alpha * n->opacity) / 255;
		ui_display_cmd_t *cmd = gea_embedded_ui_display_list_append();
		if (cmd) {
			cmd->type = CMD_SET_ALPHA;
			cmd->bx = x; cmd->by = y; cmd->bw = w; cmd->bh = h;
			cmd->alpha.alpha = cur_alpha;
		}
	}

	int draw_start = display_list_len;
	gea_embedded_ui_view_record_box(n);

	if (n->type == UI_TYPE_TEXT) {
		gea_embedded_ui_text_record(n);
	} else if (n->type == UI_TYPE_IMAGE) {
		gea_embedded_ui_image_record(n);
	}
	int draw_end = display_list_len;
	node_draw_start[id] = draw_start;
	node_draw_end[id] = draw_end;
	if (draw_end > draw_start && draw_node_order_len < UI_MAX_NODES)
		draw_node_order[draw_node_order_len++] = id;

	int depth = record_depth++;
	int child_count = 0;
	int *children = record_children_for_depth(depth);
	if (children) {
		child_count = gea_embedded_ui_collect_children(id, children, UI_MAX_CHILDREN, 0);
		sort_children_by_z_index(children, child_count);
	}

	for (int i = 0; i < child_count; i++)
		gea_embedded_ui_record_node(children[i], cur_alpha);

	record_depth--;

	gea_embedded_ui_view_record_scrollbar(n);

	if (n->opacity < 255) {
		ui_display_cmd_t *cmd = gea_embedded_ui_display_list_append();
		if (cmd) {
			cmd->type = CMD_SET_ALPHA;
			cmd->bx = x; cmd->by = y; cmd->bw = w; cmd->bh = h;
			cmd->alpha.alpha = parent_alpha;
		}
	}

	if (pushed_clip)
		gea_embedded_ui_view_record_clip_end(n);
}

static int rects_overlap(int ax0, int ay0, int ax1, int ay1, int bx0, int by0, int bx1, int by1)
{
	return ax0 <= bx1 && ay0 <= by1 && ax1 >= bx0 && ay1 >= by0;
}

static void replay_draw_command(const ui_display_cmd_t *c)
{
	switch (c->type) {
	case CMD_FILL_RECT:
		gea_embedded_display_fill_rect(c->fill.x, c->fill.y, c->fill.w, c->fill.h, c->fill.color);
		break;
	case CMD_FILL_ROUNDED_RECT:
		gea_embedded_display_fill_rounded_rect(c->fill_rr.x, c->fill_rr.y,
			c->fill_rr.w, c->fill_rr.h,
			c->fill_rr.tl, c->fill_rr.tr, c->fill_rr.br, c->fill_rr.bl,
			c->fill_rr.color);
		break;
	case CMD_FILL_QUAD:
		gea_embedded_display_fill_triangle(c->quad.x0, c->quad.y0, c->quad.x1, c->quad.y1, c->quad.x2, c->quad.y2, c->quad.color);
		gea_embedded_display_fill_triangle(c->quad.x0, c->quad.y0, c->quad.x2, c->quad.y2, c->quad.x3, c->quad.y3, c->quad.color);
		break;
	case CMD_STROKE_RECT:
		gea_embedded_display_stroke_rect(c->stroke.x, c->stroke.y, c->stroke.w, c->stroke.h, c->stroke.color);
		break;
	case CMD_STROKE_ROUNDED_RECT:
		gea_embedded_display_stroke_rounded_rect(c->stroke_rr.x, c->stroke_rr.y,
			c->stroke_rr.w, c->stroke_rr.h,
			c->stroke_rr.tl, c->stroke_rr.tr, c->stroke_rr.br, c->stroke_rr.bl,
			c->stroke_rr.lw, c->stroke_rr.color);
		break;
	case CMD_DRAW_TEXT:
		gea_embedded_ui_text_draw_wrapped(c->text.text, c->text.x, c->text.y,
			c->text.max_w, c->text.color, c->text.scale,
			c->text.align, c->text.container_w, c->text.font_id);
		break;
	case CMD_BLIT_IMAGE:
		gea_embedded_display_blit_image(c->blit.pixels, c->blit.src_w, c->blit.src_h,
			c->blit.dx, c->blit.dy);
		break;
	case CMD_BLIT_IMAGE_SCALED:
		gea_embedded_display_blit_image_scaled(c->blit_s.pixels, c->blit_s.src_w, c->blit_s.src_h,
			c->blit_s.dx, c->blit_s.dy, c->blit_s.dw, c->blit_s.dh);
		break;
	default:
		break;
	}
}

int gea_embedded_ui_can_replay_direct_dirty_regions(int width, int height)
{
	if (draw_node_order_len <= 0) return 0;

	for (int i = 0; i < gea_embedded_ui_node_count; i++) {
		if (gea_embedded_ui_nodes[i].overflow == 2) return 0;
	}

	for (int i = 0; i < display_list_len; i++) {
		ui_display_cmd_t *c = &display_list[i];
		if (c->type == CMD_SET_ALPHA) return 0;
		if (c->type != CMD_PUSH_CLIP) continue;
		if (c->clip.x > 0 || c->clip.y > 0) return 0;
		if (c->clip.x + c->clip.w < width || c->clip.y + c->clip.h < height) return 0;
	}

	for (int i = 0; i < draw_node_order_len; i++) {
		ui_node_t *n = &gea_embedded_ui_nodes[draw_node_order[i]];
		if (n->transform_rotate != 0 || n->prev_transform_rotate != 0) return 0;
	}

	return 1;
}

void gea_embedded_ui_replay_direct_dirty_region(int x0, int y0, int x1, int y1)
{
	for (int oi = 0; oi < draw_node_order_len; oi++) {
		int node_id = draw_node_order[oi];
		if (node_id < 0 || node_id >= gea_embedded_ui_node_count) continue;
		ui_node_t *n = &gea_embedded_ui_nodes[node_id];
		if (n->display == 1) continue;
		if (n->blink_interval_ms > 0 && !n->blink_visible) continue;

		int nx0 = n->layout_x;
		int ny0 = n->layout_y;
		int nx1 = n->layout_x + n->layout_w - 1;
		int ny1 = n->layout_y + n->layout_h - 1;
		if (!rects_overlap(nx0, ny0, nx1, ny1, x0, y0, x1, y1)) continue;

		int start = node_draw_start[node_id];
		int end = node_draw_end[node_id];
		if (start < 0 || end <= start || end > display_list_len) continue;
		for (int ci = start; ci < end; ci++) {
			ui_display_cmd_t *c = &display_list[ci];
			if (!rects_overlap(c->bx, c->by, c->bx + c->bw - 1, c->by + c->bh - 1, x0, y0, x1, y1)) continue;
			replay_draw_command(c);
		}
	}
}

void gea_embedded_ui_replay_display_list(void)
{
	int cx0 = 0, cy0 = 0, cx1 = 0, cy1 = 0;
	int clip_dirty = 1;
	int clip_stack_depth = 0;

	for (int i = 0; i < display_list_len; i++) {
		ui_display_cmd_t *c = &display_list[i];

		switch (c->type) {
		case CMD_PUSH_CLIP: {
			if (clip_dirty) {
				gea_embedded_display_get_clip(&cx0, &cy0, &cx1, &cy1);
				clip_dirty = 0;
			}
			int nx0 = c->clip.x;
			int ny0 = c->clip.y;
			int nx1 = c->clip.x + c->clip.w - 1;
			int ny1 = c->clip.y + c->clip.h - 1;
			if (nx0 < cx0) nx0 = cx0;
			if (ny0 < cy0) ny0 = cy0;
			if (nx1 > cx1) nx1 = cx1;
			if (ny1 > cy1) ny1 = cy1;

			int changed = nx0 != cx0 || ny0 != cy0 || nx1 != cx1 || ny1 != cy1;
			if (clip_stack_depth < DISPLAY_LIST_MAX) replay_clip_pushed[clip_stack_depth++] = (uint8_t)changed;
			if (changed) {
				gea_embedded_display_push_clip(c->clip.x, c->clip.y, c->clip.w, c->clip.h);
				cx0 = nx0; cy0 = ny0; cx1 = nx1; cy1 = ny1;
			}
			continue;
		}
		case CMD_POP_CLIP:
			if (clip_stack_depth <= 0 || replay_clip_pushed[--clip_stack_depth]) {
				gea_embedded_display_pop_clip();
				clip_dirty = 1;
			}
			continue;
		case CMD_SET_ALPHA:
			gea_embedded_display_set_alpha(c->alpha.alpha);
			continue;
		default:
			break;
		}

		if (clip_dirty) {
			gea_embedded_display_get_clip(&cx0, &cy0, &cx1, &cy1);
			clip_dirty = 0;
		}
		if (c->bx > cx1 || c->by > cy1 ||
		    c->bx + c->bw - 1 < cx0 || c->by + c->bh - 1 < cy0)
			continue;

		replay_draw_command(c);
	}
}

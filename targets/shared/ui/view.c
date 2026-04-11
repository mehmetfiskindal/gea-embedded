#include "internal.h"
#include <math.h>

#define GEA_EMBEDDED_PI 3.14159265358979323846

int gea_embedded_ui_create_view(void)
{
	return gea_embedded_ui_create_node(UI_TYPE_VIEW);
}

static void transform_corners(const ui_node_t *n, int use_prev, int16_t *xs, int16_t *ys)
{
	int x = use_prev ? n->prev_layout_x : n->layout_x;
	int y = use_prev ? n->prev_layout_y : n->layout_y;
	int w = use_prev ? n->prev_layout_w : n->layout_w;
	int h = use_prev ? n->prev_layout_h : n->layout_h;
	int rotate = use_prev ? n->prev_transform_rotate : n->transform_rotate;
	int origin_x = use_prev ? n->prev_transform_origin_x : n->transform_origin_x;
	int origin_y = use_prev ? n->prev_transform_origin_y : n->transform_origin_y;

	double ox = (double)x + ((double)w * (double)origin_x) / 1000.0;
	double oy = (double)y + ((double)h * (double)origin_y) / 1000.0;
	double radians = ((double)rotate * GEA_EMBEDDED_PI) / 1800.0;
	double c = cos(radians);
	double s = sin(radians);
	double px[4] = { (double)x, (double)(x + w), (double)(x + w), (double)x };
	double py[4] = { (double)y, (double)y, (double)(y + h), (double)(y + h) };

	for (int i = 0; i < 4; i++) {
		double dx = px[i] - ox;
		double dy = py[i] - oy;
		xs[i] = (int16_t)lround(ox + dx * c - dy * s);
		ys[i] = (int16_t)lround(oy + dx * s + dy * c);
	}
}

void gea_embedded_ui_transformed_bounds(const ui_node_t *n, int use_prev, int *x0, int *y0, int *x1, int *y1)
{
	int x = use_prev ? n->prev_layout_x : n->layout_x;
	int y = use_prev ? n->prev_layout_y : n->layout_y;
	int w = use_prev ? n->prev_layout_w : n->layout_w;
	int h = use_prev ? n->prev_layout_h : n->layout_h;
	int rotate = use_prev ? n->prev_transform_rotate : n->transform_rotate;

	if (w <= 0 || h <= 0) {
		*x0 = x; *y0 = y; *x1 = x - 1; *y1 = y - 1;
		return;
	}

	if ((rotate % 3600) == 0) {
		*x0 = x;
		*y0 = y;
		*x1 = x + w - 1;
		*y1 = y + h - 1;
		return;
	}

	int16_t xs[4], ys[4];
	transform_corners(n, use_prev, xs, ys);
	*x0 = *x1 = xs[0];
	*y0 = *y1 = ys[0];
	for (int i = 1; i < 4; i++) {
		if (xs[i] < *x0) *x0 = xs[i];
		if (xs[i] > *x1) *x1 = xs[i];
		if (ys[i] < *y0) *y0 = ys[i];
		if (ys[i] > *y1) *y1 = ys[i];
	}
}

int gea_embedded_ui_view_record_clip_begin(const ui_node_t *n)
{
	if ((n->transform_rotate % 3600) != 0) return 0;
	if (n->type != UI_TYPE_VIEW || n->overflow == 1) return 0;
	if (n->first_child < 0) return 0;

	ui_display_cmd_t *cmd = gea_embedded_ui_display_list_append();
	if (cmd) {
		cmd->type = CMD_PUSH_CLIP;
		cmd->bx = n->layout_x;
		cmd->by = n->layout_y;
		cmd->bw = n->layout_w;
		cmd->bh = n->layout_h;
		cmd->clip.x = n->layout_x;
		cmd->clip.y = n->layout_y;
		cmd->clip.w = n->layout_w;
		cmd->clip.h = n->layout_h;
	}
	return 1;
}

void gea_embedded_ui_view_record_clip_end(const ui_node_t *n)
{
	ui_display_cmd_t *cmd = gea_embedded_ui_display_list_append();
	if (!cmd) return;
	cmd->type = CMD_POP_CLIP;
	cmd->bx = n->layout_x;
	cmd->by = n->layout_y;
	cmd->bw = n->layout_w;
	cmd->bh = n->layout_h;
}

void gea_embedded_ui_view_record_box(const ui_node_t *n)
{
	int x = n->layout_x;
	int y = n->layout_y;
	int w = n->layout_w;
	int h = n->layout_h;

	if (n->has_bg) {
		if ((n->transform_rotate % 3600) != 0) {
			int16_t xs[4], ys[4];
			transform_corners(n, 0, xs, ys);
			ui_display_cmd_t *cmd = gea_embedded_ui_display_list_append();
			if (cmd) {
				int bx0, by0, bx1, by1;
				gea_embedded_ui_transformed_bounds(n, 0, &bx0, &by0, &bx1, &by1);
				cmd->type = CMD_FILL_QUAD;
				cmd->bx = bx0;
				cmd->by = by0;
				cmd->bw = bx1 - bx0 + 1;
				cmd->bh = by1 - by0 + 1;
				cmd->quad.x0 = xs[0]; cmd->quad.y0 = ys[0];
				cmd->quad.x1 = xs[1]; cmd->quad.y1 = ys[1];
				cmd->quad.x2 = xs[2]; cmd->quad.y2 = ys[2];
				cmd->quad.x3 = xs[3]; cmd->quad.y3 = ys[3];
				cmd->quad.color = n->bg_color;
			}
			return;
		}

		int has_radius = n->border_radius[0] || n->border_radius[1] ||
		                 n->border_radius[2] || n->border_radius[3];
		if (has_radius) {
			ui_display_cmd_t *cmd = gea_embedded_ui_display_list_append();
			if (cmd) {
				cmd->type = CMD_FILL_ROUNDED_RECT;
				cmd->bx = x; cmd->by = y; cmd->bw = w; cmd->bh = h;
				cmd->fill_rr.x = x; cmd->fill_rr.y = y;
				cmd->fill_rr.w = w; cmd->fill_rr.h = h;
				cmd->fill_rr.tl = n->border_radius[0];
				cmd->fill_rr.tr = n->border_radius[1];
				cmd->fill_rr.br = n->border_radius[2];
				cmd->fill_rr.bl = n->border_radius[3];
				cmd->fill_rr.color = n->bg_color;
			}
		} else {
			ui_display_cmd_t *cmd = gea_embedded_ui_display_list_append();
			if (cmd) {
				cmd->type = CMD_FILL_RECT;
				cmd->bx = x; cmd->by = y; cmd->bw = w; cmd->bh = h;
				cmd->fill.x = x; cmd->fill.y = y;
				cmd->fill.w = w; cmd->fill.h = h;
				cmd->fill.color = n->bg_color;
			}
		}
	}

	if (n->border_width > 0) {
		int has_radius = n->border_radius[0] || n->border_radius[1] ||
		                 n->border_radius[2] || n->border_radius[3];
		if (has_radius) {
			ui_display_cmd_t *cmd = gea_embedded_ui_display_list_append();
			if (cmd) {
				cmd->type = CMD_STROKE_ROUNDED_RECT;
				cmd->bx = x; cmd->by = y; cmd->bw = w; cmd->bh = h;
				cmd->stroke_rr.x = x; cmd->stroke_rr.y = y;
				cmd->stroke_rr.w = w; cmd->stroke_rr.h = h;
				cmd->stroke_rr.tl = n->border_radius[0];
				cmd->stroke_rr.tr = n->border_radius[1];
				cmd->stroke_rr.br = n->border_radius[2];
				cmd->stroke_rr.bl = n->border_radius[3];
				cmd->stroke_rr.lw = n->border_width;
				cmd->stroke_rr.color = n->border_color;
			}
		} else {
			ui_display_cmd_t *cmd = gea_embedded_ui_display_list_append();
			if (cmd) {
				cmd->type = CMD_STROKE_RECT;
				cmd->bx = x; cmd->by = y; cmd->bw = w; cmd->bh = h;
				cmd->stroke.x = x; cmd->stroke.y = y;
				cmd->stroke.w = w; cmd->stroke.h = h;
				cmd->stroke.color = n->border_color;
			}
		}
	}
}

void gea_embedded_ui_view_record_scrollbar(const ui_node_t *n)
{
	if (n->type != UI_TYPE_VIEW || n->overflow != 2) return;
	if (n->layout_h <= 0 || n->scroll_content_h <= n->layout_h) return;

	int track_h = n->layout_h - 12;
	if (track_h < 24) return;

	int thumb_h = (n->layout_h * track_h) / n->scroll_content_h;
	if (thumb_h < 24) thumb_h = 24;
	if (thumb_h > track_h) thumb_h = track_h;

	int max_scroll = n->scroll_content_h - n->layout_h;
	int thumb_y = n->layout_y + 6;
	if (max_scroll > 0)
		thumb_y += (n->scroll_y * (track_h - thumb_h)) / max_scroll;

	ui_display_cmd_t *cmd = gea_embedded_ui_display_list_append();
	if (!cmd) return;
	cmd->type = CMD_FILL_ROUNDED_RECT;
	cmd->bx = n->layout_x + n->layout_w - 7;
	cmd->by = thumb_y;
	cmd->bw = 3;
	cmd->bh = thumb_h;
	cmd->fill_rr.x = cmd->bx;
	cmd->fill_rr.y = cmd->by;
	cmd->fill_rr.w = cmd->bw;
	cmd->fill_rr.h = cmd->bh;
	cmd->fill_rr.tl = 2;
	cmd->fill_rr.tr = 2;
	cmd->fill_rr.br = 2;
	cmd->fill_rr.bl = 2;
	cmd->fill_rr.color = 0x8C72;
}

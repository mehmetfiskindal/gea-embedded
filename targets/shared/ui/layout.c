#include "internal.h"

#include <stdlib.h>

#if __has_include("esp_heap_caps.h")
#include "esp_heap_caps.h"
#endif

int gea_embedded_ui_clamp_size(int size, int min_s, int max_s)
{
	if (min_s > 0 && size < min_s) size = min_s;
	if (max_s != UI_UNSET && size > max_s) size = max_s;
	return size;
}

int gea_embedded_ui_collect_children(int parent, int *out, int max, int skip_abs)
{
	int n = 0;
	for (int c = gea_embedded_ui_nodes[parent].first_child; c >= 0; c = gea_embedded_ui_nodes[c].next_sibling) {
		if (gea_embedded_ui_nodes[c].display == 1) continue;
		if (skip_abs && gea_embedded_ui_nodes[c].position == 1) continue;
		if (n < max) out[n++] = c;
	}
	return n;
}

/* Flex line for wrapping */
typedef struct {
	int start, count;
	int main_size, cross_size;
} flex_line_t;

#ifndef UI_SCRATCH_DEPTH
#define UI_SCRATCH_DEPTH 16
#endif

static int layout_depth = 0;
static int *layout_children_scratch = NULL;
static flex_line_t *layout_lines_scratch = NULL;

static void *ui_scratch_alloc(size_t size)
{
#if __has_include("esp_heap_caps.h")
	void *ptr = heap_caps_malloc(size, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
	if (ptr) return ptr;
#endif
	return malloc(size);
}

static int *layout_children_for_depth(int depth)
{
	if (depth < 0 || depth >= UI_SCRATCH_DEPTH) return NULL;
	if (!layout_children_scratch)
		layout_children_scratch = ui_scratch_alloc(sizeof(int) * UI_SCRATCH_DEPTH * UI_MAX_CHILDREN);
	if (!layout_children_scratch) return NULL;
	return layout_children_scratch + depth * UI_MAX_CHILDREN;
}

static flex_line_t *layout_lines_for_depth(int depth)
{
	if (depth < 0 || depth >= UI_SCRATCH_DEPTH) return NULL;
	if (!layout_lines_scratch)
		layout_lines_scratch = ui_scratch_alloc(sizeof(flex_line_t) * UI_SCRATCH_DEPTH * UI_MAX_FLEX_LINES);
	if (!layout_lines_scratch) return NULL;
	return layout_lines_scratch + depth * UI_MAX_FLEX_LINES;
}

static void build_flex_lines(int child_count, const int *children, int is_row, int main_avail,
                             int wrap, int gap, flex_line_t *lines, int *line_count)
{
	int line_start = 0;
	int line_main = 0;
	int line_cross = 0;
	int gap_count = 0;
	*line_count = 0;

	for (int i = 0; i < child_count; i++) {
		int c = children[i];
		ui_node_t *cn = &gea_embedded_ui_nodes[c];
		int c_main = is_row
			? (cn->layout_w + cn->margin[1] + cn->margin[3])
			: (cn->layout_h + cn->margin[0] + cn->margin[2]);
		int c_cross = is_row
			? (cn->layout_h + cn->margin[0] + cn->margin[2])
			: (cn->layout_w + cn->margin[1] + cn->margin[3]);

		int with_gap = (gap_count > 0) ? gap : 0;

		if (wrap && line_main + c_main + with_gap > main_avail && gap_count > 0) {
			if (*line_count < UI_MAX_FLEX_LINES) {
				lines[*line_count].start = line_start;
				lines[*line_count].count = gap_count;
				lines[*line_count].main_size = line_main;
				lines[*line_count].cross_size = line_cross;
				(*line_count)++;
			}
			line_start = i;
			line_main = c_main;
			line_cross = c_cross;
			gap_count = 1;
		} else {
			line_main += c_main + with_gap;
			if (c_cross > line_cross) line_cross = c_cross;
			gap_count++;
		}
	}
	if (gap_count > 0 && *line_count < UI_MAX_FLEX_LINES) {
		lines[*line_count].start = line_start;
		lines[*line_count].count = gap_count;
		lines[*line_count].main_size = line_main;
		lines[*line_count].cross_size = line_cross;
		(*line_count)++;
	}
}

static void expand_cross_sizes(ui_node_t *n, int is_row, int pad_w, int pad_h,
                               flex_line_t *lines, int line_count, int only_if_definite)
{
	int has_definite_cross = is_row ? (n->height != UI_UNSET) : (n->width != UI_UNSET);
	if (only_if_definite && !has_definite_cross) return;

	int cross_avail = is_row ? pad_h : pad_w;
	if (line_count == 1) {
		lines[0].cross_size = cross_avail;
	} else if (line_count > 1) {
		int total_line_cross = 0;
		for (int li = 0; li < line_count; li++)
			total_line_cross += lines[li].cross_size;
		int extra = cross_avail - total_line_cross - (line_count - 1) * n->gap;
		if (extra > 0) {
			int per_line = extra / line_count;
			for (int li = 0; li < line_count; li++)
				lines[li].cross_size += per_line;
		}
	}
}

static void position_flex_lines(ui_node_t *n, const int *children, int is_row, int main_avail,
                                flex_line_t *lines, int line_count)
{
	int cross_offset = is_row ? n->padding[0] : n->padding[3];

	for (int li = 0; li < line_count; li++) {
		flex_line_t *line = &lines[li];
		int remaining = main_avail - line->main_size;
		if (remaining < 0) remaining = 0;

		int total_flex = 0;
		for (int i = 0; i < line->count; i++) {
			int c = children[line->start + i];
			total_flex += gea_embedded_ui_nodes[c].flex;
		}

		if (total_flex > 0 && remaining > 0) {
			for (int i = 0; i < line->count; i++) {
				int c = children[line->start + i];
				if (gea_embedded_ui_nodes[c].flex > 0) {
					int grow = (remaining * gea_embedded_ui_nodes[c].flex) / total_flex;
					if (is_row) gea_embedded_ui_nodes[c].layout_w += grow;
					else        gea_embedded_ui_nodes[c].layout_h += grow;
					gea_embedded_ui_reposition_children(c);
				}
			}
			remaining = 0;
		}

		int main_offset = is_row ? n->padding[3] : n->padding[0];
		int gap_space = 0;
		int item_count = line->count;

		switch (n->justify_content) {
		case 0: break; /* flex-start */
		case 1: main_offset += remaining / 2; break; /* center */
		case 2: main_offset += remaining; break; /* flex-end */
		case 3: /* space-between */
			if (item_count > 1)
				gap_space = remaining / (item_count - 1);
			break;
		case 4: /* space-around */
			if (item_count > 0) {
				int sp = remaining / item_count;
				main_offset += sp / 2;
				gap_space = sp;
			}
			break;
		}

		for (int i = 0; i < line->count; i++) {
			int c = children[line->start + i];
			ui_node_t *cn = &gea_embedded_ui_nodes[c];

			int c_main_margin_before = is_row ? cn->margin[3] : cn->margin[0];
			int c_main_margin_after  = is_row ? cn->margin[1] : cn->margin[2];
			int c_cross_margin_before = is_row ? cn->margin[0] : cn->margin[3];
			int c_cross_margin_after  = is_row ? cn->margin[2] : cn->margin[1];
			int c_cross_size = is_row ? cn->layout_h : cn->layout_w;
			int c_cross_total = c_cross_size + c_cross_margin_before + c_cross_margin_after;

			main_offset += c_main_margin_before;

			int align = cn->align_self >= 0 ? cn->align_self : n->align_items;
			int cross_pos = cross_offset + c_cross_margin_before;

			switch (align) {
			case 0: /* stretch */
				if (is_row) {
					if (cn->height == UI_UNSET) {
						cn->layout_h = line->cross_size - c_cross_margin_before - c_cross_margin_after;
						gea_embedded_ui_reposition_children(c);
					}
				} else {
					if (cn->width == UI_UNSET) {
						cn->layout_w = line->cross_size - c_cross_margin_before - c_cross_margin_after;
						gea_embedded_ui_reposition_children(c);
					}
				}
				break;
			case 1: /* flex-start */
				break;
			case 2: /* center */
				cross_pos += (line->cross_size - c_cross_total) / 2;
				break;
			case 3: /* flex-end */
				cross_pos += line->cross_size - c_cross_total;
				break;
			}

			if (is_row) {
				cn->layout_x = main_offset;
				cn->layout_y = cross_pos;
			} else {
				cn->layout_x = cross_pos;
				cn->layout_y = main_offset;
			}

			int c_main_size = is_row ? cn->layout_w : cn->layout_h;
			main_offset += c_main_size + c_main_margin_after + n->gap + gap_space;
		}

		cross_offset += line->cross_size + n->gap;
	}
}

static void measure_children(int child_count, const int *children, int is_row, int main_avail, int pad_w, int pad_h)
{
	for (int i = 0; i < child_count; i++) {
		int c = children[i];
		int c_avail_w = is_row ? main_avail : pad_w;
		int c_avail_h = is_row ? pad_h : main_avail;
		gea_embedded_ui_layout_node(c, c_avail_w, c_avail_h);
	}
}

static void update_scroll_content_size(ui_node_t *n)
{
	int content_h = n->layout_h;
	for (int c = n->first_child; c >= 0; c = gea_embedded_ui_nodes[c].next_sibling) {
		ui_node_t *cn = &gea_embedded_ui_nodes[c];
		if (cn->display == 1 || cn->position == 1) continue;
		int bottom = cn->layout_y + cn->layout_h + cn->margin[2] + n->padding[2];
		if (bottom > content_h) content_h = bottom;
	}
	n->scroll_content_h = content_h;

	int max_scroll = n->scroll_content_h - n->layout_h;
	if (max_scroll < 0) max_scroll = 0;
	if (n->scroll_y < 0) n->scroll_y = 0;
	if (n->scroll_y > max_scroll) n->scroll_y = max_scroll;
}

void gea_embedded_ui_layout_node(int id, int avail_w, int avail_h)
{
	ui_node_t *n = &gea_embedded_ui_nodes[id];
	if (n->display == 1) return;

	int content_w = (n->width != UI_UNSET) ? n->width : avail_w;
	int content_h = (n->height != UI_UNSET) ? n->height : avail_h;
	content_w -= n->margin[1] + n->margin[3];
	content_h -= n->margin[0] + n->margin[2];
	content_w = gea_embedded_ui_clamp_size(content_w, n->min_width, n->max_width);
	content_h = gea_embedded_ui_clamp_size(content_h, n->min_height, n->max_height);

	n->layout_w = content_w;
	n->layout_h = content_h;

	if (n->type == UI_TYPE_TEXT) {
		gea_embedded_ui_text_layout(id, avail_w);
		return;
	}

	if (n->type == UI_TYPE_IMAGE && n->image_id >= 0) {
		gea_embedded_ui_image_layout(id);
		return;
	}

	int pad_w = content_w - n->padding[1] - n->padding[3];
	int pad_h = content_h - n->padding[0] - n->padding[2];
	if (pad_w < 0) pad_w = 0;
	if (pad_h < 0) pad_h = 0;

	int is_row = (n->flex_direction == 1);
	int main_avail = is_row ? pad_w : pad_h;

	int depth = layout_depth++;
	if (depth >= UI_SCRATCH_DEPTH) {
		layout_depth--;
		return;
	}

	int *children = layout_children_for_depth(depth);
	flex_line_t *lines = layout_lines_for_depth(depth);
	if (!children || !lines) {
		layout_depth--;
		return;
	}

	int child_count = gea_embedded_ui_collect_children(id, children, UI_MAX_CHILDREN, 1);

	measure_children(child_count, children, is_row, main_avail, pad_w, pad_h);

	int line_count = 0;

	if (child_count == 0) {
		/* No children, auto-size if needed */
		if (n->width == UI_UNSET) n->layout_w = n->padding[1] + n->padding[3];
		if (n->height == UI_UNSET) n->layout_h = n->padding[0] + n->padding[2];
		n->layout_w = gea_embedded_ui_clamp_size(n->layout_w, n->min_width, n->max_width);
		n->layout_h = gea_embedded_ui_clamp_size(n->layout_h, n->min_height, n->max_height);
		n->scroll_content_h = n->layout_h;
		n->scroll_y = 0;
		goto position_absolute;
	}

	build_flex_lines(child_count, children, is_row, main_avail, n->flex_wrap, n->gap, lines, &line_count);
	expand_cross_sizes(n, is_row, pad_w, pad_h, lines, line_count, 1);
	position_flex_lines(n, children, is_row, main_avail, lines, line_count);

	/* Auto-size parent if dimensions were unset */
	if (n->height == UI_UNSET) {
		if (is_row) {
			int total_cross = 0;
			for (int li = 0; li < line_count; li++)
				total_cross += lines[li].cross_size + (li > 0 ? n->gap : 0);
			n->layout_h = total_cross + n->padding[0] + n->padding[2];
		} else {
			int max_main = 0;
			for (int li = 0; li < line_count; li++) {
				if (lines[li].main_size > max_main) max_main = lines[li].main_size;
			}
			n->layout_h = gea_embedded_ui_clamp_size(max_main + n->padding[0] + n->padding[2],
				n->min_height, n->max_height);
		}
	}
	if (n->width == UI_UNSET) {
		if (!is_row) {
			int total_cross = 0;
			for (int li = 0; li < line_count; li++)
				total_cross += lines[li].cross_size + (li > 0 ? n->gap : 0);
			n->layout_w = total_cross + n->padding[1] + n->padding[3];
		} else {
			int max_main = 0;
			for (int li = 0; li < line_count; li++) {
				if (lines[li].main_size > max_main) max_main = lines[li].main_size;
			}
			n->layout_w = gea_embedded_ui_clamp_size(max_main + n->padding[1] + n->padding[3],
				n->min_width, n->max_width);
		}
	}

	update_scroll_content_size(n);

position_absolute:
	/* Position absolute children */
	for (int c = n->first_child; c >= 0; c = gea_embedded_ui_nodes[c].next_sibling) {
		if (gea_embedded_ui_nodes[c].display == 1) continue;
		if (gea_embedded_ui_nodes[c].position != 1) continue;

		int c_avail_w = n->layout_w - n->padding[1] - n->padding[3];
		int c_avail_h = n->layout_h - n->padding[0] - n->padding[2];
		gea_embedded_ui_layout_node(c, c_avail_w, c_avail_h);

		ui_node_t *cn = &gea_embedded_ui_nodes[c];
		if (cn->pos_offsets[3] != UI_UNSET)
			cn->layout_x = n->padding[3] + cn->pos_offsets[3];
		else if (cn->pos_offsets[1] != UI_UNSET)
			cn->layout_x = n->layout_w - n->padding[1] - cn->layout_w - cn->pos_offsets[1];
		else
			cn->layout_x = n->padding[3];

		if (cn->pos_offsets[0] != UI_UNSET)
			cn->layout_y = n->padding[0] + cn->pos_offsets[0];
		else if (cn->pos_offsets[2] != UI_UNSET)
			cn->layout_y = n->layout_h - n->padding[2] - cn->layout_h - cn->pos_offsets[2];
		else
			cn->layout_y = n->padding[0];
	}

	/* Apply relative position offsets */
	for (int c = n->first_child; c >= 0; c = gea_embedded_ui_nodes[c].next_sibling) {
		if (gea_embedded_ui_nodes[c].position == 0) {
			if (gea_embedded_ui_nodes[c].pos_offsets[0] != UI_UNSET) gea_embedded_ui_nodes[c].layout_y += gea_embedded_ui_nodes[c].pos_offsets[0];
			if (gea_embedded_ui_nodes[c].pos_offsets[3] != UI_UNSET) gea_embedded_ui_nodes[c].layout_x += gea_embedded_ui_nodes[c].pos_offsets[3];
		}
	}

	layout_depth--;
}

void gea_embedded_ui_reposition_children(int id)
{
	ui_node_t *n = &gea_embedded_ui_nodes[id];
	if (n->type == UI_TYPE_TEXT || n->type == UI_TYPE_IMAGE) return;

	int pad_w = n->layout_w - n->padding[1] - n->padding[3];
	int pad_h = n->layout_h - n->padding[0] - n->padding[2];
	if (pad_w < 0) pad_w = 0;
	if (pad_h < 0) pad_h = 0;

	int is_row = (n->flex_direction == 1);
	int main_avail = is_row ? pad_w : pad_h;

	int depth = layout_depth++;
	if (depth >= UI_SCRATCH_DEPTH) {
		layout_depth--;
		return;
	}

	int *children = layout_children_for_depth(depth);
	flex_line_t *lines = layout_lines_for_depth(depth);
	if (!children || !lines) {
		layout_depth--;
		return;
	}

	int child_count = gea_embedded_ui_collect_children(id, children, UI_MAX_CHILDREN, 1);
	if (child_count == 0) {
		layout_depth--;
		return;
	}

	measure_children(child_count, children, is_row, main_avail, pad_w, pad_h);

	int line_count = 0;
	build_flex_lines(child_count, children, is_row, main_avail, n->flex_wrap, n->gap, lines, &line_count);
	expand_cross_sizes(n, is_row, pad_w, pad_h, lines, line_count, 0);
	position_flex_lines(n, children, is_row, main_avail, lines, line_count);
	layout_depth--;
}

void gea_embedded_ui_resolve_absolute_coords(int id, int parent_x, int parent_y)
{
	ui_node_t *n = &gea_embedded_ui_nodes[id];
	n->layout_x += parent_x;
	n->layout_y += parent_y;

	int child_parent_y = n->layout_y;
	if (n->overflow == 2) child_parent_y -= n->scroll_y;

	for (int c = n->first_child; c >= 0; c = gea_embedded_ui_nodes[c].next_sibling)
		gea_embedded_ui_resolve_absolute_coords(c, n->layout_x, child_parent_y);
}

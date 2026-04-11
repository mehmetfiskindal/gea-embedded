#include "internal.h"
#include "display.h"
#include <string.h>

ui_node_t gea_embedded_ui_nodes[UI_MAX_NODES];
int gea_embedded_ui_node_count = 0;
int gea_embedded_ui_mounted_root = -1;
int gea_embedded_ui_mounted_w = 0;
int gea_embedded_ui_mounted_h = 0;
static int gea_embedded_ui_last_frame_ms = 0;
static uint64_t mirror_dirty_scroll_nodes[UI_SCROLL_DIRTY_WORD_COUNT];
static int mirror_dirty_scroll_any = 0;

static void node_init(ui_node_t *n, int type)
{
	memset(n, 0, sizeof(*n));
	n->type = type;
	n->display = 0;
	n->flex_direction = 0;
	n->flex_wrap = 0;
	n->justify_content = 0;
	n->align_items = 0;
	n->align_self = -1;
	n->gap = 0;
	n->width = UI_UNSET;
	n->height = UI_UNSET;
	n->min_width = 0;
	n->min_height = 0;
	n->max_width = UI_UNSET;
	n->max_height = UI_UNSET;
	n->flex = 0;
	for (int i = 0; i < 4; i++) {
		n->padding[i] = 0;
		n->margin[i] = 0;
		n->pos_offsets[i] = UI_UNSET;
		n->border_radius[i] = 0;
	}
	n->position = 0;
	n->z_index = 0;
	n->bg_color = 0;
	n->has_bg = 0;
	n->active_bg_color = 0;
	n->has_active_bg = 0;
	n->text_color = 0xFFFF;
	n->opacity = 255;
	n->blink_interval_ms = 0;
	n->blink_started_ms = 0;
	n->blink_visible = 1;
	n->border_width = 0;
	n->border_color = 0xFFFF;
	n->transform_rotate = 0;
	n->transform_origin_x = 500;
	n->transform_origin_y = 500;
	n->font_id = -1;
	n->font_size = 0;
	n->text_align = 0;
	n->overflow = 0;
	n->scroll_y = 0;
	n->scroll_content_h = 0;
	n->text[0] = '\0';
	n->image_id = -1;
	n->image_fit = 0;
	n->parent = -1;
	n->first_child = -1;
	n->last_child = -1;
	n->next_sibling = -1;
	n->prev_sibling = -1;
	n->layout_x = 0;
	n->layout_y = 0;
	n->layout_w = 0;
	n->layout_h = 0;
	n->on_press_id = -1;
	n->prev_layout_x = 0;
	n->prev_layout_y = 0;
	n->prev_layout_w = 0;
	n->prev_layout_h = 0;
	n->prev_transform_rotate = 0;
	n->prev_transform_origin_x = 500;
	n->prev_transform_origin_y = 500;
	n->dirty = 0;
}

void gea_embedded_ui_clear(void)
{
	gea_embedded_ui_node_count = 0;
	gea_embedded_ui_mounted_root = -1;
	gea_embedded_ui_mounted_w = 0;
	gea_embedded_ui_mounted_h = 0;
	gea_embedded_ui_mirror_clear_scroll_dirty();
}

int gea_embedded_ui_create_node(int type)
{
	if (gea_embedded_ui_node_count >= UI_MAX_NODES) return -1;
	int id = gea_embedded_ui_node_count++;
	node_init(&gea_embedded_ui_nodes[id], type);
	return id;
}

int gea_embedded_ui_scroll_max_y(const ui_node_t *n)
{
	int max_y = n->scroll_content_h - n->layout_h;
	return max_y > 0 ? max_y : 0;
}

void gea_embedded_ui_mark_scroll_dirty(int node)
{
	if (node < 0 || node >= UI_MAX_NODES) return;
	mirror_dirty_scroll_nodes[node / 64] |= (1ull << (node % 64));
	mirror_dirty_scroll_any = 1;
}

int gea_embedded_ui_mirror_scroll_dirty_any(void)
{
	return mirror_dirty_scroll_any;
}

void gea_embedded_ui_mirror_copy_scroll_dirty(uint64_t *dst, int word_count)
{
	if (!dst || word_count <= 0) return;
	for (int i = 0; i < word_count; i++)
		dst[i] = i < UI_SCROLL_DIRTY_WORD_COUNT ? mirror_dirty_scroll_nodes[i] : 0;
}

void gea_embedded_ui_mirror_clear_scroll_dirty(void)
{
	for (int i = 0; i < UI_SCROLL_DIRTY_WORD_COUNT; i++)
		mirror_dirty_scroll_nodes[i] = 0;
	mirror_dirty_scroll_any = 0;
}

int gea_embedded_ui_mirror_node_is_scrollable(int node)
{
	if (node < 0 || node >= gea_embedded_ui_node_count) return 0;
	ui_node_t *n = &gea_embedded_ui_nodes[node];
	return n->type == UI_TYPE_VIEW && n->overflow == 2 && gea_embedded_ui_scroll_max_y(n) > 0;
}

int gea_embedded_ui_mirror_get_scroll_y(int node)
{
	if (node < 0 || node >= gea_embedded_ui_node_count) return 0;
	return gea_embedded_ui_nodes[node].scroll_y;
}

void gea_embedded_ui_mirror_set_scroll_y(int node, int scroll_y)
{
	if (node < 0 || node >= gea_embedded_ui_node_count) return;
	ui_node_t *n = &gea_embedded_ui_nodes[node];
	if (n->type != UI_TYPE_VIEW || n->overflow != 2) return;

	int max_y = gea_embedded_ui_scroll_max_y(n);
	if (scroll_y < 0) scroll_y = 0;
	if (scroll_y > max_y) scroll_y = max_y;
	if (scroll_y == n->scroll_y) return;

	n->scroll_y = scroll_y;
	n->dirty = 1;
	gea_embedded_ui_mark_scroll_dirty(node);
}

void gea_embedded_ui_set_parent(int child, int parent)
{
	if (child < 0 || child >= gea_embedded_ui_node_count || parent < 0 || parent >= gea_embedded_ui_node_count) return;
	gea_embedded_ui_nodes[child].parent = parent;
	gea_embedded_ui_nodes[child].next_sibling = -1;
	gea_embedded_ui_nodes[child].prev_sibling = gea_embedded_ui_nodes[parent].last_child;
	if (gea_embedded_ui_nodes[parent].last_child >= 0)
		gea_embedded_ui_nodes[gea_embedded_ui_nodes[parent].last_child].next_sibling = child;
	else
		gea_embedded_ui_nodes[parent].first_child = child;
	gea_embedded_ui_nodes[parent].last_child = child;
}

void gea_embedded_ui_set_style(int node, int prop, int value)
{
	if (node < 0 || node >= gea_embedded_ui_node_count) return;
	ui_node_t *n = &gea_embedded_ui_nodes[node];
	n->dirty = 1;
	switch (prop) {
	case UI_PROP_DISPLAY:          n->display = value; break;
	case UI_PROP_FLEX_DIRECTION:   n->flex_direction = value; break;
	case UI_PROP_FLEX_WRAP:        n->flex_wrap = value; break;
	case UI_PROP_JUSTIFY_CONTENT:  n->justify_content = value; break;
	case UI_PROP_ALIGN_ITEMS:      n->align_items = value; break;
	case UI_PROP_ALIGN_SELF:       n->align_self = value; break;
	case UI_PROP_GAP:              n->gap = value; break;
	case UI_PROP_WIDTH:            n->width = value; break;
	case UI_PROP_HEIGHT:           n->height = value; break;
	case UI_PROP_MIN_WIDTH:        n->min_width = value; break;
	case UI_PROP_MIN_HEIGHT:       n->min_height = value; break;
	case UI_PROP_MAX_WIDTH:        n->max_width = value; break;
	case UI_PROP_MAX_HEIGHT:       n->max_height = value; break;
	case UI_PROP_FLEX:             n->flex = value; break;
	case UI_PROP_PADDING_TOP:      n->padding[0] = value; break;
	case UI_PROP_PADDING_RIGHT:    n->padding[1] = value; break;
	case UI_PROP_PADDING_BOTTOM:   n->padding[2] = value; break;
	case UI_PROP_PADDING_LEFT:     n->padding[3] = value; break;
	case UI_PROP_MARGIN_TOP:       n->margin[0] = value; break;
	case UI_PROP_MARGIN_RIGHT:     n->margin[1] = value; break;
	case UI_PROP_MARGIN_BOTTOM:    n->margin[2] = value; break;
	case UI_PROP_MARGIN_LEFT:      n->margin[3] = value; break;
	case UI_PROP_POSITION:         n->position = value; break;
	case UI_PROP_TOP:              n->pos_offsets[0] = value; break;
	case UI_PROP_RIGHT:            n->pos_offsets[1] = value; break;
	case UI_PROP_BOTTOM:           n->pos_offsets[2] = value; break;
	case UI_PROP_LEFT:             n->pos_offsets[3] = value; break;
	case UI_PROP_Z_INDEX:          n->z_index = value; break;
	case UI_PROP_BG_COLOR:         n->bg_color = (uint16_t)value; break;
	case UI_PROP_HAS_BG:           n->has_bg = value; break;
	case UI_PROP_ACTIVE_BG_COLOR:  n->active_bg_color = (uint16_t)value; break;
	case UI_PROP_HAS_ACTIVE_BG:    n->has_active_bg = value; break;
	case UI_PROP_COLOR:            n->text_color = (uint16_t)value; break;
	case UI_PROP_OPACITY:          n->opacity = (uint8_t)value; break;
	case UI_PROP_BLINK_INTERVAL:
		n->blink_interval_ms = value > 0 ? value : 0;
		n->blink_started_ms = gea_embedded_ui_last_frame_ms;
		n->blink_visible = 1;
		break;
	case UI_PROP_BORDER_WIDTH:     n->border_width = value; break;
	case UI_PROP_BORDER_COLOR:     n->border_color = (uint16_t)value; break;
	case UI_PROP_BORDER_RADIUS_TL: n->border_radius[0] = value; break;
	case UI_PROP_BORDER_RADIUS_TR: n->border_radius[1] = value; break;
	case UI_PROP_BORDER_RADIUS_BR: n->border_radius[2] = value; break;
	case UI_PROP_BORDER_RADIUS_BL: n->border_radius[3] = value; break;
	case UI_PROP_FONT_ID:          n->font_id = value; break;
	case UI_PROP_FONT_SIZE:        n->font_size = value; break;
	case UI_PROP_TEXT_ALIGN:       n->text_align = value; break;
	case UI_PROP_OVERFLOW:         n->overflow = value; break;
	case UI_PROP_IMAGE_ID:         n->image_id = value; break;
	case UI_PROP_IMAGE_FIT:        n->image_fit = value; break;
	case UI_PROP_TRANSFORM_ROTATE: n->transform_rotate = value; break;
	case UI_PROP_TRANSFORM_ORIGIN_X: n->transform_origin_x = value; break;
	case UI_PROP_TRANSFORM_ORIGIN_Y: n->transform_origin_y = value; break;
	default: break;
	}
}

void gea_embedded_ui_remove_node(int id)
{
	if (id < 0 || id >= gea_embedded_ui_node_count) return;
	ui_node_t *n = &gea_embedded_ui_nodes[id];
	n->dirty = 1;
	if (n->parent >= 0) {
		ui_node_t *p = &gea_embedded_ui_nodes[n->parent];
		p->dirty = 1;
		if (p->first_child == id) p->first_child = n->next_sibling;
		if (p->last_child == id) p->last_child = n->prev_sibling;
	}
	if (n->prev_sibling >= 0) gea_embedded_ui_nodes[n->prev_sibling].next_sibling = n->next_sibling;
	if (n->next_sibling >= 0) gea_embedded_ui_nodes[n->next_sibling].prev_sibling = n->prev_sibling;
	n->display = 1;
	n->parent = -1;
	n->prev_sibling = -1;
	n->next_sibling = -1;
}

void gea_embedded_ui_set_on_press(int node, int callback_id)
{
	if (node < 0 || node >= gea_embedded_ui_node_count) return;
	gea_embedded_ui_nodes[node].on_press_id = callback_id;
}

static void snapshot_layout(void)
{
	for (int i = 0; i < gea_embedded_ui_node_count; i++) {
		gea_embedded_ui_nodes[i].prev_layout_x = gea_embedded_ui_nodes[i].layout_x;
		gea_embedded_ui_nodes[i].prev_layout_y = gea_embedded_ui_nodes[i].layout_y;
		gea_embedded_ui_nodes[i].prev_layout_w = gea_embedded_ui_nodes[i].layout_w;
		gea_embedded_ui_nodes[i].prev_layout_h = gea_embedded_ui_nodes[i].layout_h;
		gea_embedded_ui_nodes[i].prev_transform_rotate = gea_embedded_ui_nodes[i].transform_rotate;
		gea_embedded_ui_nodes[i].prev_transform_origin_x = gea_embedded_ui_nodes[i].transform_origin_x;
		gea_embedded_ui_nodes[i].prev_transform_origin_y = gea_embedded_ui_nodes[i].transform_origin_y;
		gea_embedded_ui_nodes[i].dirty = 0;
	}
}

static void mark_layout_changes_dirty(void)
{
	for (int i = 0; i < gea_embedded_ui_node_count; i++) {
		ui_node_t *n = &gea_embedded_ui_nodes[i];
		if (n->layout_x != n->prev_layout_x ||
		    n->layout_y != n->prev_layout_y ||
		    n->layout_w != n->prev_layout_w ||
		    n->layout_h != n->prev_layout_h)
			n->dirty = 1;
	}
}

static int absolute_leaf_refresh_mode(void)
{
	int has_dirty = 0;
	for (int i = 0; i < gea_embedded_ui_node_count; i++) {
		ui_node_t *n = &gea_embedded_ui_nodes[i];
		if (!n->dirty) continue;
		has_dirty = 1;
		if (n->type != UI_TYPE_VIEW || n->display == 1 || n->position != 1) return 0;
		if (n->parent < 0 || n->first_child >= 0) return 0;
		if (n->width == UI_UNSET || n->height == UI_UNSET) return 0;
		if (n->layout_w != n->width || n->layout_h != n->height) return 0;
		if (n->min_width != 0 || n->min_height != 0 || n->max_width != UI_UNSET || n->max_height != UI_UNSET) return 0;
		if (n->flex != 0 || n->padding[0] || n->padding[1] || n->padding[2] || n->padding[3]) return 0;
		if (n->margin[0] || n->margin[1] || n->margin[2] || n->margin[3]) return 0;
		if (n->transform_rotate != 0 || n->prev_transform_rotate != 0) return 0;
		if (n->transform_origin_x != n->prev_transform_origin_x || n->transform_origin_y != n->prev_transform_origin_y) return 0;
	}
	return has_dirty ? 1 : -1;
}

static void refresh_absolute_leaf_positions(void)
{
	for (int i = 0; i < gea_embedded_ui_node_count; i++) {
		ui_node_t *n = &gea_embedded_ui_nodes[i];
		if (!n->dirty) continue;
		ui_node_t *p = &gea_embedded_ui_nodes[n->parent];
		if (n->pos_offsets[3] != UI_UNSET)
			n->layout_x = p->layout_x + p->padding[3] + n->pos_offsets[3];
		else if (n->pos_offsets[1] != UI_UNSET)
			n->layout_x = p->layout_x + p->layout_w - p->padding[1] - n->layout_w - n->pos_offsets[1];
		else
			n->layout_x = p->layout_x + p->padding[3];

		int parent_y = p->layout_y;
		if (p->overflow == 2) parent_y -= p->scroll_y;
		if (n->pos_offsets[0] != UI_UNSET)
			n->layout_y = parent_y + p->padding[0] + n->pos_offsets[0];
		else if (n->pos_offsets[2] != UI_UNSET)
			n->layout_y = parent_y + p->layout_h - p->padding[2] - n->layout_h - n->pos_offsets[2];
		else
			n->layout_y = parent_y + p->padding[0];
	}
}

void gea_embedded_ui_mount(int root, int width, int height)
{
	if (root < 0 || root >= gea_embedded_ui_node_count) return;

	gea_embedded_ui_mounted_root = root;
	gea_embedded_ui_mounted_w = width;
	gea_embedded_ui_mounted_h = height;

	gea_embedded_display_clear();
	gea_embedded_display_reset_clip();
	gea_embedded_display_set_alpha(255);

	gea_embedded_ui_layout_node(root, width, height);
	gea_embedded_ui_resolve_absolute_coords(root, 0, 0);
	mark_layout_changes_dirty();

	gea_embedded_ui_display_list_clear();
	gea_embedded_ui_record_node(root, 255);
	gea_embedded_ui_replay_display_list();

	gea_embedded_display_flush();
	snapshot_layout();
}

void gea_embedded_ui_refresh(int root, int width, int height)
{
	if (root < 0 || root >= gea_embedded_ui_node_count) return;

	int layout_mode = absolute_leaf_refresh_mode();
	if (layout_mode < 0) return;

	if (layout_mode > 0) {
		refresh_absolute_leaf_positions();
	} else {
		gea_embedded_ui_layout_node(root, width, height);
		gea_embedded_ui_resolve_absolute_coords(root, 0, 0);
	}

	gea_embedded_ui_display_list_clear();
	gea_embedded_ui_record_node(root, 255);
	int direct_replay = layout_mode > 0 && gea_embedded_ui_can_replay_direct_dirty_regions(width, height);

	gea_embedded_display_reset_clip();
	gea_embedded_display_set_alpha(255);

	for (int i = 0; i < gea_embedded_ui_node_count; i++) {
		if (!gea_embedded_ui_nodes[i].dirty) continue;
		ui_node_t *n = &gea_embedded_ui_nodes[i];

		int dr_x0 = width, dr_y0 = height, dr_x1 = -1, dr_y1 = -1;

		if (n->prev_layout_w > 0 && n->prev_layout_h > 0) {
			gea_embedded_ui_transformed_bounds(n, 1, &dr_x0, &dr_y0, &dr_x1, &dr_y1);
		}

		if (n->layout_w > 0 && n->layout_h > 0) {
			int nx0, ny0, nx1, ny1;
			gea_embedded_ui_transformed_bounds(n, 0, &nx0, &ny0, &nx1, &ny1);
			if (nx0 < dr_x0) dr_x0 = nx0;
			if (ny0 < dr_y0) dr_y0 = ny0;
			if (nx1 > dr_x1) dr_x1 = nx1;
			if (ny1 > dr_y1) dr_y1 = ny1;
		}

		if (dr_x0 > dr_x1 || dr_y0 > dr_y1) continue;

		if (dr_x0 < 0) dr_x0 = 0;
		if (dr_y0 < 0) dr_y0 = 0;
		if (dr_x1 >= width) dr_x1 = width - 1;
		if (dr_y1 >= height) dr_y1 = height - 1;

		gea_embedded_display_push_clip(dr_x0, dr_y0, dr_x1 - dr_x0 + 1, dr_y1 - dr_y0 + 1);
		if (direct_replay)
			gea_embedded_ui_replay_direct_dirty_region(dr_x0, dr_y0, dr_x1, dr_y1);
		else
			gea_embedded_ui_replay_display_list();
		gea_embedded_display_pop_clip();
		gea_embedded_display_flush();
	}

	snapshot_layout();
}

void gea_embedded_ui_frame(int timestamp_ms)
{
	if (gea_embedded_ui_mounted_root < 0) return;
	if (timestamp_ms < 0) timestamp_ms = 0;
	gea_embedded_ui_last_frame_ms = timestamp_ms;

	int changed = 0;
	for (int i = 0; i < gea_embedded_ui_node_count; i++) {
		ui_node_t *n = &gea_embedded_ui_nodes[i];
		if (n->blink_interval_ms <= 0) {
			if (!n->blink_visible) {
				n->blink_visible = 1;
				n->dirty = 1;
				changed = 1;
			}
			continue;
		}

		int elapsed = timestamp_ms - n->blink_started_ms;
		if (elapsed < 0) elapsed = 0;
		int visible = ((elapsed / n->blink_interval_ms) % 2) == 0;
		if (n->blink_visible == visible) continue;
		n->blink_visible = visible;
		n->dirty = 1;
		changed = 1;
	}

	if (changed)
		gea_embedded_ui_refresh(gea_embedded_ui_mounted_root, gea_embedded_ui_mounted_w, gea_embedded_ui_mounted_h);
}

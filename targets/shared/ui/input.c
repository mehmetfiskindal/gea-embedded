#include "internal.h"

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

static int hit_test_node_id(int id, int x, int y)
{
	ui_node_t *n = &gea_embedded_ui_nodes[id];
	if (n->display == 1) return -1;

	int inside = x >= n->layout_x && x < n->layout_x + n->layout_w &&
	             y >= n->layout_y && y < n->layout_y + n->layout_h;
	if (!inside && n->overflow != 1)
		return -1;

	/* Check children in reverse z-order (front to back). */
	int children[UI_MAX_CHILDREN];
	int child_count = gea_embedded_ui_collect_children(id, children, UI_MAX_CHILDREN, 0);
	sort_children_by_z_index(children, child_count);

	for (int i = child_count - 1; i >= 0; i--) {
		int result = hit_test_node_id(children[i], x, y);
		if (result >= 0) return result;
	}

	if (!inside) return -1;

	if (n->on_press_id >= 0)
		return id;

	return -1;
}

int gea_embedded_ui_hit_test(int x, int y)
{
	if (gea_embedded_ui_node_count == 0) return -1;
	int node_id = hit_test_node_id(0, x, y);
	if (node_id < 0) return -1;
	return gea_embedded_ui_nodes[node_id].on_press_id;
}

static int active_touch_node = -1;
static uint16_t saved_bg_color = 0;
static int8_t saved_has_bg = 0;
static int active_scroll_node = -1;
static int scroll_last_y = 0;

static uint16_t lighten_rgb565(uint16_t color)
{
	int r = (color >> 11) & 0x1F;
	int g = (color >> 5) & 0x3F;
	int b = color & 0x1F;

	r += ((31 - r) * 6) / 32;
	g += ((63 - g) * 6) / 32;
	b += ((31 - b) * 6) / 32;

	return (uint16_t)((r << 11) | (g << 5) | b);
}

static void refresh_mounted_tree(void)
{
	if (gea_embedded_ui_mounted_root >= 0)
		gea_embedded_ui_refresh(gea_embedded_ui_mounted_root, gea_embedded_ui_mounted_w, gea_embedded_ui_mounted_h);
}

static int find_scroll_node_id(int id, int x, int y)
{
	ui_node_t *n = &gea_embedded_ui_nodes[id];
	if (n->display == 1) return -1;

	int inside = x >= n->layout_x && x < n->layout_x + n->layout_w &&
	             y >= n->layout_y && y < n->layout_y + n->layout_h;
	if (!inside && n->overflow != 1)
		return -1;

	int children[UI_MAX_CHILDREN];
	int child_count = gea_embedded_ui_collect_children(id, children, UI_MAX_CHILDREN, 0);
	sort_children_by_z_index(children, child_count);

	for (int i = child_count - 1; i >= 0; i--) {
		int result = find_scroll_node_id(children[i], x, y);
		if (result >= 0) return result;
	}

	if (!inside) return -1;

	if (n->overflow == 2 && gea_embedded_ui_scroll_max_y(n) > 0)
		return id;

	return -1;
}

static int clear_active_touch(void)
{
	if (active_touch_node < 0) return 0;

	gea_embedded_ui_nodes[active_touch_node].bg_color = saved_bg_color;
	gea_embedded_ui_nodes[active_touch_node].has_bg = saved_has_bg;
	gea_embedded_ui_nodes[active_touch_node].dirty = 1;
	active_touch_node = -1;
	return 1;
}

void gea_embedded_ui_touch_down(int x, int y)
{
	int cleared = clear_active_touch();
	active_scroll_node = gea_embedded_ui_node_count == 0 ? -1 : find_scroll_node_id(0, x, y);
	scroll_last_y = y;

	if (gea_embedded_ui_node_count == 0) {
		if (cleared) refresh_mounted_tree();
		return;
	}
	int node_id = hit_test_node_id(0, x, y);
	if (node_id < 0) {
		if (cleared) refresh_mounted_tree();
		return;
	}

	ui_node_t *n = &gea_embedded_ui_nodes[node_id];
	if (!n->has_active_bg && !n->has_bg) {
		if (cleared) refresh_mounted_tree();
		return;
	}

	active_touch_node = node_id;
	saved_bg_color = n->bg_color;
	saved_has_bg = n->has_bg;
	n->bg_color = n->has_active_bg ? n->active_bg_color : lighten_rgb565(n->bg_color);
	n->has_bg = 1;
	n->dirty = 1;

	refresh_mounted_tree();
}

int gea_embedded_ui_touch_move(int x, int y)
{
	(void)x;
	if (active_scroll_node < 0 || active_scroll_node >= gea_embedded_ui_node_count) {
		scroll_last_y = y;
		return 0;
	}

	ui_node_t *n = &gea_embedded_ui_nodes[active_scroll_node];
	int dy = y - scroll_last_y;
	scroll_last_y = y;
	if (dy == 0) return 0;

	int next = n->scroll_y - dy;
	int max_y = gea_embedded_ui_scroll_max_y(n);
	if (next < 0) next = 0;
	if (next > max_y) next = max_y;
	if (next == n->scroll_y) return 0;

	int cleared = clear_active_touch();
	(void)cleared;
	n->scroll_y = next;
	n->dirty = 1;
	gea_embedded_ui_mark_scroll_dirty(active_scroll_node);
	refresh_mounted_tree();
	return 1;
}

int gea_embedded_ui_touch_up(void)
{
	active_scroll_node = -1;
	if (active_touch_node >= 0) {
		clear_active_touch();
		refresh_mounted_tree();
	}
	return -1;
}

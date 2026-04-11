#include "internal.h"
#include "image.h"

int gea_embedded_ui_create_image(void)
{
	return gea_embedded_ui_create_node(UI_TYPE_IMAGE);
}

void gea_embedded_ui_image_layout(int id)
{
	ui_node_t *n = &gea_embedded_ui_nodes[id];
	int iw = gea_embedded_image_width(n->image_id);
	int ih = gea_embedded_image_height(n->image_id);

	if (n->width == UI_UNSET && iw > 0) n->layout_w = iw;
	if (n->height == UI_UNSET && ih > 0) n->layout_h = ih;
	n->layout_w = gea_embedded_ui_clamp_size(n->layout_w, n->min_width, n->max_width);
	n->layout_h = gea_embedded_ui_clamp_size(n->layout_h, n->min_height, n->max_height);
}

static void resolve_image_fit(const ui_node_t *n, int iw, int ih,
                              int *dx, int *dy, int *dw, int *dh)
{
	int x = n->layout_x;
	int y = n->layout_y;
	int w = n->layout_w;
	int h = n->layout_h;

	*dw = w;
	*dh = h;
	*dx = x;
	*dy = y;

	if (n->image_fit == 1 || n->image_fit == 4) {
		int sw = (iw * h) / ih;
		int sh = (ih * w) / iw;
		if (sw <= w) { *dw = sw; *dh = h; }
		else         { *dw = w;  *dh = sh; }
		if (n->image_fit == 4 && *dw >= iw && *dh >= ih) {
			*dw = iw;
			*dh = ih;
		}
		*dx = x + (w - *dw) / 2;
		*dy = y + (h - *dh) / 2;
	} else if (n->image_fit == 2) {
		int sw = (iw * h) / ih;
		int sh = (ih * w) / iw;
		if (sw >= w) { *dw = sw; *dh = h; }
		else         { *dw = w;  *dh = sh; }
		*dx = x + (w - *dw) / 2;
		*dy = y + (h - *dh) / 2;
	} else if (n->image_fit == 3) {
		*dw = iw;
		*dh = ih;
		*dx = x + (w - *dw) / 2;
		*dy = y + (h - *dh) / 2;
	}
}

void gea_embedded_ui_image_record(const ui_node_t *n)
{
	if (n->type != UI_TYPE_IMAGE || n->image_id < 0) return;

	const uint16_t *pixels = gea_embedded_image_current_pixels(n->image_id);
	if (!pixels) return;

	int iw = gea_embedded_image_width(n->image_id);
	int ih = gea_embedded_image_height(n->image_id);
	if (iw <= 0 || ih <= 0) return;

	int x = n->layout_x;
	int y = n->layout_y;
	int w = n->layout_w;
	int h = n->layout_h;

	if (iw == w && ih == h) {
		ui_display_cmd_t *cmd = gea_embedded_ui_display_list_append();
		if (!cmd) return;
		cmd->type = CMD_BLIT_IMAGE;
		cmd->bx = x; cmd->by = y; cmd->bw = w; cmd->bh = h;
		cmd->blit.pixels = pixels;
		cmd->blit.src_w = iw;
		cmd->blit.src_h = ih;
		cmd->blit.dx = x;
		cmd->blit.dy = y;
		return;
	}

	int dx, dy, dw, dh;
	resolve_image_fit(n, iw, ih, &dx, &dy, &dw, &dh);

	ui_display_cmd_t *cmd = gea_embedded_ui_display_list_append();
	if (!cmd) return;
	cmd->type = CMD_BLIT_IMAGE_SCALED;
	cmd->bx = dx; cmd->by = dy; cmd->bw = dw; cmd->bh = dh;
	cmd->blit_s.pixels = pixels;
	cmd->blit_s.src_w = iw;
	cmd->blit_s.src_h = ih;
	cmd->blit_s.dx = dx;
	cmd->blit_s.dy = dy;
	cmd->blit_s.dw = dw;
	cmd->blit_s.dh = dh;
}

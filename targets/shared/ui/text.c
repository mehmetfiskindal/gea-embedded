#include "internal.h"
#include "display.h"
#include "raster.h"
#if __has_include("gea_embedded_font_generated.h")
#include "gea_embedded_font_generated.h"
#endif
#include <string.h>

int gea_embedded_ui_create_text(void)
{
	return gea_embedded_ui_create_node(UI_TYPE_TEXT);
}

void gea_embedded_ui_set_text(int node, const char *text)
{
	if (node < 0 || node >= gea_embedded_ui_node_count || !text) return;
	if (strcmp(gea_embedded_ui_nodes[node].text, text) == 0) return;
	gea_embedded_ui_nodes[node].dirty = 1;
	strncpy(gea_embedded_ui_nodes[node].text, text, sizeof(gea_embedded_ui_nodes[node].text) - 1);
	gea_embedded_ui_nodes[node].text[sizeof(gea_embedded_ui_nodes[node].text) - 1] = '\0';
}

static void measure_text(const char *text, int max_width, float scale,
                         int *out_w, int *out_h)
{
	if (!text || !text[0]) {
		*out_w = 0;
		*out_h = 0;
		return;
	}

	int gw = (int)(FONT_W * scale + 0.5f);
	int gh = (int)(FONT_H * scale + 0.5f);
	if (gw < 1) gw = 1;
	if (gh < 1) gh = 1;
	int line_w = 0, max_line_w = 0, lines = 1;

	if (max_width <= 0) max_width = 32767;

	for (const char *p = text; *p; p++) {
		if (*p == '\n') {
			if (line_w > max_line_w) max_line_w = line_w;
			line_w = 0;
			lines++;
			continue;
		}
		int next_w = line_w + gw;
		if (next_w > max_width && line_w > 0) {
			if (line_w > max_line_w) max_line_w = line_w;
			line_w = gw;
			lines++;
		} else {
			line_w = next_w;
		}
	}
	if (line_w > max_line_w) max_line_w = line_w;
	*out_w = max_line_w;
	*out_h = lines * gh;
}

static void measure_text_ex(const char *text, int max_width, int font_id, int font_size,
                            int *out_w, int *out_h)
{
#ifdef GEA_EMBEDDED_HAS_GENERATED_FONTS
	if (font_id >= 0) {
		gea_embedded_raster_measure_text_font(text, max_width, font_id, out_w, out_h);
		return;
	}
#endif
	float s = font_size > 0 ? (float)font_size / FONT_H : 1.0f;
	measure_text(text, max_width, s, out_w, out_h);
}

void gea_embedded_ui_text_layout(int id, int avail_w)
{
	ui_node_t *n = &gea_embedded_ui_nodes[id];
	int tw, th;

	int content_w = avail_w - n->padding[1] - n->padding[3]
	              - n->margin[1] - n->margin[3];
	if (n->width != UI_UNSET) content_w = n->width - n->padding[1] - n->padding[3];
	if (content_w < 0) content_w = 0;

	measure_text_ex(n->text, content_w, n->font_id, n->font_size, &tw, &th);

	n->layout_w = tw + n->padding[1] + n->padding[3];
	n->layout_h = th + n->padding[0] + n->padding[2];

	if (n->width != UI_UNSET) n->layout_w = n->width;
	if (n->height != UI_UNSET) n->layout_h = n->height;

	n->layout_w = gea_embedded_ui_clamp_size(n->layout_w, n->min_width, n->max_width);
	n->layout_h = gea_embedded_ui_clamp_size(n->layout_h, n->min_height, n->max_height);
}

void gea_embedded_ui_text_draw_wrapped(const char *text, int x, int y,
                                       int max_width, uint16_t color, float scale,
                                       int text_align, int container_w, int font_id)
{
	if (!text || !text[0]) return;

#ifdef GEA_EMBEDDED_HAS_GENERATED_FONTS
	if (font_id >= 0) {
		const gea_embedded_font_t *f = gea_embedded_font_lookup(font_id);
		if (!f || f->glyph_count == 0) return;

		const char *line_start = text;
		int pen_y = y;

		while (*line_start) {
			int line_w = 0;
			int chars = 0;
			const char *p = line_start;
			while (*p && *p != '\n') {
				int cp = (unsigned char)*p;
				const gea_embedded_glyph_t *g = NULL;
				for (int gi = 0; gi < f->glyph_count; gi++) {
					if (f->glyphs[gi].codepoint == cp) { g = &f->glyphs[gi]; break; }
				}
				int adv = g ? g->advance : (f->size_px / 2);
				if (line_w + adv > max_width && chars > 0) break;
				line_w += adv;
				chars++;
				p++;
			}

			int xoff = 0;
			if (text_align == 1) xoff = (container_w - line_w) / 2;
			else if (text_align == 2) xoff = container_w - line_w;
			if (xoff < 0) xoff = 0;

			char line_buf[65];
			int copy_len = chars < 64 ? chars : 64;
			memcpy(line_buf, line_start, copy_len);
			line_buf[copy_len] = '\0';
			gea_embedded_display_draw_text_font(line_buf, x + xoff, pen_y, color, font_id);

			line_start += chars;
			if (*line_start == '\n') line_start++;
			pen_y += f->line_height;
		}
		return;
	}
#endif

	if (scale < 0.1f) scale = 1.0f;
	int gw = (int)(FONT_W * scale + 0.5f);
	int gh = (int)(FONT_H * scale + 0.5f);
	if (gw < 1) gw = 1;
	if (gh < 1) gh = 1;

	const char *line_start = text;
	int pen_y = y;

	while (*line_start) {
		int line_w = 0;
		int chars = 0;
		const char *p = line_start;
		while (*p && *p != '\n') {
			if (line_w + gw > max_width && chars > 0) break;
			line_w += gw;
			chars++;
			p++;
		}

		int xoff = 0;
		if (text_align == 1) xoff = (container_w - line_w) / 2;
		else if (text_align == 2) xoff = container_w - line_w;
		if (xoff < 0) xoff = 0;

		int pen_x = x + xoff;
		p = line_start;
		for (int i = 0; i < chars; i++) {
			char buf[2] = { p[i], '\0' };
			gea_embedded_display_draw_text(buf, pen_x, pen_y, color, scale);
			pen_x += gw;
		}

		line_start += chars;
		if (*line_start == '\n') line_start++;
		pen_y += gh;
	}
}

void gea_embedded_ui_text_record(const ui_node_t *n)
{
	if (n->type != UI_TYPE_TEXT || !n->text[0]) return;

	int x = n->layout_x;
	int y = n->layout_y;
	int w = n->layout_w;
	int h = n->layout_h;
	int tx = x + n->padding[3];
	int ty = y + n->padding[0];
	int tw = w - n->padding[1] - n->padding[3];
	if (tw < 0) tw = 0;
	float text_scale = n->font_size > 0 ? (float)n->font_size / FONT_H : 1.0f;

	ui_display_cmd_t *cmd = gea_embedded_ui_display_list_append();
	if (!cmd) return;
	cmd->type = CMD_DRAW_TEXT;
	cmd->bx = x; cmd->by = y; cmd->bw = w; cmd->bh = h;
	cmd->text.text = n->text;
	cmd->text.x = tx; cmd->text.y = ty;
	cmd->text.max_w = tw;
	cmd->text.color = n->text_color;
	cmd->text.scale = text_scale;
	cmd->text.align = n->text_align;
	cmd->text.container_w = tw;
	cmd->text.font_id = n->font_id;
}

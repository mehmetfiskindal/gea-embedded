#include "image.h"

#include <stdlib.h>
#include <string.h>

#define STBI_NO_STDIO
#define STBI_NO_HDR
#define STBI_NO_PSD
#define STBI_NO_TGA
#define STBI_NO_BMP
#define STBI_NO_PIC
#define STBI_NO_PNM
#define STBI_NO_GIF
#define STB_IMAGE_IMPLEMENTATION
#include "stb_image.h"

#include "AnimatedGIF.h"

static gea_embedded_image_t images[GEA_EMBEDDED_IMAGE_MAX];
static int images_used[GEA_EMBEDDED_IMAGE_MAX];

static uint16_t *gif_draw_canvas;
static int gif_draw_canvas_width;

static inline uint16_t rgba_to_rgb565(uint8_t r, uint8_t g, uint8_t b)
{
	return (uint16_t)(((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3));
}

static void convert_rgba_to_rgb565(const uint8_t *rgba, uint16_t *out, int pixel_count)
{
	for (int i = 0; i < pixel_count; i++) {
		int off = i * 4;
		uint8_t a = rgba[off + 3];
		if (a == 0) {
			out[i] = 0x0000;
		} else {
			out[i] = rgba_to_rgb565(rgba[off], rgba[off + 1], rgba[off + 2]);
		}
	}
}

static void gif_draw_callback(GIFDRAW *pDraw)
{
	if (!gif_draw_canvas) return;
	int canvas_y = pDraw->iY + pDraw->y;
	uint16_t *dst = gif_draw_canvas + canvas_y * gif_draw_canvas_width + pDraw->iX;
	uint16_t *palette = pDraw->pPalette;
	uint8_t *src = pDraw->pPixels;
	int w = pDraw->iWidth;

	if (pDraw->ucHasTransparency) {
		uint8_t trans = pDraw->ucTransparent;
		for (int i = 0; i < w; i++) {
			uint8_t idx = src[i];
			if (idx != trans)
				dst[i] = palette[idx];
		}
	} else {
		for (int i = 0; i < w; i++)
			dst[i] = palette[src[i]];
	}
}

static int gif_decode_next_frame(gea_embedded_image_t *img)
{
	GIFIMAGE *gif = (GIFIMAGE *)img->gif_decoder;
	if (!gif) return -1;

	gif_draw_canvas = img->canvas_rgb565;
	gif_draw_canvas_width = img->width;

	int delay = 0;
	int rc = GIF_playFrame(gif, &delay);

	gif_draw_canvas = NULL;

	if (rc < 0) return -1;
	if (delay <= 0) delay = 100;
	img->current_delay_ms = delay;
	return rc;
}

int gea_embedded_image_detect_format(const uint8_t *data, int len)
{
	if (!data || len < 4) return GEA_EMBEDDED_IMAGE_FMT_UNKNOWN;
	if (data[0] == 0xFF && data[1] == 0xD8) return GEA_EMBEDDED_IMAGE_FMT_JPEG;
	if (data[0] == 0x89 && data[1] == 'P' && data[2] == 'N' && data[3] == 'G')
		return GEA_EMBEDDED_IMAGE_FMT_PNG;
	if (data[0] == 'G' && data[1] == 'I' && data[2] == 'F')
		return GEA_EMBEDDED_IMAGE_FMT_GIF;
	return GEA_EMBEDDED_IMAGE_FMT_UNKNOWN;
}

static int find_free_slot(int id)
{
	if (id >= 0 && id < GEA_EMBEDDED_IMAGE_MAX && !images_used[id]) return id;
	for (int i = 0; i < GEA_EMBEDDED_IMAGE_MAX; i++) {
		if (!images_used[i]) return i;
	}
	return -1;
}

static int decode_gif(gea_embedded_image_t *img, const uint8_t *data, int len)
{
	uint8_t *gif_data = (uint8_t *)malloc(len);
	if (!gif_data) return -1;
	memcpy(gif_data, data, len);

	GIFIMAGE *gif = (GIFIMAGE *)malloc(sizeof(GIFIMAGE));
	if (!gif) { free(gif_data); return -1; }

	GIF_begin(gif, LITTLE_ENDIAN_PIXELS, GIF_PALETTE_RGB565);
	if (!GIF_openRAM(gif, gif_data, len, gif_draw_callback)) {
		free(gif);
		free(gif_data);
		return -1;
	}

	int w = GIF_getCanvasWidth(gif);
	int h = GIF_getCanvasHeight(gif);
	if (w <= 0 || h <= 0) {
		GIF_close(gif);
		free(gif);
		free(gif_data);
		return -1;
	}

	uint16_t *canvas = (uint16_t *)malloc((size_t)w * h * sizeof(uint16_t));
	if (!canvas) {
		GIF_close(gif);
		free(gif);
		free(gif_data);
		return -1;
	}
	memset(canvas, 0, (size_t)w * h * sizeof(uint16_t));

	img->width = w;
	img->height = h;
	img->canvas_rgb565 = canvas;
	img->gif_decoder = gif;
	img->gif_data = gif_data;
	img->gif_data_len = len;
	img->loop_count = -1;
	img->playing = 1;
	img->frame_count = 2;

	if (gif_decode_next_frame(img) < 0) {
		free(canvas);
		GIF_close(gif);
		free(gif);
		free(gif_data);
		memset(img, 0, sizeof(*img));
		return -1;
	}

	return 0;
}

static int decode_static(gea_embedded_image_t *img, const uint8_t *data, int len)
{
	int w, h, comp;
	stbi_uc *rgba = stbi_load_from_memory(data, len, &w, &h, &comp, 4);
	if (!rgba) return -1;

	int pixels = w * h;
	uint16_t *canvas = (uint16_t *)malloc((size_t)pixels * sizeof(uint16_t));
	if (!canvas) {
		stbi_image_free(rgba);
		return -1;
	}

	convert_rgba_to_rgb565(rgba, canvas, pixels);
	stbi_image_free(rgba);

	img->width = w;
	img->height = h;
	img->frame_count = 1;
	img->canvas_rgb565 = canvas;
	img->loop_count = 0;
	img->playing = 0;

	return 0;
}

int gea_embedded_image_decode(const uint8_t *data, int len, int id)
{
	if (!data || len <= 0) return -1;

	int slot = find_free_slot(id);
	if (slot < 0) return -1;

	if (images_used[slot]) gea_embedded_image_dispose(slot);

	gea_embedded_image_t *img = &images[slot];
	memset(img, 0, sizeof(*img));
	img->format = gea_embedded_image_detect_format(data, len);

	int rc;
	if (img->format == GEA_EMBEDDED_IMAGE_FMT_GIF)
		rc = decode_gif(img, data, len);
	else
		rc = decode_static(img, data, len);

	if (rc < 0) {
		memset(img, 0, sizeof(*img));
		return -1;
	}

	img->current_frame = 0;
	img->elapsed_ms = 0;
	images_used[slot] = 1;
	return slot;
}

int gea_embedded_image_width(int id)
{
	if (id < 0 || id >= GEA_EMBEDDED_IMAGE_MAX || !images_used[id]) return 0;
	return images[id].width;
}

int gea_embedded_image_height(int id)
{
	if (id < 0 || id >= GEA_EMBEDDED_IMAGE_MAX || !images_used[id]) return 0;
	return images[id].height;
}

int gea_embedded_image_frame_count(int id)
{
	if (id < 0 || id >= GEA_EMBEDDED_IMAGE_MAX || !images_used[id]) return 0;
	return images[id].frame_count;
}

int gea_embedded_image_is_animated(int id)
{
	if (id < 0 || id >= GEA_EMBEDDED_IMAGE_MAX || !images_used[id]) return 0;
	return images[id].frame_count > 1;
}

int gea_embedded_image_format(int id)
{
	if (id < 0 || id >= GEA_EMBEDDED_IMAGE_MAX || !images_used[id]) return GEA_EMBEDDED_IMAGE_FMT_UNKNOWN;
	return images[id].format;
}

void gea_embedded_image_set_playing(int id, int playing)
{
	if (id < 0 || id >= GEA_EMBEDDED_IMAGE_MAX || !images_used[id]) return;
	images[id].playing = playing ? 1 : 0;
}

int gea_embedded_image_get_playing(int id)
{
	if (id < 0 || id >= GEA_EMBEDDED_IMAGE_MAX || !images_used[id]) return 0;
	return images[id].playing;
}

void gea_embedded_image_seek(int id, int frame)
{
	if (id < 0 || id >= GEA_EMBEDDED_IMAGE_MAX || !images_used[id]) return;
	gea_embedded_image_t *img = &images[id];
	if (!img->gif_decoder || img->frame_count <= 1) return;
	if (frame < 0) frame = 0;
	if (frame >= img->frame_count) frame = img->frame_count - 1;

	GIFIMAGE *gif = (GIFIMAGE *)img->gif_decoder;
	GIF_reset(gif);
	memset(img->canvas_rgb565, 0, (size_t)img->width * img->height * sizeof(uint16_t));
	for (int f = 0; f <= frame; f++)
		gif_decode_next_frame(img);
	img->current_frame = frame;
	img->elapsed_ms = 0;
}

int gea_embedded_image_get_frame(int id)
{
	if (id < 0 || id >= GEA_EMBEDDED_IMAGE_MAX || !images_used[id]) return 0;
	return images[id].current_frame;
}

int gea_embedded_image_advance(int id, int delta_ms)
{
	if (id < 0 || id >= GEA_EMBEDDED_IMAGE_MAX || !images_used[id]) return 0;
	gea_embedded_image_t *img = &images[id];
	if (!img->playing || img->frame_count <= 1 || !img->gif_decoder) return 0;

	img->elapsed_ms += delta_ms;
	int changed = 0;

	while (img->elapsed_ms >= img->current_delay_ms && img->current_delay_ms > 0) {
		img->elapsed_ms -= img->current_delay_ms;
		int rc = gif_decode_next_frame(img);
		if (rc < 0) break;
		img->current_frame++;
		if (rc == 0)
			img->current_frame = 0;
		changed = 1;
	}

	return changed;
}

const uint16_t *gea_embedded_image_frame_pixels(int id, int frame)
{
	if (id < 0 || id >= GEA_EMBEDDED_IMAGE_MAX || !images_used[id]) return NULL;
	gea_embedded_image_t *img = &images[id];
	if (!img->canvas_rgb565) return NULL;
	if (img->frame_count > 1 && frame != img->current_frame) return NULL;
	return img->canvas_rgb565;
}

const uint16_t *gea_embedded_image_current_pixels(int id)
{
	if (id < 0 || id >= GEA_EMBEDDED_IMAGE_MAX || !images_used[id]) return NULL;
	return images[id].canvas_rgb565;
}

void gea_embedded_image_dispose(int id)
{
	if (id < 0 || id >= GEA_EMBEDDED_IMAGE_MAX || !images_used[id]) return;
	gea_embedded_image_t *img = &images[id];
	if (img->gif_decoder) {
		GIF_close((GIFIMAGE *)img->gif_decoder);
		free(img->gif_decoder);
	}
	free(img->gif_data);
	free(img->canvas_rgb565);
	memset(img, 0, sizeof(*img));
	images_used[id] = 0;
}

void gea_embedded_image_dispose_all(void)
{
	for (int i = 0; i < GEA_EMBEDDED_IMAGE_MAX; i++) {
		if (images_used[i]) gea_embedded_image_dispose(i);
	}
}

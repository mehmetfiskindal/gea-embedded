#pragma once

#include <stdint.h>

#define GEA_EMBEDDED_IMAGE_MAX 32

#define GEA_EMBEDDED_IMAGE_FIT_FILL 0
#define GEA_EMBEDDED_IMAGE_FIT_CONTAIN 1
#define GEA_EMBEDDED_IMAGE_FIT_COVER 2
#define GEA_EMBEDDED_IMAGE_FIT_NONE 3
#define GEA_EMBEDDED_IMAGE_FIT_SCALE_DOWN 4

#define GEA_EMBEDDED_IMAGE_FMT_UNKNOWN 0
#define GEA_EMBEDDED_IMAGE_FMT_JPEG 1
#define GEA_EMBEDDED_IMAGE_FMT_PNG 2
#define GEA_EMBEDDED_IMAGE_FMT_GIF 3

typedef struct
{
	int width;
	int height;
	int frame_count;
	int format;
	int loop_count;
	int current_frame;
	int playing;
	int elapsed_ms;
	int current_delay_ms;

	uint16_t *canvas_rgb565;

	void *gif_decoder;
	uint8_t *gif_data;
	int gif_data_len;
} gea_embedded_image_t;

int gea_embedded_image_decode(const uint8_t *data, int len, int id);
int gea_embedded_image_width(int id);
int gea_embedded_image_height(int id);
int gea_embedded_image_frame_count(int id);
int gea_embedded_image_is_animated(int id);
int gea_embedded_image_format(int id);
void gea_embedded_image_set_playing(int id, int playing);
int gea_embedded_image_get_playing(int id);
void gea_embedded_image_seek(int id, int frame);
int gea_embedded_image_get_frame(int id);
int gea_embedded_image_advance(int id, int delta_ms);
const uint16_t *gea_embedded_image_frame_pixels(int id, int frame);
const uint16_t *gea_embedded_image_current_pixels(int id);
void gea_embedded_image_dispose(int id);
void gea_embedded_image_dispose_all(void);
int gea_embedded_image_detect_format(const uint8_t *data, int len);

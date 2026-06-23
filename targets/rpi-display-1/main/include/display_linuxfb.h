#pragma once

/*
 * display_linuxfb.h — internal contract for the linuxfb backend.
 * Only display.c and display_linuxfb.c include this; the rest of
 * the firmware only sees the public display.h.
 */

#include "display.h"

int      gea_embedded_display_linuxfb_init(int viewport_w, int viewport_h);
void     gea_embedded_display_linuxfb_shutdown(void);
uint16_t *gea_embedded_display_linuxfb_get_back_buffer(void);
void     gea_embedded_display_linuxfb_set_flush_config(int chunk_rows, int queue_depth);
int      gea_embedded_display_linuxfb_wait_vsync(int timeout_ms);
int      gea_embedded_display_linuxfb_get_panel_width(void);
int      gea_embedded_display_linuxfb_get_panel_height(void);
void     gea_embedded_display_linuxfb_flush_region(int x, int y, int w, int h,
                                                    gea_rpi_viewport_t viewport);

#if GEA_EMBEDDED_HAS_KMS
int  gea_embedded_display_kms_init(void);
void gea_embedded_display_kms_shutdown(void);
void gea_embedded_display_kms_set_flush_config(int chunk_rows, int queue_depth);
int  gea_embedded_display_kms_wait_vsync(int timeout_ms);
void gea_embedded_display_kms_flush_region(int x, int y, int w, int h);
#endif

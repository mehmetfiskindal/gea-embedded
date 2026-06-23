/*
 * display_linuxfb.c — Linux framebuffer backend (default for Pi Zero W v1.1).
 *
 * Opens /dev/fb0, mmaps the panel buffer, optionally creates a shadow
 * RGB565 buffer when the panel is ARGB8888, and pushes dirty regions
 * from the app-render surface into the panel.
 *
 * Compat viewport (410x502): the app renders into a 410x502 RGB565
 * shadow; flush() letterboxes it into the panel buffer centered.
 */

#define _GNU_SOURCE
#include "display.h"
#include "display_linuxfb.h"
#include "log.h"

#include <errno.h>
#include <fcntl.h>
#include <linux/fb.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/mman.h>
#include <time.h>
#include <unistd.h>

/* ---- State ---- */

static int                   g_fb_fd = -1;
static struct fb_var_screeninfo g_var = { 0 };
static struct fb_fix_screeninfo g_fix = { 0 };
static void                 *g_fb_map = MAP_FAILED;
static size_t                g_fb_size = 0;

static uint16_t             *g_panel_buffer = NULL;     /* native fb or shadow */
static size_t                g_panel_buffer_size = 0;
static int                   g_panel_w = 0;
static int                   g_panel_h = 0;
static int                   g_panel_stride_bytes = 0;
static int                   g_panel_bpp = 0;

/* App viewport shadow — what gea_embedded_raster_bind was called with. */
static uint16_t             *g_viewport_buffer = NULL;
static size_t                g_viewport_buffer_size = 0;
static int                   g_viewport_w = 0;
static int                   g_viewport_h = 0;

/* ARGB→RGB565 swizzle table: built once at init. ~128 KB. */
static uint32_t             *g_argb_to_panel_table = NULL;   /* ARGB32 → native fb word */
static uint16_t              g_rgb565_lut[65536] __attribute__((aligned(64)));  /* 128 KB RGB16→RGB16 */
static int                   g_use_native_rgb565 = 0;
static int                   g_use_shadow_panel = 0;

/* Flush tuning */
static int g_flush_chunk_rows = 32;

/* ---- Helpers ---- */

static int fb_open_and_map(void) {
    const char *fb_path = getenv("GEA_RPI_FB");
    if (!fb_path || !*fb_path) fb_path = "/dev/fb0";

    g_fb_fd = open(fb_path, O_RDWR);
    if (g_fb_fd < 0) {
        gea_loge("linuxfb: cannot open %s: %s", fb_path, strerror(errno));
        return -1;
    }

    if (ioctl(g_fb_fd, FBIOGET_VSCREENINFO, &g_var) < 0) {
        gea_loge("linuxfb: FBIOGET_VSCREENINFO failed: %s", strerror(errno));
        close(g_fb_fd); g_fb_fd = -1;
        return -1;
    }
    if (ioctl(g_fb_fd, FBIOGET_FSCREENINFO, &g_fix) < 0) {
        gea_loge("linuxfb: FBIOGET_FSCREENINFO failed: %s", strerror(errno));
        close(g_fb_fd); g_fb_fd = -1;
        return -1;
    }

    g_panel_w = g_var.xres;
    g_panel_h = g_var.yres;
    g_panel_bpp = g_var.bits_per_pixel;
    g_panel_stride_bytes = g_fix.line_length;

    /* The size we actually need: use smem_len if set, else w*h*4. */
    g_fb_size = g_fix.smem_len ? g_fix.smem_len
                                : (size_t)g_panel_w * g_panel_h * ((g_panel_bpp + 7) / 8);

    g_fb_map = mmap(NULL, g_fb_size, PROT_READ | PROT_WRITE, MAP_SHARED, g_fb_fd, 0);
    if (g_fb_map == MAP_FAILED) {
        gea_loge("linuxfb: mmap failed: %s", strerror(errno));
        close(g_fb_fd); g_fb_fd = -1;
        return -1;
    }

    gea_logi("linuxfb: %s %dx%d %d-bpp (line %d, smem %zu)",
             fb_path, g_panel_w, g_panel_h, g_panel_bpp, g_panel_stride_bytes, g_fb_size);
    return 0;
}

static void fb_unmap_and_close(void) {
    if (g_fb_map != MAP_FAILED) {
        munmap(g_fb_map, g_fb_size);
        g_fb_map = MAP_FAILED;
    }
    if (g_fb_fd >= 0) {
        close(g_fb_fd);
        g_fb_fd = -1;
    }
}

/* Build a 64K-entry swizzle table from RGB16 to native fb format. */
static int build_argb_to_panel_table(void) {
    if (g_panel_bpp != 32) {
        /* No table needed; we still build a 16->16 identity LUT. */
        for (int i = 0; i < 65536; i++) g_rgb565_lut[i] = (uint16_t)i;
        return 0;
    }
    if (!g_argb_to_panel_table) {
        g_argb_to_panel_table = (uint32_t *)malloc(65536 * sizeof(uint32_t));
        if (!g_argb_to_panel_table) {
            gea_loge("linuxfb: cannot allocate %zu-byte swizzle table", 65536 * sizeof(uint32_t));
            return -1;
        }
    }
    for (int i = 0; i < 65536; i++) {
        /* RGB565: RRRRR GGGGGG BBBBB */
        uint16_t c = (uint16_t)i;
        uint8_t r5 = (c >> 11) & 0x1F;
        uint8_t g6 = (c >>  5) & 0x3F;
        uint8_t b5 =  c        & 0x1F;
        /* Expand to 8-bit: high replicate. */
        uint8_t r8 = (r5 << 3) | (r5 >> 2);
        uint8_t g8 = (g6 << 2) | (g6 >> 4);
        uint8_t b8 = (b5 << 3) | (b5 >> 2);
        /* Native ARGB8888 byte order depends on var.red/green/blue.offset. */
        uint32_t argb = 0xFFu << 24;
        uint8_t ro = (uint8_t)g_var.red.offset;
        uint8_t go = (uint8_t)g_var.green.offset;
        uint8_t bo = (uint8_t)g_var.blue.offset;
        argb |= ((uint32_t)r8 << ro);
        argb |= ((uint32_t)g8 << go);
        argb |= ((uint32_t)b8 << bo);
        g_argb_to_panel_table[i] = argb;
        g_rgb565_lut[i] = c;
    }
    return 0;
}

static int allocate_viewport_shadow(int viewport_w, int viewport_h) {
    g_viewport_w = viewport_w;
    g_viewport_h = viewport_h;
    g_viewport_buffer_size = (size_t)viewport_w * viewport_h * sizeof(uint16_t);
    g_viewport_buffer = (uint16_t *)malloc(g_viewport_buffer_size);
    if (!g_viewport_buffer) {
        gea_loge("linuxfb: cannot allocate %zu-byte viewport shadow", g_viewport_buffer_size);
        return -1;
    }
    memset(g_viewport_buffer, 0, g_viewport_buffer_size);
    return 0;
}

static int decide_native_rgb565(void) {
    if (g_panel_bpp == 16) {
        /* Verify red/green/blue offsets are RGB565 (5/6/5). */
        if (g_var.red.length   == 5 &&
            g_var.green.length == 6 &&
            g_var.blue.length  == 5) {
            return 1;
        }
        gea_logw("linuxfb: 16-bpp but non-RGB565 layout, falling back to swizzle");
    }
    return 0;
}

/* ---- Public API ---- */

int gea_embedded_display_linuxfb_init(int viewport_w, int viewport_h) {
    if (fb_open_and_map() != 0) return -1;

    g_use_native_rgb565 = decide_native_rgb565();
    if (build_argb_to_panel_table() != 0) {
        fb_unmap_and_close();
        return -1;
    }

    /* Panel buffer: either the mmap'd fb directly (RGB565) or our own
     * 16-bit shadow (when panel is ARGB and we need to blit through a
     * table). We always need a 16-bit working buffer because the raster
     * writes RGB565. */
    g_panel_buffer_size = (size_t)g_panel_w * g_panel_h * sizeof(uint16_t);
    g_panel_buffer = (uint16_t *)malloc(g_panel_buffer_size);
    if (!g_panel_buffer) {
        gea_loge("linuxfb: cannot allocate %zu-byte panel shadow", g_panel_buffer_size);
        fb_unmap_and_close();
        return -1;
    }
    g_panel_stride_bytes = g_panel_w * (int)sizeof(uint16_t);
    memset(g_panel_buffer, 0, g_panel_buffer_size);
    g_use_shadow_panel = 1;

    if (allocate_viewport_shadow(viewport_w, viewport_h) != 0) {
        free(g_panel_buffer); g_panel_buffer = NULL;
        fb_unmap_and_close();
        return -1;
    }

    /* fb fd stays open for FBIOWAITFORVSYNC and panel pushes. */
    return 0;
}

void gea_embedded_display_linuxfb_shutdown(void) {
    if (g_panel_buffer) { free(g_panel_buffer); g_panel_buffer = NULL; }
    if (g_viewport_buffer) { free(g_viewport_buffer); g_viewport_buffer = NULL; }
    if (g_argb_to_panel_table) { free(g_argb_to_panel_table); g_argb_to_panel_table = NULL; }
    fb_unmap_and_close();
}

uint16_t *gea_embedded_display_linuxfb_get_back_buffer(void) {
    /* The "back buffer" is the viewport shadow the raster binds to. */
    return g_viewport_buffer;
}

int gea_embedded_display_linuxfb_wait_vsync(int timeout_ms) {
    if (g_fb_fd < 0) {
        /* Best-effort sleep: each vsync is ~16.6 ms. */
        struct timespec ts = { 0, (long)timeout_ms * 1000000L };
        nanosleep(&ts, NULL);
        return 0;
    }
    /* FBIO_WAITFORVSYNC: arg is the crtc number (0 for fb0). */
    int crtc = 0;
    if (ioctl(g_fb_fd, FBIO_WAITFORVSYNC, &crtc) < 0) {
        /* Fallback to a sleep. */
        struct timespec ts = { 0, 16 * 1000000L };
        nanosleep(&ts, NULL);
        return -1;
    }
    return 0;
}

void gea_embedded_display_linuxfb_set_flush_config(int chunk_rows, int queue_depth) {
    if (chunk_rows > 0) g_flush_chunk_rows = chunk_rows;
    (void)queue_depth;  /* linuxfb has no DMA queue */
}

/* ---- Push viewport (compat or native) into the panel shadow ---- */
static void blit_viewport_into_panel_shadow(int x, int y, int w, int h) {
    int pad_x = (g_panel_w - g_viewport_w) / 2;
    int pad_y = (g_panel_h - g_viewport_h) / 2;
    if (g_viewport_w == g_panel_w && g_viewport_h == g_panel_h) {
        /* Native mode: viewport IS the panel — direct memcpy of the
         * dirty region. */
        for (int row = 0; row < h; row++) {
            memcpy(
                g_panel_buffer + (size_t)(y + row) * (g_panel_stride_bytes / 2) + x,
                g_viewport_buffer + (size_t)(y + row) * g_viewport_w + x,
                (size_t)w * sizeof(uint16_t));
        }
    } else {
        /* Compat mode: center-blit the dirty row range from viewport
         * into the centered region of the panel shadow. */
        for (int row = 0; row < h; row++) {
            int src_row = y + row;
            int dst_row = src_row + pad_y;
            memcpy(
                g_panel_buffer + (size_t)dst_row * (g_panel_stride_bytes / 2) + pad_x + x,
                g_viewport_buffer + (size_t)src_row * g_viewport_w + x,
                (size_t)w * sizeof(uint16_t));
        }
    }
}

/* ---- Push panel shadow into /dev/fb0 ---- */
static void push_panel_to_fb(int x, int y, int w, int h) {
    if (g_fb_map == MAP_FAILED) return;
    /* Compute the centered region on the panel (where the viewport was blitted). */
    int pad_x = (g_panel_w - g_viewport_w) / 2;
    int pad_y = (g_panel_h - g_viewport_h) / 2;
    int fb_x = pad_x + x;
    int fb_y = pad_y + y;

    if (g_use_native_rgb565) {
        /* Direct memcpy: panel is RGB565 in the same byte order. */
        for (int row = 0; row < h; row++) {
            uint16_t *src = g_panel_buffer + (size_t)(fb_y + row) * g_panel_w + fb_x;
            uint8_t  *dst = (uint8_t *)g_fb_map + (size_t)(fb_y + row) * g_fix.line_length + (size_t)fb_x * 2;
            memcpy(dst, src, (size_t)w * sizeof(uint16_t));
        }
    } else if (g_panel_bpp == 32 && g_argb_to_panel_table) {
        /* ARGB8888: convert pixel-by-pixel through the swizzle table. */
        for (int row = 0; row < h; row++) {
            uint16_t *src = g_panel_buffer + (size_t)(fb_y + row) * g_panel_w + fb_x;
            uint32_t *dst = (uint32_t *)((uint8_t *)g_fb_map + (size_t)(fb_y + row) * g_fix.line_length) + fb_x;
            for (int col = 0; col < w; col++) {
                dst[col] = g_argb_to_panel_table[src[col]];
            }
        }
    } else {
        /* Unknown format; best-effort: skip the push but warn. */
        static int warned = 0;
        if (!warned) {
            gea_logw("linuxfb: unsupported panel bpp=%d, no fb push", g_panel_bpp);
            warned = 1;
        }
    }
}

void gea_embedded_display_linuxfb_flush_region(int x, int y, int w, int h,
                                                gea_rpi_viewport_t vp) {
    if (!g_viewport_buffer || !g_panel_buffer) return;
    if (w <= 0 || h <= 0) return;

    /* Debug levels (GEA_RPI_DEBUG_PANEL):
     *   1: full compat blit + push the ENTIRE panel (1024x600) every
     *      flush, so the LCD receives the panel_buffer including the
     *      letterbox padding and any diagnostic markers.
     *   2: same as 1, plus a red 2-px border on the panel buffer
     *      around the centered compat viewport. With full-panel push,
     *      the border is actually visible on the LCD.
     *
     * In normal (debug_level == 0) mode we only push the dirty region
     * for efficiency. */
    const char *dbg_env = getenv("GEA_RPI_DEBUG_PANEL");
    int debug_level = dbg_env ? atoi(dbg_env) : 0;

    if (debug_level >= 1) {
        blit_viewport_into_panel_shadow(0, 0, g_viewport_w, g_viewport_h);
        if (debug_level >= 2) {
            int pad_x = (g_panel_w - g_viewport_w) / 2;
            int pad_y = (g_panel_h - g_viewport_h) / 2;
            const uint16_t RED = 0xF800;  /* RGB565 red */
            for (int dx = 0; dx < g_viewport_w; dx++) {
                g_panel_buffer[(size_t)pad_y * g_panel_w + pad_x + dx] = RED;
                g_panel_buffer[(size_t)(pad_y + g_viewport_h - 1) * g_panel_w + pad_x + dx] = RED;
            }
            for (int dy = 0; dy < g_viewport_h; dy++) {
                g_panel_buffer[(size_t)(pad_y + dy) * g_panel_w + pad_x] = RED;
                g_panel_buffer[(size_t)(pad_y + dy) * g_panel_w + pad_x + g_viewport_w - 1] = RED;
            }
        }
        /* Push the ENTIRE panel so the border / letterbox is also visible. */
        push_panel_to_fb(0, 0, g_panel_w, g_panel_h);
    } else {
        blit_viewport_into_panel_shadow(x, y, w, h);
        push_panel_to_fb(x, y, w, h);
    }

    /* Debug: log the first 5 flushes so we can see whether pixels are
     * actually being written. */
    static int debug_flush_count = 0;
    if (debug_flush_count < 5) {
        int non_black = 0;
        for (int i = 0; i < g_viewport_w * g_viewport_h; i++) {
            if (g_viewport_buffer[i] != 0x0000) non_black++;
        }
        int non_black_panel = 0;
        for (int i = 0; i < g_panel_w * g_panel_h; i++) {
            if (g_panel_buffer[i] != 0x0000) non_black_panel++;
        }
        gea_logi("flush[%d]: dirty=(%d,%d %dx%d) mode=%s pad=(%d,%d) vp_nonblack=%d panel_nonblack=%d",
                 debug_flush_count, x, y, w, h,
                 vp == GEA_RPI_VIEWPORT_NATIVE ? "native" : "compat",
                 (g_panel_w - g_viewport_w) / 2,
                 (g_panel_h - g_viewport_h) / 2,
                 non_black, non_black_panel);
        debug_flush_count++;
    }
    /* Also log a heartbeat every 30 frames so we can see the binary
     * is alive even when dirty-rect stays empty. */
    static int heartbeat_count = 0;
    heartbeat_count++;
    if (heartbeat_count % 30 == 0) {
        gea_logi("heartbeat[%d]: frame loop alive, dirty=(%d,%d %dx%d)",
                 heartbeat_count, x, y, w, h);
    }
}

int gea_embedded_display_linuxfb_get_panel_width(void) {
    return g_panel_w;
}

int gea_embedded_display_linuxfb_get_panel_height(void) {
    return g_panel_h;
}


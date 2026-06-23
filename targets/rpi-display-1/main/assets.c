/*
 * assets.c — locate app-shipped assets (images, fonts, JS) on disk.
 *
 * The Pi build doesn't link image/font/JS assets at compile time; they
 * live under /opt/gea-embedded/apps/<id>/assets/ at runtime. Apps call
 * __gea_embedded_image.loadUrl() etc.; the loader resolves the path
 * relative to the asset root and reads the bytes.
 */

#define _GNU_SOURCE
#include "assets.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static char g_root[512] = "/opt/gea-embedded/apps";

const char *gea_embedded_assets_get_root(void) { return g_root; }

int gea_embedded_assets_init(const char *root_override) {
    if (root_override && *root_override) {
        snprintf(g_root, sizeof(g_root), "%s", root_override);
    }
    return 0;
}

const void *gea_embedded_assets_find(const char *name, size_t *out_size) {
    static char *cached_buf = NULL;
    static size_t cached_size = 0;
    if (!name) return NULL;
    char path[1024];
    snprintf(path, sizeof(path), "%s/%s", g_root, name);

    FILE *fp = fopen(path, "rb");
    if (!fp) return NULL;
    fseek(fp, 0, SEEK_END);
    long sz = ftell(fp);
    fseek(fp, 0, SEEK_SET);
    if (sz <= 0) { fclose(fp); return NULL; }
    if (cached_buf) free(cached_buf);
    cached_buf = (char *)malloc((size_t)sz + 1);
    if (!cached_buf) { fclose(fp); return NULL; }
    size_t n = fread(cached_buf, 1, (size_t)sz, fp);
    fclose(fp);
    if (n != (size_t)sz) { free(cached_buf); cached_buf = NULL; return NULL; }
    cached_buf[sz] = 0;
    cached_size = (size_t)sz;
    if (out_size) *out_size = cached_size;
    return cached_buf;
}

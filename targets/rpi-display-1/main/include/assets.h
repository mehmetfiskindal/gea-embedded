#pragma once

#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>

const void *gea_embedded_assets_find(const char *name, size_t *out_size);
const char *gea_embedded_assets_get_root(void);
int         gea_embedded_assets_init(const char *root_override);

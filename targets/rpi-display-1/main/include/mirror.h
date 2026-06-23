#pragma once

#include <stdint.h>

int  gea_embedded_mirror_init(uint16_t port);
void gea_embedded_mirror_shutdown(void);
void gea_embedded_mirror_tick(void);

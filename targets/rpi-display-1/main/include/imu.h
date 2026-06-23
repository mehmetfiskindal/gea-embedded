#pragma once

#include <stdbool.h>

int  gea_embedded_imu_init(void);
void gea_embedded_imu_shutdown(void);
int  gea_embedded_imu_read(float *x, float *y, float *z);
int  gea_embedded_imu_has_reading(void);
bool gea_embedded_imu_is_activated(void);

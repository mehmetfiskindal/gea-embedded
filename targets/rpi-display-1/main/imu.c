/*
 * imu.c — I2C IMU stub. Compiles when GEA_EMBEDDED_IMU=1.
 *
 * For v1 we ship a no-op stub. The full MPU6050/LSM6DS3 driver lands
 * in Phase 3 once a target sensor is wired to the Pi.
 */

#include "imu.h"
#include "log.h"

int gea_embedded_imu_init(void) {
    gea_logw("imu: stub; no sensor attached");
    return -1;
}

void gea_embedded_imu_shutdown(void) { }

int gea_embedded_imu_read(float *x, float *y, float *z) {
    if (x) *x = 0.0f;
    if (y) *y = 0.0f;
    if (z) *z = 0.0f;
    return -1;
}

int gea_embedded_imu_has_reading(void)      { return 0; }
bool gea_embedded_imu_is_activated(void)    { return false; }

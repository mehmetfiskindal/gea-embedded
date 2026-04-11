#pragma once

#include "esp_err.h"
#include "driver/i2c_master.h"

esp_err_t gea_embedded_touch_init(void);

/* Read current touch state from I2C. Returns 1 if touching, 0 otherwise. */
int gea_embedded_touch_read(int *x, int *y);

/* Read the latest touch state cached by the touch task. */
int gea_embedded_touch_read_cached(int *x, int *y);

/* Consume the latest coalesced move sample from the touch task. */
void gea_embedded_touch_consume_latest_move(int *x, int *y);

i2c_master_bus_handle_t gea_embedded_touch_get_i2c_bus(void);

/* Read battery percentage from AXP2101 fuel gauge. Returns 0-100, or -1 on error. */
int gea_embedded_battery_read_percent(void);

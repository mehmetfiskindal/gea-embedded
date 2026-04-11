#pragma once

#include <stdint.h>

void gea_embedded_imu_init(void);
void gea_embedded_imu_close(void);

void gea_embedded_imu_calibrate_bias(void);

void gea_embedded_imu_start_mouse(void);
void gea_embedded_imu_stop_mouse(void);

int gea_embedded_imu_get_tilt_x(void);
int gea_embedded_imu_get_tilt_y(void);

double gea_embedded_imu_get_acceleration_x(void);
double gea_embedded_imu_get_acceleration_y(void);
double gea_embedded_imu_get_acceleration_z(void);

void gea_embedded_imu_set_mouse_buttons(int buttons);
int gea_embedded_imu_get_mouse_buttons(void);

void gea_embedded_imu_web_set_tilt(int x, int y);

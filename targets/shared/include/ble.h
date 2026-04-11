#pragma once

#include <stdint.h>

void gea_embedded_ble_preinit(void);
void gea_embedded_ble_init(const char *device_name, uint16_t appearance, const char *mac_address);
int gea_embedded_ble_is_enabled(void);
void gea_embedded_ble_set_enabled(int enabled);
void gea_embedded_ble_start_advertising(void);
void gea_embedded_ble_stop_advertising(void);
int gea_embedded_ble_is_connected(void);
int gea_embedded_ble_is_bound(void);
int gea_embedded_ble_get_battery_level(void);
const char *gea_embedded_ble_get_mac(void);
const char *gea_embedded_ble_get_device_name(void);

void gea_embedded_ble_key_tap(int hid_code);
void gea_embedded_ble_key_down(int modifier, int hid_code);
void gea_embedded_ble_key_up(void);

void gea_embedded_ble_mouse_move(int dx, int dy, int buttons, int wheel);
void gea_embedded_ble_mouse_click(int button);

void gea_embedded_ble_set_battery_level(uint8_t level);

extern void gea_embedded_app_ble_connected(void);
extern void gea_embedded_app_ble_disconnected(void);
extern void gea_embedded_app_ble_bound(void);

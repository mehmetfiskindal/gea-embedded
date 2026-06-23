#pragma once

int gea_embedded_wifi_is_enabled(void);
void gea_embedded_wifi_set_enabled(int enabled);
int gea_embedded_wifi_is_connected(void);
int gea_embedded_wifi_get_rssi(void);
const char *gea_embedded_wifi_get_ssid(void);
const char *gea_embedded_wifi_get_ip(void);
const char *gea_embedded_wifi_get_mac(void);
void gea_embedded_wifi_configure(const char *ssid, const char *password);

#pragma once

int gea_embedded_wifi_is_enabled(void);
void gea_embedded_wifi_set_enabled(int enabled);
int gea_embedded_wifi_is_connected(void);
int gea_embedded_wifi_get_rssi(void);
const char *gea_embedded_wifi_get_ssid(void);
const char *gea_embedded_wifi_get_ip(void);
const char *gea_embedded_wifi_get_mac(void);
void gea_embedded_wifi_configure(const char *ssid, const char *password);

void gea_embedded_wifi_start_scan(void);
int gea_embedded_wifi_is_scanning(void);
int gea_embedded_wifi_get_scan_count(void);
const char *gea_embedded_wifi_get_scan_ssid_at(int index);
int gea_embedded_wifi_get_scan_rssi_at(int index);
int gea_embedded_wifi_get_scan_secured_at(int index);

void gea_embedded_wifi_web_set_state(int connected, const char *ssid, const char *ip, int rssi);
void gea_embedded_wifi_web_set_scan_count(int count);
void gea_embedded_wifi_web_set_scan_entry(int index, const char *ssid, int rssi, int secured);

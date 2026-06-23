/*
 * wifi.c — Wi-Fi state query via nmcli or /proc/net/wireless.
 *
 * The Pi OS NetworkManager exposes a stable CLI (`nmcli -t -f ...`).
 * When NM is not running we fall back to parsing /proc/net/wireless.
 */

#define _GNU_SOURCE
#include "wifi.h"
#include "log.h"
#include "platform.h"

#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static int parse_rssi_from_link_quality(int quality, int max_quality) {
    if (max_quality <= 0) max_quality = 70;
    /* map [0, max] -> [-100, -50] dBm */
    if (quality < 0) quality = 0;
    if (quality > max_quality) quality = max_quality;
    return -100 + (quality * 50 / max_quality);
}

static int run_capture(const char *cmd, char *out, size_t outsz) {
    FILE *fp = popen(cmd, "r");
    if (!fp) return -1;
    size_t n = fread(out, 1, outsz - 1, fp);
    pclose(fp);
    out[n] = 0;
    return (int)n;
}

int gea_embedded_wifi_is_enabled(void) {
    /* No way to query "enabled" cheaply; assume yes. */
    return 1;
}

void gea_embedded_wifi_set_enabled(int enabled) { (void)enabled; }

int gea_embedded_wifi_is_connected(void) {
    char buf[2048] = { 0 };
    if (run_capture("nmcli -t -f STATE general 2>/dev/null", buf, sizeof(buf)) < 0) {
        return 0;
    }
    /* STATE is the first line, e.g. "connected\n" */
    return strstr(buf, "connected") != NULL;
}

int gea_embedded_wifi_get_rssi(void) {
    char buf[2048] = { 0 };
    /* nmcli -t -f ACTIVE,SSID,SIGNAL dev wifi */
    if (run_capture("nmcli -t -f ACTIVE,SIGNAL dev wifi 2>/dev/null", buf, sizeof(buf)) <= 0) {
        return 0;
    }
    int rssi = 0;
    char *line = strtok(buf, "\n");
    while (line) {
        if (line[0] == 'e' || line[0] == 'y') {  /* yes: starts with yes */
            char *colon = strchr(line, ':');
            if (colon) rssi = atoi(colon + 1);
            break;
        }
        line = strtok(NULL, "\n");
    }
    /* NM reports 0-100; convert to approx dBm. */
    if (rssi > 0) rssi = -100 + rssi / 2;
    return rssi;
}

static char g_ssid[64] = { 0 };
const char *gea_embedded_wifi_get_ssid(void) {
    if (g_ssid[0]) return g_ssid;
    char buf[2048] = { 0 };
    if (run_capture("nmcli -t -f ACTIVE,SSID dev wifi 2>/dev/null", buf, sizeof(buf)) <= 0) {
        return "";
    }
    char *line = strtok(buf, "\n");
    while (line) {
        if (line[0] == 'y' && line[1] == 'e' && line[2] == 's') {
            char *colon = strchr(line, ':');
            if (colon) {
                snprintf(g_ssid, sizeof(g_ssid), "%s", colon + 1);
                return g_ssid;
            }
        }
        line = strtok(NULL, "\n");
    }
    return "";
}

const char *gea_embedded_wifi_get_ip(void) {
    static char ip[32] = { 0 };
    char buf[2048] = { 0 };
    if (run_capture("hostname -I 2>/dev/null", buf, sizeof(buf)) <= 0) return "";
    sscanf(buf, "%31s", ip);
    return ip;
}

const char *gea_embedded_wifi_get_mac(void) {
    static char mac[20] = { 0 };
    if (mac[0]) return mac;
    char buf[256] = { 0 };
    if (run_capture("cat /sys/class/net/wlan0/address 2>/dev/null", buf, sizeof(buf)) > 0) {
        sscanf(buf, "%19s", mac);
    }
    return mac;
}

void gea_embedded_wifi_configure(const char *ssid, const char *password) {
    if (!ssid) return;
    char cmd[512];
    if (password && *password) {
        snprintf(cmd, sizeof(cmd),
                 "nmcli device wifi connect '%s' password '%s' 2>/dev/null",
                 ssid, password);
    } else {
        snprintf(cmd, sizeof(cmd),
                 "nmcli device wifi connect '%s' 2>/dev/null", ssid);
    }
    int rc = system(cmd);
    if (rc != 0) {
        gea_logw("wifi: nmcli connect returned %d", rc);
    }
}

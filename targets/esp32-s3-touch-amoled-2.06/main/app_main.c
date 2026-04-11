#include "xsAll.h"
#include "xs.h"
#include "xsScript.h"

#include <stdio.h>
#include <stdarg.h>
#include <ctype.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <errno.h>
#include <stdint.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include "freertos/event_groups.h"
#include "esp_log.h"
#include "esp_attr.h"
#include "esp_wifi.h"
#include "esp_mac.h"
#include "esp_event.h"
#include "esp_netif.h"
#include "esp_heap_caps.h"
#include "esp_http_server.h"
#include "esp_ota_ops.h"
#include "esp_partition.h"
#include "esp_app_format.h"
#include "nvs_flash.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "lwip/sockets.h"

#include "wifi_config.h"
#include "apps.h"
#include "resident_apps.h"
#include "display.h"
#include "ui/ui.h"
#include "touch.h"
#include "event.h"
#include "image.h"
#include "ble.h"
#include "wifi.h"
#include "imu.h"
#include "esp_http_client.h"
#if GEA_EMBEDDED_ENABLE_HTTPS
#include "esp_crt_bundle.h"
#endif
#include "lwip/tcp.h"

static const char *TAG = "gea_embedded";

static SemaphoreHandle_t app_state_mutex = NULL;

static void *gea_embedded_malloc_prefer_spiram(size_t size)
{
	void *ptr = heap_caps_malloc(size, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
	if (ptr) return ptr;
	return malloc(size);
}

static void *gea_embedded_realloc_prefer_spiram(void *ptr, size_t size)
{
	void *next = heap_caps_realloc(ptr, size, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
	if (next) return next;
	if (!ptr) return malloc(size);
	return realloc(ptr, size);
}

static void app_state_lock(void)
{
	if (app_state_mutex) xSemaphoreTake(app_state_mutex, portMAX_DELAY);
}

static void app_state_unlock(void)
{
	if (app_state_mutex) xSemaphoreGive(app_state_mutex);
}

/* ---------- Diagnostics transport ---------- */

#define DIAG_PORT 8081
#define DIAG_FRAME_HEADER_SIZE 4
#define DIAG_MAX_FRAME_PAYLOAD 1024
#define DIAG_MAX_FRAME_SIZE (DIAG_FRAME_HEADER_SIZE + DIAG_MAX_FRAME_PAYLOAD)
#define DIAG_CHANNEL_LOG 1
#define DIAG_CHANNEL_MIRROR 2
#define DIAG_MIRROR_INTERVAL_MS 16
#define DIAG_BACKPRESSURE_DELAY_MS 250
#define DIAG_BACKPRESSURE_LOG_INTERVAL_MS 5000
#define DIAG_SOCKET_TIMEOUT_MS 2000
#define DIAG_CMD_ENABLE_MIRROR 'M'
#define DIAG_CMD_DISABLE_MIRROR 'm'
#define DIAG_FORWARD_LOGS_DURING_MIRROR 0
#define DIAG_MIRROR_DEBUG 0

#define LOG_RING_SIZE 256

static SemaphoreHandle_t log_mutex;
static char *log_ring = NULL;
static size_t log_ring_head = 0;
static size_t log_ring_used = 0;
static size_t log_ring_total = 0;

static void log_ring_write_locked(const char *data, size_t len)
{
	if (!log_ring) return;
	for (size_t i = 0; i < len; i++) {
		log_ring[log_ring_head] = data[i];
		log_ring_head = (log_ring_head + 1) % LOG_RING_SIZE;
		if (log_ring_used < LOG_RING_SIZE) log_ring_used++;
		log_ring_total++;
	}
}

static void log_ring_write(const char *data, size_t len)
{
	if (!data || len == 0 || !log_mutex) return;
	xSemaphoreTake(log_mutex, portMAX_DELAY);
	log_ring_write_locked(data, len);
	xSemaphoreGive(log_mutex);
}

static size_t log_ring_oldest_total(void)
{
	return (log_ring_total > log_ring_used) ? (log_ring_total - log_ring_used) : 0;
}

static size_t log_ring_latest_total(void)
{
	if (!log_mutex) return 0;
	xSemaphoreTake(log_mutex, portMAX_DELAY);
	size_t latest = log_ring_total;
	xSemaphoreGive(log_mutex);
	return latest;
}

static int log_ring_copy_since(size_t *cursor, char *dst, int cap)
{
	if (!cursor || !dst || cap <= 0 || !log_mutex) return 0;
	xSemaphoreTake(log_mutex, portMAX_DELAY);
	if (!log_ring) {
		xSemaphoreGive(log_mutex);
		return 0;
	}
	size_t oldest = log_ring_oldest_total();
	if (*cursor < oldest) *cursor = oldest;
	size_t available = (log_ring_total > *cursor) ? (log_ring_total - *cursor) : 0;
	if (available == 0) {
		xSemaphoreGive(log_mutex);
		return 0;
	}
	size_t count = available > (size_t)cap ? (size_t)cap : available;
	for (size_t i = 0; i < count; i++) {
		size_t absolute = *cursor + i;
		dst[i] = log_ring[absolute % LOG_RING_SIZE];
	}
	*cursor += count;
	xSemaphoreGive(log_mutex);
	return (int)count;
}

static int gea_embedded_log_vprintf(const char *fmt, va_list args)
{
	char buf[256];
	int len = vsnprintf(buf, sizeof(buf), fmt, args);
	if (len > 0) {
		int out_len = (len < (int)sizeof(buf)) ? len : (int)sizeof(buf) - 1;
		fwrite(buf, 1, out_len, stdout);
		log_ring_write(buf, (size_t)out_len);
	}
	return len;
}

static void gea_embedded_printf(const char *fmt, ...)
{
	char buf[256];
	va_list args;
	va_start(args, fmt);
	int len = vsnprintf(buf, sizeof(buf), fmt, args);
	va_end(args);
	if (len > 0) {
		int out_len = (len < (int)sizeof(buf)) ? len : (int)sizeof(buf) - 1;
		fwrite(buf, 1, out_len, stdout);
		log_ring_write(buf, (size_t)out_len);
	}
}

int gea_embedded_now_ms(void)
{
	return (int)(esp_timer_get_time() / 1000);
}

static void gea_embedded_log_heap_probe(const char *stage)
{
	uint32_t free_internal = heap_caps_get_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
	uint32_t largest_internal = heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
	uint32_t min_internal = heap_caps_get_minimum_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
	uint32_t free_psram = heap_caps_get_free_size(MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
	ESP_LOGI(TAG, "heap probe [%s] internal_free=%u internal_largest=%u internal_min=%u psram_free=%u",
	         stage ? stage : "?", (unsigned)free_internal, (unsigned)largest_internal,
	         (unsigned)min_internal, (unsigned)free_psram);
}

__attribute__((weak)) int gea_embedded_app_mirror_begin_snapshot(void)
{
	return 0;
}

__attribute__((weak)) int gea_embedded_app_mirror_begin_diff(void)
{
	return 0;
}

__attribute__((weak)) int gea_embedded_app_mirror_next_record(unsigned char *dst, int cap)
{
	(void)dst;
	(void)cap;
	return 0;
}

__attribute__((weak)) void gea_embedded_app_mirror_clear_dirty(void)
{
}

static int diag_is_backpressure_errno(int err)
{
	return err == EAGAIN || err == EWOULDBLOCK;
}

static int diag_send_pending(int fd, const unsigned char *data, int len, int *offset, int *err_out)
{
	if (err_out) *err_out = 0;
	if (!data || !offset || len <= 0) return 1;

	while (*offset < len) {
		int sent = send(fd, data + *offset, (size_t)(len - *offset), MSG_NOSIGNAL | MSG_DONTWAIT);
		if (sent < 0) {
			int err = errno;
			if (err == EINTR) continue;
			if (err_out) *err_out = err;
			return diag_is_backpressure_errno(err) ? 0 : -1;
		}
		if (sent == 0) {
			if (err_out) *err_out = ECONNRESET;
			return -1;
		}
		*offset += sent;
	}
	return 1;
}

static void diag_configure_client(int fd)
{
	struct timeval timeout = {
		.tv_sec = DIAG_SOCKET_TIMEOUT_MS / 1000,
		.tv_usec = (DIAG_SOCKET_TIMEOUT_MS % 1000) * 1000,
	};
	setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &timeout, sizeof(timeout));
	setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));
	int nodelay = 1;
	setsockopt(fd, IPPROTO_TCP, TCP_NODELAY, &nodelay, sizeof(nodelay));
}

static void diag_close_client(int *client_fd, const char *reason, int err)
{
	if (*client_fd < 0) return;
	if (err)
		ESP_LOGI(TAG, "Diagnostics client %s: errno=%d", reason, err);
	else
		ESP_LOGI(TAG, "Diagnostics client %s", reason);
	shutdown(*client_fd, SHUT_RDWR);
	close(*client_fd);
	*client_fd = -1;
}

static int diag_queue_frame(
	unsigned char *pending,
	int *pending_len,
	int *pending_offset,
	int channel,
	int type,
	const unsigned char *payload,
	int payload_len
)
{
	if (!pending || !pending_len || !pending_offset) return 0;
	if (payload_len < 0) payload_len = 0;
	if (payload_len > DIAG_MAX_FRAME_PAYLOAD) payload_len = DIAG_MAX_FRAME_PAYLOAD;
	pending[0] = (unsigned char)(channel & 0xFF);
	pending[1] = (unsigned char)(type & 0xFF);
	pending[2] = (unsigned char)(payload_len & 0xFF);
	pending[3] = (unsigned char)((payload_len >> 8) & 0xFF);
	if (payload && payload_len > 0 && payload != pending + DIAG_FRAME_HEADER_SIZE)
		memmove(pending + DIAG_FRAME_HEADER_SIZE, payload, (size_t)payload_len);
	*pending_len = DIAG_FRAME_HEADER_SIZE + payload_len;
	*pending_offset = 0;
	return 1;
}

static int mirror_make_error_record(unsigned char *dst, int cap, const char *message)
{
	if (!dst || cap < 2) return 0;
	if (!message) message = "store mirror is unavailable for this app";
	int msg_len = (int)strlen(message);
	if (msg_len > 255) msg_len = 255;
	if (msg_len > cap - 2) msg_len = cap - 2;
	if (msg_len < 0) msg_len = 0;
	dst[0] = 7; /* MIRROR_REC_ERROR */
	dst[1] = (unsigned char)(msg_len & 0xFF);
	if (msg_len > 0) memcpy(dst + 2, message, (size_t)msg_len);
	return msg_len + 2;
}

static void mirror_read_current_app_id(char *dst, size_t cap)
{
	if (!dst || cap == 0) return;
	dst[0] = '\0';
	app_state_lock();
	const char *app_id = gea_embedded_apps_get_current_id();
	if (app_id && app_id[0]) snprintf(dst, cap, "%s", app_id);
	app_state_unlock();
}

#if DIAG_MIRROR_DEBUG
static uint16_t mirror_read_u16(const unsigned char *src)
{
	return (uint16_t)src[0] | ((uint16_t)src[1] << 8);
}

static int32_t mirror_read_i32(const unsigned char *src)
{
	uint32_t raw = (uint32_t)src[0] |
	               ((uint32_t)src[1] << 8) |
	               ((uint32_t)src[2] << 16) |
	               ((uint32_t)src[3] << 24);
	return (int32_t)raw;
}

static uint32_t mirror_read_u32(const unsigned char *src)
{
	return (uint32_t)src[0] |
	       ((uint32_t)src[1] << 8) |
	       ((uint32_t)src[2] << 16) |
	       ((uint32_t)src[3] << 24);
}
#endif

static void mirror_log_record(const char *direction, const unsigned char *record, int len)
{
#if DIAG_MIRROR_DEBUG
	if (!record || len <= 0) return;
	switch (record[0]) {
	case 1: {
		int msg_kind = len > 1 ? record[1] : 0;
		int app_len = len > 2 ? record[2] : 0;
		if (app_len > len - 3) app_len = len > 3 ? len - 3 : 0;
		if (app_len < 0) app_len = 0;
		char app_id[64];
		int copy_len = app_len < (int)sizeof(app_id) - 1 ? app_len : (int)sizeof(app_id) - 1;
		if (copy_len > 0) memcpy(app_id, record + 3, (size_t)copy_len);
		app_id[copy_len] = '\0';
		if (len >= 3 + app_len + 6) {
			int schema_off = 3 + app_len;
			ESP_LOGI(TAG, "mirror %s begin type=%s app=%s fields=%u schema=0x%08lx len=%d",
			         direction,
			         msg_kind == 1 ? "snapshot" : (msg_kind == 2 ? "diff" : "unknown"),
			         app_id,
			         (unsigned)mirror_read_u16(record + schema_off),
			         (unsigned long)mirror_read_u32(record + schema_off + 2),
			         len);
		} else {
			ESP_LOGI(TAG, "mirror %s begin type=%s app=%s len=%d",
			         direction,
			         msg_kind == 1 ? "snapshot" : (msg_kind == 2 ? "diff" : "unknown"),
			         app_id,
			         len);
		}
		break;
	}
	case 2:
		if (len >= 7) ESP_LOGI(TAG, "mirror %s int field=%u value=%ld len=%d",
		                        direction,
		                        (unsigned)mirror_read_u16(record + 1),
		                        (long)mirror_read_i32(record + 3),
		                        len);
		else ESP_LOGI(TAG, "mirror %s int malformed len=%d", direction, len);
		break;
	case 3:
		if (len >= 5) ESP_LOGI(TAG, "mirror %s string field=%u bytes=%u len=%d",
		                        direction,
		                        (unsigned)mirror_read_u16(record + 1),
		                        (unsigned)mirror_read_u16(record + 3),
		                        len);
		else ESP_LOGI(TAG, "mirror %s string malformed len=%d", direction, len);
		break;
	case 4:
		if (len >= 5) ESP_LOGI(TAG, "mirror %s array_len field=%u value=%u len=%d",
		                        direction,
		                        (unsigned)mirror_read_u16(record + 1),
		                        (unsigned)mirror_read_u16(record + 3),
		                        len);
		else ESP_LOGI(TAG, "mirror %s array_len malformed len=%d", direction, len);
		break;
	case 5:
		if (len >= 10) ESP_LOGI(TAG, "mirror %s array_int field=%u index=%u subfield=%u value=%ld len=%d",
		                         direction,
		                         (unsigned)mirror_read_u16(record + 1),
		                         (unsigned)mirror_read_u16(record + 3),
		                         (unsigned)record[5],
		                         (long)mirror_read_i32(record + 6),
		                         len);
		else ESP_LOGI(TAG, "mirror %s array_int malformed len=%d", direction, len);
		break;
	case 8:
		if (len >= 7) ESP_LOGI(TAG, "mirror %s scroll node=%u y=%ld len=%d",
		                        direction,
		                        (unsigned)mirror_read_u16(record + 1),
		                        (long)mirror_read_i32(record + 3),
		                        len);
		else ESP_LOGI(TAG, "mirror %s scroll malformed len=%d", direction, len);
		break;
	case 6:
		ESP_LOGI(TAG, "mirror %s end len=%d", direction, len);
		break;
	case 7:
		ESP_LOGI(TAG, "mirror %s error len=%d", direction, len);
		break;
	default:
		ESP_LOGI(TAG, "mirror %s unknown kind=%u len=%d", direction, (unsigned)record[0], len);
		break;
	}
#else
	(void)direction;
	(void)record;
	(void)len;
#endif
}

static void diagnostics_server_task(void *arg)
{
	(void)arg;
	int server_fd = socket(AF_INET, SOCK_STREAM, 0);
	if (server_fd < 0) { vTaskDelete(NULL); return; }

	int opt = 1;
	setsockopt(server_fd, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));

	struct sockaddr_in addr = {
		.sin_family = AF_INET,
		.sin_port = htons(DIAG_PORT),
		.sin_addr.s_addr = INADDR_ANY,
	};
	if (bind(server_fd, (struct sockaddr *)&addr, sizeof(addr)) < 0 ||
	    listen(server_fd, 2) < 0) {
		ESP_LOGE(TAG, "Diagnostics server failed on port %d: errno=%d", DIAG_PORT, errno);
		close(server_fd);
		vTaskDelete(NULL);
		return;
	}

	ESP_LOGI(TAG, "Diagnostics transport listening on port %d", DIAG_PORT);

	int client_fd = -1;
	size_t log_cursor = 0;
	int mirror_enabled = 0;
	int mirror_force_snapshot = 1;
	int mirror_message_active = 0;
	unsigned char *mirror_buf = NULL;
	int mirror_cap = 0;
	int mirror_held_len = 0;
	int64_t next_mirror_at = 0;
	int64_t last_backpressure_log_at = 0;
	char mirror_app_id[64] = "";
	unsigned char pending[DIAG_MAX_FRAME_SIZE];
	int pending_len = 0;
	int pending_offset = 0;

	while (1) {
		fd_set read_fds;
		fd_set write_fds;
		FD_ZERO(&read_fds);
		FD_ZERO(&write_fds);
		FD_SET(server_fd, &read_fds);
		int max_fd = server_fd;
		int selected_client_fd = client_fd;
		int mirror_ready = 0;
		if (selected_client_fd >= 0) {
			FD_SET(selected_client_fd, &read_fds);
			if (pending_len > pending_offset) FD_SET(selected_client_fd, &write_fds);
			if (selected_client_fd > max_fd) max_fd = selected_client_fd;
#ifndef GEA_EMBEDDED_MIRROR_DISABLED
			if (mirror_enabled) {
				int64_t now = esp_timer_get_time();
				mirror_ready = mirror_message_active ||
				               mirror_force_snapshot ||
				               now >= next_mirror_at;
			}
#endif
		}

		struct timeval timeout = {
			.tv_sec = 0,
			.tv_usec = (pending_len > pending_offset || mirror_ready) ? 0 : DIAG_MIRROR_INTERVAL_MS * 1000,
		};
		int selected = select(max_fd + 1, &read_fds, &write_fds, NULL, &timeout);
		if (selected < 0) {
			if (errno != EINTR) ESP_LOGW(TAG, "Diagnostics select failed: errno=%d", errno);
			vTaskDelay(pdMS_TO_TICKS(DIAG_MIRROR_INTERVAL_MS));
			continue;
		}

		if (selected > 0 && FD_ISSET(server_fd, &read_fds)) {
			int next_client_fd = accept(server_fd, NULL, NULL);
			if (next_client_fd >= 0) {
				diag_configure_client(next_client_fd);
				if (client_fd >= 0) diag_close_client(&client_fd, "replaced by a new connection", 0);
				client_fd = next_client_fd;
				log_cursor = log_ring_oldest_total();
				mirror_enabled = 0;
				mirror_force_snapshot = 1;
				mirror_message_active = 0;
				mirror_held_len = 0;
				mirror_app_id[0] = '\0';
				next_mirror_at = 0;
				pending_len = 0;
				pending_offset = 0;
				if (mirror_buf) {
					free(mirror_buf);
					mirror_buf = NULL;
					mirror_cap = 0;
				}
				ESP_LOGI(TAG, "Diagnostics client connected");
			}
		}

		if (selected_client_fd >= 0 &&
		    client_fd == selected_client_fd &&
		    selected > 0 &&
		    FD_ISSET(selected_client_fd, &read_fds)) {
			char incoming[16];
			int received = recv(selected_client_fd, incoming, sizeof(incoming), MSG_DONTWAIT);
			if (received == 0) {
				diag_close_client(&client_fd, "disconnected", 0);
				mirror_enabled = 0;
				mirror_message_active = 0;
				mirror_held_len = 0;
				mirror_app_id[0] = '\0';
				pending_len = 0;
				pending_offset = 0;
				if (mirror_buf) {
					free(mirror_buf);
					mirror_buf = NULL;
					mirror_cap = 0;
				}
			} else if (received < 0 && errno != EAGAIN && errno != EWOULDBLOCK) {
				diag_close_client(&client_fd, "closed after receive error", errno);
				mirror_enabled = 0;
				mirror_message_active = 0;
				mirror_held_len = 0;
				mirror_app_id[0] = '\0';
				pending_len = 0;
				pending_offset = 0;
				if (mirror_buf) {
					free(mirror_buf);
					mirror_buf = NULL;
					mirror_cap = 0;
				}
			} else if (received > 0) {
				for (int i = 0; i < received; i++) {
					if (incoming[i] == DIAG_CMD_ENABLE_MIRROR) {
						ESP_LOGI(TAG, "mirror rx command enable");
						mirror_enabled = 1;
						mirror_force_snapshot = 1;
						mirror_message_active = 0;
						mirror_held_len = 0;
						mirror_app_id[0] = '\0';
					} else if (incoming[i] == DIAG_CMD_DISABLE_MIRROR) {
						ESP_LOGI(TAG, "mirror rx command disable");
						mirror_enabled = 0;
						mirror_message_active = 0;
						mirror_held_len = 0;
						mirror_app_id[0] = '\0';
						if (mirror_buf) {
							free(mirror_buf);
							mirror_buf = NULL;
							mirror_cap = 0;
						}
					}
				}
			}
		}

		if (client_fd < 0) continue;

		if (pending_len > pending_offset) {
			int send_errno = 0;
			int send_result = diag_send_pending(client_fd, pending, pending_len, &pending_offset, &send_errno);
			int64_t now = esp_timer_get_time();
			if (send_result > 0) {
				pending_len = 0;
				pending_offset = 0;
			} else if (send_result == 0) {
				if (now - last_backpressure_log_at >=
				    (int64_t)DIAG_BACKPRESSURE_LOG_INTERVAL_MS * 1000) {
					ESP_LOGW(TAG, "Diagnostics send backpressure: errno=%d", send_errno);
					last_backpressure_log_at = now;
				}
				vTaskDelay(pdMS_TO_TICKS(DIAG_BACKPRESSURE_DELAY_MS));
				continue;
			} else {
				diag_close_client(&client_fd, "closed after send error", send_errno);
				mirror_enabled = 0;
				mirror_message_active = 0;
				mirror_held_len = 0;
				mirror_app_id[0] = '\0';
				pending_len = 0;
				pending_offset = 0;
				if (mirror_buf) {
					free(mirror_buf);
					mirror_buf = NULL;
					mirror_cap = 0;
				}
				continue;
			}
		}

		int forward_logs = 1;
#ifndef GEA_EMBEDDED_MIRROR_DISABLED
#if !DIAG_FORWARD_LOGS_DURING_MIRROR
		if (mirror_enabled) forward_logs = 0;
#endif
#endif
		if (forward_logs) {
			char log_chunk[96];
			int log_len = log_ring_copy_since(&log_cursor, log_chunk, sizeof(log_chunk));
			if (log_len > 0) {
				diag_queue_frame(
					pending,
					&pending_len,
					&pending_offset,
					DIAG_CHANNEL_LOG,
					1,
					(const unsigned char *)log_chunk,
					log_len
				);
				continue;
			}
		} else {
			log_cursor = log_ring_latest_total();
		}

#ifndef GEA_EMBEDDED_MIRROR_DISABLED
		int64_t now = esp_timer_get_time();
		if (mirror_enabled) {
			char current_app_id[64];
			mirror_read_current_app_id(current_app_id, sizeof(current_app_id));
			if (strcmp(current_app_id, mirror_app_id) != 0) {
				ESP_LOGI(TAG, "mirror active app changed: '%s' -> '%s'", mirror_app_id, current_app_id);
				snprintf(mirror_app_id, sizeof(mirror_app_id), "%s", current_app_id);
				mirror_force_snapshot = 1;
				mirror_message_active = 0;
				mirror_held_len = 0;
				next_mirror_at = 0;
			}
		}

		if (mirror_enabled && !mirror_buf) {
			mirror_cap = DIAG_MAX_FRAME_PAYLOAD;
			mirror_buf = (unsigned char *)gea_embedded_malloc_prefer_spiram((size_t)mirror_cap);
			if (!mirror_buf) {
				unsigned char err_payload[96];
				int err_len = mirror_make_error_record(err_payload, sizeof(err_payload), "mirror alloc failed");
				mirror_log_record("tx", err_payload, err_len);
				diag_queue_frame(pending, &pending_len, &pending_offset, DIAG_CHANNEL_MIRROR, 1, err_payload, err_len);
				mirror_enabled = 0;
				continue;
			}
		}

		if (mirror_enabled && now >= next_mirror_at) {
			if (!mirror_message_active) {
				int is_snapshot = mirror_force_snapshot;
				app_state_lock();
				int started = is_snapshot
					? gea_embedded_app_mirror_begin_snapshot()
					: gea_embedded_app_mirror_begin_diff();
				app_state_unlock();
				if (started > 0) {
					if (is_snapshot) {
						ESP_LOGI(TAG, "mirror begin snapshot for app=%s", mirror_app_id);
					}
					mirror_message_active = 1;
					mirror_held_len = 0;
					mirror_force_snapshot = 0;
				} else if (mirror_force_snapshot) {
					unsigned char err_payload[160];
					int err_len = mirror_make_error_record(err_payload, sizeof(err_payload), "store mirror is unavailable for this app");
					mirror_log_record("tx", err_payload, err_len);
					diag_queue_frame(pending, &pending_len, &pending_offset, DIAG_CHANNEL_MIRROR, 1, err_payload, err_len);
					mirror_force_snapshot = 0;
					next_mirror_at = now + (int64_t)DIAG_MIRROR_INTERVAL_MS * 1000;
				} else {
					next_mirror_at = now + (int64_t)DIAG_MIRROR_INTERVAL_MS * 1000;
				}
			}
		}

		if (mirror_enabled && mirror_message_active && mirror_buf && pending_len == 0) {
			int batch_len = 0;
			unsigned char *batch = pending + DIAG_FRAME_HEADER_SIZE;
			while (batch_len < DIAG_MAX_FRAME_PAYLOAD) {
				int rec_len = mirror_held_len;
				if (rec_len <= 0) {
					app_state_lock();
					rec_len = gea_embedded_app_mirror_next_record(mirror_buf, mirror_cap);
					app_state_unlock();
				}
				if (rec_len <= 0) {
					mirror_message_active = 0;
					mirror_held_len = 0;
					next_mirror_at = now + (int64_t)DIAG_MIRROR_INTERVAL_MS * 1000;
					break;
				}
				if (rec_len > DIAG_MAX_FRAME_PAYLOAD) rec_len = DIAG_MAX_FRAME_PAYLOAD;
				if (batch_len > 0 && batch_len + rec_len > DIAG_MAX_FRAME_PAYLOAD) {
					mirror_held_len = rec_len;
					break;
				}
				mirror_log_record("tx", mirror_buf, rec_len);
				memcpy(batch + batch_len, mirror_buf, (size_t)rec_len);
				batch_len += rec_len;
				mirror_held_len = 0;
				if (mirror_buf[0] == 6 || mirror_buf[0] == 7) {
					mirror_message_active = 0;
					mirror_held_len = 0;
					next_mirror_at = now + (int64_t)DIAG_MIRROR_INTERVAL_MS * 1000;
					break;
				}
			}
			if (batch_len > 0)
				diag_queue_frame(pending, &pending_len, &pending_offset, DIAG_CHANNEL_MIRROR, 1, batch, batch_len);
		}
#endif
	}
}

static void start_diagnostics_server(void)
{
	log_mutex = xSemaphoreCreateMutex();
	if (!log_mutex) return;
	log_ring = (char *)gea_embedded_malloc_prefer_spiram(LOG_RING_SIZE);
	if (!log_ring) {
		ESP_LOGW(TAG, "Diagnostics log ring allocation failed; continuing without ring replay");
	}
	xSemaphoreTake(log_mutex, portMAX_DELAY);
	log_ring_head = 0;
	log_ring_used = 0;
	log_ring_total = 0;
	xSemaphoreGive(log_mutex);
	esp_log_set_vprintf(gea_embedded_log_vprintf);
	xTaskCreate(diagnostics_server_task, "diag_srv", 6144, NULL, 5, NULL);
}

/* ---------- XS script plumbing ---------- */

#ifndef GEA_EMBEDDED_PURE_C

#ifdef GEA_EMBEDDED_SOURCE_AT_BOOT
extern const char gea_embedded_js_source[];
#else
extern txScript xsScript;

static txScript* gea_embedded_heap_script(void)
{
	txScript* s = c_malloc(sizeof(txScript));
	if (!s) return NULL;
	*s = xsScript;
	s->symbolsBuffer = c_malloc(s->symbolsSize);
	if (s->symbolsBuffer)
		c_memcpy(s->symbolsBuffer, xsScript.symbolsBuffer, s->symbolsSize);
	s->codeBuffer = c_malloc(s->codeSize);
	if (s->codeBuffer)
		c_memcpy(s->codeBuffer, xsScript.codeBuffer, s->codeSize);
	return s;
}
#endif

/* ---------- console.log ---------- */

static void gea_embedded_print_value(xsMachine* the, xsSlot slot)
{
	xsType type = xsTypeOf(slot);
	if (type == xsUndefinedType) {
		gea_embedded_printf("undefined");
	}
	else if (type == xsNullType) {
		gea_embedded_printf("null");
	}
	else if (type == xsReferenceType) {
		xsTry {
			xsSlot json = xsGet(xsGlobal, xsID("JSON"));
			xsSlot str = xsCall3(json, xsID("stringify"), slot, xsNull, xsInteger(2));
			if (xsTypeOf(str) == xsUndefinedType)
				gea_embedded_printf("%s", xsToString(slot));
			else
				gea_embedded_printf("%s", xsToString(str));
		}
		xsCatch {
			gea_embedded_printf("%s", xsToString(slot));
			xsException = xsUndefined;
		}
	}
	else {
		gea_embedded_printf("%s", xsToString(slot));
	}
}

static void gea_embedded_console_log(xsMachine* the)
{
	xsIntegerValue argc = xsToInteger(xsArgc);
	for (xsIntegerValue i = 0; i < argc; i++) {
		if (i > 0) gea_embedded_printf(" ");
		gea_embedded_print_value(the, xsArg(i));
	}
	gea_embedded_printf("\n");
}

/* ---------- screen.print / screen.clear ---------- */

static void gea_embedded_screen_print(xsMachine* the)
{
	xsIntegerValue argc = xsToInteger(xsArgc);
	for (xsIntegerValue i = 0; i < argc; i++) {
		const char *str = xsToString(xsArg(i));
		gea_embedded_display_print(str);
	}
}

static void gea_embedded_screen_clear(xsMachine* the)
{
	(void)the;
	gea_embedded_display_clear();
}

/* ---------- screen drawing primitives ---------- */

static void gea_embedded_screen_fill_rect(xsMachine* the)
{
	int x = xsToInteger(xsArg(0));
	int y = xsToInteger(xsArg(1));
	int w = xsToInteger(xsArg(2));
	int h = xsToInteger(xsArg(3));
	uint16_t c = (uint16_t)xsToInteger(xsArg(4));
	gea_embedded_display_fill_rect(x, y, w, h, c);
}

static void gea_embedded_screen_stroke_rect(xsMachine* the)
{
	int x = xsToInteger(xsArg(0));
	int y = xsToInteger(xsArg(1));
	int w = xsToInteger(xsArg(2));
	int h = xsToInteger(xsArg(3));
	uint16_t c = (uint16_t)xsToInteger(xsArg(4));
	gea_embedded_display_stroke_rect(x, y, w, h, c);
}

static void gea_embedded_screen_fill_circle(xsMachine* the)
{
	int cx = xsToInteger(xsArg(0));
	int cy = xsToInteger(xsArg(1));
	int r = xsToInteger(xsArg(2));
	uint16_t c = (uint16_t)xsToInteger(xsArg(3));
	gea_embedded_display_fill_circle(cx, cy, r, c);
}

static void gea_embedded_screen_stroke_circle(xsMachine* the)
{
	int cx = xsToInteger(xsArg(0));
	int cy = xsToInteger(xsArg(1));
	int r = xsToInteger(xsArg(2));
	uint16_t c = (uint16_t)xsToInteger(xsArg(3));
	gea_embedded_display_stroke_circle(cx, cy, r, c);
}

static void gea_embedded_screen_draw_line(xsMachine* the)
{
	int x0 = xsToInteger(xsArg(0));
	int y0 = xsToInteger(xsArg(1));
	int x1 = xsToInteger(xsArg(2));
	int y1 = xsToInteger(xsArg(3));
	uint16_t c = (uint16_t)xsToInteger(xsArg(4));
	gea_embedded_display_draw_line(x0, y0, x1, y1, c);
}

static void gea_embedded_screen_draw_arc(xsMachine* the)
{
	int cx = xsToInteger(xsArg(0));
	int cy = xsToInteger(xsArg(1));
	int r = xsToInteger(xsArg(2));
	int s = xsToInteger(xsArg(3));
	int e = xsToInteger(xsArg(4));
	uint16_t c = (uint16_t)xsToInteger(xsArg(5));
	gea_embedded_display_draw_arc(cx, cy, r, s, e, c);
}

static void gea_embedded_screen_fill_triangle(xsMachine* the)
{
	int x0 = xsToInteger(xsArg(0));
	int y0 = xsToInteger(xsArg(1));
	int x1 = xsToInteger(xsArg(2));
	int y1 = xsToInteger(xsArg(3));
	int x2 = xsToInteger(xsArg(4));
	int y2 = xsToInteger(xsArg(5));
	uint16_t c = (uint16_t)xsToInteger(xsArg(6));
	gea_embedded_display_fill_triangle(x0, y0, x1, y1, x2, y2, c);
}

static void gea_embedded_screen_draw_text(xsMachine* the)
{
	const char *text = xsToString(xsArg(0));
	int x = xsToInteger(xsArg(1));
	int y = xsToInteger(xsArg(2));
	uint16_t c = (uint16_t)xsToInteger(xsArg(3));
	int scale = (xsToInteger(xsArgc) > 4) ? xsToInteger(xsArg(4)) : 1;
	gea_embedded_display_draw_text(text, x, y, c, scale);
}

static void gea_embedded_screen_set_pixel(xsMachine* the)
{
	int x = xsToInteger(xsArg(0));
	int y = xsToInteger(xsArg(1));
	uint16_t c = (uint16_t)xsToInteger(xsArg(2));
	gea_embedded_display_set_pixel(x, y, c);
}

static void gea_embedded_screen_color(xsMachine* the)
{
	int r = xsToInteger(xsArg(0));
	int g = xsToInteger(xsArg(1));
	int b = xsToInteger(xsArg(2));
	xsResult = xsInteger(((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3));
}

static void gea_embedded_screen_flush(xsMachine* the)
{
	gea_embedded_display_flush();
}

static void gea_embedded_screen_push_clip(xsMachine* the)
{
	int x = xsToInteger(xsArg(0));
	int y = xsToInteger(xsArg(1));
	int w = xsToInteger(xsArg(2));
	int h = xsToInteger(xsArg(3));
	gea_embedded_display_push_clip(x, y, w, h);
}

static void gea_embedded_screen_pop_clip(xsMachine* the)
{
	gea_embedded_display_pop_clip();
}

static void gea_embedded_screen_set_alpha(xsMachine* the)
{
	int a = xsToInteger(xsArg(0));
	gea_embedded_display_set_alpha((uint8_t)a);
}

static void gea_embedded_screen_fill_rounded_rect(xsMachine* the)
{
	int x = xsToInteger(xsArg(0));
	int y = xsToInteger(xsArg(1));
	int w = xsToInteger(xsArg(2));
	int h = xsToInteger(xsArg(3));
	int tl = xsToInteger(xsArg(4));
	int tr = xsToInteger(xsArg(5));
	int br = xsToInteger(xsArg(6));
	int bl = xsToInteger(xsArg(7));
	uint16_t c = (uint16_t)xsToInteger(xsArg(8));
	gea_embedded_display_fill_rounded_rect(x, y, w, h, tl, tr, br, bl, c);
}

static void gea_embedded_screen_stroke_rounded_rect(xsMachine* the)
{
	int x = xsToInteger(xsArg(0));
	int y = xsToInteger(xsArg(1));
	int w = xsToInteger(xsArg(2));
	int h = xsToInteger(xsArg(3));
	int tl = xsToInteger(xsArg(4));
	int tr = xsToInteger(xsArg(5));
	int br = xsToInteger(xsArg(6));
	int bl = xsToInteger(xsArg(7));
	int lw = xsToInteger(xsArg(8));
	uint16_t c = (uint16_t)xsToInteger(xsArg(9));
	gea_embedded_display_stroke_rounded_rect(x, y, w, h, tl, tr, br, bl, lw, c);
}

/* ---------- HTTP + fetch ---------- */

#define GEA_EMBEDDED_HTTP_MAX_SIZE (2 * 1024 * 1024)
#define GEA_EMBEDDED_HTTP_MAX_HEADERS 64

typedef struct {
	char *name;
	char *value;
} gea_embedded_http_header_t;

typedef struct {
	uint8_t *data;
	int len;
	int status;
	gea_embedded_http_header_t *headers;
	int header_count;
	int header_capacity;
} gea_embedded_http_result_t;

typedef struct {
	const char *data;
	int len;
} gea_embedded_fetch_body_t;

static char *gea_embedded_lowercase_copy(const char *value)
{
	size_t len = strlen(value);
	char *out = (char *)gea_embedded_malloc_prefer_spiram(len + 1);
	if (!out) return NULL;
	for (size_t i = 0; i < len; i++) {
		out[i] = (char)tolower((unsigned char)value[i]);
	}
	out[len] = '\0';
	return out;
}

static void gea_embedded_http_result_free_headers(gea_embedded_http_result_t *result)
{
	for (int i = 0; i < result->header_count; i++) {
		free(result->headers[i].name);
		free(result->headers[i].value);
	}
	free(result->headers);
	result->headers = NULL;
	result->header_count = 0;
	result->header_capacity = 0;
}

static bool gea_embedded_http_result_append_header_value(gea_embedded_http_header_t *header, const char *value)
{
	const char *next_value = value ? value : "";
	if (header->value[0] == '\0') {
		char *replacement = strdup(next_value);
		if (!replacement) return false;
		free(header->value);
		header->value = replacement;
		return true;
	}

	size_t existing_len = strlen(header->value);
	size_t next_len = strlen(next_value);
	char *merged = (char *)gea_embedded_malloc_prefer_spiram(existing_len + 2 + next_len + 1);
	if (!merged) return false;
	memcpy(merged, header->value, existing_len);
	memcpy(merged + existing_len, ", ", 2);
	memcpy(merged + existing_len + 2, next_value, next_len + 1);
	free(header->value);
	header->value = merged;
	return true;
}

static void gea_embedded_http_result_add_header(gea_embedded_http_result_t *result, const char *name, const char *value)
{
	if (!result || !name || name[0] == '\0') return;

	char *lower_name = gea_embedded_lowercase_copy(name);
	if (!lower_name) return;

	for (int i = 0; i < result->header_count; i++) {
		if (strcmp(result->headers[i].name, lower_name) == 0) {
			gea_embedded_http_result_append_header_value(&result->headers[i], value);
			free(lower_name);
			return;
		}
	}

	if (result->header_count >= GEA_EMBEDDED_HTTP_MAX_HEADERS) {
		free(lower_name);
		return;
	}

	if (result->header_count == result->header_capacity) {
		int next_capacity = result->header_capacity ? result->header_capacity * 2 : 8;
		if (next_capacity > GEA_EMBEDDED_HTTP_MAX_HEADERS) next_capacity = GEA_EMBEDDED_HTTP_MAX_HEADERS;
		gea_embedded_http_header_t *next = (gea_embedded_http_header_t *)realloc(
			result->headers, next_capacity * sizeof(gea_embedded_http_header_t));
		if (!next) {
			free(lower_name);
			return;
		}
		result->headers = next;
		result->header_capacity = next_capacity;
	}

	char *copied_value = strdup(value ? value : "");
	if (!copied_value) {
		free(lower_name);
		return;
	}

	result->headers[result->header_count].name = lower_name;
	result->headers[result->header_count].value = copied_value;
	result->header_count++;
}

static esp_err_t gea_embedded_http_event_handler(esp_http_client_event_t *event)
{
	if (event->event_id == HTTP_EVENT_ON_HEADER) {
		gea_embedded_http_result_t *result = (gea_embedded_http_result_t *)event->user_data;
		gea_embedded_http_result_add_header(result, event->header_key, event->header_value);
	}
	return ESP_OK;
}

static bool gea_embedded_fetch_body_from_array_buffer(xsMachine *the, xsSlot body, gea_embedded_fetch_body_t *out)
{
	void *buffer = NULL;
	int len = 0;
	bool ok = false;

	xsTry {
		buffer = xsToArrayBuffer(body);
		len = xsGetArrayBufferLength(body);
		ok = true;
	}
	xsCatch {
		xsException = xsUndefined;
		ok = false;
	}

	if (!ok) return false;
	out->data = (const char *)buffer;
	out->len = len;
	return true;
}

static bool gea_embedded_fetch_body_from_view(xsMachine *the, xsSlot body, gea_embedded_fetch_body_t *out)
{
	if (xsTypeOf(body) != xsReferenceType) return false;
	if (!xsHas(body, xsID("buffer")) || !xsHas(body, xsID("byteLength"))) return false;

	xsSlot buffer_slot = xsGet(body, xsID("buffer"));
	int offset = 0;
	int len = 0;
	if (xsHas(body, xsID("byteOffset"))) {
		xsSlot offset_slot = xsGet(body, xsID("byteOffset"));
		offset = xsToInteger(offset_slot);
	}
	xsSlot length_slot = xsGet(body, xsID("byteLength"));
	len = xsToInteger(length_slot);
	if (offset < 0 || len < 0) return false;

	void *buffer = NULL;
	int buffer_len = 0;
	bool ok = false;
	xsTry {
		buffer = xsToArrayBuffer(buffer_slot);
		buffer_len = xsGetArrayBufferLength(buffer_slot);
		ok = true;
	}
	xsCatch {
		xsException = xsUndefined;
		ok = false;
	}

	if (!ok || offset > buffer_len || len > (buffer_len - offset)) return false;
	out->data = (const char *)buffer + offset;
	out->len = len;
	return true;
}

static void gea_embedded_fetch_body_from_init(xsMachine *the, xsSlot init, gea_embedded_fetch_body_t *out)
{
	memset(out, 0, sizeof(*out));
	if (xsTypeOf(init) != xsReferenceType || !xsHas(init, xsID("body"))) return;

	xsSlot body = xsGet(init, xsID("body"));
	xsType body_type = xsTypeOf(body);
	if (body_type == xsUndefinedType || body_type == xsNullType) return;

	if (body_type == xsStringType || body_type == xsStringXType) {
		const char *text = xsToString(body);
		out->data = text;
		out->len = strlen(text);
		return;
	}

	if (body_type == xsReferenceType) {
		if (gea_embedded_fetch_body_from_array_buffer(the, body, out)) return;
		if (gea_embedded_fetch_body_from_view(the, body, out)) return;
	}

	xsTypeError("fetch body must be a string, ArrayBuffer, or typed array");
}

static void gea_embedded_apply_fetch_headers(xsMachine *the, esp_http_client_handle_t client, xsSlot init)
{
	if (xsTypeOf(init) != xsReferenceType || !xsHas(init, xsID("headers"))) return;

	xsSlot headers = xsGet(init, xsID("headers"));
	if (xsTypeOf(headers) != xsReferenceType) return;

	xsSlot object_ctor = xsGet(xsGlobal, xsID("Object"));
	xsSlot keys = xsCall1(object_ctor, xsID("keys"), headers);
	xsSlot length_slot = xsGet(keys, xsID("length"));
	int length = xsToInteger(length_slot);

	for (int i = 0; i < length; i++) {
		xsSlot key_slot = xsGetIndex(keys, i);
		const char *name = xsToString(key_slot);
		if (!name || name[0] == '\0') continue;

		xsIdentifier key_id = xsToID(key_slot);
		xsSlot value_slot = xsGet(headers, key_id);
		xsType value_type = xsTypeOf(value_slot);
		if (value_type == xsUndefinedType || value_type == xsNullType) continue;

		const char *value = xsToString(value_slot);
		esp_http_client_set_header(client, name, value);
	}
}

static esp_http_client_method_t gea_embedded_fetch_method_from_init(xsMachine *the, xsSlot init)
{
	if (xsTypeOf(init) != xsReferenceType || !xsHas(init, xsID("method"))) return HTTP_METHOD_GET;

	const char *method = xsToString(xsGet(init, xsID("method")));
	if (strcasecmp(method, "POST") == 0) return HTTP_METHOD_POST;
	if (strcasecmp(method, "PUT") == 0) return HTTP_METHOD_PUT;
	if (strcasecmp(method, "PATCH") == 0) return HTTP_METHOD_PATCH;
	if (strcasecmp(method, "DELETE") == 0) return HTTP_METHOD_DELETE;
	if (strcasecmp(method, "HEAD") == 0) return HTTP_METHOD_HEAD;
	return HTTP_METHOD_GET;
}

static int gea_embedded_write_fetch_body(esp_http_client_handle_t client, const gea_embedded_fetch_body_t *body)
{
	int total = 0;
	while (total < body->len) {
		int written = esp_http_client_write(client, body->data + total, body->len - total);
		if (written <= 0) return -1;
		total += written;
	}
	return 0;
}

static int gea_embedded_http_fetch(xsMachine *the, const char *url, xsSlot init, gea_embedded_http_result_t *out)
{
	memset(out, 0, sizeof(*out));
	out->status = 0;

	gea_embedded_fetch_body_t request_body;
	gea_embedded_fetch_body_from_init(the, init, &request_body);

	esp_http_client_config_t config = {
		.url = url,
		.timeout_ms = 10000,
#if GEA_EMBEDDED_ENABLE_HTTPS
		.crt_bundle_attach = esp_crt_bundle_attach,
#endif
		.event_handler = gea_embedded_http_event_handler,
		.user_data = out,
	};
	esp_http_client_handle_t client = esp_http_client_init(&config);
	if (!client) {
		ESP_LOGE(TAG, "fetch: http client init failed");
		return -1;
	}

	esp_http_client_set_method(client, gea_embedded_fetch_method_from_init(the, init));
	gea_embedded_apply_fetch_headers(the, client, init);

	esp_err_t err = esp_http_client_open(client, request_body.len);
	if (err != ESP_OK) {
		ESP_LOGE(TAG, "fetch: http open failed: %s", esp_err_to_name(err));
		esp_http_client_cleanup(client);
		return -1;
	}

	if (request_body.len > 0 && gea_embedded_write_fetch_body(client, &request_body) != 0) {
		ESP_LOGE(TAG, "fetch: http write failed");
		esp_http_client_close(client);
		esp_http_client_cleanup(client);
		return -1;
	}

	int content_length = esp_http_client_fetch_headers(client);
	out->status = esp_http_client_get_status_code(client);
	ESP_LOGI(TAG, "fetch: %s status=%d request_body=%d content_length=%d", url, out->status, request_body.len, content_length);

	int capacity = content_length > 0 ? content_length : 4096;
	if (capacity > GEA_EMBEDDED_HTTP_MAX_SIZE) capacity = GEA_EMBEDDED_HTTP_MAX_SIZE;
	uint8_t *data = (uint8_t *)gea_embedded_malloc_prefer_spiram(capacity);
	if (!data) {
		ESP_LOGE(TAG, "fetch: malloc(%d) failed", capacity);
		esp_http_client_close(client);
		esp_http_client_cleanup(client);
		return -1;
	}

	int total = 0;
	while (total < GEA_EMBEDDED_HTTP_MAX_SIZE) {
		if (total == capacity) {
			int next_capacity = capacity * 2;
			if (next_capacity > GEA_EMBEDDED_HTTP_MAX_SIZE) next_capacity = GEA_EMBEDDED_HTTP_MAX_SIZE;
			if (next_capacity <= capacity) break;
			uint8_t *next = (uint8_t *)gea_embedded_realloc_prefer_spiram(data, next_capacity);
			if (!next) break;
			data = next;
			capacity = next_capacity;
		}

		int to_read = capacity - total;
		int read_len = esp_http_client_read(client, (char *)data + total, to_read);
		if (read_len <= 0) break;
		total += read_len;
	}

	esp_http_client_close(client);
	esp_http_client_cleanup(client);

	out->data = data;
	out->len = total;
	return total > 0 || out->status > 0 ? 0 : -1;
}

static void gea_embedded_fetch_text(xsMachine* the)
{
	xsSlot bytes = xsGet(xsThis, xsID("_bodyBytes"));
	void *buf = xsToArrayBuffer(bytes);
	int len = xsGetArrayBufferLength(bytes);
	xsResult = xsStringBuffer((xsStringValue)buf, len);
}

static void gea_embedded_fetch_json(xsMachine* the)
{
	xsVars(2);
	xsSlot bytes = xsGet(xsThis, xsID("_bodyBytes"));
	void *buf = xsToArrayBuffer(bytes);
	int len = xsGetArrayBufferLength(bytes);
	xsVar(0) = xsStringBuffer((xsStringValue)buf, len);
	xsVar(1) = xsGet(xsGlobal, xsID("JSON"));
	xsResult = xsCall1(xsVar(1), xsID("parse"), xsVar(0));
}

static void gea_embedded_fetch_array_buffer(xsMachine* the)
{
	xsResult = xsGet(xsThis, xsID("_bodyBytes"));
}

static void gea_embedded_fetch_headers_get(xsMachine* the)
{
	if (xsToInteger(xsArgc) < 1) {
		xsResult = xsNull;
		return;
	}

	const char *name = xsToString(xsArg(0));
	char *key = gea_embedded_lowercase_copy(name);
	if (!key) {
		xsResult = xsNull;
		return;
	}

	xsSlot values = xsGet(xsThis, xsID("_values"));
	xsIdentifier id = xsID(key);
	free(key);

	if (xsTypeOf(values) == xsReferenceType && xsHas(values, id)) {
		xsResult = xsGet(values, id);
	} else {
		xsResult = xsNull;
	}
}

static void gea_embedded_fetch_headers_has(xsMachine* the)
{
	if (xsToInteger(xsArgc) < 1) {
		xsResult = xsBoolean(false);
		return;
	}

	const char *name = xsToString(xsArg(0));
	char *key = gea_embedded_lowercase_copy(name);
	if (!key) {
		xsResult = xsBoolean(false);
		return;
	}

	xsSlot values = xsGet(xsThis, xsID("_values"));
	xsIdentifier id = xsID(key);
	free(key);

	bool found = false;
	if (xsTypeOf(values) == xsReferenceType) {
		found = xsHas(values, id);
	}
	xsResult = xsBoolean(found);
}

static void gea_embedded_fetch_headers_for_each(xsMachine* the)
{
	if (xsToInteger(xsArgc) < 1 || xsTypeOf(xsArg(0)) != xsReferenceType) return;

	xsVars(6);
	xsVar(0) = xsGet(xsThis, xsID("_values"));
	if (xsTypeOf(xsVar(0)) != xsReferenceType) return;

	xsVar(1) = xsEnumerate(xsVar(0));
	xsVar(2) = xsArg(0);
	xsVar(5) = xsToInteger(xsArgc) > 1 ? xsArg(1) : xsUndefined;

	while (true) {
		xsVar(3) = xsCall0(xsVar(1), xsID("next"));
		xsVar(4) = xsGet(xsVar(3), xsID("done"));
		if (xsToBoolean(xsVar(4))) break;

		xsVar(3) = xsGet(xsVar(3), xsID("value"));
		xsIdentifier id = xsToID(xsVar(3));
		xsVar(4) = xsGet(xsVar(0), id);
		xsCallFunction3(xsVar(2), xsVar(5), xsVar(4), xsVar(3), xsThis);
	}
}

static void gea_embedded_fetch(xsMachine* the)
{
	xsVars(5);

	const char *url = xsToString(xsArg(0));
	xsSlot init = xsToInteger(xsArgc) > 1 ? xsArg(1) : xsUndefined;
	ESP_LOGI(TAG, "fetch: %s", url);

	gea_embedded_http_result_t result;
	int rc = gea_embedded_http_fetch(the, url, init, &result);

	xsVar(0) = xsNewObject();
	xsSet(xsVar(0), xsID("url"), xsString(url));
	xsSet(xsVar(0), xsID("status"), xsInteger(result.status));
	xsSet(xsVar(0), xsID("ok"), xsBoolean(result.status >= 200 && result.status < 300));
	xsSet(xsVar(0), xsID("bodyUsed"), xsBoolean(false));
	xsSet(xsVar(0), xsID("_bodyBytes"), xsArrayBuffer(result.data, result.len));

	xsVar(1) = xsNewObject();
	xsVar(2) = xsNewObject();
	for (int i = 0; i < result.header_count; i++) {
		xsSet(xsVar(2), xsID(result.headers[i].name), xsString(result.headers[i].value));
	}
	xsSet(xsVar(1), xsID("_values"), xsVar(2));
	xsVar(3) = xsNewHostFunction(gea_embedded_fetch_headers_get, 1);
	xsSet(xsVar(1), xsID("get"), xsVar(3));
	xsVar(3) = xsNewHostFunction(gea_embedded_fetch_headers_has, 1);
	xsSet(xsVar(1), xsID("has"), xsVar(3));
	xsVar(3) = xsNewHostFunction(gea_embedded_fetch_headers_for_each, 1);
	xsSet(xsVar(1), xsID("forEach"), xsVar(3));
	xsSet(xsVar(0), xsID("headers"), xsVar(1));

	xsVar(3) = xsNewHostFunction(gea_embedded_fetch_text, 0);
	xsSet(xsVar(0), xsID("text"), xsVar(3));
	xsVar(3) = xsNewHostFunction(gea_embedded_fetch_json, 0);
	xsSet(xsVar(0), xsID("json"), xsVar(3));
	xsVar(3) = xsNewHostFunction(gea_embedded_fetch_array_buffer, 0);
	xsSet(xsVar(0), xsID("arrayBuffer"), xsVar(3));

	free(result.data);
	gea_embedded_http_result_free_headers(&result);

	xsVar(3) = xsGet(xsGlobal, xsID("Promise"));
	xsResult = xsCall1(xsVar(3), xsID("resolve"), xsVar(0));

	(void)rc;
}

/* ---------- Image loading ---------- */

static void gea_embedded_image_load_bytes(xsMachine* the)
{
	void *buf = xsToArrayBuffer(xsArg(0));
	int len = xsGetArrayBufferLength(xsArg(0));
	int id = gea_embedded_image_decode((const uint8_t *)buf, len, -1);
	xsResult = xsInteger(id);
}

static void gea_embedded_image_load_url(xsMachine* the)
{
	const char *url = xsToString(xsArg(0));
	ESP_LOGI(TAG, "image_load_url: %s", url);

	gea_embedded_http_result_t result;
	int rc = gea_embedded_http_fetch(the, url, xsUndefined, &result);
	ESP_LOGI(TAG, "image_load_url: downloaded %d bytes, status=%d", result.len, result.status);

	int id = -1;
	if (rc == 0 && result.len > 0) {
		ESP_LOGI(TAG, "image_load_url: decoding %d bytes (format=0x%02x%02x%02x)...",
			result.len, result.data[0], result.data[1], result.data[2]);
		id = gea_embedded_image_decode(result.data, result.len, -1);
		ESP_LOGI(TAG, "image_load_url: decode result id=%d", id);
	} else {
		ESP_LOGE(TAG, "image_load_url: no data downloaded");
	}

	free(result.data);
	gea_embedded_http_result_free_headers(&result);
	xsResult = xsInteger(id);
}

static void gea_embedded_image_width_fn(xsMachine* the)
{
	int id = xsToInteger(xsArg(0));
	xsResult = xsInteger(gea_embedded_image_width(id));
}

static void gea_embedded_image_height_fn(xsMachine* the)
{
	int id = xsToInteger(xsArg(0));
	xsResult = xsInteger(gea_embedded_image_height(id));
}

static void gea_embedded_image_frame_count_fn(xsMachine* the)
{
	int id = xsToInteger(xsArg(0));
	xsResult = xsInteger(gea_embedded_image_frame_count(id));
}

static void gea_embedded_image_is_animated_fn(xsMachine* the)
{
	int id = xsToInteger(xsArg(0));
	xsResult = xsBoolean(gea_embedded_image_is_animated(id));
}

static void gea_embedded_image_set_playing_fn(xsMachine* the)
{
	int id = xsToInteger(xsArg(0));
	int playing = xsToInteger(xsArg(1));
	gea_embedded_image_set_playing(id, playing);
}

static void gea_embedded_image_seek_fn(xsMachine* the)
{
	int id = xsToInteger(xsArg(0));
	int frame = xsToInteger(xsArg(1));
	gea_embedded_image_seek(id, frame);
}

static void gea_embedded_image_dispose_fn(xsMachine* the)
{
	gea_embedded_image_dispose(xsToInteger(xsArg(0)));
}

static void gea_embedded_image_draw_fn(xsMachine* the)
{
	int id = xsToInteger(xsArg(0));
	int dx = xsToInteger(xsArg(1));
	int dy = xsToInteger(xsArg(2));
	const uint16_t *pixels = gea_embedded_image_current_pixels(id);
	if (pixels) {
		int w = gea_embedded_image_width(id);
		int h = gea_embedded_image_height(id);
		gea_embedded_display_blit_image(pixels, w, h, dx, dy);
	}
}

static void gea_embedded_image_draw_scaled_fn(xsMachine* the)
{
	int id = xsToInteger(xsArg(0));
	int dx = xsToInteger(xsArg(1));
	int dy = xsToInteger(xsArg(2));
	int dw = xsToInteger(xsArg(3));
	int dh = xsToInteger(xsArg(4));
	const uint16_t *pixels = gea_embedded_image_current_pixels(id);
	if (pixels) {
		int w = gea_embedded_image_width(id);
		int h = gea_embedded_image_height(id);
		gea_embedded_display_blit_image_scaled(pixels, w, h, dx, dy, dw, dh);
	}
}

static void gea_embedded_image_advance_fn(xsMachine* the)
{
	int id = xsToInteger(xsArg(0));
	int delta = xsToInteger(xsArg(1));
	xsResult = xsBoolean(gea_embedded_image_advance(id, delta));
}

static void gea_embedded_accelerometer_read_fn(xsMachine* the)
{
	xsVars(1);
	xsVar(0) = xsNewObject();
	xsSet(xsVar(0), xsID("x"), xsInteger((int)gea_embedded_imu_get_acceleration_x()));
	xsSet(xsVar(0), xsID("y"), xsInteger((int)gea_embedded_imu_get_acceleration_y()));
	xsSet(xsVar(0), xsID("z"), xsInteger((int)gea_embedded_imu_get_acceleration_z()));
	xsSet(xsVar(0), xsID("tiltX"), xsInteger(gea_embedded_imu_get_tilt_x()));
	xsSet(xsVar(0), xsID("tiltY"), xsInteger(gea_embedded_imu_get_tilt_y()));
	xsSet(xsVar(0), xsID("mouseButtons"), xsInteger(gea_embedded_imu_get_mouse_buttons()));
	xsSet(xsVar(0), xsID("timestamp"), xsInteger(0));
	xsResult = xsVar(0);
}

static void gea_embedded_accelerometer_start_fn(xsMachine* the)
{
	gea_embedded_imu_init();
}

static void gea_embedded_accelerometer_stop_fn(xsMachine* the)
{
	gea_embedded_imu_close();
}

static void gea_embedded_accelerometer_calibrate_fn(xsMachine* the)
{
	gea_embedded_imu_calibrate_bias();
}

static void gea_embedded_touch_read_fn(xsMachine* the)
{
	int x = 0;
	int y = 0;
	int touching = gea_embedded_touch_read_cached(&x, &y);
	xsVars(1);
	xsVar(0) = xsNewObject();
	xsSet(xsVar(0), xsID("touching"), xsBoolean(touching));
	xsSet(xsVar(0), xsID("x"), xsInteger(x));
	xsSet(xsVar(0), xsID("y"), xsInteger(y));
	xsResult = xsVar(0);
}

#endif /* !GEA_EMBEDDED_PURE_C */

/* ---------- Reactive app setup (from generated C) ---------- */

#include "gea_embedded_app_config.h"

#ifdef GEA_EMBEDDED_PURE_C
extern void gea_embedded_app_init(int w, int h);
extern void gea_embedded_app_frame(int timestamp_ms);
extern void gea_embedded_app_touch(int press_id);
extern void gea_embedded_app_touch_start_element(int press_id, int x, int y);
extern void gea_embedded_app_touch_end_element(int press_id, int x, int y);
extern void gea_embedded_app_touch_move_element(int press_id, int x, int y);
extern void gea_embedded_app_touch_start(int x, int y);
extern void gea_embedded_app_touch_move(int x, int y);
extern void gea_embedded_app_touch_end(int x, int y);
extern void gea_embedded_app_settings_toggle(void);
#else
extern void gea_embedded_app_setup(xsMachine *the, int viewport_w, int viewport_h);
#endif

/* ---------- Event queue ---------- */

QueueHandle_t gea_embedded_event_queue = NULL;

/* ---------- RAF + setTimeout timers ---------- */

#ifndef GEA_EMBEDDED_PURE_C
static esp_timer_handle_t raf_timer = NULL;
#endif
#ifdef GEA_EMBEDDED_PURE_C
static TaskHandle_t app_render_frame_task_handle = NULL;
#endif
static TaskHandle_t battery_task_handle = NULL;
static volatile bool raf_event_pending = false;
static volatile bool raf_frame_in_progress = false;

#define RAF_FRAME_INTERVAL_US 16667
#define RAF_FRAME_INTERVAL_MS 16
#define BATTERY_POLL_INTERVAL_MS 60000
#define EVENT_QUEUE_DEPTH 32
#define BATTERY_TASK_STACK 2048
#define APP_FRAME_TASK_STACK 2048

static DRAM_ATTR StaticQueue_t gea_embedded_event_queue_storage;
static DRAM_ATTR uint8_t gea_embedded_event_queue_buffer[EVENT_QUEUE_DEPTH * sizeof(gea_embedded_event_t)];
static DRAM_ATTR StaticTask_t battery_task_tcb;
static DRAM_ATTR StackType_t battery_task_stack[BATTERY_TASK_STACK];
#ifdef GEA_EMBEDDED_PURE_C
static DRAM_ATTR StaticTask_t app_render_frame_task_tcb;
static DRAM_ATTR StackType_t app_render_frame_task_stack[APP_FRAME_TASK_STACK];
#endif

static void battery_update(void)
{
	int pct = gea_embedded_battery_read_percent();
	if (pct >= 0) {
		gea_embedded_ble_set_battery_level((uint8_t)pct);
	}
}

static void battery_task(void *arg)
{
	(void)arg;
	while (1) {
		vTaskDelay(pdMS_TO_TICKS(BATTERY_POLL_INTERVAL_MS));
		battery_update();
	}
}

static void start_battery_task(void)
{
	if (battery_task_handle) return;
	battery_task_handle = xTaskCreateStatic(battery_task, "battery", BATTERY_TASK_STACK, NULL, 3, battery_task_stack, &battery_task_tcb);
	if (!battery_task_handle) {
		ESP_LOGW(TAG, "Failed to start battery polling task");
	}
}

static void queue_frame_event(void)
{
	if (!gea_embedded_event_queue || raf_event_pending || raf_frame_in_progress) return;
	gea_embedded_event_t evt = { .type = GEA_EMBEDDED_EVT_FRAME, .data = 0 };
	raf_event_pending = true;
	if (xQueueSend(gea_embedded_event_queue, &evt, 0) != pdPASS)
		raf_event_pending = false;
}

#ifdef GEA_EMBEDDED_PURE_C
static void app_render_frame_task(void *arg)
{
	(void)arg;
	TickType_t last_wake = xTaskGetTickCount();
	TickType_t frame_ticks = pdMS_TO_TICKS(RAF_FRAME_INTERVAL_MS);
	if (frame_ticks < 1) frame_ticks = 1;

	while (1) {
		vTaskDelayUntil(&last_wake, frame_ticks);
		queue_frame_event();
	}
}

static void start_app_render_frame_task(void)
{
	if (app_render_frame_task_handle) return;
	app_render_frame_task_handle = xTaskCreateStatic(app_render_frame_task, "app_frame", APP_FRAME_TASK_STACK, NULL, 5, app_render_frame_task_stack, &app_render_frame_task_tcb);
	if (!app_render_frame_task_handle) {
		ESP_LOGW(TAG, "Failed to start app frame task");
	}
}
#else
static void raf_timer_cb(void *arg)
{
	(void)arg;
	queue_frame_event();
}

#define MAX_TIMERS 8
static esp_timer_handle_t timeout_timers[MAX_TIMERS] = {0};

static void timeout_timer_cb(void *arg)
{
	int id = (int)(intptr_t)arg;
	gea_embedded_event_t evt = { .type = GEA_EMBEDDED_EVT_TIMEOUT, .data = id };
	xQueueSend(gea_embedded_event_queue, &evt, 0);
}

static bool raf_active = false;

static void gea_embedded_request_animation_frame(xsMachine* the)
{
	xsSet(xsGlobal, xsID("__raf_cb"), xsArg(0));
	if (!raf_active) {
		raf_active = true;
		esp_timer_start_periodic(raf_timer, RAF_FRAME_INTERVAL_US);
	}
}

static void gea_embedded_set_timeout(xsMachine* the)
{
	int ms = xsToInteger(xsArg(1));
	for (int i = 0; i < MAX_TIMERS; i++) {
		if (timeout_timers[i] == NULL) {
			esp_timer_create_args_t args = {
				.callback = timeout_timer_cb,
				.arg = (void *)(intptr_t)i,
				.name = "timeout",
			};
			esp_timer_create(&args, &timeout_timers[i]);
			char name[8];
			snprintf(name, sizeof(name), "__t%d", i);
			xsSet(xsGlobal, xsID(name), xsArg(0));
			esp_timer_start_once(timeout_timers[i], (int64_t)ms * 1000);
			break;
		}
	}
}
#endif /* !GEA_EMBEDDED_PURE_C */

/* ---------- WiFi ---------- */

static EventGroupHandle_t s_wifi_event_group;
#define WIFI_CONNECTED_BIT BIT0
#define WIFI_FAIL_BIT      BIT1

#define GEA_EMBEDDED_WIFI_SCAN_MAX 20

static bool s_wifi_connected = false;
#ifdef GEA_EMBEDDED_WIFI_DISABLED
static bool s_wifi_enabled = false;
#else
static bool s_wifi_enabled = true;
#endif
static bool s_wifi_initialized = false;
static bool s_wifi_started = false;
static int s_wifi_rssi = 0;
static char s_wifi_ssid[33] = "";
static char s_wifi_password[65] = "";
static char s_wifi_ip[16] = "0.0.0.0";
static char s_wifi_mac[18] = "";

static void wifi_config_copy_string(uint8_t *destination, size_t destination_size, const char *source)
{
	memset(destination, 0, destination_size);
	if (!source) return;

	size_t length = 0;
	while (length < destination_size && source[length] != '\0') length++;
	memcpy(destination, source, length);
}

static void wifi_config_set_credentials(wifi_config_t *config, const char *ssid, const char *password)
{
	wifi_config_copy_string(config->sta.ssid, sizeof(config->sta.ssid), ssid);
	wifi_config_copy_string(config->sta.password, sizeof(config->sta.password), password);
}

static bool s_wifi_scanning = false;
static int s_wifi_scan_count = 0;
static char s_wifi_scan_ssids[GEA_EMBEDDED_WIFI_SCAN_MAX][33];
static int s_wifi_scan_rssi[GEA_EMBEDDED_WIFI_SCAN_MAX];
static int s_wifi_scan_secured[GEA_EMBEDDED_WIFI_SCAN_MAX];
static wifi_ap_record_t s_wifi_scan_records[GEA_EMBEDDED_WIFI_SCAN_MAX];

static void wifi_handle_scan_done(void)
{
	uint16_t found = 0;
	if (esp_wifi_scan_get_ap_num(&found) != ESP_OK) {
		s_wifi_scanning = false;
		return;
	}

	uint16_t to_read = found;
	if (to_read > GEA_EMBEDDED_WIFI_SCAN_MAX) to_read = GEA_EMBEDDED_WIFI_SCAN_MAX;

	if (to_read > 0) {
		uint16_t actual = to_read;
		if (esp_wifi_scan_get_ap_records(&actual, s_wifi_scan_records) != ESP_OK) {
			esp_wifi_clear_ap_list();
			s_wifi_scanning = false;
			return;
		}
		to_read = actual;
	}

	for (int i = 0; i < to_read; i++) {
		snprintf(s_wifi_scan_ssids[i], sizeof(s_wifi_scan_ssids[i]), "%s", (const char *)s_wifi_scan_records[i].ssid);
		s_wifi_scan_rssi[i] = s_wifi_scan_records[i].rssi;
		s_wifi_scan_secured[i] = s_wifi_scan_records[i].authmode == WIFI_AUTH_OPEN ? 0 : 1;
	}
	s_wifi_scan_count = to_read;
	s_wifi_scanning = false;
}

static void wifi_event_handler(void *arg, esp_event_base_t event_base,
                               int32_t event_id, void *event_data)
{
	if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_START) {
		if (s_wifi_enabled && s_wifi_ssid[0] != '\0') esp_wifi_connect();
	}
	else if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED) {
		if (s_wifi_enabled) ESP_LOGW(TAG, "WiFi disconnected, retrying...");
		s_wifi_connected = false;
		s_wifi_rssi = 0;
		snprintf(s_wifi_ip, sizeof(s_wifi_ip), "0.0.0.0");
		if (s_wifi_enabled && s_wifi_ssid[0] != '\0') esp_wifi_connect();
	}
	else if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
		ip_event_got_ip_t *event = (ip_event_got_ip_t *)event_data;
		ESP_LOGI(TAG, "Connected! IP: " IPSTR, IP2STR(&event->ip_info.ip));
		s_wifi_connected = true;
		snprintf(s_wifi_ip, sizeof(s_wifi_ip), IPSTR, IP2STR(&event->ip_info.ip));
		xEventGroupSetBits(s_wifi_event_group, WIFI_CONNECTED_BIT);
	}
	else if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_SCAN_DONE) {
		wifi_handle_scan_done();
	}
}

int gea_embedded_wifi_is_enabled(void)
{
	return s_wifi_enabled ? 1 : 0;
}

void gea_embedded_wifi_set_enabled(int enabled)
{
#ifdef GEA_EMBEDDED_WIFI_DISABLED
	(void)enabled;
	s_wifi_enabled = false;
	return;
#endif
	bool next_enabled = enabled ? true : false;
	if (s_wifi_enabled == next_enabled) return;

	s_wifi_enabled = next_enabled;
	if (!s_wifi_initialized) return;

	if (!s_wifi_enabled) {
		if (s_wifi_scanning) {
			ESP_ERROR_CHECK_WITHOUT_ABORT(esp_wifi_scan_stop());
			s_wifi_scanning = false;
		}
		ESP_ERROR_CHECK_WITHOUT_ABORT(esp_wifi_disconnect());
		ESP_ERROR_CHECK_WITHOUT_ABORT(esp_wifi_stop());
		s_wifi_started = false;
		s_wifi_connected = false;
		s_wifi_rssi = 0;
		snprintf(s_wifi_ip, sizeof(s_wifi_ip), "0.0.0.0");
		if (s_wifi_event_group) xEventGroupClearBits(s_wifi_event_group, WIFI_CONNECTED_BIT | WIFI_FAIL_BIT);
		return;
	}

	if (s_wifi_ssid[0] != '\0') {
		wifi_config_t wifi_config = {0};
		wifi_config_set_credentials(&wifi_config, s_wifi_ssid, s_wifi_password);
		ESP_ERROR_CHECK_WITHOUT_ABORT(esp_wifi_set_config(WIFI_IF_STA, &wifi_config));
	}
	esp_err_t err = esp_wifi_start();
	if (err == ESP_OK) s_wifi_started = true;
	else ESP_LOGW(TAG, "esp_wifi_start failed while enabling WiFi: %s", esp_err_to_name(err));
	if (s_wifi_started && s_wifi_ssid[0] != '\0') ESP_ERROR_CHECK_WITHOUT_ABORT(esp_wifi_connect());
}

int gea_embedded_wifi_is_connected(void)
{
	return s_wifi_connected ? 1 : 0;
}

int gea_embedded_wifi_get_rssi(void)
{
	wifi_ap_record_t ap = {0};
	if (s_wifi_connected && esp_wifi_sta_get_ap_info(&ap) == ESP_OK) {
		s_wifi_rssi = ap.rssi;
	}
	return s_wifi_connected ? s_wifi_rssi : 0;
}

const char *gea_embedded_wifi_get_ssid(void)
{
	wifi_ap_record_t ap = {0};
	if (s_wifi_connected && esp_wifi_sta_get_ap_info(&ap) == ESP_OK && ap.ssid[0] != '\0') {
		snprintf(s_wifi_ssid, sizeof(s_wifi_ssid), "%s", (const char *)ap.ssid);
	}
	return s_wifi_connected ? s_wifi_ssid : "";
}

const char *gea_embedded_wifi_get_ip(void)
{
	return s_wifi_connected ? s_wifi_ip : "0.0.0.0";
}

const char *gea_embedded_wifi_get_mac(void)
{
	uint8_t mac[6] = {0};
	esp_err_t err = esp_wifi_get_mac(WIFI_IF_STA, mac);
	if (err != ESP_OK) err = esp_read_mac(mac, ESP_MAC_WIFI_STA);
	if (err != ESP_OK) return "";
	snprintf(s_wifi_mac, sizeof(s_wifi_mac), "%02X:%02X:%02X:%02X:%02X:%02X",
	         mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
	return s_wifi_mac;
}

void gea_embedded_wifi_configure(const char *ssid, const char *password)
{
	if (!ssid) ssid = "";
	if (!password) password = "";
	snprintf(s_wifi_ssid, sizeof(s_wifi_ssid), "%s", ssid);
	snprintf(s_wifi_password, sizeof(s_wifi_password), "%s", password);
	s_wifi_connected = false;
	s_wifi_rssi = 0;
	snprintf(s_wifi_ip, sizeof(s_wifi_ip), "0.0.0.0");

	if (!s_wifi_initialized || !s_wifi_enabled || s_wifi_ssid[0] == '\0') return;

	wifi_config_t wifi_config = {0};
	wifi_config_set_credentials(&wifi_config, ssid, password);
	if (!s_wifi_started) {
		esp_err_t err = esp_wifi_start();
		if (err == ESP_OK) s_wifi_started = true;
	}
	ESP_ERROR_CHECK_WITHOUT_ABORT(esp_wifi_disconnect());
	ESP_ERROR_CHECK_WITHOUT_ABORT(esp_wifi_set_config(WIFI_IF_STA, &wifi_config));
	ESP_ERROR_CHECK_WITHOUT_ABORT(esp_wifi_connect());
}

void gea_embedded_wifi_web_set_state(int connected, const char *ssid, const char *ip, int rssi)
{
	(void)connected;
	(void)ssid;
	(void)ip;
	(void)rssi;
}

void gea_embedded_wifi_web_set_scan_count(int count)
{
	(void)count;
}

void gea_embedded_wifi_web_set_scan_entry(int index, const char *ssid, int rssi, int secured)
{
	(void)index;
	(void)ssid;
	(void)rssi;
	(void)secured;
}

void gea_embedded_wifi_start_scan(void)
{
	if (!s_wifi_initialized) return;
	if (!s_wifi_enabled) return;
	if (s_wifi_scanning) return;

	wifi_scan_config_t scan_cfg = {
		.ssid = NULL,
		.bssid = NULL,
		.channel = 0,
		.show_hidden = false,
		.scan_type = WIFI_SCAN_TYPE_ACTIVE,
	};
	scan_cfg.scan_time.active.min = 100;
	scan_cfg.scan_time.active.max = 300;

	esp_err_t err = esp_wifi_scan_start(&scan_cfg, false);
	if (err == ESP_OK) s_wifi_scanning = true;
}

int gea_embedded_wifi_is_scanning(void)
{
	return s_wifi_scanning ? 1 : 0;
}

int gea_embedded_wifi_get_scan_count(void)
{
	return s_wifi_scan_count;
}

const char *gea_embedded_wifi_get_scan_ssid_at(int index)
{
	if (index < 0 || index >= s_wifi_scan_count) return "";
	return s_wifi_scan_ssids[index];
}

int gea_embedded_wifi_get_scan_rssi_at(int index)
{
	if (index < 0 || index >= s_wifi_scan_count) return 0;
	return s_wifi_scan_rssi[index];
}

int gea_embedded_wifi_get_scan_secured_at(int index)
{
	if (index < 0 || index >= s_wifi_scan_count) return 0;
	return s_wifi_scan_secured[index];
}

static esp_err_t wifi_init_sta(void)
{
	gea_embedded_log_heap_probe("wifi:init_enter");
	s_wifi_event_group = xEventGroupCreate();
	snprintf(s_wifi_ssid, sizeof(s_wifi_ssid), "%s", GEA_EMBEDDED_WIFI_SSID);
	snprintf(s_wifi_password, sizeof(s_wifi_password), "%s", GEA_EMBEDDED_WIFI_PASSWORD);

	ESP_ERROR_CHECK(esp_netif_init());
	ESP_ERROR_CHECK(esp_event_loop_create_default());
	esp_netif_create_default_wifi_sta();
	gea_embedded_log_heap_probe("wifi:after_netif");

	wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
	gea_embedded_log_heap_probe("wifi:before_esp_wifi_init");
	esp_err_t werr = esp_wifi_init(&cfg);
	if (werr != ESP_OK) {
		gea_embedded_log_heap_probe("wifi:esp_wifi_init_failed");
		ESP_LOGE(TAG, "esp_wifi_init failed (%s) — continuing without WiFi/OTA (common after BLE controller init if heap is tight)",
		         esp_err_to_name(werr));
		return ESP_FAIL;
	}
	gea_embedded_log_heap_probe("wifi:after_esp_wifi_init");
	s_wifi_initialized = true;

	esp_event_handler_instance_t instance_any_id;
	esp_event_handler_instance_t instance_got_ip;
	ESP_ERROR_CHECK(esp_event_handler_instance_register(
		WIFI_EVENT, ESP_EVENT_ANY_ID, &wifi_event_handler, NULL, &instance_any_id));
	ESP_ERROR_CHECK(esp_event_handler_instance_register(
		IP_EVENT, IP_EVENT_STA_GOT_IP, &wifi_event_handler, NULL, &instance_got_ip));

	wifi_config_t wifi_config = {0};
	wifi_config_set_credentials(&wifi_config, GEA_EMBEDDED_WIFI_SSID, GEA_EMBEDDED_WIFI_PASSWORD);
	ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
	ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi_config));
	ESP_ERROR_CHECK(esp_wifi_start());
	s_wifi_started = true;
	gea_embedded_log_heap_probe("wifi:after_esp_wifi_start");

	EventBits_t bits = xEventGroupWaitBits(s_wifi_event_group,
		WIFI_CONNECTED_BIT | WIFI_FAIL_BIT, pdFALSE, pdFALSE, pdMS_TO_TICKS(15000));

	if (bits & WIFI_CONNECTED_BIT) {
		return ESP_OK;
	}
	ESP_LOGE(TAG, "WiFi connection timed out");
	return ESP_FAIL;
}

/* ---------- OTA HTTP handler ---------- */

static bool ota_query_bool(const char *query, const char *key, bool fallback)
{
	char value[12];
	if (!query || httpd_query_key_value(query, key, value, sizeof(value)) != ESP_OK) return fallback;
	return strcmp(value, "1") == 0
		|| strcasecmp(value, "true") == 0
		|| strcasecmp(value, "yes") == 0
		|| strcasecmp(value, "on") == 0;
}

static const esp_partition_t *ota_find_slot(const char *slot)
{
	if (!slot || slot[0] == '\0') return NULL;
	return esp_partition_find_first(ESP_PARTITION_TYPE_APP, ESP_PARTITION_SUBTYPE_ANY, slot);
}

static esp_err_t ota_post_handler(httpd_req_t *req)
{
	char query[128] = { 0 };
	char slot[17] = { 0 };
	bool has_query = httpd_req_get_url_query_str(req, query, sizeof(query)) == ESP_OK;
	bool has_slot = has_query && httpd_query_key_value(query, "slot", slot, sizeof(slot)) == ESP_OK;
	bool set_boot = ota_query_bool(has_query ? query : NULL, "boot", !has_slot);
	bool reboot_after = ota_query_bool(has_query ? query : NULL, "reboot", !has_slot);

	const esp_partition_t *update_partition = has_slot ? ota_find_slot(slot) : esp_ota_get_next_update_partition(NULL);
	if (!update_partition) {
		httpd_resp_send_err(req, has_slot ? HTTPD_404_NOT_FOUND : HTTPD_500_INTERNAL_SERVER_ERROR, has_slot ? "OTA slot not found" : "No OTA partition found");
		return ESP_FAIL;
	}

	if (req->content_len > update_partition->size) {
		httpd_resp_send_err(req, HTTPD_413_CONTENT_TOO_LARGE, "Image does not fit OTA slot");
		return ESP_FAIL;
	}

	const esp_partition_t *running = esp_ota_get_running_partition();
	if (running && running->address == update_partition->address) {
		httpd_resp_send_err(req, HTTPD_403_FORBIDDEN, "Cannot write the running partition over OTA");
		return ESP_FAIL;
	}

	ESP_LOGI(TAG, "OTA update started for %s (%d bytes)", update_partition->label, req->content_len);

	esp_ota_handle_t ota_handle;
	esp_err_t err = esp_ota_begin(update_partition, OTA_WITH_SEQUENTIAL_WRITES, &ota_handle);
	if (err != ESP_OK) {
		ESP_LOGE(TAG, "esp_ota_begin failed: %s", esp_err_to_name(err));
		httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "OTA begin failed");
		return ESP_FAIL;
	}

	char buf[1024];
	int received;
	int total = 0;

	while ((received = httpd_req_recv(req, buf, sizeof(buf))) > 0) {
		err = esp_ota_write(ota_handle, buf, received);
		if (err != ESP_OK) {
			ESP_LOGE(TAG, "esp_ota_write failed: %s", esp_err_to_name(err));
			esp_ota_abort(ota_handle);
			httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "OTA write failed");
			return ESP_FAIL;
		}
		total += received;
		if ((total % (64 * 1024)) == 0)
			ESP_LOGI(TAG, "OTA progress: %d bytes", total);
	}

	if (received < 0) {
		ESP_LOGE(TAG, "OTA receive error");
		esp_ota_abort(ota_handle);
		httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "Receive failed");
		return ESP_FAIL;
	}

	err = esp_ota_end(ota_handle);
	if (err != ESP_OK) {
		ESP_LOGE(TAG, "esp_ota_end failed: %s", esp_err_to_name(err));
		httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "OTA validation failed");
		return ESP_FAIL;
	}

	if (set_boot) {
		err = esp_ota_set_boot_partition(update_partition);
		if (err != ESP_OK) {
			ESP_LOGE(TAG, "esp_ota_set_boot_partition failed: %s", esp_err_to_name(err));
			httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "Set boot partition failed");
			return ESP_FAIL;
		}
	}

	ESP_LOGI(TAG, "OTA complete for %s! %d bytes written.", update_partition->label, total);
	httpd_resp_sendstr(req, reboot_after ? "OTA OK, rebooting...\n" : "OTA OK, staged.\n");

	if (reboot_after) {
		vTaskDelay(pdMS_TO_TICKS(500));
		esp_restart();
	}

	return ESP_OK;
}

static esp_err_t ota_status_handler(httpd_req_t *req)
{
	httpd_resp_set_type(req, "application/json");

	const esp_partition_t *running = esp_ota_get_running_partition();
	esp_app_desc_t desc;
	char chunk[256];

	httpd_resp_sendstr_chunk(req, "{\"running\":");
	if (running) {
		const char *version = "";
		if (esp_ota_get_partition_description(running, &desc) == ESP_OK) version = desc.version;
		snprintf(chunk, sizeof(chunk), "{\"label\":\"%s\",\"offset\":%lu,\"size\":%lu,\"version\":\"%s\"}",
			running->label, (unsigned long)running->address, (unsigned long)running->size, version);
		httpd_resp_sendstr_chunk(req, chunk);
	} else {
		httpd_resp_sendstr_chunk(req, "null");
	}

	httpd_resp_sendstr_chunk(req, ",\"partitions\":[");
	bool first = true;
	esp_partition_iterator_t it = esp_partition_find(ESP_PARTITION_TYPE_APP, ESP_PARTITION_SUBTYPE_ANY, NULL);
	while (it) {
		const esp_partition_t *partition = esp_partition_get(it);
		if (partition) {
			const char *version = "";
			if (esp_ota_get_partition_description(partition, &desc) == ESP_OK) version = desc.version;
			snprintf(chunk, sizeof(chunk), "%s{\"label\":\"%s\",\"offset\":%lu,\"size\":%lu,\"version\":\"%s\"}",
				first ? "" : ",", partition->label, (unsigned long)partition->address, (unsigned long)partition->size, version);
			httpd_resp_sendstr_chunk(req, chunk);
			first = false;
		}
		it = esp_partition_next(it);
	}
	if (it) esp_partition_iterator_release(it);
	httpd_resp_sendstr_chunk(req, "]}");
	httpd_resp_sendstr_chunk(req, NULL);
	return ESP_OK;
}

static esp_err_t ota_erase_handler(httpd_req_t *req)
{
	char query[64] = { 0 };
	char slot[17] = { 0 };
	if (httpd_req_get_url_query_str(req, query, sizeof(query)) != ESP_OK
		|| httpd_query_key_value(query, "slot", slot, sizeof(slot)) != ESP_OK) {
		httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Missing slot");
		return ESP_FAIL;
	}

	const esp_partition_t *partition = ota_find_slot(slot);
	if (!partition) {
		httpd_resp_send_err(req, HTTPD_404_NOT_FOUND, "OTA slot not found");
		return ESP_FAIL;
	}

	const esp_partition_t *running = esp_ota_get_running_partition();
	if (running && running->address == partition->address) {
		httpd_resp_send_err(req, HTTPD_403_FORBIDDEN, "Cannot erase the running partition");
		return ESP_FAIL;
	}

	ESP_LOGI(TAG, "Erasing OTA slot %s (%lu bytes)", partition->label, (unsigned long)partition->size);
	esp_err_t err = esp_partition_erase_range(partition, 0, partition->size);
	if (err != ESP_OK) {
		ESP_LOGE(TAG, "Failed to erase %s: %s", partition->label, esp_err_to_name(err));
		httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "Erase failed");
		return ESP_FAIL;
	}

	httpd_resp_sendstr(req, "OTA slot erased.\n");
	return ESP_OK;
}

static httpd_handle_t start_ota_server(void)
{
	httpd_config_t config = HTTPD_DEFAULT_CONFIG();
	config.server_port = 8080;
	config.stack_size = 8192;

	httpd_handle_t server = NULL;
	if (httpd_start(&server, &config) != ESP_OK) {
		ESP_LOGE(TAG, "Failed to start OTA HTTP server");
		return NULL;
	}

	httpd_uri_t ota_uri = {
		.uri      = "/ota",
		.method   = HTTP_POST,
		.handler  = ota_post_handler,
	};
	httpd_register_uri_handler(server, &ota_uri);

	httpd_uri_t status_uri = {
		.uri      = "/ota/status",
		.method   = HTTP_GET,
		.handler  = ota_status_handler,
	};
	httpd_register_uri_handler(server, &status_uri);

	httpd_uri_t erase_uri = {
		.uri      = "/ota/erase",
		.method   = HTTP_POST,
		.handler  = ota_erase_handler,
	};
	httpd_register_uri_handler(server, &erase_uri);

	ESP_LOGI(TAG, "OTA server listening on port %d", config.server_port);
	return server;
}

#ifndef GEA_EMBEDDED_PURE_C
/* ---------- XS machine ---------- */

static txCreation creation = {
	32 * 1024,      /* initial chunk size */
	4 * 1024,       /* incremental chunk size */
	2 * 1024,       /* initial heap slot count */
	512,            /* incremental heap slot count */
	512,            /* stack count */
	128,            /* initial key count */
	32,             /* incremental key count */
	53,             /* name modulo */
	127,            /* symbol modulo */
	8 * 1024,       /* parser buffer size */
	127,            /* parser table modulo */
};
#endif /* !GEA_EMBEDDED_PURE_C */

void app_main(void)
{
	if (gea_embedded_apps_return_to_launcher_on_reset()) return;

	gea_embedded_printf("\n--- gea_embedded: XS JavaScript runtime ---\n\n");

	esp_err_t ret = nvs_flash_init();
	if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
		ESP_ERROR_CHECK(nvs_flash_erase());
		ret = nvs_flash_init();
	}
	ESP_ERROR_CHECK(ret);

	app_state_mutex = xSemaphoreCreateMutex();
	gea_embedded_event_queue = xQueueCreateStatic(
		EVENT_QUEUE_DEPTH,
		sizeof(gea_embedded_event_t),
		gea_embedded_event_queue_buffer,
		&gea_embedded_event_queue_storage
	);
	if (!gea_embedded_event_queue) {
		ESP_LOGE(TAG, "Failed to create event queue");
		return;
	}
	gea_embedded_apps_start_launcher_button_task();
	gea_embedded_display_init();
	gea_embedded_touch_init();

#ifndef GEA_EMBEDDED_PURE_C
	esp_timer_create_args_t raf_args = {
		.callback = raf_timer_cb,
		.name = "raf",
	};
	esp_timer_create(&raf_args, &raf_timer);
#endif

	battery_update();
	start_battery_task();

	bool wifi_ready = false;

#ifndef GEA_EMBEDDED_WIFI_DISABLED
	ESP_LOGI(TAG, "Starting WiFi...");
	gea_embedded_log_heap_probe("app:before_wifi_init");
	if (wifi_init_sta() == ESP_OK) {
		wifi_ready = true;
		gea_embedded_log_heap_probe("app:before_diag_start");
		start_diagnostics_server();
		start_ota_server();
		gea_embedded_log_heap_probe("app:after_diag_ota_start");
	} else {
		ESP_LOGE(TAG, "WiFi failed — OTA not available. USB flash still works.");
	}
#else
	ESP_LOGI(TAG, "WiFi disabled for this app — OTA and store mirror unavailable.");
#endif

#ifdef GEA_EMBEDDED_PURE_C
	gea_embedded_printf("\n--- gea_embedded: pure-C app ---\n\n");
	app_state_lock();
	gea_embedded_app_init(DISPLAY_WIDTH, DISPLAY_HEIGHT);
	app_state_unlock();
	start_app_render_frame_task();

	gea_embedded_printf("\n--- app started, entering event loop ---\n");
	if (wifi_ready)
		ESP_LOGI(TAG, "Ready for OTA. Use: curl -X POST http://<ip>:8080/ota --data-binary @build/gea_embedded.bin");
	else
		ESP_LOGI(TAG, "OTA unavailable. USB flash still works.");

	bool touch_was_active = false;
	int touch_last_x = 0, touch_last_y = 0;
	int touch_start_x = 0, touch_start_y = 0;
	bool touch_dragged = false;
	int touch_active_press_id = -1;

	while (1) {
		gea_embedded_event_t evt;
		xQueueReceive(gea_embedded_event_queue, &evt, portMAX_DELAY);

		switch (evt.type) {
		case GEA_EMBEDDED_EVT_TOUCH: {
			int tx = evt.x;
			int ty = evt.y;
			int touching = evt.touching;
			if (evt.data == GEA_EMBEDDED_TOUCH_MOVE) {
				gea_embedded_touch_consume_latest_move(&tx, &ty);
				touching = 1;
			}
			app_state_lock();
			if (touching && !touch_was_active) {
				touch_start_x = tx;
				touch_start_y = ty;
				touch_dragged = false;
				gea_embedded_ui_touch_down(tx, ty);
				gea_embedded_app_touch_start(tx, ty);
				int cb_id = gea_embedded_ui_hit_test(tx, ty);
				if (cb_id >= 0) {
					touch_active_press_id = cb_id;
					gea_embedded_app_touch_start_element(cb_id, tx, ty);
				}
			}
			if (touching && touch_was_active && (tx != touch_last_x || ty != touch_last_y)) {
				if (!touch_dragged) {
					int dx = tx - touch_start_x;
					int dy = ty - touch_start_y;
					if (dx > 10 || dx < -10 || dy > 10 || dy < -10)
						touch_dragged = true;
				}
				gea_embedded_ui_touch_move(tx, ty);
				gea_embedded_app_touch_move(tx, ty);
				if (touch_active_press_id >= 0) {
					gea_embedded_app_touch_move_element(touch_active_press_id, tx, ty);
				}
			}
			if (!touching && touch_was_active) {
				gea_embedded_ui_touch_up();
				gea_embedded_app_frame((int)(esp_timer_get_time() / 1000));
				gea_embedded_app_touch_end(touch_last_x, touch_last_y);
				if (touch_active_press_id >= 0) {
					gea_embedded_app_touch_end_element(touch_active_press_id, touch_last_x, touch_last_y);
				}
				if (!touch_dragged) {
					int cb_id = gea_embedded_ui_hit_test(touch_last_x, touch_last_y);
					if (cb_id >= 0) {
						gea_embedded_app_touch(cb_id);
					}
				}
				touch_active_press_id = -1;
			}
			touch_was_active = touching;
			if (touching) { touch_last_x = tx; touch_last_y = ty; }
			app_state_unlock();
			break;
		}
		case GEA_EMBEDDED_EVT_FRAME:
			raf_frame_in_progress = true;
			raf_event_pending = false;
			app_state_lock();
			gea_embedded_app_frame((int)(esp_timer_get_time() / 1000));
			app_state_unlock();
			gea_embedded_display_flush();
			raf_frame_in_progress = false;
			vTaskDelay(1);
			break;
			case GEA_EMBEDDED_EVT_TIMEOUT:
				break;
			case GEA_EMBEDDED_EVT_APP_LAUNCH: {
				char app_id[64];
				if (gea_embedded_resident_apps_consume_launch(app_id, sizeof(app_id))) {
					app_state_lock();
					if (gea_embedded_resident_apps_select(app_id)) {
						touch_was_active = false;
						touch_active_press_id = -1;
						gea_embedded_app_init(DISPLAY_WIDTH, DISPLAY_HEIGHT);
						gea_embedded_app_mirror_clear_dirty();
					}
					app_state_unlock();
				}
				break;
			}
			case GEA_EMBEDDED_EVT_SETTINGS_TOGGLE:
				app_state_lock();
				gea_embedded_app_settings_toggle();
				app_state_unlock();
				break;
			}
		}
#else
	txMachine* the = fxCreateMachine(&creation, "gea_embedded", NULL, xsNoID);
	if (!the) {
		gea_embedded_printf("FATAL: failed to create XS machine\n");
		goto idle;
	}

	xsBeginHost(the);
	{
		xsVars(2);

		xsVar(0) = xsNewObject();
		xsVar(1) = xsNewHostFunction(gea_embedded_console_log, 1);
		xsSet(xsVar(0), xsID("log"), xsVar(1));
		xsSet(xsGlobal, xsID("console"), xsVar(0));

		xsVar(0) = xsNewObject();

		xsVar(1) = xsNewHostFunction(gea_embedded_screen_print, 1);
		xsSet(xsVar(0), xsID("print"), xsVar(1));
		xsVar(1) = xsNewHostFunction(gea_embedded_screen_clear, 0);
		xsSet(xsVar(0), xsID("clear"), xsVar(1));
		xsVar(1) = xsNewHostFunction(gea_embedded_screen_fill_rect, 5);
		xsSet(xsVar(0), xsID("fillRect"), xsVar(1));
		xsVar(1) = xsNewHostFunction(gea_embedded_screen_stroke_rect, 5);
		xsSet(xsVar(0), xsID("strokeRect"), xsVar(1));
		xsVar(1) = xsNewHostFunction(gea_embedded_screen_fill_circle, 4);
		xsSet(xsVar(0), xsID("fillCircle"), xsVar(1));
		xsVar(1) = xsNewHostFunction(gea_embedded_screen_stroke_circle, 4);
		xsSet(xsVar(0), xsID("strokeCircle"), xsVar(1));
		xsVar(1) = xsNewHostFunction(gea_embedded_screen_draw_line, 5);
		xsSet(xsVar(0), xsID("drawLine"), xsVar(1));
		xsVar(1) = xsNewHostFunction(gea_embedded_screen_draw_arc, 6);
		xsSet(xsVar(0), xsID("drawArc"), xsVar(1));
		xsVar(1) = xsNewHostFunction(gea_embedded_screen_fill_triangle, 7);
		xsSet(xsVar(0), xsID("fillTriangle"), xsVar(1));
		xsVar(1) = xsNewHostFunction(gea_embedded_screen_draw_text, 5);
		xsSet(xsVar(0), xsID("drawText"), xsVar(1));
		xsVar(1) = xsNewHostFunction(gea_embedded_screen_set_pixel, 3);
		xsSet(xsVar(0), xsID("setPixel"), xsVar(1));
		xsVar(1) = xsNewHostFunction(gea_embedded_screen_color, 3);
		xsSet(xsVar(0), xsID("color"), xsVar(1));
		xsVar(1) = xsNewHostFunction(gea_embedded_screen_flush, 0);
		xsSet(xsVar(0), xsID("flush"), xsVar(1));
		xsVar(1) = xsNewHostFunction(gea_embedded_screen_push_clip, 4);
		xsSet(xsVar(0), xsID("pushClip"), xsVar(1));
		xsVar(1) = xsNewHostFunction(gea_embedded_screen_pop_clip, 0);
		xsSet(xsVar(0), xsID("popClip"), xsVar(1));
		xsVar(1) = xsNewHostFunction(gea_embedded_screen_set_alpha, 1);
		xsSet(xsVar(0), xsID("setAlpha"), xsVar(1));
		xsVar(1) = xsNewHostFunction(gea_embedded_screen_fill_rounded_rect, 9);
		xsSet(xsVar(0), xsID("fillRoundedRect"), xsVar(1));
		xsVar(1) = xsNewHostFunction(gea_embedded_screen_stroke_rounded_rect, 10);
		xsSet(xsVar(0), xsID("strokeRoundedRect"), xsVar(1));
		xsSet(xsVar(0), xsID("width"), xsInteger(DISPLAY_WIDTH));
		xsSet(xsVar(0), xsID("height"), xsInteger(DISPLAY_HEIGHT));

		xsSet(xsGlobal, xsID("screen"), xsVar(0));

		xsVar(0) = xsNewObject();
		xsVar(1) = xsNewHostFunction(gea_embedded_image_load_bytes, 1);
		xsSet(xsVar(0), xsID("loadBytes"), xsVar(1));
		xsVar(1) = xsNewHostFunction(gea_embedded_image_load_url, 1);
		xsSet(xsVar(0), xsID("loadUrl"), xsVar(1));
		xsVar(1) = xsNewHostFunction(gea_embedded_image_width_fn, 1);
		xsSet(xsVar(0), xsID("width"), xsVar(1));
		xsVar(1) = xsNewHostFunction(gea_embedded_image_height_fn, 1);
		xsSet(xsVar(0), xsID("height"), xsVar(1));
		xsVar(1) = xsNewHostFunction(gea_embedded_image_frame_count_fn, 1);
		xsSet(xsVar(0), xsID("frameCount"), xsVar(1));
		xsVar(1) = xsNewHostFunction(gea_embedded_image_is_animated_fn, 1);
		xsSet(xsVar(0), xsID("isAnimated"), xsVar(1));
		xsVar(1) = xsNewHostFunction(gea_embedded_image_set_playing_fn, 2);
		xsSet(xsVar(0), xsID("setPlaying"), xsVar(1));
		xsVar(1) = xsNewHostFunction(gea_embedded_image_seek_fn, 2);
		xsSet(xsVar(0), xsID("seek"), xsVar(1));
		xsVar(1) = xsNewHostFunction(gea_embedded_image_dispose_fn, 1);
		xsSet(xsVar(0), xsID("dispose"), xsVar(1));
		xsVar(1) = xsNewHostFunction(gea_embedded_image_draw_fn, 3);
		xsSet(xsVar(0), xsID("draw"), xsVar(1));
		xsVar(1) = xsNewHostFunction(gea_embedded_image_draw_scaled_fn, 5);
		xsSet(xsVar(0), xsID("drawScaled"), xsVar(1));
		xsVar(1) = xsNewHostFunction(gea_embedded_image_advance_fn, 2);
		xsSet(xsVar(0), xsID("advance"), xsVar(1));
		xsSet(xsGlobal, xsID("__gea_embedded_image"), xsVar(0));

		xsVar(0) = xsNewObject();
		xsVar(1) = xsNewHostFunction(gea_embedded_accelerometer_read_fn, 0);
		xsSet(xsVar(0), xsID("read"), xsVar(1));
		xsVar(1) = xsNewHostFunction(gea_embedded_accelerometer_start_fn, 0);
		xsSet(xsVar(0), xsID("start"), xsVar(1));
		xsVar(1) = xsNewHostFunction(gea_embedded_accelerometer_stop_fn, 0);
		xsSet(xsVar(0), xsID("stop"), xsVar(1));
		xsVar(1) = xsNewHostFunction(gea_embedded_accelerometer_calibrate_fn, 0);
		xsSet(xsVar(0), xsID("calibrate"), xsVar(1));
		xsSet(xsGlobal, xsID("Accelerometer"), xsVar(0));

		xsVar(0) = xsNewObject();
		xsVar(1) = xsNewHostFunction(gea_embedded_touch_read_fn, 0);
		xsSet(xsVar(0), xsID("read"), xsVar(1));
		xsSet(xsGlobal, xsID("__gea_embedded_touch"), xsVar(0));
		xsSet(xsGlobal, xsID("Touch"), xsVar(0));

		xsVar(1) = xsNewHostFunction(gea_embedded_request_animation_frame, 1);
		xsSet(xsGlobal, xsID("requestAnimationFrame"), xsVar(1));
		xsVar(1) = xsNewHostFunction(gea_embedded_set_timeout, 2);
		xsSet(xsGlobal, xsID("setTimeout"), xsVar(1));
		xsVar(1) = xsNewHostFunction(gea_embedded_fetch, 2);
		xsSet(xsGlobal, xsID("fetch"), xsVar(1));

		gea_embedded_app_setup(the, DISPLAY_WIDTH, DISPLAY_HEIGHT);
	}
	xsEndHost(the);

	xsBeginHost(the);
	{
		xsTry {
#ifdef GEA_EMBEDDED_SOURCE_AT_BOOT
			txStringCStream stream;
			stream.buffer = (txString)gea_embedded_js_source;
			stream.offset = 0;
			stream.size = c_strlen(gea_embedded_js_source);
			txScript* script = fxParseScript(the, &stream, fxStringCGetter,
				mxProgramFlag);
			if (script)
				fxRunScript(the, script, &mxGlobal, C_NULL, C_NULL, C_NULL, mxProgram.value.reference);
			else
				gea_embedded_printf("ERROR: failed to parse JS source\n");
#else
			txScript* script = gea_embedded_heap_script();
			if (script)
				fxRunScript(the, script, &mxGlobal, C_NULL, C_NULL, C_NULL, mxProgram.value.reference);
			else
				gea_embedded_printf("FATAL: failed to allocate script\n");
#endif
		}
		xsCatch {
			gea_embedded_printf("ERROR: %s\n", xsToString(xsException));
			xsException = xsUndefined;
		}
	}
	xsEndHost(the);

	gea_embedded_printf("\n--- script started, entering event loop ---\n");
	if (wifi_ready)
		ESP_LOGI(TAG, "Ready for OTA. Use: curl -X POST http://<ip>:8080/ota --data-binary @build/gea_embedded.bin");
	else
		ESP_LOGI(TAG, "OTA unavailable. USB flash still works.");

	bool touch_was_active = false;
	int touch_last_x = 0, touch_last_y = 0;
	int touch_start_x = 0, touch_start_y = 0;
	bool touch_dragged = false;

	extern void gea_embedded_drain_promise_jobs(txMachine* the);

	while (1) {
		gea_embedded_event_t evt;
		xQueueReceive(gea_embedded_event_queue, &evt, portMAX_DELAY);

		gea_embedded_drain_promise_jobs(the);

		switch (evt.type) {
		case GEA_EMBEDDED_EVT_TOUCH: {
			int tx = evt.x;
			int ty = evt.y;
			int touching = evt.touching;
			if (evt.data == GEA_EMBEDDED_TOUCH_MOVE) {
				gea_embedded_touch_consume_latest_move(&tx, &ty);
				touching = 1;
			}
			if (touching && !touch_was_active) {
				touch_start_x = tx;
				touch_start_y = ty;
				touch_dragged = false;
				gea_embedded_ui_touch_down(tx, ty);
			}
			if (touching && touch_was_active && (tx != touch_last_x || ty != touch_last_y)) {
				if (!touch_dragged) {
					int dx = tx - touch_start_x;
					int dy = ty - touch_start_y;
					if (dx > 10 || dx < -10 || dy > 10 || dy < -10)
						touch_dragged = true;
				}
				gea_embedded_ui_touch_move(tx, ty);
			}
			if (!touching && touch_was_active) {
				gea_embedded_ui_touch_up();
				if (!touch_dragged) {
					int cb_id = gea_embedded_ui_hit_test(touch_last_x, touch_last_y);
					if (cb_id >= 0) {
						xsBeginHost(the);
						xsTry {
							xsCall1(xsGlobal, xsID("__on_press"), xsInteger(cb_id));
						}
						xsCatch {
							gea_embedded_printf("onPress error: %s\n", xsToString(xsException));
							xsException = xsUndefined;
						}
						xsEndHost(the);
					}
				}
			}
			touch_was_active = touching;
			if (touching) { touch_last_x = tx; touch_last_y = ty; }
			break;
		}
		case GEA_EMBEDDED_EVT_FRAME: {
			raf_frame_in_progress = true;
			raf_event_pending = false;
			int64_t now = esp_timer_get_time();
			xsBeginHost(the);
			xsTry {
				xsCall1(xsGlobal, xsID("__raf_cb"), xsInteger((int)(now / 1000)));
			}
			xsCatch {
				gea_embedded_printf("RAF error: %s\n", xsToString(xsException));
				xsException = xsUndefined;
				raf_active = false;
				esp_timer_stop(raf_timer);
			}
			xsEndHost(the);
			gea_embedded_display_flush();
			raf_frame_in_progress = false;
			vTaskDelay(1);
			break;
		}
			case GEA_EMBEDDED_EVT_TIMEOUT: {
				int i = evt.data;
				if (i >= 0 && i < MAX_TIMERS && timeout_timers[i]) {
				esp_timer_delete(timeout_timers[i]);
				timeout_timers[i] = NULL;
				xsBeginHost(the);
				xsTry {
					char name[8];
					snprintf(name, sizeof(name), "__t%d", i);
					xsCall0(xsGlobal, xsID(name));
					xsSet(xsGlobal, xsID(name), xsUndefined);
				}
				xsCatch {
					gea_embedded_printf("Timer error: %s\n", xsToString(xsException));
					xsException = xsUndefined;
				}
				xsEndHost(the);
				}
				break;
			}
			case GEA_EMBEDDED_EVT_APP_LAUNCH:
				break;
			case GEA_EMBEDDED_EVT_SETTINGS_TOGGLE:
				break;
			}
		}

idle:
	while (1) {
		vTaskDelay(pdMS_TO_TICKS(1000));
	}
#endif
}

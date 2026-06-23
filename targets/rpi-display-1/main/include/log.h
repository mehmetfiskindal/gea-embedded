#pragma once

#include <stdint.h>

void gea_embedded_log(int level, const char *fmt, ...);
void gea_embedded_log_init(const char *app_name, const char *file_path);
void gea_embedded_log_shutdown(void);

int  gea_embedded_log_stream_init(uint16_t port);
void gea_embedded_log_stream_shutdown(void);
void gea_embedded_log_stream_tick(void);

#define GEA_LOG_ERROR 0
#define GEA_LOG_WARN  1
#define GEA_LOG_INFO  2
#define GEA_LOG_DEBUG 3
#define GEA_LOG_TRACE 4

#define gea_loge(...)  gea_embedded_log(GEA_LOG_ERROR, __VA_ARGS__)
#define gea_logw(...)  gea_embedded_log(GEA_LOG_WARN,  __VA_ARGS__)
#define gea_logi(...)  gea_embedded_log(GEA_LOG_INFO,  __VA_ARGS__)
#define gea_logd(...)  gea_embedded_log(GEA_LOG_DEBUG, __VA_ARGS__)
#define gea_logt(...)  gea_embedded_log(GEA_LOG_TRACE, __VA_ARGS__)

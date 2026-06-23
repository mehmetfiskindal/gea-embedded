/*
 * log.c — leveled logging with optional file output and TCP stream.
 *
 * On the Pi Zero we avoid glog/log4c; the level-controlled printf is
 * enough and keeps RSS low. The TCP log stream on port 8081 mirrors
 * the ESP32 diagnostics channel so the same simulator UI works.
 */

#define _GNU_SOURCE
#include "log.h"
#include "platform.h"

#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <pthread.h>
#include <stdarg.h>
#include <stdatomic.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/time.h>
#include <sys/types.h>
#include <time.h>
#include <unistd.h>

static int            g_log_level = GEA_LOG_INFO;
static FILE          *g_log_file = NULL;
static char          *g_app_name = "gea-embedded";

/* ---- TCP log stream ---- */

static int           g_log_listen_fd = -1;
static int           g_log_client_fd = -1;
static pthread_t     g_log_thread;
static int           g_log_thread_running = 0;
static pthread_mutex_t g_log_mutex = PTHREAD_MUTEX_INITIALIZER;

static const char *level_str(int level) {
    switch (level) {
        case GEA_LOG_ERROR: return "ERROR";
        case GEA_LOG_WARN:  return "WARN";
        case GEA_LOG_INFO:  return "INFO";
        case GEA_LOG_DEBUG: return "DEBUG";
        case GEA_LOG_TRACE: return "TRACE";
        default:            return "?";
    }
}

void gea_embedded_log_init(const char *app_name, const char *file_path) {
    if (app_name) g_app_name = strdup(app_name);

    const char *env = getenv("GEA_RPI_LOG_LEVEL");
    if (env) {
        if (!strcasecmp(env, "error")) g_log_level = GEA_LOG_ERROR;
        else if (!strcasecmp(env, "warn"))  g_log_level = GEA_LOG_WARN;
        else if (!strcasecmp(env, "info"))  g_log_level = GEA_LOG_INFO;
        else if (!strcasecmp(env, "debug")) g_log_level = GEA_LOG_DEBUG;
        else if (!strcasecmp(env, "trace")) g_log_level = GEA_LOG_TRACE;
    }

    if (file_path && *file_path) {
        g_log_file = fopen(file_path, "a");
        if (g_log_file) setvbuf(g_log_file, NULL, _IOLBF, 0);
    }
}

void gea_embedded_log_shutdown(void) {
    if (g_log_file) { fclose(g_log_file); g_log_file = NULL; }
    free(g_app_name); g_app_name = NULL;
}

void gea_embedded_log(int level, const char *fmt, ...) {
    if (level > g_log_level) return;

    char ts[32];
    struct timeval tv;
    gettimeofday(&tv, NULL);
    struct tm tm;
    localtime_r(&tv.tv_sec, &tm);
    snprintf(ts, sizeof(ts), "%04d-%02d-%02dT%02d:%02d:%02d.%03ld",
             tm.tm_year + 1900, tm.tm_mon + 1, tm.tm_mday,
             tm.tm_hour, tm.tm_min, tm.tm_sec, (long)tv.tv_usec / 1000);

    char body[1024];
    va_list ap;
    va_start(ap, fmt);
    vsnprintf(body, sizeof(body), fmt, ap);
    va_end(ap);

    /* stderr */
    fprintf(stderr, "%s %-5s [%s] %s\n", ts, level_str(level), g_app_name, body);
    fflush(stderr);

    /* optional file */
    if (g_log_file) {
        fprintf(g_log_file, "%s %-5s [%s] %s\n", ts, level_str(level), g_app_name, body);
        /* Force flush so log entries show up in real time (important
         * when tailing the file or when the binary is killed). */
        fflush(g_log_file);
    }

    /* optional TCP stream */
    if (g_log_client_fd >= 0) {
        pthread_mutex_lock(&g_log_mutex);
        char wire[1100];
        int n = snprintf(wire, sizeof(wire), "%s %-5s [%s] %s\n", ts, level_str(level), g_app_name, body);
        if (n > 0) {
            ssize_t w = send(g_log_client_fd, wire, (size_t)n, MSG_NOSIGNAL);
            (void)w;
        }
        pthread_mutex_unlock(&g_log_mutex);
    }
}

/* ---- TCP log stream ---- */

static void *log_accept_thread(void *arg) {
    int listen_fd = *(int *)arg;
    while (1) {
        struct sockaddr_in addr;
        socklen_t alen = sizeof(addr);
        int client = accept(listen_fd, (struct sockaddr *)&addr, &alen);
        if (client < 0) {
            if (errno == EINTR) continue;
            break;
        }
        pthread_mutex_lock(&g_log_mutex);
        if (g_log_client_fd >= 0) close(g_log_client_fd);
        g_log_client_fd = client;
        pthread_mutex_unlock(&g_log_mutex);
        gea_logi("log: client connected from %s:%d",
                 inet_ntoa(addr.sin_addr), (int)ntohs(addr.sin_port));
    }
    return NULL;
}

int gea_embedded_log_stream_init(uint16_t port) {
    int fd = socket(AF_INET, SOCK_STREAM, 0);
    if (fd < 0) return -1;
    int one = 1;
    setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &one, sizeof(one));

    struct sockaddr_in addr = {
        .sin_family = AF_INET,
        .sin_port   = htons(port),
        .sin_addr.s_addr = htonl(INADDR_LOOPBACK),
    };
    if (bind(fd, (struct sockaddr *)&addr, sizeof(addr)) < 0) {
        gea_logw("log: cannot bind 127.0.0.1:%d (%s)", port, strerror(errno));
        close(fd);
        return -1;
    }
    if (listen(fd, 1) < 0) { close(fd); return -1; }

    g_log_listen_fd = fd;
    if (pthread_create(&g_log_thread, NULL, log_accept_thread, &fd) != 0) {
        close(fd); g_log_listen_fd = -1; return -1;
    }
    g_log_thread_running = 1;
    gea_logi("log: TCP stream on 127.0.0.1:%d", port);
    return 0;
}

void gea_embedded_log_stream_shutdown(void) {
    if (g_log_listen_fd >= 0) {
        shutdown(g_log_listen_fd, SHUT_RDWR);
        close(g_log_listen_fd);
        g_log_listen_fd = -1;
    }
    if (g_log_client_fd >= 0) {
        close(g_log_client_fd);
        g_log_client_fd = -1;
    }
    if (g_log_thread_running) {
        pthread_join(g_log_thread, NULL);
        g_log_thread_running = 0;
    }
}

void gea_embedded_log_stream_tick(void) { /* no-op; thread does the work */ }

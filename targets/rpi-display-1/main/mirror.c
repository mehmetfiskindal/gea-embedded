/*
 * mirror.c — device-mirror TCP server stub.
 *
 * Mirrors the ESP32 mirror protocol (newline-delimited JSON on a
 * TCP port) so the existing simulator UI can subscribe.
 *
 * v1 ships a stub: the server accepts a connection, reads "HELLO",
 * and streams a static "{\"kind\":\"hello\"}" reply. The full
 * store snapshot/diff streaming lands in Phase 5 once the JS-side
 * mirror protocol helpers are verified on the Pi.
 */

#include "mirror.h"
#include "log.h"

#include <arpa/inet.h>
#include <errno.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/types.h>
#include <unistd.h>

static int g_mirror_listen_fd = -1;
static int g_mirror_client_fd = -1;
static pthread_t g_mirror_thread;
static int g_mirror_thread_running = 0;

static void *mirror_thread_fn(void *arg) {
    int listen_fd = *(int *)arg;
    while (1) {
        struct sockaddr_in addr;
        socklen_t alen = sizeof(addr);
        int client = accept(listen_fd, (struct sockaddr *)&addr, &alen);
        if (client < 0) {
            if (errno == EINTR) continue;
            break;
        }
        int one = 1;
        setsockopt(client, IPPROTO_TCP, TCP_NODELAY, &one, sizeof(one));
        if (g_mirror_client_fd >= 0) close(g_mirror_client_fd);
        g_mirror_client_fd = client;
        gea_logi("mirror: client connected from %s:%d",
                 inet_ntoa(addr.sin_addr), (int)ntohs(addr.sin_port));

        const char *hello = "{\"kind\":\"hello\",\"target\":\"rpi-display-1\"}\n";
        ssize_t w = send(client, hello, strlen(hello), MSG_NOSIGNAL);
        (void)w;
    }
    return NULL;
}

int gea_embedded_mirror_init(uint16_t port) {
    int fd = socket(AF_INET, SOCK_STREAM, 0);
    if (fd < 0) return -1;
    int one = 1;
    setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &one, sizeof(one));

    struct sockaddr_in addr = {
        .sin_family = AF_INET,
        .sin_port   = htons(port),
        .sin_addr.s_addr = htonl(INADDR_ANY),
    };
    if (bind(fd, (struct sockaddr *)&addr, sizeof(addr)) < 0) {
        gea_logw("mirror: bind port %d failed: %s", port, strerror(errno));
        close(fd);
        return -1;
    }
    if (listen(fd, 1) < 0) { close(fd); return -1; }

    g_mirror_listen_fd = fd;
    if (pthread_create(&g_mirror_thread, NULL, mirror_thread_fn, &fd) != 0) {
        close(fd); g_mirror_listen_fd = -1; return -1;
    }
    g_mirror_thread_running = 1;
    gea_logi("mirror: server listening on 0.0.0.0:%d", port);
    return 0;
}

void gea_embedded_mirror_shutdown(void) {
    if (g_mirror_listen_fd >= 0) {
        shutdown(g_mirror_listen_fd, SHUT_RDWR);
        close(g_mirror_listen_fd);
        g_mirror_listen_fd = -1;
    }
    if (g_mirror_client_fd >= 0) {
        close(g_mirror_client_fd);
        g_mirror_client_fd = -1;
    }
    if (g_mirror_thread_running) {
        pthread_join(g_mirror_thread, NULL);
        g_mirror_thread_running = 0;
    }
}

void gea_embedded_mirror_tick(void) { /* thread does the work */ }

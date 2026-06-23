/*
 * platform.c — POSIX platform layer for the Pi target.
 *
 * Provides timing (monotonic ms), sleep, and a memory-mapped file helper.
 * Mirrors the API of the ESP32 platform.c (without FreeRTOS).
 *
 * Also provides compatibility shims for symbols the generated C expects
 * but the ESP32 platform.c used to define under a different name.
 */

#define _GNU_SOURCE
#include "platform.h"

#include <errno.h>
#include <fcntl.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <sys/time.h>
#include <time.h>
#include <unistd.h>

uint32_t gea_embedded_platform_now_ms(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (uint32_t)((uint64_t)ts.tv_sec * 1000 + (uint64_t)ts.tv_nsec / 1000000);
}

uint64_t gea_embedded_platform_now_us(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (uint64_t)ts.tv_sec * 1000000 + (uint64_t)ts.tv_nsec / 1000;
}

uint64_t gea_embedded_platform_now_s(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (uint64_t)ts.tv_sec;
}

void gea_embedded_platform_sleep_ms(uint32_t ms) {
    struct timespec ts = {
        .tv_sec  = ms / 1000,
        .tv_nsec = (long)(ms % 1000) * 1000000L,
    };
    while (nanosleep(&ts, &ts) == -1 && errno == EINTR) {}
}

void gea_embedded_platform_yield(void) {
    struct timespec ts = { 0, 1000L };
    nanosleep(&ts, NULL);
}

/* ---- Compatibility shims (ESP32 platform.c used these names) ---- */

/* The generated C references gea_embedded_now_ms; the ESP32 platform.c
 * defines it as a wrapper around modMilliseconds(). The Pi target
 * has a single source of truth in gea_embedded_platform_now_ms(). */
uint32_t gea_embedded_now_ms(void) { return gea_embedded_platform_now_ms(); }

/* Mirror helper: returns the active app id. For Phase 1 we have no
 * launcher registry, so we return a literal "tic-tac-toe" (or whatever
 * the build was configured with). The proper implementation lives in
 * apps.c once the launcher flow lands. */
const char *gea_embedded_apps_get_current_id(void) {
    return "tic-tac-toe";
}

bool gea_embedded_mmap_open(struct gea_embedded_mmap *m, const char *path) {
    memset(m, 0, sizeof(*m));
    int fd = open(path, O_RDONLY);
    if (fd < 0) return false;

    struct stat st;
    if (fstat(fd, &st) < 0) {
        close(fd);
        return false;
    }
    if (st.st_size == 0) {
        /* Some special files (e.g., sysfs) have size 0; treat as error. */
        close(fd);
        return false;
    }

    void *addr = mmap(NULL, (size_t)st.st_size, PROT_READ, MAP_PRIVATE, fd, 0);
    if (addr == MAP_FAILED) {
        close(fd);
        return false;
    }

    m->fd   = fd;
    m->addr = addr;
    m->size = (size_t)st.st_size;
    return true;
}

void gea_embedded_mmap_close(struct gea_embedded_mmap *m) {
    if (!m) return;
    if (m->addr && m->addr != MAP_FAILED) munmap(m->addr, m->size);
    if (m->fd >= 0) close(m->fd);
    memset(m, 0, sizeof(*m));
}

const void *gea_embedded_mmap_data(const struct gea_embedded_mmap *m) {
    return m ? m->addr : NULL;
}

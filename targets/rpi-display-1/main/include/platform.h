#pragma once

#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Monotonic milliseconds since some unspecified epoch. */
uint32_t gea_embedded_platform_now_ms(void);
uint64_t gea_embedded_platform_now_us(void);

/* Monotonic seconds (for Wi-Fi RSSI timestamp etc.). */
uint64_t gea_embedded_platform_now_s(void);

/* Cooperative sleep. */
void gea_embedded_platform_sleep_ms(uint32_t ms);

/* Cooperative yield; equivalent to a no-op for single-threaded targets. */
void gea_embedded_platform_yield(void);

/* Memory-mapped file open/read/close. */
struct gea_embedded_mmap {
    int   fd;
    void *addr;
    size_t size;
};

bool gea_embedded_mmap_open(struct gea_embedded_mmap *m, const char *path);
void gea_embedded_mmap_close(struct gea_embedded_mmap *m);
const void *gea_embedded_mmap_data(const struct gea_embedded_mmap *m);

/* Lightweight atomic flags (Pi Zero is single-core; these can be plain loads/stores). */
typedef struct { volatile int value; } gea_embedded_atomic_int_t;

static inline void gea_embedded_atomic_init(gea_embedded_atomic_int_t *a, int v) {
    a->value = v;
}
static inline int gea_embedded_atomic_load(gea_embedded_atomic_int_t *a) {
    return a->value;
}
static inline void gea_embedded_atomic_store(gea_embedded_atomic_int_t *a, int v) {
    a->value = v;
}

#ifdef __cplusplus
}
#endif

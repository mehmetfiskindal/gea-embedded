#pragma once

#include <stdint.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    GEA_RPI_INPUT_BACKEND_AUTO    = 0,
    GEA_RPI_INPUT_BACKEND_EVDEV   = 1,   /* primary for Pi Zero W v1.1  */
    GEA_RPI_INPUT_BACKEND_LIBINPUT = 2,  /* optional; Pi 3/4/5          */
    GEA_RPI_INPUT_BACKEND_I2C     = 3,   /* tier 3, FT6236/GT911        */
} gea_rpi_input_backend_t;

#define GEA_INPUT_MAX_SLOTS          10
#define GEA_INPUT_DEBOUNCE_MS        30
#define GEA_INPUT_MOVE_COALESCE_MS   16

typedef struct {
    int  x;
    int  y;
    bool active;
    int  press_id;
    int  last_move_ms;
} gea_rpi_touch_state_t;

typedef void (*gea_rpi_touch_start_cb)(int x, int y, void *user);
typedef void (*gea_rpi_touch_move_cb) (int x, int y, void *user);
typedef void (*gea_rpi_touch_end_cb)  (int x, int y, void *user);
typedef void (*gea_rpi_key_cb)        (int keycode, int pressed, void *user);

typedef struct {
    gea_rpi_touch_start_cb on_touch_start;
    gea_rpi_touch_move_cb  on_touch_move;
    gea_rpi_touch_end_cb   on_touch_end;
    gea_rpi_key_cb         on_key;
    void                  *user;
} gea_rpi_input_callbacks_t;

/* Lifecycle */
int  gea_embedded_input_init(gea_rpi_input_backend_t backend,
                             const gea_rpi_input_callbacks_t *cbs);
void gea_embedded_input_shutdown(void);

/* Poll for events with a timeout (ms). Returns the number of events processed. */
int  gea_embedded_input_poll(int timeout_ms);

/* Re-read latest cached touch (single-finger model). */
int  gea_embedded_input_read_cached(int *x, int *y);

/* Consume the most recent coalesced move (clears the cached move). */
void gea_embedded_input_consume_latest_move(int *x, int *y);

/* Coordinate transform from raw touch panel coordinates to viewport coordinates. */
void gea_embedded_input_set_panel_size(int width, int height);
void gea_embedded_input_set_viewport_size(int width, int height);

#ifdef __cplusplus
}
#endif

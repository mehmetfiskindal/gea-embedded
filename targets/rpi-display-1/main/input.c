/*
 * input.c — evdev-based input backend (primary for Pi Zero W v1.1)
 *
 * Reads from one or more /dev/input/eventN devices. Implements an MT-B
 * (multi-touch protocol B) state machine that collapses to single-finger
 * events for the framework's press_id semantics (v1 scope).
 *
 * Touch coordinates are transformed from the device's reported range
 * (read via EVIOCGABS) to the panel range.
 *
 * Also handles legacy single-touch mode (ABS_X/ABS_Y + BTN_TOUCH).
 *
 * Debug logging: the first 30 events are logged with full type/code/value
 * so we can see what the kernel actually delivers.
 */

#define _GNU_SOURCE
#include "input.h"
#include "display.h"
#include "log.h"
#include "platform.h"

#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <linux/input.h>
#include <poll.h>
#include <pthread.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

/* ---- State ---- */

#define MAX_INPUT_DEVS  8
#define MAX_KEYS         16
#define MAX_DEBUG_EVENTS 30

typedef struct {
    int  fd;
    char path[64];
    char name[64];
    /* Coordinate calibration (read via EVIOCGABS). */
    int  has_abs_xy;       /* non-zero if device reports ABS_X/ABS_Y     */
    int  abs_x_min, abs_x_max;
    int  abs_y_min, abs_y_max;
    int  has_mt_xy;        /* non-zero if device reports MT-B axes      */
    int  mt_x_min, mt_x_max;
    int  mt_y_min, mt_y_max;
} input_dev_t;

static input_dev_t  g_devs[MAX_INPUT_DEVS];
static int          g_dev_count = 0;

static gea_rpi_input_callbacks_t g_cbs = { 0 };
static int g_backend = GEA_RPI_INPUT_BACKEND_EVDEV;

static int g_panel_w = GEA_RPI_PANEL_WIDTH;
static int g_panel_h = GEA_RPI_PANEL_HEIGHT;
static int g_viewport_w = GEA_RPI_COMPAT_WIDTH;
static int g_viewport_h = GEA_RPI_COMPAT_HEIGHT;

static int g_touch_crop = -1; /* -1 = auto-detect, 0 = stretch, 1 = crop (1:1 mapping) */

/* ---- MT-B state ---- */

typedef struct {
    int tracking_id;
    int x;
    int y;
} mt_slot_t;

static mt_slot_t g_slots[GEA_INPUT_MAX_SLOTS];
static int       g_active_slot = -1;
static int       g_current_slot = 0;     /* most recent ABS_MT_SLOT */
static int       g_pressed = 0;
/* Set once the first SYN_REPORT of the current gesture has been
 * processed. The WaveShare WS170120 emits several SYN_REPORTs per
 * gesture (the extra ones carry only MSC_TIMESTAMP updates and
 * sometimes drift the reported position by tens of pixels). Without
 * this guard, each of those reports re-runs the press branch and
 * we get duplicate touch_start callbacks. */
static int       g_start_emitted = 0;
static int       g_last_x = 0, g_last_y = 0;
static int       g_cached_x = 0, g_cached_y = 0;
static int       g_has_cached_move = 0;

static int g_key_state[MAX_KEYS];

/* ---- Coordinate transform ---- */

/* Convert a raw axis value (with the device's range) to the panel range. */
static int scale_axis(int raw, int dev_min, int dev_max, int panel_max) {
    if (dev_max <= dev_min) return raw;  /* unknown range, pass through */
    if (raw < dev_min) raw = dev_min;
    if (raw > dev_max) raw = dev_max;
    return (int)(((long long)(raw - dev_min) * (panel_max + 1)) / (dev_max - dev_min + 1));
}

/* Pick the best calibration for the active input source. */
static void transform_xy(int src_x, int src_y, int *out_x, int *out_y) {
    /* Choose the device's calibration. We prefer the one whose fd
     * produced the latest event; for simplicity we walk through all
     * devices and use the first one with usable calibration. */
    int dev_min_x = 0, dev_max_x = 0, dev_min_y = 0, dev_max_y = 0;
    int found = 0;
    for (int i = 0; i < g_dev_count; i++) {
        if (g_devs[i].has_mt_xy) {
            dev_min_x = g_devs[i].mt_x_min;
            dev_max_x = g_devs[i].mt_x_max;
            dev_min_y = g_devs[i].mt_y_min;
            dev_max_y = g_devs[i].mt_y_max;
            found = 1;
            break;
        }
        if (g_devs[i].has_abs_xy) {
            dev_min_x = g_devs[i].abs_x_min;
            dev_max_x = g_devs[i].abs_x_max;
            dev_min_y = g_devs[i].abs_y_min;
            dev_max_y = g_devs[i].abs_y_max;
            found = 1;
            break;
        }
    }

    int crop_y = g_touch_crop;
    if (crop_y < 0) {
        /* Auto-detect: if the framebuffer height is 768 and we detect a 600-height touch device,
         * it's the Waveshare 7inch LCD in DMT mode 16 (cropped display). */
        if (found && (dev_max_y - dev_min_y) == 600 && g_panel_h == 768) {
            crop_y = 1;
        } else {
            crop_y = 0;
        }
    }

    int target_x_max = g_panel_w - 1;
    int target_y_max = g_panel_h - 1;
    if (crop_y && found) {
        target_y_max = dev_max_y - dev_min_y;
    }

    int panel_x = found ? scale_axis(src_x, dev_min_x, dev_max_x, target_x_max) : src_x;
    int panel_y = found ? scale_axis(src_y, dev_min_y, dev_max_y, target_y_max) : src_y;

    /* Compat viewport: clamp the panel coordinate into the centered
     * 410x502 region. Touches in the letterbox clamp to the edge. */
    if (g_panel_w == g_viewport_w && g_panel_h == g_viewport_h) {
        *out_x = panel_x;
        *out_y = panel_y;
        return;
    }
    int pad_x = (g_panel_w - g_viewport_w) / 2;
    int pad_y = (g_panel_h - g_viewport_h) / 2;
    *out_x = panel_x - pad_x;
    *out_y = panel_y - pad_y;
    if (*out_x < 0) *out_x = 0;
    if (*out_y < 0) *out_y = 0;
    if (*out_x >= g_viewport_w) *out_x = g_viewport_w - 1;
    if (*out_y >= g_viewport_h) *out_y = g_viewport_h - 1;
}

/* ---- MT-B event dispatch ---- */

static void emit_touch_start_raw(int src_x, int src_y) {
    int x, y;
    transform_xy(src_x, src_y, &x, &y);
    g_pressed = 1;
    g_last_x = x; g_last_y = y;
    gea_logi("input: touch_start (%d, %d)", x, y);
    if (g_cbs.on_touch_start) g_cbs.on_touch_start(x, y, g_cbs.user);
}

static void emit_touch_move_raw(int src_x, int src_y) {
    int x, y;
    transform_xy(src_x, src_y, &x, &y);
    g_last_x = x; g_last_y = y;
    g_cached_x = x; g_cached_y = y; g_has_cached_move = 1;
    if (g_cbs.on_touch_move) g_cbs.on_touch_move(x, y, g_cbs.user);
}

static void emit_touch_end_raw(int src_x, int src_y) {
    int x, y;
    transform_xy(src_x, src_y, &x, &y);
    g_pressed = 0;
    gea_logi("input: touch_end (%d, %d)", x, y);
    if (g_cbs.on_touch_end) g_cbs.on_touch_end(x, y, g_cbs.user);
}

static void on_mt_slot(int slot) {
    if (slot < 0 || slot >= GEA_INPUT_MAX_SLOTS) slot = 0;
    g_current_slot = slot;
}

/* Tracks the desired state (active/inactive) for the current slot.
 * Does NOT emit; the SYN_REPORT handler decides whether to emit
 * start, move, or end. This is the key fix: previously the start was
 * emitted as soon as tracking_id became non-NONE, but at that point
 * ABS_MT_POSITION_X/Y might not have arrived yet, so the start was
 * emitted with the previous frame's coordinates (often 0, 0). */
static void on_mt_tracking_id(int id) {
    mt_slot_t *s = &g_slots[g_current_slot];
    s->tracking_id = id;
}

static void on_mt_position(int axis, int value) {
    mt_slot_t *s = &g_slots[g_current_slot];
    if (axis == ABS_MT_POSITION_X) s->x = value;
    else if (axis == ABS_MT_POSITION_Y) s->y = value;
}

static int g_legacy_x = -1, g_legacy_y = -1;

static void on_legacy_abs(int code, int value) {
    if (code == ABS_X) g_legacy_x = value;
    else if (code == ABS_Y) g_legacy_y = value;
}

static void on_key_event(int code, int value) {
    if (code < 0 || code >= MAX_KEYS) return;
    g_key_state[code] = value;
    if (g_cbs.on_key) g_cbs.on_key(code, value, g_cbs.user);
}

/* The kernel may report a touch begin either via:
 *   - MT-B: ABS_MT_TRACKING_ID going from -1 to >=0
 *   - Legacy: BTN_TOUCH (or BTN_LEFT) value going 0 -> 1
 * In both cases we set a "want_press" flag and defer the actual emit
 * to SYN_REPORT so the position is known. */
static int g_want_press = 0;
static int g_want_release = 0;

static void on_btn_press_pressed(void) {
    if (!g_pressed) g_want_press = 1;
}

static void on_btn_press_released(void) {
    if (g_pressed) g_want_release = 1;
}

static void drain_one_device(int idx) {
    struct input_event ev;
    static int debug_remaining = MAX_DEBUG_EVENTS;

    while (1) {
        ssize_t n = read(g_devs[idx].fd, &ev, sizeof(ev));
        if (n < 0) {
            if (errno == EAGAIN || errno == EWOULDBLOCK) break;
            if (errno == ENODEV) {
                gea_logw("input: device %s removed", g_devs[idx].path);
                close(g_devs[idx].fd);
                g_devs[idx].fd = -1;
                return;
            }
            return;
        }
        if (n != (ssize_t)sizeof(ev)) return;

        /* Log raw event for the first N events. */
        if (debug_remaining > 0) {
            gea_logi("input: ev type=%d code=%d value=%d (%s%s)",
                     ev.type, ev.code, ev.value,
                     g_devs[idx].name,
                     debug_remaining == 1 ? "  [last debug event]" : "");
            debug_remaining--;
        }

        switch (ev.type) {
            case EV_ABS:
                switch (ev.code) {
                    case ABS_MT_SLOT:        on_mt_slot(ev.value); break;
                    case ABS_MT_TRACKING_ID: on_mt_tracking_id(ev.value); break;
                    case ABS_MT_POSITION_X:
                    case ABS_MT_POSITION_Y:
                        on_mt_position(ev.code, ev.value);
                        break;
                    case ABS_X:
                    case ABS_Y:
                        if (!g_devs[idx].has_mt_xy) {
                            on_legacy_abs(ev.code, ev.value);
                        }
                        break;
                    default: break;
                }
                break;
            case EV_KEY:
                /* BTN_TOUCH (330) and BTN_LEFT (272) both signal touch
                 * press/release in different device classes. The
                 * previous code had a broken range check
                 * (>=BTN_TOUCH && <BTN_TOOL_FINGER) that was always
                 * false because BTN_TOUCH > BTN_TOOL_FINGER. */
                if (ev.code == BTN_TOUCH || ev.code == BTN_LEFT) {
                    if (ev.value) on_btn_press_pressed();
                    else          on_btn_press_released();
                } else {
                    on_key_event(ev.code, ev.value);
                }
                break;
            case EV_SYN:
                if (ev.code == SYN_REPORT) {
                    /* Emit deferred start/move/end based on the
                     * accumulated state of the active slot. */
                    if (g_want_release) {
                        int rx = 0, ry = 0;
                        if (g_active_slot >= 0) {
                            rx = g_slots[g_active_slot].x;
                            ry = g_slots[g_active_slot].y;
                        } else if (g_legacy_x >= 0 && g_legacy_y >= 0) {
                            rx = g_legacy_x; ry = g_legacy_y;
                        }
                        emit_touch_end_raw(rx, ry);
                        g_want_release = 0;
                        g_active_slot = -1;
                        g_start_emitted = 0;
                    } else if (g_want_press) {
                        /* Some devices (e.g. WaveShare WS170120) emit
                         * several SYN_REPORTs per gesture: the first
                         * carries the actual press data, later ones
                         * only MSC_TIMESTAMP updates but still report
                         * SYN_REPORT. We only want one touch_start per
                         * gesture. */
                        if (g_start_emitted) {
                            g_want_press = 0;
                        } else {
                            /* Find a slot with a valid tracking_id. */
                            int picked_slot = -1;
                            for (int s = 0; s < GEA_INPUT_MAX_SLOTS; s++) {
                                if (g_slots[s].tracking_id >= 0) {
                                    picked_slot = s;
                                    break;
                                }
                            }
                            /* Fall back to the most-recently-set slot. */
                            if (picked_slot < 0) picked_slot = g_current_slot;
                            g_active_slot = picked_slot;
                            emit_touch_start_raw(
                                g_slots[picked_slot].x,
                                g_slots[picked_slot].y);
                            g_want_press = 0;
                            g_start_emitted = 1;
                        }
                    } else if (g_pressed) {
                        /* Ongoing touch: emit a move with the latest position. */
                        if (g_devs[idx].has_mt_xy) {
                            if (g_active_slot >= 0) {
                                emit_touch_move_raw(
                                    g_slots[g_active_slot].x,
                                    g_slots[g_active_slot].y);
                            }
                        } else {
                            emit_touch_move_raw(g_legacy_x, g_legacy_y);
                        }
                    }
                }
                break;
            default: break;
        }
    }
}

/* ---- Device discovery ---- */

static void probe_calibration(int fd, input_dev_t *dev) {
    struct input_absinfo info;
    dev->has_abs_xy = 0;
    dev->has_mt_xy  = 0;

    if (ioctl(fd, EVIOCGABS(ABS_X), &info) == 0) {
        dev->has_abs_xy = 1;
        dev->abs_x_min = info.minimum;
        dev->abs_x_max = info.maximum;
    }
    if (ioctl(fd, EVIOCGABS(ABS_Y), &info) == 0) {
        dev->abs_y_min = info.minimum;
        dev->abs_y_max = info.maximum;
    }
    if (ioctl(fd, EVIOCGABS(ABS_MT_POSITION_X), &info) == 0) {
        dev->has_mt_xy = 1;
        dev->mt_x_min = info.minimum;
        dev->mt_x_max = info.maximum;
    }
    if (ioctl(fd, EVIOCGABS(ABS_MT_POSITION_Y), &info) == 0) {
        dev->mt_y_min = info.minimum;
        dev->mt_y_max = info.maximum;
    }
    gea_logi("input: %s calibration: abs=(%d..%d,%d..%d) mt=(%d..%d,%d..%d)",
             dev->name,
             dev->abs_x_min, dev->abs_x_max, dev->abs_y_min, dev->abs_y_max,
             dev->mt_x_min, dev->mt_x_max, dev->mt_y_min, dev->mt_y_max);
}

static int try_open_device(const char *path) {
    int fd = open(path, O_RDONLY | O_NONBLOCK);
    if (fd < 0) return -1;

    char name[64] = { 0 };
    if (ioctl(fd, EVIOCGNAME(sizeof(name) - 1), name) < 0) name[0] = 0;

    struct input_id ids;
    if (ioctl(fd, EVIOCGID, &ids) < 0) {
        close(fd);
        return -1;
    }

    /* Classify: prefer touch, pointer, or keyboard */
    uint32_t klass = 0;
    if (ioctl(fd, EVIOCGBIT(0, sizeof(klass)), &klass) >= 0) {
        int is_touch = (klass & (1 << EV_ABS)) != 0;
        int is_key   = (klass & (1 << EV_KEY)) != 0;
        if (!is_touch && !is_key) {
            close(fd);
            return -1;
        }
    }

    if (g_dev_count >= MAX_INPUT_DEVS) {
        close(fd);
        return -1;
    }

    input_dev_t *d = &g_devs[g_dev_count++];
    d->fd = fd;
    snprintf(d->path, sizeof(d->path), "%s", path);
    snprintf(d->name, sizeof(d->name), "%s", name);
    gea_logi("input: opened %s (%s)", d->path, d->name);
    probe_calibration(fd, d);
    return 0;
}

static void discover_devices(void) {
    DIR *dir = opendir("/dev/input");
    if (!dir) {
        gea_logw("input: cannot open /dev/input: %s", strerror(errno));
        return;
    }
    struct dirent *de;
    while ((de = readdir(dir)) != NULL) {
        if (strncmp(de->d_name, "event", 5) != 0) continue;
        char path[64];
        snprintf(path, sizeof(path), "/dev/input/%s", de->d_name);
        try_open_device(path);
    }
    closedir(dir);
}

/* ---- Public API ---- */

int gea_embedded_input_init(gea_rpi_input_backend_t backend, const gea_rpi_input_callbacks_t *cbs) {
    const char *crop_env = getenv("GEA_RPI_TOUCH_CROP");
    if (crop_env) {
        g_touch_crop = atoi(crop_env);
    } else {
        g_touch_crop = -1; /* auto-detect */
    }

    if (cbs) g_cbs = *cbs;
    g_backend = backend;
    memset(g_slots, 0, sizeof(g_slots));
    for (int i = 0; i < MAX_INPUT_DEVS; i++) g_devs[i].fd = -1;
    g_active_slot = -1;
    g_pressed = 0;
    g_start_emitted = 0;
    g_legacy_x = -1; g_legacy_y = -1;
    g_want_press = 0; g_want_release = 0;
    discover_devices();
    if (g_dev_count == 0) {
        gea_logw("input: no input devices found");
        return -1;
    }
    return 0;
}

void gea_embedded_input_shutdown(void) {
    for (int i = 0; i < g_dev_count; i++) {
        if (g_devs[i].fd >= 0) {
            close(g_devs[i].fd);
            g_devs[i].fd = -1;
        }
    }
    g_dev_count = 0;
}

int gea_embedded_input_poll(int timeout_ms) {
    struct pollfd pfds[MAX_INPUT_DEVS];
    int n = 0;
    for (int i = 0; i < g_dev_count; i++) {
        if (g_devs[i].fd >= 0) {
            pfds[n].fd = g_devs[i].fd;
            pfds[n].events = POLLIN;
            n++;
        }
    }
    if (n == 0) return 0;
    int rc = poll(pfds, n, timeout_ms);
    if (rc <= 0) return 0;
    int processed = 0;
    int idx = 0;
    for (int i = 0; i < g_dev_count; i++) {
        if (g_devs[i].fd < 0) continue;
        if (pfds[idx].revents & POLLIN) {
            drain_one_device(i);
            processed++;
        }
        idx++;
    }
    return processed;
}

int gea_embedded_input_read_cached(int *x, int *y) {
    if (!g_pressed) return 0;
    *x = g_last_x; *y = g_last_y;
    return 1;
}

void gea_embedded_input_consume_latest_move(int *x, int *y) {
    if (g_has_cached_move) {
        *x = g_cached_x; *y = g_cached_y;
        g_has_cached_move = 0;
    } else {
        *x = g_last_x; *y = g_last_y;
    }
}

void gea_embedded_input_set_panel_size(int w, int h)    { g_panel_w = w; g_panel_h = h; }
void gea_embedded_input_set_viewport_size(int w, int h) { g_viewport_w = w; g_viewport_h = h; }

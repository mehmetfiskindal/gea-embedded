/*
 * QMI8658 IMU driver + air mouse algorithm
 *
 * I2C: SDA = GPIO 15, SCL = GPIO 14, address = 0x6B
 * Polling: 8 ms via esp_timer
 */

#include "imu.h"
#include "ble.h"
#include "touch.h"

#include <math.h>
#include <string.h>
#include "esp_log.h"
#include "esp_timer.h"
#include "driver/i2c_master.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static const char *TAG = "gea_embedded_imu";

/* ---- QMI8658 registers ---- */

#define QMI8658_ADDR       0x6B
#define REG_WHO_AM_I       0x00
#define REG_CTRL1          0x02
#define REG_CTRL2          0x03
#define REG_CTRL3          0x04
#define REG_CTRL5          0x06
#define REG_CTRL7          0x08
#define REG_RESET          0x60
#define REG_TEMP_L         0x33

#define EXPECTED_WHO_AM_I  0x05

#define ACCEL_SCALE  (8.0 / 32768.0)    /* AFS_8G  */
#define GYRO_SCALE   (512.0 / 32768.0)  /* GFS_512DPS */
#define STANDARD_GRAVITY 9.80665

/* ---- I2C handle (bus shared with touch driver) ---- */

static i2c_master_dev_handle_t  s_dev  = NULL;
static bool s_imu_open = false;

/* ---- Air mouse tuning constants ---- */

#define GAIN_X       0.5
#define GAIN_Y       0.5
#define SMOOTH       0.5
#define DEAD_ZONE    0.0
#define LINE_SNAP    0.04
#define SNAP_DECAY   0.92
#define COMP_ALPHA   0.03
#define MOUSE_SCALE  15.0

#define POLL_MS      8
#define BIAS_SAMPLES 100

/* ---- Air mouse state ---- */

typedef struct {
    double w, x, y, z;
} quat_t;

typedef struct { double x, y, z; } vec3_t;

static quat_t s_quat;
static quat_t s_accel_rest_quat;
static double s_smooth_nx, s_smooth_ny;
static double s_prev_nx, s_prev_ny;
static double s_accum_dx, s_accum_dy;
static double s_residual_x, s_residual_y;
static double s_bias_x, s_bias_y, s_bias_z;
static double s_rest_ax, s_rest_ay, s_rest_az;

static int    s_mouse_buttons = 0;
static esp_timer_handle_t s_mouse_timer = NULL;

static int tilt_from_accel(double axis)
{
    int v = (int)(axis * 70.0);
    if (v < -100) return -100;
    if (v > 100) return 100;
    return v;
}

/* ---- I2C helpers ---- */

static esp_err_t imu_write_reg(uint8_t reg, uint8_t val)
{
    uint8_t buf[2] = { reg, val };
    return i2c_master_transmit(s_dev, buf, 2, 100);
}

static uint8_t imu_read_reg(uint8_t reg)
{
    uint8_t val = 0;
    i2c_master_transmit_receive(s_dev, &reg, 1, &val, 1, 100);
    return val;
}

static esp_err_t imu_read_block(uint8_t reg, uint8_t *buf, size_t len)
{
    return i2c_master_transmit_receive(s_dev, &reg, 1, buf, len, 100);
}

/* ---- IMU sample ---- */

typedef struct {
    double ax, ay, az;
    double gx, gy, gz;
} imu_sample_t;

static bool imu_read_sample(imu_sample_t *out)
{
    uint8_t raw[14];
    if (imu_read_block(REG_TEMP_L, raw, 14) != ESP_OK) return false;

    int16_t rax = (int16_t)(raw[2]  | (raw[3]  << 8));
    int16_t ray = (int16_t)(raw[4]  | (raw[5]  << 8));
    int16_t raz = (int16_t)(raw[6]  | (raw[7]  << 8));
    int16_t rgx = (int16_t)(raw[8]  | (raw[9]  << 8));
    int16_t rgy = (int16_t)(raw[10] | (raw[11] << 8));
    int16_t rgz = (int16_t)(raw[12] | (raw[13] << 8));

    out->ax = rax * ACCEL_SCALE;
    out->ay = ray * ACCEL_SCALE;
    out->az = raz * ACCEL_SCALE;
    out->gx = rgx * GYRO_SCALE;
    out->gy = rgy * GYRO_SCALE;
    out->gz = rgz * GYRO_SCALE;
    return true;
}

/* ---- Quaternion math ---- */

static quat_t q_mul(quat_t a, quat_t b)
{
    return (quat_t){
        .w = a.w*b.w - a.x*b.x - a.y*b.y - a.z*b.z,
        .x = a.w*b.x + a.x*b.w + a.y*b.z - a.z*b.y,
        .y = a.w*b.y - a.x*b.z + a.y*b.w + a.z*b.x,
        .z = a.w*b.z + a.x*b.y - a.y*b.x + a.z*b.w
    };
}

static quat_t q_norm(quat_t q)
{
    double m = sqrt(q.w*q.w + q.x*q.x + q.y*q.y + q.z*q.z);
    if (m < 0.000001) return (quat_t){1,0,0,0};
    return (quat_t){ q.w/m, q.x/m, q.y/m, q.z/m };
}

static quat_t q_from_euler(double x, double y, double z)
{
    double cx = cos(x/2), sx = sin(x/2);
    double cy = cos(y/2), sy = sin(y/2);
    double cz = cos(z/2), sz = sin(z/2);
    return (quat_t){
        .w = cx*cy*cz + sx*sy*sz,
        .x = sx*cy*cz - cx*sy*sz,
        .y = cx*sy*cz + sx*cy*sz,
        .z = cx*cy*sz - sx*sy*cz
    };
}

static vec3_t q_rotate_vec(quat_t q, vec3_t v)
{
    quat_t qv = { 0, v.x, v.y, v.z };
    quat_t qc = { q.w, -q.x, -q.y, -q.z };
    quat_t r = q_mul(q_mul(q, qv), qc);
    return (vec3_t){ r.x, r.y, r.z };
}

static quat_t q_slerp(quat_t a, quat_t b, double t)
{
    double dot = a.w*b.w + a.x*b.x + a.y*b.y + a.z*b.z;
    if (dot < 0) {
        b = (quat_t){ -b.w, -b.x, -b.y, -b.z };
        dot = -dot;
    }
    if (dot > 0.9995) {
        return q_norm((quat_t){
            a.w + t*(b.w - a.w),
            a.x + t*(b.x - a.x),
            a.y + t*(b.y - a.y),
            a.z + t*(b.z - a.z)
        });
    }
    double theta = acos(dot);
    double sinT = sin(theta);
    double wa = sin((1 - t) * theta) / sinT;
    double wb = sin(t * theta) / sinT;
    return (quat_t){
        wa*a.w + wb*b.w,
        wa*a.x + wb*b.x,
        wa*a.y + wb*b.y,
        wa*a.z + wb*b.z
    };
}

static quat_t q_from_unit_vectors(vec3_t from, vec3_t to)
{
    double dot = from.x*to.x + from.y*to.y + from.z*to.z;
    if (dot > 0.999999) return (quat_t){1,0,0,0};
    if (dot < -0.999999) {
        vec3_t ax = {1,0,0};
        double c = from.x*ax.x + from.y*ax.y + from.z*ax.z;
        if (fabs(c) > 0.9) ax = (vec3_t){0,1,0};
        double cx2 = from.y*ax.z - from.z*ax.y;
        double cy2 = from.z*ax.x - from.x*ax.z;
        double cz2 = from.x*ax.y - from.y*ax.x;
        double m = sqrt(cx2*cx2 + cy2*cy2 + cz2*cz2);
        return (quat_t){ 0, cx2/m, cy2/m, cz2/m };
    }
    double cx = from.y*to.z - from.z*to.y;
    double cy = from.z*to.x - from.x*to.z;
    double cz = from.x*to.y - from.y*to.x;
    double w = 1 + dot;
    return q_norm((quat_t){ w, cx, cy, cz });
}

/* ---- Sensor reset + reconfigure ---- */

static void imu_reset_configure(void)
{
    imu_write_reg(REG_RESET, 0xB0);
    vTaskDelay(pdMS_TO_TICKS(20));

    imu_write_reg(REG_CTRL1, 0x40);
    imu_write_reg(REG_CTRL2, 0x15);  /* accel: 8G, 469Hz */
    imu_write_reg(REG_CTRL3, 0x54);  /* gyro: 512dps, ODR4 */
    imu_write_reg(REG_CTRL5, 0x00);
    imu_write_reg(REG_CTRL7, 0x03);  /* enable accel + gyro */
    vTaskDelay(pdMS_TO_TICKS(50));
}

/* ---- Air mouse timer callback ---- */

static void mouse_timer_cb(void *arg)
{
    (void)arg;
    imu_sample_t s;
    if (!imu_read_sample(&s)) return;

    const double DT = POLL_MS / 1000.0;

    double gx = ((s.gx - s_bias_x) * M_PI / 180.0) * DT;
    double gy = ((s.gy - s_bias_y) * M_PI / 180.0) * DT;
    double gz = ((s.gz - s_bias_z) * M_PI / 180.0) * DT;

    quat_t dq = q_from_euler(gy, -gz, -gx);
    s_quat = q_norm(q_mul(s_quat, dq));

    /* Complementary filter: accelerometer correction */
    vec3_t accel_dev = { s.ay, -s.az, -s.ax };
    double amag = sqrt(accel_dev.x*accel_dev.x + accel_dev.y*accel_dev.y + accel_dev.z*accel_dev.z);
    if (amag > 0.3) {
        vec3_t an = { accel_dev.x/amag, accel_dev.y/amag, accel_dev.z/amag };
        vec3_t corrected = q_rotate_vec(s_accel_rest_quat, an);
        vec3_t world_up  = q_rotate_vec(s_quat, corrected);
        quat_t correction = q_from_unit_vectors(world_up, (vec3_t){0,1,0});
        quat_t small_corr = q_slerp((quat_t){1,0,0,0}, correction, COMP_ALPHA);
        s_quat = q_norm(q_mul(small_corr, s_quat));
    }

    vec3_t forward = q_rotate_vec(s_quat, (vec3_t){0, 0, -1});
    if (fabs(forward.z) < 0.01) return;

    double t = -5.0 / forward.z;
    double nx = (forward.x * t / 2.4) * GAIN_X;
    double ny = (-(forward.y * t) / 1.35) * GAIN_Y;

    double dx_raw = nx - s_prev_nx;
    double dy_raw = ny - s_prev_ny;
    double move_len = sqrt(dx_raw*dx_raw + dy_raw*dy_raw);

    if (move_len < DEAD_ZONE) {
        nx = s_prev_nx;
        ny = s_prev_ny;
    } else {
        s_accum_dx = s_accum_dx * SNAP_DECAY + dx_raw;
        s_accum_dy = s_accum_dy * SNAP_DECAY + dy_raw;
        if (LINE_SNAP > 0) {
            double abs_ax = fabs(s_accum_dx);
            double abs_ay = fabs(s_accum_dy);
            double max_a = (abs_ax > abs_ay) ? abs_ax : abs_ay;
            if (max_a > 0.001) {
                double ratio = ((abs_ax < abs_ay) ? abs_ax : abs_ay) / max_a;
                if (ratio < LINE_SNAP) {
                    if (abs_ax < abs_ay) nx = s_prev_nx;
                    else                 ny = s_prev_ny;
                }
            }
        }
    }

    double old_sx = s_smooth_nx;
    double old_sy = s_smooth_ny;
    s_smooth_nx += SMOOTH * (nx - s_smooth_nx);
    s_smooth_ny += SMOOTH * (ny - s_smooth_ny);
    s_prev_nx = nx;
    s_prev_ny = ny;

    s_residual_x += (s_smooth_nx - old_sx) * MOUSE_SCALE * 100.0;
    s_residual_y += (s_smooth_ny - old_sy) * MOUSE_SCALE * 100.0;
    int dx = (int)s_residual_x;
    int dy = (int)s_residual_y;
    s_residual_x -= dx;
    s_residual_y -= dy;

    if (dx || dy) {
        gea_embedded_ble_mouse_move(dx, dy, s_mouse_buttons, 0);
    }
}

/* ---- Public API ---- */

void gea_embedded_imu_init(void)
{
    if (s_imu_open) return;

    i2c_master_bus_handle_t bus = gea_embedded_touch_get_i2c_bus();
    if (!bus) {
        ESP_LOGE(TAG, "I2C bus not available (touch not initialized?)");
        return;
    }

    i2c_device_config_t dev_cfg = {
        .dev_addr_length = I2C_ADDR_BIT_LEN_7,
        .device_address  = QMI8658_ADDR,
        .scl_speed_hz    = 400000,
    };
    esp_err_t err = i2c_master_bus_add_device(bus, &dev_cfg, &s_dev);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "i2c_master_bus_add_device failed: %s", esp_err_to_name(err));
        return;
    }

    uint8_t id = imu_read_reg(REG_WHO_AM_I);
    if (id != EXPECTED_WHO_AM_I) {
        ESP_LOGE(TAG, "QMI8658 WHO_AM_I mismatch: got 0x%02x, expected 0x%02x", id, EXPECTED_WHO_AM_I);
        return;
    }
    ESP_LOGI(TAG, "QMI8658 detected (WHO_AM_I=0x%02x)", id);

    imu_reset_configure();

    s_imu_open = true;
    ESP_LOGI(TAG, "QMI8658 initialized");
}

void gea_embedded_imu_close(void)
{
    gea_embedded_imu_stop_mouse();

    if (s_dev) {
        i2c_master_bus_rm_device(s_dev);
        s_dev = NULL;
    }
    s_imu_open = false;
}

void gea_embedded_imu_calibrate_bias(void)
{
    if (!s_imu_open) {
        gea_embedded_imu_init();
        if (!s_imu_open) return;
    }

    double sum_gx = 0, sum_gy = 0, sum_gz = 0;
    double sum_ax = 0, sum_ay = 0, sum_az = 0;

    for (int i = 0; i < BIAS_SAMPLES; i++) {
        vTaskDelay(pdMS_TO_TICKS(3));
        imu_sample_t samp;
        if (!imu_read_sample(&samp)) continue;
        sum_gx += samp.gx;
        sum_gy += samp.gy;
        sum_gz += samp.gz;
        sum_ax += samp.ax;
        sum_ay += samp.ay;
        sum_az += samp.az;
    }

    s_bias_x = sum_gx / BIAS_SAMPLES;
    s_bias_y = sum_gy / BIAS_SAMPLES;
    s_bias_z = sum_gz / BIAS_SAMPLES;
    s_rest_ax = sum_ax / BIAS_SAMPLES;
    s_rest_ay = sum_ay / BIAS_SAMPLES;
    s_rest_az = sum_az / BIAS_SAMPLES;

    ESP_LOGI(TAG, "Bias captured: gx=%.3f gy=%.3f gz=%.3f", s_bias_x, s_bias_y, s_bias_z);
}

static void mouse_start_task(void *arg)
{
    (void)arg;

    if (!s_imu_open) {
        gea_embedded_imu_init();
        if (!s_imu_open) { vTaskDelete(NULL); return; }
    }

    imu_reset_configure();
    gea_embedded_imu_calibrate_bias();

    s_quat = (quat_t){1, 0, 0, 0};
    s_smooth_nx = 0;
    s_smooth_ny = 0;
    s_prev_nx = 0;
    s_prev_ny = 0;
    s_accum_dx = 0;
    s_accum_dy = 0;
    s_residual_x = 0;
    s_residual_y = 0;

    s_accel_rest_quat = (quat_t){1, 0, 0, 0};
    vec3_t rv = { s_rest_ay, -s_rest_az, -s_rest_ax };
    double rm = sqrt(rv.x*rv.x + rv.y*rv.y + rv.z*rv.z);
    if (rm > 0.1) {
        rv.x /= rm;
        rv.y /= rm;
        rv.z /= rm;
        s_accel_rest_quat = q_from_unit_vectors(rv, (vec3_t){0, 1, 0});
    }

    esp_timer_create_args_t timer_args = {
        .callback = mouse_timer_cb,
        .name = "imu_mouse",
    };
    ESP_ERROR_CHECK(esp_timer_create(&timer_args, &s_mouse_timer));
    ESP_ERROR_CHECK(esp_timer_start_periodic(s_mouse_timer, POLL_MS * 1000));

    ESP_LOGI(TAG, "Air mouse started (poll=%dms)", POLL_MS);
    vTaskDelete(NULL);
}

void gea_embedded_imu_start_mouse(void)
{
    gea_embedded_imu_stop_mouse();
    xTaskCreate(mouse_start_task, "imu_start", 4096, NULL, 5, NULL);
}

void gea_embedded_imu_stop_mouse(void)
{
    if (s_mouse_timer) {
        esp_timer_stop(s_mouse_timer);
        esp_timer_delete(s_mouse_timer);
        s_mouse_timer = NULL;
        ESP_LOGI(TAG, "Air mouse stopped");
    }
}

void gea_embedded_imu_set_mouse_buttons(int buttons)
{
    s_mouse_buttons = buttons;
}

int gea_embedded_imu_get_mouse_buttons(void)
{
    return s_mouse_buttons;
}

int gea_embedded_imu_get_tilt_x(void)
{
    if (!s_imu_open) {
        gea_embedded_imu_init();
        if (!s_imu_open) return 0;
    }

    imu_sample_t sample;
    if (!imu_read_sample(&sample)) return 0;
    return tilt_from_accel(sample.ay);
}

int gea_embedded_imu_get_tilt_y(void)
{
    if (!s_imu_open) {
        gea_embedded_imu_init();
        if (!s_imu_open) return 0;
    }

    imu_sample_t sample;
    if (!imu_read_sample(&sample)) return 0;
    return tilt_from_accel(-sample.ax);
}

double gea_embedded_imu_get_acceleration_x(void)
{
    if (!s_imu_open) {
        gea_embedded_imu_init();
        if (!s_imu_open) return 0.0;
    }

    imu_sample_t sample;
    if (!imu_read_sample(&sample)) return 0.0;
    return sample.ax * STANDARD_GRAVITY;
}

double gea_embedded_imu_get_acceleration_y(void)
{
    if (!s_imu_open) {
        gea_embedded_imu_init();
        if (!s_imu_open) return 0.0;
    }

    imu_sample_t sample;
    if (!imu_read_sample(&sample)) return 0.0;
    return sample.ay * STANDARD_GRAVITY;
}

double gea_embedded_imu_get_acceleration_z(void)
{
    if (!s_imu_open) {
        gea_embedded_imu_init();
        if (!s_imu_open) return 0.0;
    }

    imu_sample_t sample;
    if (!imu_read_sample(&sample)) return 0.0;
    return sample.az * STANDARD_GRAVITY;
}

void gea_embedded_imu_web_set_tilt(int x, int y)
{
    (void)x;
    (void)y;
}

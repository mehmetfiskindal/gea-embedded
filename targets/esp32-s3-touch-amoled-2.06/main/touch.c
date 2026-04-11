#include "touch.h"
#include "event.h"
#include "driver/i2c_master.h"
#include "driver/gpio.h"
#include "esp_attr.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static const char *TAG = "touch";

#define TOUCH_SDA   GPIO_NUM_15
#define TOUCH_SCL   GPIO_NUM_14
#define TOUCH_RST   GPIO_NUM_9
#define TOUCH_INT   GPIO_NUM_38
#define TOUCH_ADDR  0x38
#define AXP2101_ADDR 0x34
#define TOUCH_FREQ  400000
#define TOUCH_POLL_MS 10
#define TOUCH_TASK_STACK 4096

static i2c_master_bus_handle_t bus_handle = NULL;
static i2c_master_dev_handle_t dev_handle = NULL;
static i2c_master_dev_handle_t axp_handle = NULL;
static DRAM_ATTR TaskHandle_t touch_task_handle = NULL;
static DRAM_ATTR StaticTask_t touch_task_tcb;
static DRAM_ATTR StackType_t touch_task_stack[TOUCH_TASK_STACK];
static volatile int touch_move_event_pending = 0;
static volatile int touch_latest_move_x = 0;
static volatile int touch_latest_move_y = 0;
static volatile int touch_current_touching = 0;
static volatile int touch_current_x = 0;
static volatile int touch_current_y = 0;

static esp_err_t touch_write_reg(uint8_t reg, uint8_t val)
{
	uint8_t buf[2] = { reg, val };
	return i2c_master_transmit(dev_handle, buf, 2, 100);
}

static esp_err_t touch_read_regs(uint8_t reg, uint8_t *data, size_t len)
{
	return i2c_master_transmit_receive(dev_handle, &reg, 1, data, len, 100);
}

static void IRAM_ATTR touch_isr_handler(void *arg)
{
	(void)arg;
	BaseType_t woken = pdFALSE;
	if (touch_task_handle)
		vTaskNotifyGiveFromISR(touch_task_handle, &woken);
	portYIELD_FROM_ISR(woken);
}

static void queue_touch_edge(int phase, int touching, int x, int y)
{
	if (!gea_embedded_event_queue) return;
	gea_embedded_event_t evt = {
		.type = GEA_EMBEDDED_EVT_TOUCH,
		.data = phase,
		.touching = touching,
		.x = x,
		.y = y,
	};
	xQueueSend(gea_embedded_event_queue, &evt, pdMS_TO_TICKS(50));
}

static void queue_touch_move(int x, int y)
{
	touch_latest_move_x = x;
	touch_latest_move_y = y;

	if (!gea_embedded_event_queue || touch_move_event_pending) return;
	gea_embedded_event_t evt = {
		.type = GEA_EMBEDDED_EVT_TOUCH,
		.data = GEA_EMBEDDED_TOUCH_MOVE,
		.touching = 1,
		.x = x,
		.y = y,
	};
	touch_move_event_pending = 1;
	if (xQueueSend(gea_embedded_event_queue, &evt, 0) != pdPASS)
		touch_move_event_pending = 0;
}

static void touch_task(void *arg)
{
	(void)arg;
	int last_touching = 0;
	int last_x = 0;
	int last_y = 0;

	while (1) {
		TickType_t wait_ticks = last_touching ? pdMS_TO_TICKS(TOUCH_POLL_MS) : portMAX_DELAY;
		ulTaskNotifyTake(pdTRUE, wait_ticks);

		int x = last_x;
		int y = last_y;
		int touching = gea_embedded_touch_read(&x, &y);
		if (!touching) {
			x = last_x;
			y = last_y;
		}

		if (touching && !last_touching) {
			queue_touch_edge(GEA_EMBEDDED_TOUCH_DOWN, 1, x, y);
		} else if (!touching && last_touching) {
			queue_touch_edge(GEA_EMBEDDED_TOUCH_UP, 0, x, y);
		} else if (touching && (x != last_x || y != last_y)) {
			queue_touch_move(x, y);
		}

		touch_current_touching = touching;
		touch_current_x = x;
		touch_current_y = y;

		last_touching = touching;
		if (touching) {
			last_x = x;
			last_y = y;
		}
	}
}

void gea_embedded_touch_consume_latest_move(int *x, int *y)
{
	touch_move_event_pending = 0;
	if (x) *x = touch_latest_move_x;
	if (y) *y = touch_latest_move_y;
}

int gea_embedded_touch_read_cached(int *x, int *y)
{
	if (x) *x = touch_current_x;
	if (y) *y = touch_current_y;
	return touch_current_touching;
}

static esp_err_t axp2101_init(i2c_master_bus_handle_t bus)
{
	i2c_device_config_t cfg = {
		.dev_addr_length = I2C_ADDR_BIT_LEN_7,
		.device_address = AXP2101_ADDR,
		.scl_speed_hz = TOUCH_FREQ,
	};
	esp_err_t err = i2c_master_bus_add_device(bus, &cfg, &axp_handle);
	if (err != ESP_OK) return err;

	uint8_t buf[2] = { 0x30, 0x0F };
	err = i2c_master_transmit(axp_handle, buf, 2, 100);
	if (err != ESP_OK) {
		ESP_LOGE(TAG, "AXP2101 power rail enable failed");
		return err;
	}
	ESP_LOGI(TAG, "AXP2101 power rails enabled");

	/* Enable fuel gauge (coulomb counter) */
	uint8_t gauge_en[2] = { 0x68, 0x01 };
	i2c_master_transmit(axp_handle, gauge_en, 2, 100);

	return ESP_OK;
}

esp_err_t gea_embedded_touch_init(void)
{
	ESP_LOGI(TAG, "Initializing FT3168 touch (SDA=%d, SCL=%d, RST=%d, INT=%d)",
		TOUCH_SDA, TOUCH_SCL, TOUCH_RST, TOUCH_INT);

	i2c_master_bus_config_t bus_cfg = {
		.i2c_port = -1,
		.sda_io_num = TOUCH_SDA,
		.scl_io_num = TOUCH_SCL,
		.clk_source = I2C_CLK_SRC_DEFAULT,
		.flags.enable_internal_pullup = true,
	};
	ESP_ERROR_CHECK(i2c_new_master_bus(&bus_cfg, &bus_handle));

	axp2101_init(bus_handle);

	gpio_config_t rst_cfg = {
		.pin_bit_mask = 1ULL << TOUCH_RST,
		.mode = GPIO_MODE_OUTPUT,
	};
	gpio_config(&rst_cfg);

	gpio_set_level(TOUCH_RST, 0);
	vTaskDelay(pdMS_TO_TICKS(5));
	gpio_set_level(TOUCH_RST, 1);
	vTaskDelay(pdMS_TO_TICKS(300));

	i2c_device_config_t dev_cfg = {
		.dev_addr_length = I2C_ADDR_BIT_LEN_7,
		.device_address = TOUCH_ADDR,
		.scl_speed_hz = TOUCH_FREQ,
	};
	ESP_ERROR_CHECK(i2c_master_bus_add_device(bus_handle, &dev_cfg, &dev_handle));

	touch_write_reg(0x80, 128);
	touch_write_reg(0x86, 1);
	touch_write_reg(0x87, 10);

	touch_task_handle = xTaskCreateStatic(touch_task, "touch", TOUCH_TASK_STACK, NULL, 10, touch_task_stack, &touch_task_tcb);
	if (!touch_task_handle) {
		ESP_LOGE(TAG, "Failed to start touch task");
		return ESP_ERR_NO_MEM;
	}

	gpio_config_t int_cfg = {
		.pin_bit_mask = 1ULL << TOUCH_INT,
		.mode = GPIO_MODE_INPUT,
		.intr_type = GPIO_INTR_NEGEDGE,
	};
	gpio_config(&int_cfg);
	gpio_install_isr_service(0);
	gpio_isr_handler_add(TOUCH_INT, touch_isr_handler, NULL);

	ESP_LOGI(TAG, "Touch controller ready (interrupt-driven)");
	return ESP_OK;
}

int gea_embedded_touch_read(int *x, int *y)
{
	uint8_t count = 0;
	if (touch_read_regs(0x02, &count, 1) != ESP_OK) return 0;
	count &= 0x0F;
	if (count == 0) return 0;

	uint8_t data[4];
	if (touch_read_regs(0x03, data, 4) != ESP_OK) return 0;

	*x = ((data[0] & 0x0F) << 8) | data[1];
	*y = ((data[2] & 0x0F) << 8) | data[3];
	touch_current_touching = 1;
	touch_current_x = *x;
	touch_current_y = *y;
	return 1;
}

i2c_master_bus_handle_t gea_embedded_touch_get_i2c_bus(void) { return bus_handle; }

int gea_embedded_battery_read_percent(void)
{
	if (!axp_handle) return -1;

	uint8_t reg = 0xA4;
	uint8_t val = 0;
	esp_err_t err = i2c_master_transmit_receive(axp_handle, &reg, 1, &val, 1, 100);
	if (err != ESP_OK) return -1;

	int pct = val & 0x7F;
	if (pct > 100) pct = 100;
	return pct;
}

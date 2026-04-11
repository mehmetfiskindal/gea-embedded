#include "apps.h"

#include <stdio.h>
#include <stdint.h>
#include <string.h>

#include "event.h"
#include "gea_embedded_installed_apps_generated.h"
#include "resident_apps.h"

#include "driver/gpio.h"
#include "esp_app_desc.h"
#include "esp_err.h"
#include "esp_log.h"
#include "esp_ota_ops.h"
#include "esp_partition.h"
#include "esp_system.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static const char *TAG = "apps";
static const char *LAUNCHER_APP_ID = "app-launcher";
static const gpio_num_t LAUNCHER_BUTTON_GPIO = GPIO_NUM_0;
static const int LAUNCHER_BUTTON_ACTIVE_LEVEL = 0;
static const int LAUNCHER_BUTTON_DEBOUNCE_MS = 50;
static const int LAUNCHER_BUTTON_POLL_MS = 25;
static const int LAUNCHER_BUTTON_LONG_PRESS_MS = 800;
static const uint32_t LAUNCHER_BUTTON_TASK_STACK = 12288;

static TaskHandle_t launcher_button_task = NULL;

static int partition_version_matches(const esp_partition_t *partition, const char *app_id)
{
	esp_app_desc_t desc;
	if (esp_ota_get_partition_description(partition, &desc) != ESP_OK) return 0;
	return strcmp(desc.version, app_id) == 0;
}

static const esp_partition_t *find_app_partition_by_version(const char *app_id, const esp_partition_t *skip)
{
	esp_partition_iterator_t it = esp_partition_find(ESP_PARTITION_TYPE_APP, ESP_PARTITION_SUBTYPE_ANY, NULL);
	const esp_partition_t *found = NULL;

	while (it) {
		const esp_partition_t *partition = esp_partition_get(it);
		if (partition && (!skip || partition->address != skip->address) && partition_version_matches(partition, app_id)) {
			found = partition;
			break;
		}
		it = esp_partition_next(it);
	}

	if (it) esp_partition_iterator_release(it);
	return found;
}

static const esp_partition_t *find_planned_app_partition(const char *app_id, const esp_partition_t *skip)
{
	for (int i = 0; i < gea_embedded_installed_app_plan_count; i++) {
		const gea_embedded_installed_app_plan_entry_t *entry = &gea_embedded_installed_app_plan[i];
		if (!entry->app_id || strcmp(entry->app_id, app_id) != 0) continue;

		const esp_partition_t *partition = esp_partition_find_first(ESP_PARTITION_TYPE_APP, ESP_PARTITION_SUBTYPE_ANY, entry->slot_label);
		if (!partition) {
			ESP_LOGW(TAG, "Install plan maps '%s' to missing partition %s", app_id, entry->slot_label);
			continue;
		}
		if (skip && partition->address == skip->address) continue;

		esp_app_desc_t desc;
		esp_err_t err = esp_ota_get_partition_description(partition, &desc);
		if (err == ESP_OK) {
			if (strcmp(desc.version, app_id) != 0) {
				ESP_LOGW(TAG, "Install plan maps '%s' to %s, but slot contains '%s'", app_id, partition->label, desc.version);
				continue;
			}
		} else {
			ESP_LOGW(TAG, "Install plan maps '%s' to %s, but descriptor read failed: %s", app_id, partition->label, esp_err_to_name(err));
			continue;
		}

		return partition;
	}

	return NULL;
}

static const esp_partition_t *find_app_partition(const char *app_id, const esp_partition_t *skip)
{
	const esp_partition_t *partition = find_app_partition_by_version(app_id, skip);
	if (partition) return partition;

	partition = find_planned_app_partition(app_id, skip);
	if (partition) {
		ESP_LOGW(TAG, "Using installed app plan fallback for '%s' in %s", app_id, partition->label);
	}
	return partition;
}

static const esp_partition_t *find_launcher_partition(const esp_partition_t *skip)
{
	const esp_partition_t *partition = find_planned_app_partition(LAUNCHER_APP_ID, skip);
	if (partition) return partition;
	return find_app_partition_by_version(LAUNCHER_APP_ID, skip);
}

const char *gea_embedded_apps_get_current_id(void)
{
	if (gea_embedded_resident_apps_is_enabled()) {
		const char *resident_id = gea_embedded_resident_apps_active_id();
		if (resident_id && resident_id[0]) return resident_id;
	}

	static char cached_id[64];
	if (cached_id[0] != '\0') return cached_id;

	const esp_partition_t *running = esp_ota_get_running_partition();
	if (!running) return NULL;

	esp_app_desc_t desc;
	if (esp_ota_get_partition_description(running, &desc) != ESP_OK) return NULL;

	snprintf(cached_id, sizeof(cached_id), "%s", desc.version);
	return cached_id[0] ? cached_id : NULL;
}

int gea_embedded_apps_launch(const char *app_id)
{
	if (!app_id || app_id[0] == '\0') return 0;

	if (gea_embedded_resident_apps_request_launch(app_id)) {
		ESP_LOGI(TAG, "Launching resident app '%s'", app_id);
		return 1;
	}

	const esp_partition_t *running = esp_ota_get_running_partition();
	const esp_partition_t *partition = find_app_partition(app_id, running);
	if (partition) {
		esp_err_t err = esp_ota_set_boot_partition(partition);
		if (err != ESP_OK) {
			ESP_LOGE(TAG, "Failed to select app '%s': %s", app_id, esp_err_to_name(err));
			return 0;
		}

		ESP_LOGI(TAG, "Launching app '%s' from partition %s", app_id, partition->label);
		vTaskDelay(pdMS_TO_TICKS(250));
		esp_restart();
		return 1;
	}

	ESP_LOGW(TAG, "No installed app image found for '%s'", app_id);
	return 0;
}

static int reset_reason_returns_to_launcher(esp_reset_reason_t reason)
{
	return reason == ESP_RST_POWERON
		|| reason == ESP_RST_EXT
		|| reason == ESP_RST_USB;
}

static int return_running_app_to_launcher(const char *trigger)
{
	if (gea_embedded_resident_apps_return_to_launcher(trigger)) return 1;

	const esp_partition_t *running = esp_ota_get_running_partition();
	if (!running || partition_version_matches(running, LAUNCHER_APP_ID)) return 0;

	const esp_partition_t *launcher = find_launcher_partition(running);
	if (!launcher) {
		ESP_LOGW(TAG, "%s requested launcher, but no installed launcher image was found", trigger);
		return 0;
	}

	esp_err_t err = esp_ota_set_boot_partition(launcher);
	if (err != ESP_OK) {
		ESP_LOGE(TAG, "Failed to select launcher after %s: %s", trigger, esp_err_to_name(err));
		return 0;
	}

	ESP_LOGI(TAG, "%s in app %s; returning to launcher from %s", trigger, running->label, launcher->label);
	vTaskDelay(pdMS_TO_TICKS(100));
	esp_restart();
	return 1;
}

int gea_embedded_apps_return_to_launcher_on_reset(void)
{
	const esp_partition_t *running = esp_ota_get_running_partition();
	if (!running || partition_version_matches(running, LAUNCHER_APP_ID)) return 0;

	esp_reset_reason_t reason = esp_reset_reason();
	if (!reset_reason_returns_to_launcher(reason)) return 0;

	char trigger[32];
	snprintf(trigger, sizeof(trigger), "Reset reason %d", (int)reason);
	return return_running_app_to_launcher(trigger);
}

static int queue_settings_toggle(void)
{
	if (!gea_embedded_event_queue) return 0;

	gea_embedded_event_t evt = {
		.type = GEA_EMBEDDED_EVT_SETTINGS_TOGGLE,
		.data = 0,
	};
	if (xQueueSend(gea_embedded_event_queue, &evt, 0) != pdPASS) {
		ESP_LOGW(TAG, "BOOT button long press ignored; event queue is full");
		return 0;
	}

	ESP_LOGI(TAG, "BOOT button long press; toggling settings");
	return 1;
}

static void launcher_button_task_main(void *arg)
{
	(void)arg;

	while (1) {
		if (gpio_get_level(LAUNCHER_BUTTON_GPIO) == LAUNCHER_BUTTON_ACTIVE_LEVEL) {
			vTaskDelay(pdMS_TO_TICKS(LAUNCHER_BUTTON_DEBOUNCE_MS));
			if (gpio_get_level(LAUNCHER_BUTTON_GPIO) == LAUNCHER_BUTTON_ACTIVE_LEVEL) {
				TickType_t pressed_at = xTaskGetTickCount();
				int long_press_handled = 0;
				while (gpio_get_level(LAUNCHER_BUTTON_GPIO) == LAUNCHER_BUTTON_ACTIVE_LEVEL) {
					if (!long_press_handled && xTaskGetTickCount() - pressed_at >= pdMS_TO_TICKS(LAUNCHER_BUTTON_LONG_PRESS_MS)) {
						queue_settings_toggle();
						long_press_handled = 1;
					}
					vTaskDelay(pdMS_TO_TICKS(LAUNCHER_BUTTON_POLL_MS));
				}
				if (!long_press_handled) return_running_app_to_launcher("BOOT button press");
			}
		}

		vTaskDelay(pdMS_TO_TICKS(LAUNCHER_BUTTON_POLL_MS));
	}
}

void gea_embedded_apps_start_launcher_button_task(void)
{
	if (launcher_button_task) return;

	const esp_partition_t *running = esp_ota_get_running_partition();
	if (!gea_embedded_resident_apps_is_enabled() && (!running || partition_version_matches(running, LAUNCHER_APP_ID))) return;

	gpio_config_t config = {
		.pin_bit_mask = 1ULL << LAUNCHER_BUTTON_GPIO,
		.mode = GPIO_MODE_INPUT,
		.pull_up_en = GPIO_PULLUP_ENABLE,
		.pull_down_en = GPIO_PULLDOWN_DISABLE,
		.intr_type = GPIO_INTR_DISABLE,
	};
	esp_err_t err = gpio_config(&config);
	if (err != ESP_OK) {
		ESP_LOGE(TAG, "Failed to configure BOOT launcher button on GPIO0: %s", esp_err_to_name(err));
		return;
	}

	BaseType_t ok = xTaskCreate(launcher_button_task_main, "launcher_button", LAUNCHER_BUTTON_TASK_STACK, NULL, tskIDLE_PRIORITY + 1, &launcher_button_task);
	if (ok != pdPASS) {
		launcher_button_task = NULL;
		ESP_LOGE(TAG, "Failed to start BOOT launcher button task");
	}
}

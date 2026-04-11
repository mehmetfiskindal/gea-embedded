#include "ble.h"

#include <string.h>
#include <stdio.h>

#include "esp_bt.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "nvs_flash.h"

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#include "nimble/nimble_port.h"
#include "nimble/nimble_port_freertos.h"
#include "host/ble_hs.h"
#include "host/ble_gap.h"
#include "host/ble_uuid.h"
#include "host/util/util.h"
#include "services/gap/ble_svc_gap.h"
#include "services/gatt/ble_svc_gatt.h"
#include "store/config/ble_store_config.h"

extern void ble_store_config_conf_init(void);

static const char *TAG = "gea_embedded_ble";

/* ------------------------------------------------------------------ */
/*  State                                                              */
/* ------------------------------------------------------------------ */

static const char *s_device_name = "Gea Embedded BLE";
static uint16_t    s_appearance  = 0x03C1;
static const char *s_mac_address = NULL;
static char        s_formatted_mac[18] = "";
static bool        s_host_synced = false;
static bool        s_controller_inited = false;
static bool        s_host_inited = false;
static bool        s_enabled = true;

static uint16_t s_conn_handle      = BLE_HS_CONN_HANDLE_NONE;
static bool     s_connected        = false;
static bool     s_keyboard_notify  = false;
static bool     s_mouse_notify     = false;
static bool     s_battery_notify   = false;

static uint16_t s_keyboard_attr_handle = 0;
static uint16_t s_mouse_attr_handle    = 0;
static uint16_t s_battery_attr_handle  = 0;

void __attribute__((weak)) gea_embedded_app_ble_connected(void) {}
void __attribute__((weak)) gea_embedded_app_ble_disconnected(void) {}
void __attribute__((weak)) gea_embedded_app_ble_bound(void) {}

/* ------------------------------------------------------------------ */
/*  HID report map — keyboard (report ID 1) + mouse (report ID 3)     */
/*  Matches the Moddable hid-clicker report descriptor byte-for-byte. */
/* ------------------------------------------------------------------ */

static const uint8_t s_hid_report_map[] = {
	/* Keyboard */
	0x05, 0x01,        /* Usage Page (Generic Desktop) */
	0x09, 0x06,        /* Usage (Keyboard) */
	0xA1, 0x01,        /* Collection (Application) */
	0x85, 0x01,        /*   Report ID (1) */
	0x05, 0x07,        /*   Usage Page (Key Codes) */
	0x19, 0xE0,        /*   Usage Min (224 - Left Ctrl) */
	0x29, 0xE7,        /*   Usage Max (231 - Right GUI) */
	0x15, 0x00,        /*   Logical Min (0) */
	0x25, 0x01,        /*   Logical Max (1) */
	0x75, 0x01,        /*   Report Size (1) */
	0x95, 0x08,        /*   Report Count (8) */
	0x81, 0x02,        /*   Input (Data, Variable, Absolute) - modifiers */
	0x95, 0x01,        /*   Report Count (1) */
	0x75, 0x08,        /*   Report Size (8) */
	0x81, 0x01,        /*   Input (Constant) - reserved byte */
	0x95, 0x05,        /*   Report Count (5) */
	0x75, 0x01,        /*   Report Size (1) */
	0x05, 0x08,        /*   Usage Page (LEDs) */
	0x19, 0x01,        /*   Usage Min (1 - Num Lock) */
	0x29, 0x05,        /*   Usage Max (5 - Kana) */
	0x91, 0x02,        /*   Output (Data, Variable, Absolute) - LEDs */
	0x95, 0x01,        /*   Report Count (1) */
	0x75, 0x03,        /*   Report Size (3) */
	0x91, 0x01,        /*   Output (Constant) - LED padding */
	0x95, 0x06,        /*   Report Count (6) */
	0x75, 0x08,        /*   Report Size (8) */
	0x15, 0x00,        /*   Logical Min (0) */
	0x25, 0x65,        /*   Logical Max (101) */
	0x05, 0x07,        /*   Usage Page (Key Codes) */
	0x19, 0x00,        /*   Usage Min (0) */
	0x29, 0x65,        /*   Usage Max (101) */
	0x81, 0x00,        /*   Input (Data, Array) - key codes */
	0xC0,              /* End Collection */

	/* Mouse */
	0x05, 0x01,        /* Usage Page (Generic Desktop) */
	0x09, 0x02,        /* Usage (Mouse) */
	0xA1, 0x01,        /* Collection (Application) */
	0x85, 0x03,        /*   Report ID (3) */
	0x09, 0x01,        /*   Usage (Pointer) */
	0xA1, 0x00,        /*   Collection (Physical) */
	0x05, 0x09,        /*     Usage Page (Buttons) */
	0x19, 0x01,        /*     Usage Min (1) */
	0x29, 0x03,        /*     Usage Max (3) */
	0x15, 0x00,        /*     Logical Min (0) */
	0x25, 0x01,        /*     Logical Max (1) */
	0x95, 0x03,        /*     Report Count (3) */
	0x75, 0x01,        /*     Report Size (1) */
	0x81, 0x02,        /*     Input (Data, Variable, Absolute) - buttons */
	0x95, 0x01,        /*     Report Count (1) */
	0x75, 0x05,        /*     Report Size (5) */
	0x81, 0x01,        /*     Input (Constant) - button padding */
	0x05, 0x01,        /*     Usage Page (Generic Desktop) */
	0x09, 0x30,        /*     Usage (X) */
	0x09, 0x31,        /*     Usage (Y) */
	0x09, 0x38,        /*     Usage (Wheel) */
	0x15, 0x81,        /*     Logical Min (-127) */
	0x25, 0x7F,        /*     Logical Max (127) */
	0x75, 0x08,        /*     Report Size (8) */
	0x95, 0x03,        /*     Report Count (3) */
	0x81, 0x06,        /*     Input (Data, Variable, Relative) */
	0xC0,              /*   End Collection (Physical) */
	0xC0,              /* End Collection (Application) */
};

/* HID Information: bcdHID 0x010B, country 0, flags 0x15 (matches Moddable) */
static const uint8_t s_hid_info[] = { 0x0B, 0x01, 0x00, 0x15 };

/* Report buffers */
static uint8_t s_keyboard_report[8];
static uint8_t s_mouse_report[4];

/* Report reference descriptors (report ID, type) */
static const uint8_t s_keyboard_report_ref[] = { 0x01, 0x01 }; /* ID 1, Input */
static const uint8_t s_mouse_report_ref[]    = { 0x03, 0x01 }; /* ID 3, Input */

/* Battery level */
static uint8_t s_battery_level = 100;

/* ------------------------------------------------------------------ */
/*  Forward declarations                                               */
/* ------------------------------------------------------------------ */

static int  ble_gap_event_cb(struct ble_gap_event *event, void *arg);
static int  hid_chr_access(uint16_t conn_handle, uint16_t attr_handle,
                           struct ble_gatt_access_ctxt *ctxt, void *arg);
static int  bat_chr_access(uint16_t conn_handle, uint16_t attr_handle,
                           struct ble_gatt_access_ctxt *ctxt, void *arg);
static void ble_on_sync(void);
static void ble_on_reset(int reason);
static void ble_host_task(void *param);

/* ------------------------------------------------------------------ */
/*  GATT service table                                                 */
/* ------------------------------------------------------------------ */

static const struct ble_gatt_svc_def s_gatt_svcs[] = {
	/* HID Service 0x1812 */
	{
		.type = BLE_GATT_SVC_TYPE_PRIMARY,
		.uuid = BLE_UUID16_DECLARE(0x1812),
		.characteristics = (struct ble_gatt_chr_def[]) {
		/* HID Information */
		{
			.uuid = BLE_UUID16_DECLARE(0x2A4A),
			.access_cb = hid_chr_access,
			.arg = (void *)0,
			.flags = BLE_GATT_CHR_F_READ | BLE_GATT_CHR_F_READ_ENC,
		},
		/* Report Map */
		{
			.uuid = BLE_UUID16_DECLARE(0x2A4B),
			.access_cb = hid_chr_access,
			.arg = (void *)1,
			.flags = BLE_GATT_CHR_F_READ | BLE_GATT_CHR_F_READ_ENC,
		},
		/* HID Control Point */
		{
			.uuid = BLE_UUID16_DECLARE(0x2A4C),
			.access_cb = hid_chr_access,
			.arg = (void *)2,
			.flags = BLE_GATT_CHR_F_WRITE_NO_RSP | BLE_GATT_CHR_F_WRITE_ENC,
		},
		/* Protocol Mode */
		{
			.uuid = BLE_UUID16_DECLARE(0x2A4E),
			.access_cb = hid_chr_access,
			.arg = (void *)3,
			.flags = BLE_GATT_CHR_F_READ | BLE_GATT_CHR_F_READ_ENC
			       | BLE_GATT_CHR_F_WRITE_NO_RSP | BLE_GATT_CHR_F_WRITE_ENC,
		},
		/* Keyboard Input Report */
		{
			.uuid = BLE_UUID16_DECLARE(0x2A4D),
			.access_cb = hid_chr_access,
			.arg = (void *)4,
			.val_handle = &s_keyboard_attr_handle,
			.flags = BLE_GATT_CHR_F_READ | BLE_GATT_CHR_F_NOTIFY,
			.descriptors = (struct ble_gatt_dsc_def[]) {
				{
					.uuid = BLE_UUID16_DECLARE(0x2908),
					.att_flags = BLE_ATT_F_READ,
					.access_cb = hid_chr_access,
					.arg = (void *)10,
				},
				{ 0 },
			},
		},
		/* Mouse Input Report */
		{
			.uuid = BLE_UUID16_DECLARE(0x2A4D),
			.access_cb = hid_chr_access,
			.arg = (void *)5,
			.val_handle = &s_mouse_attr_handle,
			.flags = BLE_GATT_CHR_F_READ | BLE_GATT_CHR_F_NOTIFY,
			.descriptors = (struct ble_gatt_dsc_def[]) {
				{
					.uuid = BLE_UUID16_DECLARE(0x2908),
					.att_flags = BLE_ATT_F_READ,
					.access_cb = hid_chr_access,
					.arg = (void *)11,
				},
				{ 0 },
			},
		},
		{ 0 },
	},
},

/* Battery Service 0x180F */
{
	.type = BLE_GATT_SVC_TYPE_PRIMARY,
	.uuid = BLE_UUID16_DECLARE(0x180F),
	.characteristics = (struct ble_gatt_chr_def[]) {
		{
			.uuid = BLE_UUID16_DECLARE(0x2A19),
			.access_cb = bat_chr_access,
			.val_handle = &s_battery_attr_handle,
			.flags = BLE_GATT_CHR_F_READ | BLE_GATT_CHR_F_READ_ENC
			       | BLE_GATT_CHR_F_NOTIFY,
		},
		{ 0 },
	},
},

	{ 0 },
};

/* ------------------------------------------------------------------ */
/*  GATT access callbacks                                              */
/* ------------------------------------------------------------------ */

static uint8_t s_protocol_mode = 1; /* Report Protocol */

static int hid_chr_access(uint16_t conn_handle, uint16_t attr_handle,
                          struct ble_gatt_access_ctxt *ctxt, void *arg)
{
	int id = (int)(intptr_t)arg;
	int rc;

	switch (id) {
	case 0: /* HID Information */
		rc = os_mbuf_append(ctxt->om, s_hid_info, sizeof(s_hid_info));
		return rc == 0 ? 0 : BLE_ATT_ERR_INSUFFICIENT_RES;

	case 1: /* Report Map */
		rc = os_mbuf_append(ctxt->om, s_hid_report_map, sizeof(s_hid_report_map));
		return rc == 0 ? 0 : BLE_ATT_ERR_INSUFFICIENT_RES;

	case 2: /* Control Point (write) */
		return 0;

	case 3: /* Protocol Mode */
		if (ctxt->op == BLE_GATT_ACCESS_OP_READ_CHR) {
			rc = os_mbuf_append(ctxt->om, &s_protocol_mode, 1);
			return rc == 0 ? 0 : BLE_ATT_ERR_INSUFFICIENT_RES;
		}
		return 0;

	case 4: /* Keyboard report read */
		rc = os_mbuf_append(ctxt->om, s_keyboard_report, sizeof(s_keyboard_report));
		return rc == 0 ? 0 : BLE_ATT_ERR_INSUFFICIENT_RES;

	case 5: /* Mouse report read */
		rc = os_mbuf_append(ctxt->om, s_mouse_report, sizeof(s_mouse_report));
		return rc == 0 ? 0 : BLE_ATT_ERR_INSUFFICIENT_RES;

	case 10: /* Keyboard report reference descriptor */
		rc = os_mbuf_append(ctxt->om, s_keyboard_report_ref, sizeof(s_keyboard_report_ref));
		return rc == 0 ? 0 : BLE_ATT_ERR_INSUFFICIENT_RES;

	case 11: /* Mouse report reference descriptor */
		rc = os_mbuf_append(ctxt->om, s_mouse_report_ref, sizeof(s_mouse_report_ref));
		return rc == 0 ? 0 : BLE_ATT_ERR_INSUFFICIENT_RES;
	}

	return BLE_ATT_ERR_UNLIKELY;
}

static int bat_chr_access(uint16_t conn_handle, uint16_t attr_handle,
                          struct ble_gatt_access_ctxt *ctxt, void *arg)
{
	if (ctxt->op == BLE_GATT_ACCESS_OP_READ_CHR) {
		int rc = os_mbuf_append(ctxt->om, &s_battery_level, 1);
		return rc == 0 ? 0 : BLE_ATT_ERR_INSUFFICIENT_RES;
	}
	return BLE_ATT_ERR_UNLIKELY;
}

/* ------------------------------------------------------------------ */
/*  Notify helpers                                                     */
/* ------------------------------------------------------------------ */

static void notify_keyboard(void)
{
	if (!s_connected || !s_keyboard_notify || s_keyboard_attr_handle == 0) return;

	struct os_mbuf *om = ble_hs_mbuf_from_flat(s_keyboard_report, sizeof(s_keyboard_report));
	if (om) {
		ble_gatts_notify_custom(s_conn_handle, s_keyboard_attr_handle, om);
	}
}

static void notify_mouse(void)
{
	if (!s_connected || !s_mouse_notify || s_mouse_attr_handle == 0) return;

	struct os_mbuf *om = ble_hs_mbuf_from_flat(s_mouse_report, sizeof(s_mouse_report));
	if (om) {
		ble_gatts_notify_custom(s_conn_handle, s_mouse_attr_handle, om);
	}
}

/* ------------------------------------------------------------------ */
/*  GAP event handler                                                  */
/* ------------------------------------------------------------------ */

static int ble_gap_event_cb(struct ble_gap_event *event, void *arg)
{
	int rc;
	switch (event->type) {

	case BLE_GAP_EVENT_CONNECT:
		ESP_LOGI(TAG, "connection %s (handle=%d)",
		         event->connect.status == 0 ? "established" : "failed",
		         event->connect.conn_handle);
		if (event->connect.status == 0) {
			s_conn_handle = event->connect.conn_handle;
			s_connected = true;
			if (!s_enabled) {
				ble_gap_terminate(s_conn_handle, BLE_ERR_REM_USER_CONN_TERM);
				break;
			}

			rc = ble_gap_security_initiate(s_conn_handle);
			ESP_LOGI(TAG, "security_initiate: rc=%d", rc);
			gea_embedded_app_ble_connected();
		} else {
			gea_embedded_ble_start_advertising();
		}
		break;

	case BLE_GAP_EVENT_DISCONNECT:
		ESP_LOGI(TAG, "disconnected (reason=%d)", event->disconnect.reason);
		s_connected = false;
		s_keyboard_notify = false;
		s_mouse_notify = false;
		s_battery_notify = false;
		s_conn_handle = BLE_HS_CONN_HANDLE_NONE;
		memset(s_keyboard_report, 0, sizeof(s_keyboard_report));
		memset(s_mouse_report, 0, sizeof(s_mouse_report));
		gea_embedded_app_ble_disconnected();
		if (s_enabled) gea_embedded_ble_start_advertising();
		break;

	case BLE_GAP_EVENT_SUBSCRIBE:
		ESP_LOGI(TAG, "subscribe: attr_handle=%d, notify=%d",
		         event->subscribe.attr_handle, event->subscribe.cur_notify);
		if (event->subscribe.attr_handle == s_keyboard_attr_handle) {
			s_keyboard_notify = event->subscribe.cur_notify;
		} else if (event->subscribe.attr_handle == s_mouse_attr_handle) {
			s_mouse_notify = event->subscribe.cur_notify;
		} else if (event->subscribe.attr_handle == s_battery_attr_handle) {
			s_battery_notify = event->subscribe.cur_notify;
		}
		if (s_keyboard_notify || s_mouse_notify) {
			gea_embedded_app_ble_bound();
		}
		break;

	case BLE_GAP_EVENT_ENC_CHANGE:
		ESP_LOGI(TAG, "encryption change: status=%d", event->enc_change.status);
		break;

	case BLE_GAP_EVENT_REPEAT_PAIRING: {
		struct ble_gap_conn_desc desc;
		ble_gap_conn_find(event->repeat_pairing.conn_handle, &desc);
		ble_store_util_delete_peer(&desc.peer_id_addr);
		return BLE_GAP_REPEAT_PAIRING_RETRY;
	}

	case BLE_GAP_EVENT_MTU:
		ESP_LOGI(TAG, "MTU update: conn_handle=%d, mtu=%d",
		         event->mtu.conn_handle, event->mtu.value);
		break;
	}

	return 0;
}

/* ------------------------------------------------------------------ */
/*  Advertising                                                        */
/* ------------------------------------------------------------------ */

void gea_embedded_ble_start_advertising(void)
{
	if (!s_enabled) return;
	if (!s_host_synced) {
		ESP_LOGW(TAG, "BLE host not synced; advertising deferred");
		return;
	}

	struct ble_gap_adv_params adv_params = {0};
	struct ble_hs_adv_fields fields = {0};
	int rc;

	fields.flags = BLE_HS_ADV_F_DISC_GEN | BLE_HS_ADV_F_BREDR_UNSUP;
	fields.name = (uint8_t *)s_device_name;
	fields.name_len = strlen(s_device_name);
	fields.name_is_complete = 1;
	fields.appearance = s_appearance;
	fields.appearance_is_present = 1;

	ble_uuid16_t uuids16[] = {
		BLE_UUID16_INIT(0x1812),
		BLE_UUID16_INIT(0x180F),
	};
	fields.uuids16 = uuids16;
	fields.num_uuids16 = 2;
	fields.uuids16_is_complete = 0;

	rc = ble_gap_adv_set_fields(&fields);
	if (rc != 0) {
		ESP_LOGE(TAG, "adv_set_fields failed: %d", rc);
		return;
	}

	adv_params.conn_mode = BLE_GAP_CONN_MODE_UND;
	adv_params.disc_mode = BLE_GAP_DISC_MODE_GEN;

	uint8_t own_addr_type = (s_mac_address && s_mac_address[0])
	                        ? BLE_OWN_ADDR_RANDOM : BLE_OWN_ADDR_PUBLIC;
	rc = ble_gap_adv_start(own_addr_type, NULL, BLE_HS_FOREVER,
	                       &adv_params, ble_gap_event_cb, NULL);
	if (rc != 0) {
		ESP_LOGE(TAG, "adv_start failed: %d", rc);
	} else {
		ESP_LOGI(TAG, "advertising started as \"%s\"", s_device_name);
	}
}

void gea_embedded_ble_stop_advertising(void)
{
	if (!s_host_synced) return;
	ble_gap_adv_stop();
}

/* ------------------------------------------------------------------ */
/*  Sync / reset callbacks                                             */
/* ------------------------------------------------------------------ */

static int parse_mac_le(const char *str, uint8_t out[6])
{
	unsigned int b[6];
	if (sscanf(str, "%x:%x:%x:%x:%x:%x", &b[0],&b[1],&b[2],&b[3],&b[4],&b[5]) != 6)
		return -1;
	/* User writes MSB-first (AA:BB:CC:DD:EE:FF); NimBLE wants LE */
	for (int i = 0; i < 6; i++) out[i] = (uint8_t)b[5 - i];
	return 0;
}

static void ble_on_sync(void)
{
	int rc;

	if (s_mac_address && s_mac_address[0]) {
		uint8_t addr[6];
		if (parse_mac_le(s_mac_address, addr) == 0) {
			addr[5] |= 0xC0; /* BLE random static: top 2 bits of MSB must be 11 */
			rc = ble_hs_id_set_rnd(addr);
			if (rc != 0) {
				ESP_LOGE(TAG, "ble_hs_id_set_rnd failed: %d", rc);
			} else {
				ESP_LOGI(TAG, "using custom MAC: %s", s_mac_address);
			}
		} else {
			ESP_LOGE(TAG, "invalid macAddress format, expected XX:XX:XX:XX:XX:XX");
		}
	}

	rc = ble_hs_util_ensure_addr(0);
	if (rc != 0) {
		ESP_LOGE(TAG, "ble_hs_util_ensure_addr failed: %d", rc);
		return;
	}

	s_host_synced = true;
	if (s_enabled) gea_embedded_ble_start_advertising();
}

static void ble_on_reset(int reason)
{
	s_host_synced = false;
	ESP_LOGE(TAG, "host reset: reason=%d", reason);
}

/* ------------------------------------------------------------------ */
/*  NimBLE host task                                                   */
/* ------------------------------------------------------------------ */

static void ble_host_task(void *param)
{
	ESP_LOGI(TAG, "NimBLE host task started");
	nimble_port_run();
	nimble_port_freertos_deinit();
	vTaskDelete(NULL);
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

void gea_embedded_ble_preinit(void)
{
	if (s_controller_inited) return;

	esp_bt_controller_config_t cfg = BT_CONTROLLER_INIT_CONFIG_DEFAULT();
	esp_err_t err = esp_bt_controller_init(&cfg);
	if (err != ESP_OK) {
		ESP_LOGE(TAG, "esp_bt_controller_init failed: %s", esp_err_to_name(err));
		return;
	}

	err = esp_bt_controller_enable(ESP_BT_MODE_BLE);
	if (err != ESP_OK) {
		ESP_LOGE(TAG, "esp_bt_controller_enable failed: %s", esp_err_to_name(err));
		esp_bt_controller_deinit();
		return;
	}

	s_controller_inited = true;
}

void gea_embedded_ble_init(const char *device_name, uint16_t appearance, const char *mac_address)
{
	s_device_name = device_name;
	s_appearance  = appearance;
	s_mac_address = mac_address;

	if (s_host_inited) {
		ble_svc_gap_device_name_set(s_device_name);
		ble_svc_gap_device_appearance_set(s_appearance);
		return;
	}

	if (!s_controller_inited) {
		gea_embedded_ble_preinit();
		if (!s_controller_inited) return;
	}

	s_host_synced = false;

	esp_err_t err = esp_nimble_init();
	if (err != ESP_OK) {
		ESP_LOGE(TAG, "esp_nimble_init failed: %s", esp_err_to_name(err));
		return;
	}

	ble_hs_cfg.reset_cb = ble_on_reset;
	ble_hs_cfg.sync_cb  = ble_on_sync;
	ble_hs_cfg.sm_io_cap = BLE_HS_IO_NO_INPUT_OUTPUT;
	ble_hs_cfg.sm_bonding = 1;
	ble_hs_cfg.sm_mitm = 0;
	ble_hs_cfg.sm_sc = 1;
	ble_hs_cfg.sm_our_key_dist = BLE_SM_PAIR_KEY_DIST_ENC | BLE_SM_PAIR_KEY_DIST_ID;
	ble_hs_cfg.sm_their_key_dist = BLE_SM_PAIR_KEY_DIST_ENC | BLE_SM_PAIR_KEY_DIST_ID;

	ble_hs_cfg.store_read_cb   = ble_store_config_read;
	ble_hs_cfg.store_write_cb  = ble_store_config_write;
	ble_hs_cfg.store_delete_cb = ble_store_config_delete;
	ble_hs_cfg.store_status_cb = ble_store_util_status_rr;

	ble_store_config_conf_init();

	ble_svc_gap_init();
	ble_svc_gatt_init();

	int rc = ble_gatts_count_cfg(s_gatt_svcs);
	if (rc != 0) {
		ESP_LOGE(TAG, "ble_gatts_count_cfg failed: %d", rc);
		return;
	}
	rc = ble_gatts_add_svcs(s_gatt_svcs);
	if (rc != 0) {
		ESP_LOGE(TAG, "ble_gatts_add_svcs failed: %d", rc);
		return;
	}

	ble_svc_gap_device_name_set(s_device_name);
	ble_svc_gap_device_appearance_set(s_appearance);

	BaseType_t task_ok = xTaskCreatePinnedToCore(
		ble_host_task,
		"nimble_host",
		NIMBLE_HS_STACK_SIZE,
		NULL,
		configMAX_PRIORITIES - 4,
		NULL,
		NIMBLE_CORE
	);
	if (task_ok != pdPASS) {
		ESP_LOGE(TAG, "failed to create NimBLE host task");
		return;
	}

	s_host_inited = true;

	ESP_LOGI(TAG, "BLE initialized: name=\"%s\" appearance=0x%04X", s_device_name, s_appearance);
}

int gea_embedded_ble_is_enabled(void)
{
	return s_enabled ? 1 : 0;
}

void gea_embedded_ble_set_enabled(int enabled)
{
	bool next_enabled = enabled ? true : false;
	if (s_enabled == next_enabled) return;

	s_enabled = next_enabled;
	if (!s_host_inited) return;

	if (!s_enabled) {
		gea_embedded_ble_stop_advertising();
		if (s_connected && s_conn_handle != BLE_HS_CONN_HANDLE_NONE) {
			ble_gap_terminate(s_conn_handle, BLE_ERR_REM_USER_CONN_TERM);
		}
		return;
	}

	gea_embedded_ble_start_advertising();
}

int gea_embedded_ble_is_connected(void)
{
	return s_connected ? 1 : 0;
}

int gea_embedded_ble_is_bound(void)
{
	return (s_keyboard_notify || s_mouse_notify) ? 1 : 0;
}

int gea_embedded_ble_get_battery_level(void)
{
	return (int)s_battery_level;
}

const char *gea_embedded_ble_get_device_name(void)
{
	return s_device_name ? s_device_name : "Gea Embedded BLE";
}

const char *gea_embedded_ble_get_mac(void)
{
	if (s_mac_address && s_mac_address[0]) return s_mac_address;
	if (s_formatted_mac[0]) return s_formatted_mac;

	if (!s_host_synced) {
		uint8_t addr[6] = {0};
		if (esp_read_mac(addr, ESP_MAC_BT) != ESP_OK &&
		    esp_read_mac(addr, ESP_MAC_BASE) != ESP_OK) return "";

		snprintf(s_formatted_mac, sizeof(s_formatted_mac), "%02X:%02X:%02X:%02X:%02X:%02X",
		         addr[0], addr[1], addr[2], addr[3], addr[4], addr[5]);
		return s_formatted_mac;
	}

	uint8_t own_addr_type = 0;
	uint8_t addr[6] = {0};
	int is_nrpa = 0;
	int rc = ble_hs_id_infer_auto(0, &own_addr_type);
	if (rc != 0) return "";

	rc = ble_hs_id_copy_addr(own_addr_type, addr, &is_nrpa);
	if (rc != 0) return "";

	snprintf(s_formatted_mac, sizeof(s_formatted_mac), "%02X:%02X:%02X:%02X:%02X:%02X",
	         addr[5], addr[4], addr[3], addr[2], addr[1], addr[0]);
	return s_formatted_mac;
}

void gea_embedded_ble_key_tap(int hid_code)
{
	memset(s_keyboard_report, 0, sizeof(s_keyboard_report));
	s_keyboard_report[2] = (uint8_t)hid_code;
	notify_keyboard();

	s_keyboard_report[2] = 0;
	notify_keyboard();
}

void gea_embedded_ble_key_down(int modifier, int hid_code)
{
	s_keyboard_report[0] = (uint8_t)modifier;
	s_keyboard_report[2] = (uint8_t)hid_code;
	notify_keyboard();
}

void gea_embedded_ble_key_up(void)
{
	memset(s_keyboard_report, 0, sizeof(s_keyboard_report));
	notify_keyboard();
}

void gea_embedded_ble_mouse_move(int dx, int dy, int buttons, int wheel)
{
	int8_t cdx = (int8_t)(dx < -127 ? -127 : (dx > 127 ? 127 : dx));
	int8_t cdy = (int8_t)(dy < -127 ? -127 : (dy > 127 ? 127 : dy));
	int8_t cwh = (int8_t)(wheel < -127 ? -127 : (wheel > 127 ? 127 : wheel));

	s_mouse_report[0] = (uint8_t)(buttons & 0x07);
	s_mouse_report[1] = (uint8_t)cdx;
	s_mouse_report[2] = (uint8_t)cdy;
	s_mouse_report[3] = (uint8_t)cwh;
	notify_mouse();
}

void gea_embedded_ble_mouse_click(int button)
{
	gea_embedded_ble_mouse_move(0, 0, button, 0);
	gea_embedded_ble_mouse_move(0, 0, 0, 0);
}

void gea_embedded_ble_set_battery_level(uint8_t level)
{
	if (level > 100) level = 100;
	if (level == s_battery_level) return;

	s_battery_level = level;
	ESP_LOGI(TAG, "battery level: %d%%", level);

	if (!s_connected || !s_battery_notify || s_battery_attr_handle == 0) return;

	struct os_mbuf *om = ble_hs_mbuf_from_flat(&s_battery_level, 1);
	if (om) {
		ble_gatts_notify_custom(s_conn_handle, s_battery_attr_handle, om);
	}
}

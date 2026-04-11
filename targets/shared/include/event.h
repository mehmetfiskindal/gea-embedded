#pragma once

#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"

typedef enum
{
	GEA_EMBEDDED_EVT_TOUCH,
	GEA_EMBEDDED_EVT_FRAME,
	GEA_EMBEDDED_EVT_TIMEOUT,
	GEA_EMBEDDED_EVT_APP_LAUNCH,
	GEA_EMBEDDED_EVT_SETTINGS_TOGGLE
} gea_embedded_event_type_t;

typedef enum
{
	GEA_EMBEDDED_TOUCH_DOWN = 1,
	GEA_EMBEDDED_TOUCH_MOVE = 2,
	GEA_EMBEDDED_TOUCH_UP = 3
} gea_embedded_touch_phase_t;

typedef struct
{
	gea_embedded_event_type_t type;
	int data;
	int touching;
	int x;
	int y;
} gea_embedded_event_t;

extern QueueHandle_t gea_embedded_event_queue;

#ifndef __XSHOST__
#define __XSHOST__

#include <stdint.h>

#define ICACHE_XS6RO_ATTR
#define ICACHE_XS6RO2_ATTR
#define ICACHE_RODATA_ATTR

#define modLog(msg)

uint32_t modMilliseconds(void);

#define modDelayMilliseconds(ms) vTaskDelay(pdMS_TO_TICKS(ms))
#define modDelayMicroseconds(us) vTaskDelay(pdMS_TO_TICKS(((us) + 500) / 1000))

#endif

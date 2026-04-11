#ifndef __XSPLATFORM__
#define __XSPLATFORM__

#include <ctype.h>
#include <float.h>
#include <math.h>
#include <setjmp.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <errno.h>
#include <sys/time.h>
#include <limits.h>
#include <sys/stat.h>

#include <arpa/inet.h>

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_random.h"

#include "xsHost.h"

#define mxExport extern
#define mxImport extern

#define mxBigEndian 0
#define mxLittleEndian 1

#define mxiOS 0
#define mxLinux 0
#define mxMacOSX 0
#define mxWasm 0
#define mxWindows 0

#define XS_FUNCTION_NORETURN __attribute__((noreturn))
#define XS_FUNCTION_ANALYZER_NORETURN

#define mxUseGCCAtomics 1
#define mxUnalignedAccess 1

typedef int8_t txS1;
typedef uint8_t txU1;
typedef int16_t txS2;
typedef uint16_t txU2;
typedef int32_t txS4;
typedef uint32_t txU4;
typedef int64_t txS8;
typedef uint64_t txU8;

typedef jmp_buf c_jmp_buf;
#define c_longjmp longjmp
#define c_setjmp setjmp

typedef va_list c_va_list;
#define c_va_arg va_arg
#define c_va_end va_end
#define c_va_start va_start

#define c_calloc calloc
#define c_exit(n)                           \
	do                                        \
	{                                         \
		printf("XS exit(%d) — halting\n", (n)); \
		while (1)                               \
			vTaskDelay(pdMS_TO_TICKS(1000));      \
	} while (0)
#define c_free free
#define c_malloc malloc
#define c_free_uint32 free
#define c_malloc_uint32 malloc
#define c_qsort qsort
#define c_bsearch bsearch
#define c_realloc realloc
#define c_abort abort
#define c_strtod strtod
#define c_strtol strtol
#define c_strtoul strtoul

#define C_EOF EOF
#define C_NULL NULL
#define c_vprintf vprintf
#define c_printf printf
#define c_vsnprintf vsnprintf
#define c_snprintf snprintf
#define c_vfprintf vfprintf
#define c_fprintf fprintf

#define c_time_t time_t
#define c_tm struct tm
typedef struct timeval c_timeval;
#define c_timezone timezone
#define c_gettimeofday gettimeofday
#define c_localtime localtime
#define c_mktime mktime

/* math */
#define C_DBL_MAX DBL_MAX
#define C_DBL_MIN ((double)5e-324)
#define C_EPSILON ((double)2.2204460492503130808472633361816e-16)
#define C_FP_INFINITE FP_INFINITE
#define C_FP_NAN FP_NAN
#define C_FP_NORMAL FP_NORMAL
#define C_FP_SUBNORMAL FP_SUBNORMAL
#define C_FP_ZERO FP_ZERO
#define C_INFINITY ((double)INFINITY)
#define C_M_E M_E
#define C_M_LN10 M_LN10
#define C_M_LN2 M_LN2
#define C_M_LOG10E M_LOG10E
#define C_M_LOG2E M_LOG2E
#define C_M_PI M_PI
#define C_M_SQRT1_2 M_SQRT1_2
#define C_M_SQRT2 M_SQRT2
#define C_MAX_SAFE_INTEGER ((double)9007199254740991)
#define C_MIN_SAFE_INTEGER ((double)-9007199254740991)
#define C_NAN NAN
#define C_RAND_MAX INT32_MAX
#define C_FP_ILOGB0 FP_ILOGB0
#define C_FP_ILOGBNAN FP_ILOGBNAN
#define C_INT_MAX INT_MAX

#define c_acos acos
#define c_acosh acosh
#define c_asin asin
#define c_asinh asinh
#define c_atan atan
#define c_atanh atanh
#define c_atan2 atan2
#define c_cbrt cbrt
#define c_ceil ceil
#define c_clz __builtin_clz
#define c_cos cos
#define c_cosh cosh
#define c_exp exp
#define c_expm1 expm1
#define c_fabs fabs
#define c_floor floor
#define c_fmod fmod
#define c_fpclassify fpclassify
#define c_hypot hypot
#define c_ilogb ilogb
#define c_isfinite isfinite
#define c_isnormal isnormal
#define c_isnan isnan
#define c_llround llround
#define c_log log
#define c_log1p log1p
#define c_log10 log10
#define c_log2 log2
#define c_nearbyint nearbyint
#define c_pow pow
#define c_rand() ((int)(0x7fffffff & esp_random()))
#define c_round round
#define c_signbit signbit
#define c_sin sin
#define c_sinh sinh
#define c_sqrt sqrt
#define c_srand srand
#define c_tan tan
#define c_tanh tanh
#define c_trunc trunc

/* string / memory */
#define c_memcpy memcpy
#define c_memmove memmove
#define c_memset memset
#define c_memcmp memcmp
#define c_strcat strcat
#define c_strchr strchr
#define c_strcmp strcmp
#define c_strcpy strcpy
#define c_strlen strlen
#define c_strncat strncat
#define c_strncmp strncmp
#define c_strncpy strncpy
#define c_strstr strstr
#define c_strrchr strrchr
#define c_strcspn strcspn
#define c_strspn strspn

/* read memory (ESP32-S3 Xtensa supports unaligned access) */
#define c_read8(POINTER) (*((txU1 *)(POINTER)))
#define c_read16(POINTER) (*((txU2 *)(POINTER)))
#define c_read32(POINTER) (*((txU4 *)(POINTER)))
#define c_read16be(POINTER) ((((txU2)((txU1 *)(POINTER))[0]) << 8) | ((txU2)((txU1 *)(POINTER))[1]))
#define c_read32be(POINTER) ((((txU4)((txU1 *)(POINTER))[0]) << 24) | (((txU4)((txU1 *)(POINTER))[1]) << 16) | (((txU4)((txU1 *)(POINTER))[2]) << 8) | ((txU4)((txU1 *)(POINTER))[3]))

#define c_isEmpty(s) (!c_read8(s))

#define C_ENOMEM ENOMEM
#define C_EINVAL EINVAL

#define C_PATH_MAX PATH_MAX

#define mxSeparator '/'

#define c_realpath realpath
#define mxParserThrowElse(_ASSERTION)           \
	{                                             \
		if (!(_ASSERTION))                          \
		{                                           \
			parser->error = errno;                    \
			c_longjmp(parser->firstJump->jmp_buf, 1); \
		}                                           \
	}

#define mxMachinePlatform \
	void *host;

#define mxUseDefaultMachinePlatform 1
#define mxUseDefaultBuildKeys 1
#define mxUseDefaultChunkAllocation 1
#define mxUseDefaultSlotAllocation 1
#define mxUseDefaultFindModule 1
#define mxUseDefaultLoadModule 1
#define mxUseDefaultParseScript 1
#define mxUseDefaultQueuePromiseJobs 0
#define mxUseDefaultSharedChunks 1
#define mxUseDefaultAbort 1
#define mxUseDefaultDebug 1

#ifndef ICACHE_FLASH_ATTR
#define ICACHE_FLASH_ATTR
#endif
#ifndef ICACHE_RAM_ATTR
#define ICACHE_RAM_ATTR
#endif
#ifndef ICACHE_XS6STRING_ATTR
#define ICACHE_XS6STRING_ATTR
#endif

#ifndef mxGetKeySlotID
#define mxGetKeySlotID(SLOT) (SLOT)->ID
#endif
#ifndef mxGetKeySlotKind
#define mxGetKeySlotKind(SLOT) (SLOT)->kind
#endif

#ifndef mxFallThrough
#define mxFallThrough __attribute__((fallthrough))
#endif

#ifndef mxTableMinLength
#define mxTableMinLength (1)
#endif

#endif /* __XSPLATFORM__ */

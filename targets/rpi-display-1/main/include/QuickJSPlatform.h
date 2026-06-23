#pragma once

/*
 * QuickJSPlatform.h — minimal POSIX platform layer for QuickJS on Linux/Pi.
 *
 * This replaces xsPlatform.h for the Pi target; it provides the same
 * memory model (Linux, little-endian, POSIX timers, realpath) but uses
 * standard glibc/musl functions and adds no FreeRTOS dependencies.
 */

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

#define mxBigEndian 0
#define mxLittleEndian 1

#define mxiOS 0
#define mxLinux 1
#define mxMacOSX 0
#define mxWasm 0
#define mxWindows 0

#define XS_FUNCTION_NORETURN __attribute__((noreturn))
#define XS_FUNCTION_ANALYZER_NORETURN

#define mxUseGCCAtomics 1
#define mxUnalignedAccess 1

typedef int8_t  txS1;
typedef uint8_t  txU1;
typedef int16_t txS2;
typedef uint16_t txU2;
typedef int32_t txS4;
typedef uint32_t txU4;
typedef int64_t txS8;
typedef uint64_t txU8;

typedef jmp_buf c_jmp_buf;
#define c_longjmp longjmp
#define c_setjmp  setjmp

typedef va_list c_va_list;
#define c_va_arg   va_arg
#define c_va_end   va_end
#define c_va_start va_start

#define c_calloc  calloc
#define c_exit(n) do { fprintf(stderr, "exit(%d)\n", (int)(n)); _exit((int)(n)); } while (0)
#define c_free    free
#define c_malloc  malloc
#define c_realloc realloc
#define c_abort   abort
#define c_strtod  strtod
#define c_strtol  strtol
#define c_strtoul strtoul
#define c_qsort   qsort
#define c_bsearch bsearch

#define C_EOF  EOF
#define C_NULL NULL
#define c_vprintf  vprintf
#define c_printf   printf
#define c_vsnprintf vsnprintf
#define c_snprintf  snprintf
#define c_vfprintf  vfprintf
#define c_fprintf   fprintf

#define c_time_t time_t
#define c_tm     struct tm
typedef struct timeval c_timeval;
#define c_timezone     timezone
#define c_gettimeofday gettimeofday
#define c_localtime    localtime
#define c_mktime       mktime

#include <unistd.h>
#include <sys/types.h>
#define c_srandom srand
#define c_random  rand

#define mxSeparator '/'
#define c_realpath realpath
#define C_PATH_MAX PATH_MAX
#define C_ENOMEM   ENOMEM
#define C_EINVAL   EINVAL

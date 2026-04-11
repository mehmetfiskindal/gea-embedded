#include "xsAll.h"
#include "xsScript.h"
#include "xs.h"

#include <sys/time.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_system.h"

void __attribute__((weak)) fxVReport(void* console, txString theFormat, c_va_list theArguments)
{
	vprintf(theFormat, theArguments);
}

void __attribute__((weak)) fxVReportError(void* console, txString thePath, txInteger theLine, txString theFormat, c_va_list theArguments)
{
	if (thePath)
		fprintf(stderr, "%s:%d: error: ", thePath, (int)theLine);
	else
		fprintf(stderr, "# error: ");
	vfprintf(stderr, theFormat, theArguments);
	fprintf(stderr, "!\n");
}

void __attribute__((weak)) fxVReportWarning(void* console, txString thePath, txInteger theLine, txString theFormat, c_va_list theArguments)
{
	if (thePath)
		fprintf(stderr, "%s:%d: warning: ", thePath, (int)theLine);
	else
		fprintf(stderr, "# warning: ");
	vfprintf(stderr, theFormat, theArguments);
	fprintf(stderr, "!\n");
}

txID __attribute__((weak)) fxGenerateProfileID(void* console)
{
	return XS_NO_ID;
}

void __attribute__((weak)) fxGenerateTag(void* console, txString buffer, txInteger bufferSize, txString path)
{
	static txInteger gTag = 0;
	txMachine* the = console;
	if (path)
		c_snprintf(buffer, bufferSize, "#%d@%s", (int)the->tag, path);
	else
		c_snprintf(buffer, bufferSize, "#%d", (int)the->tag);
	the->tag++;
	(void)gTag;
}

uint32_t modMilliseconds(void)
{
	struct timeval tv;
	gettimeofday(&tv, NULL);
	return (uint32_t)(((uint64_t)tv.tv_sec * 1000) + (tv.tv_usec / 1000));
}

static volatile int promise_jobs_pending = 0;

void fxQueuePromiseJobs(txMachine* the)
{
	promise_jobs_pending = 1;
}

int gea_embedded_promise_jobs_pending(void)
{
	return promise_jobs_pending;
}

void gea_embedded_drain_promise_jobs(txMachine* the)
{
	while (promise_jobs_pending) {
		promise_jobs_pending = 0;
		fxRunPromiseJobs(the);
	}
}

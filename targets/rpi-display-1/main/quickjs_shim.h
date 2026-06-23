/*
 * quickjs_shim.h — host-function bindings for QuickJS.
 */

#ifndef GEA_RPI_QUICKJS_SHIM_H
#define GEA_RPI_QUICKJS_SHIM_H

#include <stddef.h>

int  gea_embedded_qjs_init(int viewport_w, int viewport_h);
int  gea_embedded_qjs_load_bytecode(const unsigned char *data, size_t size);
void gea_embedded_qjs_tick(void);
void gea_embedded_qjs_shutdown(void);

#endif

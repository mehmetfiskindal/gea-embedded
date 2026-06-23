#pragma once

#include <stdbool.h>
#include <stdint.h>

int  gea_embedded_ota_init(void);
void gea_embedded_ota_shutdown(void);
int  gea_embedded_ota_check_and_apply(const char *url, const char *ed25519_pubkey_b64);

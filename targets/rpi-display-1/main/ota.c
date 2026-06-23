/*
 * ota.c — network update stub.
 *
 * Phase 5 deliverable: download a tarball over HTTP(S), verify an
 * Ed25519 signature, atomic-rename into /opt/gea-embedded/apps/<id>/.
 * v1 ships a no-op that logs a placeholder.
 */

#include "ota.h"
#include "log.h"

int gea_embedded_ota_init(void) {
    gea_logw("ota: stub; install via 'geat-rpi.sh install' or scp");
    return 0;
}

void gea_embedded_ota_shutdown(void) { }

int gea_embedded_ota_check_and_apply(const char *url, const char *ed25519_pubkey_b64) {
    (void)url; (void)ed25519_pubkey_b64;
    gea_logw("ota: not implemented in v1; use 'geat-rpi.sh install' instead");
    return -1;
}

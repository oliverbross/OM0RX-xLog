#ifndef XLOG_PLATFORM_VAULT_H
#define XLOG_PLATFORM_VAULT_H
#include <stddef.h>
#include <stdint.h>

#define XLOG_VAULT_OK 0
#define XLOG_VAULT_NOT_FOUND 1
#define XLOG_VAULT_UNAVAILABLE 2
#define XLOG_VAULT_INVALID 3
#define XLOG_VAULT_FAILED 4

/* Capability, not a claim that this user's vault is unlocked/available. */
int xlog_vault_supported(void);
size_t xlog_vault_max_secret_bytes(void);
/* Identities are UTF-8, 1...128 bytes each. Values are application-defined UTF-8
 * blobs, not domain passwords. No enumeration, file fallback or remote access. */
int xlog_vault_load(const char *service, const char *account,
                    uint8_t **bytes, size_t *count, uint32_t *native_code);
int xlog_vault_save(const char *service, const char *account,
                    const uint8_t *bytes, size_t count, uint32_t *native_code);
int xlog_vault_remove(const char *service, const char *account, uint32_t *native_code);
/* Wipes and frees only the allocation returned by load. */
void xlog_vault_value_destroy(uint8_t *bytes, size_t count);
#endif

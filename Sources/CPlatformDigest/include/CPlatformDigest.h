#ifndef XLOG_PLATFORM_DIGEST_H
#define XLOG_PLATFORM_DIGEST_H
#include <stddef.h>
#include <stdint.h>
/* Returns 1 only for a complete 32-byte SHA-256 result; otherwise use the
 * caller's existing implementation. No keys, credentials or persistent state. */
int xlog_platform_sha256(const void *bytes, size_t count, uint8_t *digest, size_t digest_count);
#endif

#include "CPlatformDigest.h"
#if defined(_WIN32)
#include <windows.h>
#include <bcrypt.h>
#include <limits.h>
#include <stdlib.h>

static int xlog_digest_success(NTSTATUS status) { return status >= 0; }

int xlog_platform_sha256(const void *bytes, size_t count, uint8_t *digest, size_t digest_count) {
    BCRYPT_ALG_HANDLE algorithm = NULL;
    BCRYPT_HASH_HANDLE hash = NULL;
    ULONG object_count = 0, received = 0;
    PUCHAR object = NULL;
    const uint8_t *cursor = (const uint8_t *)bytes;
    int complete = 0;
    if ((!bytes && count) || !digest || digest_count != 32) return 0;
    if (!xlog_digest_success(BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, NULL, 0))) goto done;
    if (!xlog_digest_success(BCryptGetProperty(algorithm, BCRYPT_OBJECT_LENGTH, (PUCHAR)&object_count,
        sizeof(object_count), &received, 0)) || received != sizeof(object_count) || !object_count) goto done;
    object = (PUCHAR)malloc(object_count);
    if (!object) goto done;
    if (!xlog_digest_success(BCryptCreateHash(algorithm, &hash, object, object_count, NULL, 0, 0))) goto done;
    while (count) {
        ULONG part = count > ULONG_MAX ? ULONG_MAX : (ULONG)count;
        if (!xlog_digest_success(BCryptHashData(hash, (PUCHAR)cursor, part, 0))) goto done;
        cursor += part;
        count -= part;
    }
    complete = xlog_digest_success(BCryptFinishHash(hash, digest, 32, 0));
done:
    if (hash) BCryptDestroyHash(hash);
    if (object) { SecureZeroMemory(object, object_count); free(object); }
    if (algorithm) BCryptCloseAlgorithmProvider(algorithm, 0);
    return complete;
}
#else
int xlog_platform_sha256(const void *bytes, size_t count, uint8_t *digest, size_t digest_count) {
    (void)bytes; (void)count; (void)digest; (void)digest_count;
    return 0;
}
#endif

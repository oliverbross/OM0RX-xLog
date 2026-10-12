#include "CPlatformVault.h"
#include <stdlib.h>
#include <string.h>
#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <wincred.h>
#endif

static int valid_identity(const char *value) {
    if (!value || !value[0]) return 0;
    for (size_t i = 0; i <= 128; i++) {
        if (!value[i]) return 1;
        if ((unsigned char)value[i] < 32 || (unsigned char)value[i] == 127) return 0;
    }
    return 0;
}

int xlog_vault_supported(void) {
#ifdef _WIN32
    return 1;
#else
    return 0;
#endif
}

size_t xlog_vault_max_secret_bytes(void) {
#ifdef _WIN32
    return CRED_MAX_CREDENTIAL_BLOB_SIZE;
#else
    return 2560;
#endif
}

void xlog_vault_value_destroy(uint8_t *bytes, size_t count) {
    if (!bytes) return;
    volatile uint8_t *cursor = bytes;
    while (count--) *cursor++ = 0;
    free(bytes);
}

#ifdef _WIN32
/* Target names are case-insensitive on Windows. Encoding each UTF-8 byte as
 * hexadecimal preserves exact account case and separator/Unicode boundaries. */
static wchar_t *target_name(const char *service, const char *account) {
    static const wchar_t prefix[] = L"OliverBross.xLog.v1/";
    static const wchar_t hex[] = L"0123456789abcdef";
    size_t prefix_count = sizeof(prefix) / sizeof(prefix[0]) - 1;
    size_t length = prefix_count + 2 * strlen(service) + 1 + 2 * strlen(account);
    wchar_t *target = calloc(length + 1, sizeof(wchar_t));
    if (!target) return NULL;
    memcpy(target, prefix, prefix_count * sizeof(wchar_t));
    size_t offset = prefix_count;
    const char *parts[2] = {service, account};
    for (int part = 0; part < 2; part++) {
        if (part) target[offset++] = L'/';
        for (const unsigned char *p = (const unsigned char *)parts[part]; *p; p++) {
            target[offset++] = hex[*p >> 4];
            target[offset++] = hex[*p & 15];
        }
    }
    return target;
}

static int failure(DWORD code, uint32_t *native_code) {
    if (native_code) *native_code = (uint32_t)code;
    if (code == ERROR_NOT_FOUND) return XLOG_VAULT_NOT_FOUND;
    if (code == ERROR_NO_SUCH_LOGON_SESSION || code == ERROR_NOT_SUPPORTED) return XLOG_VAULT_UNAVAILABLE;
    return XLOG_VAULT_FAILED;
}
#endif

int xlog_vault_load(const char *service, const char *account,
                    uint8_t **bytes, size_t *count, uint32_t *native_code) {
    if (bytes) *bytes = NULL;
    if (count) *count = 0;
    if (native_code) *native_code = 0;
    if (!bytes || !count || !valid_identity(service) || !valid_identity(account)) return XLOG_VAULT_INVALID;
#ifdef _WIN32
    wchar_t *target = target_name(service, account);
    if (!target) return failure(ERROR_NOT_ENOUGH_MEMORY, native_code);
    PCREDENTIALW item = NULL;
    BOOL found = CredReadW(target, CRED_TYPE_GENERIC, 0, &item);
    DWORD code = found ? ERROR_SUCCESS : GetLastError();
    free(target);
    if (!found) return failure(code, native_code);
    if (item->CredentialBlobSize > xlog_vault_max_secret_bytes() ||
        (item->CredentialBlobSize && !item->CredentialBlob)) {
        CredFree(item);
        return XLOG_VAULT_INVALID;
    }
    uint8_t *copy = malloc(item->CredentialBlobSize ? item->CredentialBlobSize : 1);
    if (!copy) {
        if (item->CredentialBlob) SecureZeroMemory(item->CredentialBlob, item->CredentialBlobSize);
        CredFree(item);
        return failure(ERROR_NOT_ENOUGH_MEMORY, native_code);
    }
    *count = item->CredentialBlobSize;
    if (*count) memcpy(copy, item->CredentialBlob, *count);
    if (item->CredentialBlob) SecureZeroMemory(item->CredentialBlob, item->CredentialBlobSize);
    CredFree(item);
    *bytes = copy;
    return XLOG_VAULT_OK;
#else
    return XLOG_VAULT_UNAVAILABLE;
#endif
}

int xlog_vault_save(const char *service, const char *account,
                    const uint8_t *bytes, size_t count, uint32_t *native_code) {
    if (native_code) *native_code = 0;
    if (!valid_identity(service) || !valid_identity(account) || !bytes ||
        !count || count > xlog_vault_max_secret_bytes()) return XLOG_VAULT_INVALID;
#ifdef _WIN32
    wchar_t *target = target_name(service, account);
    if (!target) return failure(ERROR_NOT_ENOUGH_MEMORY, native_code);
    CREDENTIALW item;
    memset(&item, 0, sizeof(item));
    item.Type = CRED_TYPE_GENERIC;
    item.TargetName = target;
    item.CredentialBlobSize = (DWORD)count;
    item.CredentialBlob = (LPBYTE)bytes;
    item.Persist = CRED_PERSIST_LOCAL_MACHINE;
    item.UserName = L"xLog";
    BOOL saved = CredWriteW(&item, 0);
    DWORD code = saved ? ERROR_SUCCESS : GetLastError();
    free(target);
    return saved ? XLOG_VAULT_OK : failure(code, native_code);
#else
    return XLOG_VAULT_UNAVAILABLE;
#endif
}

int xlog_vault_remove(const char *service, const char *account, uint32_t *native_code) {
    if (native_code) *native_code = 0;
    if (!valid_identity(service) || !valid_identity(account)) return XLOG_VAULT_INVALID;
#ifdef _WIN32
    wchar_t *target = target_name(service, account);
    if (!target) return failure(ERROR_NOT_ENOUGH_MEMORY, native_code);
    BOOL removed = CredDeleteW(target, CRED_TYPE_GENERIC, 0);
    DWORD code = removed ? ERROR_SUCCESS : GetLastError();
    free(target);
    return removed || code == ERROR_NOT_FOUND ? XLOG_VAULT_OK : failure(code, native_code);
#else
    return XLOG_VAULT_UNAVAILABLE;
#endif
}

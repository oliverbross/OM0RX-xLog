#include "CPlatformVault.h"
#include <stdlib.h>
#include <string.h>
#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <wincred.h>
#elif defined(__linux__)
#include <libsecret/secret.h>
#endif

static int valid_identity(const char *value) {
    if (!value || !value[0]) return 0;
    for (size_t i = 0; i <= 128; i++) {
        if (!value[i]) {
#ifdef __linux__
            return g_utf8_validate(value, (gssize)i, NULL);
#else
            return 1;
#endif
        }
        if ((unsigned char)value[i] < 32 || (unsigned char)value[i] == 127) return 0;
    }
    return 0;
}

int xlog_vault_supported(void) {
#if defined(_WIN32) || defined(__linux__)
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

#ifdef __linux__
/* Schema plus exact UTF-8 attributes scope every lookup/deletion to this one
 * application identity. No other accounts or collection contents are listed. */
static const SecretSchema credential_schema = {
    .name = "com.oliverbross.xlog.Credential.v1",
    .flags = SECRET_SCHEMA_NONE,
    .attributes = {
        {"service", SECRET_SCHEMA_ATTRIBUTE_STRING},
        {"account", SECRET_SCHEMA_ATTRIBUTE_STRING},
        {NULL, 0}
    }
};

static GHashTable *credential_attributes(const char *service, const char *account) {
    GHashTable *attributes = g_hash_table_new(g_str_hash, g_str_equal);
    g_hash_table_insert(attributes, "service", (gpointer)service);
    g_hash_table_insert(attributes, "account", (gpointer)account);
    return attributes;
}

static int secret_failure(GError *error, uint32_t *native_code) {
    int result = XLOG_VAULT_FAILED;
    if (error) {
        if (native_code) *native_code = (uint32_t)error->code;
        if (error->domain == G_IO_ERROR || error->domain == G_DBUS_ERROR ||
            g_error_matches(error, SECRET_ERROR, SECRET_ERROR_IS_LOCKED) ||
            g_error_matches(error, SECRET_ERROR, SECRET_ERROR_NO_SUCH_OBJECT)) {
            result = XLOG_VAULT_UNAVAILABLE;
        }
        g_error_free(error);
    }
    return result;
}

static GList *credential_items(const char *service, const char *account,
                              SecretSearchFlags flags, GError **error) {
    GHashTable *attributes = credential_attributes(service, account);
    GList *items = secret_service_search_sync(NULL, &credential_schema, attributes,
                                             flags, NULL, error);
    g_hash_table_unref(attributes);
    return items;
}
#endif

int xlog_vault_load(const char *service, const char *account,
                    uint8_t **bytes, size_t *count, uint32_t *native_code) {
    return xlog_vault_load_with_interaction(service, account, 0, bytes, count, native_code);
}

int xlog_vault_load_with_interaction(const char *service, const char *account,
                    int allow_interaction, uint8_t **bytes, size_t *count, uint32_t *native_code) {
    (void)allow_interaction;
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
#elif defined(__linux__)
    GError *error = NULL;
    /* LOAD_SECRETS loads unlocked matches only. Never add UNLOCK for background
     * reads: locked credentials must be unavailable, not missing or prompting. */
    SecretSearchFlags flags = SECRET_SEARCH_ALL | SECRET_SEARCH_LOAD_SECRETS;
    if (allow_interaction) flags |= SECRET_SEARCH_UNLOCK;
    GList *items = credential_items(service, account, flags, &error);
    if (error) {
        g_list_free_full(items, g_object_unref);
        return secret_failure(error, native_code);
    }
    if (!items) return XLOG_VAULT_NOT_FOUND;
    /* Duplicate exact identities across collections are ambiguous. Do not
     * silently select a possibly stale credential from a different collection. */
    int result = XLOG_VAULT_FAILED;
    SecretValue *value = NULL;
    if (!items->next) {
        SecretItem *item = SECRET_ITEM(items->data);
        value = secret_item_get_secret(item);
        if (secret_item_get_locked(item) || !value) {
            result = XLOG_VAULT_UNAVAILABLE;
        } else {
            gsize length = 0;
            const gchar *data = secret_value_get(value, &length);
            if (length > xlog_vault_max_secret_bytes() || (length && !data)) {
                result = XLOG_VAULT_INVALID;
            } else {
                uint8_t *copy = malloc(length ? length : 1);
                if (copy) {
                    if (length) memcpy(copy, data, length);
                    *bytes = copy;
                    *count = length;
                    result = XLOG_VAULT_OK;
                }
            }
        }
    }
    /* SecretValue owns a secure allocation; unref clears/frees it. Our returned
     * copy is wiped by xlog_vault_value_destroy after the Swift conversion. */
    if (value) secret_value_unref(value);
    g_list_free_full(items, g_object_unref);
    return result;
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
#elif defined(__linux__)
    GHashTable *attributes = credential_attributes(service, account);
    /* Explicit byte length preserves embedded NULs and the 2560-byte boundary. */
    SecretValue *value = secret_value_new((const gchar *)bytes, (gssize)count,
                                         "application/octet-stream");
    GError *error = NULL;
    gboolean saved = secret_service_store_sync(NULL, &credential_schema, attributes,
        SECRET_COLLECTION_DEFAULT, "OM0RX-xLog credential", value, NULL, &error);
    secret_value_unref(value);
    g_hash_table_unref(attributes);
    return saved ? XLOG_VAULT_OK : secret_failure(error, native_code);
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
#elif defined(__linux__)
    GError *error = NULL;
    GList *items = credential_items(service, account, SECRET_SEARCH_ALL | SECRET_SEARCH_UNLOCK, &error);
    if (error) {
        g_list_free_full(items, g_object_unref);
        return secret_failure(error, native_code);
    }
    int result = XLOG_VAULT_OK;
    for (GList *cursor = items; cursor; cursor = cursor->next) {
        SecretItem *item = SECRET_ITEM(cursor->data);
        if (secret_item_get_locked(item)) {
            result = XLOG_VAULT_UNAVAILABLE;
            break;
        }
        if (!secret_item_delete_sync(item, NULL, &error)) {
            result = secret_failure(error, native_code);
            break;
        }
    }
    g_list_free_full(items, g_object_unref);
    return result;
#else
    return XLOG_VAULT_UNAVAILABLE;
#endif
}

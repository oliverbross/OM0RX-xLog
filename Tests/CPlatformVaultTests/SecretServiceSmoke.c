#include "CPlatformVault.h"
#include <libsecret/secret.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* Only run through test-linux-vault.py on a new private D-Bus/keyring. All
 * identities and bytes are synthetic; no user/application namespaces are used. */
static const char *service = "com.oliverbross.xlog.ci.linux-vault";
static const char *other_service = "com.oliverbross.xlog.ci.linux-vault/other";
static const char *accounts[] = {"Account", "account", "a/b", "a", "p\xc3\xa4ss/\xe7\xa7\x98\xe5\xaf\x86"};
static const uint8_t payload[] = "fixture-\xc3\xa9\xe7\xa7\x98\xe5\xaf\x86\0end";
static const uint8_t other_payload[] = "other-fixture";

static void require(int condition, const char *operation) {
    if (!condition) {
        fprintf(stderr, "Linux vault fixture failed: %s\n", operation);
        exit(1);
    }
}

static void check_load(const char *identity_service, const char *account,
                       int expected, const uint8_t *value, size_t length) {
    uint8_t *bytes = NULL;
    size_t count = 0;
    uint32_t native_code = 0;
    int result = xlog_vault_load(identity_service, account, &bytes, &count, &native_code);
    require(result == expected, "load result");
    if (result == XLOG_VAULT_OK) {
        require(count == length && bytes && (!length || !memcmp(bytes, value, length)), "exact bytes");
    } else {
        require(!bytes && !count, "failed load clears outputs");
    }
    xlog_vault_value_destroy(bytes, count);
}

static void lock_default_collection(void) {
    GError *error = NULL;
    SecretService *vault = secret_service_get_sync(SECRET_SERVICE_NONE, NULL, &error);
    require(vault && !error, "fixture service");
    SecretCollection *collection = secret_collection_for_alias_sync(vault, SECRET_COLLECTION_DEFAULT,
        SECRET_COLLECTION_NONE, NULL, &error);
    require(collection && !error, "fixture default collection");
    GList *objects = g_list_append(NULL, collection);
    GList *locked = NULL;
    int count = secret_service_lock_sync(vault, objects, NULL, &locked, &error);
    require(count == 1 && !error, "fixture collection lock");
    g_list_free_full(locked, g_object_unref);
    g_list_free(objects);
    g_object_unref(collection);
    g_object_unref(vault);
}

int main(int argc, char **argv) {
    const char *fixture = getenv("XLOG_TEST_LINUX_VAULT_ROOT");
    require(fixture && fixture[0] && getenv("DBUS_SESSION_BUS_ADDRESS"), "isolated runner required");
    require(argc == 2 && xlog_vault_supported() && xlog_vault_max_secret_bytes() == 2560, "capability");
    const char *mode = argv[1];
    uint32_t native_code = 0;
    size_t account_count = sizeof(accounts) / sizeof(accounts[0]);
    if (!strcmp(mode, "probe")) {
        GError *error = NULL;
        /* libsecret 0.21.4 documents NULL here but its synchronous alias
         * lookup passes it to an internal method requiring a service proxy. */
        SecretService *vault = secret_service_get_sync(SECRET_SERVICE_NONE, NULL, &error);
        SecretCollection *collection = vault && !error
            ? secret_collection_for_alias_sync(vault, SECRET_COLLECTION_DEFAULT,
                SECRET_COLLECTION_NONE, NULL, &error) : NULL;
        int ready = collection && !error && !secret_collection_get_locked(collection);
        if (!ready) fprintf(stderr, "Linux vault fixture readiness: service=%d collection=%d locked=%d error=%d\n",
                            vault != NULL, collection != NULL,
                            collection ? secret_collection_get_locked(collection) : -1,
                            error ? error->code : 0);
        if (error) g_error_free(error);
        if (collection) g_object_unref(collection);
        if (vault) g_object_unref(vault);
        if (!ready) return 1;
        uint8_t *bytes = NULL;
        size_t count = 0;
        int result = xlog_vault_load(service, "ready", &bytes, &count, &native_code);
        xlog_vault_value_destroy(bytes, count);
        if (result != XLOG_VAULT_NOT_FOUND)
            fprintf(stderr, "Linux vault fixture readiness: load=%d native=%u\n", result, native_code);
        return result == XLOG_VAULT_NOT_FOUND ? 0 : 1;
    }
    if (!strcmp(mode, "write")) {
        char long_identity[130];
        memset(long_identity, 'a', sizeof(long_identity));
        long_identity[129] = 0;
        for (size_t index = 0; index < account_count; index++) {
            check_load(service, accounts[index], XLOG_VAULT_NOT_FOUND, NULL, 0);
            require(xlog_vault_save(service, accounts[index], payload, sizeof(payload) - 1,
                                    &native_code) == XLOG_VAULT_OK, "save");
            require(xlog_vault_save(other_service, accounts[index], other_payload, sizeof(other_payload) - 1,
                                    &native_code) == XLOG_VAULT_OK, "other identity save");
        }
        require(xlog_vault_save(service, long_identity, payload, sizeof(payload) - 1, &native_code)
                == XLOG_VAULT_INVALID, "long identity rejected");
        require(xlog_vault_save(service, "invalid\nidentity", payload, sizeof(payload) - 1, &native_code)
                == XLOG_VAULT_INVALID, "control identity rejected");
        require(xlog_vault_save(service, "\xff", payload, sizeof(payload) - 1, &native_code)
                == XLOG_VAULT_INVALID, "invalid UTF-8 identity rejected");
        require(xlog_vault_save(service, "empty", payload, 0, &native_code)
                == XLOG_VAULT_INVALID, "empty raw secret rejected");
        uint8_t maximum[2561];
        memset(maximum, 'x', sizeof(maximum));
        require(xlog_vault_save(service, "maximum", maximum, 2560, &native_code) == XLOG_VAULT_OK,
                "maximum accepted");
        require(xlog_vault_save(service, "maximum", maximum, 2561, &native_code) == XLOG_VAULT_INVALID,
                "oversized rejected");
    } else if (!strcmp(mode, "read")) {
        for (size_t index = 0; index < account_count; index++) {
            check_load(service, accounts[index], XLOG_VAULT_OK, payload, sizeof(payload) - 1);
            check_load(other_service, accounts[index], XLOG_VAULT_OK, other_payload, sizeof(other_payload) - 1);
        }
        uint8_t maximum[2560];
        memset(maximum, 'x', sizeof(maximum));
        check_load(service, "maximum", XLOG_VAULT_OK, maximum, sizeof(maximum));
        require(xlog_vault_save(service, "Account", other_payload, sizeof(other_payload) - 1, &native_code)
                == XLOG_VAULT_OK, "replace");
        check_load(service, "Account", XLOG_VAULT_OK, other_payload, sizeof(other_payload) - 1);
        require(xlog_vault_remove(service, "Account", &native_code) == XLOG_VAULT_OK, "remove");
        require(xlog_vault_remove(service, "Account", &native_code) == XLOG_VAULT_OK, "idempotent remove");
        check_load(service, "Account", XLOG_VAULT_NOT_FOUND, NULL, 0);
        check_load(service, "account", XLOG_VAULT_OK, payload, sizeof(payload) - 1);
    } else if (!strcmp(mode, "lock")) {
        lock_default_collection();
    } else if (!strcmp(mode, "locked")) {
        check_load(service, "account", XLOG_VAULT_UNAVAILABLE, NULL, 0);
    } else if (!strcmp(mode, "recovered")) {
        /* Restart after the locked-read proof must recover this same encrypted
         * keyring, rather than silently creating an empty collection. */
        check_load(service, "account", XLOG_VAULT_OK, payload, sizeof(payload) - 1);
        check_load(other_service, "Account", XLOG_VAULT_OK, other_payload, sizeof(other_payload) - 1);
        uint8_t maximum[2560];
        memset(maximum, 'x', sizeof(maximum));
        check_load(service, "maximum", XLOG_VAULT_OK, maximum, sizeof(maximum));
    } else if (!strcmp(mode, "delete")) {
        for (size_t index = 0; index < account_count; index++) {
            require(xlog_vault_remove(service, accounts[index], &native_code) == XLOG_VAULT_OK, "cleanup");
            require(xlog_vault_remove(other_service, accounts[index], &native_code) == XLOG_VAULT_OK,
                    "other identity cleanup");
            check_load(service, accounts[index], XLOG_VAULT_NOT_FOUND, NULL, 0);
            check_load(other_service, accounts[index], XLOG_VAULT_NOT_FOUND, NULL, 0);
        }
        require(xlog_vault_remove(service, "maximum", &native_code) == XLOG_VAULT_OK, "maximum cleanup");
    } else if (!strcmp(mode, "unavailable")) {
        check_load(service, "account", XLOG_VAULT_UNAVAILABLE, NULL, 0);
        require(xlog_vault_save(service, "account", payload, sizeof(payload) - 1, &native_code)
                == XLOG_VAULT_UNAVAILABLE, "unavailable save");
        require(xlog_vault_remove(service, "account", &native_code) == XLOG_VAULT_UNAVAILABLE,
                "unavailable remove");
    } else {
        require(0, "unknown fixture mode");
    }
    return 0;
}

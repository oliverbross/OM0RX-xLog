#include "CCurlBackup.h"

#include <curl/curl.h>
#include <pthread.h>
#include <stdlib.h>
#include <string.h>

static pthread_once_t xlog_curl_once = PTHREAD_ONCE_INIT;
static void xlog_curl_initialize(void) { (void)curl_global_init(CURL_GLOBAL_DEFAULT); }

struct xlog_upload_cursor {
    const uint8_t *bytes;
    size_t length;
    size_t offset;
};

struct xlog_download_buffer {
    uint8_t *bytes;
    size_t length;
    size_t maximum;
    int too_large;
};

static size_t xlog_curl_read(char *destination, size_t size, size_t count, void *context) {
    struct xlog_upload_cursor *cursor = context;
    size_t capacity = size * count;
    size_t remaining = cursor->length - cursor->offset;
    size_t copied = remaining < capacity ? remaining : capacity;
    if (copied > 0) {
        memcpy(destination, cursor->bytes + cursor->offset, copied);
        cursor->offset += copied;
    }
    return copied;
}

static size_t xlog_curl_write(char *source, size_t size, size_t count, void *context) {
    struct xlog_download_buffer *buffer = context;
    if (size != 0 && count > SIZE_MAX / size) { buffer->too_large = 1; return 0; }
    size_t incoming = size * count;
    if (incoming > buffer->maximum - buffer->length) { buffer->too_large = 1; return 0; }
    if (incoming == 0) return 0;
    uint8_t *grown = realloc(buffer->bytes, buffer->length + incoming);
    if (grown == NULL) return 0;
    buffer->bytes = grown;
    memcpy(buffer->bytes + buffer->length, source, incoming);
    buffer->length += incoming;
    return incoming;
}

static CURL *xlog_curl_handle(const char *url, const char *username,
                              const char *password, int require_tls) {
    pthread_once(&xlog_curl_once, xlog_curl_initialize);
    CURL *handle = curl_easy_init();
    if (handle == NULL) return NULL;
    if (curl_easy_setopt(handle, CURLOPT_URL, url) != CURLE_OK ||
        curl_easy_setopt(handle, CURLOPT_PROTOCOLS_STR, "ftp,ftps") != CURLE_OK ||
        curl_easy_setopt(handle, CURLOPT_REDIR_PROTOCOLS_STR, "ftp,ftps") != CURLE_OK ||
        curl_easy_setopt(handle, CURLOPT_FOLLOWLOCATION, 0L) != CURLE_OK ||
        curl_easy_setopt(handle, CURLOPT_PROXY, "") != CURLE_OK ||
        curl_easy_setopt(handle, CURLOPT_NETRC, CURL_NETRC_IGNORED) != CURLE_OK ||
        curl_easy_setopt(handle, CURLOPT_USERNAME, username) != CURLE_OK ||
        curl_easy_setopt(handle, CURLOPT_PASSWORD, password) != CURLE_OK ||
        curl_easy_setopt(handle, CURLOPT_CONNECTTIMEOUT_MS, 15000L) != CURLE_OK ||
        curl_easy_setopt(handle, CURLOPT_TIMEOUT_MS, 120000L) != CURLE_OK ||
        curl_easy_setopt(handle, CURLOPT_LOW_SPEED_LIMIT, 1L) != CURLE_OK ||
        curl_easy_setopt(handle, CURLOPT_LOW_SPEED_TIME, 30L) != CURLE_OK ||
        curl_easy_setopt(handle, CURLOPT_NOSIGNAL, 1L) != CURLE_OK ||
        curl_easy_setopt(handle, CURLOPT_FAILONERROR, 1L) != CURLE_OK ||
        curl_easy_setopt(handle, CURLOPT_PATH_AS_IS, 1L) != CURLE_OK ||
        curl_easy_setopt(handle, CURLOPT_USERAGENT, "OM0RX-xLog/backup") != CURLE_OK ||
        curl_easy_setopt(handle, CURLOPT_TRANSFERTEXT, 0L) != CURLE_OK ||
        curl_easy_setopt(handle, CURLOPT_USE_SSL, require_tls ? CURLUSESSL_ALL : CURLUSESSL_NONE) != CURLE_OK ||
        curl_easy_setopt(handle, CURLOPT_SSL_VERIFYPEER, require_tls ? 1L : 0L) != CURLE_OK ||
        curl_easy_setopt(handle, CURLOPT_SSL_VERIFYHOST, require_tls ? 2L : 0L) != CURLE_OK) {
        curl_easy_cleanup(handle);
        return NULL;
    }
    return handle;
}

int32_t xlog_ftp_upload(const char *url, const char *username,
                        const char *password, const char *mkdir_command,
                        const uint8_t *bytes, size_t length, int require_tls,
                        long *response_code) {
    if (url == NULL || username == NULL || password == NULL || mkdir_command == NULL ||
        bytes == NULL || length == 0 || response_code == NULL) return XLOG_FTP_RESULT_FAILED;
    *response_code = 0;
    CURL *handle = xlog_curl_handle(url, username, password, require_tls);
    if (handle == NULL) return XLOG_FTP_RESULT_FAILED;
    struct curl_slist *commands = curl_slist_append(NULL, mkdir_command);
    struct xlog_upload_cursor cursor = { bytes, length, 0 };
    if (commands == NULL ||
        curl_easy_setopt(handle, CURLOPT_QUOTE, commands) != CURLE_OK ||
        curl_easy_setopt(handle, CURLOPT_UPLOAD, 1L) != CURLE_OK ||
        curl_easy_setopt(handle, CURLOPT_INFILESIZE_LARGE, (curl_off_t)length) != CURLE_OK ||
        curl_easy_setopt(handle, CURLOPT_READFUNCTION, xlog_curl_read) != CURLE_OK ||
        curl_easy_setopt(handle, CURLOPT_READDATA, &cursor) != CURLE_OK) {
        curl_slist_free_all(commands); curl_easy_cleanup(handle); return XLOG_FTP_RESULT_FAILED;
    }
    CURLcode result = curl_easy_perform(handle);
    (void)curl_easy_getinfo(handle, CURLINFO_RESPONSE_CODE, response_code);
    curl_slist_free_all(commands);
    curl_easy_cleanup(handle);
    if (result == CURLE_OK && cursor.offset == length) return XLOG_FTP_RESULT_OK;
    // FTP 550 is intentionally not called a conflict: servers use it for both
    // an existing directory and other permanent refusals. QUOTE failed before
    // STOR, so the only safe claim is that this attempt wrote no object bytes.
    if (result == CURLE_QUOTE_ERROR && *response_code == 550) return XLOG_FTP_RESULT_NOT_CREATED;
    return XLOG_FTP_RESULT_FAILED;
}

int32_t xlog_ftp_download(const char *url, const char *username,
                          const char *password, size_t maximum_length,
                          int require_tls, uint8_t **output,
                          size_t *output_length, long *response_code) {
    if (url == NULL || username == NULL || password == NULL || maximum_length == 0 ||
        output == NULL || output_length == NULL || response_code == NULL) return XLOG_FTP_RESULT_FAILED;
    *output = NULL; *output_length = 0; *response_code = 0;
    CURL *handle = xlog_curl_handle(url, username, password, require_tls);
    if (handle == NULL) return XLOG_FTP_RESULT_FAILED;
    struct xlog_download_buffer buffer = { NULL, 0, maximum_length, 0 };
    if (curl_easy_setopt(handle, CURLOPT_MAXFILESIZE_LARGE, (curl_off_t)maximum_length) != CURLE_OK ||
        curl_easy_setopt(handle, CURLOPT_WRITEFUNCTION, xlog_curl_write) != CURLE_OK ||
        curl_easy_setopt(handle, CURLOPT_WRITEDATA, &buffer) != CURLE_OK) {
        curl_easy_cleanup(handle); return XLOG_FTP_RESULT_FAILED;
    }
    CURLcode result = curl_easy_perform(handle);
    (void)curl_easy_getinfo(handle, CURLINFO_RESPONSE_CODE, response_code);
    curl_easy_cleanup(handle);
    // libcurl may reject the advertised SIZE or enforce its byte limit before
    // the write callback sees the excess. Both paths are bounded-size failures.
    if (buffer.too_large || result == CURLE_FILESIZE_EXCEEDED) {
        free(buffer.bytes); return XLOG_FTP_RESULT_TOO_LARGE;
    }
    if (result != CURLE_OK) { free(buffer.bytes); return XLOG_FTP_RESULT_FAILED; }
    *output = buffer.bytes; *output_length = buffer.length;
    return XLOG_FTP_RESULT_OK;
}

void xlog_ftp_free(void *pointer) { free(pointer); }

#ifndef XLOG_CURL_BACKUP_H
#define XLOG_CURL_BACKUP_H

#include <stddef.h>
#include <stdint.h>

enum {
    XLOG_FTP_RESULT_OK = 0,
    XLOG_FTP_RESULT_NOT_CREATED = 1,
    XLOG_FTP_RESULT_FAILED = 2,
    XLOG_FTP_RESULT_TOO_LARGE = 3
};

int32_t xlog_ftp_upload(const char *url, const char *username,
                        const char *password, const char *mkdir_command,
                        const uint8_t *bytes, size_t length, int require_tls,
                        long *response_code);

int32_t xlog_ftp_download(const char *url, const char *username,
                          const char *password, size_t maximum_length,
                          int require_tls, uint8_t **output,
                          size_t *output_length, long *response_code);

void xlog_ftp_free(void *pointer);

#endif

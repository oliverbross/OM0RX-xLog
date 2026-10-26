// Copyright © 2026 Oliver Bross OM0RX. SPDX-License-Identifier: GPL-3.0-only
#pragma once
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
typedef struct {
    int32_t pid;
    int input_fd;
    int output_fd;
    int error_fd;
} XCWChild;
// Returns a POSIX error number. Child inherits only stdin/stdout/stderr and a
// fixed non-secret environment. macOS launch contract; not an OS sandbox.
int xcw_spawn(const char *executable, const char *model, XCWChild *child);
// 0 running, 1 reaped, negative POSIX error; normalized exit code on reap.
int xcw_poll(int32_t pid, int *exit_code);
int xcw_terminate(int32_t pid, int force);
#ifdef __cplusplus
}
#endif

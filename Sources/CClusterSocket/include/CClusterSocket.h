#ifndef XLOG_CLUSTER_SOCKET_H
#define XLOG_CLUSTER_SOCKET_H
#include <stdint.h>
#include <stddef.h>

typedef struct XLogSocket XLogSocket;
typedef struct XLogSocketCancellation XLogSocketCancellation;
XLogSocketCancellation *xlog_socket_cancellation_create(void);
void xlog_socket_cancel(XLogSocketCancellation *token);
int xlog_socket_cancelled(const XLogSocketCancellation *token);
void xlog_socket_cancellation_destroy(XLogSocketCancellation *token);

/* Only the owning I/O lane may operate on or close a socket. Cancellation is
 * thread safe and never closes/reuses a descriptor underneath another call.
 * timeout_ms bounds connect after system DNS resolution; cancellation is
 * checked before/after DNS and at most every 100 ms during socket operations. */
XLogSocket *xlog_socket_connect(const char *host, uint16_t port, int timeout_ms,
                               const XLogSocketCancellation *token);
/* read: >0 bytes, 0 EOF, -1 failure, -2 would block/timeout. */
int xlog_socket_read(XLogSocket *socket, void *bytes, int capacity, int timeout_ms);
/* write: >0 bytes (possibly partial), -1 failure, -2 would block. */
int xlog_socket_write(XLogSocket *socket, const void *bytes, int count);
void xlog_socket_close(XLogSocket *socket);
#endif

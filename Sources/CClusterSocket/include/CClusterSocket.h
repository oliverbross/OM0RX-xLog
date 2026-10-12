#ifndef XLOG_CLUSTER_SOCKET_H
#define XLOG_CLUSTER_SOCKET_H
#include <stdint.h>
#include <stddef.h>

typedef struct XLogSocket XLogSocket;
typedef struct XLogSocketAddresses XLogSocketAddresses;
typedef struct XLogSocketCancellation XLogSocketCancellation;
XLogSocketCancellation *xlog_socket_cancellation_create(void);
void xlog_socket_cancel(XLogSocketCancellation *token);
int xlog_socket_cancelled(const XLogSocketCancellation *token);
void xlog_socket_cancellation_destroy(XLogSocketCancellation *token);

/* Resolution itself is synchronous. The Swift resolver runs this on a bounded
 * background pool, abandoning late results on cancellation/deadline. Addresses
 * own their resolver allocation and (on Windows) one Winsock runtime reference. */
XLogSocketAddresses *xlog_socket_resolve(const char *host, uint16_t port);
void xlog_socket_addresses_destroy(XLogSocketAddresses *addresses);
/* Only the owning I/O lane may operate on or close a socket. The address list
 * must remain alive during connect, but can be destroyed once connect returns.
 * Cancellation is checked at most every 100 ms during socket operations. */
XLogSocket *xlog_socket_connect_addresses(const XLogSocketAddresses *addresses,
                                        int timeout_ms, const XLogSocketCancellation *token);
/* Synchronous convenience for low-level tests. Production uses the bounded
 * Swift resolver plus connect_addresses, not this DNS-blocking wrapper. */
XLogSocket *xlog_socket_connect(const char *host, uint16_t port, int timeout_ms,
                               const XLogSocketCancellation *token);
/* read: >0 bytes, 0 EOF, -1 failure, -2 would block/timeout. */
int xlog_socket_read(XLogSocket *socket, void *bytes, int capacity, int timeout_ms);
/* write: >0 bytes (possibly partial), -1 failure, -2 would block. */
int xlog_socket_write(XLogSocket *socket, const void *bytes, int count);
void xlog_socket_close(XLogSocket *socket);
#endif

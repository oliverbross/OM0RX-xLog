#ifndef XLOG_CLUSTER_SOCKET_TEST_H
#define XLOG_CLUSTER_SOCKET_TEST_H
#include <stdint.h>
typedef struct XLogTestSocket XLogTestSocket;
XLogTestSocket *xlog_test_listen(int ipv6, uint16_t *port);
XLogTestSocket *xlog_test_accept(XLogTestSocket *listener, int timeout_ms);
int xlog_test_read(XLogTestSocket *peer, void *bytes, int capacity, int timeout_ms);
int xlog_test_write(XLogTestSocket *peer, const void *bytes, int count);
void xlog_test_close(XLogTestSocket *socket);
#endif

#include "CClusterSocketTestSupport.h"
#include <stdlib.h>
#include <string.h>
#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <winsock2.h>
#include <ws2tcpip.h>
typedef SOCKET test_handle;
#define BAD INVALID_SOCKET
#define CLOSE closesocket
#else
#include <sys/socket.h>
#include <netinet/in.h>
#include <unistd.h>
#include <poll.h>
typedef int test_handle;
#define BAD (-1)
#define CLOSE close
#endif

struct XLogTestSocket { test_handle fd; int owns_runtime; };
static int readable(test_handle fd, int timeout_ms) {
#ifdef _WIN32
    WSAPOLLFD item = {fd, POLLRDNORM, 0};
    return WSAPoll(&item, 1, timeout_ms);
#else
    struct pollfd item = {fd, POLLIN, 0};
    return poll(&item, 1, timeout_ms);
#endif
}
XLogTestSocket *xlog_test_listen(int ipv6, uint16_t *port) {
#ifdef _WIN32
    WSADATA runtime;
    if (WSAStartup(MAKEWORD(2, 2), &runtime)) return NULL;
#endif
    test_handle fd = socket(ipv6 ? AF_INET6 : AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (fd == BAD) goto fail;
    struct sockaddr_storage storage;
    memset(&storage, 0, sizeof(storage));
    int size;
    if (ipv6) {
        struct sockaddr_in6 *address = (void *)&storage;
        address->sin6_family = AF_INET6;
        address->sin6_addr = in6addr_loopback;
        size = sizeof(*address);
    } else {
        struct sockaddr_in *address = (void *)&storage;
        address->sin_family = AF_INET;
        address->sin_addr.s_addr = htonl(INADDR_LOOPBACK);
        size = sizeof(*address);
    }
    if (bind(fd, (void *)&storage, size) || listen(fd, 4)) { CLOSE(fd); goto fail; }
#ifdef _WIN32
    int length = sizeof(storage);
#else
    socklen_t length = sizeof(storage);
#endif
    if (getsockname(fd, (void *)&storage, &length)) { CLOSE(fd); goto fail; }
    *port = ntohs(ipv6 ? ((struct sockaddr_in6 *)&storage)->sin6_port : ((struct sockaddr_in *)&storage)->sin_port);
    XLogTestSocket *result = malloc(sizeof(*result));
    if (!result) { CLOSE(fd); goto fail; }
    result->fd = fd;
    result->owns_runtime = 1;
    return result;
fail:
#ifdef _WIN32
    WSACleanup();
#endif
    return NULL;
}
XLogTestSocket *xlog_test_accept(XLogTestSocket *listener, int timeout_ms) {
    if (!listener || readable(listener->fd, timeout_ms) <= 0) return NULL;
    test_handle peer = accept(listener->fd, NULL, NULL);
    if (peer == BAD) return NULL;
#ifdef SO_NOSIGPIPE
    int enabled = 1;
    setsockopt(peer, SOL_SOCKET, SO_NOSIGPIPE, &enabled, sizeof(enabled));
#endif
    XLogTestSocket *result = malloc(sizeof(*result));
    if (!result) { CLOSE(peer); return NULL; }
    result->fd = peer;
    result->owns_runtime = 0;
    return result;
}
int xlog_test_read(XLogTestSocket *peer, void *bytes, int capacity, int timeout_ms) {
    if (!peer || readable(peer->fd, timeout_ms) <= 0) return -2;
    return (int)recv(peer->fd, bytes, capacity, 0);
}
int xlog_test_write(XLogTestSocket *peer, const void *bytes, int count) {
#ifdef MSG_NOSIGNAL
    int flags = MSG_NOSIGNAL;
#else
    int flags = 0;
#endif
    return peer ? (int)send(peer->fd, bytes, count, flags) : -1;
}
void xlog_test_close(XLogTestSocket *socket) {
    if (!socket) return;
    CLOSE(socket->fd);
#ifdef _WIN32
    if (socket->owns_runtime) WSACleanup();
#endif
    free(socket);
}

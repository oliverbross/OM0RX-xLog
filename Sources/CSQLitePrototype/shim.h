#include <sqlite3.h>

#if defined(__linux__)
#include <fcntl.h>
#include <linux/fs.h>

/* Swift's Glibc module does not expose renameat2. Keep the Linux ABI binding
 * here with the platform headers that define its exact signature and flag. */
extern int renameat2(int olddirfd, const char *oldpath,
                     int newdirfd, const char *newpath, unsigned int flags);

static inline int xlog_renameat_noreplace(int olddirfd, const char *oldpath,
                                          int newdirfd, const char *newpath) {
    return renameat2(olddirfd, oldpath, newdirfd, newpath, RENAME_NOREPLACE);
}
#endif

import Foundation
#if os(Windows)
import WinSDK
#elseif os(Linux)
import Glibc
#else
import Darwin
#endif

/// One updater per workspace, including separate development/release processes.
/// The lock file is never removed: unlinking it could create two lock owners.
final class ReferenceRefreshLease {
    #if os(Windows)
    private var handle: HANDLE?
    #else
    private var descriptor: Int32 = -1
    #endif

    init(directory: URL) throws {
        // Reference Data is replaced by restore. Keep the lock in its stable
        // workspace parent, outside both the backup payload and restore target.
        let path = directory.deletingLastPathComponent().appendingPathComponent(".reference-refresh.lock").path
        #if os(Windows)
        // No sharing keeps the stable lock file exclusively owned until this
        // handle closes. OPEN_ALWAYS never truncates an existing lock file.
        let opened = path.withCString(encodedAs: UTF16.self) {
            CreateFileW($0, DWORD(GENERIC_READ | GENERIC_WRITE), 0, nil, DWORD(OPEN_ALWAYS),
                        DWORD(FILE_ATTRIBUTE_NORMAL | FILE_FLAG_OPEN_REPARSE_POINT), nil)
        }
        guard let opened, opened != HANDLE(bitPattern: -1) else { throw Self.busy }
        var info = BY_HANDLE_FILE_INFORMATION()
        guard GetFileType(opened) == DWORD(FILE_TYPE_DISK),
              GetFileInformationByHandle(opened, &info) != 0,
              info.dwFileAttributes & DWORD(FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT) == 0 else {
            CloseHandle(opened)
            throw Self.busy
        }
        handle = opened
        #else
        let fd = open(path, O_RDWR | O_CREAT | O_NOFOLLOW | O_CLOEXEC, S_IRUSR | S_IWUSR)
        guard fd >= 0 else { throw Self.busy }
        var info = stat()
        guard fstat(fd, &info) == 0, info.st_mode & S_IFMT == S_IFREG,
              flock(fd, LOCK_EX | LOCK_NB) == 0 else {
            close(fd)
            throw Self.busy
        }
        descriptor = fd
        #endif
    }

    func release() {
        #if os(Windows)
        guard let handle else { return }
        CloseHandle(handle)
        self.handle = nil
        #else
        guard descriptor >= 0 else { return }
        flock(descriptor, LOCK_UN)
        close(descriptor)
        descriptor = -1
        #endif
    }

    deinit { release() }

    private static var busy: WorkerFailure {
        WorkerFailure("reference_busy", "Reference data is being updated by another process or cannot be locked safely.")
    }
}

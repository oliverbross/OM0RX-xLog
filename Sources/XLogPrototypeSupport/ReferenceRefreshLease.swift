#if os(macOS)
import Foundation
import Darwin

/// One updater per workspace, including separate development/release processes.
/// The lock file is never removed: unlinking it could create two lock owners.
final class ReferenceRefreshLease {
    private var descriptor: Int32

    init(directory: URL) throws {
        // Reference Data is replaced by restore. Keep the lock in its stable
        // workspace parent, outside both the backup payload and restore target.
        let path = directory.deletingLastPathComponent().appendingPathComponent(".reference-refresh.lock").path
        let fd = open(path, O_RDWR | O_CREAT | O_NOFOLLOW | O_CLOEXEC, S_IRUSR | S_IWUSR)
        guard fd >= 0 else { throw Self.busy }
        var info = stat()
        guard fstat(fd, &info) == 0, info.st_mode & S_IFMT == S_IFREG,
              flock(fd, LOCK_EX | LOCK_NB) == 0 else {
            close(fd)
            throw Self.busy
        }
        descriptor = fd
    }

    func release() {
        guard descriptor >= 0 else { return }
        flock(descriptor, LOCK_UN)
        close(descriptor)
        descriptor = -1
    }

    deinit { release() }

    private static var busy: WorkerFailure {
        WorkerFailure("reference_busy", "Reference data is being updated by another process or cannot be locked safely.")
    }
}
#endif

import Foundation
import CClusterSocket

/// Immutable, owned resolver output. It never contains a socket or credentials.
final class ClusterSocketAddresses: @unchecked Sendable {
    let pointer: OpaquePointer
    init?(host: String, port: UInt16) {
        guard let pointer = host.withCString({ xlog_socket_resolve($0, port) }) else { return nil }
        self.pointer = pointer
    }
    deinit { xlog_socket_addresses_destroy(pointer) }
}

/// System DNS APIs can block without a portable cancellation operation. Keep
/// those calls off the connection lane, bound their number across all sessions,
/// and let a cancelled/timed-out caller abandon only its result. An abandoned
/// call keeps its permit until the OS returns, preventing retry/Stop storms from
/// accumulating an unbounded collection of blocked threads.
final class ClusterAddressResolver: @unchecked Sendable {
    static let shared = ClusterAddressResolver()
    typealias Lookup = @Sendable (String, UInt16) -> ClusterSocketAddresses?
    private let lookup: Lookup
    private let maximumConcurrent: Int
    private let lock = NSLock()
    private var running = 0
    private let queue = DispatchQueue(label: "com.oliverbross.xlog.cluster.resolve", attributes: .concurrent)

    init(maximumConcurrent: Int = 16, lookup: @escaping Lookup = { ClusterSocketAddresses(host: $0, port: $1) }) {
        self.maximumConcurrent = max(1, maximumConcurrent)
        self.lookup = lookup
    }

    var outstandingCount: Int { lock.withLock { running } }

    private final class Result: @unchecked Sendable {
        private let lock = NSLock()
        private var waiting = true, finished = false
        private var addresses: ClusterSocketAddresses?
        var needsLookup: Bool { lock.withLock { waiting && !finished } }
        func finish(_ value: ClusterSocketAddresses?) {
            lock.withLock {
                finished = true
                if waiting { addresses = value }
            }
        }
        func takeIfFinished() -> (Bool, ClusterSocketAddresses?) {
            lock.withLock {
                guard finished else { return (false, nil) }
                waiting = false
                let value = addresses
                addresses = nil
                return (true, value)
            }
        }
        func abandon() { lock.withLock { waiting = false; addresses = nil } }
    }

    func resolve(host: String, port: UInt16, deadline: UInt64,
                 cancelled: () -> Bool) -> ClusterSocketAddresses? {
        guard !cancelled(), DispatchTime.now().uptimeNanoseconds < deadline else { return nil }
        guard lock.withLock({
            guard running < maximumConcurrent else { return false }
            running += 1
            return true
        }) else { return nil }
        let result = Result()
        queue.async { [self] in
            defer { lock.withLock { running -= 1 } }
            guard result.needsLookup else { return }
            result.finish(lookup(host, port))
        }
        while !cancelled(), DispatchTime.now().uptimeNanoseconds < deadline {
            let (finished, addresses) = result.takeIfFinished()
            if finished { return addresses }
            Thread.sleep(forTimeInterval: 0.01)
        }
        result.abandon()
        return nil
    }
}

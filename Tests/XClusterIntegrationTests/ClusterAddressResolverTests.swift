import Foundation
import XCTest
import CClusterSocketTestSupport
@testable import XClusterIntegrationCore

private final class DNSGate: @unchecked Sendable {
    private let condition = NSCondition()
    private var released = false, entered = 0
    func wait() {
        condition.lock()
        defer { condition.unlock() }
        entered += 1
        let deadline = Date().addingTimeInterval(5)
        while !released {
            if !condition.wait(until: deadline) { return }
        }
    }
    func release() { condition.lock(); released = true; condition.broadcast(); condition.unlock() }
    var count: Int { condition.lock(); defer { condition.unlock() }; return entered }
}

private final class DNSPhases: @unchecked Sendable {
    private let lock = NSLock()
    private var phases: [ClusterConnectionPhase] = []
    func append(_ phase: ClusterConnectionPhase) { lock.withLock { phases.append(phase) } }
    var values: [ClusterConnectionPhase] { lock.withLock { phases } }
}

private final class ConnectionLifetime {
    weak var value: ClusterPortableConnection?
    init(_ value: ClusterPortableConnection?) { self.value = value }
}

final class ClusterAddressResolverTests: XCTestCase {
    private func deadline(_ milliseconds: UInt64) -> UInt64 {
        DispatchTime.now().uptimeNanoseconds + milliseconds * 1_000_000
    }
    private func waitFor(_ predicate: () -> Bool) async throws {
        for _ in 0..<200 {
            if predicate() { return }
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTFail("Resolver condition did not complete")
    }

    func testDeadlineRetainsPermitUntilBlockedLookupReturnsThenRecovers() async throws {
        let gate = DNSGate()
        defer { gate.release() }
        let resolver = ClusterAddressResolver(maximumConcurrent: 1) { host, port in
            gate.wait()
            return ClusterSocketAddresses(host: host, port: port)
        }
        let start = Date()
        XCTAssertNil(resolver.resolve(host: "127.0.0.1", port: 7300, deadline: deadline(60), cancelled: { false }))
        XCTAssertLessThan(Date().timeIntervalSince(start), 0.5)
        XCTAssertEqual(resolver.outstandingCount, 1)
        // Retries cannot consume new resolver jobs while an abandoned OS call
        // still occupies the sole permit. No test contacts a DNS server.
        for _ in 0..<100 {
            XCTAssertNil(resolver.resolve(host: "127.0.0.1", port: 7300, deadline: deadline(1000), cancelled: { false }))
        }
        XCTAssertEqual(gate.count, 1)
        XCTAssertEqual(resolver.outstandingCount, 1)
        gate.release()
        try await waitFor { resolver.outstandingCount == 0 }
        XCTAssertNotNil(resolver.resolve(host: "127.0.0.1", port: 7300, deadline: deadline(1000), cancelled: { false }))
        try await waitFor { resolver.outstandingCount == 0 }
        XCTAssertEqual(gate.count, 2)
    }

    func testCancellationAndExpiredDeadlineDoNotStartResolver() {
        let resolver = ClusterAddressResolver { _, _ in XCTFail("Cancelled lookup ran"); return nil }
        XCTAssertNil(resolver.resolve(host: "127.0.0.1", port: 1, deadline: deadline(1000), cancelled: { true }))
        XCTAssertNil(resolver.resolve(host: "127.0.0.1", port: 1, deadline: 0, cancelled: { false }))
        XCTAssertEqual(resolver.outstandingCount, 0)
    }

    func testConcurrentRetryStormCannotExceedResolverCapacity() async throws {
        let gate = DNSGate()
        defer { gate.release() }
        let resolver = ClusterAddressResolver(maximumConcurrent: 2) { _, _ in gate.wait(); return nil }
        // Fill both permits before the storm. concurrentPerform may serialize
        // its callers or occupy the dispatch workers needed by DNS on Windows;
        // it cannot prove that the resolver has reached capacity by itself.
        let callers = DispatchGroup()
        for _ in 0..<2 {
            callers.enter()
            Thread.detachNewThread {
                defer { callers.leave() }
                let end = DispatchTime.now().uptimeNanoseconds + 5_000_000_000
                XCTAssertNil(resolver.resolve(host: "fixture.invalid", port: 7300, deadline: end, cancelled: { false }))
            }
        }
        try await waitFor { gate.count == 2 && resolver.outstandingCount == 2 }
        DispatchQueue.concurrentPerform(iterations: 64) { _ in
            let end = DispatchTime.now().uptimeNanoseconds + 500_000_000
            XCTAssertNil(resolver.resolve(host: "fixture.invalid", port: 7300, deadline: end, cancelled: { false }))
        }
        XCTAssertEqual(gate.count, 2)
        XCTAssertEqual(resolver.outstandingCount, 2)
        gate.release()
        try await waitFor { resolver.outstandingCount == 0 }
        try await waitFor { callers.wait(timeout: .now()) == .success }
    }

    func testLookupFailureReleasesPermit() async throws {
        let resolver = ClusterAddressResolver(maximumConcurrent: 1) { _, _ in nil }
        XCTAssertNil(resolver.resolve(host: "fixture.invalid", port: 7300, deadline: deadline(1000), cancelled: { false }))
        try await waitFor { resolver.outstandingCount == 0 }
    }

    func testStopReleasesConnectionBeforeDNSCompletesAndLateAnswerCannotOpenSocket() async throws {
        let gate = DNSGate(), phases = DNSPhases()
        defer { gate.release() }
        var port: UInt16 = 0
        let listener = try XCTUnwrap(xlog_test_listen(0, &port))
        defer { xlog_test_close(listener) }
        let resolver = ClusterAddressResolver(maximumConcurrent: 1) { host, port in
            gate.wait()
            return ClusterSocketAddresses(host: host, port: port)
        }
        var client: ClusterPortableConnection? = ClusterPortableConnection(
            server: .init(name: "Fixture", host: "127.0.0.1", port: Int(port), callsign: "OM0RX"),
            password: "", reconnect: true, requestSkimmer: false,
            onState: { state, _ in phases.append(state) }, onLine: { _ in XCTFail("Stopped connection received data") },
            resolver: resolver)
        let releasedClient = ConnectionLifetime(client)
        client?.start()
        try await waitFor { gate.count == 1 }
        let start = Date()
        client?.stop()
        client = nil
        try await waitFor { releasedClient.value == nil }
        XCTAssertLessThan(Date().timeIntervalSince(start), 0.5)
        XCTAssertEqual(resolver.outstandingCount, 1)
        gate.release()
        try await waitFor { resolver.outstandingCount == 0 }
        let unexpected = xlog_test_accept(listener, 100)
        if let unexpected { xlog_test_close(unexpected); XCTFail("Late DNS answer connected after Stop") }
        XCTAssertEqual(phases.values, [.connecting])
    }

    func testConnectionDeadlineIncludesStalledDNS() async throws {
        let gate = DNSGate(), phases = DNSPhases()
        defer { gate.release() }
        let resolver = ClusterAddressResolver(maximumConcurrent: 1) { _, _ in gate.wait(); return nil }
        let client = ClusterPortableConnection(server: .init(name: "Fixture", host: "fixture.invalid", port: 7300, callsign: "OM0RX"),
            password: "", reconnect: false, requestSkimmer: false,
            onState: { state, _ in phases.append(state) }, onLine: { _ in XCTFail("No socket should exist") },
            resolver: resolver, connectionTimeoutMilliseconds: 60)
        defer { client.stop() }
        let start = Date()
        client.start()
        try await waitFor { phases.values.contains(.failed) }
        XCTAssertLessThan(Date().timeIntervalSince(start), 0.5)
        XCTAssertEqual(phases.values, [.connecting, .failed])
        XCTAssertEqual(resolver.outstandingCount, 1)
        gate.release()
        try await waitFor { resolver.outstandingCount == 0 }
    }
}

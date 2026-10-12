import Foundation
import XCTest
import CClusterSocket
import CClusterSocketTestSupport
@testable import XClusterIntegrationCore

private final class WireEvidence: @unchecked Sendable {
    private let lock = NSLock()
    private var storedLines: [String] = []
    private var storedPhases: [ClusterConnectionPhase] = []
    func line(_ line: String) { lock.withLock { storedLines.append(line) } }
    func phase(_ phase: ClusterConnectionPhase) { lock.withLock { storedPhases.append(phase) } }
    var lines: [String] { lock.withLock { storedLines } }
    var phases: [ClusterConnectionPhase] { lock.withLock { storedPhases } }
}

/// Immutable owner retained by the fixture task until all socket work finishes,
/// even if an XCTest timeout ends the awaiting test first.
private final class LoopbackListener: @unchecked Sendable {
    let pointer: OpaquePointer
    let port: UInt16
    init(ipv6: Bool = false) throws {
        var port: UInt16 = 0
        pointer = try XCTUnwrap(xlog_test_listen(ipv6 ? 1 : 0, &port))
        self.port = port
    }
    deinit { xlog_test_close(pointer) }
}

// All endpoints are owned ephemeral loopback listeners; no credentials, saved
// operator configuration, remote cluster, radio or rotor is used by these tests.
final class ClusterPortableTransportTests: XCTestCase {
    private func waitFor(_ predicate: @escaping () -> Bool) async throws {
        for _ in 0..<250 {
            if predicate() { return }
            try await Task.sleep(for: .milliseconds(20))
        }
        XCTFail("Loopback transport condition did not arrive")
    }

    func testPortableOptionsChangeInPlaceAndRetryCanResumeAfterFailure() async throws {
        try await exerciseLiveOptions { server, state, line in
            ClusterPortableConnection(server: server, password: "", reconnect: true, requestSkimmer: true,
                                      onState: state, onLine: line)
        }
    }

    #if canImport(Network)
    func testMacOptionsChangeInPlaceAndRetryCanResumeAfterFailure() async throws {
        try await exerciseLiveOptions { server, state, line in
            makeClusterTCPTransport(server: server, password: "", reconnect: true, requestSkimmer: true,
                                    onState: state, onLine: line)
        }
    }
    #endif

    private func exerciseLiveOptions(_ factory: (ClusterServerConfiguration,
        @escaping @Sendable (ClusterConnectionPhase, String?) -> Void,
        @escaping @Sendable (String) -> Void) -> any ClusterConnectionTransport) async throws {
        let listener = try LoopbackListener()
        let complete = expectation(description: "options changed without replacing live socket")
        let wire = WireEvidence(), events = WireEvidence()
        let client = factory(.init(name: "Fixture", host: "127.0.0.1", port: Int(listener.port), callsign: "OM0RX"),
                             { phase, _ in events.phase(phase) }, { events.line($0) })
        defer { client.stop() }
        DispatchQueue.global().async {
            defer { complete.fulfill() }
            guard let first = xlog_test_accept(listener.pointer, 4_000) else { XCTFail("No first connection"); return }
            var buffer = [UInt8](repeating: 0, count: 4096), input = Data()
            while !String(decoding: input, as: UTF8.self).contains("unset/skimmer\r\n") {
                let count = buffer.withUnsafeMutableBytes { xlog_test_read(first, $0.baseAddress, Int32($0.count), 4_000) }
                guard count > 0 else { xlog_test_close(first); XCTFail("Options edit closed the socket"); return }
                input.append(contentsOf: buffer.prefix(Int(count)))
                if String(decoding: input, as: UTF8.self).contains("set/skimmer\r\n") { wire.line("LOGIN") }
            }
            XCTAssertEqual(String(decoding: input, as: UTF8.self), "OM0RX\r\nset/skimmer\r\nunset/skimmer\r\n")
            xlog_test_close(first)
            if let unexpected = xlog_test_accept(listener.pointer, 2_600) {
                xlog_test_close(unexpected); XCTFail("Reconnect=false was ignored")
            }
            wire.line("RETRY DISABLED")
            guard let second = xlog_test_accept(listener.pointer, 4_000) else { XCTFail("Re-enabling retry did not reconnect"); return }
            defer { xlog_test_close(second) }
            input = Data()
            while !String(decoding: input, as: UTF8.self).contains("set/skimmer\r\n") {
                let count = buffer.withUnsafeMutableBytes { xlog_test_read(second, $0.baseAddress, Int32($0.count), 4_000) }
                guard count > 0 else { XCTFail("Missing replacement login"); return }
                input.append(contentsOf: buffer.prefix(Int(count)))
            }
            XCTAssertEqual(String(decoding: input, as: UTF8.self), "OM0RX\r\nset/skimmer\r\n")
            client.stop()
        }
        client.start()
        try await waitFor { wire.lines.contains("LOGIN") }
        client.updateOptions(reconnect: false, requestSkimmer: false)
        try await waitFor { wire.lines.contains("RETRY DISABLED") }
        XCTAssertEqual(events.phases.filter { $0 == .connected }.count, 1)
        client.updateOptions(reconnect: true, requestSkimmer: true)
        await fulfillment(of: [complete], timeout: 6)
        XCTAssertEqual(events.phases.filter { $0 == .connected }.count, 2)
    }

    func testIPv4LoginFramingCommandRedactionAndRemoteClose() async throws {
        let listener = try LoopbackListener()
        let accepted = expectation(description: "fixture completed")
        let wire = WireEvidence(), events = WireEvidence()
        let client = ClusterPortableConnection(server: .init(name: "Fixture", host: "127.0.0.1", port: Int(listener.port), callsign: "om0rx"),
            password: "test-only-password", reconnect: false, requestSkimmer: true,
            onState: { phase, _ in events.phase(phase) }, onLine: { events.line($0) })
        defer { client.stop() }
        DispatchQueue.global().async {
            defer { accepted.fulfill() }
            guard let peer = xlog_test_accept(listener.pointer, 4_000) else { XCTFail("No connection"); return }
            defer { xlog_test_close(peer) }
            var input = Data(), buffer = [UInt8](repeating: 0, count: 4096)
            while !String(decoding: input, as: UTF8.self).contains("SH/DX\r\n") {
                let count = buffer.withUnsafeMutableBytes { xlog_test_read(peer, $0.baseAddress, Int32($0.count), 4_000) }
                guard count > 0 else { XCTFail("Incomplete login/command"); return }
                input.append(contentsOf: buffer.prefix(Int(count)))
            }
            wire.line(String(decoding: input, as: UTF8.self))
            for part in [Data([255, 251]), Data([1] + Array("DX de K1: 14025.0 K1ABC CW\r\n".utf8)),
                         Data("echo test-only-password\n".utf8)] {
                let count = part.withUnsafeBytes { xlog_test_write(peer, $0.baseAddress, Int32($0.count)) }
                XCTAssertEqual(count, Int32(part.count))
            }
        }
        client.start()
        try await waitFor { events.phases.contains(.connected) }
        client.send("SH/DX")
        await fulfillment(of: [accepted], timeout: 6)
        try await waitFor { events.phases.contains(.failed) }
        XCTAssertEqual(wire.lines, ["OM0RX\r\ntest-only-password\r\nset/skimmer\r\nSH/DX\r\n"])
        XCTAssertEqual(events.lines, ["DX de K1: 14025.0 K1ABC CW", "echo [redacted]"])
        XCTAssertEqual(events.phases, [.connecting, .connected, .failed])
    }

    func testIPv6ConnectAndStopBeforeLoginSendsNothing() async throws {
        let listener = try LoopbackListener(ipv6: true)
        let accepted = expectation(description: "peer sees EOF")
        let events = WireEvidence()
        let client = ClusterPortableConnection(server: .init(name: "Fixture", host: "::1", port: Int(listener.port), callsign: "OM0RX"),
            password: "", reconnect: true, requestSkimmer: false,
            onState: { phase, _ in events.phase(phase) }, onLine: { events.line($0) })
        defer { client.stop() }
        DispatchQueue.global().async {
            defer { accepted.fulfill() }
            guard let peer = xlog_test_accept(listener.pointer, 4_000) else { XCTFail("No IPv6 connection"); return }
            defer { xlog_test_close(peer) }
            var buffer = [UInt8](repeating: 0, count: 100)
            let count = buffer.withUnsafeMutableBytes { xlog_test_read(peer, $0.baseAddress, Int32($0.count), 2_000) }
            XCTAssertEqual(count, 0)
        }
        client.start()
        try await waitFor { events.phases.contains(.connected) }
        client.stop()
        await fulfillment(of: [accepted], timeout: 5)
        try await Task.sleep(for: .milliseconds(100))
        XCTAssertEqual(events.phases, [.connecting, .connected])
        XCTAssertTrue(events.lines.isEmpty)
    }

    func testCancelledConnectAndReadDeadline() throws {
        let cancellation = try XCTUnwrap(xlog_socket_cancellation_create())
        defer { xlog_socket_cancellation_destroy(cancellation) }
        xlog_socket_cancel(cancellation)
        XCTAssertNil("127.0.0.1".withCString { xlog_socket_connect($0, 1, 100, cancellation) })
        let listener = try LoopbackListener()
        let socket = try XCTUnwrap("127.0.0.1".withCString { xlog_socket_connect($0, listener.port, 1000, nil) })
        defer { xlog_socket_close(socket) }
        let peer = try XCTUnwrap(xlog_test_accept(listener.pointer, 1000))
        defer { xlog_test_close(peer) }
        var buffer = [UInt8](repeating: 0, count: 32)
        let start = Date()
        XCTAssertEqual(buffer.withUnsafeMutableBytes { xlog_socket_read(socket, $0.baseAddress, 32, 50) }, -2)
        XCTAssertLessThan(Date().timeIntervalSince(start), 1)
    }

    func testReconnectLogsInAgainWithoutReplayingDisconnectedCommands() async throws {
        let listener = try LoopbackListener()
        let complete = expectation(description: "two bounded sessions")
        let wire = WireEvidence(), events = WireEvidence()
        let client = ClusterPortableConnection(server: .init(name: "Fixture", host: "127.0.0.1", port: Int(listener.port), callsign: "OM0RX"),
            password: "", reconnect: true, requestSkimmer: false,
            onState: { phase, _ in events.phase(phase) }, onLine: { events.line($0) })
        defer { client.stop() }
        DispatchQueue.global().async {
            defer { complete.fulfill() }
            for attempt in 0..<2 {
                guard let peer = xlog_test_accept(listener.pointer, 5_000) else { XCTFail("Missing reconnect"); return }
                defer { xlog_test_close(peer) }
                var input = Data(), buffer = [UInt8](repeating: 0, count: 4096)
                while !String(decoding: input, as: UTF8.self).contains("unset/skimmer\r\n") {
                    let count = buffer.withUnsafeMutableBytes { xlog_test_read(peer, $0.baseAddress, Int32($0.count), 4_000) }
                    guard count > 0, input.count + Int(count) <= 4096 else { XCTFail("Bad fixture login"); return }
                    input.append(contentsOf: buffer.prefix(Int(count)))
                }
                wire.line(String(decoding: input, as: UTF8.self))
                if attempt == 1 {
                    let message = Data("SECOND SESSION\r\n".utf8)
                    _ = message.withUnsafeBytes { xlog_test_write(peer, $0.baseAddress, Int32($0.count)) }
                    let count = buffer.withUnsafeMutableBytes { xlog_test_read(peer, $0.baseAddress, Int32($0.count), 4_000) }
                    XCTAssertEqual(count, 0, "Stop must close the new connection without replaying old commands")
                }
            }
        }
        client.start()
        try await waitFor { events.phases.contains(.failed) }
        client.send("MUST NOT REPLAY")
        try await waitFor { events.lines.contains("SECOND SESSION") }
        client.stop()
        await fulfillment(of: [complete], timeout: 6)
        XCTAssertEqual(wire.lines, Array(repeating: "OM0RX\r\nunset/skimmer\r\n", count: 2))
        XCTAssertEqual(events.phases, [.connecting, .connected, .failed, .connecting, .connected])
    }

    func testStopCancelsScheduledReconnect() async throws {
        let listener = try LoopbackListener()
        let complete = expectation(description: "no reconnect after stop")
        let events = WireEvidence()
        let client = ClusterPortableConnection(server: .init(name: "Fixture", host: "127.0.0.1", port: Int(listener.port), callsign: "OM0RX"),
            password: "", reconnect: true, requestSkimmer: false,
            onState: { phase, _ in events.phase(phase) }, onLine: { events.line($0) })
        defer { client.stop() }
        DispatchQueue.global().async {
            defer { complete.fulfill() }
            guard let peer = xlog_test_accept(listener.pointer, 4_000) else { XCTFail("No connection"); return }
            xlog_test_close(peer)
            let unexpected = xlog_test_accept(listener.pointer, 3_000)
            if let unexpected { xlog_test_close(unexpected); XCTFail("Stopped client reconnected") }
        }
        client.start()
        try await waitFor { events.phases.contains(.failed) }
        client.stop()
        await fulfillment(of: [complete], timeout: 5)
        XCTAssertEqual(events.phases, [.connecting, .connected, .failed])
    }

    func testControlCharactersInHostAreRejectedBeforeTransportCreation() async throws {
        for host in ["localhost\0.invalid", "localhost\u{7f}", "localhost\n"] {
            let service = ClusterSessionService(configuration: .init(servers: [
                .init(name: "Fixture", host: host, port: 7300, callsign: "OM0RX")
            ]), transportFactory: { _, _, _, _, _, _ in
                XCTFail("Invalid host reached transport")
                fatalError("Invalid host must never construct a transport")
            })
            do { try await service.connect(); XCTFail("Control character accepted") } catch { }
        }
    }
}

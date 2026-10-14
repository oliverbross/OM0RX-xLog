#if os(macOS)
import Darwin
import Foundation
import XCTest
import XCatIntegrationCore
@testable import XLogPrototypeSupport

final class EmbeddedCATServersTests: XCTestCase {
    func testWhitespaceOnlyKYClearsCWInsteadOfBecomingAQuery() async throws {
        let radio = SimulatedRadio()
        let processor = CATCommandProcessor(radio: radio, allowTransmit: true)
        let sent = await processor.handle("KY TEST")
        XCTAssertNil(sent)
        let queued = await radio.queuedCW()
        XCTAssertEqual(queued, "TEST")
        let cleared = await processor.handle("KY                        ")
        XCTAssertNil(cleared)
        let empty = await radio.queuedCW()
        XCTAssertEqual(empty, "")
    }

    func testDisabledDefaultAndDuplicatePortValidation() throws {
        let radio = SimulatedRadio()
        let disabled = EmbeddedCATServers(
            radio: radio, configuration: .init(), authorizeMutation: { _ in true }
        )
        XCTAssertNoThrow(try disabled.start())
        disabled.stop()

        let duplicate = EmbeddedCATServers(
            radio: radio,
            configuration: .init(catPort: 14_532, rigCtlPort: 14_532),
            authorizeMutation: { _ in true }
        )
        XCTAssertThrowsError(try duplicate.start()) { error in
            XCTAssertEqual(error as? EmbeddedCATServers.StartError, .duplicatePort(14_532))
        }
        let zero = EmbeddedCATServers(
            radio: radio, configuration: .init(catPort: 0), authorizeMutation: { _ in true }
        )
        XCTAssertThrowsError(try zero.start()) { error in
            XCTAssertEqual(error as? EmbeddedCATServers.StartError, .invalidPort)
        }
    }

    func testOccupiedLoopbackPortIsRejectedWithoutTakeover() throws {
        let lease = try LoopbackSocket.reserve()
        let server = EmbeddedCATServers(
            radio: SimulatedRadio(),
            configuration: .init(catPort: lease.port),
            authorizeMutation: { _ in true }
        )
        XCTAssertThrowsError(try server.start()) { error in
            XCTAssertEqual(error as? EmbeddedCATServers.StartError, .portUnavailable(lease.port))
        }
    }

    func testSecondEmbeddedListenerCannotTakeOverActivePort() throws {
        let first = EmbeddedCATServers(
            radio: SimulatedRadio(), configuration: .init(catPort: 0),
            authorizeMutation: { _ in true }, allowEphemeralPorts: true
        )
        try first.start()
        defer { first.stop() }
        let port = try XCTUnwrap(first.boundCATPort)
        XCTAssertNotEqual(port, 0)
        let second = EmbeddedCATServers(
            radio: SimulatedRadio(), configuration: .init(rigCtlPort: port),
            authorizeMutation: { _ in true }
        )
        XCTAssertThrowsError(try second.start()) { error in
            XCTAssertEqual(error as? EmbeddedCATServers.StartError, .portUnavailable(port))
        }
        let firstClient = try LoopbackSocket.connect(port: port)
        defer { firstClient.close() }
        XCTAssertEqual(try firstClient.exchange("ID;"), "ID019;")
    }

    func testCATAndRigCtlReadbackAndMutationGate() async throws {
        let radio = SimulatedRadio(snapshot: RadioSnapshot(frequencyHz: 14_074_000))
        let ledger = MutationLedger()
        let servers = EmbeddedCATServers(
            radio: radio,
            configuration: .init(catPort: 0, rigCtlPort: 0),
            authorizeMutation: { mutation in await ledger.authorize(mutation) },
            didCompleteMutation: { mutation in await ledger.complete(mutation) },
            allowEphemeralPorts: true
        )
        try servers.start()
        defer { servers.stop() }

        let catPort = try XCTUnwrap(servers.boundCATPort)
        let rigPort = try XCTUnwrap(servers.boundRigCtlPort)
        XCTAssertNotEqual(catPort, rigPort)
        XCTAssertNotEqual(catPort, 0)
        XCTAssertNotEqual(rigPort, 0)

        let cat = try LoopbackSocket.connect(port: catPort)
        defer { cat.close() }
        let rig = try LoopbackSocket.connect(port: rigPort)
        defer { rig.close() }
        XCTAssertEqual(try cat.exchange("FA;"), "FA00014074000;")
        XCTAssertEqual(try rig.exchange("f\n"), "14074000\n")

        await ledger.denyWrites()
        XCTAssertEqual(try cat.exchange("FA00014500000;"), "?;")
        XCTAssertEqual(try rig.exchange("F 14500000\n"), "RPRT -1\n")
        let deniedFrequency = await radio.snapshot().frequencyHz
        let deniedCompletions = await ledger.completionCount()
        XCTAssertEqual(deniedFrequency, 14_074_000)
        XCTAssertEqual(deniedCompletions, 0)

        await ledger.allowWrites()
        XCTAssertEqual(try rig.exchange("F 14500000\n"), "RPRT 0\n")
        XCTAssertEqual(try cat.exchange("FA;"), "FA00014500000;")
        let allowedCompletions = await ledger.completionCount()
        XCTAssertEqual(allowedCompletions, 1)
    }

    func testCATReadbackCanUseAuthoritativeObservedSnapshot() throws {
        let radio = SimulatedRadio(snapshot: RadioSnapshot(frequencyHz: 14_074_000))
        let server = EmbeddedCATServers(
            radio: radio,
            configuration: .init(catPort: 0),
            observedSnapshot: { RadioSnapshot(frequencyHz: 7_074_000) },
            authorizeMutation: { _ in true }, allowEphemeralPorts: true
        )
        try server.start()
        defer { server.stop() }
        let port = try XCTUnwrap(server.boundCATPort)
        let client = try LoopbackSocket.connect(port: port)
        defer { client.close() }
        XCTAssertEqual(try client.exchange("FA;"), "FA00007074000;")
    }

    func testTransmitRequiresOptInAndOwnedClientDisconnectReleases() async throws {
        let radio = SimulatedRadio()
        let ledger = MutationLedger()
        let denied = EmbeddedCATServers(
            radio: radio,
            configuration: .init(catPort: 0),
            authorizeMutation: { mutation in await ledger.authorize(mutation) },
            allowEphemeralPorts: true
        )
        try denied.start()
        defer { denied.stop() }
        let deniedPort = try XCTUnwrap(denied.boundCATPort)
        let readOnly = try LoopbackSocket.connect(port: deniedPort)
        XCTAssertEqual(try readOnly.exchange("TX;"), "?;")
        readOnly.close()
        denied.stop()
        let deniedTransmit = await radio.snapshot().isTransmitting
        let deniedAuthorizations = await ledger.authorizationCount()
        XCTAssertFalse(deniedTransmit)
        XCTAssertEqual(deniedAuthorizations, 0)

        let enabled = EmbeddedCATServers(
            radio: radio,
            configuration: .init(catPort: 0, allowTransmit: true),
            authorizeMutation: { mutation in await ledger.authorize(mutation) },
            didCompleteMutation: { mutation in await ledger.complete(mutation) },
            allowEphemeralPorts: true
        )
        try enabled.start()
        defer { enabled.stop() }
        let enabledPort = try XCTUnwrap(enabled.boundCATPort)
        let owner = try LoopbackSocket.connect(port: enabledPort)
        owner.write("TX;")
        try await waitUntil { (await radio.snapshot()).isTransmitting }
        owner.close()
        try await waitUntil { !(await radio.snapshot()).isTransmitting }
        let releaseAuthorizations = await ledger.authorizationCount()
        XCTAssertGreaterThanOrEqual(releaseAuthorizations, 3)
        let cancelWasRequested = await ledger.cancelWasRequested()
        XCTAssertTrue(cancelWasRequested)
    }

    private func waitUntil(_ condition: @escaping () async -> Bool) async throws {
        for _ in 0..<80 {
            if await condition() { return }
            try await Task.sleep(nanoseconds: 25_000_000)
        }
        XCTFail("Timed out waiting for loopback server state")
    }
}

private actor MutationLedger {
    private var permitsWrites = true
    private var authorizations = 0
    private var completions = 0
    private var sawCancel = false

    func denyWrites() { permitsWrites = false }
    func allowWrites() { permitsWrites = true }
    func authorize(_ mutation: EmbeddedCATServers.Mutation) -> Bool {
        authorizations += 1
        if case .stationAction(.cancel) = mutation { sawCancel = true }
        return permitsWrites
    }
    func complete(_ mutation: EmbeddedCATServers.Mutation) { completions += 1 }
    func authorizationCount() -> Int { authorizations }
    func completionCount() -> Int { completions }
    func cancelWasRequested() -> Bool { sawCancel }
}

private final class LoopbackSocket {
    private(set) var descriptor: Int32
    let port: UInt16

    private init(descriptor: Int32, port: UInt16) {
        self.descriptor = descriptor
        self.port = port
    }

    deinit { close() }

    func close() {
        guard descriptor >= 0 else { return }
        _ = Darwin.shutdown(descriptor, SHUT_RDWR)
        _ = Darwin.close(descriptor)
        descriptor = -1
    }

    static func reserve() throws -> LoopbackSocket {
        let descriptor = socket(AF_INET, SOCK_STREAM, 0)
        guard descriptor >= 0 else { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
        var address = loopbackAddress(port: 0)
        let didBind = withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.bind(descriptor, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) == 0
            }
        }
        guard didBind else {
            let failure = NSError(domain: NSPOSIXErrorDomain, code: Int(errno))
            Darwin.close(descriptor)
            throw failure
        }
        var length = socklen_t(MemoryLayout<sockaddr_in>.size)
        let didRead = withUnsafeMutablePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                getsockname(descriptor, $0, &length) == 0
            }
        }
        guard didRead else {
            Darwin.close(descriptor)
            throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno))
        }
        return LoopbackSocket(descriptor: descriptor, port: UInt16(bigEndian: address.sin_port))
    }

    static func connect(port: UInt16) throws -> LoopbackSocket {
        let descriptor = socket(AF_INET, SOCK_STREAM, 0)
        guard descriptor >= 0 else { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
        var timeout = timeval(tv_sec: 1, tv_usec: 0)
        _ = setsockopt(descriptor, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))
        var address = loopbackAddress(port: port)
        let connected = withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.connect(descriptor, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) == 0
            }
        }
        guard connected else {
            let failure = NSError(domain: NSPOSIXErrorDomain, code: Int(errno))
            Darwin.close(descriptor)
            throw failure
        }
        return LoopbackSocket(descriptor: descriptor, port: port)
    }

    func write(_ text: String) {
        let bytes = Array(text.utf8)
        _ = bytes.withUnsafeBytes { Darwin.send(descriptor, $0.baseAddress, bytes.count, 0) }
    }

    func exchange(_ text: String) throws -> String {
        write(text)
        var bytes = [UInt8](repeating: 0, count: 1_024)
        let count = Darwin.recv(descriptor, &bytes, bytes.count, 0)
        guard count > 0 else { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
        return String(decoding: bytes[..<count], as: UTF8.self)
    }

    private static func loopbackAddress(port: UInt16) -> sockaddr_in {
        var address = sockaddr_in()
        address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        address.sin_family = sa_family_t(AF_INET)
        address.sin_port = in_port_t(port).bigEndian
        address.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))
        return address
    }
}
#endif

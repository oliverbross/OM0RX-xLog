#if os(macOS)
import Foundation
import XCTest
import XCatIntegrationCore
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif
@testable import XLogPrototypeSupport

/// Every request is intercepted; the production client still signs, encodes,
/// validates and decodes the actual Agent protocol.
private final class AgentLifecycleScript: @unchecked Sendable {
    struct Packet {
        let host: String
        let authorization: String?
        let command: String
        let arguments: [String: Any]
        let timeout: TimeInterval
        let radioObservedAt: Date
        let meterObservedAt: Date
    }
    private let lock = NSLock()
    private var packets: [Packet] = []
    private var failures = Set<String>()
    private var transmitting = false
    private var revision = 0
    private var holdState = false
    private var held: (() -> Void)?
    private var requestedState = false
    private var holdNextCommand = false
    private var heldCommand: (() -> Void)?
    private var meterAge: TimeInterval = 0
    private var nextObservation: Date?

    var sent: [Packet] { lock.withLock { packets } }
    var stateRequested: Bool { lock.withLock { requestedState } }
    var commandHeld: Bool { lock.withLock { heldCommand != nil } }
    func staleMeter(_ stale: Bool) { lock.withLock { meterAge = stale ? 10 : 0 } }
    func observeNext(at date: Date) { lock.withLock { nextObservation = date } }
    static func radioTimestamp(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }
    static func radioObservation(_ date: Date) -> Date {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: radioTimestamp(date))!
    }
    func pauseNextCommand() { lock.withLock { holdNextCommand = true } }
    func delayCommand(_ callback: @escaping () -> Void) -> Bool {
        lock.withLock {
            guard holdNextCommand else { return false }
            holdNextCommand = false; heldCommand = callback; return true
        }
    }
    func releaseCommand() {
        let callback = lock.withLock { () -> (() -> Void)? in defer { heldCommand = nil }; return heldCommand }
        callback?()
    }
    func fail(_ command: String?) { lock.withLock { failures = command.map { [$0] } ?? [] } }
    func pauseState() { lock.withLock { holdState = true } }
    func releaseState() {
        let callback = lock.withLock { () -> (() -> Void)? in
            holdState = false; defer { held = nil }; return held
        }
        callback?()
    }
    func delayState(_ callback: @escaping () -> Void) -> Bool {
        lock.withLock {
            requestedState = true
            guard holdState else { return false }
            held = callback; return true
        }
    }
    func response(_ request: URLRequest) throws -> Data {
        let envelope: [String: Any] = try lock.withLock {
            revision += 1
            let now = (nextObservation ?? Date()).addingTimeInterval(-meterAge)
            nextObservation = nil
            if request.httpMethod == "POST" {
                let body = try Self.body(request)
                let object = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
                let command = try XCTUnwrap(object["command"] as? String)
                let arguments = object["arguments"] as? [String: Any] ?? [:]
                packets.append(Packet(host: request.url?.host ?? "", authorization: request.value(forHTTPHeaderField: "Authorization"),
                    command: command, arguments: arguments, timeout: request.timeoutInterval,
                    radioObservedAt: Self.radioObservation(now), meterObservedAt: now))
                if failures.contains(command) { return ["success": false, "error": ["code": "fixture-release-failed", "message": "Injected release rejection"]] }
                if command == "send_cw" || command == "station_tune" { transmitting = true }
                if command == "set_ptt" { transmitting = arguments["enabled"] as? Bool ?? false }
                if command == "station_cancel" || command == "clear_cw" { transmitting = false }
                // A harmless control reply supplies actual, authoritative meter
                // evidence for an externally transmitting monitored station.
                if command == "set_cw_speed" { transmitting = true }
            }
            return ["success": true, "state": ["protocol_version": 1, "revision": revision,
                "capabilities": ["commands": ["send_cw", "clear_cw", "set_ptt", "station_tune", "station_cancel", "set_cw_speed"]],
                "station": ["commissioned": true, "coordinator_state": "safe_rx", "allowed_actions": ["tune", "cancel"]],
                "radio": ["connected": true, "known": true, "stale": false, "station_bound": true,
                    "mox": transmitting, "frequency_hz": 14_025_000, "mode": "CW", "observed_at": Self.radioTimestamp(now)],
                "elecraft": ["kpa500": ["enabled": true, "connected": true, "operate": true, "quality": "good", "fault": "00",
                    "output_power_w": 450, "observed_at": now.timeIntervalSince1970,
                    "meter_observed_at": now.timeIntervalSince1970, "meter_sample_observed_at": now.timeIntervalSince1970,
                    "meter_complete": true, "meter_error": NSNull()]]]]
        }
        return try JSONSerialization.data(withJSONObject: envelope)
    }
    private static func body(_ request: URLRequest) throws -> Data {
        if let data = request.httpBody { return data }
        let stream = try XCTUnwrap(request.httpBodyStream)
        stream.open(); defer { stream.close() }
        var data = Data(), buffer = [UInt8](repeating: 0, count: 4096)
        while true {
            let count = stream.read(&buffer, maxLength: buffer.count)
            if count < 0 { throw URLError(.cannotDecodeContentData) }
            if count == 0 { return data }
            data.append(buffer, count: count)
        }
    }
}

private final class AgentLifecycleProtocol: URLProtocol {
    private static let lock = NSLock()
    private static var scripts: [String: AgentLifecycleScript] = [:]
    static func install(_ script: AgentLifecycleScript, host: String) { lock.withLock { scripts[host] = script } }
    static func remove(_ host: String) { _ = lock.withLock { scripts.removeValue(forKey: host) } }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard let script = Self.lock.withLock({ Self.scripts[request.url?.host ?? ""] }) else {
            client?.urlProtocol(self, didFailWithError: URLError(.unsupportedURL)); return
        }
        if request.httpMethod == "GET", script.delayState({ [self] in deliver(script) }) { return }
        if request.httpMethod == "POST", script.delayCommand({ [self] in deliver(script) }) { return }
        deliver(script)
    }
    private func deliver(_ script: AgentLifecycleScript) {
        do {
            let data = try script.response(request)
            let response = try XCTUnwrap(HTTPURLResponse(url: XCTUnwrap(request.url), statusCode: 200, httpVersion: "HTTP/1.1", headerFields: nil))
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}

final class DirectAgentLifecycleTests: XCTestCase {
    private final class Readings: @unchecked Sendable {
        private let lock = NSLock()
        private var values: [NativeDraftPowerGate.Reading] = []
        func append(_ value: NativeDraftPowerGate.Reading) { lock.withLock { values.append(value) } }
        var samples: [OperatorDraftPowerSample] { lock.withLock { values.map(\.sample) } }
    }
    private struct Fixture {
        let registry: StationRadioRegistry
        let scripts: [String: AgentLifecycleScript]
        let sessions: [URLSession]
        let hosts: [String]
        func close() { sessions.forEach { $0.invalidateAndCancel() }; hosts.forEach(AgentLifecycleProtocol.remove) }
    }
    private func fixture() -> Fixture {
        var agents: [String: LiveStationSession] = [:], scripts: [String: AgentLifecycleScript] = [:]
        var sessions: [URLSession] = [], hosts: [String] = []
        for radio in ["radio1", "radio2"] {
            let host = "\(radio)-\(UUID().uuidString.lowercased()).invalid", script = AgentLifecycleScript()
            let configuration = URLSessionConfiguration.ephemeral; configuration.protocolClasses = [AgentLifecycleProtocol.self]
            let session = URLSession(configuration: configuration)
            AgentLifecycleProtocol.install(script, host: host)
            var credentials = StationAgentCredentialCache(); credentials.remember("fixture-\(radio)", endpoint: "https://\(host)")
            agents[radio] = LiveStationSession(radioID: radio, credentialCache: credentials) { endpoint, token, state, observed in
                try RemoteAgentClient(baseURL: endpoint, token: token, session: session, onState: state,
                    onObservedSnapshot: observed, enableStream: false)
            }
            scripts[radio] = script; sessions.append(session); hosts.append(host)
        }
        return Fixture(registry: StationRadioRegistry(agents: agents), scripts: scripts, sessions: sessions, hosts: hosts)
    }
    private func connect(_ fixture: Fixture, radio: String, transmit: Bool = true) async throws {
        let index = radio == "radio1" ? 0 : 1
        _ = try await LiveStationMethods.handle("station_connect", params: ["provider": "direct_agent", "radio_id": radio,
            "base_url": "https://\(fixture.hosts[index])", "allow_transmit": transmit], registry: fixture.registry)
        try await ready(fixture.registry.agents[radio]!)
    }
    private func ready(_ owner: LiveStationSession) async throws {
        for _ in 0..<1000 {
            let state = await owner.snapshot()
            if state["transport_state"] as? String == "ready" { return }
            try await Task.sleep(for: .milliseconds(2))
        }
        XCTFail("Intercepted Agent did not become ready"); throw URLError(.timedOut)
    }
    private func request(_ worker: LiveWorker, _ method: String, radio: String, extra: [String: Any] = [:]) async throws -> [String: Any] {
        var params: [String: Any] = ["provider": "direct_agent", "radio_id": radio]
        params.merge(extra) { _, value in value }
        let data = try JSONSerialization.data(withJSONObject: ["id": UUID().uuidString, "method": method, "params": params])
        let reply = await worker.response(to: data)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: reply) as? [String: Any])
    }
    private func releaseFailure(_ acquisition: String, failedCommand: String, radio: String) async throws {
        let fixture = fixture(); defer { fixture.close() }
        try await connect(fixture, radio: radio)
        let other = radio == "radio1" ? "radio2" : "radio1"
        try await connect(fixture, radio: other, transmit: false)
        let script = try XCTUnwrap(fixture.scripts[radio]), owner = try XCTUnwrap(fixture.registry.agents[radio])
        if acquisition == "tune" { _ = try await owner.action("tune") }
        else { _ = try await owner.handle("station_radio_control", params: ["provider": "direct_agent", "control": acquisition,
            "enabled": true, "text": "TEST"]) }
        script.fail(failedCommand)
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("agent-retirement-\(UUID())")
        defer { try? FileManager.default.removeItem(at: root) }
        let worker = LiveWorker(logbook: LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false), stationRegistry: fixture.registry)
        let outcome = await worker.shutdownOutcome()
        XCTAssertEqual(outcome, .stationRetirementUnconfirmed)
        XCTAssertFalse(outcome.permitsRestart)
        let state = await owner.snapshot()
        XCTAssertFalse(state["radio"] is NSNull, "Original Agent client must remain available for release-only retry")
        let retirement = await fixture.registry.terminate()
        XCTAssertEqual(retirement.unconfirmedRadioIDs, [radio])
        XCTAssertTrue(fixture.scripts[other]!.sent.isEmpty, "Passive peer must receive no release command")
        XCTAssertTrue(script.sent.contains { $0.command == failedCommand && $0.timeout == 1.5 })
        let acquire = try await request(worker, "station_action", radio: radio, extra: ["action": "tune"])
        XCTAssertEqual((acquire["error"] as? [String: Any])?["code"] as? String, "worker_stopping")
        let uncertain = try await request(worker, "station_disconnect", radio: radio)
        XCTAssertEqual((uncertain["error"] as? [String: Any])?["code"] as? String, "release_unconfirmed")
        script.fail(nil)
        let recovered = try await request(worker, "station_disconnect", radio: radio)
        XCTAssertEqual(recovered["ok"] as? Bool, true)
        XCTAssertTrue(script.sent.allSatisfy { $0.host == fixture.hosts[radio == "radio1" ? 0 : 1] && $0.authorization == "Bearer fixture-\(radio)" })
        let repeated = await worker.shutdownOutcome()
        XCTAssertEqual(repeated, .clean)
    }
    func testCWReleaseFailureReachesRegistryAndWorker() async throws { try await releaseFailure("send_cw", failedCommand: "clear_cw", radio: "radio1") }
    func testTuneReleaseFailureReachesRegistryAndWorker() async throws { try await releaseFailure("tune", failedCommand: "station_cancel", radio: "radio2") }
    func testPTTReleaseFailureReachesRegistryAndWorker() async throws { try await releaseFailure("ptt", failedCommand: "set_ptt", radio: "radio1") }

    func testConnectBeforeCaptureInstallAttachesBothLiveClientsAndReconnects() async throws {
        let fixture = fixture(); defer { fixture.close() }
        for radio in ["radio1", "radio2"] { try await connect(fixture, radio: radio, transmit: false) }
        let gate = NativeDraftPowerGate()
        await fixture.registry.installPowerCapture(gate)
        for (index, radio) in ["radio1", "radio2"].enumerated() {
            gate.select(provider: "direct_agent", selectionID: UUID().uuidString, radioID: radio)
            gate.activate(radioID: radio, generation: UInt64(index + 1))
            let initial = try XCTUnwrap(gate.state().context, "Late installation must attach the established source")
            _ = try await fixture.registry.agents[radio]!.handle("station_reconnect", params: ["provider": "direct_agent"])
            try await ready(fixture.registry.agents[radio]!)
            let reconnected = try XCTUnwrap(gate.state().context)
            XCTAssertNotEqual(reconnected.sessionID, initial.sessionID)
        }
        _ = await fixture.registry.terminate()
    }

    func testCaptureInstallDuringInitialFetchAttachesWithoutInventingReady() async throws {
        let fixture = fixture(); defer { fixture.close() }
        for (index, radio) in ["radio1", "radio2"].enumerated() {
            let script = fixture.scripts[radio]!; script.pauseState()
            _ = try await LiveStationMethods.handle("station_connect", params: ["provider": "direct_agent", "radio_id": radio,
                "base_url": "https://\(fixture.hosts[index])"], registry: fixture.registry)
            for _ in 0..<1000 { if script.stateRequested { break }; try await Task.sleep(for: .milliseconds(2)) }
            XCTAssertTrue(script.stateRequested)
            let gate = NativeDraftPowerGate()
            gate.select(provider: "direct_agent", selectionID: UUID().uuidString, radioID: radio)
            gate.activate(radioID: radio, generation: 1)
            await fixture.registry.agents[radio]!.installPowerCapture(gate)
            XCTAssertNil(gate.state().context, "Pending GET is not ready telemetry")
            script.releaseState()
            try await ready(fixture.registry.agents[radio]!)
            XCTAssertNotNil(gate.state().context, "The same initial connection must become capturable")
        }
        _ = await fixture.registry.terminate()
    }

    @discardableResult private func arm(_ gate: NativeDraftPowerGate) throws -> Date {
        let state = gate.state(), context = try XCTUnwrap(state.context)
        let workspace = UUID()
        var qso = QSO(call: "K1ABC", band: "20m", mode: "CW"); qso.frequencyHz = 14_025_000; qso.txPower = "100"
        var power = try OperatorDraftPowerState(qso: qso, workspaceID: workspace)
        try power.configure(enabled: true, fallback: "100")
        try power.arm(context: context, qso: qso, workspaceID: workspace, now: Date())
        gate.arm(OperatorDraftSnapshot(revision: 0, qso: qso, power: power), workspaceID: workspace, state: state)
        return try XCTUnwrap(power.activeScope).armedAt
    }
    private func advanceFixtureClock(after fence: Date) async throws {
        // The fake wire uses millisecond ISO timestamps. Wait for an actual
        // representable observation after the precise arm fence, rather
        // than accidentally backdating a fast reply into the prior scope.
        let deadline = ContinuousClock.now.advanced(by: .milliseconds(1_500))
        while AgentLifecycleScript.radioObservation(Date()) <= fence {
            guard ContinuousClock.now < deadline else { XCTFail("Fixture clock did not cross the arm fence"); throw URLError(.timedOut) }
            await Task.yield()
        }
    }
    private func meterPacket(_ owner: LiveStationSession, after fence: Date? = nil) async throws {
        if let fence { try await advanceFixtureClock(after: fence) }
        _ = try await owner.handle("station_radio_control", params: ["provider": "direct_agent", "control": "set_cw_speed", "words_per_minute": 25])
    }

    func testLateInstalledRealClientCapturesMeterAndRejectsStaleAndInactivePacketsAcrossReconnects() async throws {
        let fixture = fixture(); defer { fixture.close() }
        for radio in ["radio1", "radio2"] { try await connect(fixture, radio: radio, transmit: false) }
        let gate = NativeDraftPowerGate(), readings = Readings()
        gate.install(changed: {}, received: { readings.append($0) })
        await fixture.registry.installPowerCapture(gate)
        for (index, radio) in ["radio1", "radio2"].enumerated() {
            let owner = fixture.registry.agents[radio]!, other = fixture.registry.agents[radio == "radio1" ? "radio2" : "radio1"]!
            gate.select(provider: "direct_agent", selectionID: UUID().uuidString, radioID: radio)
            gate.activate(radioID: radio, generation: UInt64(index * 2 + 1))
            let armedAt = try arm(gate)
            let before = readings.samples.count, original = try XCTUnwrap(gate.state().context)
            try await meterPacket(other)
            XCTAssertEqual(readings.samples.count, before, "Inactive real-client reply cannot reach the active lease")
            fixture.scripts[radio]!.staleMeter(true)
            try await meterPacket(owner, after: armedAt)
            XCTAssertEqual(readings.samples.count, before, "Stale authoritative packet cannot renew meter eligibility")
            fixture.scripts[radio]!.staleMeter(false)
            try await meterPacket(owner, after: armedAt)
            XCTAssertEqual(readings.samples.count, before + 1)
            XCTAssertEqual(readings.samples.last?.watts, 450)
            XCTAssertEqual(readings.samples.last?.sessionID, original.sessionID)
            _ = try await owner.handle("station_reconnect", params: ["provider": "direct_agent"])
            try await ready(owner)
            let reconnected = try XCTUnwrap(gate.state().context)
            XCTAssertNotEqual(original.sessionID, reconnected.sessionID)
            try await meterPacket(owner)
            XCTAssertEqual(readings.samples.count, before + 1, "Reconnect invalidates the old lease")
            let reconnectArm = try arm(gate)
            try await meterPacket(owner, after: reconnectArm)
            XCTAssertEqual(readings.samples.last?.sessionID, reconnected.sessionID)
            let captured = readings.samples.count
            // An ordinary new connection must attach a new source to this gate,
            // while preserving the active radio's authority and metadata.
            try await connect(fixture, radio: radio, transmit: false)
            let replacement = try XCTUnwrap(gate.state().context)
            XCTAssertNotEqual(reconnected.sessionID, replacement.sessionID)
            try await meterPacket(owner)
            XCTAssertEqual(readings.samples.count, captured)
            let replacementArm = try arm(gate)
            try await meterPacket(owner, after: replacementArm)
            let packet = try XCTUnwrap(fixture.scripts[radio]!.sent.last)
            XCTAssertGreaterThan(packet.radioObservedAt, replacementArm)
            XCTAssertEqual(readings.samples.count, captured + 1,
                "radio=\(radio) arm=\(replacementArm.timeIntervalSince1970) wire=\(packet.radioObservedAt.timeIntervalSince1970) meter=\(packet.meterObservedAt.timeIntervalSince1970)")
            XCTAssertEqual(readings.samples.last?.sessionID, replacement.sessionID)
        }
        _ = await fixture.registry.terminate()
    }

    func testMeterPacketRoundedBeforeArmIsRejectedThenLaterPacketCaptures() async throws {
        let fixture = fixture(); defer { fixture.close() }
        try await connect(fixture, radio: "radio1", transmit: false)
        let owner = fixture.registry.agents["radio1"]!, script = fixture.scripts["radio1"]!
        let gate = NativeDraftPowerGate(), readings = Readings()
        gate.install(changed: {}, received: { readings.append($0) })
        gate.select(provider: "direct_agent", selectionID: UUID().uuidString)
        gate.activate(radioID: "radio1", generation: 1)
        await fixture.registry.installPowerCapture(gate)
        let context = try XCTUnwrap(gate.state().context)
        try await advanceFixtureClock(after: context.sessionStartedAt.addingTimeInterval(0.001))
        let armedAt = try arm(gate)
        // Make the boundary deterministic, including the rare exactly-aligned
        // arm clock: the packet's radio observation is one wire tick earlier.
        script.observeNext(at: AgentLifecycleScript.radioObservation(armedAt).addingTimeInterval(-0.001))
        try await meterPacket(owner)
        let earlier = try XCTUnwrap(script.sent.last)
        XCTAssertGreaterThan(earlier.radioObservedAt, context.sessionStartedAt)
        XCTAssertLessThan(earlier.radioObservedAt, armedAt)
        XCTAssertTrue(readings.samples.isEmpty, "A retrospective wire timestamp must not satisfy the precise arm fence")
        try await meterPacket(owner, after: armedAt)
        let later = try XCTUnwrap(script.sent.last)
        XCTAssertGreaterThan(later.radioObservedAt, armedAt)
        XCTAssertEqual(readings.samples.count, 1)
        XCTAssertEqual(readings.samples.last?.watts, 450)
        _ = await fixture.registry.terminate()
    }

    func testLateAcquisitionCannotBeRetiredByAnEarlierReleaseAndRetryUsesOriginalSlot() async throws {
        let fixture = fixture(); defer { fixture.close() }
        try await connect(fixture, radio: "radio1")
        try await connect(fixture, radio: "radio2", transmit: false)
        let owner = fixture.registry.agents["radio1"]!, script = fixture.scripts["radio1"]!
        script.pauseNextCommand()
        let acquisition = Task {
            try await owner.handle("station_radio_control", params: ["provider": "direct_agent", "control": "send_cw", "text": "TEST"])
        }
        for _ in 0..<1000 { if script.commandHeld { break }; try await Task.sleep(for: .milliseconds(2)) }
        XCTAssertTrue(script.commandHeld)
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("agent-overlap-\(UUID())")
        defer { try? FileManager.default.removeItem(at: root) }
        let worker = LiveWorker(logbook: LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false), stationRegistry: fixture.registry)
        let failed = await worker.shutdownOutcome()
        XCTAssertEqual(failed, .stationRetirementUnconfirmed, "Successful release ACKs cannot retire an outstanding acquisition")
        XCTAssertTrue(script.sent.contains { $0.command == "clear_cw" })
        XCTAssertFalse(script.sent.contains { $0.command == "send_cw" }, "The fake server has not processed the held acquisition")
        let wrongSlot = try await request(worker, "station_disconnect", radio: "radio2")
        XCTAssertEqual((wrongSlot["error"] as? [String: Any])?["code"] as? String, "worker_stopping")
        let stillUncertain = await fixture.registry.terminate()
        XCTAssertEqual(stillUncertain.unconfirmedRadioIDs, ["radio1"])
        script.releaseCommand()
        do { _ = try await acquisition.value; XCTFail("Late acquisition reported current after retirement") }
        catch let failure as WorkerFailure { XCTAssertEqual(failure.code, "station_rejected") }
        let recovered = try await request(worker, "station_disconnect", radio: "radio1")
        XCTAssertEqual(recovered["ok"] as? Bool, true)
        let packets = script.sent
        let late = try XCTUnwrap(packets.firstIndex { $0.command == "send_cw" })
        XCTAssertTrue(packets[..<late].contains { $0.command == "clear_cw" })
        XCTAssertTrue(packets[(late + 1)...].contains { $0.command == "clear_cw" })
        XCTAssertEqual(packets.filter { $0.command == "send_cw" }.count, 1)
        XCTAssertTrue(packets.allSatisfy { $0.host == fixture.hosts[0] && $0.authorization == "Bearer fixture-radio1" })
        XCTAssertTrue(fixture.scripts["radio2"]!.sent.isEmpty)
        let clean = await worker.shutdownOutcome()
        XCTAssertEqual(clean, .clean)
    }

    func testOrdinaryUncertainDisconnectSealsReplacementUntilOriginalReleaseSucceeds() async throws {
        let fixture = fixture(); defer { fixture.close() }
        try await connect(fixture, radio: "radio2")
        let owner = fixture.registry.agents["radio2"]!, script = fixture.scripts["radio2"]!
        _ = try await owner.handle("station_radio_control", params: ["provider": "direct_agent", "control": "ptt", "enabled": true])
        script.fail("set_ptt")
        do { _ = try await owner.handle("station_disconnect", params: ["provider": "direct_agent"]); XCTFail("Failed release retired") }
        catch let failure as WorkerFailure { XCTAssertEqual(failure.code, "release_unconfirmed") }
        let before = script.sent.count
        for method in ["station_connect", "station_reconnect", "station_forget"] {
            do {
                _ = try await owner.handle(method, params: ["provider": "direct_agent", "base_url": "https://replacement.invalid", "token": "replacement"])
                XCTFail("Uncertain original client was replaced")
            } catch let failure as WorkerFailure { XCTAssertEqual(failure.code, "release_unconfirmed") }
        }
        XCTAssertEqual(script.sent.count, before)
        script.fail(nil)
        _ = try await owner.handle("station_disconnect", params: ["provider": "direct_agent"])
        try await connect(fixture, radio: "radio2", transmit: false)
        let state = await owner.snapshot()
        XCTAssertEqual(state["available"] as? Bool, true)
        _ = await fixture.registry.terminate()
    }

    func testTerminalAgentRecoveryRetainsProfileDenialAndExactReleaseAdmission() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("agent-profile-\(UUID())")
        defer { try? FileManager.default.removeItem(at: root) }
        let offline = LiveWorker(logbook: LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false),
            runtimeProfile: .contestingTest(supportRoot: root), stationRegistry: StationRadioRegistry())
        await offline.beginTerminalShutdown()
        let denied = try await request(offline, "station_disconnect", radio: "radio1")
        XCTAssertEqual((denied["error"] as? [String: Any])?["code"] as? String, "external_io_disabled")
        let worker = LiveWorker(logbook: LiveLogbookMethods(supportDirectory: root.appendingPathComponent("other"), inheritNativePreferences: false),
            stationRegistry: StationRadioRegistry())
        await worker.beginTerminalShutdown()
        let extra = try await request(worker, "station_disconnect", radio: "radio1", extra: ["token": "new"])
        XCTAssertEqual((extra["error"] as? [String: Any])?["code"] as? String, "worker_stopping")
        let invalidSlot = try await request(worker, "station_disconnect", radio: "radio3")
        XCTAssertEqual((invalidSlot["error"] as? [String: Any])?["code"] as? String, "worker_stopping")
        _ = await offline.shutdownOutcome(); _ = await worker.shutdownOutcome()
    }
}
#endif

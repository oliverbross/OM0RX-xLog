#if os(macOS)
import Foundation
import XCTest
@testable import XCatIntegrationCore

private final class ObservedCallbackRecorder: @unchecked Sendable {
    struct Event {
        let kind: String
        let snapshot: RadioSnapshot
    }
    private let lock = NSLock()
    private var stored: [Event] = []

    func append(_ kind: String, _ snapshot: RadioSnapshot) -> Bool {
        lock.withLock {
            stored.append(Event(kind: kind, snapshot: snapshot))
            return kind == "observed" && stored.filter { $0.kind == "observed" }.count == 1
        }
    }
    var events: [Event] { lock.withLock { stored } }
    var observed: [RadioSnapshot] { events.filter { $0.kind == "observed" }.map(\.snapshot) }
}

private final class ObservedCallbackScript: @unchecked Sendable {
    private let lock = NSLock()
    private var commands: [Double?]
    private var commandBodies: [[String: Any]] = []
    private var commandTimeouts: [TimeInterval] = []
    private var commandFailures: [String]
    private let commandDelay: TimeInterval
    private let commandRevision: Int
    private let onCommand: @Sendable () -> Void

    init(commands: [Double?], commandFailures: [String] = [], commandDelay: TimeInterval = 0, commandRevision: Int = 42,
         onCommand: @escaping @Sendable () -> Void = {}) {
        self.commands = commands
        self.commandFailures = commandFailures
        self.commandDelay = commandDelay
        self.commandRevision = commandRevision
        self.onCommand = onCommand
    }

    func response(for request: URLRequest) throws -> Data {
        let envelope: [String: Any]
        switch (request.httpMethod, request.url?.path) {
        case ("GET", "/api/v1/state"):
            envelope = ["success": true, "state": Self.state(watts: 10)]
        case ("POST", "/api/v1/commands"):
            let body = try Self.body(request)
            guard let object = try JSONSerialization.jsonObject(with: body) as? [String: Any] else {
                throw URLError(.cannotParseResponse)
            }
            lock.withLock {
                commandBodies.append(object)
                commandTimeouts.append(request.timeoutInterval)
            }
            onCommand()
            if commandDelay > 0 { Thread.sleep(forTimeInterval: commandDelay) }
            if let failure = lock.withLock({ commandFailures.isEmpty ? nil : commandFailures.removeFirst() }) {
                envelope = ["success": false, "error": ["code": failure, "message": "Synthetic \(failure) rejection"]]
                break
            }
            let watts = try lock.withLock { () throws -> Double? in
                guard !commands.isEmpty else { throw URLError(.badServerResponse) }
                return commands.removeFirst()
            }
            envelope = watts.map { ["success": true, "state": Self.state(watts: $0, revision: commandRevision)] }
                ?? ["success": true]
        default:
            throw URLError(.unsupportedURL)
        }
        return try JSONSerialization.data(withJSONObject: envelope)
    }

    var sentCommands: [[String: Any]] { lock.withLock { commandBodies } }
    var sentTimeouts: [TimeInterval] { lock.withLock { commandTimeouts } }

    private static func body(_ request: URLRequest) throws -> Data {
        if let body = request.httpBody { return body }
        guard let stream = request.httpBodyStream else { throw URLError(.zeroByteResource) }
        stream.open()
        defer { stream.close() }
        var result = Data(), buffer = [UInt8](repeating: 0, count: 4096)
        while true {
            let count = stream.read(&buffer, maxLength: buffer.count)
            if count < 0 { throw stream.streamError ?? URLError(.cannotDecodeContentData) }
            if count == 0 { return result }
            result.append(buffer, count: count)
        }
    }

    fileprivate static func state(watts: Double, revision: Int = 42) -> [String: Any] {
        let observed = Date().addingTimeInterval(-0.05)
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return ["protocol_version": 1, "revision": revision,
            "capabilities": ["commands": ["set_mode", "set_ptt", "set_frequency_hz", "set_frequency_mode", "tune_simplex", "station_operate", "station_standby"]],
            "radio": ["connected": true, "known": true, "stale": false, "station_bound": true,
                "mox": true, "frequency_hz": 14_025_000, "mode": "CW",
                "observed_at": formatter.string(from: observed)],
            "elecraft": ["kpa500": ["enabled": true, "connected": true, "operate": true,
                "quality": "good", "fault": "00", "output_power_w": watts,
                "observed_at": observed.timeIntervalSince1970 - 1,
                "meter_observed_at": observed.timeIntervalSince1970,
                "meter_sample_observed_at": observed.timeIntervalSince1970,
                "meter_complete": true, "meter_error": NSNull()]]]
    }
}

private final class ObservedCallbackProtocol: URLProtocol {
    private static let lock = NSLock()
    private static var scripts: [String: ObservedCallbackScript] = [:]

    static func install(_ script: ObservedCallbackScript, host: String) {
        lock.withLock { scripts[host] = script }
    }
    static func remove(host: String) { _ = lock.withLock { scripts.removeValue(forKey: host) } }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            guard let url = request.url,
                  let script = Self.lock.withLock({ Self.scripts[url.host ?? ""] }) else {
                throw URLError(.unsupportedURL)
            }
            let data = try script.response(for: request)
            let response = try XCTUnwrap(HTTPURLResponse(url: url, statusCode: 200,
                httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"]))
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }
    override func stopLoading() {}
}

final class RemoteAgentObservedSnapshotTests: XCTestCase {
    func testSimplexTuneMakesOneBoundedAttemptWhenReplyIsLost() async throws {
        try await fixture(commands: [], verify: { script in
            XCTAssertEqual(script.sentCommands.count, 1)
            XCTAssertEqual(script.sentCommands.first?["command"] as? String, "tune_simplex")
            XCTAssertNil((script.sentCommands.first?["arguments"] as? [String: Any])?["vfo"])
            XCTAssertEqual(script.sentTimeouts, [RemoteAgentClient.receiveTuneCommandTimeout])
        }) { client, _ in
            do {
                try await client.tuneSimplex(7_187_000, mode: "LSB")
                XCTFail("Lost tune reply reported success")
            } catch {}
        }
    }

    func testSimplexTuneAllowsGuardedRouteLongerThanFiveSecondsWithoutRetry() async throws {
        try await fixture(commands: [nil], commandDelay: 5.25, verify: { script in
            XCTAssertEqual(script.sentCommands.count, 1)
            XCTAssertEqual(script.sentCommands.first?["command"] as? String, "tune_simplex")
            XCTAssertEqual(script.sentTimeouts, [12])
        }) { client, _ in
            try await client.tuneSimplex(7_088_000, mode: "LSB")
        }
    }

    func testSimplexTuneRetriesOnlyAnExplicitStationBusyRejection() async throws {
        try await fixture(commands: [nil], commandFailures: Array(repeating: "station-busy", count: 5), verify: { script in
            XCTAssertEqual(script.sentCommands.count, 6,
                           "A guarded writer can remain busy beyond the former four-attempt window")
            XCTAssertEqual(Set(script.sentCommands.compactMap { $0["request_id"] as? String }).count, 6,
                           "A cached pre-dispatch rejection must not poison the next safe attempt")
        }) { client, _ in
            try await client.tuneSimplex(7_188_000, mode: "LSB")
        }
    }

    func testSimplexTuneDoesNotRetryADifferentStructuredRejection() async throws {
        try await fixture(commands: [nil], commandFailures: ["digital-engine-owns-radio"], verify: { script in
            XCTAssertEqual(script.sentCommands.count, 1)
        }) { client, _ in
            do {
                try await client.tuneSimplex(7_189_000, mode: "LSB")
                XCTFail("Structured rejection reported success")
            } catch {}
        }
    }

    func testGUIPTTMakesExactlyOneHTTPAttemptForOnAndOff() async throws {
        for enabled in [true,false] {try await fixture(commands:[],verify:{script in
            XCTAssertEqual(script.sentCommands.count,1);XCTAssertEqual(script.sentCommands.first?["command"] as? String,"set_ptt")
        }){client,_ in do{try await client.setGUIPTT(enabled);XCTFail("Lost reply reported success")}catch{}}}
    }
    func testAmplifierActionsMakeOneHTTPAttemptOnLostReply() async throws {
        for action:RemoteStationAction in [.operate,.standby] {
            try await fixture(commands:[],verify:{script in
                XCTAssertEqual(script.sentCommands.count,1)
                XCTAssertEqual(script.sentCommands.first?["command"] as? String,"station_\(action.rawValue)")
            }){client,_ in
                do{try await client.performStationAction(action);XCTFail("Lost response reported success")}
                catch{}
            }
        }
    }
    func testStructuredAgentRollbackFailureSurvivesCommandDecoding() throws {
        let data=Data(#"{"success":false,"error":{"code":"operate-rollback-incomplete","message":"KPA standby confirmed; drive restoration unproved"}}"#.utf8)
        XCTAssertThrowsError(try RemoteAgentStateDecoder.commandResponse(data)){error in
            let failure=error as? RemoteAgentCommandFailure
            XCTAssertEqual(failure?.code,"operate-rollback-incomplete")
            XCTAssertEqual(failure?.message,"KPA standby confirmed; drive restoration unproved")
        }
    }
    private func fixture(commands: [Double?], commandFailures: [String] = [], commandDelay: TimeInterval = 0, commandRevision: Int = 42,
                         onCommand: @escaping @Sendable () -> Void = {},
                         verify: ((ObservedCallbackScript) -> Void)? = nil,
                         operation: (RemoteAgentClient, ObservedCallbackRecorder) async throws -> Void) async throws {
        let host = "observed-\(UUID().uuidString.lowercased()).invalid"
        let script = ObservedCallbackScript(commands: commands, commandFailures: commandFailures, commandDelay: commandDelay,
                                            commandRevision: commandRevision, onCommand: onCommand)
        ObservedCallbackProtocol.install(script, host: host)
        defer { ObservedCallbackProtocol.remove(host: host) }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ObservedCallbackProtocol.self]
        configuration.urlCache = nil
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        let recorder = ObservedCallbackRecorder()
        let initial = expectation(description: "Initial mocked authoritative state delivered")
        let client = try RemoteAgentClient(baseURL: "https://\(host)", token: "synthetic-fixture-token",
            session: session,
            onSnapshot: { _ = recorder.append("view", $0) },
            onObservedSnapshot: {
                if recorder.append("observed", $0) { initial.fulfill() }
            }, enableStream: false)
        await client.start()
        await fulfillment(of: [initial], timeout: 2)
        do { try await operation(client, recorder); verify?(script) }
        catch { await client.stop(); throw error }
        await client.stop()
    }

    func testAuthoritativeCallbackPrecedesOptimisticOverlayForDecodedResponse() async throws {
        try await fixture(commands: [nil, 450]) { client, recorder in
            try await client.setMode("USB")
            let optimistic = await client.snapshot()
            XCTAssertEqual(optimistic.mode, "USB")
            try await client.setTransmit(false)
            let events = recorder.events
            let index = try XCTUnwrap(events.firstIndex {
                $0.kind == "observed" && $0.snapshot.measuredTransmitPower?.watts == 450
            })
            XCTAssertEqual(events[index].snapshot.mode, "CW")
            XCTAssertEqual(events[index].snapshot.vfo("A")?.mode, "CW")
            let view = try XCTUnwrap(events.dropFirst(index + 1).first)
            XCTAssertEqual(view.kind, "view")
            XCTAssertEqual(view.snapshot.mode, "USB")
            XCTAssertEqual(view.snapshot.vfo("A")?.mode, "USB")
            let authoritative = await client.observedSnapshot()
            XCTAssertEqual(authoritative.mode, "CW")
        }
    }

    func testPublishingPendingWritesDoesNotInvokeAuthoritativeCallback() async throws {
        try await fixture(commands: [nil]) { client, recorder in
            XCTAssertEqual(recorder.observed.count, 1)
            let nativeCount = recorder.observed.count
            try await client.setMode("USB")
            let displayed = await client.snapshot()
            XCTAssertEqual(displayed.mode, "USB")
            XCTAssertEqual(recorder.observed.count, nativeCount)
            XCTAssertTrue(recorder.events.contains { $0.kind == "view" && $0.snapshot.mode == "USB" })
            XCTAssertEqual(recorder.observed.first?.mode, "CW")
        }
    }

    func testDelayedOlderCommandStateCannotReplaceNewerAuthoritativeState() async throws {
        try await fixture(commands: [20], commandRevision: 41) { client, recorder in
            try await client.setTransmit(false)
            XCTAssertEqual(recorder.observed.count, 1)
            let observed = await client.observedSnapshot()
            XCTAssertEqual(observed.remoteStationStatus?.revision, 42)
            XCTAssertTrue(observed.isTransmitting)
        }
    }

    func testOutOfRangeLegacyNumericTelemetryIsRejectedWithoutTrapping() throws {
        var frequency = ObservedCallbackScript.state(watts: 10)
        var radio = try XCTUnwrap(frequency["radio"] as? [String: Any])
        radio.removeValue(forKey: "frequency_hz")
        radio["frequency"] = 1e100
        frequency["radio"] = radio
        let frequencyData = try JSONSerialization.data(withJSONObject: ["success": true, "state": frequency])
        XCTAssertThrowsError(try RemoteAgentStateDecoder.stateResponse(frequencyData))

        var drive = ObservedCallbackScript.state(watts: 10)
        radio = try XCTUnwrap(drive["radio"] as? [String: Any])
        radio["drive"] = 1e100
        drive["radio"] = radio
        let driveData = try JSONSerialization.data(withJSONObject: ["success": true, "state": drive])
        XCTAssertThrowsError(try RemoteAgentStateDecoder.stateResponse(driveData))
    }

    func testShutdownReleaseUsesOneShortAttempt() async throws {
        try await fixture(commands: [nil], verify: { script in
            XCTAssertEqual(script.sentCommands.count, 1)
            XCTAssertEqual(script.sentCommands.first?["command"] as? String, "set_ptt")
            XCTAssertEqual(script.sentTimeouts, [1.5])
        }) { client, _ in
            try await client.shutdownReleasePTT()
        }
    }

    func testPrimaryModeTargetsVFOAWithoutPromotingOptimisticStateToObservation() async throws {
        try await fixture(commands: [nil], verify: { script in
            XCTAssertEqual(script.sentCommands.count, 1)
            XCTAssertEqual(script.sentCommands[0]["command"] as? String, "set_mode")
            let arguments = script.sentCommands[0]["arguments"] as? [String: Any]
            XCTAssertEqual(arguments?["mode"] as? String, "DIGU")
            XCTAssertEqual(arguments?["vfo"] as? String, "A")
        }) { client, recorder in
            try await client.setPrimaryMode("digu")
            let displayed = await client.snapshot()
            let observed = await client.observedSnapshot()
            XCTAssertEqual(displayed.vfo("A")?.mode, "DIGU")
            XCTAssertEqual(observed.vfo("A")?.mode, "CW")
            XCTAssertEqual(recorder.observed.count, 1)
        }
    }

    func testShortHighThenLowDecodedReadingsAreBothDeliveredInOrder() async throws {
        try await fixture(commands: [500, 125]) { client, recorder in
            try await client.setTransmit(false)
            try await client.setTransmit(false)
            let observed = recorder.observed
            XCTAssertEqual(observed.compactMap { $0.measuredTransmitPower?.watts }, [10, 500, 125])
            let high = try XCTUnwrap(observed.dropFirst().first?.measuredTransmitPower)
            let low = try XCTUnwrap(observed.dropFirst(2).first?.measuredTransmitPower)
            XCTAssertLessThan(high.observedAt, low.observedAt)
            let final = await client.observedSnapshot()
            XCTAssertEqual(final.measuredTransmitPower?.watts, 125)
            XCTAssertEqual(observed[1].measuredTransmitPower?.watts, 500)
        }
    }

    func testAutomaticReconnectRetiresOptimisticWritesAndDelayedFrequencyRetry() async throws {
        try await fixture(commands: [nil, nil]) { client, recorder in
            try await client.setMode("USB")
            try await client.setPrimaryFrequency(14_100_000)
            let before = await client.snapshot()
            XCTAssertEqual(before.mode, "USB")
            XCTAssertEqual(before.frequencyHz, 14_100_000)

            // Simulate the read-only stream watchdog after the Agent disappears.
            // This exercises the production backoff/reconnect path, with no socket.
            await client.checkStreamFreshness(generation: 1, at: .distantFuture)
            let lost = await client.observedSnapshot()
            XCTAssertFalse(lost.isConnected)
            let deadline = ContinuousClock.now.advanced(by: .seconds(4))
            while recorder.observed.count < 2, ContinuousClock.now < deadline {
                try await Task.sleep(for: .milliseconds(20))
            }
            XCTAssertEqual(recorder.observed.count, 2, "Automatic retry must deliver a fresh authoritative observation")
            let recovered = await client.snapshot()
            XCTAssertTrue(recovered.isConnected)
            XCTAssertEqual(recovered.mode, "CW", "A retired connection's mode overlay must not mask the restarted Agent")
            XCTAssertEqual(recovered.frequencyHz, 14_025_000)
            // The pre-loss verification would otherwise retry after two seconds,
            // publish its retired target and notify the authoritative callback.
            try await Task.sleep(for: .milliseconds(2200))
            let afterVerificationDeadline = await client.snapshot()
            XCTAssertEqual(afterVerificationDeadline.frequencyHz, 14_025_000)
            XCTAssertEqual(recorder.observed.count, 2)
        }
    }

    func testStoppedClientDoesNotResumeFromScheduledAutomaticRetry() async throws {
        try await fixture(commands: []) { client, recorder in
            await client.checkStreamFreshness(generation: 1, at: .distantFuture)
            await client.stop()
            try await Task.sleep(for: .milliseconds(1400))
            let stopped = await client.observedSnapshot()
            XCTAssertFalse(stopped.isConnected)
            XCTAssertEqual(recorder.observed.count, 1)
        }
    }

    func testLateCommandReplyCannotRepublishConnectedEvidenceAfterStop() async throws {
        let sent = expectation(description: "Synthetic command is suspended awaiting its response")
        try await fixture(commands: [450], commandDelay: 0.3, onCommand: { sent.fulfill() }) { client, recorder in
            let command = Task { try await client.setTransmit(false) }
            await fulfillment(of: [sent], timeout: 2)
            await client.stop()
            do {
                try await command.value
                XCTFail("A command crossing the connection boundary cannot confirm its old response")
            } catch {}
            let stopped = await client.snapshot()
            XCTAssertFalse(stopped.isConnected)
            XCTAssertEqual(recorder.observed.count, 1, "Late command state must not reach native evidence capture")
        }
    }
}
#endif

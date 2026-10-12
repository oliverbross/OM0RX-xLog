import Foundation
import XCTest
@testable import XStationIntegrationCore

final class StationIntegrationTests: XCTestCase {
    private let profile = StationProfile(name: "Test station", radio: .init(providerID: "mock-radio"))
    private let capabilities = Set(StationCapability.allCases)
    private let target = TuneTarget(frequencyHz: 14_100_000, mode: "USB", receiveVFO: "A", transmitVFO: "A",
                                    transmitFrequencyHz: 14_100_000, transmitMode: "USB")

    private func fixture() throws -> (TuneCoordinator, ProviderContext) {
        let context = ProviderContext(profileID: profile.id, generation: 1)
        var coordinator = try TuneCoordinator(maximumSnapshotAge: 2)
        try coordinator.activate(profile: profile, context: context, capabilities: capabilities)
        coordinator.receive(observation(context, sequence: 1, time: 10), now: 10)
        return (coordinator, context)
    }

    private func observation(_ context: ProviderContext, sequence: UInt64, time: Double,
                             readiness: StationReadiness = .ready, authoritative: Bool = true,
                             frequency: Int64 = 14_100_000, mode: String = "USB", rx: String? = "A", tx: String? = "A",
                             txFrequency: Int64? = 14_100_000, txMode: String? = "USB",
                             capabilities: Set<StationCapability>? = nil) -> ObservedStationSnapshot {
        .init(context: context, sequence: sequence, observedAt: time, readiness: readiness,
              authoritative: authoritative, frequencyHz: frequency, mode: mode, receiveVFO: rx, transmitVFO: tx,
              transmitFrequencyHz: txFrequency, transmitMode: txMode, capabilities: capabilities ?? self.capabilities)
    }

    func testACKAndMatchingPreCommandSnapshotCannotConfirm() throws {
        var (coordinator, context) = try fixture()
        let request = try coordinator.begin(target: target, now: 10)
        XCTAssertEqual(coordinator.status, .pending)
        XCTAssertTrue(coordinator.acknowledge(.init(requestID: request.id, context: context), now: 10.1))
        XCTAssertEqual(coordinator.status, .acknowledged)
        XCTAssertTrue(coordinator.receive(observation(context, sequence: 2, time: 10), now: 10.2))
        XCTAssertEqual(coordinator.status, .acknowledged)
        XCTAssertTrue(coordinator.receive(observation(context, sequence: 3, time: 10.3), now: 10.3))
        XCTAssertEqual(coordinator.status, .confirmed)
        XCTAssertFalse(coordinator.fail(requestID: request.id, context: context, detail: "late failure", now: 10.3))
    }

    func testACKThenMismatchMissingOwnershipAndSidebandCannotConfirm() throws {
        var (coordinator, context) = try fixture()
        let request = try coordinator.begin(target: target, now: 10)
        coordinator.acknowledge(.init(requestID: request.id, context: context), now: 10.1)
        let observations = [
            observation(context, sequence: 2, time: 10.2, frequency: 14_200_000),
            observation(context, sequence: 3, time: 10.3, mode: "LSB"),
            observation(context, sequence: 4, time: 10.4, rx: "B"),
            observation(context, sequence: 5, time: 10.5, tx: "B"),
            observation(context, sequence: 6, time: 10.6, rx: nil, tx: nil),
            observation(context, sequence: 7, time: 10.7, txFrequency: nil),
            observation(context, sequence: 8, time: 10.8, txMode: "LSB"),
            observation(context, sequence: 9, time: 10.9, authoritative: false),
            observation(context, sequence: 10, time: 11, capabilities: [.observeRadio]),
        ]
        for value in observations {
            XCTAssertTrue(coordinator.receive(value, now: value.observedAt))
            XCTAssertEqual(coordinator.status, .acknowledged)
        }
    }

    func testOrderingAgeFutureClockAndDuplicateSequence() throws {
        var (coordinator, context) = try fixture()
        _ = try coordinator.begin(target: target, now: 10)
        XCTAssertFalse(coordinator.receive(observation(context, sequence: 1, time: 10.1), now: 10.1))
        XCTAssertFalse(coordinator.receive(observation(context, sequence: 0, time: 10.1), now: 10.1))
        XCTAssertFalse(coordinator.receive(observation(context, sequence: 2, time: 11), now: 10.1))
        XCTAssertFalse(coordinator.receive(observation(context, sequence: 2, time: 9), now: 10.1))
        XCTAssertTrue(coordinator.receive(observation(context, sequence: 2, time: 10.1), now: 13))
        XCTAssertEqual(coordinator.status, .pending, "An aged exact observation is insufficient")
        XCTAssertThrowsError(try coordinator.advance(now: 12))
        XCTAssertFalse(coordinator.receive(observation(context, sequence: 3, time: 12), now: 12))
        XCTAssertEqual(coordinator.snapshot?.sequence, 2)
    }

    func testRapidSupersessionRejectsOlderACKAndFailure() throws {
        var (coordinator, context) = try fixture()
        let first = try coordinator.begin(target: target, now: 10)
        let other = TuneTarget(frequencyHz: 14_200_000, mode: "CW")
        let second = try coordinator.begin(target: other, now: 10.1)
        XCTAssertEqual(coordinator.outcomes[first.id], .superseded)
        XCTAssertFalse(coordinator.acknowledge(.init(requestID: first.id, context: context), now: 10.2))
        XCTAssertFalse(coordinator.fail(requestID: first.id, context: context, detail: "old", now: 10.2))
        coordinator.receive(observation(context, sequence: 2, time: 10.3), now: 10.3)
        XCTAssertEqual(coordinator.status, .pending)
        coordinator.receive(observation(context, sequence: 3, time: 10.4, frequency: 14_200_000, mode: "CW"), now: 10.4)
        XCTAssertEqual(coordinator.outcomes[second.id], .confirmed)
    }

    func testProfileChangeAndReconnectDiscardOldCallbacks() throws {
        var (coordinator, context) = try fixture()
        let request = try coordinator.begin(target: target, now: 10)
        let next = StationProfile(name: "Different radio", radio: .init(providerID: "other"))
        let nextContext = ProviderContext(profileID: next.id, generation: 2)
        try coordinator.activate(profile: next, context: nextContext, capabilities: capabilities)
        XCTAssertEqual(coordinator.outcomes[request.id], .superseded)
        XCTAssertNil(coordinator.snapshot)
        XCTAssertFalse(coordinator.receive(observation(context, sequence: 100, time: 11), now: 11))
        XCTAssertFalse(coordinator.acknowledge(.init(requestID: request.id, context: context), now: 11))
        XCTAssertThrowsError(try coordinator.begin(target: target, now: 11))
        coordinator.receive(observation(nextContext, sequence: 1, time: 11), now: 11)
        let second = try coordinator.begin(target: target, now: 11)
        let reconnect = ProviderContext(profileID: next.id, generation: 3)
        try coordinator.activate(profile: next, context: reconnect, capabilities: capabilities)
        XCTAssertEqual(coordinator.outcomes[second.id], .superseded)
        XCTAssertFalse(coordinator.receive(observation(nextContext, sequence: 2, time: 11.1), now: 11.1))
    }

    func testFailureDisconnectTimeoutAndShutdownAreTerminal() throws {
        for terminal in [TuneStatus.failed, .unknownDisconnected, .timedOut, .shutdown] {
            var (coordinator, context) = try fixture()
            let request = try coordinator.begin(target: target, now: 10, timeout: 1)
            switch terminal {
            case .failed: XCTAssertTrue(coordinator.fail(requestID: request.id, context: context, detail: "mock refusal", now: 10.1))
            case .unknownDisconnected: coordinator.disconnect(context: context)
            case .timedOut: try coordinator.advance(now: 11)
            case .shutdown: coordinator.shutdown()
            default: XCTFail("unexpected fixture")
            }
            XCTAssertEqual(coordinator.status, terminal)
            XCTAssertEqual(coordinator.outcomes[request.id], terminal)
            coordinator.receive(observation(context, sequence: 2, time: 11), now: 11)
            XCTAssertEqual(coordinator.status, terminal)
            XCTAssertFalse(coordinator.acknowledge(.init(requestID: request.id, context: context), now: 11))
        }
    }

    func testUnknownReadinessFailsButNotReadyWaits() throws {
        for readiness in [StationReadiness.unknown, .disconnected, .notReady, .stale] {
            var (coordinator, context) = try fixture()
            _ = try coordinator.begin(target: target, now: 10)
            coordinator.receive(observation(context, sequence: 2, time: 10.1, readiness: readiness), now: 10.1)
            XCTAssertEqual(coordinator.status, [.unknown, .disconnected].contains(readiness) ? .unknownDisconnected : .pending)
        }
    }

    func testNoSnapshotStaleUnsupportedAndDisconnectedBlockDispatch() throws {
        var coordinator = try TuneCoordinator()
        let context = ProviderContext(profileID: profile.id, generation: 1)
        try coordinator.activate(profile: profile, context: context, capabilities: capabilities)
        XCTAssertThrowsError(try coordinator.begin(target: target, now: 10)) { XCTAssertEqual($0 as? StationContractError, .notReady) }
        coordinator.receive(observation(context, sequence: 1, time: 10), now: 10)
        XCTAssertThrowsError(try coordinator.begin(target: target, now: 13)) { XCTAssertEqual($0 as? StationContractError, .notReady) }
        coordinator.receive(observation(context, sequence: 2, time: 13, capabilities: [.observeRadio]), now: 13)
        XCTAssertThrowsError(try coordinator.begin(target: target, now: 13)) { XCTAssertEqual($0 as? StationContractError, .unsupported) }
        XCTAssertEqual(coordinator.status, .unsupported)
        XCTAssertNil(coordinator.request)
        coordinator.disconnect(context: context)
        XCTAssertFalse(coordinator.receive(observation(context, sequence: 3, time: 13), now: 13))
        XCTAssertThrowsError(try coordinator.begin(target: target, now: 13))
    }

    func testTargetDoesNotForceSimplexOrCollapseModes() throws {
        var (coordinator, context) = try fixture()
        let receiveOnlyTarget = TuneTarget(frequencyHz: 14_100_000, mode: " usb ")
        _ = try coordinator.begin(target: receiveOnlyTarget, now: 10)
        coordinator.receive(observation(context, sequence: 2, time: 10.1, rx: "B", tx: "C", txFrequency: 14_300_000, txMode: "LSB"), now: 10.1)
        XCTAssertEqual(coordinator.status, .confirmed)
        XCTAssertNotEqual(StationMode.physical("USB"), StationMode.physical("LSB"))
        XCTAssertEqual(StationMode.loggingFamily("USB"), "SSB")
        XCTAssertNotEqual(StationMode.physical("DIGU"), StationMode.physical("FT8"))
    }

    func testProfileIndependentProvidersRoundTripAndValidation() throws {
        let mixed = StationProfile(name: "Mixed", radio: .init(providerID: "hamlib", endpoint: "tcp://localhost:4532"),
                                   rotor: .init(providerID: "rotctld", endpoint: "tcp://localhost:4533"),
                                   accessories: [.init(providerID: "remote-agent", credentialReference: "keychain:accessory")],
                                   cluster: .init(providerID: "dxspider", endpoint: "tcp://localhost:7300"))
        try mixed.validate()
        XCTAssertEqual(try JSONDecoder().decode(StationProfile.self, from: JSONEncoder().encode(mixed)), mixed)
        for endpoint in ["https://user:secret@example.invalid", "https://example.invalid?token=secret", "file:///tmp/radio", "tcp://localhost:0"] {
            XCTAssertThrowsError(try ProviderSelection(providerID: "test", endpoint: endpoint).validate())
        }
        XCTAssertThrowsError(try StationProfile(name: "").validate())
        XCTAssertThrowsError(try StationProfile(name: "valid", accessories: Array(repeating: .init(providerID: "test"), count: 17)).validate())
        let unsupportedSchema = Data("{\"schemaVersion\":2,\"id\":\"\(profile.id)\",\"name\":\"test\",\"accessories\":[]}".utf8)
        let decoded = try JSONDecoder().decode(StationProfile.self, from: unsupportedSchema)
        XCTAssertThrowsError(try decoded.validate())
    }

    func testValidatedBoundsAndNoReusedRequests() throws {
        for value in [Int64(0), -1, 1_000_000_000_001] { XCTAssertThrowsError(try TuneTarget(frequencyHz: value, mode: "CW").validate()) }
        for value in ["", "USB\nPTT", String(repeating: "A", count: 17)] { XCTAssertThrowsError(try TuneTarget(frequencyHz: 1, mode: value).validate()) }
        XCTAssertThrowsError(try TuneCoordinator(maximumSnapshotAge: .infinity))
        XCTAssertThrowsError(try TuneCoordinator(maximumSnapshotAge: 0))
        var (coordinator, context) = try fixture()
        for timeout in [Double(0), -1, .nan, .infinity, 121] { XCTAssertThrowsError(try coordinator.begin(target: target, now: 10, timeout: timeout)) }
        XCTAssertThrowsError(try coordinator.begin(target: target, now: .nan))
        let request = try coordinator.begin(target: target, now: 10)
        XCTAssertThrowsError(try coordinator.begin(target: target, now: 10, requestID: request.id))
        coordinator.fail(requestID: request.id, context: context, detail: "error", now: 10)
        XCTAssertThrowsError(try coordinator.begin(target: target, now: 10, requestID: request.id))
        coordinator.shutdown()
        XCTAssertThrowsError(try coordinator.activate(profile: profile, context: context, capabilities: capabilities))
        XCTAssertThrowsError(try coordinator.begin(target: target, now: 10))
    }

    func testObservationAtDeadlineDoesNotConfirmAndHistoryIsBounded() throws {
        var (coordinator, context) = try fixture()
        let request = try coordinator.begin(target: target, now: 10, timeout: 1)
        coordinator.receive(observation(context, sequence: 2, time: 11), now: 11)
        XCTAssertEqual(coordinator.outcomes[request.id], .timedOut)
        for index in 0..<70 {
            let next = try coordinator.begin(target: target, now: 11 + Double(index) / 100)
            coordinator.fail(requestID: next.id, context: context, detail: "fixture", now: 11 + Double(index) / 100)
        }
        XCTAssertEqual(coordinator.outcomes.count, 64)
        XCTAssertNil(coordinator.outcomes[request.id])
    }

    func testDiagnosticsUseActualStateMachine() throws {
        let report = try StationContractDiagnostics.run()
        XCTAssertTrue(report.passed)
        XCTAssertEqual(report.scenarios.count, 6)
        XCTAssertEqual(report.evidence, "simulated-contract-only")
        XCTAssertEqual(try JSONDecoder().decode(StationDiagnosticReport.self, from: JSONEncoder().encode(report)), report)
        let encoded = try JSONEncoder().encode(report)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
        XCTAssertEqual(object["passed"] as? Bool, true)
        var invalid = object
        invalid["passed"] = false
        XCTAssertThrowsError(try JSONDecoder().decode(StationDiagnosticReport.self, from: JSONSerialization.data(withJSONObject: invalid)))
    }

    func testInvalidSessionRegistrationFailureAtDeadlineAndInvalidTelemetry() throws {
        var (coordinator, context) = try fixture()
        XCTAssertThrowsError(try coordinator.activate(profile: profile, context: context, capabilities: capabilities))
        let regressed = ProviderContext(profileID: profile.id, generation: 0)
        XCTAssertThrowsError(try coordinator.activate(profile: profile, context: regressed, capabilities: capabilities))
        let recycled = ProviderContext(profileID: profile.id, generation: 2, sessionID: context.sessionID)
        XCTAssertThrowsError(try coordinator.activate(profile: profile, context: recycled, capabilities: capabilities))
        let request = try coordinator.begin(target: target, now: 10, timeout: 1)
        XCTAssertFalse(coordinator.fail(requestID: request.id, context: context, detail: "too late", now: 11))
        XCTAssertEqual(coordinator.status, .timedOut)
        coordinator.receive(observation(context, sequence: 2, time: 11, frequency: -1), now: 11)
        XCTAssertThrowsError(try coordinator.begin(target: target, now: 11))
        coordinator.receive(observation(context, sequence: 3, time: .nan), now: 11)
        XCTAssertEqual(coordinator.snapshot?.sequence, 2)
        XCTAssertFalse(coordinator.receive(observation(context, sequence: 3, time: 11), now: .infinity))
    }

    func testFullCommandSurfaceHasCapabilitiesRoundTripAndStructuralBounds() throws {
        let commands: [StationCommand] = [.tune(target), .frequency(14_100_000, vfo: "B"), .mode("USB", vfo: "B"),
            .receiveVFO("B"), .transmitVFO("A"), .split(true, transmitFrequencyHz: 14_200_000), .ptt(false),
            .cwSend("TEST"), .cwClear, .cwSpeed(25), .rit(true, offsetHz: -300), .xit(false, offsetHz: 100),
            .rfPower(50), .stationAction("standby"), .aimRotor(270), .stopRotor, .accessory("tuner", action: "bypass"),
            .publishSpot(call: "TEST/P", frequencyHz: 14_100_000, mode: "CW")]
        for command in commands {
            try command.validate()
            XCTAssertFalse(command.requiredCapabilities.isEmpty)
            XCTAssertEqual(try JSONDecoder().decode(StationCommand.self, from: JSONEncoder().encode(command)), command)
        }
        let invalid: [StationCommand] = [.frequency(0, vfo: nil), .mode("", vfo: nil), .receiveVFO(""),
            .split(true, transmitFrequencyHz: -1), .cwSend("KEY|PTT"), .cwSend("\n"), .cwSend(String(repeating: "T", count: 129)),
            .cwSpeed(101), .rit(true, offsetHz: 10000), .xit(false, offsetHz: -10000), .rfPower(0),
            .aimRotor(.nan), .aimRotor(.infinity), .aimRotor(-1), .aimRotor(361), .stationAction("bad action"),
            .accessory("", action: "test"), .publishSpot(call: "", frequencyHz: 1, mode: "CW")]
        for command in invalid { XCTAssertThrowsError(try command.validate()) }
    }

    func testNewTuneAfterDeadlinePreservesEarlierTimeout() throws {
        var (coordinator, context) = try fixture()
        let first = try coordinator.begin(target: target, now: 10, timeout: 1)
        coordinator.receive(observation(context, sequence: 2, time: 10.5, frequency: 14_200_000), now: 10.5)
        let next = try coordinator.begin(target: target, now: 11)
        XCTAssertEqual(coordinator.outcomes[first.id], .timedOut)
        XCTAssertEqual(coordinator.request?.id, next.id)
        XCTAssertEqual(coordinator.status, .pending)
    }

    func testMockProviderACKAndObservedStream() async throws {
        var (coordinator, context) = try fixture()
        let provider = MockStationProvider(capabilities: capabilities)
        try await provider.connect(profile: profile, context: context)
        let request = try coordinator.begin(target: target, now: 10)
        let acknowledgement = try await provider.execute(request.commandRequest)
        coordinator.acknowledge(acknowledgement, now: 10.1)
        XCTAssertEqual(coordinator.status, .acknowledged)
        for await observation in await provider.observations() {
            coordinator.receive(observation, now: 10.2)
        }
        XCTAssertEqual(coordinator.status, .confirmed)
        await provider.disconnect()
        do {
            _ = try await provider.execute(request.commandRequest)
            XCTFail("Disconnected provider must reject command")
        } catch { XCTAssertEqual(error as? StationContractError, .notReady) }
    }
}

private actor MockStationProvider: StationProvider {
    nonisolated let capabilities: Set<StationCapability>
    private var context: ProviderContext?
    private var request: StationCommandRequest?
    init(capabilities: Set<StationCapability>) { self.capabilities = capabilities }
    func connect(profile: StationProfile, context: ProviderContext) async throws {
        try profile.validate()
        guard profile.id == context.profileID else { throw StationContractError.invalidContext }
        self.context = context
    }
    func execute(_ request: StationCommandRequest) async throws -> ProviderAcknowledgement {
        guard let context else { throw StationContractError.notReady }
        guard request.context == context else { throw StationContractError.invalidContext }
        try request.command.validate()
        guard request.command.requiredCapabilities.isSubset(of: capabilities) else { throw StationContractError.unsupported }
        self.request = request
        return .init(requestID: request.id, context: context)
    }
    func observations() async -> AsyncStream<ObservedStationSnapshot> {
        let request = self.request
        let capabilities = self.capabilities
        return AsyncStream { continuation in
            if let request, case .tune(let target) = request.command {
                continuation.yield(.init(context: request.context, sequence: 2, observedAt: 10.2,
                    readiness: .ready, authoritative: true, frequencyHz: target.frequencyHz, mode: target.mode,
                    receiveVFO: target.receiveVFO, transmitVFO: target.transmitVFO,
                    transmitFrequencyHz: target.transmitFrequencyHz, transmitMode: target.transmitMode,
                    capabilities: capabilities))
            }
            continuation.finish()
        }
    }
    func disconnect() async { context = nil; request = nil }
}

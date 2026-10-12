// GPL-3.0-only; Copyright Oliver Bross OM0RX.
import Foundation

public struct StationDiagnosticReport: Codable, Equatable, Sendable {
    public let schemaVersion: Int
    public let evidence: String
    public let scenarios: [String: Bool]
    public var passed: Bool { !scenarios.isEmpty && scenarios.values.allSatisfy { $0 } }

    public init(schemaVersion: Int, evidence: String, scenarios: [String: Bool]) {
        self.schemaVersion = schemaVersion; self.evidence = evidence; self.scenarios = scenarios
    }
    private enum CodingKeys: String, CodingKey { case schemaVersion, evidence, scenarios, passed }
    public func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(schemaVersion, forKey: .schemaVersion)
        try values.encode(evidence, forKey: .evidence)
        try values.encode(scenarios, forKey: .scenarios)
        try values.encode(passed, forKey: .passed)
    }
    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try values.decode(Int.self, forKey: .schemaVersion)
        evidence = try values.decode(String.self, forKey: .evidence)
        scenarios = try values.decode([String: Bool].self, forKey: .scenarios)
        if let encodedPassed = try values.decodeIfPresent(Bool.self, forKey: .passed), encodedPassed != passed {
            throw DecodingError.dataCorruptedError(forKey: .passed, in: values, debugDescription: "Report result disagrees with scenarios")
        }
    }
}

/// Deterministic fixture evaluation for worker diagnostics. This opens no network or device.
public enum StationContractDiagnostics {
    public static func run() throws -> StationDiagnosticReport {
        let profile = StationProfile(id: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!,
                                     name: "Fixture", radio: .init(providerID: "simulated"))
        let context = ProviderContext(profileID: profile.id, generation: 1,
                                      sessionID: UUID(uuidString: "00000000-0000-0000-0000-000000000002")!)
        let capabilities: Set<StationCapability> = [.observeRadio, .tune, .selectReceiveVFO, .selectTransmitVFO]
        let target = TuneTarget(frequencyHz: 14_100_000, mode: "USB", receiveVFO: "A", transmitVFO: "A")
        func observation(_ sequence: UInt64, _ time: Double, mode: String = "USB") -> ObservedStationSnapshot {
            .init(context: context, sequence: sequence, observedAt: time, readiness: .ready,
                  authoritative: true, frequencyHz: target.frequencyHz, mode: mode,
                  receiveVFO: "A", transmitVFO: "A", capabilities: capabilities)
        }
        var coordinator = try TuneCoordinator()
        try coordinator.activate(profile: profile, context: context, capabilities: capabilities)
        coordinator.receive(observation(1, 10), now: 10)
        let first = try coordinator.begin(target: target, now: 10)
        let ack = coordinator.acknowledge(.init(requestID: first.id, context: context), now: 10.1)
        var checks = ["ackIsNotSuccess": ack && coordinator.status == .acknowledged]
        coordinator.receive(observation(2, 10), now: 10.2)
        checks["preCommandMatchRejected"] = coordinator.status == .acknowledged
        coordinator.receive(observation(3, 10.3, mode: "LSB"), now: 10.3)
        checks["sidebandMismatchRejected"] = coordinator.status == .acknowledged
        coordinator.receive(observation(4, 10.4), now: 10.4)
        checks["freshExactObservationConfirms"] = coordinator.status == .confirmed
        let second = try coordinator.begin(target: target, now: 10.5)
        let replacement = ProviderContext(profileID: profile.id, generation: 2,
                                         sessionID: UUID(uuidString: "00000000-0000-0000-0000-000000000003")!)
        try coordinator.activate(profile: profile, context: replacement, capabilities: capabilities)
        let acceptedOld = coordinator.receive(observation(5, 10.6), now: 10.6)
        checks["profileSessionInvalidation"] = coordinator.outcomes[second.id] == .superseded && !acceptedOld && coordinator.snapshot == nil
        coordinator.shutdown()
        checks["shutdownRejectsCallbacks"] = !coordinator.receive(observation(6, 10.7), now: 10.7)
        return StationDiagnosticReport(schemaVersion: StationProfile.currentSchemaVersion,
                                       evidence: "simulated-contract-only", scenarios: checks)
    }
}

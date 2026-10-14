import Foundation

/// One workspace draft shared by all operator surfaces. Revision is bounded to
/// JavaScript's exact integer range; neither window identity nor a QSO timestamp
/// is a concurrency token.
public struct OperatorDraftSnapshot: Codable, Equatable, Sendable {
    public let revision: Int64
    public let qso: QSO
    /// Meter updates have their own revision; they must not race contact typing.
    /// Absent on legacy drafts and receipts until native capture is configured.
    public let power: OperatorDraftPowerState?

    public init(revision: Int64, qso: QSO, power: OperatorDraftPowerState? = nil) {
        self.revision = revision; self.qso = qso; self.power = power
    }

    public func validate() throws {
        guard (0...OperatorDraftPowerState.maximumRevision).contains(revision) else {
            throw OperatorDraftError.invalid
        }
        try qso.validateOperatorDraft(forSave: false)
        if let power {
            try power.validate()
            guard power.contact == OperatorDraftPowerContact(qso: qso, workspaceID: power.workspaceID),
                  qso.txPower == power.selectedValue else { throw OperatorDraftError.invalid }
        }
    }

    private enum CodingKeys: String, CodingKey { case revision, qso, power }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        revision = try values.decode(Int64.self, forKey: .revision)
        qso = try values.decode(QSO.self, forKey: .qso)
        power = try values.decodeIfPresent(OperatorDraftPowerState.self, forKey: .power)
        try validate()
    }
}

/// Explicit intent is required even when the operator types the current value
/// again, or deliberately clears it. Comparing strings cannot prove intent.
public struct OperatorDraftPowerIntent: Codable, Equatable, Sendable {
    public enum Action: String, Codable, Sendable { case manual, automatic }
    public let action: Action
    public let value: String?

    public init(action: Action, value: String? = nil) {
        self.action = action; self.value = value
    }
}

public struct OperatorDraftMutation: Codable, Equatable, Sendable {
    public enum Action: String, Codable, Sendable { case replace, clear, save }
    public let operationID: UUID
    public let draftID: UUID
    public let expectedRevision: Int64
    public let action: Action
    public let qso: QSO?
    public let powerIntent: OperatorDraftPowerIntent?

    public init(operationID: UUID, draftID: UUID, expectedRevision: Int64, action: Action,
                qso: QSO? = nil, powerIntent: OperatorDraftPowerIntent? = nil) {
        self.operationID = operationID; self.draftID = draftID
        self.expectedRevision = expectedRevision; self.action = action; self.qso = qso
        self.powerIntent = powerIntent
    }
}

/// A receipt describes the result at commit time. It must not be used as a fresh
/// snapshot after later edits. Save receipts remain durable for lost-ack retries.
public struct OperatorDraftReceipt: Codable, Equatable, Sendable {
    public let mutation: OperatorDraftMutation
    public let draft: OperatorDraftSnapshot
    public let savedQSO: QSO?
}

public enum OperatorDraftError: Error {
    case conflict(OperatorDraftSnapshot)
    case operationReused
    case notInitialized
    case invalid
    case existingContact
}

/// Pure field projection only. The caller must separately establish Follow
/// intent, current draft/selection identity and fresh authoritative telemetry.
public enum OperatorDraftRadioFollow {
    public static func applying(to previous: QSO, frequencyHz: Int64,
                                observedMode: String, enabled: Bool) throws -> QSO {
        guard enabled else { return previous }
        let radioMode = observedMode.uppercased()
        guard (1...1_000_000_000_000).contains(frequencyHz),
              (1...16).contains(radioMode.utf8.count),
              radioMode.utf8.allSatisfy({ (65...90).contains($0) || (48...57).contains($0) || $0 == 95 || $0 == 45 }) else {
            throw OperatorDraftError.invalid
        }
        var result = previous
        result.frequencyHz = frequencyHz
        let band = BandPlan.band(for: frequencyHz)
        if !band.isEmpty { result.band = band }
        // Keep parity with prototype/src/live/draftRadio.ts: a data carrier is
        // not evidence of FT8 rather than another chosen digital contact mode.
        let digital = ["FT8", "FT4", "FT2", "PSK", "PSK31", "PSK63", "JT65", "JT9", "MFSK", "OLIVIA", "DATA", "DIGI"]
        switch radioMode {
        case "PKTUSB", "PKTLSB", "DIGU", "DIGL", "DATA", "DIGI":
            let current = previous.mode.uppercased()
            result.mode = digital.contains(current) ? current : "DIGI"
        case "USB", "LSB": result.mode = "SSB"
        case "CWR": result.mode = "CW"
        case "RTTYR": result.mode = "RTTY"
        default: result.mode = radioMode
        }
        return result
    }
}

extension QSO {
    /// In-progress drafts may have an empty/partial callsign. Logging requires a
    /// complete call. Keep drafts bounded without manufacturing radio values.
    func validateOperatorDraft(forSave: Bool) throws {
        let normalizedCall = call.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard call.utf8.count <= 64, band.utf8.count <= 16, mode.utf8.count <= 16,
              start.timeIntervalSince1970.isFinite,
              (Date(timeIntervalSince1970: -2_208_988_800)...Date(timeIntervalSince1970: 4_102_444_800)).contains(start),
              end.map({ $0.timeIntervalSince1970.isFinite }) ?? true,
              frequencyHz.map({ (1...1_000_000_000_000).contains($0) }) ?? true,
              receiveFrequencyHz.map({ (1...1_000_000_000_000).contains($0) }) ?? true,
              wavelogID == nil, deletedAt == nil,
              (try? JSONEncoder().encode(self).count).map({ $0 <= 24_576 }) == true else {
            throw OperatorDraftError.invalid
        }
        if forSave {
            guard (3...32).contains(normalizedCall.utf8.count), !band.isEmpty, !mode.isEmpty,
                  normalizedCall.utf8.allSatisfy({ (65...90).contains($0) || (48...57).contains($0) || $0 == 47 || $0 == 45 }) else {
                throw OperatorDraftError.invalid
            }
        }
    }
}

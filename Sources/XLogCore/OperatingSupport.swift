import Foundation

public struct AutomaticRotorTurnRequest: Equatable, Sendable {
    public let signature: String
    public let command: String
    public let bearing: Double
    public let band: String

    public init(signature: String, command: String, bearing: Double, band: String) {
        self.signature = signature
        self.command = command
        self.bearing = bearing
        self.band = band
    }
}

public enum AutomaticRotorTurnPlanner {
    public static func request(
        enabled: Bool,
        call: String,
        bearing: Double?,
        band: String,
        path: String
    ) -> AutomaticRotorTurnRequest? {
        let normalizedCall = call.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        let normalizedBand = band.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalizedPath = path.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard enabled,
              !normalizedCall.isEmpty,
              let bearing,
              bearing.isFinite,
              !normalizedBand.isEmpty,
              normalizedBand.unicodeScalars.allSatisfy(CharacterSet.alphanumerics.contains),
              ["SP", "LP"].contains(normalizedPath) else { return nil }
        let normalizedBearing = bearing.truncatingRemainder(dividingBy: 360) < 0
            ? bearing.truncatingRemainder(dividingBy: 360) + 360
            : bearing.truncatingRemainder(dividingBy: 360)
        return AutomaticRotorTurnRequest(
            signature: "\(normalizedCall)|\(normalizedPath)|\(Int(normalizedBearing.rounded()))|\(normalizedBand.lowercased())",
            command: String(format: "rotor_goto %.1f %@", normalizedBearing, normalizedBand),
            bearing: normalizedBearing,
            band: normalizedBand
        )
    }
}

public enum QSOValidationSeverity: String, Codable, Sendable {
    case warning
    case error
}

public struct QSOValidationIssue: Identifiable, Equatable, Codable, Sendable {
    public let id: String
    public let field: String
    public let severity: QSOValidationSeverity
    public let message: String

    public init(field: String, severity: QSOValidationSeverity, message: String) {
        self.id = "\(field)|\(severity.rawValue)|\(message)"
        self.field = field
        self.severity = severity
        self.message = message
    }
}

public enum QSOValidator {
    public static func validate(_ qso: QSO, possibleDuplicate: QSO? = nil) -> [QSOValidationIssue] {
        var issues: [QSOValidationIssue] = []
        let call = qso.call.trimmingCharacters(in: .whitespacesAndNewlines)
        if call.isEmpty {
            issues.append(.init(field: "Callsign", severity: .error, message: "Enter a callsign before logging."))
        } else if call.count < 3 || !call.unicodeScalars.allSatisfy(CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/").contains) {
            issues.append(.init(field: "Callsign", severity: .warning, message: "The callsign format is unusual; verify it before logging."))
        }

        guard let frequency = qso.frequencyHz, frequency > 0 else {
            issues.append(.init(field: "Frequency", severity: .error, message: "A valid operating frequency is required."))
            return issues
        }
        let expectedBand = BandPlan.band(for: frequency)
        if expectedBand.isEmpty {
            issues.append(.init(field: "Frequency", severity: .warning, message: "The frequency is outside the supported amateur band plan."))
        } else if expectedBand.caseInsensitiveCompare(qso.band) != .orderedSame {
            issues.append(.init(field: "Band", severity: .error, message: "\(qso.displayFrequency) MHz belongs to \(expectedBand), not \(qso.band)."))
        }
        if qso.mode.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            issues.append(.init(field: "Mode", severity: .error, message: "Select an operating mode."))
        }

        if !qso.gridSquare.isEmpty, MaidenheadLocator.coordinate(qso.gridSquare) == nil {
            issues.append(.init(field: "Grid", severity: .warning, message: "The DX gridsquare is not a valid Maidenhead locator."))
        }
        if !qso.myGrid.isEmpty, MaidenheadLocator.coordinate(qso.myGrid) == nil {
            issues.append(.init(field: "Station grid", severity: .warning, message: "The station gridsquare is not a valid Maidenhead locator."))
        }
        if qso.country.isEmpty {
            issues.append(.init(field: "Country", severity: .warning, message: "No DXCC country is resolved for this contact."))
        }
        if let possibleDuplicate {
            issues.append(.init(
                field: "Duplicate",
                severity: .warning,
                message: "\(possibleDuplicate.call) was already logged on \(possibleDuplicate.band) \(possibleDuplicate.mode) at \(possibleDuplicate.start.formatted(date: .omitted, time: .shortened))."
            ))
        }
        return issues
    }
}

public struct SyncOutboxEntry: Identifiable, Equatable, Sendable {
    public let qso: QSO
    public let attemptCount: Int
    public let lastAttemptAt: Date?
    public let nextAttemptAt: Date?
    public let lastError: String?

    public var id: UUID { qso.id }
    public var isWaiting: Bool { nextAttemptAt.map { $0 > Date() } ?? false }

    public init(qso: QSO, attemptCount: Int = 0, lastAttemptAt: Date? = nil, nextAttemptAt: Date? = nil, lastError: String? = nil) {
        self.qso = qso
        self.attemptCount = attemptCount
        self.lastAttemptAt = lastAttemptAt
        self.nextAttemptAt = nextAttemptAt
        self.lastError = lastError
    }
}

public struct QSOConflictField: Identifiable, Equatable, Sendable {
    public let key: String
    public let label: String
    public let localValue: String
    public let remoteValue: String
    public var id: String { key }
}

public enum QSOConflictMerge {
    private static let excludedKeys: Set<String> = ["id", "wavelogID", "isDirty", "updatedAt"]

    public static func differingFields(in conflict: SyncConflict) -> [QSOConflictField] {
        guard let local = try? dictionary(conflict.localQSO), let remote = try? dictionary(conflict.remoteQSO) else { return [] }
        return Set(local.keys).union(remote.keys)
            .subtracting(excludedKeys)
            .sorted()
            .compactMap { key in
                let left = display(local[key])
                let right = display(remote[key])
                guard left != right else { return nil }
                return QSOConflictField(key: key, label: label(for: key), localValue: left, remoteValue: right)
            }
    }

    public static func merge(_ conflict: SyncConflict, remoteFields: Set<String>) throws -> QSO {
        var local = try dictionary(conflict.localQSO)
        let remote = try dictionary(conflict.remoteQSO)
        for key in remoteFields where !excludedKeys.contains(key) {
            if let value = remote[key] { local[key] = value } else { local.removeValue(forKey: key) }
        }
        let preservedID = conflict.localQSO.id
        let preservedRemoteID = conflict.remoteQSO.wavelogID ?? conflict.localQSO.wavelogID
        var merged = try decode(local)
        merged.id = preservedID
        merged.wavelogID = preservedRemoteID
        merged.isDirty = true
        merged.updatedAt = Date()
        return merged
    }

    private static func dictionary(_ qso: QSO) throws -> [String: Any] {
        let data = try JSONEncoder().encode(qso)
        guard let value = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw CocoaError(.coderReadCorrupt)
        }
        return value
    }

    private static func decode(_ value: [String: Any]) throws -> QSO {
        try JSONDecoder().decode(QSO.self, from: JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]))
    }

    private static func display(_ value: Any?) -> String {
        guard let value else { return "—" }
        if value is NSNull { return "—" }
        if let string = value as? String { return string.isEmpty ? "—" : string }
        if let number = value as? NSNumber { return number.stringValue }
        if JSONSerialization.isValidJSONObject(value),
           let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]),
           let string = String(data: data, encoding: .utf8) { return string }
        return String(describing: value)
    }

    private static func label(for key: String) -> String {
        let overrides = [
            "call": "Callsign", "start": "QSO start", "end": "QSO end", "frequencyHz": "Frequency",
            "receiveFrequencyHz": "RX frequency", "gridSquare": "Gridsquare", "dxcc": "DXCC",
            "cqZone": "CQ zone", "ituZone": "ITU zone", "qth": "Location", "txPower": "TX power",
            "operatorCall": "Operator", "myCall": "Station callsign", "myGrid": "Station grid",
            "antennaPath": "Antenna path", "extraFields": "Additional ADIF fields"
        ]
        if let override = overrides[key] { return override }
        return key.replacingOccurrences(of: "([a-z])([A-Z])", with: "$1 $2", options: .regularExpression).capitalized
    }
}

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

/// Read-only findings about one retained revision. Comparisons are review
/// evidence, not replacement values or authority to change a contact.
public enum QSODataQuality {
    public enum Source: String, Codable, Sendable {
        case storedFieldOriginUnknown, otherRetainedContact, suppliedCTYReference
        case retainedPowerMetadata, retainedConflictAlternative
    }
    public enum DateRole: String, Codable, Sendable {
        case fieldOriginUnknown, powerObservedAt, referenceSourceDate, conflictDetectedAt
    }
    public enum Kind: String, Codable, Sendable {
        case validation, storedDXCCDisagreesWithReference
        case powerSourceUnknown, powerEvidenceIncomplete, powerEvidenceDisagrees
        case retainedConflict, conflictContextDoesNotMatch
    }
    public enum Impact: String, Codable, Sendable {
        case validationReview, dxccDependentViewsAndRules, powerDependentRules
        case exportAndSyncReview, existingConflictOwnerReview
    }
    public struct Evidence: Codable, Equatable, Sendable {
        public let field: String
        public let value: String
        public let source: Source
        /// A date is meaningful only with its role. Observation/detection/source
        /// dates never establish the time or author of a stored field change.
        public let date: Date?
        public let dateRole: DateRole
        public let rawDate: String?
        public let referenceSource: String?
        public let referenceVersion: String?
    }
    public struct Finding: Codable, Equatable, Sendable {
        public let kind: Kind
        public let field: String
        public let severity: QSOValidationSeverity
        public let message: String
        public let retained: Evidence
        public let comparison: Evidence?
        /// Qualitative impact preview only; no award/confirmation delta is
        /// inferred and no field patch or correction operation is produced.
        public let reviewImpacts: [Impact]
    }
    public struct Reference: Sendable {
        public let resolver: CTYResolver
        public let source: String
        public let version: String?
        public let sourceDate: Date?

        /// Metadata is supplied by the existing reference owner. This model
        /// neither loads a file nor invents a version/date when one is missing.
        public init(resolver: CTYResolver, source: String, version: String? = nil, sourceDate: Date? = nil) {
            self.resolver = resolver; self.source = source; self.version = version; self.sourceDate = sourceDate
        }
    }
    public enum ReferenceStatus: String, Codable, Sendable { case notProvided, resolved, unresolved, invalidContactDate }
    public struct DuplicateCandidate: Codable, Equatable, Sendable {
        public let contactID: UUID
        public let contactRevision: Int64
        public let call: String
        /// QSO start time, not a field-origin or verification date.
        public let contactStart: Date
        public let band: String
        public let mode: String
    }
    public struct DuplicateReview: Codable, Equatable, Sendable {
        public enum Status: String, Codable, Sendable { case complete, truncated, unknown }
        public let rule: String
        public let windowSeconds: Int
        public let candidateLimit: Int
        public let status: Status
        public let unresolvedRequirements: [String]
        public let candidates: [DuplicateCandidate]
    }
    public struct Report: Codable, Equatable, Sendable {
        public let contactID: UUID
        public let contactRevision: Int64
        public let contactStart: Date
        public let recordUpdatedAtNotFieldOrigin: Date
        public let retainedFields: [Evidence]
        public let referenceStatus: ReferenceStatus
        public let referenceComparison: Evidence?
        public let retainedPowerObservation: Evidence?
        public let findings: [Finding]
        public let duplicateReview: DuplicateReview?
    }

    public static func inspect(_ snapshot: LogbookContactSnapshot, reference: Reference? = nil,
                               possibleDuplicate: LogbookContactSnapshot? = nil, conflict: SyncConflict? = nil,
                               duplicateReview: DuplicateReview? = nil) -> Report {
        let qso = snapshot.qso
        func stored(_ field: String, _ value: String) -> Evidence {
            evidence(field, value, source: .storedFieldOriginUnknown)
        }
        let retainedDXCC = stored("dxcc", qso.dxcc.map(String.init) ?? "")
        let retainedPower = stored("txPower", qso.txPower)
        let duplicate = possibleDuplicate.flatMap { $0.qso.id == qso.id ? nil : $0 }
        var findings = QSOValidator.validate(qso, possibleDuplicate: duplicate?.qso).map { issue in
            Finding(kind: .validation, field: issue.field, severity: issue.severity, message: issue.message,
                retained: stored(issue.field, validationValue(issue.field, qso)),
                comparison: issue.field == "Duplicate" ? duplicate.map { evidence("Duplicate", $0.qso.id.uuidString, source: .otherRetainedContact) } : nil,
                reviewImpacts: [.validationReview])
        }
        var referenceStatus: ReferenceStatus = .notProvided, comparison: Evidence?
        if let reference {
            if !qso.start.timeIntervalSince1970.isFinite { referenceStatus = .invalidContactDate }
            else if let resolved = reference.resolver.resolve(qso.call, at: qso.start) {
                referenceStatus = .resolved
                comparison = evidence("dxcc", String(resolved.adif), source: .suppliedCTYReference,
                    date: reference.sourceDate, dateRole: .referenceSourceDate,
                    referenceSource: reference.source, referenceVersion: reference.version)
                if let dxcc = qso.dxcc, dxcc != resolved.adif {
                    findings.append(Finding(kind: .storedDXCCDisagreesWithReference, field: "dxcc", severity: .warning,
                        message: "Stored DXCC differs from supplied CTY inference at the QSO date. The stored value may be an intentional override and remains authoritative for this record.",
                        retained: retainedDXCC, comparison: comparison,
                        reviewImpacts: [.dxccDependentViewsAndRules, .exportAndSyncReview]))
                }
            } else { referenceStatus = .unresolved }
        }
        let prefix = OperatorDraftPowerState.provenancePrefix
        let hasPowerMetadata = qso.extraFields.keys.contains { $0.hasPrefix(prefix) }
        var retainedPowerObservation: Evidence?
        if !qso.txPower.isEmpty || hasPowerMetadata {
            let source = qso.extraFields[prefix + "SOURCE"]
            let watts = qso.extraFields[prefix + "WATTS"] ?? ""
            let rawDate = qso.extraFields[prefix + "OBSERVED_AT"]
            let observedAt = rawDate.flatMap(parseObservationDate)
            let powerEvidence = evidence("txPower", watts, source: .retainedPowerMetadata,
                date: observedAt, dateRole: .powerObservedAt, rawDate: rawDate, referenceSource: source)
            retainedPowerObservation = hasPowerMetadata ? powerEvidence : nil
            let kind: Kind?
            if !hasPowerMetadata { kind = .powerSourceUnknown }
            else if source != "kpa500_output" || qso.extraFields[prefix + "UNIT"] != "W" || observedAt == nil
                || decimalValue(watts) == nil || decimalValue(qso.txPower) == nil { kind = .powerEvidenceIncomplete }
            else { kind = decimalValue(watts) == decimalValue(qso.txPower) ? nil : .powerEvidenceDisagrees }
            if let kind {
                let messages: [Kind: String] = [
                    .powerSourceUnknown: "The retained TX power has no recorded source or field-origin date; manual or imported values may be intentional.",
                    .powerEvidenceIncomplete: "Retained power metadata is incomplete or cannot be interpreted. It does not establish the current TX power's origin or antenna-system-input measurement.",
                    .powerEvidenceDisagrees: "Retained power observation differs from TX power. A later manual or imported edit may be intentional; neither value replaces the other.",
                ]
                findings.append(Finding(kind: kind, field: "txPower", severity: .warning, message: messages[kind]!,
                    retained: retainedPower, comparison: retainedPowerObservation,
                    reviewImpacts: [.powerDependentRules, .exportAndSyncReview]))
            }
        }
        if let conflict {
            if conflict.localQSO == qso {
                for field in QSOConflictMerge.differingFields(in: conflict) {
                    findings.append(Finding(kind: .retainedConflict, field: field.key, severity: .warning,
                        message: "The existing sync conflict owner retains a different alternative. Detection time is not the remote field's source date.",
                        retained: stored(field.key, field.localValue),
                        comparison: evidence(field.key, field.remoteValue, source: .retainedConflictAlternative,
                            date: conflict.detectedAt, dateRole: .conflictDetectedAt),
                        reviewImpacts: [.existingConflictOwnerReview, .exportAndSyncReview]))
                }
            } else {
                findings.append(Finding(kind: .conflictContextDoesNotMatch, field: "conflict", severity: .warning,
                    message: "The supplied conflict does not match this exact retained contact. Its alternative values were not projected.",
                    retained: stored("conflict", ""), comparison: nil, reviewImpacts: [.existingConflictOwnerReview]))
            }
        }
        return Report(contactID: qso.id, contactRevision: snapshot.revision, contactStart: qso.start, recordUpdatedAtNotFieldOrigin: qso.updatedAt,
            retainedFields: [retainedDXCC, stored("country", qso.country), retainedPower],
            referenceStatus: referenceStatus, referenceComparison: comparison,
            retainedPowerObservation: retainedPowerObservation, findings: findings, duplicateReview: duplicateReview)
    }

    private static func evidence(_ field: String, _ value: String, source: Source, date: Date? = nil,
                                 dateRole: DateRole = .fieldOriginUnknown, rawDate: String? = nil,
                                 referenceSource: String? = nil, referenceVersion: String? = nil) -> Evidence {
        Evidence(field: field, value: value, source: source,
            date: date.flatMap { $0.timeIntervalSince1970.isFinite ? $0 : nil }, dateRole: dateRole,
            rawDate: rawDate, referenceSource: referenceSource, referenceVersion: referenceVersion)
    }
    private static func parseObservationDate(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }
    private static func decimalValue(_ value: String) -> String? {
        let value = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, value.utf8.count <= 343, value != "." else { return nil }
        let parts = value.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count <= 2, parts.allSatisfy({ $0.utf8.allSatisfy { (48...57).contains($0) } }) else { return nil }
        let integer = parts[0].drop(while: { $0 == "0" })
        let fraction = parts.count == 2 ? String(parts[1].reversed().drop(while: { $0 == "0" }).reversed()) : ""
        return (integer.isEmpty ? "0" : String(integer)) + (fraction.isEmpty ? "" : "." + fraction)
    }
    private static func validationValue(_ field: String, _ qso: QSO) -> String {
        switch field {
        case "Callsign", "Duplicate": return qso.call
        case "Frequency": return qso.frequencyHz.map(String.init) ?? ""
        case "Band": return qso.band
        case "Mode": return qso.mode
        case "Grid": return qso.gridSquare
        case "Station grid": return qso.myGrid
        case "Country": return qso.country
        default: return ""
        }
    }
}

import Foundation

public enum OperatorDraftPowerError: Error { case invalid, revisionExhausted }

/// Transport-independent KPA500 meter evidence. Radio drive percentages are not
/// meter readings. Native owners map validated observations into this DTO.
public struct OperatorDraftPowerSample: Codable, Equatable, Sendable {
    public let source: String
    public let unit: String
    public let watts: Double
    public let observedAt: Date
    public let radioObservedAt: Date
    public let amplifierObservedAt: Date
    public let receivedAt: Date
    public let sessionID: UUID

    public init?(source: String = "kpa500_output", unit: String = "W", watts: Double,
                 observedAt: Date, radioObservedAt: Date, amplifierObservedAt: Date,
                 receivedAt: Date, sessionID: UUID) {
        guard source == "kpa500_output", unit == "W", watts.isFinite,
              watts > 0, watts <= 1_000,
              [observedAt, radioObservedAt, amplifierObservedAt, receivedAt].allSatisfy(Self.validDate) else { return nil }
        self.source = source; self.unit = unit; self.watts = watts
        self.observedAt = observedAt; self.radioObservedAt = radioObservedAt
        self.amplifierObservedAt = amplifierObservedAt; self.receivedAt = receivedAt
        self.sessionID = sessionID
        guard isFresh(at: receivedAt) else { return nil }
    }

    public func isFresh(at now: Date) -> Bool {
        guard Self.validDate(now) else { return false }
        func fresh(_ date: Date, age: TimeInterval) -> Bool {
            let elapsed = now.timeIntervalSince(date)
            return Self.validDate(date) && elapsed.isFinite && elapsed >= 0 && elapsed <= age
        }
        return fresh(observedAt, age: 2) && fresh(radioObservedAt, age: 2)
            && fresh(receivedAt, age: 2) && fresh(amplifierObservedAt, age: 15)
    }

    // AmplifierObservedAt dates the retained status envelope, not the meter
    // reading. Only fresh meter/radio/transport evidence must follow rearming;
    // the envelope retains its independent 15-second freshness limit.
    fileprivate var scopeEvidenceDates: [Date] { [observedAt, radioObservedAt, receivedAt] }

    fileprivate static func validDate(_ date: Date) -> Bool {
        let value = date.timeIntervalSince1970
        return value.isFinite && value > 0 && value <= 4_102_444_800
    }

    private enum CodingKeys: String, CodingKey {
        case source, unit, watts, observedAt, radioObservedAt, amplifierObservedAt, receivedAt, sessionID
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard let sample = Self(source: try c.decode(String.self, forKey: .source),
                                unit: try c.decode(String.self, forKey: .unit),
                                watts: try c.decode(Double.self, forKey: .watts),
                                observedAt: try c.decode(Date.self, forKey: .observedAt),
                                radioObservedAt: try c.decode(Date.self, forKey: .radioObservedAt),
                                amplifierObservedAt: try c.decode(Date.self, forKey: .amplifierObservedAt),
                                receivedAt: try c.decode(Date.self, forKey: .receivedAt),
                                sessionID: try c.decode(UUID.self, forKey: .sessionID)) else {
            throw OperatorDraftPowerError.invalid
        }
        self = sample
    }
}

public struct OperatorDraftPowerContext: Codable, Equatable, Sendable {
    public let providerID: String
    public let selectionID: String
    public let sessionID: UUID
    public let sessionStartedAt: Date
    public let source: String
    public let meterSource: String

    public init(providerID: String, selectionID: String, sessionID: UUID, sessionStartedAt: Date,
                source: String = "direct_agent", meterSource: String = "kpa500_output") {
        self.providerID = providerID; self.selectionID = selectionID
        self.sessionID = sessionID; self.sessionStartedAt = sessionStartedAt
        self.source = source; self.meterSource = meterSource
    }

    fileprivate var isValid: Bool {
        source == "direct_agent" && meterSource == "kpa500_output"
            && [providerID, selectionID].allSatisfy { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && $0.utf8.count <= 256 }
            && OperatorDraftPowerSample.validDate(sessionStartedAt)
    }
}

public struct OperatorDraftPowerContact: Codable, Equatable, Sendable {
    public let workspaceID: UUID
    public let draftID: UUID
    public let call: String
    public let band: String
    public let mode: String
    public let frequencyHz: Int64?

    public init(qso: QSO, workspaceID: UUID) {
        self.workspaceID = workspaceID; draftID = qso.id
        call = qso.call.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        band = qso.band.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        mode = qso.mode.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        frequencyHz = qso.frequencyHz
    }

    fileprivate var isValid: Bool {
        call.utf8.count <= 64 && band.utf8.count <= 16 && mode.utf8.count <= 16
            && (frequencyHz.map { (1...1_000_000_000_000).contains($0) } ?? true)
            && call == call.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
            && band == band.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            && mode == mode.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
    }
}

public struct OperatorDraftPowerScope: Codable, Equatable, Sendable {
    public let id: UUID
    public let contact: OperatorDraftPowerContact
    public let context: OperatorDraftPowerContext
    public let armedAt: Date
}

/// Persisted canonical selection, with an independent revision from text edits.
/// A reconnect/restore retains the last captured selection for the same contact,
/// but clears accumulation: the first reading of a fresh session starts its peak.
/// A provider/selection or contact change resets automatic selection to fallback.
public struct OperatorDraftPowerState: Codable, Equatable, Sendable {
    public static let maximumRevision: Int64 = 9_007_199_254_740_991
    public static let provenancePrefix = "APP_OM0RXXLOG_POWER_"
    public private(set) var revision: Int64 = 0
    public private(set) var enabled = false
    public private(set) var fallback: String
    public private(set) var manualOverride = false
    public private(set) var selectedValue: String
    public private(set) var activeScope: OperatorDraftPowerScope?
    public private(set) var selectedSample: OperatorDraftPowerSample?
    public private(set) var contact: OperatorDraftPowerContact
    public var workspaceID: UUID { contact.workspaceID }
    private var selectedContext: OperatorDraftPowerContext?
    private var selectedContact: OperatorDraftPowerContact?
    private var lastContext: OperatorDraftPowerContext?
    private var sessionPeak: OperatorDraftPowerSample?
    public private(set) var lastObservedAt: Date?

    public init(qso: QSO, workspaceID: UUID) throws {
        fallback = qso.txPower; selectedValue = qso.txPower
        contact = OperatorDraftPowerContact(qso: qso, workspaceID: workspaceID)
        try validate()
    }

    public func validate() throws {
        guard (0...Self.maximumRevision).contains(revision), contact.isValid,
              Self.validValue(fallback),
              (manualOverride ? Self.validManualValue(selectedValue) : Self.validValue(selectedValue, maximumLength: selectedSample == nil ? 64 : 343)),
              lastContext?.isValid ?? true, selectedContext?.isValid ?? true,
              selectedContact?.isValid ?? true else { throw OperatorDraftPowerError.invalid }
        if let scope = activeScope {
            guard enabled, !manualOverride, scope.contact == contact, scope.context.isValid,
                  !scope.contact.call.isEmpty,
                  OperatorDraftPowerSample.validDate(scope.armedAt), scope.armedAt >= scope.context.sessionStartedAt,
                  scope.context == lastContext else { throw OperatorDraftPowerError.invalid }
        }
        if let sample = selectedSample {
            guard !manualOverride, let context = selectedContext, context.sessionID == sample.sessionID,
                  lastContext?.providerID == context.providerID, lastContext?.selectionID == context.selectionID,
                  sample.scopeEvidenceDates.allSatisfy({ $0 >= context.sessionStartedAt }),
                  selectedContact == contact, selectedValue == Self.format(sample.watts) else {
                throw OperatorDraftPowerError.invalid
            }
        } else if selectedContext != nil || selectedContact != nil { throw OperatorDraftPowerError.invalid }
        if let peak = sessionPeak {
            guard let scope = activeScope, peak.sessionID == scope.context.sessionID,
                  selectedSample == peak, selectedContext == scope.context,
                  peak.scopeEvidenceDates.allSatisfy({ $0 >= scope.armedAt }),
                  lastObservedAt.map({ $0 >= peak.observedAt }) == true else { throw OperatorDraftPowerError.invalid }
        }
        if let observed = lastObservedAt {
            guard OperatorDraftPowerSample.validDate(observed), activeScope != nil else { throw OperatorDraftPowerError.invalid }
        }
        guard (lastObservedAt == nil) == (sessionPeak == nil) else { throw OperatorDraftPowerError.invalid }
    }

    public mutating func configure(enabled: Bool, fallback: String) throws {
        guard Self.validValue(fallback) else { throw OperatorDraftPowerError.invalid }
        guard enabled != self.enabled || fallback != self.fallback else { return }
        try advance()
        self.enabled = enabled; self.fallback = fallback; clearEligibility()
        if enabled && !manualOverride && selectedSample == nil { selectedValue = fallback }
    }

    /// Intent is explicit, even when value is unchanged or empty.
    public mutating func manual(value: String) throws {
        guard Self.validManualValue(value) else { throw OperatorDraftPowerError.invalid }
        try advance(); manualOverride = true; selectedValue = value
        clearSelection(); clearEligibility()
    }

    public mutating func resumeAutomatic() throws {
        try advance(); manualOverride = false; clearSelection(); clearEligibility()
        selectedValue = fallback
    }

    @discardableResult public mutating func arm(context: OperatorDraftPowerContext, qso: QSO,
                                               workspaceID: UUID, now: Date) throws -> UUID? {
        let nextContact = OperatorDraftPowerContact(qso: qso, workspaceID: workspaceID)
        guard context.isValid, nextContact.isValid, OperatorDraftPowerSample.validDate(now),
              context.sessionStartedAt <= now else { throw OperatorDraftPowerError.invalid }
        let providerChanged = lastContext.map { $0.providerID != context.providerID || $0.selectionID != context.selectionID } ?? false
        let contactChanged = nextContact != contact
        if enabled && !manualOverride && !nextContact.call.isEmpty && !providerChanged && !contactChanged,
           let scope = activeScope, scope.context == context { return scope.id }
        try advance()
        if contactChanged || providerChanged {
            clearSelection()
            if !manualOverride { selectedValue = fallback }
        }
        contact = nextContact; lastContext = context; clearEligibility()
        guard enabled, !manualOverride, !nextContact.call.isEmpty else { return nil }
        let scopeID = UUID()
        activeScope = OperatorDraftPowerScope(id: scopeID, contact: contact, context: context, armedAt: now)
        return scopeID
    }

    /// Rejection is a no-op, including the independent revision. Acceptance
    /// requires the caller's captured scope token, never just matching a call.
    @discardableResult public mutating func accept(sample: OperatorDraftPowerSample,
                                                  expectedScopeID: UUID, now: Date) throws -> Bool {
        guard enabled, !manualOverride, let scope = activeScope, scope.id == expectedScopeID,
              sample.source == scope.context.meterSource, sample.sessionID == scope.context.sessionID,
              sample.isFresh(at: now),
              sample.scopeEvidenceDates.allSatisfy({ $0 >= scope.armedAt && $0 >= scope.context.sessionStartedAt }),
              lastObservedAt.map({ sample.observedAt > $0 }) ?? true else { return false }
        try advance(); lastObservedAt = sample.observedAt
        if sessionPeak == nil || sample.watts > sessionPeak!.watts {
            sessionPeak = sample; selectedSample = sample
            selectedValue = Self.format(sample.watts); selectedContext = scope.context; selectedContact = scope.contact
        }
        return true
    }

    /// Text replacement never infers manual intent from txPower. A stale window
    /// cannot undo a newer native selection; manual changes use manual(value:).
    public mutating func reconcileReplacement(current: QSO, replacement: QSO, workspaceID: UUID) throws -> QSO {
        guard current.id == replacement.id, current.id == contact.draftID,
              OperatorDraftPowerContact(qso: current, workspaceID: workspaceID) == contact else {
            throw OperatorDraftPowerError.invalid
        }
        let next = OperatorDraftPowerContact(qso: replacement, workspaceID: workspaceID)
        guard next.isValid else { throw OperatorDraftPowerError.invalid }
        if next != contact {
            try advance(); contact = next; clearEligibility(); clearSelection()
            if !manualOverride { selectedValue = fallback }
        }
        return applying(to: replacement)
    }

    /// Clear/Save/new draft retain preferences and clear all per-contact intent.
    public mutating func reset(qso: QSO, workspaceID: UUID) throws {
        let next = OperatorDraftPowerContact(qso: qso, workspaceID: workspaceID)
        guard next.isValid else { throw OperatorDraftPowerError.invalid }
        try advance(); contact = next; manualOverride = false; selectedValue = fallback
        clearSelection(); clearEligibility(); lastContext = nil
    }

    /// Call once on restore or worker/session invalidation, before rearming.
    public mutating func invalidateSession() throws {
        try advance(); clearEligibility()
    }

    /// Restore changes the workspace authority, not the contact's historical
    /// meter evidence. Rebind only the exact canonical draft and retire scopes.
    public mutating func rebindWorkspace(qso: QSO, workspaceID: UUID) throws {
        guard contact == OperatorDraftPowerContact(qso: qso, workspaceID: contact.workspaceID),
              qso.txPower == selectedValue else { throw OperatorDraftPowerError.invalid }
        guard workspaceID != contact.workspaceID else { return }
        try advance()
        contact = OperatorDraftPowerContact(qso: qso, workspaceID: workspaceID)
        if selectedContact != nil { selectedContact = contact }
        clearEligibility()
    }

    public func applying(to qso: QSO, includeProvenance: Bool = false) -> QSO {
        var result = qso
        result.extraFields = result.extraFields.filter { !$0.key.uppercased().hasPrefix(Self.provenancePrefix) }
        guard OperatorDraftPowerContact(qso: qso, workspaceID: contact.workspaceID) == contact else { return result }
        result.txPower = selectedValue
        if includeProvenance, let sample = selectedSample, let context = selectedContext, selectedContact == contact {
            let prefix = Self.provenancePrefix
            result.extraFields[prefix + "SOURCE"] = sample.source
            result.extraFields[prefix + "UNIT"] = sample.unit
            result.extraFields[prefix + "WATTS"] = Self.format(sample.watts)
            result.extraFields[prefix + "OBSERVED_AT"] = Self.timestamp(sample.observedAt)
            result.extraFields[prefix + "RADIO_OBSERVED_AT"] = Self.timestamp(sample.radioObservedAt)
            result.extraFields[prefix + "AMPLIFIER_OBSERVED_AT"] = Self.timestamp(sample.amplifierObservedAt)
            result.extraFields[prefix + "RECEIVED_AT"] = Self.timestamp(sample.receivedAt)
            result.extraFields[prefix + "PROVIDER_ID"] = context.providerID
            result.extraFields[prefix + "SELECTION_ID"] = context.selectionID
            result.extraFields[prefix + "SESSION_ID"] = sample.sessionID.uuidString
        }
        return result
    }

    private mutating func advance() throws {
        try validate()
        guard revision < Self.maximumRevision else { throw OperatorDraftPowerError.revisionExhausted }
        revision += 1
    }
    private mutating func clearSelection() { selectedSample = nil; selectedContext = nil; selectedContact = nil }
    private mutating func clearEligibility() { activeScope = nil; sessionPeak = nil; lastObservedAt = nil }
    private static func validValue(_ value: String, maximumLength: Int = 64) -> Bool {
        value.utf8.count <= maximumLength && !value.contains("\0")
    }
    private static func validManualValue(_ value: String) -> Bool {
        if validValue(value) { return true }
        // Same-value manual intent must remain available for tiny captured
        // readings. Longer text is accepted only as a canonical bounded meter
        // number, never as arbitrary manual text or an exponent representation.
        guard validValue(value, maximumLength: 343), let watts = Double(value),
              watts.isFinite, watts > 0, watts <= 1_000 else { return false }
        return value == format(watts)
    }
    private static func format(_ watts: Double) -> String {
        if watts.rounded() == watts { return String(Int(watts)) }
        // Preserve Double's shortest round-trip digits, but expand exponent
        // notation because ADIF TX_PWR is decimal and the exporter is verbatim.
        // The finite positive <=1,000 W DTO bounds this expansion to 343 bytes,
        // including subnormal readings; fixed precision could round them to zero.
        let text = String(watts)
        let parts = text.split(separator: "e")
        guard parts.count == 2, let exponent = Int(parts[1]) else { return text }
        let mantissa = String(parts[0])
        let digits = mantissa.replacingOccurrences(of: ".", with: "")
        let decimalIndex = mantissa.prefix(while: { $0 != "." }).count + exponent
        if decimalIndex <= 0 { return "0." + String(repeating: "0", count: -decimalIndex) + digits }
        if decimalIndex >= digits.count { return digits + String(repeating: "0", count: decimalIndex - digits.count) }
        let index = digits.index(digits.startIndex, offsetBy: decimalIndex)
        return String(digits[..<index]) + "." + String(digits[index...])
    }
    private static func timestamp(_ date: Date) -> String {
        String(date.timeIntervalSince1970)
    }

    private enum CodingKeys: String, CodingKey {
        case revision, enabled, fallback, manualOverride, selectedValue, activeScope, selectedSample, contact
        case selectedContext, selectedContact, lastContext, sessionPeak, lastObservedAt
    }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        revision = try c.decode(Int64.self, forKey: .revision)
        enabled = try c.decode(Bool.self, forKey: .enabled); fallback = try c.decode(String.self, forKey: .fallback)
        manualOverride = try c.decode(Bool.self, forKey: .manualOverride)
        selectedValue = try c.decode(String.self, forKey: .selectedValue)
        activeScope = try c.decodeIfPresent(OperatorDraftPowerScope.self, forKey: .activeScope)
        selectedSample = try c.decodeIfPresent(OperatorDraftPowerSample.self, forKey: .selectedSample)
        contact = try c.decode(OperatorDraftPowerContact.self, forKey: .contact)
        selectedContext = try c.decodeIfPresent(OperatorDraftPowerContext.self, forKey: .selectedContext)
        selectedContact = try c.decodeIfPresent(OperatorDraftPowerContact.self, forKey: .selectedContact)
        lastContext = try c.decodeIfPresent(OperatorDraftPowerContext.self, forKey: .lastContext)
        sessionPeak = try c.decodeIfPresent(OperatorDraftPowerSample.self, forKey: .sessionPeak)
        lastObservedAt = try c.decodeIfPresent(Date.self, forKey: .lastObservedAt)
        try validate()
    }
}

import Foundation

private func contestASCIIBytes(_ value: String, count: ClosedRange<Int>,
                               accepts: (UInt8, Int) -> Bool) -> Bool {
    let bytes = Array(value.utf8)
    return count.contains(bytes.count) && bytes.enumerated().allSatisfy { accepts($0.element, $0.offset) }
}

private func contestIsUppercaseLetter(_ byte: UInt8) -> Bool { (65...90).contains(byte) }
private func contestIsLowercaseLetter(_ byte: UInt8) -> Bool { (97...122).contains(byte) }
private func contestIsDigit(_ byte: UInt8) -> Bool { (48...57).contains(byte) }
private func contestHasUnsafeSeparator(_ value: String) -> Bool {
    value.unicodeScalars.contains {
        CharacterSet.controlCharacters.contains($0) || CharacterSet.newlines.contains($0)
    }
}

public enum ContestReportFormat: String, Codable, Hashable, Sendable {
    case cwRST
    case phoneRS
    case digitalRST
    case none
}

public struct ContestReportDescriptor: Codable, Hashable, Sendable {
    public let format: ContestReportFormat
    public let defaultSent: String
    public let defaultReceived: String
    public let maximumUTF8Bytes: Int

    public init(format: ContestReportFormat, defaultSent: String, defaultReceived: String,
                maximumUTF8Bytes: Int) {
        self.format = format
        self.defaultSent = defaultSent
        self.defaultReceived = defaultReceived
        self.maximumUTF8Bytes = maximumUTF8Bytes
    }

    public func accepts(_ value: String) -> Bool {
        guard value.utf8.count <= maximumUTF8Bytes else { return false }
        switch format {
        case .cwRST:
            return contestASCIIBytes(value, count: 3...3) { byte, index in
                index == 0 ? (49...53).contains(byte) : (49...57).contains(byte)
            }
        case .phoneRS:
            return contestASCIIBytes(value, count: 2...2) { byte, index in
                index == 0 ? (49...53).contains(byte) : (49...57).contains(byte)
            }
        case .digitalRST:
            return contestASCIIBytes(value, count: 3...3) { byte, index in
                index == 0 ? (49...53).contains(byte) : (49...57).contains(byte)
            }
        case .none:
            return value.isEmpty
        }
    }

    fileprivate var isCoherent: Bool {
        let expectedMaximum: Int
        switch format {
        case .cwRST, .digitalRST: expectedMaximum = 3
        case .phoneRS: expectedMaximum = 2
        case .none: expectedMaximum = 0
        }
        return maximumUTF8Bytes == expectedMaximum && accepts(defaultSent) && accepts(defaultReceived)
    }
}

public enum ContestExchangeFormat: String, Codable, Hashable, Sendable {
    case cqZone
    case serialNumber
    case structured
}

public enum ContestSentExchangeDefault: String, Codable, Hashable, Sendable {
    case stationSnapshot
    case reservedSerial
    case stationFields
}

public enum ContestADIFExchangeFields: String, Codable, Hashable, Sendable {
    case none
    case stxSrx
    case exchangeStrings
}

public enum ContestExchangeFieldKind: String, Codable, Hashable, Sendable {
    case serialNumber
    case cqZone
    case operatorName
    case subdivision
    case power
    case dxccPrefix
    case jarlPrefectureNumber
    case maidenheadGrid4
    case nonnegativeInteger
    case alphaToken
    case locationText

    fileprivate func accepts(_ value: String) -> Bool {
        switch self {
        case .serialNumber:
            return Int(value).map { $0 > 0 } == true
        case .cqZone:
            return Int(value).map { (1...40).contains($0) } == true
        case .operatorName:
            return contestASCIIBytes(value, count: 1...32) { byte, index in
                index == 0 ? contestIsUppercaseLetter(byte) :
                    (contestIsUppercaseLetter(byte) || contestIsDigit(byte) || byte == 39 || byte == 45)
            }
        case .subdivision:
            return contestASCIIBytes(value, count: 1...8) { byte, _ in
                contestIsUppercaseLetter(byte) || contestIsDigit(byte)
            }
        case .power:
            return Int(value).map { (1...1_500).contains($0) && String($0) == value } == true
        case .dxccPrefix:
            return contestASCIIBytes(value, count: 1...8) { byte, _ in
                contestIsUppercaseLetter(byte) || contestIsDigit(byte) || byte == 47
            }
        case .jarlPrefectureNumber:
            return Int(value).map { (1...99).contains($0) } == true
        case .maidenheadGrid4:
            return contestASCIIBytes(value, count: 4...4) { byte, index in
                index < 2 ? (65...82).contains(byte) : contestIsDigit(byte)
            }
        case .nonnegativeInteger:
            return contestASCIIBytes(value, count: 1...64) { byte, _ in contestIsDigit(byte) }
        case .alphaToken:
            return contestASCIIBytes(value, count: 1...32) { byte, _ in contestIsUppercaseLetter(byte) }
        case .locationText:
            guard value == value.trimmingCharacters(in: .whitespaces), !value.contains("  ") else { return false }
            return contestASCIIBytes(value, count: 1...32) { byte, _ in
                contestIsUppercaseLetter(byte) || contestIsDigit(byte) || byte == 32 || byte == 39 || byte == 45
            }
        }
    }
}

public enum ContestADIFField: String, Codable, Hashable, Sendable {
    case stx = "STX"
    case srx = "SRX"
    case name = "NAME"
    case myName = "MY_NAME"
    case state = "STATE"
    case myState = "MY_STATE"
    case gridSquare = "GRIDSQUARE"
    case myGridSquare = "MY_GRIDSQUARE"
}

public struct ContestExchangeFieldDescriptor: Codable, Hashable, Sendable {
    public let id: String
    public let label: String
    public let acceptedKinds: [ContestExchangeFieldKind]
    public let required: Bool
    public let maximumUTF8Bytes: Int
    public let adifField: ContestADIFField?

    public init(id: String, label: String, acceptedKinds: [ContestExchangeFieldKind],
                required: Bool = true, maximumUTF8Bytes: Int, adifField: ContestADIFField? = nil) {
        self.id = id
        self.label = label
        self.acceptedKinds = acceptedKinds
        self.required = required
        self.maximumUTF8Bytes = maximumUTF8Bytes
        self.adifField = adifField
    }

    fileprivate var isCoherent: Bool {
        contestASCIIBytes(id, count: 1...32) { byte, index in
            index == 0 ? contestIsLowercaseLetter(byte) :
                (contestIsLowercaseLetter(byte) || contestIsDigit(byte) || byte == 45)
        } && !label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && label.utf8.count <= 64 &&
            !contestHasUnsafeSeparator(label) &&
            !acceptedKinds.isEmpty && Set(acceptedKinds).count == acceptedKinds.count &&
            (1...64).contains(maximumUTF8Bytes)
    }
}

public struct ContestExchangeDescriptor: Codable, Hashable, Sendable {
    public let sent: ContestExchangeFormat
    public let received: ContestExchangeFormat
    public let sentDefault: ContestSentExchangeDefault
    public let adifFields: ContestADIFExchangeFields
    public let sentFields: [ContestExchangeFieldDescriptor]
    public let receivedFields: [ContestExchangeFieldDescriptor]

    public init(sent: ContestExchangeFormat, received: ContestExchangeFormat,
                 sentDefault: ContestSentExchangeDefault, adifFields: ContestADIFExchangeFields,
                 sentFields: [ContestExchangeFieldDescriptor] = [],
                 receivedFields: [ContestExchangeFieldDescriptor] = []) {
        self.sent = sent
        self.received = received
        self.sentDefault = sentDefault
        self.adifFields = adifFields
        self.sentFields = sentFields
        self.receivedFields = receivedFields
    }

    private enum CodingKeys: String, CodingKey {
        case sent, received, sentDefault, adifFields, sentFields, receivedFields
    }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        sent = try values.decode(ContestExchangeFormat.self, forKey: .sent)
        received = try values.decode(ContestExchangeFormat.self, forKey: .received)
        sentDefault = try values.decode(ContestSentExchangeDefault.self, forKey: .sentDefault)
        adifFields = try values.decode(ContestADIFExchangeFields.self, forKey: .adifFields)
        sentFields = try values.decodeIfPresent([ContestExchangeFieldDescriptor].self, forKey: .sentFields) ?? []
        receivedFields = try values.decodeIfPresent([ContestExchangeFieldDescriptor].self, forKey: .receivedFields) ?? []
    }

    public func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(sent, forKey: .sent)
        try values.encode(received, forKey: .received)
        try values.encode(sentDefault, forKey: .sentDefault)
        try values.encode(adifFields, forKey: .adifFields)
        if !sentFields.isEmpty { try values.encode(sentFields, forKey: .sentFields) }
        if !receivedFields.isEmpty { try values.encode(receivedFields, forKey: .receivedFields) }
    }
}

public enum ContestSerialRequirement: String, Codable, Hashable, Sendable {
    case none
    case requiredForCommit
}

public struct ContestSerialDescriptor: Codable, Hashable, Sendable {
    public let requirement: ContestSerialRequirement
    public let allowedScopes: [ContestSerialScope]

    public init(requirement: ContestSerialRequirement, allowedScopes: [ContestSerialScope]) {
        self.requirement = requirement
        self.allowedScopes = allowedScopes
    }
}

public enum ContestStationResolvedSerialPolicy: String, Codable, Hashable, Sendable {
    case arrlRTTYRoundupWVEOrDX
}

public struct ContestStationResolvedSerialDescriptor: Codable, Hashable, Sendable {
    public let policy: ContestStationResolvedSerialPolicy
    public let locationFieldID: String
    public let allocatedSerialFieldID: String
    public let allowedScopes: [ContestSerialScope]

    public init(policy: ContestStationResolvedSerialPolicy, locationFieldID: String,
                allocatedSerialFieldID: String, allowedScopes: [ContestSerialScope]) {
        self.policy = policy
        self.locationFieldID = locationFieldID
        self.allocatedSerialFieldID = allocatedSerialFieldID
        self.allowedScopes = allowedScopes
    }
}

public struct ContestResolvedSerialRequirement: Equatable, Sendable {
    public let requirement: ContestSerialRequirement
    public let allowedScopes: [ContestSerialScope]
    public let allocatedFieldID: String?

    public init(requirement: ContestSerialRequirement, allowedScopes: [ContestSerialScope],
                allocatedFieldID: String?) {
        self.requirement = requirement
        self.allowedScopes = allowedScopes
        self.allocatedFieldID = allocatedFieldID
    }
}

public enum ContestStationFieldRole: String, Codable, Hashable, Sendable {
    case cabrilloLocation
}

public struct ContestStationFieldDescriptor: Codable, Hashable, Sendable {
    public let id: String
    public let label: String
    public let role: ContestStationFieldRole
    public let required: Bool
    public let maximumUTF8Bytes: Int

    public init(id: String, label: String, role: ContestStationFieldRole,
                required: Bool, maximumUTF8Bytes: Int) {
        self.id = id
        self.label = label
        self.role = role
        self.required = required
        self.maximumUTF8Bytes = maximumUTF8Bytes
    }

    fileprivate var isCoherent: Bool {
        contestASCIIBytes(id, count: 1...32) { byte, index in
            let alphanumeric = contestIsLowercaseLetter(byte) || contestIsDigit(byte)
            return index == 0 ? contestIsLowercaseLetter(byte) : (alphanumeric || byte == 45)
        } && !label.isEmpty && label.utf8.count <= 80 && maximumUTF8Bytes > 0 && maximumUTF8Bytes <= 16
    }
}

public enum ContestSerialResolutionError: Error, Equatable {
    case ruleIdentityMismatch
    case invalidRuleDescriptor
    case invalidStationSnapshot
}

public enum ContestEntryDescriptorVersion: Int, Codable, Hashable, Sendable { case v1 = 1, v2 = 2 }
public enum ContestScorePolicy: String, Codable, Hashable, Sendable {
    case pointsOnly
    case pointsTimesMultipliers
}

public struct ContestModeProfile: Codable, Hashable, Sendable {
    public let mode: String
    public let adifMode: String
    public let adifSubmode: String?
    public let cabrilloQSOType: String
    public let report: ContestReportDescriptor

    public init(mode: String, adifMode: String, adifSubmode: String? = nil,
                cabrilloQSOType: String, report: ContestReportDescriptor) {
        self.mode = mode.uppercased()
        self.adifMode = adifMode.uppercased()
        self.adifSubmode = adifSubmode?.uppercased()
        self.cabrilloQSOType = cabrilloQSOType.uppercased()
        self.report = report
    }

    fileprivate var isCoherent: Bool {
        let modeTokens = [mode, adifMode] + (adifSubmode.map { [$0] } ?? [])
        let modeTokensAreCoherent = modeTokens.allSatisfy { value in
            contestASCIIBytes(value, count: 1...16) { byte, index in
                let alphanumeric = contestIsUppercaseLetter(byte) || contestIsDigit(byte)
                return index == 0 ? alphanumeric : (alphanumeric || byte == 43 || byte == 45)
            }
        }
        let cabrilloTokenIsCoherent = contestASCIIBytes(cabrilloQSOType, count: 1...4) { byte, _ in
            contestIsUppercaseLetter(byte) || contestIsDigit(byte)
        }
        return modeTokensAreCoherent && cabrilloTokenIsCoherent && report.isCoherent
    }
}

public struct ContestEntryDescriptor: Codable, Hashable, Sendable {
    public let version: ContestEntryDescriptorVersion
    public let mode: String
    public let adifMode: String
    public let cabrilloQSOType: String
    public let cabrilloFormatterVersion: String
    public let cabrilloProjectionFormatterVersion: String
    public let report: ContestReportDescriptor
    public let exchange: ContestExchangeDescriptor
    public let serial: ContestSerialDescriptor
    public let stationResolvedSerial: ContestStationResolvedSerialDescriptor?
    public let stationFields: [ContestStationFieldDescriptor]
    public let modeProfiles: [ContestModeProfile]
    public let scorePolicy: ContestScorePolicy

    public init(mode: String, adifMode: String, cabrilloQSOType: String,
                cabrilloFormatterVersion: String, cabrilloProjectionFormatterVersion: String,
                report: ContestReportDescriptor,
                exchange: ContestExchangeDescriptor, serial: ContestSerialDescriptor) {
        self.mode = mode
        self.version = .v1
        self.adifMode = adifMode
        self.cabrilloQSOType = cabrilloQSOType
        self.cabrilloFormatterVersion = cabrilloFormatterVersion
        self.cabrilloProjectionFormatterVersion = cabrilloProjectionFormatterVersion
        self.report = report
        self.exchange = exchange
        self.serial = serial
        self.stationResolvedSerial = nil
        self.stationFields = []
        self.modeProfiles = []
        self.scorePolicy = .pointsTimesMultipliers
    }

    public init(cabrilloFormatterVersion: String, cabrilloProjectionFormatterVersion: String,
                modeProfiles: [ContestModeProfile], exchange: ContestExchangeDescriptor,
                serial: ContestSerialDescriptor,
                stationResolvedSerial: ContestStationResolvedSerialDescriptor? = nil,
                stationFields: [ContestStationFieldDescriptor] = [],
                scorePolicy: ContestScorePolicy) {
        let primary = modeProfiles.first ?? ContestModeProfile(
            mode: "", adifMode: "", cabrilloQSOType: "",
            report: .init(format: .none, defaultSent: "", defaultReceived: "", maximumUTF8Bytes: 0))
        self.version = .v2
        self.mode = primary.mode
        self.adifMode = primary.adifMode
        self.cabrilloQSOType = primary.cabrilloQSOType
        self.cabrilloFormatterVersion = cabrilloFormatterVersion
        self.cabrilloProjectionFormatterVersion = cabrilloProjectionFormatterVersion
        self.report = primary.report
        self.exchange = exchange
        self.serial = serial
        self.stationResolvedSerial = stationResolvedSerial
        self.stationFields = stationFields
        self.modeProfiles = modeProfiles
        self.scorePolicy = scorePolicy
    }

    private enum CodingKeys: String, CodingKey {
        case version, mode, adifMode, cabrilloQSOType, cabrilloFormatterVersion,
             cabrilloProjectionFormatterVersion, report, exchange, serial, stationResolvedSerial, stationFields,
             modeProfiles, scorePolicy
    }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        version = try values.decodeIfPresent(ContestEntryDescriptorVersion.self, forKey: .version) ?? .v1
        mode = try values.decode(String.self, forKey: .mode)
        adifMode = try values.decode(String.self, forKey: .adifMode)
        cabrilloQSOType = try values.decode(String.self, forKey: .cabrilloQSOType)
        cabrilloFormatterVersion = try values.decode(String.self, forKey: .cabrilloFormatterVersion)
        cabrilloProjectionFormatterVersion = try values.decode(String.self, forKey: .cabrilloProjectionFormatterVersion)
        report = try values.decode(ContestReportDescriptor.self, forKey: .report)
        exchange = try values.decode(ContestExchangeDescriptor.self, forKey: .exchange)
        serial = try values.decode(ContestSerialDescriptor.self, forKey: .serial)
        if version == .v1 {
            guard !values.contains(.modeProfiles), !values.contains(.scorePolicy),
                  !values.contains(.stationResolvedSerial), !values.contains(.stationFields) else {
                throw DecodingError.dataCorruptedError(
                    forKey: .version, in: values,
                    debugDescription: "Version 1 entries cannot declare version 2 mode or score semantics.")
            }
            modeProfiles = []
            stationResolvedSerial = nil
            stationFields = []
            scorePolicy = .pointsTimesMultipliers
        } else {
            modeProfiles = try values.decode([ContestModeProfile].self, forKey: .modeProfiles)
            stationResolvedSerial = try values.decodeIfPresent(ContestStationResolvedSerialDescriptor.self,
                                                                forKey: .stationResolvedSerial)
            stationFields = try values.decodeIfPresent([ContestStationFieldDescriptor].self,
                                                        forKey: .stationFields) ?? []
            scorePolicy = try values.decode(ContestScorePolicy.self, forKey: .scorePolicy)
            guard hasCoherentV2Shape else {
                throw DecodingError.dataCorruptedError(
                    forKey: .version, in: values,
                    debugDescription: "Version 2 entry descriptor is internally inconsistent or exceeds its bounds.")
            }
        }
    }

    public func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        if version == .v2 { try values.encode(version, forKey: .version) }
        try values.encode(mode, forKey: .mode)
        try values.encode(adifMode, forKey: .adifMode)
        try values.encode(cabrilloQSOType, forKey: .cabrilloQSOType)
        try values.encode(cabrilloFormatterVersion, forKey: .cabrilloFormatterVersion)
        try values.encode(cabrilloProjectionFormatterVersion, forKey: .cabrilloProjectionFormatterVersion)
        try values.encode(report, forKey: .report)
        try values.encode(exchange, forKey: .exchange)
        try values.encode(serial, forKey: .serial)
        if version == .v2 {
            try values.encodeIfPresent(stationResolvedSerial, forKey: .stationResolvedSerial)
            if !stationFields.isEmpty { try values.encode(stationFields, forKey: .stationFields) }
            try values.encode(modeProfiles, forKey: .modeProfiles)
            try values.encode(scorePolicy, forKey: .scorePolicy)
        }
    }

    public func isCoherent(supportedModes: Set<String>) -> Bool {
        if version == .v2 {
            let modes = modeProfiles.map(\.mode)
            return hasCoherentV2Shape && Set(modes) == supportedModes
        }
        let modeAndReport: Bool
        switch (mode, adifMode, cabrilloQSOType, cabrilloFormatterVersion,
                cabrilloProjectionFormatterVersion, report.format, report.maximumUTF8Bytes) {
        case ("CW", "CW", "CW", "pilot-1", "pilot-2", .cwRST, 3),
             ("SSB", "SSB", "PH", "ssb-pilot-1", "ssb-pilot-2", .phoneRS, 2): modeAndReport = true
        default: modeAndReport = false
        }
        let exchangeAndSerial: Bool
        switch (exchange.sent, exchange.received, exchange.sentDefault, exchange.adifFields, serial.requirement) {
        case (.cqZone, .cqZone, .stationSnapshot, .none, .none):
            exchangeAndSerial = serial.allowedScopes.isEmpty
        case (.serialNumber, .serialNumber, .reservedSerial, .stxSrx, .requiredForCommit),
             (.serialNumber, .serialNumber, .reservedSerial, .exchangeStrings, .requiredForCommit):
            exchangeAndSerial = !serial.allowedScopes.isEmpty &&
                Set(serial.allowedScopes).count == serial.allowedScopes.count
        default:
            exchangeAndSerial = false
        }
        return supportedModes == [mode] && modeAndReport && exchangeAndSerial && modeProfiles.isEmpty &&
            scorePolicy == .pointsTimesMultipliers && exchange.sentFields.isEmpty && exchange.receivedFields.isEmpty &&
            report.accepts(report.defaultSent) && report.accepts(report.defaultReceived)
    }

    private var hasCoherentV2Shape: Bool {
        guard version == .v2 else { return false }
        let modes = modeProfiles.map(\.mode)
            let sentFieldIDs = exchange.sentFields.map(\.id)
            let receivedFieldIDs = exchange.receivedFields.map(\.id)
            let serialFields = exchange.sentFields.filter { $0.acceptedKinds.contains(.serialNumber) }
            let serialIsCoherent: Bool
            if let resolved = stationResolvedSerial {
                let matchingSerial = exchange.sentFields.filter { $0.id == resolved.allocatedSerialFieldID }
                let matchingLocation = exchange.sentFields.filter { $0.id == resolved.locationFieldID }
                serialIsCoherent = serial.requirement == .none && serial.allowedScopes.isEmpty &&
                    resolved.policy == .arrlRTTYRoundupWVEOrDX && resolved.allowedScopes == [.session] &&
                    resolved.locationFieldID != resolved.allocatedSerialFieldID &&
                    matchingSerial.count == 1 && matchingSerial[0].acceptedKinds == [.serialNumber] &&
                    !matchingSerial[0].required && matchingLocation.count == 1 &&
                    matchingLocation[0].acceptedKinds == [.subdivision] && !matchingLocation[0].required &&
                    serialFields.count == 1 && stationFields.count == 1 &&
                    stationFields[0].id == "section" && stationFields[0].label == "Cabrillo section" &&
                    stationFields[0].role == .cabrilloLocation && stationFields[0].required &&
                    stationFields[0].maximumUTF8Bytes == 3
            } else {
                let cabrilloLocationIsCoherent = stationFields.isEmpty ||
                    stationFields.count == 1 && stationFields[0].id == "section" &&
                    stationFields[0].label == "Cabrillo section" &&
                    stationFields[0].role == .cabrilloLocation && stationFields[0].required &&
                    stationFields[0].maximumUTF8Bytes == 3
                serialIsCoherent = serial.requirement == .none
                    ? serial.allowedScopes.isEmpty && serialFields.isEmpty && cabrilloLocationIsCoherent
                    : !serial.allowedScopes.isEmpty && Set(serial.allowedScopes).count == serial.allowedScopes.count &&
                        serialFields.count == 1 && serialFields[0].required && serialFields[0].acceptedKinds == [.serialNumber] &&
                        stationFields.isEmpty
            }
            let formatterVersionsAreCoherent = [cabrilloFormatterVersion, cabrilloProjectionFormatterVersion]
                .allSatisfy { !$0.isEmpty && $0.utf8.count <= 64 &&
                    !contestHasUnsafeSeparator($0) }
            guard let primary = modeProfiles.first else { return false }
            return modeProfiles.count <= 8 && exchange.sentFields.count <= 16 && exchange.receivedFields.count <= 16 &&
                primary.mode == mode && primary.adifMode == adifMode &&
                primary.cabrilloQSOType == cabrilloQSOType && primary.report == report &&
                formatterVersionsAreCoherent && Set(modes).count == modes.count && modeProfiles.allSatisfy(\.isCoherent) &&
                exchange.sent == .structured && exchange.received == .structured &&
                exchange.sentDefault == .stationFields && exchange.adifFields == .exchangeStrings &&
                !(sentFieldIDs + receivedFieldIDs).isEmpty &&
                Set(sentFieldIDs).count == sentFieldIDs.count &&
                Set(receivedFieldIDs).count == receivedFieldIDs.count &&
                (exchange.sentFields + exchange.receivedFields).allSatisfy(\.isCoherent) &&
                Set(stationFields.map(\.id)).count == stationFields.count &&
                Set(stationFields.map(\.role)).count == stationFields.count &&
                stationFields.allSatisfy(\.isCoherent) && serialIsCoherent
    }

    public func modeProfile(for candidate: String) -> ContestModeProfile? {
        if version == .v2 { return modeProfiles.first { $0.mode == candidate } }
        guard candidate == mode else { return nil }
        return ContestModeProfile(mode: mode, adifMode: adifMode,
                                  cabrilloQSOType: cabrilloQSOType, report: report)
    }

    public var allocatedSerialField: ContestExchangeFieldDescriptor? {
        guard version == .v2 else { return nil }
        let matches: [ContestExchangeFieldDescriptor]
        if let resolved = stationResolvedSerial {
            matches = exchange.sentFields.filter {
                $0.id == resolved.allocatedSerialFieldID && !$0.required && $0.acceptedKinds == [.serialNumber]
            }
        } else {
            guard serial.requirement == .requiredForCommit else { return nil }
            matches = exchange.sentFields.filter { $0.required && $0.acceptedKinds == [.serialNumber] }
        }
        return matches.count == 1 ? matches[0] : nil
    }

    public var cabrilloLocationField: ContestStationFieldDescriptor? {
        guard version == .v2 else { return nil }
        let matches = stationFields.filter { $0.role == .cabrilloLocation }
        return matches.count == 1 ? matches[0] : nil
    }

    public func structuralIssues(mode candidateMode: String, rstSent: String, rstReceived: String,
                                 exchange snapshot: ContestExchangeSnapshot,
                                 allowIncomplete: Bool) -> [ContestValidationIssue] {
        if version == .v1 {
            guard snapshot.sentFields.isEmpty && snapshot.receivedFields.isEmpty else {
                return [.init(code: "structuredExchangeRequiresV2", field: "exchange",
                              message: "Structured exchange fields require a version 2 entry descriptor.")]
            }
            return []
        }
        guard let profile = modeProfile(for: candidateMode) else {
            return [.init(code: "unsupportedEntryMode", field: "mode",
                          message: "Mode is not declared by the version 2 entry descriptor.")]
        }
        var issues: [ContestValidationIssue] = []
        if !allowIncomplete && (!profile.report.accepts(rstSent) || !profile.report.accepts(rstReceived)) {
            issues.append(.init(code: "invalidEntryReport", field: "report",
                                message: "Signal report does not match the selected mode profile."))
        } else if rstSent.utf8.count > profile.report.maximumUTF8Bytes ||
                    rstReceived.utf8.count > profile.report.maximumUTF8Bytes {
            issues.append(.init(code: "entryReportTooLong", field: "report",
                                message: "Signal report exceeds the selected mode profile bound."))
        }
        issues += fieldIssues(snapshot.sentFields, descriptors: exchange.sentFields,
                              direction: "sent", allowIncomplete: allowIncomplete)
        issues += fieldIssues(snapshot.receivedFields, descriptors: exchange.receivedFields,
                              direction: "received", allowIncomplete: allowIncomplete)
        return issues
    }

    public func stationExchangeIssues(_ fields: [String: ContestExchangeFieldValue]) -> [ContestValidationIssue] {
        if version == .v1 {
            guard fields.isEmpty else {
                return [.init(code: "structuredExchangeRequiresV2", field: "station.sentExchangeFields",
                              message: "Structured station exchange fields require a version 2 entry descriptor.")]
            }
            return []
        }
        let stationFields = exchange.sentFields.filter { $0.id != allocatedSerialField?.id }
        return fieldIssues(fields, descriptors: stationFields, direction: "sent", allowIncomplete: false)
    }

    private func fieldIssues(_ fields: [String: ContestExchangeFieldValue],
                             descriptors: [ContestExchangeFieldDescriptor], direction: String,
                             allowIncomplete: Bool) -> [ContestValidationIssue] {
        let descriptorIDs = descriptors.map(\.id)
        guard Set(descriptorIDs).count == descriptorIDs.count else {
            return [.init(code: "duplicateStructuredExchangeFieldDescriptor", field: "rule.entry.exchange.\(direction)",
                          message: "Structured exchange field identifiers must be unique per direction.")]
        }
        let byID = descriptors.reduce(into: [String: ContestExchangeFieldDescriptor]()) { $0[$1.id] = $1 }
        var issues: [ContestValidationIssue] = []
        for key in fields.keys.sorted() where byID[key] == nil {
            issues.append(.init(code: "unknownStructuredExchangeField", field: "exchange.\(direction).\(key)",
                                message: "Exchange field is not declared by the entry descriptor."))
        }
        for descriptor in descriptors {
            guard let value = fields[descriptor.id] else {
                if descriptor.required && !allowIncomplete {
                    issues.append(.init(code: "missingStructuredExchangeField",
                                        field: "exchange.\(direction).\(descriptor.id)",
                                        message: "A required exchange field is missing."))
                }
                continue
            }
            if value.raw.utf8.count > descriptor.maximumUTF8Bytes ||
                value.normalized.utf8.count > descriptor.maximumUTF8Bytes {
                issues.append(.init(code: "structuredExchangeFieldTooLong",
                                    field: "exchange.\(direction).\(descriptor.id)",
                                    message: "Exchange field exceeds its declared bound."))
            } else if !allowIncomplete && !descriptor.acceptedKinds.contains(where: { $0.accepts(value.normalized) }) {
                issues.append(.init(code: "invalidStructuredExchangeField",
                                    field: "exchange.\(direction).\(descriptor.id)",
                                    message: "Exchange field does not match a declared semantic kind."))
            }
        }
        return issues
    }
}

public struct ContestRuleMetadata: Codable, Hashable, Sendable {
    public let identity: ContestRuleIdentity
    public let displayName: String
    public let cabrilloName: String
    public let supportedBands: Set<String>
    public let supportedModes: Set<String>
    public let entry: ContestEntryDescriptor
    public let sourceProvenance: String

    public init(identity: ContestRuleIdentity, displayName: String, cabrilloName: String,
                supportedBands: Set<String>, supportedModes: Set<String>,
                entry: ContestEntryDescriptor, sourceProvenance: String) {
        self.identity = identity
        self.displayName = displayName
        self.cabrilloName = cabrilloName
        self.supportedBands = supportedBands
        self.supportedModes = supportedModes
        self.entry = entry
        self.sourceProvenance = sourceProvenance
    }
}

public struct ContestRuleEvaluation: Sendable {
    public let validation: [ContestValidationIssue]
    public let dupeKey: String?
    public let points: Int64
    public let multiplierCandidates: Set<ContestMultiplierKey>

    public init(validation: [ContestValidationIssue], dupeKey: String?, points: Int64,
                multiplierCandidates: Set<ContestMultiplierKey>) {
        self.validation = validation
        self.dupeKey = dupeKey
        self.points = points
        self.multiplierCandidates = multiplierCandidates
    }
}

public enum ContestDraftResetSentProjection: Sendable, Equatable {
    case stationAggregate
    case soleStationField
}

public protocol ContestRule: Sendable {
    var metadata: ContestRuleMetadata { get }
    var draftResetSentProjection: ContestDraftResetSentProjection { get }
    func validateSession(_ session: ContestSessionSnapshot) -> [ContestValidationIssue]
    func validateDraft(_ draft: ContestDraftSnapshot,
                       in session: ContestSessionSnapshot) -> [ContestValidationIssue]
    func resolvedSerialRequirement(in session: ContestSessionSnapshot) throws -> ContestResolvedSerialRequirement
    func evaluate(_ qso: ContestQSO, in session: ContestSessionSnapshot) -> ContestRuleEvaluation
    func cabrilloReceivedExchange(for qso: ContestQSO) -> String
}

/// Narrow opt-in for rules whose station role can be proven without a DXCC entity snapshot.
/// The store rejects a missing station entity unless the concrete rule adopts this capability.
public protocol ContestRuleStationEntityPolicy: ContestRule {
    func allowsMissingStationEntity(in session: ContestSessionSnapshot) -> Bool
}

/// Narrow runtime-only opt-in for rules that preserve a bounded raw exchange token
/// while validating against a distinct canonical value. Non-adopting rules keep the
/// parser's existing uppercase projection unchanged.
public protocol ContestRuleExchangeFieldProjection: ContestRule {
    func projectExchangeFields(
        _ fields: [String: ContestExchangeFieldValue]
    ) -> [String: ContestExchangeFieldValue]
}

public extension ContestRule {
    var draftResetSentProjection: ContestDraftResetSentProjection { .stationAggregate }
    func validateSession(_ session: ContestSessionSnapshot) -> [ContestValidationIssue] { [] }
    func validateDraft(_ draft: ContestDraftSnapshot,
                       in session: ContestSessionSnapshot) -> [ContestValidationIssue] { [] }

    func resolvedSerialRequirement(in session: ContestSessionSnapshot) throws -> ContestResolvedSerialRequirement {
        guard session.rule == metadata.identity else { throw ContestSerialResolutionError.ruleIdentityMismatch }
        let entry = metadata.entry
        guard entry.isCoherent(supportedModes: metadata.supportedModes) else {
            throw ContestSerialResolutionError.invalidRuleDescriptor
        }
        guard let resolved = entry.stationResolvedSerial else {
            return ContestResolvedSerialRequirement(requirement: entry.serial.requirement,
                                                    allowedScopes: entry.serial.allowedScopes,
                                                    allocatedFieldID: entry.allocatedSerialField?.id)
        }
        guard !validateSession(session).contains(where: { $0.severity == .error }) else {
            throw ContestSerialResolutionError.invalidStationSnapshot
        }
        guard let entity = session.station.entity, entity.adif > 0,
              !entity.name.isEmpty, !entity.countryPrefix.isEmpty,
              !session.station.callsign.isEmpty else {
            throw ContestSerialResolutionError.invalidStationSnapshot
        }
        let fields = session.station.sentExchangeFields
        let location = fields[resolved.locationFieldID]
        let serial = fields[resolved.allocatedSerialFieldID]
        switch resolved.policy {
        case .arrlRTTYRoundupWVEOrDX:
            if entity.adif == 291 || entity.adif == 1 {
                guard location != nil, serial == nil else {
                    throw ContestSerialResolutionError.invalidStationSnapshot
                }
                return ContestResolvedSerialRequirement(requirement: .none, allowedScopes: [], allocatedFieldID: nil)
            }
            guard location == nil, serial == nil else {
                throw ContestSerialResolutionError.invalidStationSnapshot
            }
            return ContestResolvedSerialRequirement(requirement: .requiredForCommit,
                                                    allowedScopes: resolved.allowedScopes,
                                                    allocatedFieldID: resolved.allocatedSerialFieldID)
        }
    }
}

public enum ContestQSODisposition: String, Codable, Sendable { case accepted, duplicate, invalid }

public struct ContestScoredQSO: Codable, Hashable, Sendable {
    public let qsoID: UUID
    public let disposition: ContestQSODisposition
    public let issues: [ContestValidationIssue]
    public let dupeKey: String?
    public let points: Int64
    public let newMultipliers: [ContestMultiplierKey]
}

public struct ContestScore: Codable, Hashable, Sendable {
    public let qsos: [ContestScoredQSO]
    public let totalPoints: Int64
    public let multiplierCount: Int64
    public let claimedScore: Int64
}

public enum ContestEvaluationError: Error, Equatable {
    case ruleMismatch(expected: ContestRuleIdentity, actual: ContestRuleIdentity)
    case wrongSession(qsoID: UUID)
    case duplicateQSOID(UUID)
    case invalidTimestamp(qsoID: UUID)
    case invalidRuleDescriptor
    case arithmeticOverflow
}

public enum ContestEngine {
    public static func score(_ qsos: [ContestQSO], session: ContestSessionSnapshot,
                             rule: any ContestRule) throws -> ContestScore {
        guard session.rule == rule.metadata.identity else {
            throw ContestEvaluationError.ruleMismatch(expected: session.rule, actual: rule.metadata.identity)
        }
        guard rule.metadata.entry.isCoherent(supportedModes: rule.metadata.supportedModes) else {
            throw ContestEvaluationError.invalidRuleDescriptor
        }
        var identities = Set<UUID>()
        for qso in qsos {
            guard identities.insert(qso.id).inserted else { throw ContestEvaluationError.duplicateQSOID(qso.id) }
            guard qso.timestampUTC.timeIntervalSinceReferenceDate.isFinite else {
                throw ContestEvaluationError.invalidTimestamp(qsoID: qso.id)
            }
        }
        let ordered = qsos.sorted {
            if $0.timestampUTC != $1.timestampUTC { return $0.timestampUTC < $1.timestampUTC }
            return $0.id.uuidString < $1.id.uuidString
        }
        var seenDupes = Set<String>()
        var seenMultipliers = Set<ContestMultiplierKey>()
        var scored: [ContestScoredQSO] = []
        var totalPoints: Int64 = 0

        for qso in ordered {
            guard qso.sessionID == session.id else { throw ContestEvaluationError.wrongSession(qsoID: qso.id) }
            let evaluation = try evaluate(qso, session: session, rule: rule, allowIncomplete: false)
            let validation = evaluation.validation
            let invalid = validation.contains { $0.severity == .error }
            let duplicate = !invalid && evaluation.dupeKey.map { seenDupes.contains($0) } == true
            let disposition: ContestQSODisposition = invalid ? .invalid : duplicate ? .duplicate : .accepted
            var newMultipliers: [ContestMultiplierKey] = []
            var awardedPoints: Int64 = 0
            if disposition == .accepted {
                if let key = evaluation.dupeKey { seenDupes.insert(key) }
                awardedPoints = evaluation.points
                let sum = totalPoints.addingReportingOverflow(awardedPoints)
                guard !sum.overflow else { throw ContestEvaluationError.arithmeticOverflow }
                totalPoints = sum.partialValue
                newMultipliers = evaluation.multiplierCandidates.filter { seenMultipliers.insert($0).inserted }.sorted()
            }
            scored.append(ContestScoredQSO(qsoID: qso.id, disposition: disposition,
                                           issues: validation, dupeKey: evaluation.dupeKey,
                                           points: awardedPoints, newMultipliers: newMultipliers))
        }
        let multiplierCount = Int64(seenMultipliers.count)
        let claimedScore: Int64
        switch rule.metadata.entry.scorePolicy {
        case .pointsOnly:
            claimedScore = totalPoints
        case .pointsTimesMultipliers:
            let product = totalPoints.multipliedReportingOverflow(by: multiplierCount)
            guard !product.overflow else { throw ContestEvaluationError.arithmeticOverflow }
            claimedScore = product.partialValue
        }
        return ContestScore(qsos: scored, totalPoints: totalPoints,
                            multiplierCount: multiplierCount, claimedScore: claimedScore)
    }

    public static func evaluate(_ qso: ContestQSO, session: ContestSessionSnapshot,
                                rule: any ContestRule, allowIncomplete: Bool) throws -> ContestRuleEvaluation {
        guard session.rule == rule.metadata.identity else {
            throw ContestEvaluationError.ruleMismatch(expected: session.rule, actual: rule.metadata.identity)
        }
        guard rule.metadata.entry.isCoherent(supportedModes: rule.metadata.supportedModes) else {
            throw ContestEvaluationError.invalidRuleDescriptor
        }
        let ruleEvaluation = rule.evaluate(qso, in: session)
        let descriptorIssues = rule.metadata.entry.structuralIssues(
            mode: qso.mode, rstSent: qso.rstSent, rstReceived: qso.rstReceived,
            exchange: qso.exchange, allowIncomplete: allowIncomplete)
        return ContestRuleEvaluation(validation: rule.validateSession(session) + descriptorIssues + ruleEvaluation.validation,
                                     dupeKey: ruleEvaluation.dupeKey, points: ruleEvaluation.points,
                                     multiplierCandidates: ruleEvaluation.multiplierCandidates)
    }
}

public struct ContestRuleRegistry: Sendable {
    private let rules: [ContestRuleIdentity: any ContestRule]

    public init(_ rules: [any ContestRule]) {
        self.rules = Dictionary(uniqueKeysWithValues: rules.map { ($0.metadata.identity, $0) })
    }

    public func rule(for identity: ContestRuleIdentity) -> (any ContestRule)? { rules[identity] }
    public var metadata: [ContestRuleMetadata] {
        rules.values.map(\.metadata).sorted {
            ($0.identity.id, $0.identity.version, $0.identity.edition, $0.identity.sourceRevision) <
            ($1.identity.id, $1.identity.version, $1.identity.edition, $1.identity.sourceRevision)
        }
    }

    public static let pilots = ContestRuleRegistry([
        CQWWCWRule(), CQWPXCWRule(), CQWWSSBRule(), CQWPXSSBRule(),
        OceaniaDXCWRule(), OceaniaDXSSBRule(), SACCWRule(), SACSSBRule(),
    ])
}

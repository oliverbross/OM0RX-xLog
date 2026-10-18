import Foundation

public struct ContestCountryMultiplierReferenceIdentity: Codable, Hashable, Sendable {
    public let id: String
    public let version: String

    public init(id: String, version: String) {
        self.id = id
        self.version = version
    }

    private enum CodingKeys: String, CodingKey, CaseIterable { case id, version }
    public init(from decoder: Decoder) throws {
        try contestCountryRejectUnknownKeys(decoder, allowed: CodingKeys.allCases.map(\.rawValue))
        let values = try decoder.container(keyedBy: CodingKeys.self)
        self.init(id: try values.decode(String.self, forKey: .id),
                  version: try values.decode(String.self, forKey: .version))
    }
}

public enum ContestCountryMultiplierAuthority: String, Codable, Hashable, Sendable {
    case dxcc
    case wae
    case cqwwSupplement
}

/// The immutable resolver output that an authority record classifies. Callsigns are deliberately
/// absent: the pinned reference resolver owns callsign-to-entity matching.
public struct ContestCountryMultiplierEndpoint: Codable, Hashable, Sendable, Comparable {
    public let adif: Int
    public let entityName: String
    public let continent: String
    public let cqZone: Int

    public init(adif: Int, entityName: String, continent: String, cqZone: Int) {
        self.adif = adif
        self.entityName = Self.normalizedName(entityName)
        self.continent = continent.uppercased()
        self.cqZone = cqZone
    }

    public init(_ entity: ContestEntitySnapshot) {
        self.init(adif: entity.adif, entityName: entity.name,
                  continent: entity.continent, cqZone: entity.cqZone)
    }

    private enum CodingKeys: String, CodingKey, CaseIterable { case adif, entityName, continent, cqZone }
    public init(from decoder: Decoder) throws {
        try contestCountryRejectUnknownKeys(decoder, allowed: CodingKeys.allCases.map(\.rawValue))
        let values = try decoder.container(keyedBy: CodingKeys.self)
        self.init(adif: try values.decode(Int.self, forKey: .adif),
                  entityName: try values.decode(String.self, forKey: .entityName),
                  continent: try values.decode(String.self, forKey: .continent),
                  cqZone: try values.decode(Int.self, forKey: .cqZone))
    }

    public static func < (lhs: Self, rhs: Self) -> Bool {
        (lhs.adif, lhs.entityName, lhs.continent, lhs.cqZone) <
            (rhs.adif, rhs.entityName, rhs.continent, rhs.cqZone)
    }

    private static func normalizedName(_ value: String) -> String {
        value.uppercased().split(whereSeparator: \.isWhitespace).joined(separator: " ")
    }
}

public struct ContestCountryMultiplierRecord: Codable, Hashable, Sendable {
    public let endpoint: ContestCountryMultiplierEndpoint
    public let multiplierKey: String
    public let displayLabel: String
    public let authority: ContestCountryMultiplierAuthority

    public init(endpoint: ContestCountryMultiplierEndpoint, multiplierKey: String,
                displayLabel: String, authority: ContestCountryMultiplierAuthority) {
        self.endpoint = endpoint
        self.multiplierKey = multiplierKey.uppercased()
        self.displayLabel = displayLabel
        self.authority = authority
    }

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case endpoint, multiplierKey, displayLabel, authority
    }
    public init(from decoder: Decoder) throws {
        try contestCountryRejectUnknownKeys(decoder, allowed: CodingKeys.allCases.map(\.rawValue))
        let values = try decoder.container(keyedBy: CodingKeys.self)
        self.init(endpoint: try values.decode(ContestCountryMultiplierEndpoint.self, forKey: .endpoint),
                  multiplierKey: try values.decode(String.self, forKey: .multiplierKey),
                  displayLabel: try values.decode(String.self, forKey: .displayLabel),
                  authority: try values.decode(ContestCountryMultiplierAuthority.self, forKey: .authority))
    }
}

public struct ContestCountryMultiplier: Codable, Hashable, Sendable {
    public let key: String
    public let displayLabel: String
    public let authority: ContestCountryMultiplierAuthority
}

public enum ContestCountryMultiplierReferenceError: Error, Equatable {
    case invalidIdentity
    case invalidReferenceDataVersion
    case emptyRecords
    case invalidEndpoint(ContestCountryMultiplierEndpoint)
    case invalidMultiplierKey(String)
    case invalidDisplayLabel(String)
    case duplicateEndpoint(ContestCountryMultiplierEndpoint)
    case conflictingSharedKey(String)
    case referenceDataVersionMismatch(expected: String, actual: String)
    case unknownEndpoint(ContestCountryMultiplierEndpoint)
}

/// A versioned, deterministic country-multiplier classification over immutable resolver output.
/// A complete production instance is expected to enumerate every eligible endpoint from its pinned
/// reference snapshot. Small instances remain useful as independently reviewed test fixtures.
public struct ContestCountryMultiplierReference: Codable, Hashable, Sendable {
    public let identity: ContestCountryMultiplierReferenceIdentity
    public let requiredReferenceDataVersion: String
    public let records: [ContestCountryMultiplierRecord]

    public init(identity: ContestCountryMultiplierReferenceIdentity,
                requiredReferenceDataVersion: String,
                records: [ContestCountryMultiplierRecord]) throws {
        guard Self.validCoordinate(identity.id), Self.validCoordinate(identity.version) else {
            throw ContestCountryMultiplierReferenceError.invalidIdentity
        }
        guard Self.validCoordinate(requiredReferenceDataVersion) else {
            throw ContestCountryMultiplierReferenceError.invalidReferenceDataVersion
        }
        guard !records.isEmpty else { throw ContestCountryMultiplierReferenceError.emptyRecords }

        let normalizedRecords = records.map {
            ContestCountryMultiplierRecord(
                endpoint: ContestCountryMultiplierEndpoint(adif: $0.endpoint.adif,
                                                            entityName: $0.endpoint.entityName,
                                                            continent: $0.endpoint.continent,
                                                            cqZone: $0.endpoint.cqZone),
                multiplierKey: $0.multiplierKey,
                displayLabel: $0.displayLabel,
                authority: $0.authority
            )
        }
        var endpoints = Set<ContestCountryMultiplierEndpoint>()
        var sharedKeys: [String: (String, ContestCountryMultiplierAuthority)] = [:]
        for record in normalizedRecords {
            guard Self.validEndpoint(record.endpoint) else {
                throw ContestCountryMultiplierReferenceError.invalidEndpoint(record.endpoint)
            }
            guard Self.validKey(record.multiplierKey) else {
                throw ContestCountryMultiplierReferenceError.invalidMultiplierKey(record.multiplierKey)
            }
            guard Self.validLabel(record.displayLabel) else {
                throw ContestCountryMultiplierReferenceError.invalidDisplayLabel(record.displayLabel)
            }
            guard endpoints.insert(record.endpoint).inserted else {
                throw ContestCountryMultiplierReferenceError.duplicateEndpoint(record.endpoint)
            }
            let metadata = (record.displayLabel, record.authority)
            if let existing = sharedKeys[record.multiplierKey],
               existing.0 != metadata.0 || existing.1 != metadata.1 {
                throw ContestCountryMultiplierReferenceError.conflictingSharedKey(record.multiplierKey)
            }
            sharedKeys[record.multiplierKey] = metadata
        }

        self.identity = identity
        self.requiredReferenceDataVersion = requiredReferenceDataVersion
        self.records = normalizedRecords.sorted { lhs, rhs in
            if lhs.endpoint != rhs.endpoint { return lhs.endpoint < rhs.endpoint }
            return lhs.multiplierKey < rhs.multiplierKey
        }
    }

    public func multiplier(for entity: ContestEntitySnapshot,
                           referenceDataVersion: String) throws -> ContestCountryMultiplier {
        guard referenceDataVersion == requiredReferenceDataVersion else {
            throw ContestCountryMultiplierReferenceError.referenceDataVersionMismatch(
                expected: requiredReferenceDataVersion, actual: referenceDataVersion
            )
        }
        let endpoint = ContestCountryMultiplierEndpoint(entity)
        guard let record = records.first(where: { $0.endpoint == endpoint }) else {
            throw ContestCountryMultiplierReferenceError.unknownEndpoint(endpoint)
        }
        return ContestCountryMultiplier(key: record.multiplierKey,
                                        displayLabel: record.displayLabel,
                                        authority: record.authority)
    }

    /// Stable coordinate used by immutable rule identities. The length-prefixed byte stream avoids
    /// separator ambiguity and is independent of caller record order.
    public var revisionToken: String {
        var hash: UInt64 = 14_695_981_039_346_656_037
        func append(_ value: String) {
            let bytes = Array(value.utf8)
            var length = UInt64(bytes.count).bigEndian
            withUnsafeBytes(of: &length) { raw in
                for byte in raw { hash = (hash ^ UInt64(byte)) &* 1_099_511_628_211 }
            }
            for byte in bytes { hash = (hash ^ UInt64(byte)) &* 1_099_511_628_211 }
        }
        append(identity.id)
        append(identity.version)
        append(requiredReferenceDataVersion)
        for record in records {
            append(String(record.endpoint.adif))
            append(record.endpoint.entityName)
            append(record.endpoint.continent)
            append(String(record.endpoint.cqZone))
            append(record.multiplierKey)
            append(record.displayLabel)
            append(record.authority.rawValue)
        }
        return String(format: "country-reference-fnv64-%016llx", hash)
    }

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case identity, requiredReferenceDataVersion, records
    }

    public init(from decoder: Decoder) throws {
        try contestCountryRejectUnknownKeys(decoder, allowed: CodingKeys.allCases.map(\.rawValue))
        let values = try decoder.container(keyedBy: CodingKeys.self)
        try self.init(identity: values.decode(ContestCountryMultiplierReferenceIdentity.self, forKey: .identity),
                      requiredReferenceDataVersion: values.decode(String.self, forKey: .requiredReferenceDataVersion),
                      records: values.decode([ContestCountryMultiplierRecord].self, forKey: .records))
    }

    public func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(identity, forKey: .identity)
        try values.encode(requiredReferenceDataVersion, forKey: .requiredReferenceDataVersion)
        try values.encode(records, forKey: .records)
    }

    private static func validCoordinate(_ value: String) -> Bool {
        let bytes = Array(value.utf8)
        return (1...128).contains(bytes.count) && bytes.allSatisfy { (33...126).contains($0) }
    }

    private static func validEndpoint(_ endpoint: ContestCountryMultiplierEndpoint) -> Bool {
        let validContinents: Set<String> = ["AF", "AN", "AS", "EU", "NA", "OC", "SA"]
        return (1...999_999).contains(endpoint.adif) &&
            (1...128).contains(endpoint.entityName.utf8.count) &&
            endpoint.entityName.unicodeScalars.allSatisfy { !CharacterSet.controlCharacters.contains($0) } &&
            validContinents.contains(endpoint.continent) && (1...40).contains(endpoint.cqZone)
    }

    private static func validKey(_ value: String) -> Bool {
        let bytes = Array(value.utf8)
        return (1...64).contains(bytes.count) && bytes.allSatisfy {
            (65...90).contains($0) || (48...57).contains($0) || $0 == 45 || $0 == 47
        }
    }

    private static func validLabel(_ value: String) -> Bool {
        let bytes = Array(value.utf8)
        return value == value.trimmingCharacters(in: .whitespacesAndNewlines) &&
            (1...96).contains(bytes.count) && bytes.allSatisfy { (32...126).contains($0) }
    }
}

private struct ContestCountryAnyCodingKey: CodingKey {
    let stringValue: String
    let intValue: Int?
    init?(stringValue: String) { self.stringValue = stringValue; intValue = nil }
    init?(intValue: Int) { stringValue = String(intValue); self.intValue = intValue }
}

private func contestCountryRejectUnknownKeys(_ decoder: Decoder, allowed: [String]) throws {
    let accepted = Set(allowed)
    let unknown = try decoder.container(keyedBy: ContestCountryAnyCodingKey.self).allKeys
        .map(\.stringValue).filter { !accepted.contains($0) }
    guard unknown.isEmpty else {
        throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath,
                                                debugDescription: "Unknown country reference keys: \(unknown.sorted())"))
    }
}

public enum ContestCallsignMobility: String, Codable, Hashable, Sendable {
    case land
    case maritimeMobile
    case invalidMobileMarker
}

/// Classifies only an explicit terminal maritime-mobile marker. It never derives a country from
/// the license prefix and treats misplaced or repeated `/MM` markers as invalid.
public func contestCallsignMobility(_ rawCallsign: String) -> ContestCallsignMobility {
    let call = rawCallsign.uppercased()
    guard !call.isEmpty, !call.hasPrefix("/"), !call.hasSuffix("/"), !call.contains("//") else {
        return .invalidMobileMarker
    }
    let components = call.split(separator: "/").map(String.init)
    let middle = components.dropFirst().dropLast()
    if components.last == "MM" {
        guard components.count > 1, !middle.contains("MM") else { return .invalidMobileMarker }
        return .maritimeMobile
    }
    return components.dropFirst().contains("MM") ? .invalidMobileMarker : .land
}

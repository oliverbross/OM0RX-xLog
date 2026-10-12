import Foundation

public enum SpecialReferenceFormat: String, Codable, CaseIterable, Identifiable, Sendable {
    case none, pota, sota, iota, wwff, bunker, castle

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .none: return "None — words only"
        case .pota: return "POTA — K-1234"
        case .sota: return "SOTA — VK1/AC-001"
        case .iota: return "IOTA — OC-001"
        case .wwff: return "WWFF — VKFF-0123"
        case .bunker: return "Bunkers — B/G-1234"
        case .castle: return "Castles — WCA references"
        }
    }

    var pattern: String? {
        switch self {
        case .none: return nil
        case .pota: return #"\b(?:[A-Z]{1,3})-\d{4,5}\b"#
        case .sota: return #"\b[A-Z0-9]{1,3}/[A-Z]{1,3}-\d{3}\b"#
        case .iota: return #"\b(?:EU|NA|SA|AS|AF|OC|AN)-\d{3}\b"#
        case .wwff: return #"\b[A-Z0-9]{1,4}FF-\d{3,5}\b"#
        case .bunker: return #"\bB/[A-Z0-9]{1,4}-\d{4}\b"#
        case .castle: return #"\b[A-Z]{1,3}-\d{5}\b"#
        }
    }
}

public struct SpecialRule: Identifiable, Codable, Hashable, Sendable {
    public var id: UUID
    public var name: String
    public var keywords: [String]
    public var referenceFormat: SpecialReferenceFormat
    public var advancedPattern: String
    public var enabled: Bool

    public init(id: UUID = UUID(), name: String, keywords: [String], referenceFormat: SpecialReferenceFormat = .none,
                advancedPattern: String = "", enabled: Bool = true) {
        self.id = id
        self.name = name
        self.keywords = keywords
        self.referenceFormat = referenceFormat
        self.advancedPattern = advancedPattern
        self.enabled = enabled
    }

    /// Backwards-compatible initializer for imported expert rules.
    public init(id: UUID = UUID(), name: String, pattern: String, enabled: Bool = true) {
        self.init(id: id, name: name, keywords: [], advancedPattern: pattern, enabled: enabled)
    }

    private enum CodingKeys: String, CodingKey { case id, name, keywords, referenceFormat, advancedPattern, pattern, enabled }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decodeIfPresent(UUID.self, forKey: .id) ?? UUID()
        name = try values.decodeIfPresent(String.self, forKey: .name) ?? "SPECIAL"
        enabled = try values.decodeIfPresent(Bool.self, forKey: .enabled) ?? true
        if let savedKeywords = try values.decodeIfPresent([String].self, forKey: .keywords) {
            keywords = savedKeywords
            referenceFormat = try values.decodeIfPresent(SpecialReferenceFormat.self, forKey: .referenceFormat) ?? .none
            advancedPattern = try values.decodeIfPresent(String.self, forKey: .advancedPattern) ?? ""
        } else if let migrated = Self.friendlyDefaults(for: name) {
            keywords = migrated.0
            referenceFormat = migrated.1
            advancedPattern = ""
        } else {
            keywords = [name]
            referenceFormat = .none
            advancedPattern = try values.decodeIfPresent(String.self, forKey: .pattern) ?? ""
        }
    }

    public func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(id, forKey: .id)
        try values.encode(name, forKey: .name)
        try values.encode(keywords, forKey: .keywords)
        try values.encode(referenceFormat, forKey: .referenceFormat)
        try values.encode(advancedPattern, forKey: .advancedPattern)
        try values.encode(enabled, forKey: .enabled)
    }

    private static func friendlyDefaults(for name: String) -> ([String], SpecialReferenceFormat)? {
        switch name.uppercased() {
        case "POTA": return (["POTA"], .pota)
        case "SOTA": return (["SOTA"], .sota)
        case "IOTA": return (["IOTA"], .iota)
        case "WWFF": return (["WWFF"], .wwff)
        case "BUNKER": return (["WWBOTA", "UKBOTA", "BUNKER ON THE AIR", "BUNKERS ON THE AIR"], .bunker)
        case "CASTLE": return (["WCA", "CASTLE"], .castle)
        case "LIGHTHOUSE": return (["LIGHTHOUSE", "ARLHS", "ILLW"], .none)
        case "CONTEST": return (["CONTEST"], .none)
        case "IARU": return (["IARU"], .none)
        default: return nil
        }
    }
}

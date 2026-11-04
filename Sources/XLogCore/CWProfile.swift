import Foundation

/// Preferences only. Arming, delivery state and queued text are never Codable.
public struct CWProfile: Codable, Equatable, Sendable {
    public enum Output: String, Codable, Sendable { case radio, winkeyer }
    public enum Color: String, Codable, Sendable { case cyan, green, amber, orange, pink, neutral }
    public struct Macro: Codable, Equatable, Sendable {
        public var id: Int
        public var label: String
        public var text: String
        public var color: Color
        public var shortcut: String
        public var enabled: Bool
        public var onDesk: Bool
    }
    public struct WinKeyer: Codable, Equatable, Sendable {
        public var port: String
        public var wpm: Int
        public var preferences: WinKeyerPreferences? = nil
    }
    public struct WinKeyerPreferences: Codable, Equatable, Sendable {
        public var speedSource: String?
        public var potMinimum: Int?
        public var potRange: Int?
        public var weighting: Int?
        public var ratio: Int?
        public var pttLead: Int?
        public var pttTail: Int?
        fileprivate func validate() -> Bool {
            guard speedSource == nil || ["software", "pot"].contains(speedSource!),
                  (potMinimum == nil) == (potRange == nil), (pttLead == nil) == (pttTail == nil),
                  weighting.map({ (10...90).contains($0) }) ?? true,
                  ratio.map({ (33...66).contains($0) }) ?? true,
                  pttLead.map({ (0...250).contains($0) }) ?? true,
                  pttTail.map({ (0...250).contains($0) }) ?? true else { return false }
            if let minimum = potMinimum, let range = potRange {return minimum >= 5 && range >= 5 && minimum <= 94 && range <= 94 && minimum + range <= 99}
            return true
        }
    }
    public struct Composition: Codable, Equatable, Sendable {
        public var mode: String
    }
    public var version: Int
    public var output: Output
    public var showOnDesk: Bool
    public var macros: [Macro]
    public var winkeyer: WinKeyer
    public var composition: Composition? = nil

    private enum CodingKeys: String, CodingKey { case version, output, showOnDesk, macros, winkeyer, composition }
    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        version = try values.decode(Int.self, forKey: .version)
        output = try values.decode(Output.self, forKey: .output)
        showOnDesk = try values.decode(Bool.self, forKey: .showOnDesk)
        macros = try values.decode([Macro].self, forKey: .macros)
        winkeyer = try values.decodeIfPresent(WinKeyer.self, forKey: .winkeyer) ?? .init(port: "", wpm: 20)
        composition = try values.decodeIfPresent(Composition.self, forKey: .composition)
        var ids = Set<Int>(), shortcuts = Set<String>()
        let validKeys = Set((1...12).flatMap { ["F\($0)", "Shift+F\($0)"] })
        let tokens = Set(["MYCALL", "CALL", "RST", "NAME", "GRID", "SERIAL", "EXCHANGE"])
        let pattern = try NSRegularExpression(pattern: #"\{([^{}]+)\}"#)
        func invalid() -> DecodingError { .dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Invalid CW preferences; nothing was sent or saved.")) }
        guard version == 1, macros.count <= 20, winkeyer.port.utf16.count <= 512,
              !winkeyer.port.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains),
              (5...99).contains(winkeyer.wpm), winkeyer.preferences?.validate() ?? true,
              composition.map({ ["character", "word", "hybrid"].contains($0.mode) }) ?? true else { throw invalid() }
        for macro in macros {
            guard (1...20).contains(macro.id), ids.insert(macro.id).inserted,
                  !macro.label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  macro.label.utf16.count <= 24,
                  !macro.label.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains),
                  !macro.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  macro.text.utf16.count <= 512 else { throw invalid() }
            if !macro.shortcut.isEmpty {
                guard validKeys.contains(macro.shortcut), shortcuts.insert(macro.shortcut).inserted else { throw invalid() }
            }
            let source = macro.text as NSString
            for match in pattern.matches(in: macro.text, range: NSRange(location: 0, length: source.length)) {
                let token = source.substring(with: match.range(at: 1))
                if tokens.contains(token) { continue }
                if token == "WPM:BASE" { continue }
                if token.hasPrefix("WPM:"), let speed = Int(token.dropFirst(4)), (5...99).contains(speed), token == "WPM:\(speed)" { continue }
                if token.hasPrefix("PROSIGN:"), ["AR", "AS", "BT", "SK", "KN"].contains(String(token.dropFirst(8))) { continue }
                throw invalid()
            }
            let stripped = pattern.stringByReplacingMatches(in: macro.text, range: NSRange(location: 0, length: source.length), withTemplate: "")
            guard stripped.utf8.allSatisfy({ (65...90).contains($0) || (97...122).contains($0) || (48...57).contains($0) || Array(" /?=+.,-".utf8).contains($0) }) else { throw invalid() }
        }
    }
}

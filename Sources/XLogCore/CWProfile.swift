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
    }
    public var version: Int
    public var output: Output
    public var showOnDesk: Bool
    public var macros: [Macro]
    public var winkeyer: WinKeyer

    private enum CodingKeys: String, CodingKey { case version, output, showOnDesk, macros, winkeyer }
    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        version = try values.decode(Int.self, forKey: .version)
        output = try values.decode(Output.self, forKey: .output)
        showOnDesk = try values.decode(Bool.self, forKey: .showOnDesk)
        macros = try values.decode([Macro].self, forKey: .macros)
        winkeyer = try values.decodeIfPresent(WinKeyer.self, forKey: .winkeyer) ?? .init(port: "", wpm: 20)
        var ids = Set<Int>(), shortcuts = Set<String>()
        let validKeys = Set((1...12).flatMap { ["F\($0)", "Shift+F\($0)"] })
        let tokens = Set(["MYCALL", "CALL", "RST", "NAME", "GRID", "SERIAL"])
        let pattern = try NSRegularExpression(pattern: #"\{([A-Z]+)\}"#)
        func invalid() -> DecodingError { .dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Invalid CW preferences; nothing was sent or saved.")) }
        guard version == 1, macros.count <= 20, winkeyer.port.utf16.count <= 512,
              !winkeyer.port.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains),
              (5...99).contains(winkeyer.wpm) else { throw invalid() }
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
                guard tokens.contains(source.substring(with: match.range(at: 1))) else { throw invalid() }
            }
            let stripped = pattern.stringByReplacingMatches(in: macro.text, range: NSRange(location: 0, length: source.length), withTemplate: "")
            guard stripped.utf8.allSatisfy({ (65...90).contains($0) || (97...122).contains($0) || (48...57).contains($0) || Array(" /?=+.,-".utf8).contains($0) }) else { throw invalid() }
        }
    }
}

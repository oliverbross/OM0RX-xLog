import Foundation

public struct AwardReferences: Equatable, Sendable {
    public var iota = ""
    public var sota = ""
    public var pota = ""
    public var wwff = ""
    public var sig = ""
    public var sigInfo = ""

    public init() {}
}

public enum AwardReferenceParser {
    public static func extract(comment: String, specialTags: [String] = []) -> AwardReferences {
        let tags = Set(specialTags.map { $0.uppercased() })
        let text = ([comment] + specialTags).joined(separator: " ").uppercased()
        var result = AwardReferences()
        result.iota = first(#"\b(?:AF|AN|AS|EU|NA|OC|SA)-\d{3}\b"#, in: text) ?? ""
        result.sota = first(#"\b[A-Z0-9]{1,3}/[A-Z0-9]{1,3}-\d{3,4}\b"#, in: text) ?? ""
        result.wwff = first(#"\b[A-Z0-9]{1,4}FF-\d{3,5}\b"#, in: text) ?? ""

        result.pota = potaReferences(comment: comment, specialTags: specialTags).first ?? ""

        let castleTags = ["CASTLE", "WCA", "COTA"]
        if !tags.isDisjoint(with: castleTags) || castleTags.contains(where: text.contains) {
            result.sig = tags.first(where: castleTags.contains) ?? "CASTLE"
            result.sigInfo = first(#"\b(?:WCA|COTA)[-:\s]+[A-Z0-9]{1,4}[-/]\d{3,6}\b"#, in: text)
                ?? first(#"\b[A-Z0-9]{1,4}[-/]\d{3,6}\b"#, in: text)
                ?? ""
        }
        if result.sig.isEmpty, let firstTag = specialTags.first(where: { !["POTA", "SOTA", "IOTA", "WWFF"].contains($0.uppercased()) }) {
            result.sig = firstTag.uppercased()
        }
        return result
    }

    /// POTA has a broad identifier shape. Exclude complete references belonging
    /// to other programmes before matching, including the tail of a SOTA ID.
    /// Shared by draft extraction, directory resolution and the Chaser projection.
    public static func potaReferences(comment: String, specialTags: [String] = []) -> [String] {
        let text = ([comment] + specialTags).joined(separator: " ").uppercased()
        guard text.contains("POTA") else { return [] }
        let candidates = text.replacingOccurrences(
            of: #"\b(?:[A-Z0-9]{1,4}FF-\d{3,5}|[A-Z0-9]{1,3}/[A-Z0-9]{1,3}-\d{3,4}|(?:WCA|COTA|CASTLE)[-:\s]+[A-Z0-9][A-Z0-9/-]{1,24})\b"#,
            with: " ", options: .regularExpression)
        guard let expression = try? NSRegularExpression(pattern: #"\b[A-Z0-9]{1,3}-\d{4,5}\b"#) else { return [] }
        return expression.matches(in: candidates, range: NSRange(candidates.startIndex..., in: candidates))
            .compactMap { Range($0.range, in: candidates).map { String(candidates[$0]) } }
    }

    private static func first(_ pattern: String, in text: String) -> String? {
        guard let expression = try? NSRegularExpression(pattern: pattern),
              let match = expression.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
              let range = Range(match.range, in: text) else { return nil }
        return String(text[range])
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
    }
}

import Foundation

public enum SpotLogic {
    public static let bands = ["160m", "80m", "60m", "40m", "30m", "20m", "17m", "15m", "12m", "10m", "6m", "2m", "70cm"]
    public static let modes = ["CW", "SSB", "FT8", "FT4", "FT2", "RTTY", "PSK", "DIGI", "AM", "FM"]

    private static let ft8 = [1840.0, 3573.0, 5357.0, 7074.0, 10136.0, 14074.0, 18100.0, 21074.0, 24915.0, 28074.0, 50313.0]
    private static let ft4 = [3575.0, 7047.5, 10140.0, 14080.0, 18104.0, 21140.0, 24919.0, 28180.0]
    private static let ft2 = [1843.0, 3578.0, 5357.0, 7052.0, 10144.0, 14084.0, 18108.0, 21144.0, 24923.0, 28184.0, 50320.0, 144177.0]

    public static func band(for khz: Double) -> String {
        let ranges: [(ClosedRange<Double>, String)] = [
            (1800...1999.999, "160m"), (3500...3999.999, "80m"), (5250...5449.999, "60m"),
            (7000...7299.999, "40m"), (10100...10149.999, "30m"), (14000...14349.999, "20m"),
            (18068...18167.999, "17m"), (21000...21449.999, "15m"), (24890...24989.999, "12m"),
            (28000...29699.999, "10m"), (50000...53999.999, "6m"), (144000...147999.999, "2m"),
            (220000...224999.999, "1.25m"), (430000...449999.999, "70cm"),
            (902000...927999.999, "33cm"), (1_240_000...1_299_999.999, "23cm"),
            (2_300_000...2_449_999.999, "13cm"), (3_400_000...3_474_999.999, "9cm"),
            (5_650_000...5_924_999.999, "5cm"), (10_368_000...10_549_999.999, "3cm"),
            (24_000_000...24_249_999.999, "1.25cm"),
        ]
        return ranges.first(where: { $0.0.contains(khz) })?.1 ?? "OTHER"
    }

    public static func mode(comment: String, band: String, khz: Double) -> String {
        let text = comment.uppercased()
        for token in ["FT8", "FT4", "FT2", "RTTY", "OLIVIA", "PSK", "JT65", "JT9", "HELL", "MFSK", "SSTV"] where text.contains(token) { return token }
        if text.range(of: #"(^|\s)AM($|\s)"#, options: .regularExpression) != nil { return "AM" }
        if text.range(of: #"(^|\s)FM($|\s)"#, options: .regularExpression) != nil { return "FM" }
        if ["SSB", "USB", "LSB", " PH"].contains(where: text.contains) { return "SSB" }
        if text.contains("CW") || text.contains("CWT") { return "CW" }
        if ft8.contains(where: { abs(khz - $0) <= 1.6 }) { return "FT8" }
        if ft4.contains(where: { abs(khz - $0) <= 1.6 }) { return "FT4" }
        if ft2.contains(where: { abs(khz - $0) <= 1.6 }) { return "FT2" }
        let phone: [String: ClosedRange<Double>] = ["10m": 28300...29700, "12m": 24940...24990, "15m": 21200...21450, "17m": 18110...18168, "20m": 14150...14350, "40m": 7090...7300, "80m": 3700...4000, "6m": 50100...54000]
        if phone[band]?.contains(khz) == true { return "SSB" }
        let cw: [String: ClosedRange<Double>] = ["10m": 28000...28150, "12m": 24890...24910, "15m": 21000...21070, "17m": 18068...18095, "20m": 14000...14060, "40m": 7000...7040, "30m": 10100...10150, "80m": 3500...3560, "160m": 1800...1840]
        if cw[band]?.contains(khz) == true { return "CW" }
        return "SSB"
    }

    public static func normalizedMode(_ mode: String) -> String {
        let value = mode.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        return ["USB", "LSB", "PHONE", "PH"].contains(value) ? "SSB" : value
    }

    public static func source(spotter: String, comment: String) -> String {
        let spotterText = spotter.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        let text = comment.uppercased()
        let skimmerSpotter = spotterText.hasSuffix("-#") || spotterText.hasSuffix("/#")
        return skimmerSpotter || text.range(of: #"\b(RBL|RBN|SKIMMER)\b"#, options: .regularExpression) != nil ? "rbl" : "cluster"
    }

    public static func shouldShow(callStatus: String, showWorkedBandModeSpots: Bool) -> Bool {
        showWorkedBandModeSpots || (callStatus != "Worked" && callStatus != "Confirmed")
    }

    public static func specials(in comment: String, rules: [SpecialRule]) -> [String] {
        rules.filter(\.enabled).compactMap { rule in
            let keywordMatch = rule.keywords.contains { comment.localizedCaseInsensitiveContains($0) }
            let referenceMatch = rule.referenceFormat.pattern.map {
                comment.range(of: $0, options: [.regularExpression, .caseInsensitive]) != nil
            } ?? false
            let advancedMatch = !rule.advancedPattern.isEmpty &&
                comment.range(of: rule.advancedPattern, options: [.regularExpression, .caseInsensitive]) != nil
            return keywordMatch || referenceMatch || advancedMatch ? rule.name : nil
        }
    }

    public static func callStatus(worked: Bool, newBand: Bool, newMode: Bool, confirmedBandMode: Bool) -> String {
        if !worked { return "New Call" }
        if confirmedBandMode { return "Confirmed" }
        if newBand && newMode { return "New Band+Mode" }
        if newBand { return "New Band" }
        if newMode { return "New Mode" }
        return "Worked"
    }

    public static func callStatus(worked: Bool, bandWorked: Bool, modeWorked: Bool,
                                  bandModeWorked: Bool, confirmedBandMode: Bool) -> String {
        let newBand = !bandWorked
        // Once the band has been worked, "new mode" means this mode is new on
        // this band. On a new band, retain the OM0RX New Band+Mode distinction
        // only when the mode itself has never been worked for this callsign.
        let newMode = bandWorked ? !bandModeWorked : !modeWorked
        return callStatus(worked: worked, newBand: newBand, newMode: newMode, confirmedBandMode: confirmedBandMode)
    }

    public static func dxccStatus(worked: Bool, confirmed: Bool, newBand: Bool, newMode: Bool, confirmedBandMode: Bool) -> String {
        if !worked { return "ATNO" }
        if confirmedBandMode { return "Confirmed" }
        let prefix = confirmed ? "C" : "W"
        if newBand && newMode { return "\(prefix)/New Band+Mode" }
        if newBand { return "\(prefix)/New Band" }
        if newMode { return "\(prefix)/New Mode" }
        return "Worked"
    }

    public static func score(callStatus: String, dxccStatus: String, specials: [String], source: String) -> (Int, [String]) {
        let dxcc: [String: Int] = ["ATNO": 85, "C/New Band+Mode": 68, "W/New Band+Mode": 62, "C/New Band": 58, "W/New Band": 52, "C/New Mode": 48, "W/New Mode": 42, "Worked": 18, "Confirmed": 8]
        let call: [String: Int] = ["New Call": 42, "New Band+Mode": 34, "New Band": 28, "New Mode": 22, "Worked": 8, "Confirmed": 4]
        var reasons: [String] = []
        var value = max(dxcc[dxccStatus] ?? 0, call[callStatus] ?? 0)
        if value > 0 { reasons.append(dxcc[dxccStatus] ?? 0 >= call[callStatus] ?? 0 ? dxccStatus : callStatus) }
        if !specials.isEmpty { value += 14; reasons.append(specials.joined(separator: ", ")) }
        if source == "rbl" { value += 5; reasons.append("RBN source") }
        return (min(value, 100), reasons)
    }
}

public enum ClusterLineParser {
    /// Reject oversized input before control filtering, allocation, or regular expressions.
    public static let maximumLineBytes = 4_096
    /// kHz; covers amateur microwave bands through 300 GHz.
    public static let maximumFrequencyKHz = 300_000_000.0

    private static func validFrequency(_ value: Double) -> Bool {
        value.isFinite && value > 0 && value <= maximumFrequencyKHz
    }
    private static let liveExpression = try! NSRegularExpression(
        pattern: #"^DX de\s+(\S+):\s+(\d+(?:\.\d+)?)\s+([A-Z0-9][A-Z0-9/-]*)\s*(.*)$"#,
        options: [.caseInsensitive]
    )
    private static let historyExpression = try! NSRegularExpression(
        pattern: #"^\s*(\d+(?:\.\d+)?)\s+([A-Z0-9][A-Z0-9/-]*)\s+(\d{1,2}-[A-Z]{3}-\d{4})\s+((?:[01]\d|2[0-3])[0-5]\d)Z(?:\s+(.*?))?\s*<([^<>]+)>\s*$"#,
        options: [.caseInsensitive]
    )

    public static func parse(_ line: String, clusterID: UUID, clusterName: String, at date: Date = Date()) -> RawSpot? {
        guard line.utf8.count <= maximumLineBytes else { return nil }
        let cleaned = line.unicodeScalars.filter { $0.value >= 0x20 && $0.value != 0x7f }.map(String.init).joined()
        let range = NSRange(cleaned.startIndex..<cleaned.endIndex, in: cleaned)
        if let match = liveExpression.firstMatch(in: cleaned, range: range), match.numberOfRanges == 5,
              let spotterRange = Range(match.range(at: 1), in: cleaned),
              let frequencyRange = Range(match.range(at: 2), in: cleaned),
              let callRange = Range(match.range(at: 3), in: cleaned),
              let frequency = Double(cleaned[frequencyRange]), validFrequency(frequency) {
            let commentRange = Range(match.range(at: 4), in: cleaned)
            let rawComment = commentRange.map { String(cleaned[$0]).trimmingCharacters(in: .whitespaces) } ?? ""
            let comment = rawComment.replacingOccurrences(
                of: #"(?:^|\s)(?:[01]\d|2[0-3])[0-5]\dZ\s*$"#,
                with: "",
                options: [.regularExpression, .caseInsensitive]
            ).trimmingCharacters(in: .whitespaces)
            return RawSpot(clusterID: clusterID, clusterName: clusterName, spotter: String(cleaned[spotterRange]),
                           frequencyKHz: frequency, frequencyText: String(cleaned[frequencyRange]),
                           callsign: String(cleaned[callRange]).uppercased(),
                           comment: comment,
                           receivedAt: date)
        }

        guard let match = historyExpression.firstMatch(in: cleaned, range: range), match.numberOfRanges == 7,
              let frequencyRange = Range(match.range(at: 1), in: cleaned),
              let callRange = Range(match.range(at: 2), in: cleaned),
              let dayRange = Range(match.range(at: 3), in: cleaned),
              let timeRange = Range(match.range(at: 4), in: cleaned),
              let spotterRange = Range(match.range(at: 6), in: cleaned),
              let frequency = Double(cleaned[frequencyRange]), validFrequency(frequency) else { return nil }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "d-MMM-yyyy HHmm'Z'"
        formatter.isLenient = false
        guard let receivedAt = formatter.date(from: "\(cleaned[dayRange]) \(cleaned[timeRange])Z") else { return nil }
        let commentRange = Range(match.range(at: 5), in: cleaned)
        let comment = commentRange.map { String(cleaned[$0]).trimmingCharacters(in: .whitespaces) } ?? ""
        return RawSpot(clusterID: clusterID, clusterName: clusterName,
                       spotter: String(cleaned[spotterRange]).trimmingCharacters(in: .whitespaces),
                       frequencyKHz: frequency, frequencyText: String(cleaned[frequencyRange]),
                       callsign: String(cleaned[callRange]).uppercased(), comment: comment, receivedAt: receivedAt)
    }
}

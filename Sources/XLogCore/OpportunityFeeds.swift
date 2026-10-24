import Foundation

/// Normalized, read-only evidence from a named public source. No item implies
/// permission to tune, transmit, or submit a spot to its publisher.
public struct PublicOpportunity: Codable, Equatable, Sendable {
    public var id: String
    public var kind: String
    public var callsign: String
    public var reference: String
    public var name: String
    public var frequencyHz: Int64?
    public var mode: String
    public var observedAt: Date
    public var expiresAt: Date
    public var source: String
    public var sourceURL: String
    public var comment: String
    public var latitude: Double?
    public var longitude: Double?
    public var startsAt: Date?
    public var endsAt: Date?
    public var callsigns: [String]?
    public var qslRoute: String?

    public init(id: String, kind: String, callsign: String, reference: String, name: String,
                frequencyHz: Int64?, mode: String, observedAt: Date, expiresAt: Date,
                source: String, sourceURL: String, comment: String, latitude: Double? = nil, longitude: Double? = nil,
                startsAt: Date? = nil, endsAt: Date? = nil, callsigns: [String]? = nil, qslRoute: String? = nil) {
        self.id = id; self.kind = kind; self.callsign = callsign; self.reference = reference
        self.name = name; self.frequencyHz = frequencyHz; self.mode = mode
        self.observedAt = observedAt; self.expiresAt = expiresAt
        self.source = source; self.sourceURL = sourceURL; self.comment = comment
        self.latitude = latitude; self.longitude = longitude
        self.startsAt = startsAt; self.endsAt = endsAt; self.callsigns = callsigns
        self.qslRoute = qslRoute
    }
}

public enum OpportunityFeedError: Error, Equatable {
    case invalidBody
    case schemaChanged
    case noUsableRows
}

public enum OpportunityFeedParser {
    public static func parse(_ data: Data, source: String, observedAt: Date) throws -> [PublicOpportunity] {
        if source == "adxo" { return try adxo(data, observedAt: observedAt) }
        guard (1...2_097_152).contains(data.count),
              let raw = try? JSONSerialization.jsonObject(with: data),
              let rows = rows(raw), rows.count <= 2_000 else {
            throw OpportunityFeedError.invalidBody
        }
        guard ["pota", "sota", "wwff", "wwbota", "425dxn"].contains(source) else { throw OpportunityFeedError.invalidBody }
        if rows.isEmpty { return [] }
        if source == "425dxn" { return try calendar(rows, observedAt: observedAt) }
        let url = sourceURL(source)
        let opportunities: [PublicOpportunity] = rows.flatMap { row -> [PublicOpportunity] in
            let call = clean(row["activator"] ?? row["activatorCallsign"] ?? row["callsign"] ?? row["call"], max: 28).uppercased()
            guard validCall(call), let hz = frequency(row) else { return [] }
            let when = date(row["spotTime"] ?? row["timeStamp"] ?? row["spot_time"] ?? row["spot_time_formatted"] ?? row["time"] ?? row["observedUtc"]) ?? observedAt
            let mode = clean(row["mode"], max: 20).uppercased()
            let comment = clean(row["comments"] ?? row["comment"] ?? row["remarks"], max: 320)
            let places: [[String: Any]] = source == "wwbota" ?
                ((row["references"] as? [[String: Any]])?.prefix(50).map { $0 } ?? [row]) : [row]
            return places.compactMap { place in
                let reference = clean(place["reference"] ?? place["summitCode"] ?? place["ref"], max: 40).uppercased().replacingOccurrences(of: " ", with: "")
                guard !reference.isEmpty else { return nil }
                let name = clean(place["name"] ?? place["summitName"] ?? place["reference_name"] ?? place["parkName"], max: 180)
                let identity = "\(source):\(call):\(reference):\(hz):\(Int(when.timeIntervalSince1970))"
                return PublicOpportunity(id: identity, kind: source, callsign: call, reference: reference,
                    name: name, frequencyHz: hz, mode: mode, observedAt: when,
                    expiresAt: when.addingTimeInterval(source == "pota" ? 1_800 : 3_600),
                    source: source.uppercased() + " official spots", sourceURL: url, comment: comment,
                    latitude: coordinate(place["latitude"], limit: 90), longitude: coordinate(place["longitude"], limit: 180))
            }
        }
        guard !opportunities.isEmpty else { throw OpportunityFeedError.noUsableRows }
        return Array(Dictionary(opportunities.prefix(2_000).map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first }).values)
            .sorted { $0.observedAt > $1.observedAt }
    }

    private static func calendar(_ rows: [[String: Any]], observedAt: Date) throws -> [PublicOpportunity] {
        let validShape = rows.filter { $0["cal"] is String && $0["from"] is String && $0["to"] is String }.count
        guard validShape > 0, Double(rows.count - validShape) / Double(rows.count) < 0.1 else {
            throw OpportunityFeedError.schemaChanged
        }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd"
        let calls = try NSRegularExpression(pattern: #"\b[A-Z0-9]+(?:/[A-Z0-9]+)*\b"#)
        var found: [PublicOpportunity] = []
        for row in rows {
            let title = clean(row["cal"], max: 240)
            guard let start = formatter.date(from: clean(row["from"], max: 10)),
                  let end = formatter.date(from: clean(row["to"], max: 10)), end >= start else { continue }
            let head = String(title.split(separator: ":", maxSplits: 1).first ?? "")
            let range = NSRange(head.startIndex..<head.endIndex, in: head)
            let aliases = calls.matches(in: head.uppercased(), range: range).compactMap { match -> String? in
                guard let r = Range(match.range, in: head) else { return nil }
                let value = String(head[r]).uppercased()
                return validCall(value) ? value : nil
            }
            guard let call = aliases.first else { continue }
            let special = title.range(of: #"special|commemor|anniversar|award|celebrat|memorial"#,
                                      options: [.regularExpression, .caseInsensitive]) != nil
            let dayEnd = end.addingTimeInterval(86_400 - 0.001)
            found.append(PublicOpportunity(id: "425dxn:\(formatter.string(from: start)):\(formatter.string(from: end)):\(call):\(title)",
                kind: special ? "special_event" : "dxpedition", callsign: call, reference: iotaReference(in: title) ?? "",
                name: title, frequencyHz: nil, mode: "", observedAt: observedAt,
                expiresAt: dayEnd, source: "425DXN Worldwide DX Calendar",
                sourceURL: "https://www.425dxn.org/index.php?op=wcal", comment: "",
                startsAt: start, endsAt: dayEnd, callsigns: aliases))
        }
        guard !found.isEmpty else { throw OpportunityFeedError.noUsableRows }
        return found.sorted { $0.expiresAt < $1.expiresAt }
    }

    /// NG3K's supported public text view is HTML, but its operation records are
    /// deliberately labelled fields. Parse those labels instead of scraping
    /// presentation columns or executing remote code.
    private static func adxo(_ data: Data, observedAt: Date) throws -> [PublicOpportunity] {
        guard (1...2_097_152).contains(data.count), let html = String(data: data, encoding: .utf8) else {
            throw OpportunityFeedError.invalidBody
        }
        var text = html.replacingOccurrences(of: #"(?i)<br\s*/?>|</(?:p|div|li|tr|td|h[1-6])>"#,
                                             with: "\n", options: .regularExpression)
        text = text.replacingOccurrences(of: #"(?s)<script\b.*?</script>|<style\b.*?</style>"#,
                                         with: "", options: .regularExpression)
        text = text.replacingOccurrences(of: #"<[^>]{0,200}>"#, with: "", options: .regularExpression)
        for (entity, value) in [("&amp;", "&"), ("&lt;", "<"), ("&gt;", ">"), ("&quot;", "\""), ("&#39;", "'")]
        { text = text.replacingOccurrences(of: entity, with: value) }
        let lines = text.components(separatedBy: .newlines).map { clean($0, max: 800) }.filter { !$0.isEmpty }
        let datePattern = try NSRegularExpression(pattern: #"^([A-Z][a-z]{2})\s+(\d{1,2})(?:,\s*(\d{4}))?\s*-\s*(?:([A-Z][a-z]{2})\s+)?(\d{1,2}),\s*(\d{4})$"#)
        let callPattern = try NSRegularExpression(pattern: #"[A-Z0-9]+(?:/[A-Z0-9]+)*"#)
        let formatter = DateFormatter(); formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0); formatter.dateFormat = "MMM d yyyy"
        formatter.isLenient = false
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        var rows: [PublicOpportunity] = []
        var recognizedRows = 0
        var index = 0
        while index < lines.count {
            let line = lines[index], range = NSRange(line.startIndex..<line.endIndex, in: line)
            guard let match = datePattern.firstMatch(in: line, range: range) else { index += 1; continue }
            func group(_ number: Int) -> String? {
                guard match.range(at: number).location != NSNotFound, let value = Range(match.range(at: number), in: line) else { return nil }
                return String(line[value])
            }
            let startMonth = group(1)!, startDay = group(2)!, endMonth = group(4) ?? startMonth, endDay = group(5)!, endYear = Int(group(6)!)!
            guard let startMonthDate = formatter.date(from: "\(startMonth) 1 \(endYear)"),
                  let endMonthDate = formatter.date(from: "\(endMonth) 1 \(endYear)") else { index += 1; continue }
            let startYear = group(3).flatMap(Int.init) ?? (calendar.component(.month, from: startMonthDate) >
                calendar.component(.month, from: endMonthDate) ? endYear - 1 : endYear)
            guard let start = formatter.date(from: "\(startMonth) \(startDay) \(startYear)"),
                  let end = formatter.date(from: "\(endMonth) \(endDay) \(endYear)"), end >= start else { index += 1; continue }
            var fields: [String: String] = [:]
            index += 1
            while index < lines.count {
                let next = lines[index], nextRange = NSRange(next.startIndex..<next.endIndex, in: next)
                if datePattern.firstMatch(in: next, range: nextRange) != nil { break }
                for key in ["DXCC", "Callsign", "QSL", "Source", "Info"] where next.hasPrefix("\(key):") {
                    fields[key] = clean(String(next.dropFirst(key.count + 1)), max: key == "Info" ? 600 : 240)
                }
                index += 1
            }
            guard let rawCall = fields["Callsign"] else { continue }
            let upperCall = rawCall.uppercased()
            let callRange = NSRange(upperCall.startIndex..<upperCall.endIndex, in: upperCall)
            let aliases = callPattern.matches(in: upperCall, range: callRange).compactMap { result -> String? in
                guard let value = Range(result.range, in: upperCall) else { return nil }
                let call = String(upperCall[value]); return validCall(call) ? call : nil
            }
            guard let call = aliases.first else { continue }
            recognizedRows += 1
            let endOfDay = end.addingTimeInterval(86_400 - 0.001)
            let horizon = calendar.date(byAdding: .day, value: 30, to: calendar.startOfDay(for: observedAt))!
            guard endOfDay >= calendar.startOfDay(for: observedAt), start <= horizon else { continue }
            let day = formatter.string(from: start).replacingOccurrences(of: " ", with: "-")
            rows.append(PublicOpportunity(id: "adxo:\(day):\(call)", kind: "dxpedition", callsign: call,
                reference: "", name: fields["DXCC"] ?? "", frequencyHz: nil, mode: "", observedAt: observedAt,
                expiresAt: endOfDay, source: "NG3K ADXO", sourceURL: sourceURL("adxo"), comment: fields["Info"] ?? "",
                startsAt: start, endsAt: endOfDay, callsigns: aliases, qslRoute: fields["QSL"]))
        }
        guard recognizedRows > 0 else { throw OpportunityFeedError.noUsableRows }
        return Array(rows.prefix(500))
    }

    /// Only explicit programme references; never infer an island from a prefix.
    public static func iotaReference(in text: String) -> String? {
        guard let range = text.range(of: #"\b(?:AF|AN|AS|EU|NA|OC|SA)-\d{3}\b"#, options: [.regularExpression, .caseInsensitive]) else { return nil }
        return String(text[range]).uppercased()
    }

    private static func rows(_ raw: Any) -> [[String: Any]]? {
        if let rows = raw as? [[String: Any]] { return rows }
        guard let object = raw as? [String: Any] else { return nil }
        return object["data"] as? [[String: Any]] ?? object["spots"] as? [[String: Any]]
    }
    private static func clean(_ raw: Any?, max: Int) -> String {
        String(describing: raw ?? "").components(separatedBy: .controlCharacters).joined(separator: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines).prefix(max).description
    }
    private static func validCall(_ call: String) -> Bool {
        (3...28).contains(call.count) && call.range(of: #"^[A-Z0-9/]+$"#, options: .regularExpression) != nil
            && call.rangeOfCharacter(from: .decimalDigits) != nil
            && call.rangeOfCharacter(from: .letters) != nil
    }
    private static func frequency(_ row: [String: Any]) -> Int64? {
        let raw = row["frequencyHz"] ?? row["frequency_khz"] ?? row["frequencyKhz"] ?? row["frequency"] ?? row["frequencyMhz"] ?? row["freq"]
        guard let raw, let number = Double(String(describing: raw)), number.isFinite else { return nil }
        let scale: Double = row["frequencyHz"] != nil ? 1 : row["frequencyMhz"] != nil || row["freq"] != nil ? 1_000_000 : number < 1_000 ? 1_000_000 : 1_000
        let hz = number * scale
        guard hz >= 100_000, hz <= 1_000_000_000 else { return nil }
        return Int64(hz.rounded())
    }
    private static func date(_ raw: Any?) -> Date? {
        guard let raw else { return nil }
        if let seconds = raw as? NSNumber, seconds.doubleValue.isFinite,
           seconds.doubleValue > 0, seconds.doubleValue < 32_503_680_000 {
            return Date(timeIntervalSince1970: seconds.doubleValue)
        }
        let value = String(describing: raw)
        let formatter = ISO8601DateFormatter()
        if let date = formatter.date(from: value) { return date }
        formatter.formatOptions.insert(.withFractionalSeconds)
        if let date = formatter.date(from: value) { return date }
        // POTA publishes UTC timestamps without a zone suffix.
        if value.range(of: #"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$"#, options: .regularExpression) != nil {
            formatter.formatOptions.remove(.withFractionalSeconds)
            if let date = formatter.date(from: value + "Z") { return date }
            formatter.formatOptions.insert(.withFractionalSeconds)
            return formatter.date(from: value + "Z")
        }
        return nil
    }

    private static func coordinate(_ raw: Any?, limit: Double) -> Double? {
        guard let raw, let number = Double(String(describing: raw)), number.isFinite, abs(number) <= limit else { return nil }
        return number
    }
    public static func sourceURL(_ source: String) -> String {
        switch source {
        case "pota": return "https://api.pota.app/spot/activator"
        case "sota": return "https://api2.sota.org.uk/api/spots/50/all/all"
        case "wwff": return "https://spots.wwff.co/static/spots.json"
        case "wwbota": return "https://api.wwbota.org/spots/?age=3"
        case "adxo": return "https://www.ng3k.com/Misc/adxoplain.html"
        default: return "https://www.425dxn.org/dx4win.php"
        }
    }
}

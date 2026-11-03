import Foundation

/// One native, parameter-bound predicate for list, count and frozen exports.
/// Quick text deliberately retains the shipped LIKE semantics. Clause text is literal.
public struct LogbookQuery: Codable, Equatable, Hashable, Sendable {
    public var version: Int = 1
    public var join: String = "all"
    public var clauses: [Clause] = []
    public struct Clause: Codable, Equatable, Hashable, Sendable {
        public var field: String
        public var op: String
        public var values: [String]
        public init(_ field: String, _ op: String, _ values: [String] = []) {
            self.field = field; self.op = op; self.values = values
        }
    }
    public init(join: String = "all", clauses: [Clause] = []) { self.join = join; self.clauses = clauses }
    public enum Failure: Error, LocalizedError {
        case invalid(String)
        public var errorDescription: String? { if case .invalid(let message) = self { return message }; return nil }
    }
    enum Binding { case text(String), number(Double) }
    struct Predicate { var sql: String; var bindings: [Binding] }
    private static let fields = [
        "id": "id", "stationCall": "myCall", "operatorCall": "operatorCall", "ownLocation": "stationLocation", "ownGrid": "myGrid",
        "call": "call", "dxcc": "dxcc", "band": "band", "mode": "mode", "submode": "submode",
        "power": "txPower", "paper": "qslReceived", "lotw": "lotwReceived", "qslRoute": "qslVia",
        "iota": "iota", "pota": "potaReference", "sota": "sotaReference", "wwff": "wwffReference",
        "continent": "continent", "cqZone": "cqZone", "ituZone": "ituZone", "grid": "gridSquare", "state": "state"
    ]
    private static let extras = ["ownDXCC": "MY_DXCC", "eqsl": "EQSL_QSL_RCVD",
        "ownPota": "MY_POTA_REF", "ownSota": "MY_SOTA_REF", "ownIota": "MY_IOTA", "ownWWFF": "MY_WWFF_REF",
        "ownActivation": "MY_SIG_INFO", "portableContext": "APP_OM0RXXLOG_PORTABLE_SESSION"]
    public func validate() throws { _ = try compile(search: "", at: Date(timeIntervalSince1970: 0)) }
    public static func absoluteUTCDate(_ raw: String) -> Date? {
        guard raw.hasSuffix("Z"), !raw.contains("\0") else { return nil }
        let parser=ISO8601DateFormatter()
        parser.formatOptions=[.withInternetDateTime,.withFractionalSeconds]
        if let value=parser.date(from:raw) { return value }
        parser.formatOptions=[.withInternetDateTime]
        return parser.date(from:raw)
    }
    func compile(search: String, at now: Date) throws -> Predicate {
        func reject(_ detail: String) -> Failure { .invalid("Invalid contact filter: " + detail) }
        func fieldValue(_ path:String) -> String {
            // Older JSON1 versions truncate extracted strings at embedded NUL.
            // Only those rare records use the complete typed Foundation parser.
            "CASE WHEN instr(record_json,'\\u0000')>0 THEN xlog_query_field(record_json,'\(path)') ELSE json_extract(record_json,'$.\(path)') END"
        }
        guard version == 1, ["all", "any"].contains(join), clauses.count <= 24,
              search.utf8.count <= 512, now.timeIntervalSince1970.isFinite else { throw reject("unsupported version or bounds.") }
        var groups: [String] = [], bindings: [Binding] = []
        let text = search.trimmingCharacters(in: .whitespacesAndNewlines)
        if !text.isEmpty {
            groups.append("(call LIKE ? OR record_json LIKE ?)")
            bindings += [.text("%\(text)%"), .text("%\(text)%")]
        }
        var conditions: [String] = []
        for clause in clauses {
            guard clause.values.count <= (clause.field == "id" ? 128 : 32), clause.values.allSatisfy({ $0.utf8.count <= 256 && !$0.contains("\0") }) else { throw reject("too many or oversized values.") }
            let numeric = ["dxcc", "ownDXCC", "power", "cqZone", "ituZone"].contains(clause.field)
            let date = clause.field == "date"
            let raw: String
            if date { raw = "qso_start" }
            else if clause.field == "modeGroup" {
                let mode=fieldValue("mode")
                raw = "CASE WHEN NULLIF(xlog_query_text(\(mode)),'') IS NULL THEN NULL WHEN xlog_query_text(\(mode))='CW' THEN 'CW' WHEN xlog_query_text(\(mode)) IN ('SSB','AM','FM','PHONE','USB','LSB') THEN 'PHONE' ELSE 'DATA' END"
            } else if let field = Self.fields[clause.field] {
                let direct=fieldValue(field)
                if ["pota","sota","wwff"].contains(clause.field) {
                    raw="COALESCE(NULLIF(TRIM(\(direct)),''),CASE WHEN UPPER(\(fieldValue("sig")))='\(clause.field.uppercased())' THEN \(fieldValue("sigInfo")) END)"
                } else { raw=direct }
            }
            else if let field = Self.extras[clause.field] {
                let direct=fieldValue("extraFields.\(field)")
                if ["ownPota","ownSota","ownWWFF","ownIota"].contains(clause.field) {
                    let programme=String(clause.field.dropFirst(3)).uppercased()
                    raw="COALESCE(NULLIF(TRIM(\(direct)),''),CASE WHEN UPPER(\(fieldValue("extraFields.MY_SIG")))='\(programme)' THEN \(fieldValue("extraFields.MY_SIG_INFO")) END)"
                } else { raw=direct }
            }
            else { throw reject("unknown field \(clause.field).") }
            let expression = date ? raw : numeric ? "xlog_query_number(\(raw))" : "NULLIF(xlog_query_text(\(raw)),'')"
            if ["set", "unset"].contains(clause.op) {
                guard clause.values.isEmpty else { throw reject("is-set has no value.") }
                conditions.append("\(expression) IS \(clause.op == "set" ? "NOT " : "")NULL"); continue
            }
            if clause.op == "relative" {
                guard date, (1...2).contains(clause.values.count) else { throw reject("relative periods require a UTC date.") }
                var calendar = Calendar(identifier: .gregorian); calendar.timeZone = TimeZone(secondsFromGMT: 0)!
                let today = calendar.startOfDay(for: now)
                let start: Date, end: Date
                switch clause.values[0] {
                case "today": start = today; end = today.addingTimeInterval(86400)
                case "previousDay": start = today.addingTimeInterval(-86400); end = today
                case "thisYear":
                    start = calendar.date(from: calendar.dateComponents([.year], from: now))!
                    end = calendar.date(byAdding: .year, value: 1, to: start)!
                case "lastDays":
                    guard clause.values.count == 2, let days = Int(clause.values[1]), (1...3660).contains(days) else { throw reject("last days must be 1–3660.") }
                    start = today.addingTimeInterval(Double(1-days)*86400); end = today.addingTimeInterval(86400)
                default: throw reject("unknown UTC period.")
                }
                conditions.append("(\(expression) >= ? AND \(expression) < ?)")
                bindings += [.number(start.timeIntervalSince1970), .number(end.timeIntervalSince1970)]; continue
            }
            func value(_ string: String) throws -> Binding {
                if date {
                    guard let date = Self.absoluteUTCDate(string) else { throw reject("dates require an absolute ISO UTC timestamp ending in Z.") }
                    return .number(date.timeIntervalSince1970)
                }
                if numeric {
                    guard let number = Double(string), number.isFinite else { throw reject("a finite number is required.") }
                    return .number(number)
                }
                return .text(string.trimmingCharacters(in: .whitespacesAndNewlines).uppercased())
            }
            if ["iota","pota","sota","wwff","ownPota","ownSota","ownWWFF","ownIota","ownActivation"].contains(clause.field),["eq","ne","in"].contains(clause.op) {
                guard !clause.values.isEmpty, clause.op == "in" || clause.values.count == 1 else { throw reject("reference selection requires values.") }
                let placeholders=Array(repeating:"?",count:clause.values.count).joined(separator:",")
                let membership="EXISTS (SELECT 1 FROM json_each(xlog_query_references(\(raw),'\(clause.field)')) WHERE value IN (\(placeholders)))"
                conditions.append(clause.op == "ne" ? "(\(expression) IS NOT NULL AND NOT \(membership))" : membership)
                bindings += try clause.values.map(value)
                continue
            }
            switch clause.op {
            case "eq", "ne", "gt", "gte", "lt", "lte":
                guard clause.values.count == 1, ["eq", "ne"].contains(clause.op) || numeric || date else { throw reject("operator does not match field type.") }
                let op = ["eq":"=", "ne":"<>", "gt":">", "gte":">=", "lt":"<", "lte":"<="][clause.op]!
                conditions.append("\(expression) \(op) ?"); bindings.append(try value(clause.values[0]))
            case "in":
                guard !date, !clause.values.isEmpty else { throw reject("one-of requires values.") }
                conditions.append("\(expression) IN (\(Array(repeating: "?", count: clause.values.count).joined(separator: ",")))")
                bindings += try clause.values.map(value)
            case "between":
                guard numeric || date, clause.values.count == 2 else { throw reject("range requires two numeric or UTC endpoints.") }
                let values = try clause.values.map(value)
                if case .number(let a) = values[0], case .number(let b) = values[1], a > b { throw reject("range endpoints are reversed.") }
                conditions.append("\(expression) BETWEEN ? AND ?"); bindings += values
            case "contains", "starts":
                guard !numeric, !date, clause.values.count == 1 else { throw reject("literal text is required.") }
                conditions.append(clause.op == "contains" ? "INSTR(\(expression),?) > 0" : "INSTR(\(expression),?) = 1")
                bindings.append(try value(clause.values[0]))
            default: throw reject("unknown operator \(clause.op).")
            }
        }
        if !conditions.isEmpty { groups.append("(" + conditions.joined(separator: join == "all" ? " AND " : " OR ") + ")") }
        return Predicate(sql: (["deleted_at IS NULL"] + groups).joined(separator: " AND "), bindings: bindings)
    }
}

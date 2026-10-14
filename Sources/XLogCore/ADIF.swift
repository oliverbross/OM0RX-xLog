import Foundation

private struct ADIFMetadataKey: CodingKey {
    let stringValue: String
    var intValue: Int? { nil }
    init?(stringValue: String) { self.stringValue = stringValue }
    init?(intValue: Int) { return nil }
}
private func checkMetadataKeys(_ decoder: Decoder, allowed: Set<String>) throws {
    let keys = try decoder.container(keyedBy: ADIFMetadataKey.self).allKeys.map(\.stringValue)
    guard Set(keys).isSubset(of: allowed) else { throw ADIFPlanningError.invalidPreview }
}

/// Comparison-only canonical pieces; original field/declaration text is retained.
private struct ADIFMetadataDecimal {
    let negative: Bool
    let integer: String
    let fraction: String
    init(_ value: String) throws {
        guard value.utf8.count <= 16_384 else { throw ADIFPlanningError.invalidPreview }
        let signed = value.hasPrefix("-")
        let parts = (signed ? String(value.dropFirst()) : value).split(separator: ".", omittingEmptySubsequences: false)
        let digits = String(parts[0].drop(while: { $0 == "0" }))
        integer = digits.isEmpty ? "0" : digits
        fraction = parts.count == 2 ? String(String(parts[1]).reversed().drop(while: { $0 == "0" }).reversed()) : ""
        negative = signed && (integer != "0" || !fraction.isEmpty)
    }
    static func compare(_ left: String, _ right: String) throws -> Int {
        let a = try Self(left), b = try Self(right)
        if a.negative != b.negative { return a.negative ? -1 : 1 }
        var magnitude = a.integer.count == b.integer.count ? (a.integer < b.integer ? -1 : a.integer > b.integer ? 1 : 0) : a.integer.count < b.integer.count ? -1 : 1
        if magnitude == 0 {
            let length = max(a.fraction.count, b.fraction.count)
            let first = a.fraction.padding(toLength: length, withPad: "0", startingAt: 0)
            let second = b.fraction.padding(toLength: length, withPad: "0", startingAt: 0)
            magnitude = first < second ? -1 : first > second ? 1 : 0
        }
        return a.negative ? -magnitude : magnitude
    }
}

private func adifExtensionRange(type: String, declaration: [String: String]) throws -> (String, String)? {
    guard let range = declaration["RANGE"] else { return nil }
    let pattern = #"^\{(-?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)):(-?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+))\}$"#
    guard ["N", "I"].contains(type.uppercased()), declaration["ENUM"] == nil,
          range.range(of: pattern, options: .regularExpression) == range.startIndex..<range.endIndex else { throw ADIFPlanningError.invalidPreview }
    let bounds = range.dropFirst().dropLast().split(separator: ":", omittingEmptySubsequences: false).map(String.init)
    guard try ADIFMetadataDecimal.compare(bounds[0], bounds[1]) < 0 else { throw ADIFPlanningError.invalidPreview }
    return (bounds[0], bounds[1])
}

/// Versioned per-record ADX identity/declarations, carried beside ordinary fields.
/// No ADIF field name is reserved or repurposed for this contract.
public struct ADIFFieldMetadata: Codable, Equatable, Hashable, Sendable {
    // Schema identity fence, not an expansion of the editable field catalogue.
    private static let standardNames = Set("""
    ADDRESS ADDRESS_INTL AGE ALTITUDE A_INDEX ANT_AZ ANT_EL ANT_PATH ARRL_SECT AWARD_SUBMITTED AWARD_GRANTED BAND BAND_RX CALL CHECK CLASS
    CLUBLOG_QSO_UPLOAD_DATE CLUBLOG_QSO_UPLOAD_STATUS CNTY CNTY_ALT COMMENT COMMENT_INTL CONT CONTACTED_OP CONTEST_ID COUNTRY COUNTRY_INTL CQZ CREDIT_SUBMITTED CREDIT_GRANTED
    DARC_DOK DCL_QSLRDATE DCL_QSLSDATE DCL_QSL_RCVD DCL_QSL_SENT DISTANCE DXCC EMAIL EQ_CALL EQSL_AG EQSL_QSLRDATE EQSL_QSLSDATE EQSL_QSL_RCVD EQSL_QSL_SENT
    FISTS FISTS_CC FORCE_INIT FREQ FREQ_RX GRIDSQUARE GRIDSQUARE_EXT HAMLOGEU_QSO_UPLOAD_DATE HAMLOGEU_QSO_UPLOAD_STATUS HAMQTH_QSO_UPLOAD_DATE HAMQTH_QSO_UPLOAD_STATUS
    HRDLOG_QSO_UPLOAD_DATE HRDLOG_QSO_UPLOAD_STATUS IOTA IOTA_ISLAND_ID ITUZ K_INDEX LAT LON LOTW_QSLRDATE LOTW_QSLSDATE LOTW_QSL_RCVD LOTW_QSL_SENT
    MAX_BURSTS MODE MORSE_KEY_INFO MORSE_KEY_TYPE MS_SHOWER MY_ALTITUDE MY_ANTENNA MY_ANTENNA_INTL MY_ARRL_SECT MY_CITY MY_CITY_INTL MY_CNTY MY_CNTY_ALT
    MY_COUNTRY MY_COUNTRY_INTL MY_CQ_ZONE MY_DARC_DOK MY_DXCC MY_FISTS MY_GRIDSQUARE MY_GRIDSQUARE_EXT MY_IOTA MY_IOTA_ISLAND_ID MY_ITU_ZONE MY_LAT MY_LON
    MY_MORSE_KEY_INFO MY_MORSE_KEY_TYPE MY_NAME MY_NAME_INTL MY_POSTAL_CODE MY_POSTAL_CODE_INTL MY_POTA_REF MY_RIG MY_RIG_INTL MY_SIG MY_SIG_INTL MY_SIG_INFO
    MY_SIG_INFO_INTL MY_SOTA_REF MY_STATE MY_STREET MY_STREET_INTL MY_USACA_COUNTIES MY_VUCC_GRIDS MY_WWFF_REF NAME NAME_INTL NOTES NOTES_INTL NR_BURSTS NR_PINGS
    OPERATOR OWNER_CALLSIGN PFX POTA_REF PRECEDENCE PROP_MODE PUBLIC_KEY QRZCOM_QSO_DOWNLOAD_DATE QRZCOM_QSO_DOWNLOAD_STATUS QRZCOM_QSO_UPLOAD_DATE QRZCOM_QSO_UPLOAD_STATUS
    QSLMSG QSLMSG_INTL QSLMSG_RCVD QSLRDATE QSLSDATE QSL_RCVD QSL_RCVD_VIA QSL_SENT QSL_SENT_VIA QSL_VIA QSO_COMPLETE QSO_DATE QSO_DATE_OFF QSO_RANDOM QTH QTH_INTL
    REGION RIG RIG_INTL RST_RCVD RST_SENT RX_PWR SAT_MODE SAT_NAME SFI SIG SIG_INTL SIG_INFO SIG_INFO_INTL SILENT_KEY SKCC SOTA_REF SRX SRX_STRING STATE STATION_CALLSIGN
    STX STX_STRING SUBMODE SWL TEN_TEN TIME_OFF TIME_ON TX_PWR UKSMG USACA_COUNTIES VUCC_GRIDS WEB WWFF_REF
    EOH EOR ADX HEADER RECORDS RECORD APP USERDEF ADIF_VER CREATED_TIMESTAMP PROGRAMID PROGRAMVERSION
    """.split(whereSeparator: \.isWhitespace).map(String.init))
    public struct ExtensionField: Codable, Equatable, Hashable, Sendable {
        public var kind: String
        public var attributes: [String: String]
        public var declaration: [String: String]?
        public init(kind: String, attributes: [String: String], declaration: [String: String]? = nil) {
            self.kind = kind; self.attributes = attributes; self.declaration = declaration
        }
        private enum CodingKeys: String, CodingKey { case kind, attributes, declaration }
        public init(from decoder: Decoder) throws {
            try checkMetadataKeys(decoder, allowed: ["kind", "attributes", "declaration"])
            let values = try decoder.container(keyedBy: CodingKeys.self)
            kind = try values.decode(String.self, forKey: .kind)
            attributes = try values.decode([String: String].self, forKey: .attributes)
            declaration = try values.decodeIfPresent([String: String].self, forKey: .declaration)
        }
    }
    public var version: Int
    public var extensions: [String: ExtensionField]
    public init(version: Int = 1, extensions: [String: ExtensionField]) { self.version = version; self.extensions = extensions }
    private enum CodingKeys: String, CodingKey { case version, extensions }
    public init(from decoder: Decoder) throws {
        try checkMetadataKeys(decoder, allowed: ["version", "extensions"])
        let values = try decoder.container(keyedBy: CodingKeys.self)
        version = try values.decode(Int.self, forKey: .version)
        extensions = try values.decode([String: ExtensionField].self, forKey: .extensions)
    }
    public func validate(fields: [String: String]) throws {
        guard version == 1, extensions.count <= 128,
              try JSONEncoder().encode(self).count <= 16_384 else { throw ADIFPlanningError.invalidPreview }
        func identifier(_ value: String) -> Bool {
            !value.isEmpty && value.utf8.allSatisfy { (65...90).contains($0) || (97...122).contains($0) || (48...57).contains($0) || $0 == 95 }
        }
        func typedValue(_ value: String, type: String?, declaration: [String: String]? = nil) throws {
            guard value.unicodeScalars.allSatisfy({ scalar in
                let code = scalar.value
                return code == 9 || code == 10 || code == 13 || (32...0xd7ff).contains(code) || (0xe000...0xfffd).contains(code) || (0x10000...0x10ffff).contains(code)
            }) else { throw ADIFPlanningError.invalidPreview }
            guard let type else { return }
            let normalized = type.uppercased()
            func matches(_ pattern: String) -> Bool { value.range(of: pattern, options: .regularExpression) != nil }
            guard type.utf8.count == 1, "BNSIDTMGEL".contains(normalized),
                  ["G", "M"].contains(normalized) || !value.contains("\r") && !value.contains("\n") else { throw ADIFPlanningError.invalidPreview }
            let valid: Bool
            switch normalized {
            case "S": valid = matches("^[ -~]*$")
            case "M": valid = matches("^[\\r\\n -~]*$")
            case "E": valid = matches("^[ -~]+$")
            case "B": valid = matches("^[yYnN]$")
            case "I": valid = matches("^-?[0-9]+$")
            case "N": valid = matches("^-?(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)$")
            case "T": valid = matches("^(?:[01][0-9]|2[0-3])(?:[0-5][0-9]){1,2}$")
            case "D":
                let formatter = DateFormatter(); formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.timeZone = TimeZone(secondsFromGMT: 0)
                formatter.dateFormat = "yyyyMMdd"; formatter.isLenient = false
                valid = matches("^(?:19[3-9][0-9]|[2-9][0-9]{3})(?:0[1-9]|1[0-2])(?:0[1-9]|[12][0-9]|3[01])$") && formatter.date(from: value).map { formatter.string(from: $0) == value } == true
            case "L": valid = matches("^[eEwWnNsS](?:0[0-9]{2}|1[0-7][0-9]|180) [0-5][0-9]\\.[0-9]{3}$")
            default: valid = true
            }
            guard valid else { throw ADIFPlanningError.invalidPreview }
            if let enumeration = declaration?["ENUM"] {
                guard normalized == "E", enumeration.range(of: #"^\{[ -~]*\}$"#, options: .regularExpression) != nil,
                      String(enumeration.dropFirst().dropLast()).components(separatedBy: ",").contains(value) else { throw ADIFPlanningError.invalidPreview }
            }
            if let declaration, let range = try adifExtensionRange(type: type, declaration: declaration) {
                guard try ADIFMetadataDecimal.compare(value, range.0) >= 0,
                      try ADIFMetadataDecimal.compare(value, range.1) <= 0 else { throw ADIFPlanningError.invalidPreview }
            }
        }
        var declarationIDs = Set<String>()
        for (key, item) in extensions {
            guard identifier(key), key == key.uppercased(), let name = item.attributes["FIELDNAME"], identifier(name),
                  item.attributes["TYPE"].map({ $0.utf8.count == 1 && "BNSIDTMGEL".contains($0.uppercased()) }) ?? true else { throw ADIFPlanningError.invalidPreview }
            if item.kind == "APP" {
                guard let program = item.attributes["PROGRAMID"], identifier(program), fields[key] != nil,
                      key == "APP_\(program)_\(name)".uppercased(), item.declaration == nil,
                      Set(item.attributes.keys).isSubset(of: ["PROGRAMID", "FIELDNAME", "TYPE"]) else { throw ADIFPlanningError.invalidPreview }
                try typedValue(fields[key]!, type: item.attributes["TYPE"])
            } else {
                guard item.kind == "USERDEF", key == name.uppercased(), !key.hasPrefix("APP_"),
                      !Self.standardNames.contains(key),
                      Set(item.attributes.keys) == ["FIELDNAME"] else { throw ADIFPlanningError.invalidPreview }
                if let declaration = item.declaration {
                    guard let id = declaration["FIELDID"], let number = UInt32(id), number > 0, String(number) == id,
                          declarationIDs.insert(id).inserted,
                          let type = declaration["TYPE"], type.utf8.count == 1, "BNSIDTMGEL".contains(type.uppercased()),
                          Set(declaration.keys).isSubset(of: ["FIELDID", "TYPE", "ENUM", "RANGE"]) else { throw ADIFPlanningError.invalidPreview }
                    _ = try adifExtensionRange(type: type, declaration: declaration)
                    if let enumeration = declaration["ENUM"] {
                        guard type.uppercased() == "E", !enumeration.contains("\r"), !enumeration.contains("\n"), enumeration.range(of: #"^\{[ -~]*\}$"#, options: .regularExpression) != nil else { throw ADIFPlanningError.invalidPreview }
                    }
                    if let value = fields[key] { try typedValue(value, type: type, declaration: declaration) }
                } else { throw ADIFPlanningError.invalidPreview }
            }
        }
    }
}

public struct ADIFRecord: Equatable, Sendable {
    public var fields: [String: String]
    public var fieldMetadata: ADIFFieldMetadata?

    public init(fields: [String: String], fieldMetadata: ADIFFieldMetadata? = nil) {
        self.fields = fields.reduce(into: [:]) { $0[$1.key.uppercased()] = $1.value }
        self.fieldMetadata = fieldMetadata
    }

    public subscript(_ name: String) -> String? { fields[name.uppercased()] }

    public var semanticIdentityHash: String? {
        guard
            let call = self["CALL"],
            let date = self["QSO_DATE_OFF"]?.nonEmpty ?? self["QSO_DATE"],
            let time = self["TIME_OFF"]?.nonEmpty ?? self["TIME_ON"],
            let band = self["BAND"],
            let mode = self["SUBMODE"]?.nonEmpty ?? self["MODE"]
        else { return nil }
        return SemanticQSOIdentity(
            call: call,
            timestamp: date + time,
            band: band,
            mode: mode,
            frequency: self["FREQ"] ?? ""
        ).sha256
    }

    public var adifDocument: String {
        let body = fields.keys.sorted().map { key in
            let value = fields[key] ?? ""
            return "<\(key):\(value.utf8.count)>\(value)"
        }.joined()
        return "<ADIF_VER:5>3.1.7<EOH>\r\n\(body)<EOR>\r\n"
    }
}

public struct ADIFParser: Sendable {
    public init() {}

    public func records(in text: String) -> [ADIFRecord] {
        let upper = text.uppercased()
        let bodyStart = upper.range(of: "<EOH>")?.upperBound ?? text.startIndex
        var records: [ADIFRecord] = []
        var fields: [String: String] = [:]
        var cursor = bodyStart

        while let open = text[cursor...].firstIndex(of: "<") {
            guard let close = text[open...].firstIndex(of: ">") else { break }
            let descriptor = String(text[text.index(after: open)..<close])
            let parts = descriptor.split(separator: ":", maxSplits: 2).map(String.init)
            let name = parts[0].uppercased()
            cursor = text.index(after: close)
            if name == "EOR" {
                if !fields.isEmpty { records.append(ADIFRecord(fields: fields)) }
                fields.removeAll(keepingCapacity: true)
                continue
            }
            guard parts.count >= 2, let length = Int(parts[1]), length >= 0 else { continue }
            guard let end = text.index(cursor, offsetBy: length, limitedBy: text.endIndex) else { break }
            fields[name] = String(text[cursor..<end])
            cursor = end
        }
        return records
    }

    public func removingKnownRecords(
        from text: String,
        knownFingerprints: Set<String>
    ) -> (adif: String, records: [ADIFRecord]) {
        guard let eoh = text.range(of: "<EOH>", options: .caseInsensitive) else {
            let parsed = records(in: text)
            let retained = parsed.filter { record in
                guard let hash = record.semanticIdentityHash else { return true }
                return !knownFingerprints.contains(hash)
            }
            return retained.count == parsed.count ? (text, retained) : ("", retained)
        }

        var output = String(text[..<eoh.upperBound]) + "\r\n"
        var retained: [ADIFRecord] = []
        var cursor = eoh.upperBound
        while let eor = text.range(of: "<EOR>", options: .caseInsensitive, range: cursor..<text.endIndex) {
            let block = String(text[cursor..<eor.upperBound])
            if let record = records(in: block).first {
                let isKnown = record.semanticIdentityHash.map(knownFingerprints.contains) ?? false
                if !isKnown {
                    output += block + "\r\n"
                    retained.append(record)
                }
            }
            cursor = eor.upperBound
        }
        return (output, retained)
    }
}

public extension WavelogQSOCreate {
    init?(adif record: ADIFRecord) {
        guard
            let call = record["CALL"]?.nonEmpty,
            let band = record["BAND"]?.nonEmpty,
            let mode = record["MODE"]?.nonEmpty,
            let rawDate = record["QSO_DATE"], rawDate.count == 8,
            let time = record["TIME_ON"]?.nonEmpty
        else { return nil }
        let date = "\(rawDate.prefix(4))-\(rawDate.dropFirst(4).prefix(2))-\(rawDate.suffix(2))"
        self.init(call: call, band: band.lowercased(), mode: mode, qsoDate: date, timeOn: time)
        if let mhz = record["FREQ"].flatMap(Double.init) {
            frequency = Int64((mhz * 1_000_000).rounded())
        }
        rstSent = record["RST_SENT"]
        rstReceived = record["RST_RCVD"]
        gridSquare = record["GRIDSQUARE"]
        name = record["NAME"]
        comment = record["COMMENT"]
        notes = record["NOTES"]
        qth = record["QTH"]
        state = record["STATE"]
        county = record["CNTY"]
        iota = record["IOTA"]
        qslVia = record["QSL_VIA"]
        power = record["TX_PWR"]
        cqZone = record["CQZ"]
        ituZone = record["ITUZ"]
        propagationMode = record["PROP_MODE"]
        sotaReference = record["SOTA_REF"]
        potaReference = record["POTA_REF"]
        wwffReference = record["WWFF_REF"]
    }
}

private extension String {
    var nonEmpty: String? { isEmpty ? nil : self }
}

/// A read-only review result. Complete records remain visible after a malformed
/// suffix, but no plan can be made until every diagnostic has been resolved.
public struct ADIFImportPreview: Sendable {
    public struct Issue: Equatable, Sendable {
        public let recordNumber: Int
        public let message: String
    }
    public let records: [ADIFRecord]
    public let issues: [Issue]

    /// Matches xLog's existing writer: descriptor lengths count UTF-8 bytes.
    /// ADX and other encodings require a separate reader; they are rejected here.
    public init(text: String, maximumBytes: Int = 16_384, maximumRecords: Int = 128, fieldMetadata: [ADIFFieldMetadata?]? = nil) {
        var records: [ADIFRecord] = [], issues: [Issue] = []
        var fields: [String: String] = [:]
        func report(_ message: String) {
            issues.append(Issue(recordNumber: records.count + 1, message: message))
        }
        guard maximumBytes > 0, maximumRecords > 0, text.utf8.count <= maximumBytes else {
            self.records = []; self.issues = [Issue(recordNumber: 1, message: "Input exceeds the preview limit.")]; return
        }
        let bytes = Array(text.utf8)
        var cursor = 0, headerEnded = false, recordStarted = false
        // Free text is permitted only before the first descriptor (ADI preamble).
        while cursor < bytes.count && bytes[cursor] != 60 { cursor += 1 }
        if cursor == bytes.count { report("No ADI descriptors were found.") }
        while cursor < bytes.count {
            if [9, 10, 13, 32].contains(bytes[cursor]) { cursor += 1; continue }
            guard bytes[cursor] == 60, let close = bytes[cursor...].firstIndex(of: 62),
                  let descriptor = String(bytes: bytes[(cursor + 1)..<close], encoding: .ascii) else {
                report("Invalid or unterminated descriptor."); break
            }
            let parts = descriptor.split(separator: ":", omittingEmptySubsequences: false).map(String.init)
            let name = parts[0].uppercased()
            cursor = close + 1
            if name == "EOH", parts.count == 1 {
                guard !headerEnded, !recordStarted else { report("Unexpected header terminator."); break }
                headerEnded = true; fields.removeAll(); continue
            }
            if name == "EOR", parts.count == 1 {
                guard !fields.isEmpty else { report("Empty record."); break }
                guard records.count < maximumRecords else { report("Record count exceeds the preview limit."); break }
                let metadata = fieldMetadata.flatMap { records.count < $0.count ? $0[records.count] : nil }
                let record = ADIFRecord(fields: fields, fieldMetadata: metadata)
                if let metadata, (try? metadata.validate(fields: fields)) == nil { report("Invalid ADIF field metadata.") }
                records.append(record); fields.removeAll(); recordStarted = true
                if !Self.validContact(record) { issues.append(Issue(recordNumber: records.count, message: "Invalid callsign, UTC date/time, band, mode or frequency.")) }
                continue
            }
            guard (2...3).contains(parts.count), !name.isEmpty,
                  name.utf8.allSatisfy({ (65...90).contains($0) || (48...57).contains($0) || $0 == 95 }),
                  !parts[1].isEmpty, parts[1].utf8.allSatisfy({ (48...57).contains($0) }),
                  let length = Int(parts[1]), length <= bytes.count - cursor,
                  parts.count == 2 || (parts[2].count == 1 && parts[2].utf8.allSatisfy({ (65...90).contains($0) || (97...122).contains($0) })),
                  let value = String(bytes: bytes[cursor..<(cursor + length)], encoding: .utf8) else {
                report("Invalid field descriptor, encoding or truncated value."); break
            }
            guard fields[name] == nil else { report("Repeated field \(name) would lose data."); break }
            guard fields.count < 128 else { report("Too many fields in one record."); break }
            fields[name] = value; cursor += length
        }
        if !fields.isEmpty { report("Unterminated record; EOR is required.") }
        if let fieldMetadata, fieldMetadata.count != records.count { report("ADIF field metadata count does not match records.") }
        if records.isEmpty && issues.isEmpty { report("No contact records were found.") }
        self.records = records; self.issues = issues
    }

    private static func validContact(_ record: ADIFRecord) -> Bool {
        guard let call = record["CALL"], call.range(of: #"^[A-Za-z0-9/\-]{2,32}$"#, options: .regularExpression) != nil,
              let band = record["BAND"], !band.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              let mode = record["MODE"], !mode.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              let date = record["QSO_DATE"], let time = record["TIME_ON"], validUTC(date, time),
              QSO(adif: record) != nil else { return false }
        if let date = record["QSO_DATE_OFF"], !validUTC(date, record["TIME_OFF"] ?? "000000") { return false }
        if let time = record["TIME_OFF"], !validUTC(record["QSO_DATE_OFF"] ?? date, time) { return false }
        if let raw = record["FREQ"] {
            guard let frequency = Double(raw), frequency.isFinite, frequency > 0, frequency <= 1_000_000 else { return false }
        }
        return true
    }

    private static func validUTC(_ date: String, _ time: String) -> Bool {
        guard date.count == 8, [4, 6].contains(time.count),
              (date + time).utf8.allSatisfy({ (48...57).contains($0) }) else { return false }
        let stamp = date + (time.count == 4 ? time + "00" : time)
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyyMMddHHmmss"; formatter.isLenient = false
        guard let parsed = formatter.date(from: stamp) else { return false }
        return formatter.string(from: parsed) == stamp
    }
}

public enum ADIFPlanningError: Error, Equatable {
    case invalidPreview, ambiguousDuplicate(recordNumber: Int), identityFieldUpdate
    case invalidUpdateValue(field: String)
}

/// Read-only duplicate counts for a sequence of bounded preview chunks. Existing
/// contacts are indexed once; this index never authorizes a persistence operation.
public struct ADIFDuplicatePreviewIndex: Sendable {
    private let existing: [SemanticQSOIdentity: Int]
    private var seen = Set<SemanticQSOIdentity>()

    public init(existing contacts: [QSO]) {
        let formatter = ISO8601DateFormatter()
        var counts: [SemanticQSOIdentity: Int] = [:]
        for qso in contacts where qso.deletedAt == nil {
            counts[Self.identity(qso, formatter), default: 0] += 1
        }
        existing = counts
    }

    public mutating func review(_ preview: ADIFImportPreview) throws -> (inserts: Int, duplicates: Int) {
        guard preview.issues.isEmpty else { throw ADIFPlanningError.invalidPreview }
        let formatter = ISO8601DateFormatter()
        // Validate the whole chunk before advancing session state.
        let keys = try preview.records.enumerated().map { index, record in
            guard let qso = QSO(adif: record) else { throw ADIFPlanningError.invalidPreview }
            let key = Self.identity(qso, formatter)
            guard (existing[key] ?? 0) <= 1 else { throw ADIFPlanningError.ambiguousDuplicate(recordNumber: index + 1) }
            return key
        }
        var inserts = 0, duplicates = 0
        for key in keys {
            if !seen.insert(key).inserted || existing[key] != nil { duplicates += 1 }
            else { inserts += 1 }
        }
        return (inserts, duplicates)
    }

    private static func identity(_ qso: QSO, _ formatter: ISO8601DateFormatter) -> SemanticQSOIdentity {
        SemanticQSOIdentity(call: qso.call, timestamp: formatter.string(from: qso.start),
                            band: qso.band, mode: qso.submode.isEmpty ? qso.mode : qso.submode)
    }
}

/// Describes intended changes only: callers must separately authorize persistence,
/// stale-target checks and sync behavior before applying any proposed record.
public struct ADIFImportPlan: Sendable {
    public static let editableFields: Set<String> = ["NAME", "QTH", "GRIDSQUARE", "COMMENT", "NOTES", "RST_SENT", "RST_RCVD",
        "QSL_SENT", "QSL_RCVD", "QSL_SENT_VIA", "QSL_VIA", "LOTW_QSL_SENT", "LOTW_QSL_RCVD", "IOTA", "SOTA_REF", "POTA_REF", "WWFF_REF",
        "COUNTRY", "CONT", "CQZ", "ITUZ", "STATE", "CNTY", "SIG", "SIG_INFO", "DARC_DOK", "TX_PWR",
        "OPERATOR", "STATION_CALLSIGN", "MY_GRIDSQUARE", "PROP_MODE", "EMAIL", "DXCC"]
    public enum DuplicatePolicy: Sendable {
        case skip
        /// Only present incoming values replace the explicitly selected fields.
        /// An explicitly present empty value clears that field; absence preserves it.
        case updateFields(Set<String>)
    }
    public struct Entry: Sendable {
        public let recordNumber: Int
        public let targetID: UUID?
        public let record: ADIFRecord
    }
    public let inserts: [Entry]
    public let updates: [Entry]
    public let duplicates: [Entry]
    public let skippedRecordNumbers: [Int]

    public init(preview: ADIFImportPreview, existing: [QSO], duplicatePolicy: DuplicatePolicy) throws {
        guard preview.issues.isEmpty else { throw ADIFPlanningError.invalidPreview }
        let selected: Set<String>
        switch duplicatePolicy {
        case .skip: selected = []
        case .updateFields(let fields): selected = Set(fields.map { $0.uppercased() })
        }
        // Editing identity is a separate operation; it cannot be an import merge.
        guard selected.isDisjoint(with: ["CALL", "QSO_DATE", "TIME_ON", "BAND", "MODE", "SUBMODE"]) else {
            throw ADIFPlanningError.identityFieldUpdate
        }
        func identity(_ qso: QSO) -> SemanticQSOIdentity {
            SemanticQSOIdentity(call: qso.call, timestamp: ISO8601DateFormatter().string(from: qso.start),
                                band: qso.band, mode: qso.submode.isEmpty ? qso.mode : qso.submode)
        }
        let indexed = Dictionary(grouping: existing.filter { $0.deletedAt == nil }, by: identity)
        var seen = Set<SemanticQSOIdentity>(), inserts: [Entry] = [], updates: [Entry] = [], duplicates: [Entry] = [], skipped: [Int] = []
        for (index, record) in preview.records.enumerated() {
            guard let qso = QSO(adif: record) else { throw ADIFPlanningError.invalidPreview }
            let key = identity(qso), number = index + 1
            guard seen.insert(key).inserted else { skipped.append(number); continue }
            let matches = indexed[key] ?? []
            guard matches.count <= 1 else { throw ADIFPlanningError.ambiguousDuplicate(recordNumber: number) }
            guard let target = matches.first else {
                inserts.append(Entry(recordNumber: number, targetID: nil, record: record)); continue
            }
            duplicates.append(Entry(recordNumber: number, targetID: target.id, record: record))
            var merged = target.adifRecord.fields
            for field in selected {
                if let value = record[field] {
                    if field == "DXCC", !value.isEmpty {
                        // Keep the existing local DXCC numeric envelope, including
                        // ADIF's explicit 0 (known to be outside a DXCC entity).
                        // Reject normalization, overflow and lossy integer input.
                        guard let code = Int(value), (0...1_000).contains(code), String(code) == value else {
                            throw ADIFPlanningError.invalidUpdateValue(field: field)
                        }
                    }
                    merged[field] = value
                }
            }
            if merged == target.adifRecord.fields { skipped.append(number) }
            else {
                try target.adifFieldMetadata?.validate(fields: merged)
                updates.append(Entry(recordNumber: number, targetID: target.id, record: ADIFRecord(fields: merged, fieldMetadata: target.adifFieldMetadata)))
            }
        }
        self.inserts = inserts; self.updates = updates; self.duplicates = duplicates; self.skippedRecordNumbers = skipped
    }
}

/// Frozen content and scope: paging this value never re-queries a changing log.
public struct ADIFExportSnapshot: Sendable {
    public enum Scope: Sendable { case all, selected(Set<UUID>) }
    public let records: [ADIFRecord]
    public let contactIDs: [UUID]

    public init(contacts: [QSO], scope: Scope) {
        let included = contacts.filter { qso in
            guard qso.deletedAt == nil else { return false }
            switch scope { case .all: return true; case .selected(let ids): return ids.contains(qso.id) }
        }.sorted { $0.start == $1.start ? $0.id.uuidString < $1.id.uuidString : $0.start > $1.start }
        records = included.map(\.adifRecord); contactIDs = included.map(\.id)
    }

    public var document: String {
        "<ADIF_VER:5>3.1.7<EOH>\r\n" + records.map { record in
            record.fields.keys.sorted().map { key in
                let value = record.fields[key] ?? ""
                return "<\(key):\(value.utf8.count)>\(value)"
            }.joined() + "<EOR>\r\n"
        }.joined()
    }
}

public extension LogbookDatabase {
    /// fetchAll is one SQLite statement, so the exported scope has one read view.
    func adifExportSnapshot(scope: ADIFExportSnapshot.Scope) throws -> ADIFExportSnapshot {
        ADIFExportSnapshot(contacts: try fetchAll(), scope: scope)
    }
}

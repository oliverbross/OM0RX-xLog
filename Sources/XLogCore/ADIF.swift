import Foundation

public struct ADIFRecord: Equatable, Sendable {
    public var fields: [String: String]

    public init(fields: [String: String]) {
        self.fields = fields.reduce(into: [:]) { $0[$1.key.uppercased()] = $1.value }
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
    public init(text: String, maximumBytes: Int = 16_384, maximumRecords: Int = 128) {
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
                let record = ADIFRecord(fields: fields)
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
}

/// Describes intended changes only: callers must separately authorize persistence,
/// stale-target checks and sync behavior before applying any proposed record.
public struct ADIFImportPlan: Sendable {
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
        var seen = Set<SemanticQSOIdentity>(), inserts: [Entry] = [], updates: [Entry] = [], skipped: [Int] = []
        for (index, record) in preview.records.enumerated() {
            guard let qso = QSO(adif: record) else { throw ADIFPlanningError.invalidPreview }
            let key = identity(qso), number = index + 1
            guard seen.insert(key).inserted else { skipped.append(number); continue }
            let matches = indexed[key] ?? []
            guard matches.count <= 1 else { throw ADIFPlanningError.ambiguousDuplicate(recordNumber: number) }
            guard let target = matches.first else {
                inserts.append(Entry(recordNumber: number, targetID: nil, record: record)); continue
            }
            var merged = target.adifRecord.fields
            for field in selected { if let value = record[field] { merged[field] = value } }
            if merged == target.adifRecord.fields { skipped.append(number) }
            else { updates.append(Entry(recordNumber: number, targetID: target.id, record: ADIFRecord(fields: merged))) }
        }
        self.inserts = inserts; self.updates = updates; self.skippedRecordNumbers = skipped
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

import Foundation

/// Export-only assignments are always shown in the preview and never persisted
/// into source contacts. Missing values never fall back to current preferences.
public struct POTAExportAssignment: Codable, Equatable, Sendable {
    public var ownParks: [String]
    public var state: String
    public init(ownParks: [String], state: String = "") { self.ownParks = ownParks; self.state = state }
}
public struct POTAExportIssue: Codable, Equatable, Sendable {
    public let contactID: UUID
    public let message: String
}
public struct POTAExportFile: Codable, Equatable, Sendable {
    public let filename: String
    public let stationCall: String
    public let ownPark: String
    public let state: String
    public let physicalContacts: Int
    public let derivedRecords: Int
    public let text: String
}
public struct POTAExportPreview: Codable, Equatable, Sendable {
    public static let rulesVersion = "POTA rules 1.3 (2026-08-18); xLog exporter 1"
    public static let sourceURLs = ["https://docs.pota.app/docs/rules.html",
        "https://docs.pota.app/docs/activator_reference/ADIF_for_POTA_reference.html",
        "https://docs.pota.app/docs/activator_reference/submitting_logs.html",
        "https://docs.pota.app/docs/activator_reference/park_2_park.html"]
    public let version: Int
    public let rulesVersion: String
    public let sourceURLs: [String]
    public let capturedAt: Date
    public let physicalContacts: Int
    public let includedContacts: Int
    public let derivedRecords: Int
    public let files: [POTAExportFile]
    public let issues: [POTAExportIssue]
    public let warnings: [String]
    public let assignment: POTAExportAssignment?

    public static func referenceTokens(_ value: String) -> [String] {
        Array(Set(value.uppercased().split(whereSeparator: { $0.isWhitespace || ",;".contains($0) }).map(String.init))).sorted()
    }
    public static func validPark(_ value: String) -> Bool {
        value.range(of: "^[A-Z0-9]{1,8}-[0-9]{1,8}$", options: .regularExpression) != nil
    }
    private static func validCall(_ value: String) -> Bool {
        value.range(of: "^[A-Z0-9/]{3,32}$", options: .regularExpression) != nil && value.contains(where: { $0.isNumber }) && value.contains(where: { $0.isLetter })
    }
    private static func safe(_ value: String) -> String {
        value.map { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-") ? String($0) : "_" }.joined()
    }
    public init(snapshot: ADIFExportSnapshot, now: Date = Date(), assignment: POTAExportAssignment? = nil,
                splitByDay: Bool = false) {
        version = 1; rulesVersion = Self.rulesVersion; sourceURLs = Self.sourceURLs; capturedAt = now
        physicalContacts = snapshot.records.count; self.assignment = assignment
        let formatter = DateFormatter(); formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0); formatter.dateFormat = "yyyyMMdd"
        let today = formatter.string(from: now)
        struct Group { var station: String; var park: String; var state: String; var day: String; var ids: Set<UUID>; var records: [ADIFRecord] }
        var groups: [String: Group] = [:], failures: [POTAExportIssue] = [], included = Set<UUID>()
        var duplicateKeys = Set<String>(), duplicates = 0, futureTimes = 0
        for (index, record) in snapshot.records.enumerated() {
            let id = snapshot.contactIDs[index]
            let station = record["STATION_CALLSIGN"] ?? "", op = record["OPERATOR"] ?? ""
            let effectiveStation = station.isEmpty ? op : station
            let own = Self.referenceTokens(record["MY_POTA_REF"] ?? ((record["MY_SIG"] ?? "").uppercased() == "POTA" ? record["MY_SIG_INFO"] ?? "" : ""))
            let parks = own.isEmpty ? Array(Set(assignment?.ownParks.map { $0.uppercased() } ?? [])).sorted() : own
            let contacted = Self.referenceTokens(record["POTA_REF"] ?? ((record["SIG"] ?? "").uppercased() == "POTA" ? record["SIG_INFO"] ?? "" : ""))
            let state = record["MY_STATE"] ?? assignment?.state ?? ""
            var missing: [String] = []
            if !Self.validCall(effectiveStation) || (!station.isEmpty && !Self.validCall(station)) || (!op.isEmpty && !Self.validCall(op)) { missing.append("station/operator callsign") }
            let call = record["CALL"] ?? ""
            if !Self.validCall(call) || call == station || call == op { missing.append("contacted callsign (self contacts are excluded)") }
            guard let qso = QSO(adif: record) else { failures.append(.init(contactID: id, message: "Invalid UTC date/time or contact fields")); continue }
            if (record["QSO_DATE"] ?? "") > today { missing.append("future UTC date") }
            else if qso.start > now { futureTimes += 1 }
            if (record["BAND"] ?? "").range(of: "^(?:[0-9]+(?:\\.[0-9]+)?(?:M|CM|MM)|SUBMM)$", options: [.regularExpression, .caseInsensitive]) == nil { missing.append("transmit band") }
            if (record["SUBMODE"] ?? record["MODE"] ?? "").range(of: "^[A-Za-z0-9_+-]{1,16}$", options: .regularExpression) == nil { missing.append("mode/submode") }
            if parks.isEmpty || !parks.allSatisfy(Self.validPark) { missing.append("own POTA park") }
            if !contacted.allSatisfy(Self.validPark) { missing.append("contacted POTA park") }
            if !missing.isEmpty { failures.append(.init(contactID: id, message: "Missing or invalid: " + missing.joined(separator: ", "))); continue }
            included.insert(id)
            for park in parks {
                let day = splitByDay ? record["QSO_DATE"] ?? "" : "all-days"
                let key = [effectiveStation, park, state, day].joined(separator: "\u{1f}")
                var group = groups[key] ?? Group(station: effectiveStation, park: park, state: state, day: day, ids: [], records: [])
                group.ids.insert(id)
                for hunter in contacted.isEmpty ? [""] : contacted {
                    var fields = record.fields
                    fields["MY_SIG"] = "POTA"; fields["MY_SIG_INFO"] = park
                    fields["MY_POTA_REF"] = park
                    if !state.isEmpty { fields["MY_STATE"] = state }
                    if !hunter.isEmpty { fields["SIG"] = "POTA"; fields["SIG_INFO"] = hunter; fields["POTA_REF"] = hunter }
                    let duplicate = [effectiveStation, call, record["SUBMODE"] ?? record["MODE"] ?? "", record["QSO_DATE"] ?? "", record["BAND"] ?? "", park, hunter, state].joined(separator: "\u{1f}")
                    if !duplicateKeys.insert(duplicate).inserted { duplicates += 1 }
                    group.records.append(ADIFRecord(fields: fields, fieldMetadata: record.fieldMetadata))
                }
                groups[key] = group
            }
        }
        files = groups.keys.sorted().enumerated().map { ordinal, key in
            let group = groups[key]!
            // Ordinal prevents sanitized-name collisions without changing callsigns.
            let name = "\(ordinal + 1)-\(Self.safe(group.station))@\(Self.safe(group.park))-\(Self.safe(group.state))-\(group.day).adi"
            let text = "<ADIF_VER:5>3.1.7<EOH>\r\n" + group.records.map { $0.recordDocument + "\r\n" }.joined()
            return POTAExportFile(filename: name, stationCall: group.station, ownPark: group.park, state: group.state,
                                  physicalContacts: group.ids.count, derivedRecords: group.records.count, text: text)
        }
        includedContacts = included.count; derivedRecords = files.reduce(0) { $0 + $1.derivedRecords }; issues = failures
        var notes = ["Park syntax is checked; directory membership and multi-subdivision location must be reviewed by the operator.",
                     "Separate contacts are retained. POTA's upload duplicate key excludes QSO time."]
        if snapshot.records.isEmpty { notes.append("The selected snapshot contains no contacts.") }
        if duplicates > 0 { notes.append("\(duplicates) derived records share a possible POTA duplicate key; all are retained.") }
        if futureTimes > 0 { notes.append("\(futureTimes) contacts start later than the captured validation instant on the same UTC day; timestamps are unchanged.") }
        if assignment != nil { notes.append("Reviewed export-only assignment fills missing own parks/location. Source contacts remain unchanged.") }
        warnings = notes
    }
}

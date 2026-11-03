import Foundation

public enum POTAExportError: Error, LocalizedError {
    case projectionTooLarge
    public var errorDescription: String? {
        "The selection exceeds the bounded POTA preview budget (32 MiB or 50,000 derived records). Select a smaller activation or refine the contact filter and create a fresh preview. Nothing was exported."
    }
}

/// Export-only assignments are always shown in the preview and never persisted
/// into source contacts. Missing values never fall back to current preferences.
public struct POTAExportAssignment: Codable, Equatable, Sendable {
    public var ownParks: [String]
    public var state: String
    public var clubOrGroup: Bool?
    public init(ownParks: [String], state: String = "", clubOrGroup: Bool? = nil) { self.ownParks = ownParks; self.state = state; self.clubOrGroup = clubOrGroup }
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
        reference(value) != nil
    }
    /// A syntax projection only; directory and sponsor eligibility remain unknown.
    public static func bareParkReference(_ value: String) -> String? {
        reference(value.trimmingCharacters(in: .whitespacesAndNewlines).uppercased())?.park
    }
    public static func parkReferences(_ value: String) -> [String] {
        Array(Set(referenceTokens(value).compactMap(bareParkReference))).sorted()
    }
    private struct Reference {
        var raw: String; var park: String; var location: String?
        var state: String? { location.map { String($0.dropFirst(3)) } }
    }
    /// ADIF 3.1.8 POTARef, matching the existing adifTransfer.ts contract.
    /// POTA's SIG_INFO receives the bare park; ADIF's qualified field is retained.
    private static func reference(_ raw: String) -> Reference? {
        let parts = raw.split(separator: "@", omittingEmptySubsequences: false).map(String.init)
        guard (1...2).contains(parts.count), parts[0].range(of: "^[A-Z0-9]{1,4}-[0-9]{4,5}$", options: .regularExpression) != nil else { return nil }
        if parts.count == 2, parts[1].range(of: "^[A-Z]{2}-[A-Z0-9]{1,3}$", options: .regularExpression) == nil { return nil }
        return Reference(raw: raw, park: parts[0], location: parts.count == 2 ? parts[1] : nil)
    }
    private static func distinctParks(_ values: [Reference]) -> [Reference] {
        let groups = Dictionary(grouping: values, by: \.park)
        return groups.keys.sorted().map { park in
            let same = groups[park]!
            return same.first(where: { $0.location != nil }) ?? same[0]
        }
    }
    private static func matchesLocation(_ state: String, _ location: String) -> Bool {
        let supplied = state.uppercased()
        return supplied == location || supplied == String(location.dropFirst(3))
    }
    /// Local counting uses the same recorded qualifier/conflict rules as export.
    /// No current station settings or export-only assignments enter this value.
    static func countingLocation(own raw:String, recordedState:String) -> (state:String, issue:String?) {
        let references=referenceTokens(raw).compactMap(reference)
        let locations=Set(references.compactMap(\.location))
        let recorded=recordedState.trimmingCharacters(in:.whitespacesAndNewlines).uppercased()
        if locations.count>1 { return (recorded,"Own park references specify conflicting station locations") }
        if let location=locations.first, !recorded.isEmpty, !matchesLocation(recorded,location) {
            return (recorded,"Recorded subdivision conflicts with own park location")
        }
        let state=recorded.isEmpty ? references.first(where:{$0.state != nil})?.state ?? "" : recorded
        let normalized=state.range(of:"^[A-Z]{2}-[A-Z0-9]{1,3}$",options:.regularExpression) != nil ? String(state.dropFirst(3)) : state
        return (normalized,nil)
    }
    static func conflictingContactLocations(_ raw:String) -> Bool {
        Dictionary(grouping:referenceTokens(raw).compactMap(reference),by:\.park).values.contains { Set($0.compactMap(\.location)).count>1 }
    }
    private static func validCall(_ value: String) -> Bool {
        value.range(of: "^[A-Z0-9/]{3,32}$", options: .regularExpression) != nil && value.contains(where: { $0.isNumber }) && value.contains(where: { $0.isLetter })
    }
    private static func nonempty(_ value: String?) -> String? {
        value.flatMap { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : $0 }
    }
    private static func safe(_ value: String) -> String {
        value.map { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-") ? String($0) : "_" }.joined()
    }
    // Same retained ADIF 3.1.8 root modes/bands used by adifTransfer.ts. Local
    // convenience modes are projected by QSO.adifRecord before this boundary.
    private static let modeValues = Set("AM ARDOP ATV CHIP CLO CONTESTI CW DIGITALVOICE DOMINO DYNAMIC FAX FM FSK441 FSK FT8 HELL ISCAT JT4 JT6M JT9 JT44 JT65 MFSK MSK144 MTONE MT63 OFDM OLIVIA OPERA PAC PAX PKT PSK PSK2K Q15 QRA64 ROS RTTY RTTYM SSB SSTV T10 THOR THRB TOR V4 VOI WINMOR WSPR".split(separator: " ").map(String.init))
    private static let bandValues = Set("2190M 630M 560M 160M 80M 60M 40M 30M 20M 17M 15M 12M 10M 8M 6M 5M 4M 2M 1.25M 70CM 33CM 23CM 13CM 9CM 6CM 3CM 1.25CM 6MM 4MM 2.5MM 2MM 1MM SUBMM".split(separator: " ").map(String.init))
    static func validCountingBand(_ value:String) -> Bool { bandValues.contains(value.uppercased()) }
    static func effectiveStation(station:String,operatorCall:String) -> String { station.isEmpty ? operatorCall : station }
    static func validCountingMode(_ mode:String,submode:String) -> Bool {
        modeValues.contains(mode.uppercased()) && (submode.isEmpty || submode.range(of:"^[A-Za-z0-9_+-]{1,16}$",options:.regularExpression) != nil)
    }
    /// Native entry point. Check the prospective cross-product before retaining
    /// expanded dictionaries or serializing files. It never clips a population.
    public static func prepare(snapshot: ADIFExportSnapshot, now: Date = Date(), assignment: POTAExportAssignment? = nil,
                               splitByDay: Bool = false, maximumBytes: Int = 32 * 1024 * 1024,
                               maximumDerivedRecords: Int = 50_000) throws -> Self {
        var records = 0, bytes = 2048 // fixed manifest/rules provenance
        for record in snapshot.records {
            let own = parkReferences(nonempty(record["MY_POTA_REF"]) ?? ((record["MY_SIG"] ?? "").uppercased() == "POTA" ? record["MY_SIG_INFO"] ?? "" : ""))
            let ownCount = own.isEmpty ? Set((assignment?.ownParks ?? []).compactMap(bareParkReference)).count : own.count
            let otherCount = parkReferences(nonempty(record["POTA_REF"]) ?? ((record["SIG"] ?? "").uppercased() == "POTA" ? record["SIG_INFO"] ?? "" : "")).count
            let derived = ownCount.multipliedReportingOverflow(by: max(1, otherCount))
            let nextRecords = records.addingReportingOverflow(derived.partialValue)
            // New grouping/SIG fields and per-file headers add less than this
            // conservative margin. Original text and timestamps stay unchanged.
            let metadataBytesCount = try record.fieldMetadata.map { try JSONEncoder().encode($0).count } ?? 0
            let recordBytes = record.recordDocument.utf8.count + metadataBytesCount + 512
            let expandedBytes = recordBytes.multipliedReportingOverflow(by: derived.partialValue)
            // Reserve per-physical-contact manifest/exclusion space even when
            // an invalid contact would generate no ADIF records at all.
            let metadataBytes = bytes.addingReportingOverflow(recordBytes)
            let nextBytes = metadataBytes.partialValue.addingReportingOverflow(expandedBytes.partialValue)
            guard !derived.overflow, !nextRecords.overflow, !expandedBytes.overflow, !metadataBytes.overflow, !nextBytes.overflow,
                  nextRecords.partialValue <= maximumDerivedRecords, nextBytes.partialValue <= maximumBytes else { throw POTAExportError.projectionTooLarge }
            records = nextRecords.partialValue; bytes = nextBytes.partialValue
        }
        return Self(snapshot: snapshot, now: now, assignment: assignment, splitByDay: splitByDay)
    }
    public init(snapshot: ADIFExportSnapshot, now: Date = Date(), assignment: POTAExportAssignment? = nil,
                splitByDay: Bool = false) {
        version = 1; rulesVersion = Self.rulesVersion; sourceURLs = Self.sourceURLs; capturedAt = now
        physicalContacts = snapshot.records.count; self.assignment = assignment
        let formatter = DateFormatter(); formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0); formatter.dateFormat = "yyyyMMdd"
        let today = formatter.string(from: now)
        struct Group { var station: String; var park: String; var state: String; var day: String; var ids: Set<UUID>; var records: [ADIFRecord]; var metadata: ADIFFieldMetadata? }
        var groups: [String: Group] = [:], failures: [POTAExportIssue] = [], included = Set<UUID>()
        var duplicateKeys = Set<String>(), duplicates = 0, futureTimes = 0
        for (index, record) in snapshot.records.enumerated() {
            let id = snapshot.contactIDs[index]
            let station = record["STATION_CALLSIGN"] ?? "", op = record["OPERATOR"] ?? ""
            let effectiveStation = Self.effectiveStation(station:station,operatorCall:op)
            let own = Self.referenceTokens(Self.nonempty(record["MY_POTA_REF"]) ?? ((record["MY_SIG"] ?? "").uppercased() == "POTA" ? record["MY_SIG_INFO"] ?? "" : ""))
            let parks = own.isEmpty ? Array(Set(assignment?.ownParks.map { $0.uppercased() } ?? [])).sorted() : own
            let contacted = Self.referenceTokens(Self.nonempty(record["POTA_REF"]) ?? ((record["SIG"] ?? "").uppercased() == "POTA" ? record["SIG_INFO"] ?? "" : ""))
            let ownReferences = parks.compactMap(Self.reference), contactedReferences = contacted.compactMap(Self.reference)
            let recordedState = Self.nonempty(record["MY_STATE"]), assignedState = Self.nonempty(assignment?.state)
            let locations = Set(ownReferences.compactMap(\.location))
            let qualifiedState = ownReferences.first(where: { $0.location != nil })?.state
            let state = recordedState ?? qualifiedState ?? assignedState ?? ""
            var missing: [String] = []
            var metadataKey = ""
            if let metadata = record.fieldMetadata {
                do {
                    try metadata.validate(fields: record.fields)
                    if !metadata.extensions.isEmpty {
                        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
                        metadataKey = String(decoding: try encoder.encode(metadata.extensions), as: UTF8.self)
                    }
                } catch { missing.append("ADIF extension metadata") }
            }
            if assignment?.clubOrGroup == true && (station.isEmpty || op.isEmpty) { missing.append("club/group requires both station and individual operator callsigns") }
            if !Self.validCall(effectiveStation) || (!station.isEmpty && !Self.validCall(station)) || (!op.isEmpty && !Self.validCall(op)) { missing.append("station/operator callsign") }
            let call = record["CALL"] ?? ""
            if !Self.validCall(call) || call == station || call == op { missing.append("contacted callsign (self contacts are excluded)") }
            guard let qso = QSO(adif: record) else { failures.append(.init(contactID: id, message: "Invalid UTC date/time or contact fields")); continue }
            if (record["QSO_DATE"] ?? "") > today { missing.append("future UTC date") }
            else if qso.start > now { futureTimes += 1 }
            if !Self.validCountingBand(record["BAND"] ?? "") { missing.append("transmit band") }
            if !Self.validCountingMode(record["MODE"] ?? "",submode:record["SUBMODE"] ?? "") || record["SUBMODE"] == "" { missing.append("mode/submode") }
            if let issue = ADIFImportPreview(text: record.adifDocument).issues.first { missing.append("ADIF serialization: " + issue.message) }
            if parks.isEmpty || !parks.allSatisfy(Self.validPark) { missing.append("own POTA park") }
            if !contacted.allSatisfy(Self.validPark) { missing.append("contacted POTA park") }
            if locations.count > 1 { missing.append("own park references specify conflicting station locations") }
            if let location = locations.first {
                if let recordedState, !Self.matchesLocation(recordedState, location) { missing.append("MY_STATE \(recordedState.prefix(32)) conflicts with recorded park location \(location)") }
                if recordedState == nil, let assignedState, !Self.matchesLocation(assignedState, location) { missing.append("export-only subdivision \(assignedState.prefix(32)) conflicts with recorded park location \(location)") }
            }
            if Dictionary(grouping: contactedReferences, by: \.park).values.contains(where: { Set($0.compactMap(\.location)).count > 1 }) {
                missing.append("the same contacted park has conflicting location qualifiers")
            }
            if !state.isEmpty && state.range(of: "^[A-Za-z0-9-]{1,16}$", options: .regularExpression) == nil { missing.append("own subdivision") }
            if !missing.isEmpty { failures.append(.init(contactID: id, message: "Missing or invalid: " + missing.joined(separator: ", "))); continue }
            included.insert(id)
            for ownReference in Self.distinctParks(ownReferences) {
                let park = ownReference.park
                let day = splitByDay ? record["QSO_DATE"] ?? "" : "all-days"
                // APP field types must also remain constant within an ADI file;
                // incompatible per-record schemas are safely partitioned.
                let key = [effectiveStation, park, state, day, metadataKey].joined(separator: "\u{1f}")
                var group = groups[key] ?? Group(station: effectiveStation, park: park, state: state, day: day, ids: [], records: [], metadata: record.fieldMetadata)
                group.ids.insert(id)
                let hunters: [Reference?] = contactedReferences.isEmpty ? [nil] : Self.distinctParks(contactedReferences).map(Optional.some)
                for hunterReference in hunters {
                    let hunter = hunterReference?.park ?? ""
                    var fields = record.fields
                    fields["MY_SIG"] = "POTA"; fields["MY_SIG_INFO"] = park
                    fields["MY_POTA_REF"] = ownReference.raw
                    if !state.isEmpty { fields["MY_STATE"] = state }
                    if let hunterReference { fields["SIG"] = "POTA"; fields["SIG_INFO"] = hunter; fields["POTA_REF"] = hunterReference.raw }
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
            let text = Self.header(metadata: group.metadata) + group.records.map { Self.recordDocument($0) + "\r\n" }.joined()
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

    private static func header(metadata: ADIFFieldMetadata?) -> String {
        let definitions = (metadata?.extensions ?? [:]).filter { $0.value.kind == "USERDEF" }.sorted { $0.key < $1.key }
        let declarations = definitions.map { _, field -> String in
            let definition = field.declaration!
            let constraint = definition["ENUM"] ?? definition["RANGE"]
            let value = field.attributes["FIELDNAME"]! + (constraint.map { "," + $0 } ?? "")
            return "<USERDEF\(definition["FIELDID"]!):\(value.utf8.count):\(definition["TYPE"]!)>\(value)"
        }.joined()
        return "<ADIF_VER:5>3.1.7" + declarations + "<EOH>\r\n"
    }

    private static func recordDocument(_ record: ADIFRecord) -> String {
        guard let metadata = record.fieldMetadata, !metadata.extensions.isEmpty else { return record.recordDocument }
        return record.fields.keys.sorted().map { key in
            let value = record.fields[key]!, field = metadata.extensions[key]
            let name: String
            if let field, field.kind == "APP" {
                name = "APP_\(field.attributes["PROGRAMID"]!)_\(field.attributes["FIELDNAME"]!)"
            } else { name = field?.attributes["FIELDNAME"] ?? key }
            let type = field?.kind == "APP" ? field?.attributes["TYPE"] : field?.declaration?["TYPE"]
            return "<\(name):\(value.utf8.count)\(type.map { ":" + $0 } ?? "")>\(value)"
        }.joined() + "<EOR>"
    }
}

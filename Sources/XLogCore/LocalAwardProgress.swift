import Foundation

/// Compact, complete-log evidence. No current home settings enter these values.
public struct AwardEvidenceContact: Decodable, Equatable, Sendable {
    public var id: UUID; public var call: String; public var start: Date
    public var band: String; public var mode: String; public var submode: String
    public var dxcc: Int?; public var continent: String; public var cqZone: String
    public var state: String; public var gridSquare: String
    public var myCall: String; public var myGrid: String; public var stationLocation: String
    public var iota: String; public var potaReference: String; public var sotaReference: String; public var wwffReference: String
    public var qslReceived: String; public var lotwReceived: String; public var extraFields: [String: String]
    public var sig: String; public var sigInfo: String
    public init(_ q: QSO) {
        id=q.id; call=q.call; start=q.start; band=q.band; mode=q.mode; submode=q.submode; dxcc=q.dxcc
        continent=q.continent; cqZone=q.cqZone; state=q.state; gridSquare=q.gridSquare
        myCall=q.myCall; myGrid=q.myGrid; stationLocation=q.stationLocation
        iota=q.iota; potaReference=q.potaReference; sotaReference=q.sotaReference; wwffReference=q.wwffReference
        qslReceived=q.qslReceived; lotwReceived=q.lotwReceived; extraFields=q.extraFields
        sig=q.sig;sigInfo=q.sigInfo
    }
    init(fromSQL decoder: Decoder) throws {
        var f = try decoder.unkeyedContainer()
        id=try f.decode(UUID.self); call=try f.decode(String.self); start=try f.decode(Date.self)
        band=try f.decode(String.self); mode=try f.decode(String.self); submode=try f.decode(String.self)
        dxcc=try f.decodeIfPresent(Int.self); continent=try f.decode(String.self); cqZone=try f.decode(String.self)
        state=try f.decode(String.self); gridSquare=try f.decode(String.self)
        myCall=try f.decode(String.self); myGrid=try f.decode(String.self); stationLocation=try f.decode(String.self)
        iota=try f.decode(String.self); potaReference=try f.decode(String.self); sotaReference=try f.decode(String.self); wwffReference=try f.decode(String.self)
        qslReceived=try f.decode(String.self); lotwReceived=try f.decode(String.self); extraFields=try f.decode([String:String].self)
        sig=try f.decode(String.self);sigInfo=try f.decode(String.self)
        guard f.isAtEnd, start.timeIntervalSince1970.isFinite else { throw LogbookDatabaseError.corruptRecord }
    }
    var scope: String {
        let ownCountry = extraFields["MY_DXCC"].flatMap(Int.init).map(String.init) ?? "unknown"
        let state=extraFields["MY_STATE"].flatMap{$0.isEmpty ? nil : $0}.map{" · subdivision \($0.uppercased())"} ?? ""
        return "\(myCall.isEmpty ? "Unknown station" : myCall.uppercased()) · own DXCC \(ownCountry) · \(myGrid.isEmpty ? (stationLocation.isEmpty ? "location unknown" : stationLocation) : myGrid.uppercased())\(state)"
    }
}
struct AwardEvidenceSQLRow: Decodable {
    let contact: AwardEvidenceContact
    init(from decoder: Decoder) throws { contact = try AwardEvidenceContact(fromSQL: decoder) }
}

public struct LocalAwardEvidence: Codable, Equatable, Sendable {
    public var id: UUID; public var call: String; public var start: Date
    public var band: String; public var mode: String; public var paper: String; public var lotw: String
    public var reason: String
}
public struct LocalAwardUnit: Equatable, Sendable {
    public var unit: String
    public var scope: String
    public var role: String
    public var evidence: [LocalAwardEvidence]
    public var points: Int? = nil
    public var chaserPointsPerDay: Int? = nil
}
public struct LocalAwardSnapshot: Equatable, Sendable {
    public var programme: String
    public var units: [LocalAwardUnit]
    public var scopes: [String]
    public var unknownContacts: Int
    public var referenceVersion: String
    public var unclassified: [String:[LocalAwardEvidence]] = [:]
    let presentationCache = LocalAwardPresentationCache()
    public static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.programme == rhs.programme && lhs.units == rhs.units && lhs.scopes == rhs.scopes && lhs.unknownContacts == rhs.unknownContacts && lhs.referenceVersion == rhs.referenceVersion && lhs.unclassified == rhs.unclassified
    }
}

public enum LocalAwardEngine {
    public static let programmes = ["dxcc", "waz", "was", "grid", "wac", "wpx", "iota", "pota", "sota", "wwff"]
    public static let rulesVersion = "local-progress-2026-11-03-v1"
    private static let wacContinents = Set(["AF", "AS", "EU", "NA", "OC", "SA"])
    private static let hfBands = Set(["160m","80m","60m","40m","30m","20m","17m","15m","12m","10m"])
    private static let wasStates=Set("AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(separator:" ").map(String.init))
    public static func wacMembership() throws -> [Int: Set<String>] {
        struct Resource: Decodable { var members: [String: [String]] }
        guard let url=Bundle.module.url(forResource:"wac-continents-2026-11-03",withExtension:"json") else { throw AwardCatalogError.missingResource("WAC continent membership") }
        return Dictionary(uniqueKeysWithValues: try JSONDecoder().decode(Resource.self,from:Data(contentsOf:url)).members.compactMap { key, values in Int(key).map { ($0,Set(values)) } })
    }
    public static func modeGroup(_ mode: String) -> String {
        let mode = mode.uppercased()
        if mode.isEmpty { return "Unknown" }
        if mode == "CW" { return "CW" }
        return ["SSB","USB","LSB","AM","FM","PHONE"].contains(mode) ? "Phone" : "Data"
    }
    public static func references(_ raw: String) -> [String] {
        Array(Set(raw.uppercased().split(whereSeparator: { $0.isWhitespace || $0 == "," || $0 == ";" }).map(String.init))).sorted()
    }
    /// WPX award prefixes, including sponsor's published special-call clarifications.
    /// These are local worked prefixes; authority/dated operation approval is separate.
    public static func wpxPrefix(_ raw: String) -> String? {
        let call = raw.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard call != "D075GR", call.range(of: "^[A-Z0-9/]{3,32}$", options: .regularExpression) != nil else { return nil }
        let parts = call.split(separator: "/").map(String.init).filter { !["P","M","MM","AM","QRP","QRPP"].contains($0) }
        func ordinary(_ value: String) -> String? {
            guard let range = value.range(of: "^[A-Z0-9]*?[0-9]+(?=[A-Z])", options: .regularExpression) else { return nil }
            return String(value[range])
        }
        guard let base = parts.filter({ ordinary($0) != nil }).max(by: { $0.count < $1.count }), var prefix = ordinary(base) else { return nil }
        for part in parts where part != base {
            if part.count == 1, part.first?.isNumber == true {
                // Sponsor: R14CWC/0, W100AW/0-9 and AM70x/6 retain special prefix.
                let digits = prefix.reversed().prefix(while: { $0.isNumber }).count
                if digits == 1 { prefix.removeLast(); prefix += part }
            } else if part.count <= 4, part.range(of: "^[A-Z0-9]+$", options: .regularExpression) != nil {
                prefix = part.last?.isNumber == true ? part : part + "0"
            } else { return nil }
        }
        return prefix
    }
    public static func compute(contacts: [AwardEvidenceContact], programme: String,
        directory: ActivationReferenceDirectory = .init(), referenceVersion: String = "unavailable",
        wacMembership: [Int: Set<String>] = [:], cancellation: LogbookAggregateCancellation? = nil) throws -> LocalAwardSnapshot {
        guard programmes.contains(programme) else { throw LogbookQuery.Failure.invalid("Unknown local award programme.") }
        struct Key: Hashable { var scope: String; var role: String; var unit: String }
        var grouped: [Key: [LocalAwardEvidence]] = [:], scopes = Set<String>(), unknown = 0
        var unclassified: [String:[LocalAwardEvidence]] = [:]
        for q in contacts {
            try cancellation?.evaluationCheck()
            scopes.insert(q.scope)
            var entries: [(String, String)] = []
            switch programme {
            case "dxcc": if let dxcc=q.dxcc, dxcc > 0 { entries=[("worked",String(dxcc))] }
            case "waz": if let zone=Int(q.cqZone), (1...40).contains(zone) { entries=[("worked",String(zone))] }
            case "was": if [291,6,110].contains(q.dxcc ?? 0), wasStates.contains(q.state.uppercased()) { entries=[("worked",q.state.uppercased())] }
            case "grid": if q.gridSquare.count>=4, MaidenheadLocator.coordinate(q.gridSquare) != nil { entries=[("worked",String(q.gridSquare.uppercased().prefix(4)))] }
            case "wac":
                let recorded=q.continent.uppercased()
                let choices=q.dxcc.flatMap { wacMembership[$0] } ?? []
                if choices.count == 1, let continent=choices.first, wacContinents.contains(continent) { entries=[("worked",continent)] }
                else if choices.contains(recorded), wacContinents.contains(recorded) { entries=[("worked",recorded)] }
            case "wpx": if let prefix=wpxPrefix(q.call) { entries=[("worked",prefix)] }
            case "iota":
                let category=hfBands.contains(q.band.lowercased()) ? "HF" : ["6m","4m","2m","1.25m","70cm","33cm","23cm","13cm","9cm","6cm","3cm","1.25cm","6mm","4mm","2.5mm","2mm","1mm"].contains(q.band.lowercased()) ? "VHF/UHF" : "Unknown band"
                entries=references(q.iota).filter { $0.range(of: "^(AF|AN|AS|EU|NA|OC|SA)-[0-9]{3}$", options: .regularExpression) != nil }.map { (category,$0) }
            case "pota", "sota", "wwff":
                let kind=programme.uppercased()
                let dedicated=programme == "pota" ? q.potaReference : programme == "sota" ? q.sotaReference : q.wwffReference
                let contact=dedicated.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty && q.sig.uppercased() == kind ? q.sigInfo : dedicated
                let recordedOwn=q.extraFields["MY_\(kind)_REF"] ?? ""
                let own=recordedOwn.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty && q.extraFields["MY_SIG"]?.uppercased() == kind ? q.extraFields["MY_SIG_INFO"] ?? "" : recordedOwn
                let pattern=programme == "sota" ? "^[A-Z0-9]+/[A-Z0-9]{2}-[0-9]{3}$" : programme == "wwff" ? "^[A-Z0-9]+FF-[0-9]{4,5}$" : "^[A-Z0-9]+-[0-9]{4,5}$"
                let contactedUnits=programme == "pota" ? POTAExportPreview.parkReferences(contact) : references(contact).filter{$0.range(of:pattern,options:.regularExpression) != nil}
                let ownUnits=programme == "pota" ? POTAExportPreview.parkReferences(own) : references(own).filter{$0.range(of:pattern,options:.regularExpression) != nil}
                entries=contactedUnits.map{(programme == "sota" ? "chaser" : "hunter",$0)}
                entries += ownUnits.map{("activator",$0)}
            default: break
            }
            if entries.isEmpty {
                unknown += 1
                let reason=programme == "wpx" ? "No supported sponsor-prefix interpretation; authorization or no-digit prefix rules are unresolved. No credit inferred."
                    : programme == "wac" ? "No required WAC continent supported by sponsor membership and recorded entity/continent; Antarctica is not a required seventh continent."
                    : "No usable recorded entity, zone, state, grid or activity reference for this programme; missing/unsupported evidence is not a zero or a sponsor credit."
                unclassified[q.scope,default:[]].append(.init(id:q.id,call:q.call,start:q.start,band:q.band,mode:q.submode.isEmpty ? q.mode : q.submode,paper:q.qslReceived,lotw:q.lotwReceived,reason:reason))
            }
            for (role, unit) in entries {
                let kind=ActivationReferenceKind(rawValue: programme)
                let matched=kind.flatMap { directory.exactMatch(unit,kind:$0) }
                var reason="Locally worked; stored paper/LoTW flags are evidence, not sponsor-issued credit."
                if programme == "wac" { reason="Sponsor continent membership. Paper card evidence is shown separately; LoTW alone is not WAC eligible under the linked ARRL form." }
                if ["iota","pota","sota","wwff"].contains(programme) {
                    reason = matched == nil ? "Recorded reference; directory match unavailable. Eligibility unknown; local progress only." : "Recorded reference matches local directory. Operation approval and sponsor credit unavailable."
                }
                let evidence=LocalAwardEvidence(id:q.id,call:q.call,start:q.start,band:q.band,mode:q.submode.isEmpty ? q.mode : q.submode,paper:q.qslReceived,lotw:q.lotwReceived,reason:reason)
                grouped[Key(scope:q.scope,role:role,unit:unit),default:[]].append(evidence)
            }
        }
        var units=grouped.map { key, records in LocalAwardUnit(unit:key.unit,scope:key.scope,role:key.role,
            evidence:records.sorted { $0.start == $1.start ? $0.id.uuidString < $1.id.uuidString : $0.start > $1.start }) }
        if programme == "sota" {
            for index in units.indices where units[index].role == "chaser" {
                guard let summit=directory.exactMatch(units[index].unit,kind:.sota),
                      let points=summit.points, (0...10).contains(points),
                      let from=summit.validFrom, let through=summit.validTo,
                      let association=summit.association, !association.isEmpty,
                      summit.pointSource?.hasPrefix("https://") == true,
                      let start=referenceDate(from), let end=referenceDate(through) else { continue }
                let valid=units[index].evidence.filter { $0.start >= start && $0.start < end.addingTimeInterval(86400) }
                // General Rules 1.21 §3.8: one summit claim per UTC day from 2004.
                // Chasers have no activator seasonal bonus. This is a base estimate,
                // not an assertion about expedition or submitted-credit validity.
                let modern=valid.filter { $0.start >= Date(timeIntervalSince1970:1072915200) }
                let days=Set(modern.map { Int(floor($0.start.timeIntervalSince1970/86400)) })
                if valid.count == units[index].evidence.count, modern.count == valid.count {
                    units[index].points=days.count*points;units[index].chaserPointsPerDay=points
                }
            }
        }
        if programme == "wac" {
            for scope in scopes {
                for continent in wacContinents where !units.contains(where:{$0.scope == scope && $0.unit == continent}) {
                    units.append(LocalAwardUnit(unit:continent,scope:scope,role:"worked",evidence:[]))
                }
            }
        }
        return LocalAwardSnapshot(programme:programme,units:units.sorted { ($0.scope,$0.role,$0.unit) < ($1.scope,$1.role,$1.unit) },
            scopes:scopes.sorted(),unknownContacts:unknown,referenceVersion:referenceVersion,
            unclassified:unclassified.mapValues{$0.sorted{$0.start == $1.start ? $0.id.uuidString<$1.id.uuidString : $0.start>$1.start}})
    }

    private static func referenceDate(_ raw: String) -> Date? {
        let formatter=DateFormatter(); formatter.locale=Locale(identifier:"en_US_POSIX"); formatter.timeZone=TimeZone(secondsFromGMT:0); formatter.isLenient=false
        for format in ["dd/MM/yyyy","yyyy-MM-dd","MM/dd/yyyy"] {
            formatter.dateFormat=format
            if let date=formatter.date(from:raw), formatter.string(from:date) == raw { return date }
        }
        return nil
    }
}

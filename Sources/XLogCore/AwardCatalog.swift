import Foundation
#if canImport(CryptoKit)
import CryptoKit
#else
import Crypto
#endif

public struct AwardBreakdown: Codable, Identifiable, Equatable, Sendable {
    public var label: String
    public var value: Int
    public var target: Int?
    public var id: String { label }

    public init(label: String, value: Int, target: Int? = nil) {
        self.label = label
        self.value = value
        self.target = target
    }
}

public struct AwardCatalogItem: Codable, Identifiable, Equatable, Sendable {
    public var code: String
    public var title: String
    public var programme: String
    public var worked: Int
    public var current: Int
    public var sponsorCredited: Int?
    public var target: Int
    public var unit: String
    public var detail: String
    public var breakdowns: [AwardBreakdown]
    public var id: String { code }
    public var completed: Bool { current >= target }
    public var fraction: Double { min(1, Double(current) / Double(max(1, target))) }

    public init(
        code: String,
        title: String,
        programme: String,
        worked: Int? = nil,
        current: Int,
        sponsorCredited: Int? = nil,
        target: Int,
        unit: String,
        detail: String,
        breakdowns: [AwardBreakdown] = []
    ) {
        self.code = code
        self.title = title
        self.programme = programme
        self.worked = worked ?? current
        self.current = current
        self.sponsorCredited = sponsorCredited
        self.target = target
        self.unit = unit
        self.detail = detail
        self.breakdowns = breakdowns
    }
}

/// The calculators depend on these ADIF fields, not the entire editable QSO.
/// Keeping their input explicit makes cold catalogue reads smaller and makes
/// any future rule's additional field dependency a compile-time change.
public struct AwardCatalogContact: Decodable, Sendable {
    public let call: String
    public let start: Date
    public let band: String
    public let mode: String
    public let submode: String
    public let dxcc: Int?
    public let state: String
    public let county: String
    public let qslReceived: String
    public let lotwReceived: String
    public let propagationMode: String
    public let extraFields: [String: String]

    public init(_ qso: QSO) {
        call = qso.call; start = qso.start; band = qso.band; mode = qso.mode
        submode = qso.submode; dxcc = qso.dxcc; state = qso.state; county = qso.county
        qslReceived = qso.qslReceived; lotwReceived = qso.lotwReceived
        propagationMode = qso.propagationMode; extraFields = qso.extraFields
    }
}

public struct AwardCatalogSnapshot: Codable, Equatable, Sendable {
    public var items: [AwardCatalogItem]
    public var programmes: [AwardProgramme]
    public var referenceDate: String
    public var researchDate: String

    public init(
        items: [AwardCatalogItem] = [],
        programmes: [AwardProgramme] = [],
        referenceDate: String = "",
        researchDate: String = ""
    ) {
        self.items = items
        self.programmes = programmes
        self.referenceDate = referenceDate
        self.researchDate = researchDate
    }

    public static let empty = AwardCatalogSnapshot()
}

public enum AwardCatalogError: Error, LocalizedError {
    case missingResource(String)
    case invalidResource(String)

    public var errorDescription: String? {
        switch self {
        case let .missingResource(name): return "The bundled award reference \(name) is missing."
        case let .invalidResource(name): return "The bundled award reference \(name) is invalid."
        }
    }
}

public enum AwardCatalogEngine {
    // Bump the rules version when calculator semantics change. Resource edits
    // invalidate automatically, including research records and school lists.
    static let persistedCacheKey: Result<String, Error> = Result {
        var digest = SHA256()
        for name in ["ham-award-jarl-entities", "ham-award-wcsa-schools", "ham-award-research-registry"] {
            guard let url = Bundle.module.url(forResource: name, withExtension: "json") else {
                throw AwardCatalogError.missingResource(name)
            }
            digest.update(data: try Data(contentsOf: url))
        }
        return "catalog-rules-v1-" + digest.finalize().map { String(format: "%02x", $0) }.joined()
    }

    /// Candidate superset for every implemented calculator below (JARL,
    /// WAPC, and WCSA). Keep this alongside compute when adding a programme.
    /// Slash calls are deliberately broad: a school may be a portable part.
    public static let candidateDXCCs = [339, 177, 192, 318, 386, 321, 152]

    public static func candidateSchoolCalls() throws -> [String] {
        guard let url = Bundle.module.url(forResource: "ham-award-wcsa-schools", withExtension: "json") else {
            throw AwardCatalogError.missingResource("WCSA schools")
        }
        let schools = try JSONDecoder().decode([String: String].self, from: Data(contentsOf: url))
        return schools.keys.map { $0.uppercased() }.sorted()
    }
    private struct JAREntity: Decodable, Sendable {
        var type: String
        var deleted: Bool
        var deletedDate: String
        var designatedCityDate: String?

        enum CodingKeys: String, CodingKey {
            case type, deleted
            case deletedDate = "deleted_date"
            case designatedCityDate = "designated_city_date"
        }
    }

    private struct ReferenceData: Sendable {
        var entities: [String: JAREntity]
        var schools: [String: String]
        var referenceDate: String
    }

    private static let supportedAJABands = [
        "160m", "80m", "40m", "30m", "20m", "17m", "15m", "12m", "10m",
        "6m", "2m", "70cm", "23cm", "13cm", "6cm",
    ]
    private static let wapcBands = ["160m", "80m", "40m", "30m", "20m", "17m", "15m", "12m", "10m", "6m"]
    private static let wapcProvinces = [
        "BJ", "HL", "JL", "LN", "TJ", "NM", "HE", "SX", "SH", "SD", "JS", "ZJ",
        "JX", "FJ", "AH", "HA", "HB", "HN", "GD", "GX", "HI", "SC", "CQ", "GZ",
        "YN", "SN", "GS", "NX", "QH", "XJ", "XZ", "TW", "HK", "MO",
    ]

    public static func compute(qsos: [QSO]) throws -> AwardCatalogSnapshot {
        try compute(contacts: qsos.map(AwardCatalogContact.init))
    }

    public static func compute(contacts qsos: [AwardCatalogContact]) throws -> AwardCatalogSnapshot {
        let reference = try loadReferenceData()
        let confirmed = qsos.filter { isConfirmed($0, includeEQSL: true) }
        let confirmedWithoutEQSL = qsos.filter { isConfirmed($0, includeEQSL: false) }

        var districts = Set<String>()
        var prefectures = Set<String>()
        var jcc = Set<String>()
        var jcg = Set<String>()
        var aja = Set<String>()

        for original in confirmed where isJapan(original) {
            let mapped = japanFields(original)
            if let prefecture = mapped.prefecture, let district = district(for: prefecture) {
                let callDistrict = mapped.call.hasPrefix("J") && mapped.call.count >= 3
                    ? String(mapped.call[mapped.call.index(mapped.call.startIndex, offsetBy: 2)])
                    : "1"
                if callDistrict == district {
                    districts.insert(district)
                    prefectures.insert(prefecture)
                }
            }

            guard let county = mapped.county, let entity = reference.entities[county] else { continue }
            // Active ordinary entities have no date-dependent rule. Avoid
            // constructing a calendar and formatted date for those contacts.
            let date = entity.deleted || entity.type == "designated city" ? yyyymmdd(original.start) : ""
            guard !(entity.deleted && date > entity.deletedDate) else { continue }

            switch entity.type {
            case "city", "designated city": jcc.insert(county)
            case "ku": jcc.insert(String(county.prefix(4)))
            case "gun": jcg.insert(county)
            default: break
            }

            guard county != "1001", supportedAJABands.contains(original.band.lowercased()) else { continue }
            if entity.type == "designated city",
               let designatedDate = entity.designatedCityDate,
               !designatedDate.isEmpty,
               date >= designatedDate { continue }
            aja.insert("\(county):\(original.band.lowercased())")
        }

        let activeCities = Set(reference.entities.compactMap { code, entity in
            !entity.deleted && (entity.type == "city" || entity.type == "designated city") ? code : nil
        })
        let activeGuns = Set(reference.entities.compactMap { code, entity in
            !entity.deleted && entity.type == "gun" ? code : nil
        })
        let waca = jcc.intersection(activeCities)
        let waga = jcg.intersection(activeGuns)

        var wapcMixed = Set<String>()
        var wapcByBand = Dictionary(uniqueKeysWithValues: wapcBands.map { ($0, Set<String>()) })
        var wapcByMode = ["CW": Set<String>(), "PHONE": Set<String>(), "DATA": Set<String>()]
        for qso in confirmedWithoutEQSL {
            guard let province = wapcProvince(qso), wapcProvinces.contains(province) else { continue }
            wapcMixed.insert(province)
            let band = qso.band.lowercased()
            if wapcBands.contains(band) { wapcByBand[band, default: []].insert(province) }
            wapcByMode[modeGroup(qso), default: []].insert(province)
        }

        let wcsa = wcsaProgress(qsos: confirmedWithoutEQSL, schools: reference.schools)
        let worked = workedCounts(qsos: qsos, reference: reference)
        let jccTarget = nextMilestone(jcc.count, values: [100, 200, 300, 400, 500, 600, 700, 800])
        let jcgTarget = nextMilestone(jcg.count, values: [100, 200, 300, 400, 500])
        let ajaTarget = nextAJATarget(aja.count)
        let wcsaTarget = wcsa.slotCount < 3 ? 3 : (wcsa.slotCount < 6 ? 6 : 10)
        let wcsaLevel = wcsa.slotCount >= 10 && wcsa.schoolCount >= 3 ? "Gold achieved" :
            (wcsa.slotCount >= 6 && wcsa.schoolCount >= 2 ? "Silver achieved · Gold next" :
                (wcsa.slotCount >= 3 && wcsa.schoolCount >= 1 ? "Bronze achieved · Silver next" : "Bronze next"))

        let liveItems = [
            AwardCatalogItem(code: "AJD", title: "All Japan Districts", programme: "JARL", worked: worked["AJD"], current: districts.count, target: 10, unit: "districts", detail: "Evidence-eligible contacts in all ten Japanese call districts."),
            AwardCatalogItem(code: "WAJA", title: "Worked All Japan Prefectures", programme: "JARL", worked: worked["WAJA"], current: prefectures.count, target: 47, unit: "prefectures", detail: "Evidence-eligible contacts in Japan's 47 prefectures."),
            AwardCatalogItem(code: "JCC", title: "Japan Century Cities", programme: "JARL", worked: worked["JCC"], current: jcc.count, target: jccTarget, unit: "cities", detail: "Evidence-eligible city contacts · award levels 100–800."),
            AwardCatalogItem(code: "JCG", title: "Japan Century Guns", programme: "JARL", worked: worked["JCG"], current: jcg.count, target: jcgTarget, unit: "guns", detail: "Evidence-eligible Japanese district contacts · award levels 100–500."),
            AwardCatalogItem(code: "AJA", title: "All Japan Award", programme: "JARL", worked: worked["AJA"], current: aja.count, target: ajaTarget, unit: "entity-bands", detail: "Unique evidence-eligible JCC, JCG and Ku entities by band · basic award at 1,000."),
            AwardCatalogItem(code: "WACA", title: "Worked All Cities Award", programme: "JARL", worked: worked["WACA"], current: waca.count, target: activeCities.count, unit: "active cities", detail: "All current Japanese city entities; deleted entities are excluded."),
            AwardCatalogItem(code: "WAGA", title: "Worked All Guns Award", programme: "JARL", worked: worked["WAGA"], current: waga.count, target: activeGuns.count, unit: "active guns", detail: "All current Japanese gun entities; deleted entities are excluded."),
            AwardCatalogItem(
                code: "WAPC", title: "Worked All Provinces of China", programme: "Mulan DXC",
                worked: worked["WAPC"], current: wapcMixed.count, target: wapcProvinces.count, unit: "provinces",
                detail: "Mainland provinces, autonomous regions, municipalities, Taiwan, Hong Kong and Macau.",
                breakdowns: wapcBands.map { AwardBreakdown(label: $0, value: wapcByBand[$0]?.count ?? 0, target: 34) }
                    + ["CW", "PHONE", "DATA"].map { AwardBreakdown(label: $0, value: wapcByMode[$0]?.count ?? 0, target: 34) }
            ),
            AwardCatalogItem(
                code: "WCSA", title: "Worked Chinese Schools Award", programme: "WCSA",
                worked: worked["WCSA"], current: wcsa.slotCount, target: wcsaTarget, unit: "slots",
                detail: "\(wcsaLevel) · \(wcsa.schoolCount) school\(wcsa.schoolCount == 1 ? "" : "s") confirmed.",
                breakdowns: [
                    AwardBreakdown(label: "Schools", value: wcsa.schoolCount, target: 3),
                    AwardBreakdown(label: "Bronze", value: min(wcsa.slotCount, 3), target: 3),
                    AwardBreakdown(label: "Silver", value: min(wcsa.slotCount, 6), target: 6),
                    AwardBreakdown(label: "Gold", value: min(wcsa.slotCount, 10), target: 10),
                ]
            ),
        ]
        let registry = try AwardRegistry.programmes(progress: liveItems)
        return AwardCatalogSnapshot(
            items: liveItems,
            programmes: registry.items,
            referenceDate: reference.referenceDate,
            researchDate: registry.researchDate
        )
    }

    private static func workedCounts(qsos: [AwardCatalogContact], reference: ReferenceData) -> [String: Int] {
        var districts = Set<String>()
        var prefectures = Set<String>()
        var jcc = Set<String>()
        var jcg = Set<String>()
        var aja = Set<String>()

        for original in qsos where isJapan(original) {
            let mapped = japanFields(original)
            if let prefecture = mapped.prefecture, let district = district(for: prefecture) {
                let callDistrict = mapped.call.hasPrefix("J") && mapped.call.count >= 3
                    ? String(mapped.call[mapped.call.index(mapped.call.startIndex, offsetBy: 2)])
                    : "1"
                if callDistrict == district {
                    districts.insert(district)
                    prefectures.insert(prefecture)
                }
            }

            guard let county = mapped.county, let entity = reference.entities[county] else { continue }
            let date = entity.deleted || entity.type == "designated city" ? yyyymmdd(original.start) : ""
            guard !(entity.deleted && date > entity.deletedDate) else { continue }
            switch entity.type {
            case "city", "designated city": jcc.insert(county)
            case "ku": jcc.insert(String(county.prefix(4)))
            case "gun": jcg.insert(county)
            default: break
            }
            guard county != "1001", supportedAJABands.contains(original.band.lowercased()) else { continue }
            if entity.type == "designated city",
               let designatedDate = entity.designatedCityDate,
               !designatedDate.isEmpty,
               date >= designatedDate { continue }
            aja.insert("\(county):\(original.band.lowercased())")
        }

        let activeCities = Set(reference.entities.compactMap { code, entity in
            !entity.deleted && (entity.type == "city" || entity.type == "designated city") ? code : nil
        })
        let activeGuns = Set(reference.entities.compactMap { code, entity in
            !entity.deleted && entity.type == "gun" ? code : nil
        })
        let wapc = Set(qsos.compactMap(wapcProvince)).intersection(wapcProvinces)
        let wcsa = wcsaProgress(qsos: qsos, schools: reference.schools)
        return [
            "AJD": districts.count,
            "WAJA": prefectures.count,
            "JCC": jcc.count,
            "JCG": jcg.count,
            "AJA": aja.count,
            "WACA": jcc.intersection(activeCities).count,
            "WAGA": jcg.intersection(activeGuns).count,
            "WAPC": wapc.count,
            "WCSA": wcsa.slotCount,
        ]
    }

    private static func loadReferenceData() throws -> ReferenceData {
        guard let entityURL = Bundle.module.url(forResource: "ham-award-jarl-entities", withExtension: "json") else {
            throw AwardCatalogError.missingResource("JARL entities")
        }
        guard let schoolURL = Bundle.module.url(forResource: "ham-award-wcsa-schools", withExtension: "json") else {
            throw AwardCatalogError.missingResource("WCSA schools")
        }
        let entityData = try Data(contentsOf: entityURL)
        let raw = try JSONSerialization.jsonObject(with: entityData) as? [String: Any]
        guard let raw else { throw AwardCatalogError.invalidResource("JARL entities") }
        let decoder = JSONDecoder()
        var entities: [String: JAREntity] = [:]
        for (code, value) in raw where code != "_meta" {
            let data = try JSONSerialization.data(withJSONObject: value)
            entities[code] = try decoder.decode(JAREntity.self, from: data)
        }
        let referenceDate = ((raw["_meta"] as? [String: Any])?["last_update"] as? String) ?? ""
        let schools = try decoder.decode([String: String].self, from: Data(contentsOf: schoolURL))
        return ReferenceData(
            entities: entities,
            schools: Dictionary(uniqueKeysWithValues: schools.map { ($0.key.uppercased(), $0.value) }),
            referenceDate: referenceDate
        )
    }

    private static func isConfirmed(_ qso: AwardCatalogContact, includeEQSL: Bool) -> Bool {
        let accepted = Set(["Y", "V"])
        if accepted.contains(qso.qslReceived.trimmedUpper) || accepted.contains(qso.lotwReceived.trimmedUpper) { return true }
        return includeEQSL && accepted.contains(extra(qso, keys: ["EQSL_QSL_RCVD", "eqslQSLReceived"]).trimmedUpper)
    }

    private static func isJapan(_ qso: AwardCatalogContact) -> Bool { [339, 177, 192].contains(qso.dxcc ?? -1) }

    private static func japanFields(_ qso: AwardCatalogContact) -> (call: String, prefecture: String?, county: String?) {
        if qso.dxcc == 177 || qso.dxcc == 192 { return (qso.call.trimmedUpper, "10", "10007") }
        let prefecture = qso.state.trimmedUpper.isEmpty ? nil : qso.state.trimmedUpper
        let county = qso.county.trimmedUpper.isEmpty ? nil : qso.county.trimmedUpper
        return (qso.call.trimmedUpper, prefecture, county)
    }

    private static func district(for prefecture: String) -> String? {
        guard let number = Int(prefecture) else { return nil }
        switch number {
        case 1: return "8"
        case 2...7: return "7"
        case 8...9: return "0"
        case 10...17: return "1"
        case 18...21: return "2"
        case 22...27: return "3"
        case 28...30: return "9"
        case 31...35: return "4"
        case 36...39: return "5"
        case 40...47: return "6"
        default: return nil
        }
    }

    private static func wapcProvince(_ qso: AwardCatalogContact) -> String? {
        switch qso.dxcc {
        case 318: return qso.state.trimmedUpper
        case 386: return "TW"
        case 321: return "HK"
        case 152: return "MO"
        default: return nil
        }
    }

    private static func modeGroup(_ qso: AwardCatalogContact) -> String {
        let mode = (qso.submode.isEmpty ? qso.mode : qso.submode).trimmedUpper
        if mode == "CW" { return "CW" }
        if ["AM", "FM", "SSB", "USB", "LSB", "DIGITALVOICE", "VOI"].contains(mode) { return "PHONE" }
        return "DATA"
    }

    private static func wcsaProgress(qsos: [AwardCatalogContact], schools: [String: String]) -> (schoolCount: Int, slotCount: Int) {
        var schoolCalls = Set<String>()
        var slots = Set<String>()
        for qso in qsos {
            let call = qso.call.trimmedUpper
            guard let school = ([call] + call.split(separator: "/").map(String.init)).first(where: { schools[$0] != nil }) else { continue }
            let mode = qso.mode.trimmedUpper
            guard !mode.isEmpty else { continue }
            let propagation = qso.propagationMode.trimmedUpper
            let key: String
            if propagation == "SAT" {
                let satellite = extra(qso, keys: ["SAT_NAME", "satelliteName"]).trimmedUpper
                guard !satellite.isEmpty else { continue }
                key = "\(call)|SAT|\(satellite)|\(mode)"
            } else {
                let band = qso.band.trimmedUpper
                guard !band.isEmpty else { continue }
                key = propagation == "EME" || propagation == "MS"
                    ? "\(call)|\(band)|\(mode)|\(propagation)"
                    : "\(call)|\(band)|\(mode)"
            }
            schoolCalls.insert(school)
            slots.insert(key)
        }
        return (schoolCalls.count, slots.count)
    }

    private static func extra(_ qso: AwardCatalogContact, keys: [String]) -> String {
        let wanted = Set(keys.map { $0.lowercased() })
        return qso.extraFields.first(where: { wanted.contains($0.key.lowercased()) })?.value ?? ""
    }

    private static func nextMilestone(_ count: Int, values: [Int]) -> Int {
        values.first(where: { count < $0 }) ?? (values.last ?? max(1, count))
    }

    private static func nextAJATarget(_ count: Int) -> Int {
        if count < 1_000 { return 1_000 }
        if count < 3_000 { return ((count - 1_000) / 500 + 1) * 500 + 1_000 }
        return ((count - 3_000) / 150 + 1) * 150 + 3_000
    }

    private static func yyyymmdd(_ date: Date) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let components = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d%02d%02d", components.year ?? 0, components.month ?? 0, components.day ?? 0)
    }
}

private extension String {
    var trimmedUpper: String { trimmingCharacters(in: .whitespacesAndNewlines).uppercased() }
}

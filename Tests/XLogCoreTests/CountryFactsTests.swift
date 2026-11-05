import Foundation
import Testing
@testable import XLogCore

@Suite("Shared country facts and real OK1RR snapshot")
struct CountryFactsTests {
    private static let packed = try! CTYResolver.bundledCountryPack()
    private let day = ISO8601DateFormatter().date(from: "2020-01-01T12:00:00Z")!

    @Test("Independent corpus retains slash identity, modifiers and unavailable position")
    func portableCorpus() throws {
        let resolver = try CTYResolver.bundled()
        for (call, expected) in [("OM0RX/EA8", 29), ("EA8/OM0RX/P", 29), ("OM0RX/P", 504),
                                 ("MM/LY3X/P", 279), ("OM0RX/QRP", 504), ("OM0RX/LH", 504),
                                 ("DL1ABC/F", 227), ("KG4ABC", 291)] {
            let value = resolver.facts(call, at: day)
            #expect(value.literalCall == call)
            #expect(value.status == .resolved)
            #expect(value.country?.adif == expected)
            #expect(value.locationPrecision == "entityApproximation")
        }
        for call in ["OM0RX/MM", "OM0RX/AM"] {
            #expect(resolver.facts(call, at: day).status == .knownNoEntity)
            #expect(resolver.facts(call, at: day).country == nil)
            #expect(resolver.resolve(call, at: day)?.adif == 504) // compatibility only
        }
        for call in ["OM0RX/", "/OM0RX", "OM0RX//P", "OM0RX?", "OM0RX P", "ß1ABC"] {
            #expect(resolver.facts(call, at: day).status == .invalid)
        }
        #expect(resolver.facts("OM0RX", at: nil).status == .missingDate)
        #expect(resolver.facts("OM0RX/4", at: day).status == .unknown)
        #expect(resolver.facts("OM0RX/K1ABC", at: day).status == .ambiguous)
        // ZZ is a geographic prefix, not an unknown marker: the bundled PY row
        // includes ZZ (Brazil 108), consistent with ITU Appendix 42's ZVA–ZZZ.
        // https://www.itu.int/gladapp/Allocation/CallSigns
        #expect(resolver.facts("OM0RX/ZZ", at: day).status == .resolved)
        #expect(resolver.facts("OM0RX/ZZ", at: day).country?.adif == 108)
        // QQ has no geographic rule in either admitted bundle. Preserve the
        // unsupported-suffix assertion: never fall back to OM/Slovakia here.
        for snapshot in [resolver, Self.packed] {
            #expect(snapshot.facts("OM0RX/QQ", at: day).status == .unknown)
            #expect(snapshot.facts("OM0RX/QQ", at: day).country == nil)
        }
    }

    @Test("Date boundaries and contradictory equal-authority rules are independent of file order")
    func dateAndAmbiguity() throws {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".xml")
        defer { try? FileManager.default.removeItem(at: file) }
        let prefix = "<prefix><call>OM</call><adif>504</adif><cqz>15</cqz><entity>Slovakia</entity></prefix>"
        let exception = "<exception><call>OM0RX/LH</call><adif>147</adif><cqz>30</cqz><entity>Dated synthetic exception</entity><start>2020-01-01 00:00:00</start><end>2020-01-01 23:59:59</end></exception>"
        try "<cty>\(prefix)\(exception)</cty>".write(to: file, atomically: true, encoding: .utf8)
        let resolver = try CTYResolver(xmlURL: file)
        #expect(resolver.facts("OM0RX/LH", at: day).country?.adif == 147)
        #expect(resolver.facts("OM0RX/LH", at: Date(timeIntervalSince1970: 1577836799)).country?.adif == 504)
        #expect(resolver.facts("OM0RX/LH", at: Date(timeIntervalSince1970: 1577923200)).country?.adif == 504)
        let a = "OM,First,504,EU,15,28,48,-17,-1,OM;\n"
        let b = "OM,Contradiction,503,EU,15,28,48,-17,-1,OM;\n"
        for csv in [a + b, b + a] {
            let path = file.deletingPathExtension().appendingPathExtension("csv")
            defer { try? FileManager.default.removeItem(at: path) }
            try csv.write(to: path, atomically: true, encoding: .utf8)
            #expect(try CTYResolver(csvURL: path).facts("OM0RX", at: day).status == .ambiguous)
        }
    }

    @Test("Pinned real derivative has historical, exact and country-area coverage")
    func actualDataset() throws {
        let resolver = Self.packed
        let pack = try #require(resolver.countryPack)
        #expect(pack.sourceRevision == "4adb0e70bf29faefc3b203bc355796cd0c6201fe")
        #expect(pack.records.count == 21335)
        #expect(pack.excluded.count == 302) // includes eight collapsed identical aliases/windows
        #expect(pack.components.count == 6)
        #expect(resolver.facts("OK1AYY", at: ISO8601DateFormatter().date(from: "1992-12-12T12:00:00Z")).country?.adif == 218)
        #expect(resolver.facts("OK1AYY", at: day).country?.adif == 503)
        let portable = resolver.facts("EA8/OM0RX/P", at: day)
        #expect(portable.status == .resolved, "\(portable)")
        #expect(portable.country?.adif == 29)
        let suffix = resolver.facts("OM0RX/EA8", at: day)
        #expect(suffix.status == .resolved, "\(suffix)")
        #expect(suffix.country?.adif == 29)
        #expect(resolver.facts("KL7AA/1", at: day).country?.adif == 291)
        // Source-defined area semantics on synthetic calls, not live-station claims.
        let argentineArea = resolver.facts("LU1ZZZ/F", at: day)
        #expect(argentineArea.country?.adif == 100)
        #expect(argentineArea.country?.name == "ARGENTINA")
        #expect(argentineArea.matchedDescription?.contains("SANTA FE") == true)
        let slovakArea = resolver.facts("OM0AAO", at: day)
        #expect(slovakArea.country?.name == "SLOVAK REPUBLIC")
        #expect(slovakArea.matchedDescription == "SLOVAKIA, PRESOV, BARDEJOV")
        #expect(resolver.facts("3Y0ZZZ", at: day).status == .ambiguous)
        #expect(resolver.facts("OM0RX/MM", at: day).status == .knownNoEntity)
        let expedition = resolver.facts("2O12L", at: ISO8601DateFormatter().date(from: "2012-07-20T00:00:00Z"))
        #expect(expedition.country?.adif == 223)
        #expect(expedition.matchedRule?.contains("CallResolution.tbl") == true)
    }

    @Test("A missing exact exception still permits finer area rules and mobile qualifiers")
    func ambiguousPrefixDoesNotEndExactSearch() {
        let resolver = Self.packed
        for (call, adif) in [("FT4XZZZ", 131), ("R1ANZZZ", 13)] {
            let value = resolver.facts(call, at: day)
            #expect(value.status == .resolved, "\(call): \(value)")
            #expect(value.country?.adif == adif)
        }
        for call in ["VK2ZZZ/MM", "3Y0ZZZ/AM"] {
            #expect(resolver.facts(call, at: day).status == .knownNoEntity)
            #expect(resolver.facts(call, at: day).country == nil)
        }
        #expect(resolver.facts("3Y0ZZZ", at: day).status == .ambiguous)
    }

    @Test("One validator rejects invalid packs and imported bytes preserve snapshot identity")
    func validation() throws {
        let data = try CTYResolver.bundledCountryPackBytes()
        #expect(try CTYResolver(countryPack: data).snapshotIdentity == Self.packed.snapshotIdentity)
        var object = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        object["records"] = []
        #expect(throws: (any Error).self) { try CTYResolver(countryPack: JSONSerialization.data(withJSONObject: object)) }
        object = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        object["components"] = [:]
        #expect(throws: (any Error).self) { try CTYResolver(countryPack: JSONSerialization.data(withJSONObject: object)) }
    }

    @Test("Packed entity names retain every applicable legacy catalogue label")
    func completeCatalogueLabels() throws {
        let legacy = try CTYResolver.bundled()
        let names = Dictionary(uniqueKeysWithValues: legacy.entities.map { ($0.adif, $0.name) })
        let packed = Self.packed.entities
        let pack = try #require(Self.packed.countryPack)
        let applicable = Set(pack.records.map { $0.country.adif }).intersection(names.keys)
        #expect(applicable.count > 300)
        #expect(Set(packed.filter { names[$0.adif] != nil }.map(\.adif)) == applicable)
        for country in packed {
            if let expected = names[country.adif] { #expect(country.name == expected, "ADIF \(country.adif)") }
        }
        #expect(Self.packed.entityADIFs == Set(packed.map(\.adif)))
        #expect(legacy.entityADIFs == Set(legacy.entities.map(\.adif)))
        let csv = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".csv")
        defer { try? FileManager.default.removeItem(at: csv) }
        try "ZZ,Synthetic,999,EU,15,28,48,-17,-1,ZZ;\n".write(to: csv, atomically: true, encoding: .utf8)
        let custom = try CTYResolver(csvURL: csv)
        let combined = custom.fillingUnknownFacts(with: Self.packed)
        #expect(custom.entityADIFs == Set(custom.entities.map(\.adif)))
        #expect(combined.entityADIFs == Set(combined.entities.map(\.adif)))
    }

    @Test("Literal exact and prefix rules retain wildcard boundaries and full validation")
    func literalRuleBoundaries() throws {
        var object = try #require(JSONSerialization.jsonObject(with: CTYResolver.bundledCountryPackBytes()) as? [String: Any])
        let originals = try #require(object["records"] as? [[String: Any]])
        let components = ["Country.tab", "CallResolution.tbl", "AreaOK1RR.tbl", "CountryDel.tab"]
        var records = Array(originals.prefix(100))
        for index in records.indices {
            records[index]["pattern"] = "QQ\(index)A"
            records[index]["exact"] = true
            records[index]["deleted"] = false
            records[index]["component"] = components[index % components.count]
            records[index]["line"] = index + 1
            records[index].removeValue(forKey: "start"); records[index].removeValue(forKey: "end")
            records[index]["country"] = ["name": "Synthetic", "adif": index == 0 ? 504 : 147,
                "continent": "EU", "cqZone": 15, "ituZone": 28]
        }
        records[0]["pattern"] = "ZZ1ABC"
        records[1]["pattern"] = "ZZ1"; records[1]["exact"] = false
        records[2]["pattern"] = "ZZ2?"; records[2]["exact"] = false
        records[3]["pattern"] = "ZZ3[A-C]"
        object["ambiguousPrefixes"] = [] // This synthetic fixture defines its own complete rule set.
        object["records"] = records
        let resolver = try CTYResolver(countryPack: JSONSerialization.data(withJSONObject: object))
        #expect(resolver.facts("ZZ1ABC", at: day).country?.adif == 504)
        for call in ["ZZ1ABCD", "ZZ2AABC", "ZZ3B"] {
            #expect(resolver.facts(call, at: day).country?.adif == 147, "\(call)")
        }
        for call in ["ZZ0ABC", "ZZ22ABC", "ZZ3D", "ZZ3BA"] {
            #expect(resolver.facts(call, at: day).status == .unknown, "\(call)")
        }
        let valid = records[0]
        for pattern in ["", String(repeating: "A", count: 129), "ZZ1*", "ZZ1[Z-A]"] {
            records[0] = valid; records[0]["pattern"] = pattern; object["records"] = records
            #expect(throws: (any Error).self) { try CTYResolver(countryPack: JSONSerialization.data(withJSONObject: object)) }
        }
        for (start, end) in [("2020-02-30T00:00:00Z", "2020-03-01T00:00:00Z"),
                             ("2021-01-01T00:00:00Z", "2020-01-01T00:00:00Z")] {
            records[0] = valid; records[0]["start"] = start; records[0]["end"] = end; object["records"] = records
            #expect(throws: (any Error).self) { try CTYResolver(countryPack: JSONSerialization.data(withJSONObject: object)) }
        }
    }

    @Test("Neutral fallback fills only unknown facts and retains winning source under a composite identity")
    func neutralFallback() throws {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".csv")
        defer { try? FileManager.default.removeItem(at: file) }
        try "OM,First,504,EU,15,28,48,-17,-1,OM;\nOM,Contradiction,503,EU,15,28,48,-17,-1,OM;\n"
            .write(to: file, atomically: true, encoding: .utf8)
        let primary = try CTYResolver(csvURL: file)
        let combined = primary.fillingUnknownFacts(with: Self.packed)
        #expect(combined.snapshotIdentity != primary.snapshotIdentity)
        #expect(combined.snapshotIdentity != Self.packed.snapshotIdentity)
        let norway = combined.facts("LN8W", at: day)
        #expect(norway.status == .resolved)
        #expect(norway.country?.adif == 266)
        #expect(norway.referenceRevision == combined.snapshotIdentity)
        #expect(norway.matchedReferenceRevision == Self.packed.snapshotIdentity)
        #expect(primary.resolve("LN8W", at: day) == nil)
        #expect(combined.resolve("LN8W", at: day) == nil) // deliberate source-only legacy adapter
        for (call, at, expected) in [("OM0RX", day as Date?, CTYResolver.Facts.Status.ambiguous),
                                     ("OM0RX/MM", day, .knownNoEntity), ("OM0RX?", day, .invalid),
                                     ("OM0RX", nil, .missingDate)] {
            let facts = combined.facts(call, at: at)
            #expect(facts.status == expected)
            #expect(facts.country == nil)
            #expect(facts.referenceRevision == combined.snapshotIdentity)
        }
    }
}

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
        #expect(resolver.facts("LU1ZZZ/F", at: day).country?.name.contains("SANTA FE") == true)
        #expect(resolver.facts("3Y0ZZZ", at: day).status == .ambiguous)
        #expect(resolver.facts("OM0RX/MM", at: day).status == .knownNoEntity)
        let expedition = resolver.facts("2O12L", at: ISO8601DateFormatter().date(from: "2012-07-20T00:00:00Z"))
        #expect(expedition.country?.adif == 223)
        #expect(expedition.matchedRule?.contains("CallResolution.tbl") == true)
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
}

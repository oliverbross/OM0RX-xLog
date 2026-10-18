import Foundation
import Testing
@testable import XLogCore

@Suite("CTY source authority")
struct CTYResolverTests {
    @Test("Bundled PJ prefixes retain their distinct modern entities")
    func modernPJEntities() throws {
        let resolver = try CTYResolver.bundled()
        for (call, adif) in [("PJ2T", 517), ("PJ4A", 520), ("PJ5A", 519),
                            ("PJ6Y", 519), ("PJ7A", 518), ("S21ABC", 305)] {
            #expect(resolver.resolve(call)?.adif == adif)
            #expect(resolver.resolve(call + "/P")?.adif == adif)
        }
        #expect(resolver.resolve("PJ4/OM0RX")?.adif == 520)
    }

    @Test("Bundled Slovak prefix resolves OM0AAO for offline callsign intelligence")
    func slovakPrefix() throws {
        let country = try #require(CTYResolver.bundled().resolve(" om0aao "))
        #expect(country.adif == 504)
        #expect(country.name == "SLOVAK REPUBLIC")
        #expect(country.continent == "EU")
    }

    @Test("Continent annotations remain opt-in and do not change legacy token matching")
    func continentOverrideDoesNotChangeLegacyMatching() throws {
        let csv = "XY,Fixture Country,999,EU,14,28,48.00,-17.00,-1.0,ZZ{AF};\n"
        let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".csv")
        defer { try? FileManager.default.removeItem(at: file) }
        try csv.write(to: file, atomically: true, encoding: .utf8)

        let resolver = try CTYResolver(csvURL: file)
        #expect(resolver.resolve("ZZ1ABC") == nil)
        let endpoint = try #require(resolver.resolveCountryEndpoint("ZZ1ABC"))
        #expect(endpoint.adif == 999)
        #expect(endpoint.continent == "AF")
    }

    @Test("Pinned bundled CTY currently has no continent annotations")
    func bundledCTYHasNoContinentAnnotations() throws {
        let csv = try CTYResolver.bundledCSV()
        #expect(!csv.contains("{"))
    }

    @Test("XML PJ rules honor validity dates and exact-call exceptions")
    func datedPJRulesAndExceptions() throws {
        // Deliberately include Bangladesh: its presence must not override PJ rules.
        let xml = """
        <cty>
          <prefix><call>S2</call><adif>305</adif><cqz>22</cqz><entity>Bangladesh</entity></prefix>
          <prefix><call>PJ2</call><adif>85</adif><cqz>9</cqz><entity>Historical fixture</entity><end>2010-10-09 23:59:59</end></prefix>
          <prefix><call>PJ2</call><adif>517</adif><cqz>9</cqz><entity>Curacao</entity><start>2010-10-10 00:00:00</start></prefix>
          <prefix><call>PJ4</call><adif>520</adif><cqz>9</cqz><entity>Bonaire</entity></prefix>
          <prefix><call>PJ5</call><adif>519</adif><cqz>8</cqz><entity>Saba and St Eustatius</entity></prefix>
          <prefix><call>PJ6</call><adif>519</adif><cqz>8</cqz><entity>Saba and St Eustatius</entity></prefix>
          <prefix><call>PJ7</call><adif>518</adif><cqz>8</cqz><entity>Sint Maarten</entity></prefix>
          <exception><call>PJ6Y</call><adif>520</adif><cqz>9</cqz><entity>Exact-call fixture</entity><start>2025-01-01</start><end>2025-12-31 23:59:59</end></exception>
          <exception><call>PJ6Y/P</call><adif>520</adif><cqz>9</cqz><entity>Exact portable fixture</entity><start>2025-01-01</start><end>2025-12-31 23:59:59</end></exception>
        </cty>
        """
        let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".xml")
        defer { try? FileManager.default.removeItem(at: file) }
        try xml.write(to: file, atomically: true, encoding: .utf8)
        let resolver = try CTYResolver(xmlURL: file)
        func date(_ value: String) -> Date { ISO8601DateFormatter().date(from: value)! }
        let modern = date("2025-06-01T00:00:00Z")
        #expect(resolver.resolve("PJ2T", at: date("2010-10-09T23:59:59Z"))?.adif == 85)
        #expect(resolver.resolve("PJ2T", at: date("2010-10-10T00:00:00Z"))?.adif == 517)
        for (call, adif) in [("PJ2T", 517), ("PJ4A", 520), ("PJ5A", 519),
                            ("PJ6A", 519), ("PJ7A", 518), ("PJ6Y", 520)] {
            #expect(resolver.resolve(call, at: modern)?.adif == adif)
            #expect(resolver.resolve(call + "/P", at: modern)?.adif == adif)
        }
        #expect(resolver.resolve("PJ6Y", at: date("2024-12-31T23:59:59Z"))?.adif == 519)
        #expect(resolver.resolve("PJ6Y", at: date("2026-01-01T00:00:00Z"))?.adif == 519)
        #expect(resolver.resolve("PJ6YOTHER", at: modern)?.adif == 519)
        #expect(resolver.resolve("PJ9UNKNOWN", at: modern) == nil)
    }
}

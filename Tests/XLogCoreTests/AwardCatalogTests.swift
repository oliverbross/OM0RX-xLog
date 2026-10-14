import Foundation
import Testing
@testable import XLogCore

@Suite("International award catalogue")
struct AwardCatalogTests {
    @Test("All nine imported award programmes are present")
    func completeCatalog() throws {
        let snapshot = try AwardCatalogEngine.compute(qsos: [])
        #expect(snapshot.items.map(\.code) == ["AJD", "WAJA", "JCC", "JCG", "AJA", "WACA", "WAGA", "WAPC", "WCSA"])
        #expect(snapshot.referenceDate == "2024-01-01")
        #expect(snapshot.programmes.count == 192)
        #expect(snapshot.programmes.filter { $0.deliveryState == .implemented }.count == 9)
        #expect(snapshot.programmes.filter { $0.deliveryState == .trackingOnly }.count == 124)
        #expect(snapshot.programmes.filter { $0.deliveryState == .blocked }.count == 56)
        #expect(snapshot.programmes.filter { $0.deliveryState == .historical }.count == 3)
        #expect(snapshot.researchDate == "2026-10-11")
    }

    @Test("The research registry accounts for all 190 programmes and profile joins")
    func researchRegistryIntegrity() throws {
        let registry = try AwardRegistry.load()
        #expect(registry.format == "macos-ham-awards-research-registry")
        #expect(registry.schemaVersion == "1.0")
        #expect(registry.programmes.count == 190)
        #expect(registry.sharedProfiles.count == 22)
        #expect(Set(registry.programmes.map(\.id)).count == 190)
        #expect(registry.programmes.filter { $0.researchStatus == .verifiedCore }.count == 131)
        #expect(registry.programmes.filter { $0.researchStatus == .partial }.count == 56)
        #expect(registry.programmes.filter { $0.researchStatus == .legacy }.count == 3)
        #expect(registry.programmes.filter { $0.catalogueGroup == .global }.count == 21)
        #expect(registry.programmes.filter { $0.catalogueGroup == .europe }.count == 55)
        #expect(registry.programmes.filter { $0.catalogueGroup == .world }.count == 61)
        #expect(registry.programmes.filter { $0.catalogueGroup == .specialty }.count == 53)

        let profileIDs = Set(registry.sharedProfiles.keys)
        let referencedProfiles = Set(registry.programmes.flatMap(\.sharedProfileIDs))
        #expect(referencedProfiles.isSubset(of: profileIDs))
    }

    @Test("Official award source links are well formed")
    func officialSourceLinks() throws {
        let registry = try AwardRegistry.load()
        let sourceStrings = registry.programmes.flatMap(\.officialSources).compactMap(\.url)
        #expect(!sourceStrings.isEmpty)
        #expect(sourceStrings.allSatisfy { value in
            guard let url = URL(string: value), let scheme = url.scheme?.lowercased() else { return false }
            return (scheme == "https" || scheme == "http") && url.host != nil
        })
    }

    @Test("Every programme has an explicit delivery disposition")
    func deliveryLedger() throws {
        let snapshot = try AwardCatalogEngine.compute(qsos: [])
        #expect(Set(snapshot.programmes.map(\.id)).count == snapshot.programmes.count)
        #expect(snapshot.programmes.allSatisfy { !$0.deliveryDetail.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty })
        #expect(snapshot.programmes.filter { $0.deliveryState == .implemented }.allSatisfy { $0.progress != nil })
        #expect(snapshot.programmes.filter { $0.deliveryState != .implemented }.allSatisfy { $0.progress == nil })
    }

    @Test("JARL calculations normalize bands and enforce entity dates")
    func jarlAwards() throws {
        let qsos = [
            qso(call: "JA8AAA", band: "20M", mode: "SSB", dxcc: 339, state: "01", county: "0102"),
            qso(call: "JA8BBB", band: "40m", mode: "CW", dxcc: 339, state: "01", county: "01001"),
            qso(call: "JA8OLD", band: "15m", mode: "CW", dxcc: 339, state: "01", county: "0132", year: 2020),
            qso(call: "JD1OGS", band: "2m", mode: "CW", dxcc: 177, state: "", county: ""),
        ]
        let snapshot = try AwardCatalogEngine.compute(qsos: qsos)

        #expect(try item("AJD", in: snapshot).current == 2)
        #expect(try item("WAJA", in: snapshot).current == 2)
        #expect(try item("JCC", in: snapshot).current == 1)
        #expect(try item("JCG", in: snapshot).current == 2)
        #expect(try item("AJA", in: snapshot).current == 3)
        #expect(try item("WACA", in: snapshot).current == 1)
        #expect(try item("WAGA", in: snapshot).current == 2)
    }

    @Test("WAPC separates mixed, band and mode progress")
    func wapc() throws {
        let qsos = [
            qso(call: "BY1AAA", band: "20m", mode: "SSB", dxcc: 318, state: "bj"),
            qso(call: "BV1AAA", band: "40m", mode: "CW", dxcc: 386),
            qso(call: "VR2AAA", band: "6m", mode: "FT8", dxcc: 321),
        ]
        let award = try item("WAPC", in: AwardCatalogEngine.compute(qsos: qsos))
        #expect(award.current == 3)
        #expect(award.target == 34)
        #expect(award.breakdowns.first(where: { $0.label == "20m" })?.value == 1)
        #expect(award.breakdowns.first(where: { $0.label == "PHONE" })?.value == 1)
        #expect(award.breakdowns.first(where: { $0.label == "CW" })?.value == 1)
        #expect(award.breakdowns.first(where: { $0.label == "DATA" })?.value == 1)
    }

    @Test("WCSA counts distinct confirmed school operating slots")
    func wcsa() throws {
        let qsos = [
            qso(call: "BY1QH", band: "20m", mode: "CW", dxcc: 318),
            qso(call: "BY1QH/P", band: "40m", mode: "CW", dxcc: 318),
            qso(call: "BY1QH", band: "20m", mode: "SSB", dxcc: 318),
            qso(call: "BY1QH", band: "20m", mode: "SSB", dxcc: 318),
        ]
        let award = try item("WCSA", in: AwardCatalogEngine.compute(qsos: qsos))
        #expect(award.current == 3)
        #expect(award.target == 6)
        #expect(award.detail.contains("Bronze achieved"))
        #expect(award.breakdowns.first(where: { $0.label == "Schools" })?.value == 1)
    }

    @Test("JARL accepts a case-insensitive eQSL confirmation while WAPC does not")
    func confirmationRules() throws {
        let qso = QSO(
            call: "JA8EQL", start: date(2024), band: "20m", mode: "CW", dxcc: 339,
            state: "01", county: "0102", extraFields: ["eqsl_qsl_rcvd": "y"]
        )
        let snapshot = try AwardCatalogEngine.compute(qsos: [qso])
        #expect(try item("JCC", in: snapshot).current == 1)
        #expect(try item("WAPC", in: snapshot).current == 0)
    }

    @Test("Worked and evidence-eligible totals remain distinct")
    func evidenceLayers() throws {
        let workedOnly = QSO(
            call: "JA8RAW", start: date(2024), band: "20m", mode: "CW", dxcc: 339,
            state: "01", county: "0102"
        )
        let snapshot = try AwardCatalogEngine.compute(qsos: [workedOnly])
        let jcc = try item("JCC", in: snapshot)
        #expect(jcc.worked == 1)
        #expect(jcc.current == 0)
        #expect(jcc.sponsorCredited == nil)
    }

    @Test("JARL date cutoffs use the UTC contact day, including exact boundaries")
    func entityDateBoundaries() throws {
        let formatter = ISO8601DateFormatter()
        func progress(county: String, instant: String) throws -> AwardCatalogSnapshot {
            let value = QSO(call: "JA8DATE", start: try #require(formatter.date(from: instant)),
                            band: "20m", mode: "CW", dxcc: 339, state: "01", county: county,
                            qslReceived: "Y")
            return try AwardCatalogEngine.compute(qsos: [value])
        }
        for (instant, expected) in [("1973-11-30T23:59:59Z", 1), ("1973-12-01T00:00:00Z", 0)] {
            let snapshot = try progress(county: "0132", instant: instant)
            for code in ["JCC", "AJA"] {
                let award = try item(code, in: snapshot)
                #expect(award.worked == expected)
                #expect(award.current == expected)
            }
        }
        for (instant, expected) in [("1972-03-31T23:59:59Z", 1), ("1972-04-01T00:00:00Z", 0)] {
            let snapshot = try progress(county: "0101", instant: instant)
            let aja = try item("AJA", in: snapshot)
            #expect(aja.worked == expected)
            #expect(aja.current == expected)
            #expect(try item("JCC", in: snapshot).current == 1)
        }
    }

    @Test("Generated catalogue calculation preserves every programme at scale",
          .enabled(if: ProcessInfo.processInfo.environment["XLOG_GENERATED_PERF"] == "1"))
    func generatedCatalogPerformance() throws {
        // Disposable in-memory contacts only; no operator database or services.
        let fixture = [
            qso(call: "JA8CITY", band: "20m", mode: "CW", dxcc: 339, state: "01", county: "0102"),
            qso(call: "JA8GUN", band: "40m", mode: "SSB", dxcc: 339, state: "01", county: "01001"),
            qso(call: "JA8OLD", band: "15m", mode: "CW", dxcc: 339, state: "01", county: "0132", year: 1973),
            qso(call: "JA8DES", band: "20m", mode: "CW", dxcc: 339, state: "01", county: "0101"),
            qso(call: "BY1QH/P", band: "20m", mode: "FT8", dxcc: 318, state: "BJ"),
            qso(call: "BV1SYN", band: "40m", mode: "SSB", dxcc: 386),
            QSO(call: "JA8RAW", start: date(2024), band: "2m", mode: "CW", dxcc: 339,
                state: "01", county: "0102", extraFields: ["eqsl_qsl_rcvd": "y"]),
            QSO(call: "JA8NONE", start: date(2024), band: "6m", mode: "CW", dxcc: 339,
                state: "01", county: "01001"),
        ]
        let expected = try AwardCatalogEngine.compute(qsos: fixture)
        #expect(expected.items.map(\.worked) == [1, 1, 3, 1, 5, 2, 1, 2, 1])
        #expect(expected.items.map(\.current) == [1, 1, 3, 1, 4, 2, 1, 2, 1])
        let contacts = (0..<100_000).map { AwardCatalogContact(fixture[$0 % fixture.count]) }
        var times: [Double] = []
        for _ in 0..<5 {
            let started = ProcessInfo.processInfo.systemUptime
            let actual = try AwardCatalogEngine.compute(contacts: contacts)
            times.append((ProcessInfo.processInfo.systemUptime - started) * 1_000)
            #expect(actual == expected)
        }
        print("GENERATED_AWARD_CATALOG contacts=100000 samples=5 median_ms=\(times.sorted()[2]) max_ms=\(times.max() ?? 0) samples_ms=\(times)")
    }

    private func item(_ code: String, in snapshot: AwardCatalogSnapshot) throws -> AwardCatalogItem {
        try #require(snapshot.items.first(where: { $0.code == code }))
    }

    private func qso(
        call: String,
        band: String,
        mode: String,
        dxcc: Int,
        state: String = "",
        county: String = "",
        year: Int = 2024
    ) -> QSO {
        QSO(
            call: call, start: date(year), band: band, mode: mode, dxcc: dxcc,
            state: state, county: county, qslReceived: "Y"
        )
    }

    private func date(_ year: Int) -> Date {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        return calendar.date(from: DateComponents(year: year, month: 6, day: 1))!
    }
}

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

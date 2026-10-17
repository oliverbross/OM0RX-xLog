import XCTest
@testable import XClusterIntegrationCore

final class ClusterParserBoundaryTests: XCTestCase {
    private let clusterID = UUID(uuidString: "00000000-0000-0000-0000-000000000001")!

    private func parse(_ line: String) -> RawSpot? {
        ClusterLineParser.parse(line, clusterID: clusterID, clusterName: "fixture", at: Date(timeIntervalSince1970: 123))
    }

    func testUnicodeCommentControlsAndMetadataPreserved() throws {
        let raw = try XCTUnwrap(parse("DX de dl1abc-#: 14027.00 k1abc Café 日本語 🛰️ CQ\u{0007} 1234Z\r\n"))
        XCTAssertEqual(raw.callsign, "K1ABC")
        XCTAssertEqual(raw.spotter, "dl1abc-#")
        XCTAssertEqual(raw.comment, "Café 日本語 🛰️ CQ")
        XCTAssertEqual(raw.frequencyText, "14027.00")
        XCTAssertEqual(raw.clusterID, clusterID)
        XCTAssertEqual(raw.clusterName, "fixture")
        XCTAssertEqual(raw.receivedAt, Date(timeIntervalSince1970: 123))
        XCTAssertEqual(try JSONDecoder().decode(RawSpot.self, from: JSONEncoder().encode(raw)), raw)
    }

    func testMalformedLinesAndHistoryDatesAreRejected() {
        for line in ["", "Welcome to DXSpider", "DX de: 14074 K1ABC", "DX de K1ABC: bananas K2ABC",
                     "DX de K1ABC: -1 K2ABC", "DX de K1ABC: 14074 🛰️", "DX de K1ABC: 14074 É1ABC",
                     "14074 K1ABC 32-Oct-2026 0018Z CQ <K2ABC>",
                     "14074 K1ABC 11-Oct-2026 2460Z CQ <K2ABC>",
                     "14074 K1ABC 11-Oct-2026 0018Z CQ <>"] {
            XCTAssertNil(parse(line), line)
        }
    }

    func testInvalidFrequenciesRejectedInLiveAndHistoryFormats() {
        for value in ["0", "0.0", "NaN", "inf", "1e5", "300000001", String(repeating: "9", count: 400)] {
            XCTAssertNil(parse("DX de K1ABC: \(value) K2ABC CW"), value)
            XCTAssertNil(parse("\(value) K2ABC 11-Oct-2026 0018Z CW <K1ABC>"), value)
        }
        XCTAssertEqual(parse("DX de K1ABC: 300000000 K2ABC CW")?.frequencyKHz, ClusterLineParser.maximumFrequencyKHz)
        XCTAssertEqual(parse("DX de K1ABC: 0.001 K2ABC CW")?.frequencyKHz, 0.001)
        XCTAssertEqual(SpotLogic.band(for: .nan), "OTHER")
        XCTAssertEqual(SpotLogic.band(for: .infinity), "OTHER")
    }

    func testByteLimitAppliedBeforeControlFiltering() throws {
        let prefix = "DX de K1ABC: 14074 K2ABC "
        let valid = prefix + String(repeating: "x", count: ClusterLineParser.maximumLineBytes - prefix.utf8.count)
        XCTAssertNotNil(parse(valid))
        XCTAssertNil(parse(valid + "x"))
        XCTAssertNil(parse(prefix + String(repeating: "🛰️", count: 1_024)))
        XCTAssertNil(parse(prefix + String(repeating: "\u{0000}", count: 4_096)))
    }

    func testHistoryUnicodeAndLowercaseInputPreserveUtcTime() throws {
        let raw = try XCTUnwrap(parse(" 14074.0 k1abc/p 11-oct-2026 2359z Café 日本語<k2abc>"))
        XCTAssertEqual(raw.callsign, "K1ABC/P")
        XCTAssertEqual(raw.spotter, "k2abc")
        XCTAssertEqual(raw.comment, "Café 日本語")
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        XCTAssertEqual(calendar.dateComponents([.year, .month, .day, .hour, .minute], from: raw.receivedAt),
                       DateComponents(year: 2026, month: 10, day: 11, hour: 23, minute: 59))
    }

    func testModePriorityAndOriginalFrequencyHeuristics() {
        XCTAssertTrue(SpotLogic.modes.contains("JTTY"))
        XCTAssertEqual(SpotLogic.mode(comment: "SSB FT4", band: "20m", khz: 14074), "FT4")
        XCTAssertEqual(SpotLogic.mode(comment: "", band: "20m", khz: 14074), "FT8")
        XCTAssertEqual(SpotLogic.mode(comment: "", band: "20m", khz: 14080), "FT4")
        XCTAssertEqual(SpotLogic.mode(comment: "", band: "20m", khz: 14084), "FT2")
        for khz in [21091.5, 21092.1, 21089.2] {
            XCTAssertEqual(SpotLogic.mode(comment: "JTTY", band: "15m", khz: khz), "JTTY")
        }
        XCTAssertEqual(SpotLogic.mode(comment: "jtty cq", band: "15m", khz: 21091.5), "JTTY")
        XCTAssertEqual(SpotLogic.mode(comment: "CQ AM", band: "20m", khz: 14200), "AM")
        XCTAssertEqual(SpotLogic.mode(comment: "FM", band: "2m", khz: 145500), "FM")
        XCTAssertEqual(SpotLogic.band(for: 1_240_000), "23cm")
        XCTAssertEqual(SpotLogic.band(for: 24_000_000), "1.25cm")
        XCTAssertEqual(SpotLogic.band(for: 100), "OTHER")
    }

    func testTwentyMeterSegmentInferenceKeepsExplicitModes() throws {
        let raw = try XCTUnwrap(parse("DX de OM0RX: 14023.700 OK2BUH PHASE 2"))
        let band = SpotLogic.band(for: raw.frequencyKHz)
        XCTAssertEqual(band, "20m")
        XCTAssertEqual(SpotLogic.mode(comment: raw.comment, band: band, khz: raw.frequencyKHz), "CW")
        for khz in [14000.0, 14060.0, 14069.999] {
            XCTAssertEqual(SpotLogic.mode(comment: "CQ", band: "20m", khz: khz), "CW")
        }
        XCTAssertEqual(SpotLogic.mode(comment: "CQ", band: "20m", khz: 14070), "DIGI")
        XCTAssertEqual(SpotLogic.mode(comment: "FT8", band: "20m", khz: 14023.7), "FT8")
        XCTAssertEqual(SpotLogic.mode(comment: "USB", band: "20m", khz: 14023.7), "SSB")
        XCTAssertEqual(SpotLogic.mode(comment: "PH", band: "20m", khz: 14023.7), "SSB")
    }

    func testScorePriorityAndCapRemainOriginal() {
        let scored = SpotLogic.score(callStatus: "New Call", dxccStatus: "ATNO", specials: ["POTA"], source: "rbl")
        XCTAssertEqual(scored.0, 100)
        XCTAssertEqual(scored.1, ["ATNO", "POTA", "RBN source"])
        let unknown = SpotLogic.score(callStatus: "New Call", dxccStatus: "Unknown", specials: [], source: "cluster")
        XCTAssertEqual(unknown.0, 42)
        XCTAssertEqual(unknown.1, ["New Call"])
    }
}

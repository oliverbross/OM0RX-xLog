// Compatible pure-domain cases imported from xCluster's SpotLogicTests.swift.
import XCTest
@testable import XClusterIntegrationCore

final class ImportedSpotLogicTests: XCTestCase {
    func testClusterLineParsingPreservesFrequencyAndComment() throws {
        let raw = try XCTUnwrap(ClusterLineParser.parse("DX de K3KS: 28460.0 KC3JAS PA QSO PARTY-CLE", clusterID: UUID(), clusterName: "test"))
        XCTAssertEqual(raw.callsign, "KC3JAS")
        XCTAssertEqual(raw.frequencyKHz, 28460.0)
        XCTAssertEqual(raw.comment, "PA QSO PARTY-CLE")
    }

    func testClusterLineParsingRemovesOnlyTrailingUTCTime() throws {
        let timestamped = try XCTUnwrap(ClusterLineParser.parse("DX de W2LCQ: 3869.0 N3NTJ PA QSO Party: Mercer 0003Z", clusterID: UUID(), clusterName: "test"))
        XCTAssertEqual(timestamped.comment, "PA QSO Party: Mercer")

        let timestampOnly = try XCTUnwrap(ClusterLineParser.parse("DX de K3KS: 28460.0 KC3JAS 2359Z", clusterID: UUID(), clusterName: "test"))
        XCTAssertEqual(timestampOnly.comment, "")

        let meaningfulNumber = try XCTUnwrap(ClusterLineParser.parse("DX de K3KS: 28460.0 KC3JAS POTA K-0003Z", clusterID: UUID(), clusterName: "test"))
        XCTAssertEqual(meaningfulNumber.comment, "POTA K-0003Z")
    }

    func testDXSpiderHistoryLineLoadsAsSpotWithOriginalTime() throws {
        let clusterID = UUID()
        let raw = try XCTUnwrap(ClusterLineParser.parse(
            "7150.0 AD4PF       11-Oct-2026 0018Z CQ Dx 59 in FJ24en           <HJ6AZV>",
            clusterID: clusterID,
            clusterName: "ShackCQ"
        ))
        XCTAssertEqual(raw.clusterID, clusterID)
        XCTAssertEqual(raw.frequencyKHz, 7150.0)
        XCTAssertEqual(raw.callsign, "AD4PF")
        XCTAssertEqual(raw.spotter, "HJ6AZV")
        XCTAssertEqual(raw.comment, "CQ Dx 59 in FJ24en")

        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        XCTAssertEqual(calendar.dateComponents([.year, .month, .day, .hour, .minute], from: raw.receivedAt),
                       DateComponents(year: 2026, month: 10, day: 11, hour: 0, minute: 18))
    }

    func testDXSpiderHistoryLineAllowsBlankComment() throws {
        let raw = try XCTUnwrap(ClusterLineParser.parse(
            "3830.0 N3ZK        11-Oct-2026 0017Z                                <NF3R>",
            clusterID: UUID(),
            clusterName: "ShackCQ"
        ))
        XCTAssertEqual(raw.callsign, "N3ZK")
        XCTAssertEqual(raw.spotter, "NF3R")
        XCTAssertEqual(raw.comment, "")
    }

    func testDXSpiderHistoryLineAllowsAdjacentSpotterMarker() throws {
        let raw = try XCTUnwrap(ClusterLineParser.parse(
            "14247.5 K3RWN/ALL   11-Oct-2026 0013Z Heard in EL87 73s W4MBM via PO<W4MBM>",
            clusterID: UUID(),
            clusterName: "ShackCQ"
        ))
        XCTAssertEqual(raw.callsign, "K3RWN/ALL")
        XCTAssertEqual(raw.spotter, "W4MBM")
        XCTAssertEqual(raw.comment, "Heard in EL87 73s W4MBM via PO")
    }

    func testBandModeAndSourceInferenceMatchOM0RXRules() {
        XCTAssertEqual(SpotLogic.band(for: 14074), "20m")
        XCTAssertEqual(SpotLogic.mode(comment: "TNX FT8", band: "20m", khz: 14074), "FT8")
        XCTAssertEqual(SpotLogic.mode(comment: "", band: "40m", khz: 7025), "CW")
        XCTAssertEqual(SpotLogic.source(spotter: "DL1ABC-#", comment: "CW 18 dB"), "rbl")
        XCTAssertEqual(SpotLogic.source(spotter: "DL1ABC/#", comment: "FT8 -12 dB"), "rbl")
        let rbn = ClusterLineParser.parse("DX de DL1ABC-#: 14027.0 OM0RX 23 dB 28 WPM CQ 1234Z", clusterID: UUID(), clusterName: "test")
        XCTAssertEqual(rbn.map { SpotLogic.source(spotter: $0.spotter, comment: $0.comment) }, "rbl")
        XCTAssertEqual(rbn?.comment, "23 dB 28 WPM CQ")
        XCTAssertEqual(SpotLogic.normalizedMode(" usb "), "SSB")
    }

    func testClassificationPriority() {
        XCTAssertEqual(SpotLogic.callStatus(worked: false, newBand: true, newMode: true, confirmedBandMode: false), "New Call")
        XCTAssertEqual(SpotLogic.callStatus(worked: true, newBand: true, newMode: true, confirmedBandMode: false), "New Band+Mode")
        XCTAssertEqual(SpotLogic.dxccStatus(worked: true, confirmed: true, newBand: true, newMode: false, confirmedBandMode: false), "C/New Band")
    }

    func testCallStatusUsesTheBandModeCombination() {
        XCTAssertEqual(SpotLogic.callStatus(worked: true, bandWorked: true, modeWorked: true, bandModeWorked: false, confirmedBandMode: false), "New Mode")
        XCTAssertEqual(SpotLogic.callStatus(worked: true, bandWorked: false, modeWorked: true, bandModeWorked: false, confirmedBandMode: false), "New Band")
        XCTAssertEqual(SpotLogic.callStatus(worked: true, bandWorked: false, modeWorked: false, bandModeWorked: false, confirmedBandMode: false), "New Band+Mode")
        XCTAssertEqual(SpotLogic.callStatus(worked: true, bandWorked: true, modeWorked: true, bandModeWorked: true, confirmedBandMode: false), "Worked")
        XCTAssertEqual(SpotLogic.callStatus(worked: true, bandWorked: true, modeWorked: true, bandModeWorked: true, confirmedBandMode: true), "Confirmed")
    }

    func testWorkedBandModeVisibilityDefaultsToHidden() {
        XCTAssertFalse(SpotLogic.shouldShow(callStatus: "Worked", showWorkedBandModeSpots: false))
        XCTAssertFalse(SpotLogic.shouldShow(callStatus: "Confirmed", showWorkedBandModeSpots: false))
        XCTAssertTrue(SpotLogic.shouldShow(callStatus: "New Mode", showWorkedBandModeSpots: false))
        XCTAssertTrue(SpotLogic.shouldShow(callStatus: "New Band", showWorkedBandModeSpots: false))
        XCTAssertTrue(SpotLogic.shouldShow(callStatus: "Worked", showWorkedBandModeSpots: true))
    }

    func testSpecialsCanMultiMatch() {
        let rules = [SpecialRule(name: "POTA", pattern: #"\bPOTA\b"#), SpecialRule(name: "WWFF", pattern: #"\bWWFF\b"#)]
        XCTAssertEqual(SpotLogic.specials(in: "POTA and WWFF", rules: rules), ["POTA", "WWFF"])
    }

    func testFriendlySpecialRulesMatchWordsAndReferenceFormats() {
        let rules = [
            SpecialRule(name: "POTA", keywords: ["Parks on the Air"], referenceFormat: .pota),
            SpecialRule(name: "IOTA", keywords: ["IOTA"], referenceFormat: .iota),
        ]
        XCTAssertEqual(SpotLogic.specials(in: "CQ K-1234 from OC-001", rules: rules), ["POTA", "IOTA"])
        XCTAssertEqual(SpotLogic.specials(in: "Parks on the Air", rules: rules), ["POTA"])
    }

    func testLegacySpecialRuleMigratesToFriendlyDefaults() throws {
        let data = #"{"id":"00000000-0000-0000-0000-000000000001","name":"POTA","pattern":"\\bPOTA\\b","enabled":true}"#.data(using: .utf8)!
        let rule = try JSONDecoder().decode(SpecialRule.self, from: data)
        XCTAssertEqual(rule.keywords, ["POTA"])
        XCTAssertEqual(rule.referenceFormat, .pota)
        XCTAssertEqual(rule.advancedPattern, "")
    }
}

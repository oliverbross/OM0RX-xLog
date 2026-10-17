import XCTest
@testable import XClusterIntegrationCore

final class ClusterClassificationTests: XCTestCase {
    // In-memory adaptation of the original NF3R SQLite fixture.
    func testNF3RPatternPreservesBandModeAndConfirmationRules() throws {
        let ft8Date = Date(timeIntervalSince1970: 1_727_284_385)
        let ssbDate = Date(timeIntervalSince1970: 1_729_958_836)
        let index = ClusterClassificationIndex(records: [
            ClusterContact(callsign: "NF3R", band: "20m", mode: "FT8", adif: 291, date: ft8Date, paperQSL: "W", lotwQSL: "X"),
            ClusterContact(callsign: "NF3R", band: "10m", mode: "SSB", adif: 291, date: ssbDate, paperQSL: "W", lotwQSL: "X"),
            ClusterContact(callsign: "VK1AAA", band: "20m", mode: "FT8", adif: 150, lotwQSL: "X"),
            ClusterContact(callsign: "VK2BBB", band: "40m", mode: "SSB", adif: 150, lotwQSL: "W"),
        ])
        let differentMode = index.classify(call: "NF3R", band: "20m", mode: "SSB", adif: 291)
        XCTAssertEqual(differentMode.callStatus, "New Callsign")
        XCTAssertEqual(differentMode.dxccStatus, "New DXCC")
        XCTAssertEqual(differentMode.workedBefore, ft8Date)
        XCTAssertEqual(index.classify(call: "NF3R", band: "40m", mode: "SSB", adif: 291).callStatus, "New Callsign")
        XCTAssertEqual(index.classify(call: "NF3R", band: "40m", mode: "CW", adif: 291).callStatus, "New Callsign")
        XCTAssertNil(index.classify(call: "NF3R", band: "40m", mode: "CW", adif: 291).workedBefore)
        let confirmed = index.classify(call: "NF3R", band: "10m", mode: "SSB", adif: 291)
        XCTAssertEqual(confirmed.callStatus, "Confirmed")
        XCTAssertEqual(confirmed.dxccStatus, "Confirmed")
        XCTAssertEqual(confirmed.workedBefore, ssbDate)
        XCTAssertEqual(index.classify(call: "VK4JAZ", band: "40m", mode: "SSB", adif: 150).callStatus, "New Callsign")
        XCTAssertEqual(index.classify(call: "VK4JAZ", band: "40m", mode: "SSB", adif: 150).dxccStatus, "Worked")
        XCTAssertEqual(index.classify(call: "VK4JAZ", band: "20m", mode: "FT8", adif: 150).dxccStatus, "Confirmed")
        XCTAssertEqual(index.recordCount, 4)
    }

    func testNormalizationOnBothRecordsAndLookup() {
        let index = ClusterClassificationIndex(records: [
            ClusterContact(callsign: " nf3r\n", band: " 20M ", mode: " usb ", adif: 291, paperQSL: " confirmed ")
        ])
        let result = index.classify(call: "NF3R ", band: "20m", mode: " PHONE ", adif: 291)
        XCTAssertEqual(result.callStatus, "Confirmed")
        XCTAssertEqual(result.dxccStatus, "Confirmed")
        for alias in ["USB", "LSB", "PH", "PHONE", "SSB"] {
            XCTAssertEqual(SpotLogic.normalizedMode(alias), "SSB")
            XCTAssertEqual(SpotLogic.classificationMode(alias), "PHONE")
        }
    }

    func testWavelogQRGModeParityForClusterStatus() {
        let index = ClusterClassificationIndex(records: [
            ClusterContact(callsign: "K1DIGI", band: "20m", mode: "FT8", adif: 291, lotwQSL: "Y"),
            ClusterContact(callsign: "K1PHONE", band: "40m", mode: "LSB", adif: 291),
        ])

        for digitalMode in ["FT4", "FT2", "RTTY", "PSK", "DIGI", "MFSK"] {
            let status = index.classify(call: "K1DIGI", band: "20m", mode: digitalMode, adif: 291)
            XCTAssertEqual(status.callStatus, "Confirmed", digitalMode)
            XCTAssertEqual(status.dxccStatus, "Confirmed", digitalMode)
            XCTAssertEqual(SpotLogic.classificationMode(digitalMode), "DIGI")
        }
        for phoneMode in ["SSB", "USB", "PHONE", "AM", "FM"] {
            let status = index.classify(call: "K1PHONE", band: "40m", mode: phoneMode, adif: 291)
            XCTAssertEqual(status.callStatus, "Worked", phoneMode)
            XCTAssertEqual(status.dxccStatus, "Worked", phoneMode)
            XCTAssertEqual(SpotLogic.classificationMode(phoneMode), "PHONE")
        }
        XCTAssertEqual(index.classify(call: "K1DIGI", band: "20m", mode: "CW", adif: 291).callStatus, "New Callsign")
        XCTAssertEqual(index.classify(call: "K1PHONE", band: "40m", mode: "CW", adif: 291).callStatus, "New Callsign")
    }

    func testNewCallAtnoAndUnknownEntityAreIndependent() {
        for entity in [nil, 0, -1] as [Int?] {
            let result = ClusterClassificationIndex.empty.classify(call: "K1NEW", band: "20m", mode: "CW", adif: entity)
            XCTAssertEqual(result.callStatus, "New Callsign")
            XCTAssertEqual(result.dxccStatus, "Unknown")
            XCTAssertNil(result.workedBefore)
        }
        XCTAssertEqual(ClusterClassificationIndex.empty.classify(call: "K1NEW", band: "20m", mode: "CW", adif: 291).dxccStatus, "New DXCC")
        let index = ClusterClassificationIndex(records: [ClusterContact(callsign: "K1OLD", band: "20m", mode: "CW")])
        XCTAssertEqual(index.classify(call: "K1OLD", band: "20m", mode: "CW", adif: nil).callStatus, "Worked")
        XCTAssertEqual(index.classify(call: "K1OLD", band: "20m", mode: "CW", adif: 291).dxccStatus, "New DXCC")
    }

    func testConfirmationFlagsAndEqslOnlyExclusion() {
        for flag in ["X", "Y", "YES", "TRUE", "1", "C", "CONFIRMED", " yes "] {
            for isPaper in [false, true] {
                let record = ClusterContact(callsign: "K1OLD", band: "20m", mode: "CW", adif: 291,
                                            paperQSL: isPaper ? flag : "", lotwQSL: isPaper ? "" : flag)
                XCTAssertTrue(record.isConfirmed)
                XCTAssertEqual(ClusterClassificationIndex(records: [record]).classify(call: "K1OLD", band: "20m", mode: "CW", adif: 291).dxccStatus, "Confirmed")
            }
        }
        let eqslOnly = ClusterContact(callsign: "K1OLD", band: "20m", mode: "CW", adif: 291, paperQSL: "W", lotwQSL: "S", eqsl: "Y")
        XCTAssertFalse(eqslOnly.isConfirmed)
        let index = ClusterClassificationIndex(records: [eqslOnly])
        XCTAssertEqual(index.classify(call: "K1OLD", band: "20m", mode: "CW", adif: 291).callStatus, "Worked")
        XCTAssertEqual(index.classify(call: "K1OLD", band: "40m", mode: "CW", adif: 291).dxccStatus, "New DXCC")
        XCTAssertEqual(index.classify(call: "K1OLD", band: "40m", mode: "SSB", adif: 291).dxccStatus, "New DXCC")
        XCTAssertEqual(index.classify(call: "K1OLD", band: "20m", mode: "SSB", adif: 291).dxccStatus, "New DXCC")
    }

    func testEntityConfirmationPrefixAndExactCombinationPriority() {
        let index = ClusterClassificationIndex(records: [
            ClusterContact(callsign: "K1OLD", band: "20m", mode: "CW", adif: 291, lotwQSL: "X"),
            ClusterContact(callsign: "K2OLD", band: "40m", mode: "SSB", adif: 291),
        ])
        XCTAssertEqual(index.classify(call: "K2OLD", band: "10m", mode: "FT8", adif: 291).dxccStatus, "New DXCC")
        XCTAssertEqual(index.classify(call: "K2OLD", band: "10m", mode: "CW", adif: 291).dxccStatus, "New DXCC")
        XCTAssertEqual(index.classify(call: "K2OLD", band: "40m", mode: "FT8", adif: 291).dxccStatus, "New DXCC")
        let differentCall = index.classify(call: "K2OLD", band: "20m", mode: "CW", adif: 291)
        XCTAssertEqual(differentCall.callStatus, "New Callsign")
        XCTAssertEqual(differentCall.dxccStatus, "Confirmed")
    }

    func testWorkedBeforePrefersExactModeThenNewestSameBand() {
        let exactDate = Date(timeIntervalSince1970: 1_700_000_000)
        let newestDate = Date(timeIntervalSince1970: 1_710_000_000)
        let olderDate = Date(timeIntervalSince1970: 1_690_000_000)
        let index = ClusterClassificationIndex(records: [
            ClusterContact(callsign: "NF3R", band: "20m", mode: "SSB", date: olderDate),
            ClusterContact(callsign: "NF3R", band: "20m", mode: "SSB", date: exactDate),
            ClusterContact(callsign: "NF3R", band: "20m", mode: "FT8", date: newestDate),
        ])
        XCTAssertEqual(index.classify(call: "NF3R", band: "20m", mode: "SSB", adif: nil).workedBefore, exactDate)
        XCTAssertEqual(index.classify(call: "NF3R", band: "20m", mode: "CW", adif: nil).workedBefore, newestDate)
        XCTAssertNil(index.classify(call: "NF3R", band: "40m", mode: "SSB", adif: nil).workedBefore)
    }

    func testStructuredKeysAvoidDelimiterCollisionAndCodableRoundTrip() throws {
        let record = ClusterContact(callsign: "A|B", band: "C", mode: "D", adif: 291, lotwQSL: "X")
        let decoded = try JSONDecoder().decode(ClusterContact.self, from: JSONEncoder().encode(record))
        XCTAssertEqual(decoded, record)
        let index = ClusterClassificationIndex(records: [decoded])
        let result = index.classify(call: "A", band: "B|C", mode: "D", adif: nil)
        XCTAssertEqual(result.callStatus, "New Callsign")
        let encoded = try JSONEncoder().encode(result)
        XCTAssertEqual(try JSONDecoder().decode(ClusterClassification.self, from: encoded), result)
    }
}

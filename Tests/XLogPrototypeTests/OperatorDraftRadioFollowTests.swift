import Foundation
import Testing
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif

@Suite("Pure operator draft Follow Radio projection")
struct OperatorDraftRadioFollowTests {
    private func fixture() -> QSO {
        QSO(id: UUID(), wavelogID: 91, call: "K1ABC/P",
            start: Date(timeIntervalSince1970: 1_800_000_000), end: Date(timeIntervalSince1970: 1_800_000_120),
            band: "20m", mode: "FT4", submode: "MANUAL", frequencyHz: 14_080_000,
            receiveFrequencyHz: 14_079_000, receiveBand: "20m", rstSent: "579", rstReceived: "559",
            name: "Operator", gridSquare: "FN31", country: "United States", dxcc: 291,
            continent: "NA", cqZone: "5", ituZone: "8", state: "CT", county: "Fairfield", qth: "Home",
            iota: "NA-001", sotaReference: "W1/AA-001", potaReference: "US-0001", wwffReference: "KFF-0001",
            sig: "WCA", sigInfo: "K-0001", dok: "A01", comment: "unfinished operator comment", notes: "keep notes",
            stationProfileID: 7, stationLocation: "Home station", radio: "operator selected radio", txPower: "37.125",
            operatorCall: "K1ABC", myCall: "K1ABC/P", myGrid: "FN32", propagationMode: "SAT", antennaPath: "LP",
            email: "operator@example.invalid", qslSent: "Y", qslReceived: "N", qslMethod: "B", qslVia: "Manager",
            qslMessage: "Thanks", lotwSent: "N", lotwReceived: "Y",
            extraFields: ["APP_OM0RXXLOG_POWER_SOURCE": "manual", "UNRECOGNIZED": "preserve"],
            isDirty: false, deletedAt: Date(timeIntervalSince1970: 1_800_000_200),
            updatedAt: Date(timeIntervalSince1970: 1_800_000_100))
    }

    @Test("Only frequency, band and mode change, including for an enriched or historical-shaped value")
    func preservesAllOtherFields() throws {
        let before = fixture()
        let result = try OperatorDraftRadioFollow.applying(to: before, frequencyHz: 7_150_000, observedMode: "lsb", enabled: true)
        var expected = before
        expected.frequencyHz = 7_150_000; expected.band = "40m"; expected.mode = "SSB"
        #expect(result == expected)
    }

    @Test("Follow OFF retains manual frequency, mode and power even with unusable telemetry")
    func disabled() throws {
        let before = fixture()
        #expect(try OperatorDraftRadioFollow.applying(to: before, frequencyHz: -1, observedMode: "", enabled: false) == before)
        #expect(try OperatorDraftRadioFollow.applying(to: before, frequencyHz: 7_150_000, observedMode: "CW", enabled: false) == before)
    }

    @Test("Voice and CW observations apply their conventional reports without replacing operator edits")
    func signalReports() throws {
        var voice = fixture(); voice.mode = "SSB"; voice.rstSent = "59"; voice.rstReceived = "59"
        let cw = try OperatorDraftRadioFollow.applying(to: voice, frequencyHz: 14_025_000, observedMode: "CW", enabled: true)
        #expect(cw.rstSent == "599"); #expect(cw.rstReceived == "599")

        var edited = cw; edited.rstSent = "579"; edited.rstReceived = "559"
        let ssb = try OperatorDraftRadioFollow.applying(to: edited, frequencyHz: 14_250_000, observedMode: "USB", enabled: true)
        #expect(ssb.rstSent == "579"); #expect(ssb.rstReceived == "559")
    }

    @Test("CAT aliases match existing logging labels", arguments: [
        ("usb", "SSB"), ("LSB", "SSB"), ("CWR", "CW"), ("rttyr", "RTTY"),
        ("cw", "CW"), ("am", "AM"), ("FM", "FM"), ("ft8", "FT8"), ("CUSTOM_1", "CUSTOM_1"),
    ])
    func aliases(_ pair: (String, String)) throws {
        let result = try OperatorDraftRadioFollow.applying(to: fixture(), frequencyHz: 14_025_000, observedMode: pair.0, enabled: true)
        #expect(result.mode == pair.1)
    }

    @Test("Every data carrier preserves every chosen digital logging mode")
    func digitalModes() throws {
        let carriers = ["PKTUSB", "PKTLSB", "DIGU", "DIGL", "DATA", "DIGI"]
        let digital = ["FT8", "FT4", "FT2", "JTTY", "PSK", "PSK31", "PSK63", "JT65", "JT9", "MFSK", "OLIVIA", "DATA", "DIGI"]
        for carrier in carriers {
            for mode in digital {
                var before = fixture(); before.mode = mode.lowercased()
                let result = try OperatorDraftRadioFollow.applying(to: before, frequencyHz: 14_074_000,
                                                                   observedMode: carrier.lowercased(), enabled: true)
                #expect(result.mode == mode)
                #expect(result.submode == before.submode)
            }
            for mode in ["SSB", "CW", "RTTY", "", "FT8 "] {
                var before = fixture(); before.mode = mode
                #expect(try OperatorDraftRadioFollow.applying(to: before, frequencyHz: 14_074_000,
                                                              observedMode: carrier, enabled: true).mode == "DIGI")
            }
        }
    }

    @Test("Existing BandPlan boundaries are reused; unsupported frequencies retain the prior band")
    func bands() throws {
        for frequency: Int64 in [1, 1_800_000, 7_000_000, 7_299_999, 7_300_000, 14_000_000, 14_349_999, 14_350_000, 450_000_000, 1_000_000_000_000] {
            let before = fixture(), band = BandPlan.band(for: frequency)
            let result = try OperatorDraftRadioFollow.applying(to: before, frequencyHz: frequency, observedMode: "CW", enabled: true)
            #expect(result.frequencyHz == frequency)
            #expect(result.band == (band.isEmpty ? before.band : band))
        }
    }

    @Test("Invalid frequency or mode is rejected without changing the input")
    func invalidObservation() throws {
        let before = fixture()
        for frequency: Int64 in [Int64.min, -1, 0, 1_000_000_000_001, Int64.max] {
            #expect(throws: OperatorDraftError.self) {
                try OperatorDraftRadioFollow.applying(to: before, frequencyHz: frequency, observedMode: "CW", enabled: true)
            }
        }
        for mode in ["", " USB ", "CW\n", "CW;TX", "é", String(repeating: "A", count: 17)] {
            #expect(throws: OperatorDraftError.self) {
                try OperatorDraftRadioFollow.applying(to: before, frequencyHz: 14_025_000, observedMode: mode, enabled: true)
            }
        }
        #expect(before.frequencyHz == 14_080_000)
        #expect(before.mode == "FT4")
    }

    @Test("Identical observations are idempotent and a later projection starts from the latest operator value")
    func repeatedObservation() throws {
        let first = try OperatorDraftRadioFollow.applying(to: fixture(), frequencyHz: 14_074_000, observedMode: "DIGU", enabled: true)
        #expect(try OperatorDraftRadioFollow.applying(to: first, frequencyHz: 14_074_000, observedMode: "DIGU", enabled: true) == first)
        var edited = first
        edited.comment = "new text"; edited.txPower = ""; edited.mode = "FT2"
        var expected = edited; expected.frequencyHz = 7_074_000; expected.band = "40m"
        #expect(try OperatorDraftRadioFollow.applying(to: edited, frequencyHz: 7_074_000, observedMode: "PKTLSB", enabled: true) == expected)
    }
}

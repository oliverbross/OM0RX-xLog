import XCTest
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif

final class OperatorDraftNearbyCallsignTests: XCTestCase {
    func testCallsignOnlyProjectionPreservesCompleteSplitDraft() throws {
        var draft = QSO(call:"",band:"20m",mode:"CW")
        draft.call = ""
        draft.frequencyHz = 14_030_000
        draft.receiveFrequencyHz = 14_025_000
        draft.mode = "CW"
        draft.band = "20m"
        draft.rstSent = "579"
        draft.comment = "typed note"
        draft.extraFields["MY_POTA_REF"] = "VK-0001"
        draft.extraFields["APP_OM0RXXLOG_ANTENNA_ID"] = "retained-profile"
        let result = try OperatorDraftNearbyCallsign.applying(to:draft,callsign:"ZL1ABC")
        var expected = draft
        expected.call = "ZL1ABC"
        XCTAssertEqual(result,expected)
        XCTAssertEqual(result.frequencyHz,draft.frequencyHz)
        XCTAssertEqual(result.receiveFrequencyHz,draft.receiveFrequencyHz)
        XCTAssertEqual(result.start,draft.start)
    }
    func testOperatorCallsignAndInvalidEvidenceWin() throws {
        var draft = QSO(call:"",band:"20m",mode:"CW")
        draft.call = "OM0RX"
        XCTAssertThrowsError(try OperatorDraftNearbyCallsign.applying(to:draft,callsign:"ZL1ABC"))
        draft.call = ""
        for call in ["", "A", "ZL1ABC" + String(UnicodeScalar(10)), "ZL1ABC<script>", "zl1abc"] {
            XCTAssertThrowsError(try OperatorDraftNearbyCallsign.applying(to:draft,callsign:call))
        }
    }
}

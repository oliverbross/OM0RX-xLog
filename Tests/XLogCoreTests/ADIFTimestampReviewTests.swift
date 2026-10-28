import Foundation
import XCTest
@testable import XLogCore

final class ADIFTimestampReviewTests: XCTestCase {
    private func record(_ changes: [String: String] = [:]) -> ADIFRecord {
        var values = ["CALL": "K1ABC", "QSO_DATE": "20261028", "TIME_ON": "123456", "BAND": "20m", "MODE": "CW"]
        values.merge(changes, uniquingKeysWith: { _, new in new })
        return ADIFRecord(fields: values)
    }

    func testOnlyFourOrSixASCIIDigitTimesAreAccepted() {
        for time in ["1234", "123456"] {
            XCTAssertNotNil(QSO(adif: record(["TIME_ON": time])), time)
        }
        for time in ["1", "12", "123", "12345", "1234567", "１２３４", "240000", "236000", "235960"] {
            XCTAssertNil(QSO(adif: record(["TIME_ON": time])), time)
        }
        XCTAssertNil(QSO(adif: record(["TIME_OFF": "12345"])))
        XCTAssertNil(QSO(adif: record(["QSO_DATE": "20260229"])))
        XCTAssertNotNil(QSO(adif: record(["QSO_DATE": "20240229"])))
    }

    func testImplicitEndDateCrossesMidnightAndExportsInferredDay() throws {
        let qso = try XCTUnwrap(QSO(adif: record(["TIME_ON": "235500", "TIME_OFF": "010000"])))
        XCTAssertEqual(try XCTUnwrap(qso.end).timeIntervalSince(qso.start), 3900)
        XCTAssertEqual(qso.adifRecord["QSO_DATE_OFF"], "20261029")
        let year = try XCTUnwrap(QSO(adif: record(["QSO_DATE": "20261231", "TIME_ON": "2359", "TIME_OFF": "0001"])))
        XCTAssertEqual(try XCTUnwrap(year.end).timeIntervalSince(year.start), 120)
        XCTAssertEqual(year.adifRecord["QSO_DATE_OFF"], "20270101")
    }

    func testExplicitEndDateIsNotSilentlyRewritten() throws {
        let same = try XCTUnwrap(QSO(adif: record(["TIME_ON": "2355", "TIME_OFF": "0100", "QSO_DATE_OFF": "20261028"])))
        XCTAssertEqual(try XCTUnwrap(same.end).timeIntervalSince(same.start), -82500)
        let later = try XCTUnwrap(QSO(adif: record(["TIME_ON": "2355", "TIME_OFF": "0100", "QSO_DATE_OFF": "20261030"])))
        XCTAssertEqual(try XCTUnwrap(later.end).timeIntervalSince(later.start), 90300)
    }

    func testLegacyBackfillIsNonmutatingAndDoesNotRollFractionalSameSecond() throws {
        var qso = try XCTUnwrap(QSO(adif: record(["TIME_ON": "235500"])))
        qso.extraFields["TIME_OFF"] = "0100"
        XCTAssertEqual(try XCTUnwrap(qso.backfillingADIFFields().end).timeIntervalSince(qso.start), 3900)
        XCTAssertNil(qso.end)
        var fractional = try XCTUnwrap(QSO(adif: record()))
        fractional.start = fractional.start.addingTimeInterval(0.5)
        fractional.extraFields["TIME_OFF"] = "123456"
        XCTAssertEqual(try XCTUnwrap(fractional.backfillingADIFFields().end).timeIntervalSince(fractional.start), -0.5)
    }
}

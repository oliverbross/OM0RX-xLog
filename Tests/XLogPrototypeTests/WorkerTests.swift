import Foundation
import XCTest
#if os(macOS)
import XLogCore
#else
import XLogPortableCore
#endif
import XLogPrototypeSupport

final class WorkerTests: XCTestCase {
    private func request(_ method: String, _ params: [String: Any] = [:]) throws -> [String: Any] {
        let data = try JSONSerialization.data(withJSONObject: ["id": "fixture-1", "method": method, "params": params])
        return try XCTUnwrap(JSONSerialization.jsonObject(with: PrototypeWorker().response(to: data)) as? [String: Any])
    }

    func testHealthHasNoStationIOAndCorrelates() throws {
        let response = try request("health")
        XCTAssertEqual(response["id"] as? String, "fixture-1")
        XCTAssertEqual(response["ok"] as? Bool, true)
        let result = try XCTUnwrap(response["result"] as? [String: Any])
        XCTAssertEqual(result["station_io"] as? Bool, false)
        XCTAssertEqual(result["protocol_version"] as? Int, 1)
    }

    func testExistingCoreUnknownFieldAndSemanticIdentity() throws {
        let adif = "<CALL:5>TEST1<QSO_DATE:8>20260101<TIME_ON:6>120000<BAND:3>20m<MODE:2>CW<FREQ:6>14.025<APP_TEST:3>yes<EOR>"
        let response = try request("parse_adif", ["text": adif])
        XCTAssertEqual(response["ok"] as? Bool, true)
        let result = try XCTUnwrap(response["result"] as? [String: Any])
        let records = try XCTUnwrap(result["records"] as? [[String: Any]])
        XCTAssertEqual(records.count, 1)
        XCTAssertEqual((records[0]["fields"] as? [String: String])?["APP_TEST"], "yes")
        XCTAssertEqual(records[0]["semantic_identity_hash"] as? String,
                       SemanticQSOIdentity(call: "TEST1", timestamp: "20260101120000", band: "20m", mode: "CW").sha256)
        XCTAssertEqual((records[0]["qso"] as? [String: Any])?["frequency_hz"] as? Int64, 14_025_000)
    }

    func testMethodAllowlistAndParamShape() throws {
        for method in ["transmit", "read_file", "run", "connect"] {
            let response = try request(method)
            XCTAssertEqual((response["error"] as? [String: String])?["code"], "method_not_allowed")
        }
        XCTAssertEqual((try request("health", ["path": "/private"]) ["error"] as? [String: String])?["code"], "invalid_params")
    }

    func testMalformedAndUnsafeADIFRejectedWithoutParserCrash() throws {
        for text in ["<>", "<CALL:-1>x<EOR>", "<CALL:8>ABC", "<CALL:3>ABC", "<FREQ:3>NaN<EOR>",
                     "<FREQ:3>inf<EOR>", "ß<EOH><CALL:3>ABC<EOR>", "<CALL::>ABC<EOR>"] {
            XCTAssertEqual(try request("parse_adif", ["text": text])["ok"] as? Bool, false, text)
        }
    }

    func testRequestAndADIFBounds() throws {
        let response = try JSONSerialization.jsonObject(with: PrototypeWorker().response(to: Data(repeating: 65, count: PrototypeWorker.maxRequestBytes + 1))) as? [String: Any]
        XCTAssertEqual((response?["error"] as? [String: String])?["code"], "request_too_large")
        XCTAssertEqual((try request("parse_adif", ["text": String(repeating: "x", count: PrototypeWorker.maxADIFBytes + 1)])["error"] as? [String: String])?["code"], "adif_too_large")
        let many = String(repeating: "<CALL:1>X<EOR>", count: PrototypeWorker.maxRecords + 1)
        XCTAssertEqual((try request("parse_adif", ["text": many])["error"] as? [String: String])?["code"], "adif_limit")
    }

    func testIncrementalFramingOversizeRecoveryAndEOF() {
        var reader = WorkerLineReader()
        var lines: [Data?] = []
        reader.consume(Data("ab".utf8)) { lines.append($0) }
        reader.consume(Data("c\r\nx\n".utf8)) { lines.append($0) }
        reader.consume(Data(repeating: 65, count: PrototypeWorker.maxRequestBytes + 1)) { lines.append($0) }
        reader.consume(Data("\nnext".utf8)) { lines.append($0) }
        reader.finish { lines.append($0) }
        XCTAssertEqual(lines.count, 4)
        XCTAssertEqual(lines[0], Data("abc".utf8))
        XCTAssertEqual(lines[1], Data("x".utf8))
        XCTAssertNil(lines[2])
        XCTAssertEqual(lines[3], Data("next".utf8))
    }

    func testSyntheticDependencies() throws {
        let result = try PrototypeSelfTest.run()
        XCTAssertEqual(result["passed"] as? Bool, true)
        XCTAssertEqual(result["network_contact"] as? Bool, false)
        XCTAssertEqual(result["file_io"] as? Bool, false)
    }
}

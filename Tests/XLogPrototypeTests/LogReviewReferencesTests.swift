#if os(macOS)
import Foundation
import XCTest
import CryptoKit
@testable import XLogPrototypeSupport

final class LogReviewReferencesTests: XCTestCase {
    private func directory() throws -> URL {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("review-references-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        return directory
    }
    private func contact(_ call: String, at timestamp: String = "2026-10-25 12:00:00", id: String = "qso-1") -> [String: Any] {
        ["id": id, "call": call, "timestamp": timestamp]
    }
    private func rows(_ result: [String: Any]) throws -> [[String: Any]] { try XCTUnwrap(result["rows"] as? [[String: Any]]) }
    private func sources(_ result: [String: Any]) throws -> [String: [String: Any]] {
        Dictionary(uniqueKeysWithValues: try XCTUnwrap(result["sources"] as? [[String: Any]]).map { ($0["name"] as! String, $0) })
    }
    private func countries(_ row: [String: Any]) throws -> [String: [String: Any]] {
        Dictionary(uniqueKeysWithValues: try XCTUnwrap(row["countries"] as? [[String: Any]]).map { ($0["source"] as! String, $0) })
    }

    func testLocalMembershipIsExactAndAbsentCallsAreNotErrors() throws {
        let root = try directory()
        let data = Data("CALL,LASTUPLOAD\n\"K1ABC\",2026-10-20\nEA8/OM0RX,2026-10-21\n".utf8)
        try data.write(to: root.appendingPathComponent("lotw-user-activity.csv"))
        let result = try LogReviewReferences().review(params: ["contacts": [
            contact(" k1abc ", id: "one"), contact("K1ABC/P", id: "two"),
            contact("EA8/OM0RX", id: "three"), contact("OM0RX", id: "four"),
            contact("QQ1QQ", id: "missing"),
        ]], directory: root)
        let rows = try rows(result), sources = try sources(result)
        XCTAssertEqual(rows.map { $0["lotwListed"] as? Bool }, [true, false, true, false, false])
        XCTAssertEqual(rows[0]["call"] as? String, "K1ABC")
        XCTAssertEqual(sources["lotw"]?["status"] as? String, "available")
        XCTAssertEqual(sources["lotw"]?["version"] as? String,
                       "sha256:" + SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined())
        XCTAssertEqual(sources["clublog"]?["status"] as? String, "missing")
        XCTAssertNotNil(sources["lotw"]?["modifiedAt"] as? String)
        XCTAssertTrue(sources["cty"]?["modifiedAt"] is NSNull)
        XCTAssertNil(rows[0]["clublogListed"], "Country reference must not invent Club Log membership")
        XCTAssertEqual(try countries(rows[4]).count, 0)
    }

    func testCountryReferencesUseContactUTCAndBundledEndpointOverrides() throws {
        let root = try directory()
        let xml = """
        <clublog><prefixes>
        <prefix><call>PJ2</call><adif>85</adif><cqz>9</cqz><entity>Historical fixture</entity><end>2010-10-09 23:59:59</end></prefix>
        <prefix><call>PJ2</call><adif>517</adif><cqz>9</cqz><entity>Curacao</entity><start>2010-10-10 00:00:00</start></prefix>
        </prefixes><exceptions>
        <exception><call>PJ2/K1ABC</call><adif>291</adif><cqz>5</cqz><entity>Dated exact fixture</entity><start>2010-10-11</start><end>2010-10-12</end></exception>
        </exceptions></clublog>
        """
        try Data(xml.utf8).write(to: root.appendingPathComponent("cty.xml"))
        let result = try LogReviewReferences().review(params: ["contacts": [
            contact("PJ2AA", at: "2010-10-09 23:59:59", id: "before"),
            contact("PJ2AA", at: "2010-10-10T00:00:00Z", id: "after"),
            contact("PJ2/K1ABC", at: "2010-10-11T12:00:00.000Z", id: "exact"),
            contact("B0AAA", id: "override"),
        ]], directory: root)
        let rows = try rows(result)
        XCTAssertEqual(try countries(rows[0])["clublog"]?["adif"] as? Int, 85)
        XCTAssertEqual(try countries(rows[1])["clublog"]?["adif"] as? Int, 517)
        XCTAssertEqual(try countries(rows[2])["clublog"]?["adif"] as? Int, 291)
        XCTAssertEqual(try countries(rows[3])["cty"]?["cqZone"] as? Int, 23)
        XCTAssertNotNil(try countries(rows[3])["cty"]?["primaryPrefix"] as? String)
        XCTAssertEqual(try sources(result)["clublog"]?["status"] as? String, "available")
    }

    func testMissingAndInvalidSourcesRemainDistinctAndNeverBecomeFalseMembership() throws {
        let root = try directory(), references = LogReviewReferences()
        let input: [String: Any] = ["contacts": [contact("K1ABC")]]
        let missing = try references.review(params: input, directory: root)
        XCTAssertEqual(try sources(missing)["lotw"]?["status"] as? String, "missing")
        XCTAssertTrue(try rows(missing)[0]["lotwListed"] is NSNull)
        try Data("<html>not a CSV</html>".utf8).write(to: root.appendingPathComponent("lotw-user-activity.csv"))
        for xml in ["<clublog/>", "<broken>", "<!DOCTYPE clublog SYSTEM 'file:///etc/passwd'><clublog/>",
                    "<clublog><prefix><call>K</call><adif>291</adif><cqz>5</cqz><start>2026-02-30</start></prefix></clublog>"] {
            try Data(xml.utf8).write(to: root.appendingPathComponent("cty.xml"), options: .atomic)
            let invalid = try references.review(params: input, directory: root)
            XCTAssertEqual(try sources(invalid)["clublog"]?["status"] as? String, "invalid")
            XCTAssertEqual(try sources(invalid)["lotw"]?["status"] as? String, "invalid")
            XCTAssertTrue(try rows(invalid)[0]["lotwListed"] is NSNull)
            XCTAssertNotNil(try countries(rows(invalid)[0])["cty"])
        }
    }

    func testExpiredButValidDatedDatasetIsAvailable() throws {
        let root = try directory()
        try Data("<clublog><exception><call>K1ABC</call><adif>291</adif><cqz>5</cqz><entity>Fixture</entity><start>20000101</start><end>20010101</end></exception></clublog>".utf8)
            .write(to: root.appendingPathComponent("cty.xml"))
        let result = try LogReviewReferences().review(params: ["contacts": [contact("K1ABC", at: "2000-06-01T00:00:00Z")]], directory: root)
        XCTAssertEqual(try sources(result)["clublog"]?["status"] as? String, "available")
        XCTAssertEqual(try countries(rows(result)[0])["clublog"]?["adif"] as? Int, 291)
    }

    func testClubLogPrefixFieldAliasKeepsDatedResolution() throws {
        let root = try directory()
        try Data("<clublog><prefix><prefix>PJ2</prefix><adif>517</adif><cqz>9</cqz><entity>Curacao</entity></prefix><exception><prefix>PJ2/K1ABC</prefix><adif>291</adif><cqz>5</cqz><entity>Fixture</entity><start>20000101</start><end>20010101</end></exception></clublog>".utf8)
            .write(to: root.appendingPathComponent("cty.xml"))
        let result = try LogReviewReferences().review(params: ["contacts": [
            contact("PJ2/K1ABC", at: "2000-06-01T00:00:00Z", id: "dated"), contact("PJ2/K1ABC", id: "now"),
        ]], directory: root)
        XCTAssertEqual(try sources(result)["clublog"]?["status"] as? String, "available")
        XCTAssertEqual(try countries(rows(result)[0])["clublog"]?["adif"] as? Int, 291)
        XCTAssertEqual(try countries(rows(result)[1])["clublog"]?["adif"] as? Int, 517)
    }

    func testMalformedCSVNeverNormalizesIntoListedCall() throws {
        let root = try directory(), references = LogReviewReferences()
        for csv in ["K1\"ABC\",2026-10-20\n", "\"K1\"\"ABC\",2026-10-20\n", "\"K1ABC,2026-10-20\n"] {
            try Data(csv.utf8).write(to: root.appendingPathComponent("lotw-user-activity.csv"), options: .atomic)
            let result = try references.review(params: ["contacts": [contact("K1ABC")]], directory: root)
            XCTAssertEqual(try sources(result)["lotw"]?["status"] as? String, "invalid")
            XCTAssertTrue(try rows(result)[0]["lotwListed"] is NSNull)
        }
    }

    func testCacheReplacesChangedFileAndDoesNotLeakBetweenDirectories() throws {
        let root = try directory(), other = try directory(), references = LogReviewReferences()
        let url = root.appendingPathComponent("lotw-user-activity.csv")
        let input: [String: Any] = ["contacts": [contact("K1ABC")]]
        try Data("K1ABC,2026-10-20\n".utf8).write(to: url)
        let originalDate = try XCTUnwrap(FileManager.default.attributesOfItem(atPath: url.path)[.modificationDate] as? Date)
        let first = try references.review(params: input, directory: root)
        let cached = try references.review(params: input, directory: root)
        XCTAssertEqual(try sources(first)["lotw"]?["version"] as? String, try sources(cached)["lotw"]?["version"] as? String)
        try Data("K2ABC,2026-10-20\n".utf8).write(to: url, options: .atomic)
        try FileManager.default.setAttributes([.modificationDate: originalDate], ofItemAtPath: url.path)
        let changed = try references.review(params: input, directory: root)
        XCTAssertEqual(try rows(changed)[0]["lotwListed"] as? Bool, false, "Same size/mtime replacement must be detected by inode")
        XCTAssertNotEqual(try sources(first)["lotw"]?["version"] as? String, try sources(changed)["lotw"]?["version"] as? String)
        XCTAssertTrue(try rows(references.review(params: input, directory: other))[0]["lotwListed"] is NSNull)
        try FileManager.default.removeItem(at: url)
        XCTAssertEqual(try sources(references.review(params: input, directory: root))["lotw"]?["status"] as? String, "missing")
    }

    func testRejectsOversizedFilesAndInvalidBatches() throws {
        let root = try directory(), references = LogReviewReferences()
        let url = root.appendingPathComponent("lotw-user-activity.csv")
        XCTAssertTrue(FileManager.default.createFile(atPath: url.path, contents: Data()))
        let handle = try FileHandle(forWritingTo: url)
        try handle.truncate(atOffset: UInt64(LogReviewReferences.maximumFileBytes + 1))
        try handle.close()
        let result = try references.review(params: ["contacts": [contact("K1ABC")]], directory: root)
        XCTAssertEqual(try sources(result)["lotw"]?["status"] as? String, "invalid")
        let invalidBatches: [[String: Any]] = [
            ["contacts": (0...100).map { contact("K1ABC", id: String($0)) }],
            ["contacts": [contact("K1ABC"), contact("K1ABC")]],
            ["contacts": [contact("K1ABC", at: "2026-02-30 12:00:00")]],
            ["contacts": [contact("K1ABC", at: "2026-10-25T12:00:00+10:00")]],
            ["contacts": [contact("K1ABC")], "network": true],
        ]
        for params in invalidBatches { XCTAssertThrowsError(try references.review(params: params, directory: root)) }
    }

    func testLiveReferenceDispatchUsesOnlyLocalSources() async throws {
        let root = try directory(), logbook = LiveLogbookMethods(supportDirectory: root)
        _ = try logbook.handle(method: "workspace_create", params: ["mode": "empty"])
        let references = LiveReferenceMethods(logbook: logbook)
        let result = try await references.handle(method: "reference_log_review", params: ["contacts": [contact("OM0RX")]])
        XCTAssertEqual(try sources(result)["cty"]?["status"] as? String, "available")
        XCTAssertEqual(try sources(result)["lotw"]?["status"] as? String, "missing")
        XCTAssertEqual(try rows(result).count, 1)
        let task = await references.refreshTask
        XCTAssertNil(task)
    }

    func testRealWorkerRoutesReviewToDisposableLocalReferencesWithoutExternalIO() async throws {
        let root = try directory()
        let profile = try AppRuntimeProfile.contestingTestProfile(applicationSupport: root)
        guard case .contestingTest(let supportRoot) = profile else { return XCTFail("Expected isolated test profile") }
        XCTAssertFalse(profile.externalIOAllowed)
        let logbook = LiveLogbookMethods(supportDirectory: supportRoot, inheritNativePreferences: false,
                                        runtimeProfile: profile)
        _ = try logbook.handle(method: "workspace_create", params: ["mode": "empty"])
        let referenceDirectory = try logbook.referenceDirectoryURL()
        XCTAssertTrue(referenceDirectory.standardizedFileURL.path.hasPrefix(root.standardizedFileURL.path + "/"))
        let xml = Data("<clublog><prefix><call>K</call><adif>291</adif><cqz>5</cqz><entity>Disposable worker fixture</entity></prefix></clublog>".utf8)
        let csv = Data("K1ABC,2026-10-20\n".utf8)
        let xmlURL = referenceDirectory.appendingPathComponent("cty.xml")
        let csvURL = referenceDirectory.appendingPathComponent("lotw-user-activity.csv")
        try xml.write(to: xmlURL)
        try csv.write(to: csvURL)
        let before = try JSONSerialization.data(withJSONObject: logbook.handle(method: "logbook_list", params: [:]), options: .sortedKeys)
        let worker = LiveWorker(logbook: logbook, runtimeProfile: profile, operatingModule: .contesting)
        addTeardownBlock { _ = await worker.shutdown() }
        func frame(_ method: String, _ params: [String: Any]) async throws -> [String: Any] {
            let request = try JSONSerialization.data(withJSONObject: [
                "id": "review-wire-test", "method": method, "params": params,
            ])
            let response = await worker.response(to: request)
            return try XCTUnwrap(JSONSerialization.jsonObject(with: response) as? [String: Any])
        }
        let response = try await frame("reference_log_review", ["contacts": [
            contact("K1ABC", id: "listed"), contact("K1ABC/P", id: "not-listed"),
        ]])
        XCTAssertEqual(response["id"] as? String, "review-wire-test")
        XCTAssertEqual(response["ok"] as? Bool, true, "\(response["error"] ?? "missing result")")
        let result = try XCTUnwrap(response["result"] as? [String: Any])
        let reviewedRows = try rows(result)
        XCTAssertEqual(reviewedRows.map { $0["id"] as? String }, ["listed", "not-listed"])
        XCTAssertEqual(reviewedRows.map { $0["lotwListed"] as? Bool }, [true, false])
        XCTAssertEqual(try countries(reviewedRows[0])["clublog"]?["country"] as? String, "DISPOSABLE WORKER FIXTURE")
        XCTAssertNotNil(try countries(reviewedRows[0])["cty"]?["primaryPrefix"])
        XCTAssertEqual(try sources(result)["lotw"]?["status"] as? String, "available")
        // A working local read must not broaden the test profile's external-service admission.
        for method in ["reference_refresh", "reference_schedule", "cluster_connect"] {
            let blocked = try await frame(method, [:])
            XCTAssertEqual(blocked["ok"] as? Bool, false)
            XCTAssertEqual((blocked["error"] as? [String: Any])?["code"] as? String, "external_io_disabled")
        }
        XCTAssertEqual(try Data(contentsOf: xmlURL), xml)
        XCTAssertEqual(try Data(contentsOf: csvURL), csv)
        XCTAssertEqual(try JSONSerialization.data(withJSONObject: logbook.handle(method: "logbook_list", params: [:]), options: .sortedKeys), before)
    }
}
#endif

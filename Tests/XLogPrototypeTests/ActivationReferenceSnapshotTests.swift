import Foundation
import XCTest
#if canImport(XLogCore)
@testable import XLogCore
#else
@testable import XLogPortableCore
#endif
@testable import XLogPrototypeSupport

final class ActivationReferenceSnapshotTests: XCTestCase {
    private let original = Data("reference,name\nUS-0001,Park\n".utf8)
    private let replacement = Data("reference,name\nUS-0002,Park\n".utf8)
    private let second = floor(Date().timeIntervalSince1970) - 60

    private func directory() throws -> URL {
        let temporary = URL(fileURLWithPath: try AppRuntimeProfile.canonicalFilesystemPath(FileManager.default.temporaryDirectory), isDirectory: true)
        let root = temporary.appendingPathComponent("reference-version-\(UUID())", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        return root
    }
    private func stamp(_ url: URL, fraction: Double) throws {
        try FileManager.default.setAttributes([.modificationDate: Date(timeIntervalSince1970: second + fraction)], ofItemAtPath: url.path)
    }

    func testFingerprintDistinguishesSubsecondAndEqualSizeAtomicReplacement() throws {
        let root = try directory(), file = root.appendingPathComponent(ActivationReferenceKind.pota.fileName)
        XCTAssertEqual(original.count, replacement.count)
        try original.write(to: file); try stamp(file, fraction: 0.1)
        let first = try ActivationReferenceDirectory.fingerprint(directory: root)
        XCTAssertEqual(first, try ActivationReferenceDirectory.fingerprint(directory: root))
        // Updating this same inode within one second must change its version.
        try replacement.write(to: file); try stamp(file, fraction: 0.8)
        let subsecond = try ActivationReferenceDirectory.fingerprint(directory: root)
        XCTAssertNotEqual(first, subsecond)
        // Restoring size and exact timestamp on a new inode must still differ.
        try original.write(to: file, options: .atomic); try stamp(file, fraction: 0.1)
        XCTAssertNotEqual(first, try ActivationReferenceDirectory.fingerprint(directory: root))
    }

    func testCaptureRefusesRequestWhoseReferenceVersionChanged() throws {
        let root = try directory(), file = root.appendingPathComponent(ActivationReferenceKind.pota.fileName)
        try original.write(to: file); try stamp(file, fraction: 0.1)
        let db = try LogbookDatabase(url: root.appendingPathComponent("log.sqlite")); defer { db.close() }
        var request = try LogbookAggregateRequest.current(.localAwards)
        request.programme = "pota"; request.referenceDirectory = root.path
        request.referenceVersion = try ActivationReferenceDirectory.fingerprint(directory: root)
        try replacement.write(to: file); try stamp(file, fraction: 0.8)
        XCTAssertThrowsError(try LogbookDatabase.readAggregateSnapshot(at: db.url, authority: db.aggregateReadAuthority(),
            request: request, cancellation: LogbookAggregateCancellation())) { error in
            XCTAssertEqual(error as? LogbookAggregateReadError, .superseded)
        }
    }

    func testCachedWorkerRequestRefreshesEqualSizeSameSecondReferenceReplacement() async throws {
        let root = try directory()
        let profile = AppRuntimeProfile.contestingTest(supportRoot: root)
        let service = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false, runtimeProfile: profile)
        _ = try service.handle(method: "workspace_create", params: ["mode": "empty"])
        let worker = LiveWorker(logbook: service, runtimeProfile: profile)
        addTeardownBlock { _ = await worker.shutdown(); (try? service.openedDatabase())?.close() }
        try service.openedDatabase().save(QSO(call: "K1PARK", band: "20m", mode: "CW", potaReference: "US-0001", myCall: "OM0RX"))
        let file = try service.referenceDirectoryURL().appendingPathComponent(ActivationReferenceKind.pota.fileName)
        try original.write(to: file); try stamp(file, fraction: 0.1)
        func progress() async throws -> [String: Any] {
            let frame = try JSONSerialization.data(withJSONObject: ["id": UUID().uuidString,
                "method": "logbook_award_progress", "params": ["programme": "pota"], "operatingModule": "normal_logging"])
            let data = await worker.response(to: frame)
            let reply = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
            XCTAssertEqual(reply["ok"] as? Bool, true, String(describing: reply["error"]))
            return try XCTUnwrap(reply["result"] as? [String: Any])
        }
        let first = try await progress()
        XCTAssertEqual(first["directoryMatchedUnits"] as? Int, 1)
        let cached = try await progress()
        XCTAssertEqual(cached["referenceVersion"] as? String, first["referenceVersion"] as? String)
        try replacement.write(to: file); try stamp(file, fraction: 0.8)
        let refreshed = try await progress()
        XCTAssertNotEqual(refreshed["referenceVersion"] as? String, first["referenceVersion"] as? String)
        XCTAssertEqual(refreshed["directoryMatchedUnits"] as? Int, 0)
        XCTAssertEqual(refreshed["supportingQSOs"] as? Int, 1)
    }
}

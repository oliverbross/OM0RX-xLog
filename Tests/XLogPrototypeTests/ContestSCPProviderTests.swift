import Foundation
import XCTest
@testable import XContestCore
@testable import XLogPrototypeSupport

final class ContestSCPProviderTests: XCTestCase {
    private let releaseDate = Date(timeIntervalSince1970: 1_792_109_016.9253356)

    func testOfficialCatalogDiscoveryRequiresExactMasterNameAndBoundedMetadata() throws {
        let digest = String(repeating: "a", count: 64)
        let data = Data("""
        [{"name":"MASTER.SCP","size":359667,"etag":"\(digest)","modified":"2026-10-16T00:03:36.925335529Z"}]
        """.utf8)
        let (entry, date) = try ContestSCPProvider.catalogEntry(from: data)
        XCTAssertEqual(entry.name, "MASTER.SCP")
        XCTAssertEqual(entry.size, 359_667)
        XCTAssertEqual(entry.etag, digest)
        XCTAssertEqual(date.timeIntervalSince1970, releaseDate.timeIntervalSince1970, accuracy: 0.001)
        XCTAssertEqual(ContestSCPProvider.masterURL.absoluteString,
                       "https://www.supercheckpartial.com/downloads/MASTER.SCP")

        for invalid in [
            "[{\"name\":\"master.scp\",\"size\":1,\"etag\":\"\(digest)\",\"modified\":\"2026-10-16T00:03:36Z\"}]",
            "[{\"name\":\"MASTER.SCP\",\"size\":1,\"etag\":\"bad\",\"modified\":\"2026-10-16T00:03:36Z\"}]",
            "[{\"name\":\"MASTER.SCP\",\"size\":99999999,\"etag\":\"\(digest)\",\"modified\":\"2026-10-16T00:03:36Z\"}]",
        ] {
            XCTAssertThrowsError(try ContestSCPProvider.catalogEntry(from: Data(invalid.utf8)))
        }
    }

    func testDownloadActivatesVerifiedProviderBytesPersistsAndUsesConditionalDigest() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-scp-provider-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let cache = root.appendingPathComponent("SuperCheckPartial/current.json")
        let bytes = Data("!!Order,1,1\r\n# Release 2026.10.16\r\nK1ABC\r\nOM0RX\r\n".utf8)
        let digest = ContestSCPIndex.sha256(bytes)
        let metadata = ContestSCPProviderMetadata(name: "MASTER.SCP", size: bytes.count, etag: digest,
                                                  modified: "2026-10-16T00:03:36Z")
        let recorder = DigestRecorder()
        let service = try ContestSCPService(cacheURL: cache, validatePrivateRoot: {}, providerFetch: { prior in
            await recorder.append(prior)
            return ContestSCPProviderResult(metadata: metadata,
                modifiedAt: Date(timeIntervalSince1970: 1_792_109_016), bytes: prior == digest ? nil : bytes)
        }, validateScope: { _ in })

        let first = try await service.downloadLatest()
        XCTAssertTrue(first.updated)
        XCTAssertEqual(first.dataset.recordCount, 2)
        XCTAssertEqual(first.dataset.digestVerification, .matchedExpectedSHA256)
        XCTAssertEqual(first.dataset.provenance.sourceID, "supercheckpartial-official")
        XCTAssertEqual(first.dataset.provenance.sourceURL, ContestSCPProvider.masterURL.absoluteString)
        let second = try await service.downloadLatest()
        XCTAssertFalse(second.updated)
        let recorded = await recorder.values()
        XCTAssertEqual(recorded, [nil, digest])

        let restored = try ContestSCPService(cacheURL: cache, validatePrivateRoot: {}, validateScope: { _ in })
        let status = await restored.status()
        XCTAssertEqual(status.dataset?.sha256, digest)
        XCTAssertEqual(status.dataset?.digestVerification, .matchedExpectedSHA256)
    }

    func testProviderValidationOrAtomicWriteFailureRetainsActiveDatasetAndCache() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-scp-provider-retain-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let cache = root.appendingPathComponent("SuperCheckPartial/current.json")
        let local = root.appendingPathComponent("local.scp")
        try Data("K1ABC\n".utf8).write(to: local)
        let initial = try ContestSCPService(cacheURL: cache, validatePrivateRoot: {}, validateScope: { _ in })
        let original = try await initial.importFile(path: local.path, sourceName: "local.scp", retrievedAt: Date(timeIntervalSince1970: 1))
        let saved = try Data(contentsOf: cache)

        let bytes = Data("OM0RX\n".utf8), digest = ContestSCPIndex.sha256(bytes)
        let metadata = ContestSCPProviderMetadata(name: "MASTER.SCP", size: bytes.count, etag: digest,
                                                  modified: "2026-10-16T00:03:36Z")
        let service = try ContestSCPService(cacheURL: cache, validatePrivateRoot: {},
            providerFetch: { _ in ContestSCPProviderResult(metadata: metadata, modifiedAt: Date(), bytes: bytes) },
            writeAtomically: { _, _ in throw CocoaError(.fileWriteUnknown) }, validateScope: { _ in })
        await XCTAssertThrowsErrorAsync(try await service.downloadLatest())
        let retained = await service.status()
        XCTAssertEqual(retained.dataset?.sha256, original.sha256)
        XCTAssertEqual(try Data(contentsOf: cache), saved)
    }

    func testPythonAssistanceAdmitsDownloadAndReturnsOfficialSuccessAlreadyCurrentAndFailure() async throws {
        XCTAssertTrue(LiveWorker.isPythonContestAssistanceMethod("contest_scp_download"))

        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("xlog-python-scp-provider-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let contestingRoot = root.appendingPathComponent("Application/Contesting", isDirectory: true)
        let bytes = Data("K1ABC\nOM0RX\n".utf8)
        let digest = ContestSCPIndex.sha256(bytes)
        let metadata = ContestSCPProviderMetadata(name: "MASTER.SCP", size: bytes.count, etag: digest,
                                                  modified: "2026-10-16T00:03:36Z")
        let recorder = DigestRecorder()
        let lane = try PythonContestAssistanceLane(contestingRoot: contestingRoot, providerFetch: { prior in
            await recorder.append(prior)
            let attempt = await recorder.count()
            if attempt == 3 {
                return ContestSCPProviderResult(
                    metadata: .init(name: "master.scp", size: bytes.count, etag: digest,
                                    modified: "2026-10-16T00:03:36Z"),
                    modifiedAt: Date(timeIntervalSince1970: 1_792_109_016), bytes: bytes)
            }
            return ContestSCPProviderResult(metadata: metadata,
                modifiedAt: Date(timeIntervalSince1970: 1_792_109_016), bytes: prior == digest ? nil : bytes)
        }, validateScope: { _ in })

        let first = try await lane.handle(method: "contest_scp_download", params: [:])
        XCTAssertEqual(first["updated"] as? Bool, true)
        let firstDataset = try XCTUnwrap(first["dataset"] as? [String: Any])
        XCTAssertEqual(firstDataset["sourceID"] as? String, "supercheckpartial-official")
        XCTAssertEqual(firstDataset["sha256"] as? String, digest)
        XCTAssertEqual(firstDataset["digestVerification"] as? String, "matchedExpectedSHA256")

        let current = try await lane.handle(method: "contest_scp_download", params: [:])
        XCTAssertEqual(current["updated"] as? Bool, false)
        XCTAssertEqual((current["dataset"] as? [String: Any])?["sha256"] as? String, digest)

        do {
            _ = try await lane.handle(method: "contest_scp_download", params: [:])
            XCTFail("Invalid official metadata must fail without replacing the active dataset.")
        } catch let error as ContestLaneError {
            XCTAssertEqual(error.code, "invalid_scp_download")
            XCTAssertEqual(error.outcome, "confirmed")
        }
        let status = try await lane.handle(method: "contest_scp_status", params: [:])
        XCTAssertEqual((status["dataset"] as? [String: Any])?["sha256"] as? String, digest)
        let requests = await recorder.values()
        XCTAssertEqual(requests, [nil, digest, digest])
    }

    func testLiveOfficialDownloadIntoDisposableCacheWhenEnabled() async throws {
        guard ProcessInfo.processInfo.environment["XLOG_SCP_LIVE_TEST"] == "1" else {
            throw XCTSkip("Set XLOG_SCP_LIVE_TEST=1 for the explicit provider acceptance check.")
        }
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-scp-live-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let cache = root.appendingPathComponent("SuperCheckPartial/current.json")
        let service = try ContestSCPService(cacheURL: cache, validatePrivateRoot: {}, validateScope: { _ in })
        let downloaded = try await service.downloadLatest()
        XCTAssertTrue(downloaded.updated)
        XCTAssertEqual(downloaded.dataset.provenance.sourceURL, ContestSCPProvider.masterURL.absoluteString)
        XCTAssertEqual(downloaded.dataset.digestVerification, .matchedExpectedSHA256)
        XCTAssertGreaterThan(downloaded.dataset.recordCount, 10_000)
        XCTAssertTrue(FileManager.default.fileExists(atPath: cache.path))

        let current = try await service.downloadLatest()
        XCTAssertFalse(current.updated)
        XCTAssertEqual(current.dataset.sha256, downloaded.dataset.sha256)
        XCTAssertEqual(current.dataset.recordCount, downloaded.dataset.recordCount)

        let restored = try ContestSCPService(cacheURL: cache, validatePrivateRoot: {}, validateScope: { _ in })
        let restoredStatus = await restored.status()
        XCTAssertEqual(restoredStatus.dataset?.sha256, downloaded.dataset.sha256)
        XCTAssertEqual(restoredStatus.dataset?.digestVerification, .matchedExpectedSHA256)
        XCTAssertNil(restoredStatus.unavailableReason)
    }
}

private actor DigestRecorder {
    private var recorded: [String?] = []
    func append(_ value: String?) { recorded.append(value) }
    func values() -> [String?] { recorded }
    func count() -> Int { recorded.count }
}

private func XCTAssertThrowsErrorAsync<T>(_ expression: @autoclosure () async throws -> T) async {
    do { _ = try await expression(); XCTFail("Expected error") } catch { }
}

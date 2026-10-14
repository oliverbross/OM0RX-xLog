import Foundation
import XCTest
@testable import XLogPrototypeSupport
#if os(macOS)
import XLogCore
#else
import XLogPortableCore
#endif

final class SyncSummaryTests: XCTestCase {
    func testSummaryContainsNoContactCollectionsAndReportsFailedCompletion() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-sync-summary-" + UUID().uuidString)
        let logbook = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        defer {
            if let workspace = try? IntegrationWorkspaceBootstrap.open(at: logbook.workspaceDirectoryURL) {
                workspace.makeDefaults()?.removePersistentDomain(forName: workspace.defaultsSuiteName)
            }
            try? logbook.openedDatabase().close()
            try? FileManager.default.removeItem(at: root)
        }
        _ = try logbook.handle(method: "workspace_create", params: ["mode": "empty"])
        var fields = try XCTUnwrap(logbook.handle(method: "settings_load", params: [:])["settings"] as? [String: Any])
        fields["logbookMode"] = "wavelog"
        fields["wavelogURL"] = "https://sync-summary-fixture.invalid"
        fields["wavelogStationID"] = 1
        _ = try logbook.saveSettingsForTest(fields)
        let service = LiveServiceMethods(logbook: logbook, operation: { _, _ in throw URLError(.networkConnectionLost) })
        let idle = try await service.handle(method: "sync_summary", params: [:])
        XCTAssertNil(idle["conflicts"]); XCTAssertNil(idle["outbox"])
        XCTAssertEqual(idle["running"] as? Bool, false)
        _ = try await service.handle(method: "sync_run", params: ["confirm_single_writer": true])
        var completed: [String: Any] = [:]
        for _ in 0..<2_000 {
            completed = try await service.handle(method: "sync_summary", params: [:])
            if completed["running"] as? Bool == false { break }
            await Task.yield()
        }
        XCTAssertEqual(completed["running"] as? Bool, false)
        XCTAssertTrue((completed["status"] as? String)?.hasPrefix("Failed") == true)
        XCTAssertNotNil(completed["finished_at"])
        XCTAssertNotNil(completed["completion_id"])
        XCTAssertNil(completed["conflicts"]); XCTAssertNil(completed["outbox"])
        XCTAssertEqual(completed["error_code"] as? String, "network_unavailable")
        XCTAssertEqual(completed["error_phase"] as? String, "run")
        await service.terminate()
    }

    func testTypedFailuresExposeOnlyBoundedDiagnosticsWithoutDependencyContent() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-sync-diagnostics-" + UUID().uuidString)
        let logbook = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        defer {
            if let workspace = try? IntegrationWorkspaceBootstrap.open(at: logbook.workspaceDirectoryURL) {
                workspace.makeDefaults()?.removePersistentDomain(forName: workspace.defaultsSuiteName)
            }
            try? logbook.openedDatabase().close()
            try? FileManager.default.removeItem(at: root)
        }
        _ = try logbook.handle(method: "workspace_create", params: ["mode": "empty"])
        var fields = try XCTUnwrap(logbook.handle(method: "settings_load", params: [:])["settings"] as? [String: Any])
        fields["logbookMode"] = "wavelog"
        fields["wavelogURL"] = "https://sync-diagnostics-fixture.invalid"
        fields["wavelogStationID"] = 1
        _ = try logbook.saveSettingsForTest(fields)
        let privateContent = "private-contact-credential-and-url-" + String(repeating: "x", count: 10_000)
        let cases: [(Error, String, Int?)] = [
            (WavelogClientError.rejected(status: 403, code: privateContent, message: privateContent), "wavelog_http", 403),
            (WavelogClientError.rejected(status: 429, code: privateContent, message: privateContent), "wavelog_http", 429),
            (WavelogClientError.rejected(status: Int.max, code: privateContent, message: privateContent), "wavelog_http", nil),
            (WavelogClientError.invalidConfiguration(privateContent), "wavelog_configuration", nil),
            (WavelogClientError.invalidResponse, "wavelog_invalid_response", nil),
            (WavelogClientError.invalidData(privateContent), "wavelog_reconciliation", nil),
            (WavelogClientError.writeVerificationFailed(id: 987654321), "wavelog_write_readback", nil),
            (DecodingError.dataCorrupted(.init(codingPath: [], debugDescription: privateContent)), "wavelog_decoding", nil),
            (URLError(.timedOut, userInfo: [NSURLErrorFailingURLStringErrorKey: privateContent]), "network_timeout", nil),
            (URLError(.cannotFindHost), "network_dns", nil),
            (URLError(.serverCertificateUntrusted), "network_tls", nil),
            (CancellationError(), "cancelled", nil),
            (WorkerFailure("sync_disabled", privateContent), "sync_disabled", nil),
            (WorkerFailure(privateContent, privateContent), "sync_internal", nil),
            (NSError(domain: privateContent, code: 1, userInfo: [NSLocalizedDescriptionKey: privateContent]), "sync_internal", nil),
        ]
        for (error, expectedCode, expectedStatus) in cases {
            let service = LiveServiceMethods(logbook: logbook, operation: { _, _ in throw error })
            _ = try await service.handle(method: "sync_run", params: ["confirm_single_writer": true])
            var result: [String: Any] = [:]
            for _ in 0..<2_000 {
                result = try await service.handle(method: "sync_summary", params: [:])
                if result["running"] as? Bool == false { break }
                await Task.yield()
            }
            XCTAssertEqual(result["running"] as? Bool, false)
            XCTAssertEqual(result["error_code"] as? String, expectedCode)
            XCTAssertEqual(result["error_phase"] as? String, "run")
            XCTAssertEqual(result["http_status"] as? Int, expectedStatus)
            let status = try XCTUnwrap(result["status"] as? String)
            XCTAssertTrue(status.hasPrefix("Failed"))
            XCTAssertLessThan(status.utf8.count, 256)
            let serialized = String(decoding: try JSONSerialization.data(withJSONObject: result), as: UTF8.self)
            XCTAssertFalse(serialized.contains("private-contact-credential-and-url"))
            XCTAssertFalse(serialized.contains("987654321"))
            let detailed = try await service.handle(method: "sync_status", params: [:])
            XCTAssertEqual(detailed["error_code"] as? String, expectedCode)
            XCTAssertEqual(detailed["http_status"] as? Int, expectedStatus)
            await service.terminate()
        }
    }
}

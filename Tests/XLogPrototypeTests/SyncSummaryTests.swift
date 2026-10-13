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
        _ = try logbook.handle(method: "settings_save", params: ["settings": fields])
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
        await service.terminate()
    }
}

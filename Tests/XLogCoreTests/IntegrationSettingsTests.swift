import Foundation
import Testing
@testable import XLogCore

@Suite("Revisioned Integration settings")
struct IntegrationSettingsTests {
    private func database() throws -> (LogbookDatabase, URL) {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        return (try LogbookDatabase(url: root.appendingPathComponent("settings.sqlite")), root)
    }

    @Test("Seed is one-time and concurrent stale writes conflict")
    func seedAndConflict() throws {
        let (database, root) = try database()
        defer { database.close(); try? FileManager.default.removeItem(at: root) }
        var seed = XLogSettings.defaults
        seed.logbookMode = .local
        let initial = try database.integrationSettings(seed: seed)
        #expect(initial.revision == 0)
        var ignored = seed
        ignored.stationCall = "IGNORED"
        #expect(try database.integrationSettings(seed: ignored) == initial)

        var first = seed
        first.stationCall = "VK8ABC"
        let receipt = try database.applyIntegrationSettings(.init(
            operationID: UUID(), expectedRevision: 0, settings: first
        ))
        #expect(receipt.snapshot.revision == 1)
        #expect(receipt.snapshot.settings.stationCall == "VK8ABC")
        #expect(throws: IntegrationSettingsError.self) {
            try database.applyIntegrationSettings(.init(
                operationID: UUID(), expectedRevision: 0, settings: ignored
            ))
        }
    }

    @Test("Exact replay and no-op saves keep one durable result")
    func replayAndNoOp() throws {
        let (database, root) = try database()
        defer { database.close(); try? FileManager.default.removeItem(at: root) }
        let initial = try database.integrationSettings(seed: .defaults)
        let operationID = UUID()
        let mutation = IntegrationSettingsMutation(
            operationID: operationID, expectedRevision: initial.revision, settings: initial.settings
        )
        let first = try database.applyIntegrationSettings(mutation)
        #expect(first.snapshot.revision == 0)
        #expect(try database.applyIntegrationSettings(mutation) == first)
        #expect(try database.integrationSettingsReceipt(operationID: operationID) == first)

        var changed = initial.settings
        changed.stationLocation = "Different request"
        #expect(throws: IntegrationSettingsError.self) {
            try database.applyIntegrationSettings(.init(
                operationID: operationID, expectedRevision: initial.revision, settings: changed
            ))
        }
    }

    @Test("Restore replacement is atomic and retires old receipts")
    func restoreReplacement() throws {
        let (database, root) = try database()
        defer { database.close(); try? FileManager.default.removeItem(at: root) }
        let initial = try database.integrationSettings(seed: .defaults)
        let operationID = UUID()
        _ = try database.applyIntegrationSettings(.init(
            operationID: operationID, expectedRevision: initial.revision, settings: initial.settings
        ))
        var restored = initial.settings
        restored.stationLocation = "Restored"
        let snapshot = IntegrationSettingsSnapshot(revision: 7, settings: restored)
        try database.installIntegrationSettingsAfterRestore(snapshot)
        #expect(try database.integrationSettings(seed: .defaults) == snapshot)
        #expect(try database.integrationSettingsReceipt(operationID: operationID) == nil)
    }

    @Test("Invalid non-secret settings never enter the database")
    func invalidSettings() throws {
        let (database, root) = try database()
        defer { database.close(); try? FileManager.default.removeItem(at: root) }
        var invalid = XLogSettings.defaults
        invalid.xcatRigCtlPort = 0
        #expect(throws: IntegrationSettingsError.self) {
            try database.integrationSettings(seed: invalid)
        }
    }
}

import Foundation
import Testing
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif
@testable import XLogPrototypeSupport

@Suite("Revision-safe Integration Settings")
struct SettingsSessionSafetyTests {
    private func load(_ service: LiveLogbookMethods) throws ->
        (settings: [String: Any], revision: Int64, generation: String) {
        let response = try service.handle(method: "settings_load", params: [:])
        return (
            try #require(response["settings"] as? [String: Any]),
            try #require((response["revision"] as? NSNumber)?.int64Value),
            try #require(response["generation"] as? String)
        )
    }

    private func save(_ service: LiveLogbookMethods, operationID: UUID, expectedRevision: Int64,
                      generation: String, settings: [String: Any]) throws -> [String: Any] {
        try service.handle(method: "settings_save", params: [
            "operationID": operationID.uuidString,
            "expectedRevision": expectedRevision,
            "generation": generation,
            "settings": settings,
        ])
    }

    private func equalJSON(_ lhs: Any, _ rhs: Any) throws -> Bool {
        try JSONSerialization.data(withJSONObject: lhs, options: .sortedKeys)
            == JSONSerialization.data(withJSONObject: rhs, options: .sortedKeys)
    }

    @Test("Concurrent editors cannot overwrite a newer Settings revision")
    func concurrentEditorsConflict() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let first = LiveLogbookMethods(supportDirectory: root)
        _ = try first.handle(method: "workspace_create", params: ["mode": "empty"])
        let second = LiveLogbookMethods(supportDirectory: root)
        let firstBase = try load(first), secondBase = try load(second)
        #expect(firstBase.revision == secondBase.revision)
        #expect(firstBase.generation == secondBase.generation)

        var firstSettings = firstBase.settings
        firstSettings["stationCall"] = "VK8FIRST"
        let applied = try save(first, operationID: UUID(), expectedRevision: firstBase.revision,
                               generation: firstBase.generation, settings: firstSettings)
        #expect(applied["status"] as? String == "applied")

        var staleSettings = secondBase.settings
        staleSettings["stationCall"] = "VK8STALE"
        let conflict = try save(second, operationID: UUID(), expectedRevision: secondBase.revision,
                                generation: secondBase.generation, settings: staleSettings)
        #expect(conflict["status"] as? String == "conflict")
        #expect((conflict["settings"] as? [String: Any])?["stationCall"] as? String == "VK8FIRST")
        #expect(try load(second).settings["stationCall"] as? String == "VK8FIRST")
    }

    @Test("Exact replay and no-op saves are idempotent; reused IDs are rejected")
    func receiptsAndReplay() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let service = LiveLogbookMethods(supportDirectory: root)
        _ = try service.handle(method: "workspace_create", params: ["mode": "empty"])
        let base = try load(service)
        var changed = base.settings
        changed["stationCall"] = "VK8REPLAY"
        let operationID = UUID()
        let first = try save(service, operationID: operationID, expectedRevision: base.revision,
                             generation: base.generation, settings: changed)
        let replay = try save(service, operationID: operationID, expectedRevision: base.revision,
                              generation: base.generation, settings: changed)
        #expect(try equalJSON(first["receipt"]!, replay["receipt"]!))
        #expect((first["revision"] as? NSNumber)?.int64Value == base.revision + 1)

        let current = try load(service)
        let noOp = try save(service, operationID: UUID(), expectedRevision: current.revision,
                            generation: current.generation, settings: current.settings)
        #expect((noOp["revision"] as? NSNumber)?.int64Value == current.revision)

        var different = changed
        different["stationCall"] = "VK8REUSED"
        do {
            _ = try save(service, operationID: operationID, expectedRevision: base.revision,
                         generation: base.generation, settings: different)
            Issue.record("A reused operation ID with different settings was accepted")
        } catch let failure as WorkerFailure {
            #expect(failure.code == "settings_operation_reused")
        }
    }

    @Test("Restore rotates generation, scopes receipts and honors restore_settings")
    func restoreSemantics() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let service = LiveLogbookMethods(supportDirectory: root)
        _ = try service.handle(method: "workspace_create", params: ["mode": "empty"])
        var backupSettings = try load(service).settings
        backupSettings["stationCall"] = "VK8BACKUP"
        _ = try service.saveSettingsForTest(backupSettings)
        let created = try service.handle(method: "backup_create", params: ["name": "settings-safety"])
        let name = try #require(created["name"] as? String)

        var currentSettings = try load(service).settings
        currentSettings["stationCall"] = "VK8CURRENT"
        let currentOperation = UUID()
        let currentBase = try load(service)
        _ = try save(service, operationID: currentOperation, expectedRevision: currentBase.revision,
                     generation: currentBase.generation, settings: currentSettings)
        let oldGeneration = currentBase.generation

        _ = try service.handle(method: "backup_restore", params: [
            "name": name, "confirm_restore": true, "restore_settings": false,
        ])
        let retained = try load(service)
        #expect(retained.generation != oldGeneration)
        #expect(retained.settings["stationCall"] as? String == "VK8CURRENT")
        let staleReceipt = try service.handle(method: "settings_receipt", params: [
            "operationID": currentOperation.uuidString, "generation": oldGeneration,
        ])
        #expect(staleReceipt["status"] as? String == "workspace_changed")

        _ = try service.handle(method: "backup_restore", params: [
            "name": name, "confirm_restore": true, "restore_settings": true,
        ])
        let restored = try load(service)
        #expect(restored.generation != retained.generation)
        #expect(restored.settings["stationCall"] as? String == "VK8BACKUP")
    }

    @Test("A linked logbook cannot silently retarget its Wavelog identities")
    func linkedDestinationChangeIsBlocked() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let service = LiveLogbookMethods(supportDirectory: root)
        _ = try service.handle(method: "workspace_create", params: ["mode": "empty"])
        let database = try service.openedDatabase()
        try database.save(QSO(wavelogID: 42, call: "OM0RX", band: "20m", mode: "CW"), markDirty: false)
        let base = try load(service)
        var changed = base.settings
        changed["wavelogURL"] = "https://different.invalid"
        changed["wavelogStationID"] = 99
        do {
            _ = try save(service, operationID: UUID(), expectedRevision: base.revision,
                         generation: base.generation, settings: changed)
            Issue.record("A linked logbook changed Wavelog destination without migration")
        } catch let failure as WorkerFailure {
            #expect(failure.code == "sync_destination_change_blocked")
        }
        #expect(try load(service).settings["wavelogURL"] as? String == base.settings["wavelogURL"] as? String)
        #expect(try database.linkedRemoteCount() == 1)
    }
}

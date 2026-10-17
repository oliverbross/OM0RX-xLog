import Foundation
import Testing
@testable import XLogPrototypeSupport

@Suite("Shared rotor configuration safety")
struct RotorConfigurationSafetyTests {
    private let legacy: [String: Any] = [
        "owner": "native_dcu1",
        "native_dcu1": ["host": "rotor.example.invalid", "port": 4_001, "name": "Tower"],
        "hamlib": ["mode": "managed", "path": "", "baud": 9_600,
                   "host": "127.0.0.1", "port": 4_533, "serial": [:]],
    ]

    private func load(_ service: LiveLogbookMethods, legacy: [String: Any]? = nil) throws ->
        (configuration: [String: Any], revision: Int64, generation: String) {
        let response = try service.handle(method: "workspace_rotor_configuration_load",
            params: legacy.map { ["legacy": $0] } ?? [:])
        return (try #require(response["configuration"] as? [String: Any]),
                try #require((response["revision"] as? NSNumber)?.int64Value),
                try #require(response["generation"] as? String))
    }

    private func save(_ service: LiveLogbookMethods, _ base: (configuration: [String: Any], revision: Int64, generation: String),
                      configuration: [String: Any], operationID: UUID = UUID()) throws -> [String: Any] {
        try service.handle(method: "workspace_rotor_configuration_save", params: [
            "operationID": operationID.uuidString, "expectedRevision": base.revision,
            "generation": base.generation, "configuration": configuration,
        ])
    }

    @Test("Legacy migration is passive, one-time and revision checked")
    func migrationAndConflict() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let first = LiveLogbookMethods(supportDirectory: root)
        _ = try first.handle(method: "workspace_create", params: ["mode": "empty"])
        let initial = try load(first, legacy: legacy)
        #expect((initial.configuration["native_dcu1"] as? [String: Any])?["host"] as? String == "rotor.example.invalid")
        #expect(initial.configuration["auto_rotor_at_startup"] as? Bool == true)
        #expect(initial.configuration["auto_rotor_bands"] as? [String] ==
            ["160m", "80m", "60m", "40m", "30m", "20m", "17m", "15m", "12m", "10m", "6m", "2m", "70cm"])
        var ignored = legacy; ignored["owner"] = "hamlib"
        #expect(try load(first, legacy: ignored).configuration["owner"] as? String == "native_dcu1")

        let second = LiveLogbookMethods(supportDirectory: root)
        let stale = try load(second)
        var changed = initial.configuration; changed["owner"] = "hamlib"
        #expect(try save(first, initial, configuration: changed)["status"] as? String == "applied")
        var staleChange = stale.configuration
        var native = try #require(staleChange["native_dcu1"] as? [String: Any]); native["name"] = "Stale"
        staleChange["native_dcu1"] = native
        let conflict = try save(second, stale, configuration: staleChange)
        #expect(conflict["status"] as? String == "conflict")
        #expect(conflict["configuration"] as? [String: Any] != nil)
    }

    @Test("Exact replay has a receipt and reused IDs fail closed")
    func receipts() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let service = LiveLogbookMethods(supportDirectory: root)
        _ = try service.handle(method: "workspace_create", params: ["mode": "empty"])
        let base = try load(service, legacy: legacy), operationID = UUID()
        var changed = base.configuration; changed["owner"] = "hamlib"
        let first = try save(service, base, configuration: changed, operationID: operationID)
        let replay = try save(service, base, configuration: changed, operationID: operationID)
        #expect(first["status"] as? String == "applied")
        #expect((first["revision"] as? NSNumber)?.int64Value == base.revision + 1)
        #expect(first["receipt"] as? [String: Any] != nil)
        #expect(replay["receipt"] as? [String: Any] != nil)
        do {
            _ = try save(service, base, configuration: base.configuration, operationID: operationID)
            Issue.record("A reused rotor configuration operation ID was accepted")
        } catch let failure as WorkerFailure {
            #expect(failure.code == "rotor_configuration_operation_reused")
        }
    }

    @Test("Restore rotates generation and honors restore_settings without hardware methods")
    func restore() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let service = LiveLogbookMethods(supportDirectory: root)
        _ = try service.handle(method: "workspace_create", params: ["mode": "empty"])
        let backupBase = try load(service, legacy: legacy)
        var backupConfiguration = backupBase.configuration; backupConfiguration["owner"] = "hamlib"
        _ = try save(service, backupBase, configuration: backupConfiguration)
        let created = try service.handle(method: "backup_create", params: ["name": "rotor-safety"])
        let name = try #require(created["name"] as? String)

        let currentBase = try load(service)
        var current = currentBase.configuration
        var native = try #require(current["native_dcu1"] as? [String: Any]); native["name"] = "Current"
        current["native_dcu1"] = native; current["owner"] = "native_dcu1"
        _ = try save(service, currentBase, configuration: current)
        _ = try service.handle(method: "backup_restore", params: [
            "name": name, "confirm_restore": true, "restore_settings": false,
        ])
        let retained = try load(service)
        #expect((retained.configuration["native_dcu1"] as? [String: Any])?["name"] as? String == "Current")
        #expect(retained.generation != currentBase.generation)

        _ = try service.handle(method: "backup_restore", params: [
            "name": name, "confirm_restore": true, "restore_settings": true,
        ])
        let restored = try load(service)
        #expect(restored.configuration["owner"] as? String == "hamlib")
        #expect(restored.generation != retained.generation)
    }

    @Test("Unknown command-shaped fields are rejected at the typed configuration boundary")
    func exactShape() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let service = LiveLogbookMethods(supportDirectory: root)
        _ = try service.handle(method: "workspace_create", params: ["mode": "empty"])
        var unsafe = legacy; unsafe["goto"] = 90
        do {
            _ = try service.handle(method: "workspace_rotor_configuration_load", params: ["legacy": unsafe])
            Issue.record("An unknown rotor command field crossed the configuration boundary")
        } catch let failure as WorkerFailure {
            #expect(failure.code == "invalid_params")
        }
    }
}

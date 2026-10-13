import Foundation
import Testing
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif
@testable import XLogPrototypeSupport

@Suite("Live logbook isolated workspace")
struct LiveLogbookMethodsTests {
    @Test("Fresh workspace is local and mode changes are explicit without clearing its outbox")
    func standaloneModePersistence() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let service = LiveLogbookMethods(supportDirectory: root)
        _ = try service.handle(method: "workspace_create", params: ["mode": "empty"])
        var settings = try #require(service.handle(method: "settings_load", params: [:])["settings"] as? [String: Any])
        #expect(settings["logbookMode"] as? String == "local")
        #expect(settings["automaticSync"] as? Bool == false)
        let db = try service.openedDatabase()
        let qso = QSO(call: "K1ABC", start: Date(timeIntervalSince1970: 1_790_000_000), band: "20m", mode: "CW")
        try db.save(qso)
        let pending = try db.pendingSyncCount()

        var missingMode = settings
        missingMode.removeValue(forKey: "logbookMode")
        #expect(throws: WorkerFailure.self) {
            try service.handle(method: "settings_save", params: ["settings": missingMode])
        }
        #expect(try service.currentSettings().logbookMode == .local)
        settings["logbookMode"] = "wavelog"
        let saved = try service.handle(method: "settings_save", params: ["settings": settings])
        #expect((saved["settings"] as? [String: Any])?["logbookMode"] as? String == "wavelog")
        #expect((saved["settings"] as? [String: Any])?["automaticSync"] as? Bool == false)
        #expect(try db.pendingSyncCount() == pending)
        #expect(try service.currentSettings().logbookMode == .wavelog)

        settings["logbookMode"] = "local"
        try service.beginManualSync()
        #expect(throws: WorkerFailure.self) {
            try service.handle(method: "settings_save", params: ["settings": settings])
        }
        service.endManualSync()
        #expect(try service.currentSettings().logbookMode == .wavelog)
        _ = try service.handle(method: "settings_save", params: ["settings": settings])
        #expect(try service.currentSettings().logbookMode == .local)
        #expect(try db.pendingSyncCount() == pending)
    }

    @Test("CTY resolver is reused until the disposable reference file changes")
    func ctyResolverSourceIdentity() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let service = LiveLogbookMethods(supportDirectory: root)
        _ = try service.handle(method: "workspace_create", params: ["mode": "empty"])
        let bundled = try service.currentCTYResolver()
        let bundledAgain = try service.currentCTYResolver()
        #expect(bundled === bundledAgain)

        let reference = try service.referenceDirectoryURL().appendingPathComponent("cty.xml")
        try Data("<cty><prefix><call>ZZ1</call><adif>990</adif><cqz>1</cqz><entity>Fixture A</entity></prefix></cty>".utf8)
            .write(to: reference)
        let first = try service.currentCTYResolver()
        #expect(first !== bundled)
        let firstAgain = try service.currentCTYResolver()
        #expect(first === firstAgain)
        #expect(first.resolve("ZZ1ABC")?.name == "FIXTURE A")

        try Data("<cty><prefix><call>ZZ1</call><adif>991</adif><cqz>1</cqz><entity>Fixture Changed</entity></prefix></cty>".utf8)
            .write(to: reference, options: .atomic)
        let updated = try service.currentCTYResolver()
        #expect(updated !== first)
        #expect(updated.resolve("ZZ1ABC")?.adif == 991)
    }

    @Test("DXCC map statuses reflect confirmations and deletion without manufacturing credits")
    func mapStatuses() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let service = LiveLogbookMethods(supportDirectory: root)
        _ = try service.handle(method: "workspace_create", params: ["mode": "empty"])
        var qso = try #require(service.handle(method: "logbook_draft", params: [:])["qso"] as? [String: Any])
        qso["call"] = "K1ABC"; qso["dxcc"] = 291; qso["qslReceived"] = "N"
        _ = try service.handle(method: "logbook_save", params: ["qso": qso])
        #expect((try service.handle(method: "logbook_stats", params: [:])["dxcc_statuses"] as? [String: String])?["291"] == "worked")
        qso["lotwReceived"] = "Y"
        _ = try service.handle(method: "logbook_save", params: ["qso": qso])
        #expect((try service.handle(method: "logbook_stats", params: [:])["dxcc_statuses"] as? [String: String])?["291"] == "confirmed")
        _ = try service.handle(method: "logbook_delete", params: ["id": qso["id"]!])
        #expect((try service.handle(method: "logbook_stats", params: [:])["dxcc_statuses"] as? [String: String])?["291"] == "needed")
    }
    @Test("Award catalogue search and delivery filters operate before pagination")
    func catalogueFilters() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let service = LiveLogbookMethods(supportDirectory: root)
        _ = try service.handle(method: "workspace_create", params: ["mode": "empty"])
        let all = try service.handle(method: "logbook_catalog", params: [:])
        #expect(all["total_programmes"] as? Int == 192)
        let subset = try service.handle(method: "logbook_catalog", params: ["search": "Japan", "delivery_state": "implemented", "limit": 1])
        #expect((subset["total_programmes"] as? Int ?? 0) > 1)
        #expect((subset["programmes"] as? [[String: Any]])?.count == 1)
        let empty = try service.handle(method: "logbook_catalog", params: ["search": "no such programme xyz"])
        #expect(empty["total_programmes"] as? Int == 0)
        let global = try service.handle(method: "logbook_catalog", params: ["catalogue_group": "global", "limit": 25])
        let programmes = try #require(global["programmes"] as? [[String: Any]])
        #expect(!programmes.isEmpty)
        #expect(programmes.allSatisfy { $0["catalogue_group"] as? String == "global" })
        #expect(programmes.allSatisfy { ($0["name"] as? String)?.isEmpty == false })
        #expect(programmes.allSatisfy { $0["research_sections"] != nil && $0["official_sources"] != nil })
        let stats = try service.handle(method: "logbook_stats", params: [:])
        let awards = try #require(stats["awards"] as? [String: Any])
        #expect((awards["achievements"] as? [[String: Any]])?.isEmpty == false)
    }
    @Test("Empty workspace saves full QSO, searches, deletes, undoes and reopens")
    func lifecycle() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let service = LiveLogbookMethods(supportDirectory: root)
        let before = try service.handle(method: "workspace_status", params: [:])
        #expect(before["workspace_exists"] as? Bool == false)
        _ = try service.handle(method: "workspace_create", params: ["mode": "empty"])

        let draftResponse = try service.handle(method: "logbook_draft", params: [:])
        var draft = try #require(draftResponse["qso"] as? [String: Any])
        draft["call"] = "VK4JAZ"
        draft["name"] = "Alice"
        draft["comment"] = "full-field preservation"
        draft["frequencyHz"] = 14_025_000
        let saved = try service.handle(method: "logbook_save", params: ["qso": draft])
        let qso = try #require(saved["qso"] as? [String: Any])
        let id = try #require(qso["id"] as? String)
        #expect(qso["comment"] as? String == "full-field preservation")
        #expect(qso["frequencyHz"] as? Int == 14_025_000)

        let page = try service.handle(method: "logbook_list", params: ["search": "VK4JAZ", "limit": 20, "offset": 0])
        #expect(page["total"] as? Int == 1)
        #expect((page["qsos"] as? [[String: Any]])?.first?["id"] as? String == id)
        let stats = try service.handle(method: "logbook_stats", params: [:])
        #expect((stats["stats"] as? [String: Any])?["qso_count"] as? Int == 1)

        _ = try service.handle(method: "logbook_delete", params: ["id": id])
        #expect(try service.handle(method: "logbook_list", params: [:])["total"] as? Int == 0)
        _ = try service.handle(method: "logbook_undo", params: ["id": id])
        #expect(try service.handle(method: "logbook_list", params: [:])["total"] as? Int == 1)

        let reopened = LiveLogbookMethods(supportDirectory: root)
        let status = try reopened.handle(method: "workspace_status", params: [:])
        #expect(status["workspace_exists"] as? Bool == true)
        #expect(status["qso_count"] as? Int == 1)
        let settings = try reopened.handle(method: "settings_load", params: [:])
        #expect(settings["automatic_sync"] as? Bool == false)
    }

    @Test("Invalid QSO never saves; ADIF import skips semantic duplicates")
    func validationAndImport() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let service = LiveLogbookMethods(supportDirectory: root)
        _ = try service.handle(method: "workspace_create", params: ["mode": "empty"])
        let draftResponse = try service.handle(method: "logbook_draft", params: [:])
        var draft = try #require(draftResponse["qso"] as? [String: Any])
        draft["call"] = "not a call!"
        #expect(throws: WorkerFailure.self) {
            try service.handle(method: "logbook_save", params: ["qso": draft])
        }
        #expect(try service.handle(method: "logbook_list", params: [:])["total"] as? Int == 0)
        draft["call"] = "VK4JAZ"
        draft["frequencyHz"] = -1
        #expect(throws: WorkerFailure.self) {
            try service.handle(method: "logbook_save", params: ["qso": draft])
        }
        #expect(try service.handle(method: "logbook_list", params: [:])["total"] as? Int == 0)

        let malformedFrequency = "<CALL:6>VK4JAZ<QSO_DATE:8>20261012<TIME_ON:6>120000<BAND:3>20m<MODE:2>CW<FREQ:3>bad<EOR>"
        #expect(throws: WorkerFailure.self) {
            try service.handle(method: "logbook_import_adif", params: ["text": malformedFrequency])
        }
        #expect(try service.handle(method: "logbook_list", params: [:])["total"] as? Int == 0)

        let record = "<CALL:6>VK4JAZ<QSO_DATE:8>20261012<TIME_ON:6>120000<BAND:3>20m<MODE:2>CW<COMMENT:11>full record<EOR>"
        let imported = try service.handle(method: "logbook_import_adif", params: ["text": record + record])
        #expect(imported["imported"] as? Int == 1)
        #expect(imported["skipped_duplicates"] as? Int == 1)
        let exported = try service.handle(method: "logbook_export_adif", params: ["limit": 20, "offset": 0])
        #expect((exported["text"] as? String)?.contains("full record") == true)
        #expect(try service.handle(method: "logbook_list", params: [:])["total"] as? Int == 1)
    }

    @Test("Copy mode snapshots native fixture including pending outbox without writing it")
    func copiedNativeFixture() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let nativeURL = root.appendingPathComponent("OM0RX-xLog/OM0RX-xLog.sqlite")
        let native = try LogbookDatabase(url: nativeURL)
        let qso = QSO(call: "VK4JAZ", start: Date(timeIntervalSince1970: 1_700_000_000), band: "20m", mode: "CW")
        try native.save(qso)
        try native.recordSyncFailure(localID: qso.id, message: "offline")
        let service = LiveLogbookMethods(supportDirectory: root)
        let created = try service.handle(method: "workspace_create", params: ["mode": "copy_native"])
        #expect(created["qso_count"] as? Int == 1)
        #expect(created["pending_sync_count"] as? Int == 1)
        #expect(created["outbox_count"] as? Int == 1)
        #expect(created["automatic_sync"] as? Bool == false)
        #expect(try service.currentSettings().logbookMode == .local)
        #expect(try native.pendingSyncCount() == 1)
        #expect(try native.outboxCount() == 1)
        let status = try service.handle(method: "workspace_status", params: [:])
        #expect(status["native_log_exists"] as? Bool == true)
        #expect(status["outbox_count"] as? Int == 1)
        _ = try service.handle(method: "logbook_delete", params: ["id": qso.id.uuidString])
        #expect(try native.fetch().count == 1)
    }

    @Test("A hard-linked database cannot be reopened as the isolated workspace")
    func rejectsHardLinkAlias() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let nativeURL = root.appendingPathComponent("OM0RX-xLog/OM0RX-xLog.sqlite")
        let native = try LogbookDatabase(url: nativeURL)
        native.close()
        let workspace = try IntegrationWorkspaceBootstrap.createEmpty(
            at: root.appendingPathComponent("OM0RX-xLog-Integrated Preview")
        )
        try FileManager.default.removeItem(at: workspace.databaseURL)
        try FileManager.default.linkItem(at: nativeURL, to: workspace.databaseURL)
        let service = LiveLogbookMethods(supportDirectory: root)
        #expect(throws: WorkerFailure.self) {
            try service.handle(method: "workspace_status", params: [:])
        }
    }

    @Test("Verified backup restores only the isolated copy and retains a recovery snapshot")
    func backupRestore() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let nativeURL = root.appendingPathComponent("OM0RX-xLog/OM0RX-xLog.sqlite")
        let native = try LogbookDatabase(url: nativeURL)
        try native.save(QSO(call: "K1NAT", band: "20m", mode: "CW"))
        let service = LiveLogbookMethods(supportDirectory: root)
        _ = try service.handle(method: "workspace_create", params: ["mode": "copy_native"])
        let created = try service.handle(method: "backup_create", params: ["name": "before-change"])
        let name = try #require(created["name"] as? String)
        #expect(name == "before-change.xlogbackup")
        let listed = try service.handle(method: "backup_list", params: [:])
        #expect((listed["backups"] as? [[String: String]])?.contains(where: { $0["name"] == name }) == true)
        let inspected = try service.handle(method: "backup_inspect", params: ["name": name])
        #expect((inspected["manifest"] as? [String: Any])?["qsoCount"] as? Int == 1)

        var currentPreferences = try #require(service.handle(method: "workspace_preferences_load", params: [:])["preferences"] as? [String: Any])
        currentPreferences["deskBandMapBands"] = ["40m"]
        _ = try saveWorkspacePreferences(service, currentPreferences)

        var draft = try #require(service.handle(method: "logbook_draft", params: [:])["qso"] as? [String: Any])
        draft["call"] = "K2NEW"
        _ = try service.handle(method: "logbook_save", params: ["qso": draft])
        #expect(try service.handle(method: "logbook_list", params: [:])["total"] as? Int == 2)
        #expect(throws: WorkerFailure.self) {
            try service.handle(method: "backup_restore", params: ["name": name, "confirm_restore": false])
        }
        #expect(try service.handle(method: "logbook_list", params: [:])["total"] as? Int == 2)

        let restored = try service.handle(method: "backup_restore", params: [
            "name": name, "confirm_restore": true,
            "restore_settings": false, "restore_reference_data": false,
        ])
        #expect(restored["qso_count"] as? Int == 1)
        #expect(restored["automatic_sync"] as? Bool == false)
        #expect(restored["preferences_restored"] as? Bool == false)
        #expect((try service.handle(method: "workspace_preferences_load", params: [:])["preferences"] as? [String: Any])?["deskBandMapBands"] as? [String] == ["40m"])
        let recoveryName = try #require(restored["recovery_backup"] as? String)
        let recovery = root.appendingPathComponent("OM0RX-xLog-Integrated Preview/Recovery/" + recoveryName)
        #expect(try XLogBackupManager().inspect(at: recovery).manifest.qsoCount == 2)
        #expect(try native.fetch().count == 1)
        #expect(try service.handle(method: "logbook_list", params: [:])["total"] as? Int == 1)
        #expect(throws: WorkerFailure.self) {
            try service.handle(method: "backup_inspect", params: ["name": "../" + name])
        }
    }

    @Test("Workspace preferences are explicit, backed up and restored only on request")
    func backupPreferences() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let service = LiveLogbookMethods(supportDirectory: root)
        _ = try service.handle(method: "workspace_create", params: ["mode": "empty"])
        let keychainService = try service.currentKeychainService()
        var original = try #require(service.handle(method: "workspace_preferences_load", params: [:])["preferences"] as? [String: Any])
        #expect(original["detachedBandMapModes"] as? [String] == ["cw", "data", "phone"])
        original["deskBandMapBands"] = ["40m", "20m"]
        original["detachedBandMapBands"] = ["17m"]
        original["deskBandMapFollowsRadio"] = false
        original["detachedBandMapLayout"] = "Single row"
        original["bandMapFontScale"] = 1.5
        original["detachedBandMapModes"] = ["cw", "phone"]
        _ = try saveWorkspacePreferences(service, original)
        let created = try service.handle(method: "backup_create", params: ["name": "preferences"])
        let name = try #require(created["name"] as? String)
        let package = root.appendingPathComponent("OM0RX-xLog-Integrated Preview/Backups/" + name)
        let backedUp = try #require(XLogBackupManager().inspect(at: package).preferences)
        #expect(backedUp.deskBandMapBands == ["40m", "20m"])
        #expect(backedUp.detachedBandMapLayout == "Single row")
        #expect(backedUp.detachedBandMapModes == ["cw", "phone"])

        var changed = original
        changed["deskBandMapBands"] = ["10m"]
        changed["detachedBandMapModes"] = []
        _ = try saveWorkspacePreferences(service, changed)
        let retained = try #require(service.handle(method: "workspace_preferences_load", params: [:])["preferences"] as? [String: Any])
        #expect(retained["deskBandMapBands"] as? [String] == ["10m"])
        _ = try service.handle(method: "backup_restore", params: [
            "name": name, "confirm_restore": true, "restore_preferences": true,
        ])
        #expect(try service.handle(method: "settings_load", params: [:])["automatic_sync"] as? Bool == false)
        #expect(try service.currentKeychainService() == keychainService)
        let restored = try #require(service.handle(method: "workspace_preferences_load", params: [:])["preferences"] as? [String: Any])
        #expect(restored["deskBandMapBands"] as? [String] == ["40m", "20m"])
        #expect(restored["bandMapFontScale"] as? Double == 1.5)
        #expect(restored["detachedBandMapModes"] as? [String] == ["cw", "phone"])
        var invalid = restored
        invalid["deskBandMapBands"] = ["bogus"]
        #expect(throws: WorkerFailure.self) {
            try saveWorkspacePreferences(service, invalid)
        }
        #expect((try service.handle(method: "workspace_preferences_load", params: [:])["preferences"] as? [String: Any])?["deskBandMapBands"] as? [String] == ["40m", "20m"])
        invalid = restored
        invalid["detachedBandMapModes"] = ["cw", "cw"]
        #expect(throws: WorkerFailure.self) {
            try saveWorkspacePreferences(service, invalid)
        }
    }

    @Test("External xLog backup import verifies and copies before a separate restore decision")
    func externalBackupImport() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let sourceDBURL = root.appendingPathComponent("Source/source.sqlite")
        let sourceDB = try LogbookDatabase(url: sourceDBURL)
        try sourceDB.save(QSO(call: "K1EXT", band: "20m", mode: "CW"))
        let source = root.appendingPathComponent("External/Native.xlogbackup")
        let prefs = XLogBackupPreferences(deskBandMapBands: ["20m"], detachedBandMapBands: ["40m"],
                                          deskBandMapFollowsRadio: false, detachedBandMapLayout: "Single row",
                                          bandMapFontScale: 1, intelligenceBands: ["20m"],
                                          clusterSpotOpensFullEditor: false)
        _ = try XLogBackupManager().create(database: sourceDB, at: source,
                                           settings: .defaults, preferences: prefs)
        let service = LiveLogbookMethods(supportDirectory: root)
        _ = try service.handle(method: "workspace_create", params: ["mode": "empty"])
        let imported = try service.handle(method: "backup_import", params: ["source_path": source.path])
        let name = try #require(imported["name"] as? String)
        #expect(name.hasSuffix(".xlogbackup"))
        #expect((imported["manifest"] as? [String: Any])?["qsoCount"] as? Int == 1)
        #expect(imported["includes_preferences"] as? Bool == true)
        #expect(try service.handle(method: "logbook_list", params: [:])["total"] as? Int == 0)
        #expect((try service.handle(method: "backup_inspect", params: ["name": name])["manifest"] as? [String: Any])?["qsoCount"] as? Int == 1)
        let second = try service.handle(method: "backup_import", params: ["source_path": source.path])
        let secondName = try #require(second["name"] as? String)
        #expect(secondName != name)
        #expect((try service.handle(method: "backup_inspect", params: ["name": name])["manifest"] as? [String: Any])?["qsoCount"] as? Int == 1)
        #expect(throws: WorkerFailure.self) {
            try service.handle(method: "backup_import", params: ["source_path": root.path + "/External/../External/Native.xlogbackup"])
        }
        #expect(throws: WorkerFailure.self) {
            try service.handle(method: "backup_import", params: ["source_path": root.path])
        }
        let linked = root.appendingPathComponent("External/Linked.xlogbackup")
        try FileManager.default.createSymbolicLink(at: linked, withDestinationURL: source)
        #expect(throws: WorkerFailure.self) {
            try service.handle(method: "backup_import", params: ["source_path": linked.path])
        }
        let tampered = root.appendingPathComponent("External/Tampered.xlogbackup")
        try FileManager.default.copyItem(at: source, to: tampered)
        try FileManager.default.createSymbolicLink(at: tampered.appendingPathComponent("extra"), withDestinationURL: sourceDBURL)
        #expect(throws: WorkerFailure.self) {
            try service.handle(method: "backup_import", params: ["source_path": tampered.path])
        }
        let malformed = root.appendingPathComponent("External/Malformed.xlogbackup")
        try FileManager.default.createDirectory(at: malformed, withIntermediateDirectories: true)
        #expect(throws: XLogBackupError.self) {
            try service.handle(method: "backup_import", params: ["source_path": malformed.path])
        }
    }

    #if os(macOS)
    @Test("Reference status reads only the isolated cache without a refresh")
    func referenceStatus() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let service = LiveLogbookMethods(supportDirectory: root)
        _ = try service.handle(method: "workspace_create", params: ["mode": "empty"])
        let reference = LiveReferenceMethods(logbook: service)
        let status = try await reference.handle(method: "reference_status", params: [:])
        #expect(status["running"] as? Bool == false)
        #expect(status["cty_source"] as? String == "bundled")
        #expect(try service.currentKeychainService().hasPrefix("com.oliverbross.OM0RXXLog.Integration."))
    }

    @Test("Backup and reference paths reject symbolic-link redirection")
    func rejectsDataPathLinks() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let service = LiveLogbookMethods(supportDirectory: root)
        _ = try service.handle(method: "workspace_create", params: ["mode": "empty"])
        let workspace = root.appendingPathComponent("OM0RX-xLog-Integrated Preview")
        let backups = workspace.appendingPathComponent("Backups")
        try FileManager.default.createSymbolicLink(at: backups, withDestinationURL: root)
        #expect(throws: WorkerFailure.self) {
            try service.handle(method: "backup_list", params: [:])
        }
        try FileManager.default.removeItem(at: backups)
        let reference = workspace.appendingPathComponent("Reference Data")
        try FileManager.default.createSymbolicLink(at: reference, withDestinationURL: root)
        let actor = LiveReferenceMethods(logbook: service)
        await #expect(throws: WorkerFailure.self) {
            try await actor.handle(method: "reference_status", params: [:])
        }
        try FileManager.default.removeItem(at: reference)
        try FileManager.default.createDirectory(at: reference, withIntermediateDirectories: false)
        try FileManager.default.createSymbolicLink(
            at: reference.appendingPathComponent("cty.xml"),
            withDestinationURL: root.appendingPathComponent("unrelated.xml")
        )
        await #expect(throws: WorkerFailure.self) {
            try await actor.handle(method: "reference_status", params: [:])
        }
    }
    #endif

}

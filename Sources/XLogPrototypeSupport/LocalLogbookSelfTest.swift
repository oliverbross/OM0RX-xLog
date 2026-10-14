import Foundation
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif

/// Runs the shipping local handlers against a disposable workspace. No native
/// database, network service, credential store, or hardware transport is opened.
/// Packaged acceptance invokes this after removal of the build environment.
public enum LocalLogbookSelfTest {
    public static func run() throws -> [String: Any] {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-local-test-\(UUID().uuidString)")
        let service = LiveLogbookMethods(supportDirectory: root)
        defer { try? FileManager.default.removeItem(at: root) }
        _ = try service.handle(method: "workspace_create", params: ["mode": "empty"])
        let workspace = try IntegrationWorkspaceBootstrap.open(at: service.workspaceDirectoryURL)
        defer {
            try? service.openedDatabase().close()
            workspace.makeDefaults()?.removePersistentDomain(forName: workspace.defaultsSuiteName)
        }
        func check(_ condition: Bool) throws {
            guard condition else { throw WorkerFailure("local_self_test_failed", "A local logbook acceptance check failed.") }
        }
        var settings = try service.handle(method: "settings_load", params: [:])["settings"] as? [String: Any] ?? [:]
        try check(settings["logbookMode"] as? String == "local" && settings["automaticSync"] as? Bool == false)
        settings["stationLocation"] = "Synthetic local acceptance"
        let loadedSettings = try service.handle(method: "settings_load", params: [:])
        guard let generation = loadedSettings["generation"] as? String,
              let revision = (loadedSettings["revision"] as? NSNumber)?.int64Value else {
            throw WorkerFailure("local_self_test_failed", "Revisioned settings snapshot unavailable.")
        }
        _ = try service.handle(method: "settings_save", params: [
            "operationID": UUID().uuidString, "expectedRevision": revision,
            "generation": generation, "settings": settings,
        ])
        let adif = "<CALL:5>K1ABC<QSO_DATE:8>20261001<TIME_ON:6>120000<BAND:3>20m<MODE:2>CW<DXCC:3>291<QSL_RCVD:1>Y<APP_FIXTURE:4>KEPT<EOR>"
        try check(try service.handle(method: "logbook_import_adif", params: ["text": adif])["imported"] as? Int == 1)
        let rows = try service.handle(method: "logbook_list", params: ["search": "K1ABC"])["qsos"] as? [[String: Any]] ?? []
        guard var qso = rows.first, let id = qso["id"] as? String else {
            throw WorkerFailure("local_self_test_failed", "Local import was not readable.")
        }
        qso["comment"] = "Edited locally"
        _ = try service.handle(method: "logbook_save", params: ["qso": qso])
        let stats = try service.handle(method: "logbook_stats", params: [:])
        try check((stats["stats"] as? [String: Any])?["qso_count"] as? Int == 1)
        try check((stats["dxcc_statuses"] as? [String: String])?["291"] == "confirmed")
        let catalog = try service.handle(method: "logbook_catalog", params: [:])
        try check(catalog["total_programmes"] as? Int == 192)
        try check(try service.currentCTYResolver().resolve("K1ABC")?.adif == 291)
        let backup = try service.handle(method: "backup_create", params: ["name": "round-trip"])
        _ = try service.handle(method: "logbook_delete", params: ["id": id])
        try check(try service.handle(method: "logbook_list", params: [:])["total"] as? Int == 0)
        _ = try service.handle(method: "logbook_undo", params: ["id": id])
        try check(try service.handle(method: "logbook_list", params: [:])["total"] as? Int == 1)
        _ = try service.handle(method: "logbook_delete", params: ["id": id])
        _ = try service.handle(method: "backup_restore", params: ["name": backup["name"]!, "confirm_restore": true])
        try service.openedDatabase().close()
        let reopened = LiveLogbookMethods(supportDirectory: root)
        defer { try? reopened.openedDatabase().close() }
        try check(try reopened.currentSettings().stationLocation == "Synthetic local acceptance")
        let exported = try reopened.handle(method: "logbook_export_adif", params: [:])["text"] as? String ?? ""
        try check(exported.contains("<APP_FIXTURE:4>KEPT") && exported.contains("Edited locally"))
        return ["passed": true, "synthetic_records": true, "local_file_io": true,
                "network_contact": false, "station_io": false, "credentials_accessed": false,
                "qso_count": 1, "award_programmes": 192,
                "checks": ["workspace", "settings", "adif_unknown_fields", "save_search", "cty_resources",
                           "awards_resources", "delete_undo", "backup_restore", "reopen_export"]]
    }
}

import Foundation
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif

/// Opt-in packaged UI acceptance uses the shipping logbook handlers, but never
/// the operator's paths or any network, credential or station service. No caller
/// can nominate an existing directory as the disposable workspace.
public final class LocalAcceptanceSession: @unchecked Sendable {
    public let worker: LiveWorker
    let directory: URL
    private let service: LiveLogbookMethods

    public init() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("xlog-ui-acceptance-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false,
                                                attributes: LocalFilePermissions.directoryAttributes)
        directory = root
        service = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        // The archive is generated here, never nominated by the caller and
        // never copied from a real station. Close and reopen through the normal
        // worker path to exercise packaged SQLite persistence, not a UI mock.
        let clusterDirectory = root.appendingPathComponent("Cluster", isDirectory: true)
        do { try Self.seedSpotHistory(at: clusterDirectory.appendingPathComponent("spot-history.sqlite")) }
        catch {
            // Only this freshly generated private directory is eligible for
            // cleanup; callers cannot supply a path or existing archive.
            try? FileManager.default.removeItem(at: root)
            throw error
        }
        let cluster = LiveClusterMethods(logbook: service,
            configurationURL: clusterDirectory.appendingPathComponent("cluster.json"))
        worker = LiveWorker(logbook: service, localAcceptance: true, cluster: cluster)
    }

    private static func seedSpotHistory(at url: URL) throws {
        let database = try SpotHistoryDatabase(url: url)
        defer { database.close() }
        let session = UUID(), source = UUID(), base = Date().addingTimeInterval(-600)
        let rows = (0..<137).map { index in
            let call = index.isMultiple(of: 2) ? "TESTH0" : "TESTH1"
            let comment = "Synthetic acceptance <not-markup> Ω report \(index)"
            return SpotHistoryObservation(sessionID: session, sequence: Int64(index + 1), clusterID: source,
                clusterName: "Isolated fixture", clusterHost: "fixture.invalid", arrivedAt: base.addingTimeInterval(Double(index)),
                rawLine: "DX de TESTSPOT: 14025.0 \(call) \(comment)", callsign: call, spotter: "TESTSPOT",
                frequencyKHz: 14025, frequencyText: "14025.0", band: "20m", mode: "CW", source: "fixture",
                country: "Synthetic", comment: comment, classificationJSON: "{\"fixture\":true}")
        }
        _ = try database.append(Array(rows.prefix(100)))
        _ = try database.append(Array(rows.dropFirst(100)))
    }

    // Explicit allowlist: newly added services must not silently become callable
    // by a synthetic UI acceptance run. In particular, do not import external
    // backups or copy a native logbook even though those are local operations.
    static func validate(method: String, params: [String: Any]) throws {
        let methods: Set<String> = [
            "health", "parse_adif", "self_test", "integration_self_test", "cluster_classify", "cluster_history",
            "workspace_status", "workspace_create", "workspace_preferences_load", "workspace_preferences_save",
            "workspace_layout_load", "workspace_layout_apply",
            "workspace_map_context", "workspace_band_map_apply",
            "operating_goals_evaluate",
            "spot_history_status", "spot_history_query", "spot_history_stats", "spot_history_detail",
            "settings_load", "settings_receipt", "settings_save", "logbook_draft", "logbook_catalog", "logbook_list",
            "workspace_rotor_configuration_load", "workspace_rotor_configuration_receipt", "workspace_rotor_configuration_save",
            "logbook_save", "logbook_delete", "logbook_undo", "logbook_stats", "logbook_previous", "logbook_duplicate",
            "logbook_operator_draft", "logbook_operator_draft_apply", "logbook_operator_draft_receipt",
            "logbook_contact", "logbook_contact_apply", "logbook_contact_receipt",
            "logbook_matrix", "logbook_import_adif", "logbook_export_adif",
            "backup_create", "backup_list", "backup_inspect", "backup_restore",
        ]
        guard methods.contains(method),
              method != "workspace_create" || params["mode"] as? String == "empty" else {
            throw WorkerFailure("acceptance_restricted", "Local acceptance cannot access external data, services, credentials or hardware.")
        }
    }

    /// The process must drain all admitted requests before calling close.
    public func close() async throws {
        await worker.shutdown()
        let workspace = try? IntegrationWorkspaceBootstrap.open(at: service.workspaceDirectoryURL)
        if let workspace {
            try service.openedDatabase().close()
            workspace.makeDefaults()?.removePersistentDomain(forName: workspace.defaultsSuiteName)
        }
        if FileManager.default.fileExists(atPath: directory.path) {
            try FileManager.default.removeItem(at: directory)
        }
    }
}

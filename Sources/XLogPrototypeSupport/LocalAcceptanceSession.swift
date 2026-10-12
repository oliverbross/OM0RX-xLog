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
        service = LiveLogbookMethods(supportDirectory: root)
        worker = LiveWorker(logbook: service, localAcceptance: true)
    }

    // Explicit allowlist: newly added services must not silently become callable
    // by a synthetic UI acceptance run. In particular, do not import external
    // backups or copy a native logbook even though those are local operations.
    static func validate(method: String, params: [String: Any]) throws {
        let methods: Set<String> = [
            "health", "parse_adif", "self_test", "integration_self_test", "cluster_classify",
            "workspace_status", "workspace_create", "workspace_preferences_load", "workspace_preferences_save",
            "settings_load", "settings_save", "logbook_draft", "logbook_catalog", "logbook_list",
            "logbook_save", "logbook_delete", "logbook_undo", "logbook_stats", "logbook_previous",
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

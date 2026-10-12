#if os(macOS)
import Foundation
import XLogCore

/// Explicit refresh of the integrated workspace's own reference cache.
/// Nothing starts at app launch, and the native xLog cache is never opened.
actor LiveReferenceMethods {
    static let shared = LiveReferenceMethods()

    private let logbook: LiveLogbookMethods
    private let session: URLSession
    private var refreshTask: Task<Void, Never>?
    private var lastResult = "Not refreshed in this session"

    init(logbook: LiveLogbookMethods = .shared, session: URLSession = .shared) {
        self.logbook = logbook
        self.session = session
    }

    func handle(method: String, params: [String: Any]) async throws -> [String: Any] {
        let directory = try logbook.referenceDirectoryURL()
        switch method {
        case "reference_status":
            guard params.isEmpty else { throw invalid() }
            _ = try logbook.openedDatabase()
            let updater = try ReferenceDataUpdater(directory: directory, session: session)
            let state = await updater.currentState()
            return try status(state, directory: directory)
        case "reference_refresh":
            guard Set(params.keys) == ["source"], let source = params["source"] as? String,
                  ["clublog_lotw", "activations", "wavelog_catalog"].contains(source) else { throw invalid() }
            _ = try logbook.openedDatabase()
            guard refreshTask == nil else { throw WorkerFailure("reference_busy", "A reference update is already running.") }
            let settings = try logbook.currentSettings()
            let updater = try ReferenceDataUpdater(directory: directory, session: session)
            let secrets = SecretStore(service: try logbook.currentKeychainService())
            let clubKey = try secrets.load(.clubLogAPIKey) ?? ""
            let token = try secrets.load(.wavelogToken) ?? ""
            guard source != "wavelog_catalog" || !token.isEmpty else {
                throw WorkerFailure("reference_configuration_required", "Save an integrated Wavelog token before refreshing its catalog.")
            }
            guard let clubURL = URL(string: settings.clubLogCTYURL),
                  let lotwURL = URL(string: settings.lotwActivityURL),
                  let wavelogURL = URL(string: settings.wavelogURL) else { throw invalid() }
            lastResult = "Updating \(source)"
            refreshTask = Task {
                do {
                    switch source {
                    case "clublog_lotw":
                        _ = try await updater.refresh(clubLogURL: clubURL, clubLogAPIKey: clubKey, lotwURL: lotwURL)
                    case "activations":
                        _ = try await updater.refreshActivationDirectories()
                    default:
                        _ = try await updater.refreshWavelogCatalog(baseURL: wavelogURL, token: token)
                    }
                    self.finish("Updated \(source)")
                } catch {
                    self.finish("Update failed; refresh the cache status before retrying. Earlier sources may have updated.")
                }
            }
            return ["running": true, "status": lastResult, "source": source]
        default:
            throw WorkerFailure("method_not_allowed", "Unknown reference-data operation.")
        }
    }

    private func status(_ state: ReferenceDataState, directory: URL) throws -> [String: Any] {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let stateJSON = try JSONSerialization.jsonObject(with: encoder.encode(state))
        let downloaded = directory.appendingPathComponent("cty.xml")
        let usingDownloadedCTY = FileManager.default.fileExists(atPath: downloaded.path)
            && (try? CTYResolver(xmlURL: downloaded)) != nil
        return ["running": refreshTask != nil, "status": lastResult,
                "cty_source": usingDownloadedCTY ? "workspace_download" : "bundled",
                "state": stateJSON]
    }

    private func finish(_ result: String) {
        lastResult = result
        refreshTask = nil
    }

    private func invalid() -> WorkerFailure {
        WorkerFailure("invalid_params", "Invalid reference-data request.")
    }
}
#endif

import Foundation

/// The persistent desktop boundary. Requests are correlated, bounded and never
/// echoed into diagnostics. Creating a worker does not connect hardware or open
/// the original application's database.
public actor LiveWorker {
    public static let shared = LiveWorker()
    private let diagnostics = PrototypeWorker()
    private var terminalShutdown = false
    #if os(macOS)
    // Disk-backed logbook work is synchronous. Run it on its own actor so a
    // slow import/backup cannot monopolize the station and service router.
    private actor LogbookLane {
        private let service: LiveLogbookMethods
        init(service: LiveLogbookMethods) { self.service = service }
        func handle(method: String, params: [String: Any]) throws -> [String: Any] {
            try service.handle(method: method, params: params)
        }
    }
    private let logbookLane: LogbookLane
    init(logbook: LiveLogbookMethods = .shared) { logbookLane = LogbookLane(service: logbook) }
    #else
    init() {}
    #endif

    func beginTerminalShutdown() {
        terminalShutdown = true
    }

    public func shutdown() async {
        beginTerminalShutdown()
        #if os(macOS)
        await LiveSpotBridge.shared.stopForShutdown()
        await LiveFlexSession.shared.terminate()
        await LiveStationSession.shared.terminate()
        #endif
    }

    public func response(to data: Data) async -> Data {
        var id = ""
        do {
            guard data.count <= PrototypeWorker.maxRequestBytes,
                  let envelope = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
                  Set(envelope.keys) == ["id", "method", "params"],
                  let requestID = envelope["id"] as? String, !requestID.isEmpty, requestID.utf8.count <= 128,
                  let method = envelope["method"] as? String, method.utf8.count <= 64,
                  let params = envelope["params"] as? [String: Any] else {
                throw WorkerFailure("invalid_request", "Expected a bounded, correlated request.")
            }
            id = requestID
            if terminalShutdown && (method.hasPrefix("station_") || method.hasPrefix("spot_bridge_")) {
                throw WorkerFailure("worker_stopping", "The station service is shutting down; no new station command was started.")
            }
            if method == "health" {
                guard params.isEmpty else { throw WorkerFailure("invalid_params", "Health takes no parameters.") }
                #if os(macOS)
                return encode(["id": id, "ok": true, "result": ["mode": "integrated", "synthetic_only": false,
                    "version": "0.4.0-alpha.2", "connections_require_explicit_action": true]])
                #else
                return diagnostics.response(to: data)
                #endif
            }
            if ["parse_adif", "self_test", "integration_self_test", "cluster_classify"].contains(method) {
                return diagnostics.response(to: data)
            }
            #if os(macOS)
            let result: [String: Any]
            if method.hasPrefix("workspace_") || method.hasPrefix("logbook_") || method.hasPrefix("settings_") || method.hasPrefix("backup_") {
                result = try await logbookLane.handle(method: method, params: params)
                if ["workspace_create", "logbook_save", "logbook_delete", "logbook_undo", "logbook_import_adif", "backup_restore"].contains(method) {
                    try? await LiveClusterMethods.shared.refreshContacts()
                }
            } else if method.hasPrefix("reference_") {
                result = try await LiveReferenceMethods.shared.handle(method: method, params: params)
            } else if method.hasPrefix("station_") {
                result = try await LiveStationMethods.handle(method, params: params)
            } else if method.hasPrefix("spot_bridge_") {
                result = try await LiveSpotBridge.shared.handle(method: method, params: params)
            } else if method.hasPrefix("cluster_") {
                result = try await LiveClusterMethods.shared.handle(method: method, params: params)
            } else {
                result = try await LiveServiceMethods.shared.handle(method: method, params: params)
            }
            return encode(["id": id, "ok": true, "result": result])
            #else
            throw WorkerFailure("platform_pending", "Live integration is currently being accepted on macOS. This platform has not been commissioned.")
            #endif
        } catch let failure as WorkerFailure {
            return encode(["id": id, "ok": false, "error": ["code": failure.code, "message": failure.message]])
        } catch {
            // Dependency errors can contain credentials, records or URLs. Never
            // return arbitrary localizedDescription over the UI/log boundary.
            return encode(["id": id, "ok": false, "error": ["code": "operation_failed", "message": "Operation failed. Check the connection or configuration; no success has been confirmed."]])
        }
    }

    private func encode(_ value: [String: Any]) -> Data {
        if let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]),
           data.count < PrototypeWorker.maxResponseBytes { return data }
        return (try? JSONSerialization.data(withJSONObject: ["id": value["id"] ?? "", "ok": false,
            "error": ["code": "response_too_large", "message": "Result is too large. Narrow the search or request a smaller page."]])) ?? Data()
    }
}

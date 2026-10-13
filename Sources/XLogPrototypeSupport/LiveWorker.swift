import Foundation

/// The persistent desktop boundary. Requests are correlated, bounded and never
/// echoed into diagnostics. Creating a worker does not connect hardware or open
/// the original application's database.
public actor LiveWorker {
    public static let shared = LiveWorker()
    private let diagnostics = PrototypeWorker()
    private var terminalShutdown = false
    // Disk-backed logbook work is synchronous. Run it on its own actor so a
    // slow import/backup cannot monopolize the station and service router.
    private actor LogbookLane {
        private let service: LiveLogbookMethods
        private let power: NativeDraftPowerGate
        private var powerStatus = "off"
        init(service: LiveLogbookMethods, power: NativeDraftPowerGate) {
            self.service = service; self.power = power
        }
        func handle(method: String, params: [String: Any]) throws -> [String: Any] {
            var result = try service.handle(method: method, params: params)
            if ["settings_save", "workspace_create", "backup_restore", "logbook_operator_draft_apply"].contains(method) {
                reconcilePower()
            }
            if method == "logbook_operator_draft" { result["power_capture_status"] = powerStatus }
            return result
        }

        func reconcilePower() {
            let state = power.state()
            guard !state.suspended else { power.disarm(); return }
            do {
                var owner = try service.powerOwnerSnapshot()
                // Keep legacy manual editing untouched until the feature is
                // explicitly enabled; never materialize state just by opening.
                guard owner.settings.automaticTransmitPower || owner.draft.power != nil else {
                    power.disarm(); powerStatus = "off"; return
                }
                owner = try service.configureDraftPower(expectedWorkspaceID: owner.workspaceID)
                if let context = state.context, owner.settings.automaticTransmitPower,
                   owner.draft.power?.manualOverride == false, !owner.draft.qso.call.isEmpty {
                    owner = try service.armDraftPower(context: context, expectedWorkspaceID: owner.workspaceID,
                        draftID: owner.draft.qso.id, expectedRevision: owner.draft.revision, now: Date())
                } else if owner.draft.power?.activeScope != nil {
                    owner = try service.invalidateDraftPower(expectedWorkspaceID: owner.workspaceID)
                }
                power.arm(owner.draft, workspaceID: owner.workspaceID, state: state)
                powerStatus = !owner.settings.automaticTransmitPower ? "off"
                    : owner.draft.power?.manualOverride == true ? "manual"
                    : owner.draft.power?.activeScope == nil ? "waiting" : "armed"
            } catch {
                power.disarm(); powerStatus = "unavailable"
            }
        }

        func capturePower(_ reading: NativeDraftPowerGate.Reading) {
            guard power.permits(reading) else { return }
            do {
                var admitted = false
                let result = try service.captureDraftPower(sample: reading.sample,
                    expectedWorkspaceID: reading.lease.workspaceID,
                    scopeID: reading.lease.scope.id, authorize: {
                        admitted = power.permits(reading)
                        return admitted
                    })
                if admitted {
                    power.recordCaptured(reading, draft: result.draft)
                    if result.draft.power?.selectedSample != nil { powerStatus = "captured" }
                }
            } catch { powerStatus = "unavailable" }
        }
    }
    private let powerCapture: NativeDraftPowerGate
    private let powerDelivery: NativeDraftPowerDelivery
    private var powerSelectionSequence: UInt64 = 0
    private let logbookLane: LogbookLane
    private let opportunities: LiveOpportunitiesMethods
    private let cluster: LiveClusterMethods
    private let publicServices: LivePublicServiceMethods
    private let services: LiveServiceMethods
    #if os(macOS)
    private let references: LiveReferenceMethods
    #endif
    private let localAcceptance: Bool
    private let contactRefresher: @Sendable () async throws -> Void
    private var contactRefreshPending = false
    private var workspaceTransitionCount = 0
    private var contactRefreshIdentity: UUID?
    // Isolated tests may join the exact task, rather than guessing a delay.
    private(set) var contactRefreshTask: Task<Void, Never>?
    init(logbook: LiveLogbookMethods = .shared, localAcceptance: Bool = false, cluster: LiveClusterMethods? = nil,
         publicServices: LivePublicServiceMethods? = nil,
         powerCapture: NativeDraftPowerGate = NativeDraftPowerGate(),
         powerDelivery: NativeDraftPowerDelivery = NativeDraftPowerDelivery(),
         contactRefresher: (@Sendable () async throws -> Void)? = nil) {
        self.powerCapture = powerCapture
        self.powerDelivery = powerDelivery
        logbookLane = LogbookLane(service: logbook, power: powerCapture)
        self.publicServices = publicServices ?? LivePublicServiceMethods(logbook: logbook)
        services = LiveServiceMethods(logbook: logbook)
        #if os(macOS)
        references = LiveReferenceMethods(logbook: logbook)
        #endif
        let cluster = cluster ?? (logbook === LiveLogbookMethods.shared ? .shared : LiveClusterMethods(logbook: logbook))
        self.cluster = cluster
        self.contactRefresher = contactRefresher ?? { try await cluster.refreshContacts() }
        opportunities = LiveOpportunitiesMethods(logbook: logbook, clusterSpots: { await cluster.currentSpotRowsIfStarted() })
        self.localAcceptance = localAcceptance
    }

    func beginTerminalShutdown() {
        terminalShutdown = true
        powerCapture.terminate()
        cancelContactRefresh()
    }

    private func cancelContactRefresh() {
        contactRefreshPending = false
        contactRefreshIdentity = nil
        contactRefreshTask?.cancel()
        contactRefreshTask = nil
    }

    private func queueContactRefresh() {
        guard !localAcceptance, !terminalShutdown else { return }
        contactRefreshPending = true
        guard workspaceTransitionCount == 0 else { return }
        guard contactRefreshTask == nil else { return }
        let identity = UUID()
        contactRefreshIdentity = identity
        contactRefreshTask = Task(priority: .utility) { [weak self] in
            await self?.drainContactRefresh(identity)
        }
    }

    private func drainContactRefresh(_ identity: UUID) async {
        while !terminalShutdown, !Task.isCancelled, contactRefreshIdentity == identity, contactRefreshPending {
            contactRefreshPending = false
            // The durable mutation response has already been encoded and
            // returned. A failed projection must not change its receipt.
            try? await contactRefresher()
        }
        guard contactRefreshIdentity == identity else { return }
        contactRefreshIdentity = nil
        contactRefreshTask = nil
    }

    public func startBackgroundServices() async {
        guard !localAcceptance, !terminalShutdown else { return }
        await startPowerCapture()
        await services.startAutomaticSync()
        #if os(macOS)
        await references.startAutomaticChecks()
        #endif
    }

    func startPowerCapture(registerStation: Bool = true) async {
        guard !localAcceptance, !terminalShutdown else { return }
        let lane = logbookLane
        let delivery = powerDelivery
        powerCapture.install(changed: { delivery.enqueue { await lane.reconcilePower() } },
                             received: { reading in delivery.enqueue { await lane.capturePower(reading) } })
        #if os(macOS)
        if registerStation { await LiveStationSession.shared.installPowerCapture(powerCapture) }
        #endif
        await lane.reconcilePower()
    }

    func drainPowerCapture() async { await powerDelivery.drain() }

    public func shutdown() async {
        beginTerminalShutdown()
        await services.beginTermination()
        #if os(macOS)
        await references.terminate()
        #endif
        await publicServices.terminate()
        await opportunities.terminate()
        if localAcceptance {
            // Only the injected local cluster/archive owner is retired here;
            // process-wide station singletons remain outside acceptance scope.
            await cluster.terminate()
            await services.terminate()
            return
        }
        #if os(macOS)
        await LiveSpotBridge.shared.stopForShutdown()
        await LiveRotorSession.shared.terminate()
        await LiveFlexSession.shared.terminate()
        await LiveStationSession.shared.terminate()
        #endif
        await cluster.terminate()
        await services.terminate()
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
            if localAcceptance {
                guard !terminalShutdown else {
                    throw WorkerFailure("worker_stopping", "The local acceptance session has ended.")
                }
                try LocalAcceptanceSession.validate(method: method, params: params)
            }
            if terminalShutdown && (method.hasPrefix("reference_") || method.hasPrefix("sync_") || method.hasPrefix("secret_") || method.hasPrefix("station_") || method.hasPrefix("spot_bridge_") || method.hasPrefix("spot_history_") || method.hasPrefix("opportunities_") || method.hasPrefix("cluster_") || method.hasPrefix("logbook_operator_draft") || method.hasPrefix("logbook_contact") || ["weather", "propagation_snapshot", "lookup_call", "workspace_create", "backup_restore"].contains(method)) {
                throw WorkerFailure("worker_stopping", "The worker is shutting down; no new service request was started.")
            }
            if method == "health" {
                guard params.isEmpty else { throw WorkerFailure("invalid_params", "Health takes no parameters.") }
                var health = Self.health
                if localAcceptance {
                    health["mode"] = "isolated_local_acceptance"
                    health["platform_services"] = false
                    health["isolated_workspace"] = true
                    health["network_contact"] = false
                    health["credentials_accessed"] = false
                    health["public_opportunities"] = false
                    health["live_cluster"] = false
                    health["public_conditions"] = false
                    health["local_callsign_lookup"] = false
                }
                return encode(["id": id, "ok": true, "result": health])
            }
            if ["parse_adif", "self_test", "integration_self_test", "cluster_classify"].contains(method) {
                return diagnostics.response(to: data)
            }
            let result: [String: Any]
            if method == "station_power_selection" {
                guard !terminalShutdown, Set(params.keys) == ["provider", "selection_id", "sequence"],
                      let sequenceValue = params["sequence"],
                      let sequenceData = try? JSONSerialization.data(withJSONObject: [sequenceValue]),
                      let sequence = try? JSONDecoder().decode([UInt64].self, from: sequenceData).first,
                      (1...9_007_199_254_740_991).contains(sequence) else {
                    throw WorkerFailure("invalid_params", "Invalid native selection context.")
                }
                let selectedProvider: String?
                let selectionID: String?
                if params["provider"] is NSNull, params["selection_id"] is NSNull {
                    selectedProvider = nil; selectionID = nil
                } else {
                    guard let provider = params["provider"] as? String,
                          ["direct_agent", "direct_flex_lan", "hamlib", "xcat_loopback"].contains(provider),
                          let selection = params["selection_id"] as? String, UUID(uuidString: selection) != nil else {
                        throw WorkerFailure("invalid_params", "Invalid native selection context.")
                    }
                    selectedProvider = provider; selectionID = selection
                }
                // select() revokes the emission/commit lease synchronously.
                // DB metadata cleanup is queued, never a prerequisite for a
                // radio disconnect while a long import holds the logbook lane.
                if sequence > powerSelectionSequence {
                    powerSelectionSequence = sequence
                    powerCapture.select(provider: selectedProvider, selectionID: selectionID)
                    result = ["accepted": true]
                } else {
                    // A delayed startup publication cannot restore the context
                    // retired by a newer provider handover or connection fence.
                    result = ["accepted": false, "superseded": true]
                }
            } else if method == "cluster_history" || method.hasPrefix("workspace_") || method.hasPrefix("logbook_") || method.hasPrefix("settings_") || method.hasPrefix("backup_") {
                if method == "logbook_operator_draft_apply", params["action"] as? String == "save" {
                    // Include the callback prefix already emitted before Save
                    // admission; unstructured actor Tasks alone are not FIFO.
                    await powerDelivery.drain()
                    guard !terminalShutdown else {
                        throw WorkerFailure("worker_stopping", "The worker is shutting down; Save was not started.")
                    }
                }
                let changingWorkspace = !localAcceptance && ["workspace_create", "backup_restore"].contains(method)
                if changingWorkspace {
                    // Retire queued publications before the database may be
                    // replaced; an old workspace cannot repaint the new one.
                    cancelContactRefresh()
                    workspaceTransitionCount += 1
                    powerCapture.suspend(true)
                    #if os(macOS)
                    await references.suspendForWorkspaceChange()
                    #endif
                    await cluster.invalidateContactsForWorkspaceChange()
                }
                do { result = try await logbookLane.handle(method: method, params: params) }
                catch {
                    // A rejected restore still owns the original workspace;
                    // rebuild its invalidated projection without hiding error.
                    if changingWorkspace {
                        #if os(macOS)
                        await references.finishWorkspaceChange()
                        #endif
                        await cluster.finishWorkspaceChange()
                        workspaceTransitionCount -= 1
                        if workspaceTransitionCount == 0 {
                            powerCapture.suspend(false)
                            await logbookLane.reconcilePower()
                        }
                        queueContactRefresh()
                    }
                    throw error
                }
                if changingWorkspace {
                    #if os(macOS)
                    await references.finishWorkspaceChange()
                    #endif
                    await cluster.finishWorkspaceChange()
                    workspaceTransitionCount -= 1
                    if workspaceTransitionCount == 0 {
                        powerCapture.suspend(false)
                        await logbookLane.reconcilePower()
                    }
                }
                let draftLogged = method == "logbook_operator_draft_apply" && params["action"] as? String == "save"
                    && result["status"] as? String == "applied"
                let contactChanged = method == "logbook_contact_apply" && result["status"] as? String == "applied"
                #if os(macOS)
                if method == "settings_save" { await references.resetAutomaticDeadline() }
                #endif
                if !localAcceptance && (draftLogged || contactChanged || ["workspace_create", "logbook_save", "logbook_delete", "logbook_undo", "logbook_import_adif", "backup_restore"].contains(method)) {
                    queueContactRefresh()
                }
            } else if method.hasPrefix("opportunities_") {
                result = try await opportunities.handle(method: method, params: params)
            } else if method.hasPrefix("cluster_") || method.hasPrefix("spot_history_") {
                result = try await cluster.handle(method: method, params: params)
            } else if method == "weather" || method == "propagation_snapshot" {
                result = try await publicServices.handle(method: method, params: params)
            } else if method.hasPrefix("sync_") || method.hasPrefix("secret_") {
                result = try await services.handle(method: method, params: params)
                #if os(macOS)
                if method == "secret_save" { await references.resetAutomaticDeadline() }
                #endif
            } else {
                #if os(macOS)
                if method.hasPrefix("reference_") {
                    result = try await references.handle(method: method, params: params)
                } else if method.hasPrefix("station_") {
                    result = try await LiveStationMethods.handle(method, params: params)
                } else if method.hasPrefix("spot_bridge_") {
                    result = try await LiveSpotBridge.shared.handle(method: method, params: params)
                } else {
                    result = try await services.handle(method: method, params: params)
                }
                #else
                if method == "lookup_call" {
                    result = try await publicServices.handle(method: method, params: params)
                } else {
                    throw WorkerFailure("platform_pending", "This service is not yet available on this platform. The local logbook remains available; no connection or command was started.")
                }
                #endif
            }
            return encode(["id": id, "ok": true, "result": result])
        } catch let failure as WorkerFailure {
            return encode(["id": id, "ok": false, "error": ["code": failure.code, "message": failure.message]])
        } catch {
            // Dependency errors can contain credentials, records or URLs. Never
            // return arbitrary localizedDescription over the UI/log boundary.
            return encode(["id": id, "ok": false, "error": ["code": "operation_failed", "message": "Operation failed. Check the connection or configuration; no success has been confirmed."]])
        }
    }

    private static var health: [String: Any] {
        #if os(macOS)
        let platform = "macOS", mode = "integrated", services = true
        #elseif os(Windows)
        let platform = "Windows", mode = "integrated_local", services = false
        #else
        let platform = "Linux", mode = "integrated_local", services = false
        #endif
        return ["mode": mode, "platform": platform, "synthetic_only": false,
                "version": "0.4.0-alpha.9", "local_logbook": true,
                "platform_services": services, "public_opportunities": true, "live_cluster": true,
                "public_conditions": true, "local_callsign_lookup": true, "station_io": false,
                "connections_require_explicit_action": true]
    }

    private func encode(_ value: [String: Any]) -> Data {
        if let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]),
           data.count < PrototypeWorker.maxResponseBytes { return data }
        return (try? JSONSerialization.data(withJSONObject: ["id": value["id"] ?? "", "ok": false,
            "error": ["code": "response_too_large", "message": "Result is too large. Narrow the search or request a smaller page."]])) ?? Data()
    }
}

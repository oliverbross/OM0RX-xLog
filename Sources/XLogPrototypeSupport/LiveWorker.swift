import Foundation
import XContestCore
#if os(macOS)
import XLogCore
#else
import XLogPortableCore
#endif

public enum WorkerOperatingModule: String, Sendable, Equatable {
    case normalLogging = "normal_logging"
    case contesting

    public static func resolve(environment: [String: String]) throws -> Self {
        guard let value = environment["XLOG_OPERATING_MODULE"] else { return .normalLogging }
        guard let module = Self(rawValue: value) else {
            throw WorkerFailure("operating_module_invalid", "The native operating module is invalid.")
        }
        return module
    }
}

/// The persistent desktop boundary. Requests are correlated, bounded and never
/// echoed into diagnostics. Creating a worker does not connect hardware or open
/// the original application's database.
public actor LiveWorker {
    public static let shared = LiveWorker(ownsProcessSessions: true,
        runtimeProfile: AppRuntimeProfile.current,
        // Invalid native metadata must never enable Normal Logging background work.
        operatingModule: (try? WorkerOperatingModule.resolve(
            environment: ProcessInfo.processInfo.environment)) ?? .contesting)
    public static func processWorker(operatingModule: WorkerOperatingModule,
                                     runtimeProfile: AppRuntimeProfile) -> LiveWorker {
        LiveWorker(ownsProcessSessions: true, runtimeProfile: runtimeProfile,
                   operatingModule: operatingModule)
    }
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
            if ["settings_save", "workspace_create", "backup_restore", "logbook_operator_draft_apply", "spot_draft_apply"].contains(method) {
                reconcilePower()
            }
            if method == "logbook_operator_draft" { result["power_capture_status"] = powerStatus }
            return result
        }
        #if os(macOS)
        func applyCWCallsign(params:[String:Any],resolver:LiveCWDecodeMethods) async throws -> [String:Any] {
            guard let spot=params["spot"] as? [String:Any],let reference=spot["cwCallsign"],let call=spot["call"] as? String else {
                throw WorkerFailure("invalid_params","CW callsign parameters are invalid.")
            }
            // Resolve after entering the database lane, rather than allowing a
            // queued import to make an earlier router read stale before commit.
            let resolved=try await resolver.handle(method:"cw_decode_resolve_selection",params:["reference":reference,"require_frequency":false])
            guard resolved["callsign"] as? String==call else {
                throw WorkerFailure("cw_selection_stale","This signal changed before the draft could be updated.")
            }
            return try handle(method:"spot_draft_apply",params:params)
        }
        #endif

        func workspaceGeneration() throws -> String {
            guard let generation = try service.syncOwnerContext()["generation"] as? String,
                  UUID(uuidString: generation) != nil else {
                throw ContestLaneError.confirmed("invalid_workspace", "The isolated workspace generation is unavailable.")
            }
            return generation
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
    private var powerSelectionSequence: [String: UInt64] = ["radio1": 0, "radio2": 0]
    private let logbookLane: LogbookLane
    private let contestLane: ContestLane?
    private let contestLaneInitializationError: ContestLaneError?
    private let pythonContestLane: PythonContestLane?
    private let pythonContestLaneInitializationError: ContestLaneError?
    private let pythonContestAvailable: Bool
    private let usesPythonContestLane: Bool
    private let contestLogTransfer: ContestLogTransferService
    let remoteBackup: LiveRemoteBackupService
    private let remoteBackupPresentation: LiveRemoteBackupPresentation
    private let opportunities: LiveOpportunitiesMethods
    private let operatingGoals: LiveOperatingGoalMethods
    private let cluster: LiveClusterMethods
    private let publicServices: LivePublicServiceMethods
    private let services: LiveServiceMethods
    private let onlineLogs: LiveOnlineLogDeliveryService
    private let logbookMethods: LiveLogbookMethods
    private var rtcScores: RTCScoreReportingService?
    #if os(macOS)
    private let references: LiveReferenceMethods
    private let cwDecode: LiveCWDecodeMethods
    #endif
    private let localAcceptance: Bool
    private let runtimeProfile: AppRuntimeProfile
    private let operatingModule: WorkerOperatingModule
    /// Only the process singleton owns hardware/service singletons. Disposable
    /// workers used by acceptance and unit tests must never terminate them.
    private let ownsProcessSessions: Bool
    private let contactRefresher: @Sendable () async throws -> Void
    private var contactRefreshPending = false
    private var workspaceTransitionCount = 0
    private var contactRefreshIdentity: UUID?
    // Isolated tests may join the exact task, rather than guessing a delay.
    private(set) var contactRefreshTask: Task<Void, Never>?
    init(logbook: LiveLogbookMethods = .shared, localAcceptance: Bool = false, cluster: LiveClusterMethods? = nil,
         publicServices: LivePublicServiceMethods? = nil,
         opportunityMethods: LiveOpportunitiesMethods? = nil,
         powerCapture: NativeDraftPowerGate = NativeDraftPowerGate(),
         powerDelivery: NativeDraftPowerDelivery = NativeDraftPowerDelivery(),
         remoteBackup: LiveRemoteBackupService? = nil,
          remoteBackupEnvironment: NativeRemoteBackupPresentationEnvironment? = nil,
         onlineLogs: LiveOnlineLogDeliveryService? = nil,
          contactRefresher: (@Sendable () async throws -> Void)? = nil,
          ownsProcessSessions: Bool = false,
          runtimeProfile: AppRuntimeProfile = .production,
          operatingModule: WorkerOperatingModule = .normalLogging,
          contestDeclarativeDefinitions: [ContestDeclarativeDefinition]? = nil,
          pythonContestConfiguration: PythonContestHostConfiguration? = nil) {
        self.powerCapture = powerCapture
        self.powerDelivery = powerDelivery
        self.logbookMethods = logbook
        let createdLogbookLane = LogbookLane(service: logbook, power: powerCapture)
        logbookLane = createdLogbookLane
        contestLogTransfer = ContestLogTransferService(logbook: logbook)
        // The packaged Contesting Test process owns a real bundled Python lane.
        // Keep the retired Swift lane only as a compatibility fixture for
        // disposable unit workers that do not own process services.
        let selectsPythonContestLane = runtimeProfile == .production || ownsProcessSessions
            || pythonContestConfiguration != nil
        usesPythonContestLane = selectsPythonContestLane
        if case .contestingTest = runtimeProfile, !selectsPythonContestLane {
            let contestURL = logbook.workspaceDirectoryURL.deletingLastPathComponent()
                .appendingPathComponent("Contesting", isDirectory: true).appendingPathComponent("contests.sqlite")
            do {
                contestLane = try ContestLane(
                    databaseURL: contestURL,
                    generationSource: { try await createdLogbookLane.workspaceGeneration() },
                    declarativeDefinitions: contestDeclarativeDefinitions)
                contestLaneInitializationError = nil
            } catch let error as ContestLaneError {
                contestLane = nil
                contestLaneInitializationError = error
            } catch {
                contestLane = nil
                contestLaneInitializationError = .confirmed("contest_unavailable", "The isolated contest store could not be initialized.")
            }
        } else {
            contestLane = nil
            contestLaneInitializationError = nil
        }
        if selectsPythonContestLane {
            do {
                let applicationSupport = runtimeProfile.supportDirectory
                    ?? logbook.workspaceDirectoryURL.deletingLastPathComponent()
                let configuration = try pythonContestConfiguration
                    ?? PythonContestHostConfiguration.bundled(
                        applicationSupport: applicationSupport)
                pythonContestLane = try PythonContestLane(configuration: configuration,
                    n1mmUDPAllowed: runtimeProfile.contestN1MMUDPAllowed)
                pythonContestLaneInitializationError = nil
                pythonContestAvailable = true
            } catch let error as ContestLaneError {
                pythonContestLane = nil
                pythonContestLaneInitializationError = error
                pythonContestAvailable = false
            } catch {
                pythonContestLane = nil
                pythonContestLaneInitializationError = .confirmed(
                    "contest_host_unavailable", "The bundled contest host could not be initialized.")
                pythonContestAvailable = false
            }
        } else {
            pythonContestLane = nil
            pythonContestLaneInitializationError = nil
            pythonContestAvailable = false
        }
        let backupVerifier = remoteBackupEnvironment.map {
            LiveDropboxBackupAccountVerifier(vault: $0.vault, http: $0.http)
        }
        let backupService = remoteBackup ?? LiveRemoteBackupService(logbook: logbook,
            accountVerifier: backupVerifier)
        self.remoteBackup = backupService
        #if os(macOS)
        let ftpPresentation = ownsProcessSessions && remoteBackupEnvironment == nil
            ? LiveFTPBackupPresentation(logbook: logbook, service: backupService) : nil
        #else
        let ftpPresentation: LiveFTPBackupPresentation? = nil
        #endif
        self.remoteBackupPresentation = LiveRemoteBackupPresentation(logbook: logbook,
            service: backupService, environment: remoteBackupEnvironment, ftp: ftpPresentation)
        self.publicServices = publicServices ?? LivePublicServiceMethods(logbook: logbook)
        services = LiveServiceMethods(logbook: logbook)
        self.onlineLogs = onlineLogs ?? LiveOnlineLogDeliveryService(logbook: logbook,
            backgroundOwnershipAllowed: { operatingModule == .normalLogging })
        #if os(macOS)
        references = LiveReferenceMethods(logbook: logbook)
        #endif
        let cluster = cluster ?? (logbook === LiveLogbookMethods.shared && operatingModule == .normalLogging
            ? .shared : LiveClusterMethods(logbook: logbook,
                                           forwardClassifiedIngressSpots: operatingModule == .normalLogging))
        self.cluster = cluster
        #if os(macOS)
        cwDecode = LiveCWDecodeMethods(logbook:logbook,prepareListener:{try await cluster.prepareLocalCWListener()},
            ingestSpot:{spot,call in try await cluster.ingestLocalCW(spot,stationCallsign:call)})
        #endif
        self.contactRefresher = contactRefresher ?? { try await cluster.refreshContacts() }
        let opportunityMethods = opportunityMethods ?? LiveOpportunitiesMethods(logbook: logbook, clusterSpots: { await cluster.currentSpotRowsIfStarted() })
        opportunities = opportunityMethods
        operatingGoals = LiveOperatingGoalMethods(logbook: logbook, opportunities: opportunityMethods)
        self.localAcceptance = localAcceptance
        self.runtimeProfile = runtimeProfile
        self.operatingModule = operatingModule
        self.ownsProcessSessions = ownsProcessSessions
    }

    func beginTerminalShutdown() async {
        terminalShutdown = true
        #if os(macOS)
        await cwDecode.terminate()
        #endif
        await contestLane?.shutdown()
        await pythonContestLane?.shutdown()
        await rtcScores?.terminate()
        powerCapture.terminate()
        cancelContactRefresh()
        remoteBackup.beginTermination()
        await onlineLogs.beginTermination()
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
        guard !localAcceptance, runtimeProfile.externalIOAllowed, !terminalShutdown else { return }
        // Shared read-only/reference observation remains available to either
        // operator module. Normal draft mutation owners are gated below.
        #if os(macOS)
        await references.startAutomaticChecks()
        #endif
        guard !terminalShutdown, !Task.isCancelled,
              operatingModule == .normalLogging else { return }
        await startPowerCapture()
        guard !terminalShutdown, !Task.isCancelled else { return }
        await services.startAutomaticSync()
        guard !terminalShutdown, !Task.isCancelled else { return }
        await onlineLogs.startAutomaticDelivery()
        #if os(macOS)
        guard !terminalShutdown, !Task.isCancelled else { return }
        if ownsProcessSessions {
            await LiveWSJTXBridge.shared.install { [weak self] in
                Task { await self?.externalContactChanged() }
            }
            await LiveWSJTXBridge.shared.startIfEnabled()
        }
        #endif
    }

    private func externalContactChanged() async {
        guard operatingModule == .normalLogging, !terminalShutdown else { return }
        queueContactRefresh()
        await onlineLogs.requestDelivery()
    }

    private var normalBackgroundEnabled: Bool {
        operatingModule == .normalLogging && runtimeProfile.externalIOAllowed && !localAcceptance && !terminalShutdown
    }

    func backgroundServiceStateForTesting() async -> (sync: Bool, delivery: Bool) {
        (await services.hasScheduledWorkForTesting(), await onlineLogs.hasScheduledWorkForTesting())
    }

    func startPowerCapture(registerStation: Bool = true) async {
        guard operatingModule == .normalLogging, !localAcceptance, !terminalShutdown else { return }
        let lane = logbookLane
        let delivery = powerDelivery
        powerCapture.install(changed: { delivery.enqueue { await lane.reconcilePower() } },
                             received: { reading in delivery.enqueue { await lane.capturePower(reading) } })
        #if os(macOS)
        if registerStation && ownsProcessSessions { await LiveStationSession.shared.installPowerCapture(powerCapture) }
        #endif
        await lane.reconcilePower()
    }

    func drainPowerCapture() async { await powerDelivery.drain() }

    @discardableResult public func shutdown() async -> Bool {
        await beginTerminalShutdown()
        let onlineLogsRetired = await onlineLogs.terminate()
        var contestSpotsRetired = true
        await remoteBackup.terminate()
        await services.beginTermination()
        #if os(macOS)
        await references.terminate()
        if ownsProcessSessions {
            await LiveWSJTXBridge.shared.stopForShutdown()
            await LiveFldigiBridge.shared.stopForShutdown()
        }
        #endif
        await publicServices.terminate()
        await opportunities.terminate()
        if localAcceptance {
            // Only the injected local cluster/archive owner is retired here;
            // process-wide station singletons remain outside acceptance scope.
            contestSpotsRetired = await cluster.terminate()
            await services.terminate()
            return onlineLogsRetired && contestSpotsRetired
        }
        #if os(macOS)
        if ownsProcessSessions {
            await LiveSpotBridge.shared.stopForShutdown()
            // Contest-owned radio spots must be withdrawn while their station
            // transports are still available. Normal Logging starts only after
            // this worker has retired.
            contestSpotsRetired = await cluster.terminate()
            await LiveRotorSession.shared.terminate()
            await LiveFlexSession.shared.terminate()
            await LiveTCISession.shared.terminate()
            await LiveStationSession.shared.terminate()
        } else {
            contestSpotsRetired = await cluster.terminate()
        }
        #else
        contestSpotsRetired = await cluster.terminate()
        #endif
        await services.terminate()
        return onlineLogsRetired && contestSpotsRetired
    }

    public func response(to data: Data) async -> Data {
        var id = ""
        do {
            guard data.count <= PrototypeWorker.maxRequestBytes,
                  let envelope = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
                  (Set(envelope.keys) == ["id", "method", "params"]
                    || Set(envelope.keys) == ["id", "method", "params", "operatingModule"]),
                  let requestID = envelope["id"] as? String, !requestID.isEmpty, requestID.utf8.count <= 128,
                  let method = envelope["method"] as? String, method.utf8.count <= 64,
                  let params = envelope["params"] as? [String: Any] else {
                throw WorkerFailure("invalid_request", "Expected a bounded, correlated request.")
            }
            id = requestID
            if terminalShutdown && method.hasPrefix("cw_decode_") {
                throw WorkerFailure("worker_stopping", "CW Decode is shutting down.")
            }
            let requestOperatingModule: WorkerOperatingModule
            if let rawModule = envelope["operatingModule"] as? String {
                guard let module = WorkerOperatingModule(rawValue: rawModule) else {
                    throw WorkerFailure("operating_module_invalid", "The native request operating module is invalid.")
                }
                requestOperatingModule = module
            } else {
                requestOperatingModule = operatingModule
            }
            if terminalShutdown && method == "remote_backup_request" {
                throw WorkerFailure("worker_stopping", "The worker is shutting down; no backup command was started.")
            }
            if localAcceptance {
                guard !terminalShutdown else {
                    throw WorkerFailure("worker_stopping", "The local acceptance session has ended.")
                }
                try LocalAcceptanceSession.validate(method: method, params: params)
            }
            if !runtimeProfile.externalIOAllowed, !Self.testProfileAllows(method) {
                throw WorkerFailure("external_io_disabled", "External services and station I/O are disabled in OM0RX-xLog Contesting Test.")
            }
            if ["sync_run", "sync_configure", "sync_retry", "sync_resolve"].contains(method) {
                throw WorkerFailure("sync_owner_required", "Use the shared generation-bound Sync mutation owner.")
            }
            if terminalShutdown && (method.hasPrefix("contest_") || method.hasPrefix("reference_") || method.hasPrefix("sync_") || method.hasPrefix("secret_") || method.hasPrefix("online_log_") || method.hasPrefix("station_") || method.hasPrefix("spot_bridge_") || method.hasPrefix("wsjtx_") || method.hasPrefix("fldigi_") || method.hasPrefix("spot_history_") || method.hasPrefix("spot_draft_") || method.hasPrefix("opportunities_") || method.hasPrefix("operating_goals_") || method.hasPrefix("cluster_") || method.hasPrefix("logbook_operator_draft") || method.hasPrefix("logbook_contact") || ["weather", "propagation_snapshot", "propagation_refresh", "lookup_call", "workspace_create", "backup_restore"].contains(method)) {
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
                } else if !runtimeProfile.externalIOAllowed {
                    health["mode"] = "contesting_test"
                    health["platform_services"] = false
                    health["isolated_workspace"] = true
                    health["network_contact"] = false
                    health["credentials_accessed"] = false
                    health["live_cluster"] = false
                    health["station_io"] = false
                } else if operatingModule == .contesting {
                    health["mode"] = "contesting"
                    health["isolated_workspace"] = false
                }
                if usesPythonContestLane && !localAcceptance {
                    health["contesting_engine"] = "not1mm-python"
                    health["contesting_available"] = pythonContestAvailable
                    if runtimeProfile == .production { health["isolated_workspace"] = false }
                }
                return encode(["id": id, "ok": true, "result": health])
            }
            if ["parse_adif", "self_test", "integration_self_test", "cluster_classify"].contains(method) {
                return diagnostics.response(to: data)
            }
            #if os(macOS)
            if method == "contest_station_tune" {
                guard runtimeProfile == .production, operatingModule == .contesting else {
                    throw WorkerFailure("inactive_operating_module", "Contest tuning belongs to the inactive operating module.")
                }
                let tuned = try await LiveStationMethods.handle("station_tune", params: params)
                return encode(["id": id, "ok": true, "result": tuned])
            }
            #endif
            let result: [String: Any]
            if method.hasPrefix("contest_rtc_") {
                result = try await handleRTC(method: method, params: params)
            } else if ["contest_log_transfer_prepare", "contest_log_transfer_commit", "contest_log_transfer_status"].contains(method) {
                guard usesPythonContestLane, let pythonContestLane else {
                    throw WorkerFailure("contest_host_unavailable", "The bundled contest host is unavailable.")
                }
                result = try await contestLogTransfer.handle(method: method, params: params) { method, params in
                    try await pythonContestLane.handle(method: method, params: params)
                }
                if method == "contest_log_transfer_commit", normalBackgroundEnabled,
                   ((result["counts"] as? [String: Any])?["inserted"] as? Int ?? 0) > 0 {
                    queueContactRefresh()
                }
            } else if method.hasPrefix("contest_") {
                if usesPythonContestLane {
                    if let pythonContestLaneInitializationError { throw pythonContestLaneInitializationError }
                    guard let pythonContestLane else {
                        throw WorkerFailure("contest_host_unavailable", "The bundled contest host is unavailable.")
                    }
                    if Self.isPythonContestAssistanceMethod(method) {
                        result = try await pythonContestLane.handleAssistance(method: method, params: params)
                    } else if ["contest_history_status", "contest_history_preview_private",
                               "contest_history_preview_page", "contest_history_preview_cancel",
                               "contest_history_preview_commit", "contest_history_query",
                               "contest_history_query_cancel", "contest_history_select",
                               "contest_history_apply", "contest_history_activate"].contains(method) {
                        result = try await pythonContestLane.handleCallHistory(method: method, params: params)
                    } else {
                        result = try await pythonContestLane.handle(method: method, params: params)
                    }
                } else if case .contestingTest = runtimeProfile {
                    if let contestLaneInitializationError { throw contestLaneInitializationError }
                    guard let contestLane else {
                        throw WorkerFailure("contest_unavailable", "The isolated contest store is unavailable.")
                    }
                    result = try await contestLane.handle(method: method, params: params)
                } else {
                    throw WorkerFailure("inactive_operating_module", "Contesting belongs to the inactive operating module.")
                }
            } else if method == "station_power_selection" {
                guard !terminalShutdown,
                      Set(params.keys) == ["radio_id", "provider", "selection_id", "sequence"],
                      let radioID = params["radio_id"] as? String,
                      ["radio1", "radio2"].contains(radioID),
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
                          ["direct_agent", "direct_flex_lan", "direct_tci", "hamlib", "xcat_loopback"].contains(provider),
                          let selection = params["selection_id"] as? String, UUID(uuidString: selection) != nil else {
                        throw WorkerFailure("invalid_params", "Invalid native selection context.")
                    }
                    selectedProvider = provider; selectionID = selection
                }
                // select() revokes the emission/commit lease synchronously.
                // DB metadata cleanup is queued, never a prerequisite for a
                // radio disconnect while a long import holds the logbook lane.
                if sequence > powerSelectionSequence[radioID, default: 0] {
                    powerSelectionSequence[radioID] = sequence
                    powerCapture.select(provider: selectedProvider, selectionID: selectionID)
                    result = ["accepted": true]
                } else {
                    // A delayed startup publication cannot restore the context
                    // retired by a newer provider handover or connection fence.
                    result = ["accepted": false, "superseded": true]
                }
            } else if method == "cluster_history" || method.hasPrefix("spot_draft_") || method.hasPrefix("workspace_") || method.hasPrefix("logbook_") || method.hasPrefix("settings_") || method.hasPrefix("backup_") {
                #if os(macOS)
                let cwCallsign=method=="spot_draft_apply" && (params["spot"] as? [String:Any])?["cwCallsign"] != nil
                if cwCallsign {
                    guard ownsProcessSessions else {throw WorkerFailure("cw_owner_required","CW callsign loading requires the application worker owner.")}
                }
                #endif
                if method == "logbook_operator_draft_apply", params["action"] as? String == "save" {
                    // Include the callback prefix already emitted before Save
                    // admission; unstructured actor Tasks alone are not FIFO.
                    await powerDelivery.drain()
                    guard !terminalShutdown else {
                        throw WorkerFailure("worker_stopping", "The worker is shutting down; Save was not started.")
                    }
                }
                if ["workspace_create", "backup_restore"].contains(method) { try await remoteBackup.stop() }
                if method == "backup_restore" { await pythonContestLane?.prepareForRestore() }
                if method == "settings_save" { await remoteBackupPresentation.retireConfiguration() }
                let changingWorkspace = runtimeProfile.externalIOAllowed && !localAcceptance
                    && ["workspace_create", "backup_restore"].contains(method)
                if changingWorkspace {
                    // Retire queued publications before the database may be
                    // replaced; an old workspace cannot repaint the new one.
                    cancelContactRefresh()
                    workspaceTransitionCount += 1
                    powerCapture.suspend(true)
                    await onlineLogs.suspendForOwnershipChange()
                    #if os(macOS)
                    await references.suspendForWorkspaceChange()
                    await LiveWSJTXBridge.shared.suspendForWorkspaceChange()
                    await LiveFldigiBridge.shared.suspendForWorkspaceChange()
                    #endif
                    await cluster.invalidateContactsForWorkspaceChange()
                }
                do {
                    #if os(macOS)
                    if cwCallsign {result=try await logbookLane.applyCWCallsign(params:params,resolver:cwDecode)}
                    else {result = try await logbookLane.handle(method:method,params:params)}
                    #else
                    result = try await logbookLane.handle(method:method,params:params)
                    #endif
                }
                catch {
                    // A rejected restore still owns the original workspace;
                    // rebuild its invalidated projection without hiding error.
                    if changingWorkspace {
                        #if os(macOS)
                        await references.finishWorkspaceChange()
                        if normalBackgroundEnabled {
                            await LiveWSJTXBridge.shared.finishWorkspaceChange()
                        }
                        #endif
                        await cluster.finishWorkspaceChange()
                        await onlineLogs.finishOwnershipChange()
                        workspaceTransitionCount -= 1
                        if workspaceTransitionCount == 0 {
                            powerCapture.suspend(false)
                            if normalBackgroundEnabled {
                                await logbookLane.reconcilePower()
                            }
                        }
                        queueContactRefresh()
                    }
                    throw error
                }
                if changingWorkspace {
                    #if os(macOS)
                    await references.finishWorkspaceChange()
                    if normalBackgroundEnabled {
                        await LiveWSJTXBridge.shared.finishWorkspaceChange()
                    }
                    #endif
                    await cluster.finishWorkspaceChange()
                    await onlineLogs.finishOwnershipChange()
                    workspaceTransitionCount -= 1
                    if workspaceTransitionCount == 0 {
                        powerCapture.suspend(false)
                        if normalBackgroundEnabled {
                            await logbookLane.reconcilePower()
                        }
                    }
                }
                let draftLogged = method == "logbook_operator_draft_apply" && params["action"] as? String == "save"
                    && result["status"] as? String == "applied"
                let contactChanged = method == "logbook_contact_apply" && result["status"] as? String == "applied"
                #if os(macOS)
                if method == "settings_save" { await references.resetAutomaticDeadline() }
                #endif
                let imported = method == "logbook_import_adif" && params["action"] as? String != "preview"
                if normalBackgroundEnabled && (draftLogged || contactChanged || imported || ["workspace_create", "logbook_save", "logbook_delete", "logbook_undo", "backup_restore"].contains(method)) {
                    queueContactRefresh()
                }
                if normalBackgroundEnabled && (draftLogged || method == "logbook_save") {
                    await onlineLogs.requestDelivery()
                }
            } else if method == "remote_backup_request" {
                result = try await remoteBackupPresentation.handle(params)
            } else if method.hasPrefix("opportunities_") {
                result = try await opportunities.handle(method: method, params: params)
            } else if method.hasPrefix("operating_goals_") {
                result = try await operatingGoals.handle(method: method, params: params)
            } else if method.hasPrefix("cluster_") || method.hasPrefix("spot_history_") {
                result = try await cluster.handle(method: method, params: params)
            } else if method == "weather" || method == "propagation_snapshot" || method == "propagation_refresh" {
                result = try await publicServices.handle(method: method, params: params)
            } else if method.hasPrefix("sync_") || method.hasPrefix("secret_") || method.hasPrefix("online_log_") {
                let fencesOnlineDelivery = Self.fencesOnlineLogDelivery(method: method, params: params)
                let changesFTPBackupCredential = method == "secret_save"
                    && params["account"] as? String == "ftp-backup-password"
                if changesFTPBackupCredential { await remoteBackupPresentation.retireConfiguration() }
                if fencesOnlineDelivery { await onlineLogs.suspendForOwnershipChange() }
                do {
                    var serviceResult = try await services.handle(method: method, params: params)
                    if method == "online_log_status" {
                        let service = (params["service"] as? String).flatMap {
                            OnlineLogService(rawValue: $0)
                        } ?? .qrz
                        serviceResult.merge(await onlineLogs.providerStatusFields(service: service)) {
                            _, safeStatus in safeStatus
                        }
                    }
                    result = serviceResult
                }
                catch {
                    if fencesOnlineDelivery { await onlineLogs.finishOwnershipChange() }
                    throw error
                }
                if fencesOnlineDelivery {
                    await onlineLogs.finishOwnershipChange()
                    if normalBackgroundEnabled { await onlineLogs.requestDelivery() }
                }
                #if os(macOS)
                if method == "secret_save" { await references.resetAutomaticDeadline() }
                #endif
            } else {
                #if os(macOS)
                if method.hasPrefix("cw_decode_") {
                    guard !["cw_decode_start","cw_decode_listener_start","cw_decode_flex_handoff"].contains(method) || ownsProcessSessions else {
                        throw WorkerFailure("cw_owner_required", "CW Decode requires the application worker owner.")
                    }
                    result = try await cwDecode.handle(method: method, params: params)
                } else if method == LiveConnectionDoctorMethods.method {
                    result = try LiveConnectionDoctorMethods.handle(params)
                } else if method.hasPrefix("reference_") {
                    result = try await references.handle(method: method, params: params)
                } else if method.hasPrefix("station_") {
                    result = try await LiveStationMethods.handle(method, params: params)
                } else if method.hasPrefix("spot_bridge_") {
                    result = try await LiveSpotBridge.shared.handle(method: method, params: params)
                } else if method.hasPrefix("wsjtx_") {
                    let route = Self.wsjtxRoute(for: requestOperatingModule)
                    var destinationProvider: (@Sendable () async throws -> WSJTXContestDestination)?
                    var contestImporter: (@Sendable (ADIFRecord, WSJTXContestDestination) async throws -> Bool)?
                    if requestOperatingModule == .contesting, let lane = pythonContestLane {
                        destinationProvider = { try await lane.digitalDestination() }
                        contestImporter = { record, destination in
                            try await lane.ingestDigital(record, destination: destination)
                        }
                    }
                    result = try await LiveWSJTXBridge.shared.handle(
                        method: method, params: params, route: route,
                        contestDestinationProvider: destinationProvider,
                        contestImporter: contestImporter)
                } else if method.hasPrefix("fldigi_") {
                    var receiveDestination: WSJTXContestDestination?
                    var transmitDestination: WSJTXContestDestination?
                    var transmitDestinationProvider: (@Sendable () async throws -> WSJTXContestDestination)?
                    var contestImporter: (@Sendable (ADIFRecord, WSJTXContestDestination) async throws -> Bool)?
                    if requestOperatingModule == .contesting, let lane = pythonContestLane {
                        receiveDestination = try? await lane.digitalDestination()
                        transmitDestinationProvider = { try await lane.fldigiTransmitDestination() }
                        transmitDestination = try? await transmitDestinationProvider?()
                        contestImporter = { record, destination in
                            try await lane.ingestDigital(record, destination: destination)
                        }
                    }
                    result = try await LiveFldigiBridge.shared.handle(
                        method: method, params: params, receiveDestination: receiveDestination,
                        transmitDestination: transmitDestination, contestImporter: contestImporter,
                        transmitDestinationProvider: transmitDestinationProvider)
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
        } catch let failure as ContestLaneError {
            return encode(["id": id, "ok": false, "error": ["code": failure.code, "message": failure.message, "outcome": failure.outcome]])
        } catch let failure as WorkerFailure {
            return encode(["id": id, "ok": false, "error": ["code": failure.code, "message": failure.message, "outcome": "confirmed"]])
        } catch {
            // Dependency errors can contain credentials, records or URLs. Never
            // return arbitrary localizedDescription over the UI/log boundary.
            return encode(["id": id, "ok": false, "error": ["code": "operation_failed", "message": "Operation failed. Check the connection or configuration; no success has been confirmed.", "outcome": "uncertain"]])
        }
    }

    private func handleRTC(method: String, params: [String: Any]) async throws -> [String: Any] {
        guard operatingModule == .contesting, runtimeProfile.externalIOAllowed, !localAcceptance,
              let pythonContestLane else {
            throw WorkerFailure("rtc_unavailable", "Score reporting is unavailable in this application mode.")
        }
        let reporter: RTCScoreReportingService
        if let rtcScores { reporter = rtcScores }
        else {
            let logbook = logbookMethods
            reporter = RTCScoreReportingService(credential: {
                try WorkspaceCredentialStore(service: try logbook.currentKeychainService()).load(.rtcScorePassword)
            }, payload: { sessionID, workspaceGeneration in
                let result = try await pythonContestLane.handle(method: "contest_rtc_payload", params: [
                    "sessionID": sessionID, "workspaceGeneration": workspaceGeneration,
                ])
                guard let xml = result["xml"] as? String else {
                    throw WorkerFailure("rtc_payload_invalid", "The contest engine did not return score XML.")
                }
                return xml
            })
            rtcScores = reporter
        }
        switch method {
        case "contest_rtc_status":
            guard params.isEmpty else { throw WorkerFailure("invalid_params", "RTC status takes no parameters.") }
            return await reporter.status()
        case "contest_rtc_configure":
            guard Set(params.keys) == ["sessionID", "workspaceGeneration", "service", "url", "username", "intervalMinutes", "enabled"],
                  let sessionID = params["sessionID"] as? String,
                  let workspaceGeneration = params["workspaceGeneration"] as? String,
                  let service = params["service"] as? String,
                  let urlString = params["url"] as? String, let endpoint = URL(string: urlString),
                  let username = params["username"] as? String,
                  let interval = params["intervalMinutes"] as? Int,
                  let enabled = params["enabled"] as? Bool else {
                throw WorkerFailure("invalid_params", "RTC configuration is invalid.")
            }
            return try await reporter.configure(.init(sessionID: sessionID, workspaceGeneration: workspaceGeneration,
                service: service, endpoint: endpoint, username: username, intervalMinutes: interval, enabled: enabled))
        case "contest_rtc_send_now":
            guard params.isEmpty else { throw WorkerFailure("invalid_params", "RTC send takes no parameters.") }
            return try await reporter.sendNow()
        default:
            throw WorkerFailure("invalid_request", "Unknown RTC score reporting request.")
        }
    }

    private static func testProfileAllows(_ method: String) -> Bool {
        ["health", "parse_adif", "self_test", "integration_self_test", "cluster_classify", "reference_log_review"].contains(method)
            || method.hasPrefix("workspace_") || method.hasPrefix("logbook_")
            || method.hasPrefix("settings_") || method.hasPrefix("backup_")
            || method.hasPrefix("contest_") && method != "contest_scp_download"
    }

    static func isPythonContestAssistanceMethod(_ method: String) -> Bool {
        ["contest_scp_status", "contest_scp_download", "contest_scp_query", "contest_scp_cancel",
         "contest_scp_select", "contest_scp_import_private"].contains(method)
    }

    #if os(macOS)
    static func wsjtxRoute(for module: WorkerOperatingModule) -> WSJTXLoggingRoute {
        module == .normalLogging ? .normalLogging : .contestSurfaceOrdinaryLogbook
    }
    #endif

    static func fencesOnlineLogDelivery(method: String, params: [String: Any]) -> Bool {
        let credentialAccounts: Set<String> = [
            "qrz-logbook-key", "clublog-api-key", "clublog-email",
            "clublog-application-password", "clublog-callsign",
        ]
        return method == "online_log_configure" || method == "online_log_reconcile" ||
            (method == "secret_save" && (params["account"] as? String).map(credentialAccounts.contains) == true)
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

import Foundation
#if os(macOS)
import LocalAuthentication
import Security
import XCatIntegrationCore
#endif
import XClusterIntegrationCore
import XCWCore
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif

protocol ClusterCredentialStoring: Sendable {
    var available: Bool { get }
    func load(_ id: UUID) throws -> String?
    func save(_ password: String, serverID: UUID) throws
}

struct ClusterRadioSpotPayload: Equatable, Sendable {
    let frequencyHz: Int64
    let callsign: String
    let mode: String
    let source: String
    let spotter: String
    let comment: String
    let timestamp: Int64
    let lifetimeSeconds: Int
    let priority: Int
    let colorHex: String

    #if os(macOS)
    func flexSpot() throws -> FlexSpot {
        try FlexSpot(frequencyHz: frequencyHz, callsign: callsign, mode: mode, source: source,
                     spotter: spotter, comment: comment, timestamp: timestamp,
                     lifetimeSeconds: lifetimeSeconds, priority: priority, colorHex: colorHex)
    }
    #endif
}

private struct ContestRadioSpotInput: Decodable {
    let spotID: String
    let callsign: String
    let frequencyHz: Int64
    let band: String
    let mode: String
    let spotter: String
    let comment: String
    let timestamp: Double
    let points: Int?
    let dupe: Bool?
    let multiplierCount: Int?
    let countryMultiplier: Bool?
    let zoneMultiplier: Bool?

    private enum CodingKeys: String, CodingKey {
        case spotID = "spot_id", callsign, frequencyHz = "frequency_hz", band, mode, spotter, comment, timestamp
        case points, dupe, multiplierCount = "multiplier_count"
        case countryMultiplier = "country_multiplier", zoneMultiplier = "zone_multiplier"
    }
}

private struct ContestRadioPublicationAccumulator {
    let publisherID: String
    let sequence: Int
    let sessionID: String
    let workspaceGeneration: String
    let revision: Int
    let action: String
    let configuredBands: [String]
    let allowedModeGroups: [String]
    let chunkCount: Int
    var chunks: [Int: [ContestRadioSpotInput]]
}

private struct ContestForwardedRadioSpot {
    let spotID: String
    let payload: ClusterRadioSpotPayload
    let signature: String
    let forwardedAt: Date
}

/// Serializes and memoizes secure-store reads for the worker lifetime. Cluster
/// snapshots are renderer-polled, so a missing or denied item must not cause a
/// fresh Security.framework request on every snapshot.
final class CachedClusterCredentialStore: ClusterCredentialStoring, @unchecked Sendable {
    private let base: any ClusterCredentialStoring
    private let lock = NSLock()
    private var cache: [UUID: Result<String?, Error>] = [:]

    init(base: any ClusterCredentialStoring) { self.base = base }

    var available: Bool { base.available }

    func load(_ id: UUID) throws -> String? {
        lock.lock(); defer { lock.unlock() }
        if let result = cache[id] { return try result.get() }
        do {
            let value = try base.load(id)
            cache[id] = .success(value)
            return value
        } catch {
            cache[id] = .failure(error)
            throw error
        }
    }

    func save(_ password: String, serverID: UUID) throws {
        try base.save(password, serverID: serverID)
        lock.lock(); defer { lock.unlock() }
        cache[serverID] = .success(password.isEmpty ? nil : password)
    }
}

/// Persistent worker bridge for the isolated integrated xLog profile.
/// Configuration is separate from both standalone apps. Passwords require a
/// platform secure store; no plaintext fallback is permitted.
public actor LiveClusterMethods {
    public static let shared = LiveClusterMethods()

    // Foundation's standalone worker may not provide a CFPreferences suite.
    // An explicit private file also keeps service identity independent of bundle lookup.
    private let configurationURL: URL
    private let logbook: LiveLogbookMethods
    private let vault: any ClusterCredentialStoring
    private let transportFactory: ClusterTransportFactory
    private var service: ClusterSessionService?
    private var configuration: ClusterSessionConfiguration?
    private var forwardAcceptedCount = 0
    private var flexForwardStatus = "Off"
    private var tciForwardStatus = "Off"
    private var flexForwardRetryAfter = Date.distantPast
    private var tciForwardRetryAfter = Date.distantPast
    private var configurationMutationBusy = false
    private var configurationMutationWaiters: [CheckedContinuation<Void, Never>] = []
    private var terminated = false
    private var contactRefreshRevision: UInt64 = 0
    private var workspaceTransitionCount = 0
    private var contactRefreshState = "not_loaded"
    private var contactRefreshError: String?
    private let beforeContactPublication: (@Sendable () async throws -> Void)?
    private let forwardClassifiedIngressSpots: Bool
    private let spotForward: @Sendable (ClusterRadioSpotPayload, String, Bool) async throws -> Bool
    private let spotRemove: @Sendable (ClusterRadioSpotPayload, String) async throws -> Bool
    private let contestRadioClock: @Sendable () -> Date
    private let beforeContestSpotPublication: @Sendable (Date) async throws -> Void
    private let retirePersistedContestSpots: (@Sendable () async throws -> Void)?
    private var withdrewPriorRadioSpots = false
    private var priorRadioSpotCleanupTask: Task<Void, Never>?
    private var priorRadioSpotCleanupPending = false
    private var priorRadioSpotCutoff: Date?
    private var contestPublisherID: String?
    private var contestPublisherStartedAt = 0
    private var contestPublisherSequence = 0
    private var retiredContestPublisherIDs: [String] = []
    private var contestPublication: ContestRadioPublicationAccumulator?
    private var contestForwardIdentity: (sessionID: String, workspaceGeneration: String)?
    private var contestAppliedIdentity: (sessionID: String, workspaceGeneration: String)?
    private var contestForwardRevision = -1
    private var contestForwardedSpots: [String: ContestForwardedRadioSpot] = [:]
    private var history: LiveSpotHistoryMethods?
    private enum ResumeIntent: String, Codable { case automatic, connected, disconnected }
    private struct ResumeRecord: Codable { let version: Int; let intent: ResumeIntent }
    private var resumeChecked = false
    private var resumeError: String?
    private var resumeLoaded = false
    private var resumeIntent: ResumeIntent?
    private var resumeURL: URL { configurationURL.deletingLastPathComponent().appendingPathComponent("cluster-session.json") }
    private var forwardingAvailable: Bool {
        #if os(macOS)
        true
        #else
        false
        #endif
    }

    init(logbook: LiveLogbookMethods = .shared, configurationURL: URL? = nil,
         vault: any ClusterCredentialStoring = ClusterCredentialVault(),
         transportFactory: @escaping ClusterTransportFactory = { server, password, reconnect, skimmer, state, line in
             makeClusterTCPTransport(server: server, password: password, reconnect: reconnect,
                                     requestSkimmer: skimmer, onState: state, onLine: line)
         }, beforeContactPublication: (@Sendable () async throws -> Void)? = nil,
         forwardClassifiedIngressSpots: Bool = true,
         spotForward: @escaping @Sendable (ClusterRadioSpotPayload, String, Bool) async throws -> Bool = { payload, provider, replacing in
             #if os(macOS)
             return try await SpotForwardBroker.shared.forward(try payload.flexSpot(), provider: provider,
                                                               replacingExisting: replacing)
             #else
             return false
             #endif
         }, spotRemove: @escaping @Sendable (ClusterRadioSpotPayload, String) async throws -> Bool = { payload, provider in
             #if os(macOS)
             return try await SpotForwardBroker.shared.remove(try payload.flexSpot(), provider: provider)
             #else
             return false
             #endif
          }, beforeContestSpotPublication: (@Sendable () async throws -> Void)? = nil,
           priorRadioSpotCleanup: (@Sendable (Date) async throws -> Void)? = nil,
          retirePersistedContestSpots: (@Sendable () async throws -> Void)? = nil,
          contestRadioClock: @escaping @Sendable () -> Date = { Date() }) {
        self.logbook = logbook
        self.vault = CachedClusterCredentialStore(base: vault)
        self.transportFactory = transportFactory
        self.beforeContactPublication = beforeContactPublication
        self.forwardClassifiedIngressSpots = forwardClassifiedIngressSpots
        self.spotForward = spotForward
        self.spotRemove = spotRemove
        self.contestRadioClock = contestRadioClock
        if let priorRadioSpotCleanup {
            self.beforeContestSpotPublication = priorRadioSpotCleanup
        } else if let beforeContestSpotPublication {
            self.beforeContestSpotPublication = { _ in try await beforeContestSpotPublication() }
        } else if logbook === LiveLogbookMethods.shared {
            self.beforeContestSpotPublication = { priorReceiptCutoff in
                #if os(macOS)
                var failure: Error?
                do { _ = try await SpotForwardBroker.shared.withdrawNormalForwardedSpots(acceptedBefore: priorReceiptCutoff) }
                catch { failure = error }
                try Task.checkCancellation()
                do { _ = try await SpotForwardBroker.shared.withdrawContestForwardedSpots(acceptedBefore: priorReceiptCutoff) }
                catch { if failure == nil { failure = error } }
                if let failure { throw failure }
                #endif
            }
        } else {
            self.beforeContestSpotPublication = { _ in }
        }
        if let retirePersistedContestSpots {
            self.retirePersistedContestSpots = retirePersistedContestSpots
        } else if logbook === LiveLogbookMethods.shared {
            #if os(macOS)
            self.retirePersistedContestSpots = {
                _ = try await SpotForwardBroker.shared.withdrawContestForwardedSpots()
            }
            #else
            self.retirePersistedContestSpots = nil
            #endif
        } else {
            self.retirePersistedContestSpots = nil
        }
        self.configurationURL = configurationURL ?? (logbook === LiveLogbookMethods.shared
            ? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
                .appendingPathComponent("OM0RX-xLog Integration Services/cluster.json")
            : logbook.workspaceDirectoryURL.appendingPathComponent("Cluster/cluster.json"))
    }

    @discardableResult func terminate() async -> Bool {
        terminated = true
        let cleanup = priorRadioSpotCleanupTask
        cleanup?.cancel()
        await cleanup?.value
        contactRefreshRevision &+= 1
        var contestSpotsRetired = true
        if let publication = contestPublication, !contestForwardedSpots.isEmpty {
            do {
                let result = try await reconcileContestRadioSpots([], publication: publication, forceReplaceAll: true)
                contestSpotsRetired = result["rejected"] as? Int == 0 && contestForwardedSpots.isEmpty
            } catch {
                contestSpotsRetired = false
            }
        }
        if let retirePersistedContestSpots {
            do {
                try await retirePersistedContestSpots()
                contestSpotsRetired = true
            } catch {
                contestSpotsRetired = false
            }
        }
        if contestSpotsRetired {
            contestForwardedSpots.removeAll()
            contestPublication = nil
            contestForwardIdentity = nil
            contestAppliedIdentity = nil
        }
        await service?.terminate()
        await history?.stop()
        return contestSpotsRetired
    }

    private func requireRunning() throws {
        guard !terminated else { throw WorkerFailure("worker_stopping", "The cluster service has shut down.") }
    }

    public func handle(method: String, params: [String: Any]) async throws -> [String: Any] {
        try requireRunning()
        if method.hasPrefix("spot_history_") {
            let result = try await historyService().handle(method: method, params: params)
            try requireRunning()
            return result
        }
        if method == "cluster_history" {
            return try logbook.handle(method: method, params: params)
        }
        let service = try await readyService()
        try requireRunning()
        let mutatesConfiguration = method == "cluster_configure" || method == "cluster_radio_spots_configure" || method == "cluster_filter"
        if mutatesConfiguration { await beginConfigurationMutation() }
        defer { if mutatesConfiguration { endConfigurationMutation() } }
        try requireRunning()
        switch method {
        case "cluster_contest_radio_spots_publish":
            return try await publishContestRadioSpots(params)
        case "cluster_resume_initialize":
            try require(params, allowed: ["intent"])
            let intent: ResumeIntent?
            if let raw = params["intent"] {
                guard let string = raw as? String, let value = ResumeIntent(rawValue: string) else { throw invalid() }
                intent = value
            } else { intent = nil }
            // Import the old browser preference only once. A stale renderer must
            // never reverse a newer native Connect/Disconnect decision.
            if try readResumeIntent() == nil, let intent { try saveResumeIntent(intent) }
        case "cluster_resume":
            try require(params, allowed: [])
            // Invoked by the native session owner, never by a renderer snapshot.
            if !resumeChecked {
                resumeChecked = true
                let config = try currentConfiguration()
                if config.connectOnStartup && config.servers.contains(where: \.enabled) {
                    do { try await connect(service) }
                    catch { resumeError = "Cluster could not connect automatically. Check its settings and use Connect to retry." }
                }
            }
        case "cluster_snapshot":
            try require(params, allowed: [])
        case "cluster_configure":
            try require(params, allowed: ["configuration", "base_configuration"], required: ["configuration", "base_configuration"])
            guard let object = params["configuration"] as? [String: Any],
                  let baseObject = params["base_configuration"] as? [String: Any] else { throw invalid() }
            let draft: ClusterSessionConfiguration = try decode(object)
            let base: ClusterSessionConfiguration = try decode(baseObject)
            let next = try mergeClusterConfiguration(draft: draft, base: base, current: currentConfiguration())
            try validate(next)
            guard forwardingAvailable || (!next.forwardSpotsToFlex && !next.forwardSpotsToTCI) else {
                throw WorkerFailure("platform_pending", "Radio spot forwarding is not yet available on this platform. Turn forwarding off before saving cluster settings.")
            }
            try await service.configure(next, password: { [vault] id in try vault.load(id) ?? "" })
            try requireRunning()
            configuration = next
            flexForwardStatus = next.forwardSpotsToFlex ? "Enabled; connect the Remote Station Agent." : "Off"
            tciForwardStatus = next.forwardSpotsToTCI ? "Enabled; connect TCI." : "Off"
            try saveConfiguration(next)
        case "cluster_radio_spots_configure":
            try require(params, allowed: ["flex_enabled", "flex_expected", "tci_enabled", "tci_expected",
                                          "color_policy", "color_policy_expected",
                                          "status_colors", "status_color_expected"])
            guard !params.isEmpty,
                  (params["flex_enabled"] == nil) == (params["flex_expected"] == nil),
                  (params["tci_enabled"] == nil) == (params["tci_expected"] == nil),
                  (params["color_policy"] == nil) == (params["color_policy_expected"] == nil),
                  (params["status_colors"] == nil) == (params["status_color_expected"] == nil) else { throw invalid() }
            var next = try currentConfiguration()
            if let rawEnabled = params["flex_enabled"] {
                guard let enabled = rawEnabled as? Bool, let expected = params["flex_expected"] as? Bool else { throw invalid() }
                guard next.forwardSpotsToFlex == expected || next.forwardSpotsToFlex == enabled else { throw configurationConflict() }
                guard forwardingAvailable || !enabled else {
                    throw WorkerFailure("platform_pending", "FLEX spot forwarding is unavailable on this platform.")
                }
                next.forwardSpotsToFlex = enabled
            }
            if let rawEnabled = params["tci_enabled"] {
                guard let enabled = rawEnabled as? Bool, let expected = params["tci_expected"] as? Bool else { throw invalid() }
                guard next.forwardSpotsToTCI == expected || next.forwardSpotsToTCI == enabled else { throw configurationConflict() }
                guard forwardingAvailable || !enabled else {
                    throw WorkerFailure("platform_pending", "TCI spot forwarding is unavailable on this platform.")
                }
                next.forwardSpotsToTCI = enabled
            }
            if let rawPolicy = params["color_policy"] {
                guard let value = rawPolicy as? String, let policy = ClusterSessionConfiguration.RadioSpotColorPolicy(rawValue: value),
                      let expectedValue = params["color_policy_expected"] as? String,
                      let expected = ClusterSessionConfiguration.RadioSpotColorPolicy(rawValue: expectedValue) else { throw invalid() }
                guard next.radioSpotColorPolicy == expected || next.radioSpotColorPolicy == policy else { throw configurationConflict() }
                next.radioSpotColorPolicy = policy
            }
            if let rawColors = params["status_colors"] {
                guard let colors = rawColors as? [String: String], !colors.isEmpty,
                      colors.count <= ClusterPalette.originalDefaults.status.count,
                      let expected = params["status_color_expected"] as? [String: Any],
                      Set(expected.keys) == Set(colors.keys),
                      colors.allSatisfy({ name, color in
                          ClusterPalette.originalDefaults.status[name] != nil &&
                          color.range(of: #"^#[0-9A-Fa-f]{6}$"#, options: .regularExpression) != nil
                      }) else { throw invalid() }
                for (name, color) in colors {
                    let previous = expected[name]
                    guard previous is NSNull || previous as? String != nil else { throw invalid() }
                    guard next.palette.status[name] == previous as? String || next.palette.status[name] == color else {
                        throw configurationConflict()
                    }
                    next.palette.status[name] = color
                }
            }
            try await service.configure(next, password: { [vault] id in try vault.load(id) ?? "" })
            try requireRunning()
            try saveConfiguration(next)
            configuration = next
            flexForwardStatus = next.forwardSpotsToFlex ? "Enabled; waiting for a connected cluster and Remote Station Agent with add_spot." : "Off"
            tciForwardStatus = next.forwardSpotsToTCI ? "Enabled; waiting for a connected cluster and TCI." : "Off"
            flexForwardRetryAfter = .distantPast
            tciForwardRetryAfter = .distantPast
        case "cluster_connect":
            try require(params, allowed: [])
            resumeChecked = true; resumeError = nil
            let passwords = try resolvedPasswords()
            try saveResumeIntent(.connected)
            try await connect(service, passwords: passwords)
        case "cluster_disconnect":
            try require(params, allowed: [])
            resumeChecked = true; resumeError = nil
            // Disk errors must not prevent an explicit disconnect, but must be
            // reported rather than pretending its restart intent was persisted.
            do { try saveResumeIntent(.disconnected) }
            catch {
                await service.disconnect()
                throw WorkerFailure("cluster_intent_persistence", "Cluster disconnected, but its restart preference could not be saved. It may reconnect when the app restarts.")
            }
            await service.disconnect()
        case "cluster_command":
            try require(params, allowed: ["command", "server_id"], required: ["command"])
            guard let command = params["command"] as? String,
                  command.utf8.count <= 160 else { throw invalid() }
            let serverID: UUID?
            if let rawID = params["server_id"] as? String {
                guard let parsed = UUID(uuidString: rawID) else { throw invalid() }
                serverID = parsed
            } else { serverID = nil }
            try await service.sendCommand(command, to: serverID)
        case "cluster_filter":
            try require(params, allowed: ["filter"], required: ["filter"])
            guard let object = params["filter"] as? [String: Any] else { throw invalid() }
            let filter: ClusterSpotFilter = try decode(object)
            try validateFilter(filter)
            var next = try currentConfiguration()
            next.filter = filter
            await service.updateFilter(filter)
            try requireRunning()
            configuration = next
            try saveConfiguration(next)
        case "cluster_password_set":
            try require(params, allowed: ["server_id", "password"], required: ["server_id", "password"])
            guard let rawID = params["server_id"] as? String, let serverID = UUID(uuidString: rawID),
                  try currentConfiguration().servers.contains(where: { $0.id == serverID }),
                  let password = params["password"] as? String,
                  password.utf8.count <= 256, !password.contains("\r"), !password.contains("\n") else { throw invalid() }
            try vault.save(password, serverID: serverID)
        case "cluster_console_clear":
            try require(params, allowed: [])
            await service.clearConsole()
        default:
            throw WorkerFailure("method_not_allowed", "Unknown live cluster method.")
        }
        let (snapshot, truncated) = try await boundedSnapshot(service)
        let contestSpots = await service.contestSpots()
        return ["configuration": try json(currentConfiguration()),
                "snapshot": try json(snapshot), "snapshot_truncated": truncated,
                "contest_spots": try json(contestSpots),
                "password_storage_available": vault.available,
                "resume_error": resumeError as Any? ?? NSNull(),
                "resume_initialized": (try? readResumeIntent()) != nil,
                "flex_forwarding_available": forwardingAvailable,
                "tci_forwarding_available": forwardingAvailable,
                "contact_refresh_state": contactRefreshState,
                "contact_refresh_error": contactRefreshError as Any? ?? NSNull(),
                "password_servers": try currentConfiguration().servers.filter { try vault.load($0.id) != nil }.map { $0.id.uuidString },
                "forwarding": ["accepted_count": forwardAcceptedCount,
                               "status": "FLEX: \(flexForwardStatus) · TCI: \(tciForwardStatus)\(priorRadioSpotCleanupNotice)",
                               "flex_status": flexForwardStatus + (configuration?.forwardSpotsToFlex == true ? priorRadioSpotCleanupNotice : ""),
                               "tci_status": tciForwardStatus + (configuration?.forwardSpotsToTCI == true ? priorRadioSpotCleanupNotice : ""),
                               "prior_spot_cleanup_pending": priorRadioSpotCleanupPending]]
    }

    private func resolvedPasswords() throws -> [UUID: String] {
        var passwords: [UUID: String] = [:]
        for server in try currentConfiguration().servers.filter(\.enabled) {
            passwords[server.id] = try vault.load(server.id) ?? ""
        }
        return passwords
    }

    private func connect(_ service: ClusterSessionService, passwords preloadedPasswords: [UUID: String]? = nil) async throws {
        let workspaceStatus = try logbook.handle(method: "workspace_status", params: [:])
        if workspaceStatus["workspace_exists"] as? Bool == true { try await refreshContacts() }
        else {
            contactRefreshRevision &+= 1
            let revision = contactRefreshRevision
            contactRefreshState = "not_loaded"; contactRefreshError = nil
            await service.invalidateContacts(publicationRevision: revision)
        }
        try requireRunning()
        let passwords = try preloadedPasswords ?? resolvedPasswords()
        try await service.connect(passwords: passwords)
    }

    private func validateResumePath() throws {
        try validateConfigurationPath()
        if FileManager.default.fileExists(atPath: resumeURL.path),
           try resumeURL.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink == true {
            throw WorkerFailure("unsafe_configuration", "Cluster session intent cannot use a symbolic link.")
        }
    }
    private func readResumeIntent() throws -> ResumeIntent? {
        if resumeLoaded { return resumeIntent }
        try validateResumePath()
        guard FileManager.default.fileExists(atPath: resumeURL.path) else { resumeLoaded = true; return nil }
        let data = try Data(contentsOf: resumeURL)
        guard data.count <= 1024 else { throw invalid() }
        let record = try JSONDecoder().decode(ResumeRecord.self, from: data)
        guard record.version == 1 else { throw invalid() }
        resumeIntent = record.intent; resumeLoaded = true
        return record.intent
    }
    private func saveResumeIntent(_ intent: ResumeIntent) throws {
        try validateResumePath()
        try FileManager.default.createDirectory(at: resumeURL.deletingLastPathComponent(), withIntermediateDirectories: true,
                                               attributes: LocalFilePermissions.directoryAttributes)
        try JSONEncoder().encode(ResumeRecord(version: 1, intent: intent)).write(to: resumeURL, options: .atomic)
        try LocalFilePermissions.protectFile(resumeURL)
        resumeIntent = intent; resumeLoaded = true
    }

    /// Read an already running cluster without starting services or scanning contacts.
    func currentSpotRowsIfStarted() async -> [[String: Any]] {
        guard let service, let (snapshot, _) = try? await boundedSnapshot(service),
              let object = try? json(snapshot) as? [String: Any] else { return [] }
        return object["spots"] as? [[String: Any]] ?? []
    }
    /// Annotation reads only an existing current contact projection. Opening a
    /// CW view cannot scan the database or start a cluster connection.
    func classifyCWIfCurrent(call:String,frequencyHz:Int64) async -> ClusterClassification? {
        guard !terminated,workspaceTransitionCount==0,contactRefreshState=="current",let service else{return nil}
        let revision=contactRefreshRevision
        let value=await service.classifyLocalCW(call:call,frequencyHz:frequencyHz)
        guard !terminated,workspaceTransitionCount==0,contactRefreshState=="current",revision==contactRefreshRevision else{return nil}
        return value
    }

    /// Called after local QSO mutations, import, restore or remote reconciliation.
    public func refreshContacts() async throws {
        try requireRunning()
        guard workspaceTransitionCount == 0 else {
            throw WorkerFailure("workspace_changed", "Wait for the workspace replacement to finish.")
        }
        contactRefreshRevision &+= 1
        let revision = contactRefreshRevision
        contactRefreshState = "refreshing"; contactRefreshError = nil
        do {
            try Task.checkCancellation()
            let service = try await readyService(refreshInitialContacts: false)
            let database = try logbook.openedDatabase()
            let contacts = try database.clusterContactRows()
            var records: [ClusterContact] = []
            records.reserveCapacity(contacts.count)
            let resolver = try? CTYResolver.bundled()
            for qso in contacts {
                try Task.checkCancellation()
                records.append(ClusterContact(callsign: qso.call, band: qso.band,
                                              mode: qso.mode,
                                              adif: qso.dxcc ?? resolver?.resolve(qso.call, at: qso.start)?.adif,
                                              date: qso.start, paperQSL: qso.qslReceived,
                                              lotwQSL: qso.lotwReceived))
            }
            if let beforeContactPublication { try await beforeContactPublication() }
            try requireRunning()
            try Task.checkCancellation()
            guard revision == contactRefreshRevision, database === (try logbook.openedDatabase()) else {
                throw WorkerFailure("workspace_changed", "The contact projection belongs to an earlier workspace.")
            }
            let published = await service.replaceContacts(records, publicationRevision: revision)
            try Task.checkCancellation()
            guard published, revision == contactRefreshRevision, !terminated else { return }
            contactRefreshState = "current"
        } catch {
            if revision == contactRefreshRevision, !terminated {
                contactRefreshState = "stale"
                contactRefreshError = "CONTACT_REFRESH_UNAVAILABLE"
            }
            throw error
        }
    }

    func invalidateContactsForWorkspaceChange() async {
        workspaceTransitionCount += 1
        contactRefreshRevision &+= 1
        contactRefreshState = "not_loaded"; contactRefreshError = nil
        await service?.invalidateContacts(publicationRevision: contactRefreshRevision)
    }

    func finishWorkspaceChange() {
        workspaceTransitionCount = max(0, workspaceTransitionCount - 1)
    }

    /// Keep the full in-memory history while fitting a bounded worker response.
    /// Trim oldest console lines first, then least-recent visible spots if needed.
    private func boundedSnapshot(_ service: ClusterSessionService) async throws -> (ClusterSessionSnapshot, Bool) {
        var snapshot = await service.snapshot()
        var truncated = false
        while try JSONEncoder().encode(snapshot).count > 800_000 {
            truncated = true
            if snapshot.console.count > 40 {
                snapshot.console.removeFirst(max(1, snapshot.console.count / 4))
            } else if snapshot.spots.count > 1 {
                snapshot.spots.removeLast(max(1, snapshot.spots.count / 4))
            } else { break }
        }
        return (snapshot, truncated)
    }

    private func readyService(refreshInitialContacts: Bool = true) async throws -> ClusterSessionService {
        try requireRunning()
        if let service { return service }
        let config: ClusterSessionConfiguration
        try validateConfigurationPath()
        if FileManager.default.fileExists(atPath: configurationURL.path) {
            let data = try Data(contentsOf: configurationURL)
            guard data.count <= 262_144 else { throw invalid() }
            config = try JSONDecoder().decode(ClusterSessionConfiguration.self, from: data)
            try validate(config)
        } else {
            config = ClusterSessionConfiguration(servers: [])
        }
        let archive = historyService()
        let created = ClusterSessionService(configuration: config, onSpot: { [weak self] spot, generation in
            Task { await self?.forwardSpotIfEnabled(spot, generation: generation) }
        }, onObservation: { archive.observe($0) }, onHistoryConnection: { archive.connection($0) }, transportFactory: transportFactory)
        configuration = config
        flexForwardStatus = config.forwardSpotsToFlex ? (forwardingAvailable ? "Enabled; connect a cluster and Remote Station Agent." : "Unavailable on this platform") : "Off"
        tciForwardStatus = config.forwardSpotsToTCI ? (forwardingAvailable ? "Enabled; connect a cluster and TCI." : "Unavailable on this platform") : "Off"
        service = created
        if let csv = try? CTYResolver.bundledCSV() { await created.replaceCountryCSV(csv) }
        if refreshInitialContacts, workspaceTransitionCount == 0, (try logbook.handle(method: "workspace_status", params: [:]))["workspace_exists"] as? Bool == true {
            try await refreshContacts()
        }
        return created
    }

    /// Native CW acceptance enters the same classification/history owner;
    /// callers never publish through a loopback connection or a renderer RPC.
    func ingestLocalCW(_ spot: XCWCore.CWConfirmedSpot,stationCallsign:String) async throws -> Bool {
        try requireRunning()
        let service=try await readyService()
        try requireRunning()
        return try await service.ingestLocalCW(spot,stationCallsign:stationCallsign)
    }
    func prepareLocalCWListener() async throws {
        let service=try await readyService(refreshInitialContacts:false)
        try requireRunning()
        try await service.prepareLocalCWListener()
    }

    private func validateConfigurationPath() throws {
        for url in [configurationURL.deletingLastPathComponent(), configurationURL] {
            if FileManager.default.fileExists(atPath: url.path),
               try url.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink == true {
                throw WorkerFailure("unsafe_configuration", "Cluster configuration cannot use a symbolic link.")
            }
        }
    }

    private func historyService() -> LiveSpotHistoryMethods {
        if let history { return history }
        let created = LiveSpotHistoryMethods(url: configurationURL.deletingLastPathComponent().appendingPathComponent("spot-history.sqlite"))
        history = created
        return created
    }

    private func saveConfiguration(_ value: ClusterSessionConfiguration) throws {
        try validateConfigurationPath()
        let directory = configurationURL.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                                               attributes: LocalFilePermissions.directoryAttributes)
        try JSONEncoder().encode(value).write(to: configurationURL, options: .atomic)
        try LocalFilePermissions.protectFile(configurationURL)
    }

    private func forwardSpotIfEnabled(_ spot: ClassifiedClusterSpot, generation: UUID) async {
        #if os(macOS)
        guard forwardClassifiedIngressSpots,
              let config = configuration,
              config.forwardSpotsToFlex || config.forwardSpotsToTCI,
              let service,
              await service.isVisibleSpot(spot.id, in: generation) else { return }
        let now = Date()
        let frequencyHz = Int64((spot.frequencyKHz * 1_000).rounded())
        guard (100_000...60_000_000).contains(frequencyHz),
              abs(now.timeIntervalSince(spot.receivedAt)) < 86_400 else { return }
        let payload = ClusterRadioSpotPayload(frequencyHz: frequencyHz, callsign: spot.callsign,
                                              mode: spot.mode, source: "xLog xCluster", spotter: spot.spotter,
                                              comment: spot.comment,
                                              timestamp: Int64(spot.receivedAt.timeIntervalSince1970),
                                              lifetimeSeconds: 600, priority: 3,
                                              colorHex: radioSpotColor(for: spot))
        guard !payload.mode.isEmpty else { return }
        let destinations = [(config.forwardSpotsToFlex, "direct_agent"), (config.forwardSpotsToTCI, "direct_tci")]
        for (enabled, provider) in destinations where enabled {
            let retryAfter = provider == "direct_agent" ? flexForwardRetryAfter : tciForwardRetryAfter
            guard now >= retryAfter else { continue }
            do {
                if try await spotForward(payload, provider, false) {
                    forwardAcceptedCount += 1
                    if provider == "direct_agent" {
                        flexForwardStatus = "Accepted by Remote Station Agent; FLEX/Maestro display is not verified."
                    } else {
                        tciForwardStatus = "Sent through TCI; SunSDR display is not verified."
                    }
                }
            } catch {
                if provider == "direct_agent" {
                    flexForwardStatus = "FLEX forwarding failed: \(error.localizedDescription)"
                    flexForwardRetryAfter = now.addingTimeInterval(60)
                } else {
                    tciForwardStatus = "TCI forwarding failed: \(error.localizedDescription)"
                    tciForwardRetryAfter = now.addingTimeInterval(60)
                }
            }
        }
        #endif
    }

    private func publishContestRadioSpots(_ params: [String: Any]) async throws -> [String: Any] {
        try require(params, allowed: ["publisher_id", "publisher_started_at", "publication_sequence", "action", "session_id",
                                      "workspace_generation", "revision", "configured_bands", "allowed_mode_groups",
                                      "chunk_index", "chunk_count", "spots"],
                    required: ["publisher_id", "publisher_started_at", "publication_sequence", "action", "session_id",
                               "workspace_generation", "revision", "configured_bands", "allowed_mode_groups",
                               "chunk_index", "chunk_count", "spots"])
        guard let publisherID = params["publisher_id"] as? String, UUID(uuidString: publisherID) != nil,
              let publisherStartedAt = params["publisher_started_at"] as? Int, publisherStartedAt > 0,
              let sequence = params["publication_sequence"] as? Int, sequence > 0,
              let action = params["action"] as? String, ["replace", "clear"].contains(action),
              let sessionID = params["session_id"] as? String, UUID(uuidString: sessionID) != nil,
              let workspaceGeneration = params["workspace_generation"] as? String, UUID(uuidString: workspaceGeneration) != nil,
              let revision = params["revision"] as? Int, revision >= 0,
              let configuredBands = params["configured_bands"] as? [String],
              !configuredBands.isEmpty, configuredBands.count <= 32,
              Set(configuredBands).count == configuredBands.count,
              Set(configuredBands).isSubset(of: Set(SpotLogic.bands)),
              let allowedModeGroups = params["allowed_mode_groups"] as? [String],
              !allowedModeGroups.isEmpty, allowedModeGroups.count <= 3,
              Set(allowedModeGroups).count == allowedModeGroups.count,
              Set(allowedModeGroups).isSubset(of: ["cw", "phone", "data"]),
              let chunkIndex = params["chunk_index"] as? Int,
              let chunkCount = params["chunk_count"] as? Int, (1...8).contains(chunkCount),
              (0..<chunkCount).contains(chunkIndex),
              let rawSpots = params["spots"] as? [[String: Any]], rawSpots.count <= 64,
              JSONSerialization.isValidJSONObject(rawSpots),
              let data = try? JSONSerialization.data(withJSONObject: rawSpots),
              let spots = try? JSONDecoder().decode([ContestRadioSpotInput].self, from: data),
              action == "replace" || chunkCount == 1 && chunkIndex == 0 && spots.isEmpty else { throw invalid() }

        if retiredContestPublisherIDs.contains(publisherID) {
            return Self.staleContestPublication(revision: revision, workspaceGeneration: workspaceGeneration)
        }
        if contestPublisherID != publisherID {
            guard sequence == 1, contestPublisherID == nil || publisherStartedAt > contestPublisherStartedAt else {
                return Self.staleContestPublication(revision: revision, workspaceGeneration: workspaceGeneration)
            }
            if let previous = contestPublisherID {
                retiredContestPublisherIDs.append(previous)
                if retiredContestPublisherIDs.count > 32 { retiredContestPublisherIDs.removeFirst(8) }
            }
            contestPublisherID = publisherID
            contestPublisherStartedAt = publisherStartedAt
            contestPublisherSequence = 1
            contestPublication = nil
        } else if sequence < contestPublisherSequence {
            return Self.staleContestPublication(revision: revision, workspaceGeneration: workspaceGeneration)
        } else if sequence > contestPublisherSequence {
            contestPublisherSequence = sequence
            contestPublication = nil
        }

        let incomingIdentity = (sessionID: sessionID, workspaceGeneration: workspaceGeneration)
        if let active = contestForwardIdentity,
           active.sessionID == sessionID, active.workspaceGeneration == workspaceGeneration,
           revision < contestForwardRevision {
            return Self.staleContestPublication(revision: revision, workspaceGeneration: workspaceGeneration)
        }
        if action == "clear", let active = contestForwardIdentity,
           active.sessionID != sessionID || active.workspaceGeneration != workspaceGeneration {
            return Self.staleContestPublication(revision: revision, workspaceGeneration: workspaceGeneration)
        }

        if contestPublication == nil {
            contestPublication = ContestRadioPublicationAccumulator(
                publisherID: publisherID, sequence: sequence, sessionID: sessionID,
                workspaceGeneration: workspaceGeneration, revision: revision, action: action,
                configuredBands: configuredBands, allowedModeGroups: allowedModeGroups,
                chunkCount: chunkCount, chunks: [:])
        }
        guard var publication = contestPublication,
              publication.publisherID == publisherID, publication.sequence == sequence,
              publication.sessionID == sessionID, publication.workspaceGeneration == workspaceGeneration,
              publication.revision == revision, publication.action == action,
              publication.configuredBands == configuredBands,
              publication.allowedModeGroups == allowedModeGroups,
              publication.chunkCount == chunkCount else {
            return Self.staleContestPublication(revision: revision, workspaceGeneration: workspaceGeneration)
        }
        publication.chunks[chunkIndex] = spots
        guard publication.chunks.values.reduce(0, { $0 + $1.count }) <= 512 else { throw invalid() }
        contestPublication = publication
        guard publication.chunks.count == chunkCount else {
            return ["accepted": 0, "removed": 0, "unchanged": 0, "filtered": 0, "rejected": 0,
                    "pending": true, "stale": false, "revision": revision,
                    "workspace_generation": workspaceGeneration]
        }
        let orderedSpots = action == "clear" ? [] : (0..<chunkCount).flatMap { publication.chunks[$0] ?? [] }
        guard Set(orderedSpots.map(\.spotID)).count == orderedSpots.count else { throw invalid() }
        let previousIdentity = contestForwardIdentity
        let sameIdentity = previousIdentity?.sessionID == sessionID
            && previousIdentity?.workspaceGeneration == workspaceGeneration
        contestForwardIdentity = incomingIdentity
        contestForwardRevision = sameIdentity ? max(contestForwardRevision, revision) : revision
        let identityChanged = contestAppliedIdentity != nil
            && (contestAppliedIdentity?.sessionID != sessionID || contestAppliedIdentity?.workspaceGeneration != workspaceGeneration)
        // The service may have spent hours in Normal Logging. Freeze the
        // boundary at first admitted contest delivery, never at service creation
        // or after current spots have been accepted.
        if priorRadioSpotCutoff == nil { priorRadioSpotCutoff = contestRadioClock() }
        var result = try await reconcileContestRadioSpots(orderedSpots, publication: publication,
                                                          forceReplaceAll: identityChanged)
        if result["rejected"] as? Int == 0 {
            contestAppliedIdentity = action == "clear" ? nil : incomingIdentity
        }
        schedulePriorRadioSpotCleanup()
        result["prior_spot_cleanup_pending"] = priorRadioSpotCleanupPending
        return result
    }

    private var priorRadioSpotCleanupNotice: String {
        priorRadioSpotCleanupPending ? " Prior radio spot cleanup pending; current spot delivery remains enabled." : ""
    }

    private func schedulePriorRadioSpotCleanup() {
        guard !terminated, !withdrewPriorRadioSpots, priorRadioSpotCleanupTask == nil,
              let cutoff = priorRadioSpotCutoff else { return }
        priorRadioSpotCleanupPending = true
        // Cleanup belongs to this service, but never holds up an admitted
        // current publication. Failed receipts remain available for a later try.
        priorRadioSpotCleanupTask = Task { [weak self] in
            guard let self else { return }
            await self.cleanupPriorRadioSpots(acceptedBefore: cutoff)
        }
    }

    private func cleanupPriorRadioSpots(acceptedBefore cutoff: Date) async {
        defer { priorRadioSpotCleanupTask = nil }
        do {
            try Task.checkCancellation()
            try await beforeContestSpotPublication(cutoff)
            try Task.checkCancellation()
            guard !terminated else { return }
            withdrewPriorRadioSpots = true
            priorRadioSpotCleanupPending = false
        } catch {
            // The next complete, admitted publication retries. Keep this
            // separate from the current add/ack status shown to the operator.
            priorRadioSpotCleanupPending = true
        }
    }

    private func reconcileContestRadioSpots(_ spots: [ContestRadioSpotInput],
                                            publication: ContestRadioPublicationAccumulator,
                                            forceReplaceAll: Bool) async throws -> [String: Any] {
        let config = try currentConfiguration()
        let enabledProviders = Set([(config.forwardSpotsToFlex, "direct_agent"),
                                    (config.forwardSpotsToTCI, "direct_tci")].filter(\.0).map(\.1))
        let now = contestRadioClock(), bandSet = Set(publication.configuredBands), modeSet = Set(publication.allowedModeGroups)
        var desired: [String: ContestForwardedRadioSpot] = [:]
        var filtered = 0
        if forwardingAvailable {
            for spot in spots {
                guard !spot.spotID.isEmpty, spot.spotID.utf8.count <= 128,
                      !spot.callsign.isEmpty, spot.callsign.utf8.count <= 32,
                      spot.spotter.utf8.count <= 32, spot.comment.utf8.count <= 96,
                      bandSet.contains(spot.band), modeSet.contains(Self.contestModeGroup(spot.mode)),
                      SpotLogic.band(for: Double(spot.frequencyHz) / 1_000) == spot.band,
                      (100_000...60_000_000).contains(spot.frequencyHz) else { filtered += 1; continue }
                let unixTimestamp = spot.timestamp < 1_000_000_000
                    ? spot.timestamp + Date.timeIntervalBetween1970AndReferenceDate : spot.timestamp
                guard unixTimestamp.isFinite, abs(now.timeIntervalSince1970 - unixTimestamp) <= 86_400 else {
                    filtered += 1; continue
                }
                let presentation = Self.contestRadioPresentation(for: spot)
                let payload = ClusterRadioSpotPayload(
                    frequencyHz: spot.frequencyHz, callsign: spot.callsign, mode: spot.mode,
                    source: "xLog Contest", spotter: spot.spotter, comment: spot.comment,
                    timestamp: Int64(unixTimestamp.rounded()), lifetimeSeconds: 600,
                    priority: presentation.priority, colorHex: presentation.colorHex)
                let signature = "\(payload.callsign)|\(payload.frequencyHz)|\(payload.mode)|\(payload.colorHex)|\(payload.spotter)|\(payload.comment)"
                for provider in enabledProviders {
                    desired["\(provider)|\(spot.spotID)"] = ContestForwardedRadioSpot(
                        spotID: spot.spotID, payload: payload, signature: signature, forwardedAt: now)
                }
            }
        }

        var accepted = 0, removed = 0, unchanged = 0, rejected = 0
        var obsoleteKeys = Set(contestForwardedSpots.keys.filter { key in
            if forceReplaceAll { return true }
            guard let current = contestForwardedSpots[key], let next = desired[key] else { return true }
            return current.signature != next.signature
        })
        // TCI's official SPOT_DELETE frame is callsign-scoped. If one retained
        // TCI spot for a callsign changes, remove and replay every desired spot
        // for that callsign so an unchanged sibling frequency is not silently
        // erased on the radio while remaining in our reconciliation state.
        let tciCallsignsToReplay = Set(obsoleteKeys.compactMap { key -> String? in
            guard key.hasPrefix("direct_tci|"), let current = contestForwardedSpots[key] else { return nil }
            return current.payload.callsign
        })
        if !tciCallsignsToReplay.isEmpty {
            for (key, current) in contestForwardedSpots where key.hasPrefix("direct_tci|")
                && tciCallsignsToReplay.contains(current.payload.callsign) {
                obsoleteKeys.insert(key)
            }
        }
        var removedTCICallsigns: [String: Bool] = [:]
        for key in obsoleteKeys.sorted() {
            guard let current = contestForwardedSpots[key], let provider = key.split(separator: "|").first.map(String.init) else {
                contestForwardedSpots.removeValue(forKey: key); continue
            }
            if provider == "direct_tci" {
                if removedTCICallsigns[current.payload.callsign] != nil { continue }
                do {
                    let accepted = try await spotRemove(current.payload, provider)
                    removedTCICallsigns[current.payload.callsign] = accepted
                    if !accepted { rejected += 1 }
                } catch {
                    removedTCICallsigns[current.payload.callsign] = false
                    rejected += 1
                    tciForwardStatus = "TCI contest spot removal failed; check the Radio spots diagnostics."
                }
                continue
            }
            do {
                if try await spotRemove(current.payload, provider) {
                    contestForwardedSpots.removeValue(forKey: key)
                    removed += 1
                } else { rejected += 1 }
            } catch {
                rejected += 1
                if provider == "direct_agent" {
                    flexForwardStatus = "FLEX contest spot removal failed; check the Radio spots diagnostics."
                } else {
                    tciForwardStatus = "TCI contest spot removal failed; check the Radio spots diagnostics."
                }
            }
        }
        for key in obsoleteKeys where key.hasPrefix("direct_tci|") {
            guard let current = contestForwardedSpots[key], removedTCICallsigns[current.payload.callsign] == true else { continue }
            contestForwardedSpots.removeValue(forKey: key)
            removed += 1
        }
        for (key, next) in desired {
            if let current = contestForwardedSpots[key] {
                guard current.signature == next.signature else { rejected += 1; continue }
                // The radio expires spots after 600 seconds. A fresh, fully
                // admitted publication renews retained spots before that lease
                // ends; unchanged classification must not suppress them forever.
                if now.timeIntervalSince(current.forwardedAt) < 480 { unchanged += 1; continue }
            }
            guard let provider = key.split(separator: "|").first.map(String.init) else { rejected += 1; continue }
            do {
                if try await spotForward(next.payload, provider, true) {
                    contestForwardedSpots[key] = ContestForwardedRadioSpot(
                        spotID: next.spotID, payload: next.payload, signature: next.signature,
                        forwardedAt: contestRadioClock())
                    accepted += 1
                    forwardAcceptedCount += 1
                } else { rejected += 1 }
            } catch {
                rejected += 1
                if provider == "direct_agent" {
                    flexForwardStatus = "FLEX contest spot forwarding failed; check the Radio spots diagnostics."
                } else {
                    tciForwardStatus = "TCI contest spot forwarding failed; check the Radio spots diagnostics."
                }
            }
        }
        if accepted > 0 {
            if enabledProviders.contains("direct_agent") {
                flexForwardStatus = "Contest spots accepted by Remote Station Agent; FLEX/Maestro display is not verified."
            }
            if enabledProviders.contains("direct_tci") {
                tciForwardStatus = "Contest spots sent through TCI; SunSDR display is not verified."
            }
        }
        return ["accepted": accepted, "removed": removed, "unchanged": unchanged, "filtered": filtered,
                "rejected": rejected, "pending": false, "stale": false,
                "revision": publication.revision, "workspace_generation": publication.workspaceGeneration]
    }

    private static func staleContestPublication(revision: Int, workspaceGeneration: String) -> [String: Any] {
        ["accepted": 0, "removed": 0, "unchanged": 0, "filtered": 0, "rejected": 0,
         "pending": false, "stale": true, "revision": revision,
         "workspace_generation": workspaceGeneration]
    }

    private static func contestModeGroup(_ mode: String) -> String {
        switch mode.uppercased() {
        case "CW", "CWR": return "cw"
        case "SSB", "USB", "LSB", "AM", "FM", "NFM": return "phone"
        default: return "data"
        }
    }

    private static func contestRadioPresentation(for spot: ContestRadioSpotInput) -> (colorHex: String, priority: Int) {
        if spot.dupe == true { return ("#AEB5B7", 2) }
        let multipliers: Int? = if let country = spot.countryMultiplier, let zone = spot.zoneMultiplier {
            (country ? 1 : 0) + (zone ? 1 : 0)
        } else { spot.multiplierCount }
        if let multipliers, multipliers > 1 { return ("#00E51B", 5) }
        if multipliers == 1 { return ("#FF5267", 4) }
        if multipliers == 0, spot.dupe == false, spot.points != nil { return ("#3DA5F4", 3) }
        return ("#AEB5B7", 2)
    }

    private func radioSpotColor(for spot: ClassifiedClusterSpot) -> String {
        let config = configuration
        let status = config?.radioSpotColorPolicy == .dxcc ? spot.dxccStatus : spot.callStatus
        let color = config?.palette.status[status] ?? ClusterPalette.originalDefaults.status[status] ?? "#777F8C"
        return color.range(of: #"^#[0-9A-Fa-f]{6}$"#, options: .regularExpression) == nil ? "#777F8C" : color
    }

    private func currentConfiguration() throws -> ClusterSessionConfiguration {
        guard let configuration else { throw WorkerFailure("cluster_unavailable", "Cluster settings are unavailable.") }
        return configuration
    }

    private func configurationConflict() -> WorkerFailure {
        WorkerFailure("configuration_conflict", "Cluster settings changed in another window. Refresh before saving.")
    }

    private func mergeClusterConfiguration(draft: ClusterSessionConfiguration, base: ClusterSessionConfiguration,
                                           current: ClusterSessionConfiguration) throws -> ClusterSessionConfiguration {
        var next = current
        func merge<T: Equatable>(_ keyPath: WritableKeyPath<ClusterSessionConfiguration, T>) throws {
            let edited = draft[keyPath: keyPath]
            let previous = base[keyPath: keyPath]
            guard edited != previous else { return }
            let latest = current[keyPath: keyPath]
            guard latest == previous || latest == edited else { throw configurationConflict() }
            next[keyPath: keyPath] = edited
        }
        try merge(\.servers)
        try merge(\.connectOnStartup)
        try merge(\.requestRecentSpotsOnConnect)
        try merge(\.reconnect)
        try merge(\.requestSkimmer)
        try merge(\.showWorkedBandModeSpots)
        try merge(\.hideWSPRSpots)
        try merge(\.maximumSpots)
        try merge(\.specialRules)
        try merge(\.filter)
        try merge(\.commandPresets)
        next.palette.status = try mergeColors(draft.palette.status, base.palette.status, current.palette.status)
        next.palette.band = try mergeColors(draft.palette.band, base.palette.band, current.palette.band)
        next.palette.mode = try mergeColors(draft.palette.mode, base.palette.mode, current.palette.mode)
        return next
    }

    private func mergeColors(_ draft: [String: String], _ base: [String: String],
                             _ current: [String: String]) throws -> [String: String] {
        var merged = current
        for name in Set(base.keys).union(draft.keys) where draft[name] != base[name] {
            guard current[name] == base[name] || current[name] == draft[name] else { throw configurationConflict() }
            merged[name] = draft[name]
        }
        return merged
    }

    private func beginConfigurationMutation() async {
        if configurationMutationBusy {
            await withCheckedContinuation { continuation in configurationMutationWaiters.append(continuation) }
        } else { configurationMutationBusy = true }
    }

    private func endConfigurationMutation() {
        if configurationMutationWaiters.isEmpty { configurationMutationBusy = false }
        else { configurationMutationWaiters.removeFirst().resume() }
    }

    private func validate(_ value: ClusterSessionConfiguration) throws {
        guard value.servers.count <= 16, Set(value.servers.map(\.id)).count == value.servers.count,
              (1...500).contains(value.maximumSpots), value.specialRules.count <= 64,
              value.commandPresets.count <= 32,
              Set(value.commandPresets.map(\.id)).count == value.commandPresets.count else { throw invalid() }
        try validateFilter(value.filter)
        for server in value.servers {
            guard server.name.utf8.count <= 80, server.host.utf8.count <= 253,
                  server.callsign.utf8.count <= 24, (1...65_535).contains(server.port) else { throw invalid() }
        }
        for rule in value.specialRules {
            guard rule.name.utf8.count <= 80, rule.keywords.count <= 16,
                  rule.advancedPattern.utf8.count <= 256,
                  rule.keywords.allSatisfy({ $0.utf8.count <= 80 }) else { throw invalid() }
            if !rule.advancedPattern.isEmpty {
                guard (try? NSRegularExpression(pattern: rule.advancedPattern)) != nil else { throw invalid() }
            }
        }
        for preset in value.commandPresets {
            guard !preset.name.isEmpty, preset.name.utf8.count <= 80,
                  !preset.command.isEmpty, preset.command.utf8.count <= 160,
                  preset.command.unicodeScalars.allSatisfy({ (32...126).contains($0.value) }) else { throw invalid() }
        }
        let colors = [value.palette.status, value.palette.band, value.palette.mode]
        guard colors.allSatisfy({ $0.count <= 100 && $0.allSatisfy { key, color in
            key.utf8.count <= 80 && color.range(of: #"^#[0-9A-Fa-f]{6}$"#, options: .regularExpression) != nil
        } }) else { throw invalid() }
    }

    private func validateFilter(_ value: ClusterSpotFilter) throws {
        let selections = [value.bands, value.modes, value.continents, value.spotterContinents, value.callStatuses,
                          value.dxccStatuses, value.specials, value.excludedSpecials, value.sources, value.worked]
        guard value.query.utf8.count <= 128,
              !value.query.unicodeScalars.contains(where: { $0.value < 0x20 }),
              selections.allSatisfy({ $0.count <= 64 && $0.allSatisfy { !$0.isEmpty && $0.utf8.count <= 80 } }),
              value.specials.isDisjoint(with: value.excludedSpecials),
              value.bands.isSubset(of: Set(SpotLogic.bands)),
              value.modes.isSubset(of: Set(SpotLogic.modes)),
              value.continents.isSubset(of: ["AF", "AN", "AS", "EU", "NA", "OC", "SA"]),
              value.spotterContinents.isSubset(of: ["AF", "AN", "AS", "EU", "NA", "OC", "SA"]),
              value.callStatuses.isSubset(of: ["New Call", "New Band", "New Mode", "New Band+Mode", "Worked", "Confirmed", "Unknown"]),
              value.dxccStatuses.isSubset(of: ["ATNO", "C/New Band", "C/New Mode", "C/New Band+Mode",
                                           "W/New Band", "W/New Mode", "W/New Band+Mode", "Worked", "Confirmed", "Unknown"]),
              value.sources.isSubset(of: ["cluster", "rbl", "local_cw"]),
              value.worked.isSubset(of: ["Worked before", "Not worked"]) else { throw invalid() }
    }

    private func require(_ params: [String: Any], allowed: Set<String>, required: Set<String> = []) throws {
        guard Set(params.keys).isSubset(of: allowed), required.isSubset(of: Set(params.keys)) else { throw invalid() }
    }

    private func decode<T: Decodable>(_ object: [String: Any]) throws -> T {
        guard JSONSerialization.isValidJSONObject(object) else { throw invalid() }
        return try JSONDecoder().decode(T.self, from: JSONSerialization.data(withJSONObject: object))
    }

    private func json<T: Encodable>(_ value: T) throws -> Any {
        try JSONSerialization.jsonObject(with: JSONEncoder().encode(value))
    }

    private func invalid() -> WorkerFailure {
        WorkerFailure("invalid_params", "Invalid cluster settings or request.")
    }
}

struct ClusterCredentialVault: ClusterCredentialStoring {
    #if os(macOS)
    var available: Bool { true }
    private let service = "com.oliverbross.xlog.integration.cluster"

    func load(_ id: UUID) throws -> String? {
        let authentication = LAContext()
        authentication.interactionNotAllowed = true
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                    kSecAttrService as String: service,
                                    kSecAttrAccount as String: id.uuidString,
                                    kSecReturnData as String: true,
                                    kSecMatchLimit as String: kSecMatchLimitOne,
                                    kSecUseAuthenticationContext as String: authentication]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = item as? Data,
              let password = String(data: data, encoding: .utf8) else {
            throw WorkerFailure("credential_failed", "Could not read the cluster password from Keychain.")
        }
        return password
    }

    func hasPassword(_ id: UUID) throws -> Bool { try load(id) != nil }

    func save(_ password: String, serverID: UUID) throws {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                    kSecAttrService as String: service,
                                    kSecAttrAccount as String: serverID.uuidString]
        if password.isEmpty {
            let status = SecItemDelete(query as CFDictionary)
            guard status == errSecSuccess || status == errSecItemNotFound else {
                throw WorkerFailure("credential_failed", "Could not remove the cluster password from Keychain.")
            }
            return
        }
        let value = Data(password.utf8)
        let update = SecItemUpdate(query as CFDictionary, [kSecValueData as String: value] as CFDictionary)
        if update == errSecSuccess { return }
        guard update == errSecItemNotFound else {
            throw WorkerFailure("credential_failed", "Could not update the cluster password in Keychain.")
        }
        var item = query
        item[kSecValueData as String] = value
        let status = SecItemAdd(item as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw WorkerFailure("credential_failed", "Could not save the cluster password in Keychain.")
        }
    }
    #elseif os(Windows)
    var available: Bool { NativeCredentialStore.supported }
    private let store = NativeCredentialStore(service: "com.oliverbross.xlog.integration.cluster")
    func load(_ id: UUID) throws -> String? { try store.load(id.uuidString) }
    func save(_ password: String, serverID: UUID) throws { try store.save(password, account: serverID.uuidString) }
    #else
    var available: Bool { false }
    func load(_ id: UUID) throws -> String? { nil }
    func save(_ password: String, serverID: UUID) throws {
        throw WorkerFailure("credential_unavailable", "Secure cluster password storage is unavailable on this platform. No credential was saved or removed.")
    }
    #endif
}

import Foundation
import XClusterIntegrationCore
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif

/// Native owner view. Reading this does not enable capture or restore eligibility.
struct OperatorDraftPowerOwnerSnapshot: Sendable {
    let workspaceID: UUID
    let draft: OperatorDraftSnapshot
    let settings: XLogSettings
}

struct LiveLogbookSyncLease: Sendable {
    let id: UUID
    let database: LogbookDatabase
    let generation: String
}

struct LiveClusterClassificationSnapshot: Sendable {
    let key: String
    let index: ClusterClassificationIndex
    let resolver: CTYResolver
}

enum LiveSettingsAvailability: Sendable {
    case ready(XLogSettings)
    case busy
    case unavailable
}

/// Shared local bridge to an explicitly created integration workspace. It never opens
/// LogbookDatabase() without a URL, and it never constructs a Wavelog client.
public final class LiveLogbookMethods: RemoteBackupWorkspaceGenerationSource, RemoteBackupWorkspaceSnapshotSource, @unchecked Sendable {
    public static let shared: LiveLogbookMethods = {
        let profile = AppRuntimeProfile.current
        return LiveLogbookMethods(supportDirectory: profile.supportDirectory,
            inheritNativePreferences: profile == .production,
            runtimeProfile: profile)
    }()

    private let lock = NSRecursiveLock()
    private let fileManager: FileManager
    private let supportDirectory: URL
    private let inheritNativePreferences: Bool
    private let runtimeProfile: AppRuntimeProfile
    private var database: LogbookDatabase?
    private var workspace: IntegrationWorkspace?
    private var ctyResolverCache: (source: String, resolver: CTYResolver)?
    private var clusterClassificationCache: LiveClusterClassificationSnapshot?
    private var syncLease: LiveLogbookSyncLease?
    private var manualSyncActive: Bool { syncLease != nil }
    private var spotRecoveryDatabase: LogbookDatabase?
    private let syncAuthorizationKey = "OM0RX-xLog.sync-authorization.v1"
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder
    private var adifExport: (token: String, generation: String, created: Date, snapshot: ADIFExportSnapshot)?
    private struct ADIFPreviewSession {
        let token: String
        let generation: String
        let created: Date
        var index: ADIFDuplicatePreviewIndex
        var nextChunk = 0
        var recordCount = 0
        var bytes = 0
        var existingByIdentity: [SemanticQSOIdentity: [QSO]] = [:]
        var existingByID: [UUID: QSO] = [:]
        var updateChunks: [(text: String, targets: [UUID: LogbookContactSnapshot])] = []
        var seenUpdateIDs = Set<UUID>()
        var nextApply = 0
        var selectedFields: Set<String>?
        var applied: [Int: Int] = [:]
    }
    private var adifPreview: ADIFPreviewSession?

    public convenience init(fileManager: FileManager = .default, supportDirectory: URL? = nil,
                            inheritNativePreferences: Bool = true) {
        self.init(fileManager: fileManager, supportDirectory: supportDirectory,
            inheritNativePreferences: inheritNativePreferences, runtimeProfile: .production)
    }

    init(fileManager: FileManager = .default, supportDirectory: URL? = nil,
         inheritNativePreferences: Bool = true, runtimeProfile: AppRuntimeProfile) {
        self.fileManager = fileManager
        self.inheritNativePreferences = inheritNativePreferences
        self.runtimeProfile = runtimeProfile
        self.supportDirectory = supportDirectory ?? fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
    }

    private var nativeDatabaseURL: URL {
        supportDirectory.appendingPathComponent("OM0RX-xLog/OM0RX-xLog.sqlite")
    }

    private var protectedProductionDatabaseURLs: [URL] {
        guard runtimeProfile != .production else { return [] }
        let applicationSupport = supportDirectory.deletingLastPathComponent()
        return [
            applicationSupport.appendingPathComponent("OM0RX-xLog/OM0RX-xLog.sqlite"),
            applicationSupport.appendingPathComponent("OM0RX-xLog-Integrated Preview/OM0RX-xLog.sqlite"),
        ]
    }

    private var workspaceURL: URL {
        supportDirectory.appendingPathComponent("OM0RX-xLog-Integrated Preview", isDirectory: true)
    }

    private var contestingDataURL: URL {
        supportDirectory.appendingPathComponent("Contesting/Python", isDirectory: true)
    }

    var workspaceDirectoryURL: URL { workspaceURL }

    func referenceDirectoryURL() throws -> URL {
        try lock.withLock {
            _ = try readyDatabase()
            let directory = try workspaceSubdirectory("Reference Data", create: true)
            guard let enumerator = fileManager.enumerator(at: directory, includingPropertiesForKeys: [.isSymbolicLinkKey]) else {
                throw WorkerFailure("unsafe_workspace", "Reference data could not be inspected.")
            }
            for case let child as URL in enumerator {
                guard try child.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink != true else {
                    throw WorkerFailure("unsafe_workspace", "Reference data contains a symbolic link.")
                }
            }
            return directory
        }
    }

    func currentKeychainService() throws -> String {
        try lock.withLock {
            _ = try readyDatabase()
            guard let service = workspace?.keychainService else {
                throw WorkerFailure("workspace_unavailable", "Isolated Keychain identity is unavailable.")
            }
            return service
        }
    }

    func openedDatabase() throws -> LogbookDatabase {
        try lock.withLock { try readyDatabase() }
    }

    func prepareContestLogTransfer(_ manifest: ContestLogTransferManifest,
                                   workspaceGeneration: UUID) throws -> ContestLogTransferManifest {
        try lock.withLock {
            guard !manualSyncActive, try editGeneration() == workspaceGeneration.uuidString.lowercased() else {
                throw WorkerFailure("stale_workspace", "The normal log workspace changed before transfer preparation.")
            }
            return try readyDatabase().prepareContestLogTransfer(manifest)
        }
    }

    func applyContestLogTransfer(manifestID: UUID, workspaceGeneration: UUID,
                                 contestSessionID: UUID, sourceRevision: Int64) throws
        -> ContestLogTransferResult {
        try lock.withLock {
            guard !manualSyncActive, try editGeneration() == workspaceGeneration.uuidString.lowercased(),
                  let manifest = try readyDatabase().contestLogTransferManifest(id: manifestID),
                  manifest.workspaceGeneration == workspaceGeneration,
                  manifest.contestSessionID == contestSessionID,
                  manifest.sourceRevision == sourceRevision else {
                throw WorkerFailure("stale_transfer", "The prepared contest transfer no longer matches this workspace or revision.")
            }
            return try readyDatabase().applyContestLogTransfer(manifestID: manifestID)
        }
    }

    func contestLogTransferStatus(manifestID: UUID, workspaceGeneration: UUID,
                                  contestSessionID: UUID) throws -> ContestLogTransferResult {
        try lock.withLock {
            guard try editGeneration() == workspaceGeneration.uuidString.lowercased(),
                  let manifest = try readyDatabase().contestLogTransferManifest(id: manifestID),
                  manifest.workspaceGeneration == workspaceGeneration,
                  manifest.contestSessionID == contestSessionID else {
                throw WorkerFailure("transfer_not_found", "The contest transfer manifest is unavailable in this workspace.")
            }
            return try readyDatabase().contestLogTransferStatus(manifestID: manifestID)
        }
    }

    /// Receive-only digital-mode integrations use the same parser and semantic
    /// duplicate boundary as manual imports without touching the operator draft.
    func importLoggedADIF(_ text: String) throws -> (imported: Int, skipped: Int) {
        try lock.withLock {
            guard text.utf8.count <= 16_384 else { throw invalid() }
            let preview = ADIFImportPreview(text: text)
            guard preview.issues.isEmpty else { throw invalid() }
            let qsos = try preview.records.map { record -> QSO in
                if let raw = record["FREQ"] {
                    guard let frequency = Double(raw), frequency.isFinite,
                          frequency >= 0, frequency <= 1_000_000 else { throw invalid() }
                }
                guard let qso = QSO(adif: record) else { throw invalid() }
                return qso
            }
            guard qsos.count == 1 else { throw invalid() }
            // A WSJT-X Logged ADIF message is an explicit new-contact event, not
            // a historical file import. Its duplicate check and prospective
            // online-log enrollment therefore commit atomically.
            let imported = try readyDatabase().importNewContactsForOnlineLogs(qsos)
            return (imported, qsos.count - imported)
        }
    }

    /// Admission, dispatch and receipt commit share the workspace-transition lock.
    /// This never spans asynchronous transport: startSync only schedules its task.
    func withSyncOwnerLock<T>(_ body: () throws -> T) rethrows -> T { try lock.withLock(body) }

    func syncOwnerContext() throws -> [String: Any] {
        try lock.withLock {
            ["generation": try editGeneration(), "settings_revision": try storedSettingsSnapshot().revision]
        }
    }

    func currentSettings() throws -> XLogSettings {
        try lock.withLock {
            var settings = try storedSettingsSnapshot().settings
            settings.automaticSync = false
            if let authorization = try syncAuthorization(settings: settings) {
                settings.automaticSync = true
                settings.syncIntervalMinutes = authorization.intervalMinutes
            }
            return settings
        }
    }

    /// Passive callsign rendering must not queue behind imports, startup
    /// recovery or another long-lived logbook owner. Missing this snapshot is
    /// not an error: callers retain bundled CTY identity and can retry later.
    func currentSettingsAvailability() -> LiveSettingsAvailability {
        guard lock.try() else { return .busy }
        defer { lock.unlock() }
        guard fileManager.fileExists(atPath: workspaceURL.path) else { return .unavailable }
        do { return .ready(try currentSettings()) }
        catch { return .unavailable }
    }

    public func withCurrentWorkspaceGeneration<T: Sendable>(_ body: (UUID) throws -> T) throws -> T {
        try lock.withLock { try body(powerWorkspaceID()) }
    }

    #if canImport(XLogCore)
    /// Source-only confirmation owner. No renderer route or replay capability is
    /// exposed until this batch has its own durable operation receipt contract.
    func applyLoTWConfirmationChanges(_ preview: LoTWConfirmationPreview) throws -> Int {
        try lock.withLock {
            guard !manualSyncActive else { throw LogbookDatabaseError.syncBusy }
            guard let generation = UUID(uuidString: try editGeneration(createIfMissing: false)) else {
                throw LoTWConfirmationPreview.Failure.missingIdentity
            }
            guard generation == preview.generation else { throw LoTWConfirmationPreview.Failure.staleGeneration }
            return try readyDatabase().applyConfirmationChanges { contacts in
                try preview.validateFences(observedGeneration: generation, contacts: contacts)
                return try preview.items.filter { $0.outcome == .changed }.map { item in
                    guard let fence = item.fence else { throw LoTWConfirmationPreview.Failure.invalidReport }
                    let changes = item.changes.map { change -> LogbookDatabase.ConfirmationChange in
                        let field: LogbookDatabase.ConfirmationChange.Field
                        switch change.field {
                        case .received: field = .lotwReceived
                        case .receivedDate: field = .lotwReceivedDate
                        case .sourceTimestamp: field = .lotwSourceTimestamp
                        }
                        return .init(field: field, retained: change.retained, proposed: change.proposed)
                    }
                    return .init(contactID: fence.contactID, revision: fence.revision, changes: changes)
                }
            }
        }
    }
    #endif

    public func withActiveSnapshot<T: Sendable>(workspaceGeneration: UUID, destination: RemoteBackupDestination,
        capture: @Sendable (RemoteBackupWorkspaceSnapshot) throws -> T) async throws -> T {
        try withBackupSnapshot(workspaceGeneration: workspaceGeneration, destination: destination,
            authorize: {}, capture: capture)
    }

    func withAuthorizedBackupSnapshot<T: Sendable>(workspaceGeneration: UUID, destination: RemoteBackupDestination,
        checker: RemoteBackupAuthorizationChecker, capture: @Sendable (RemoteBackupWorkspaceSnapshot) throws -> T) async throws -> T {
        try withBackupSnapshot(workspaceGeneration: workspaceGeneration, destination: destination, authorize: {
            try checker.validate(workspaceGeneration: workspaceGeneration, destination: destination)
        }, capture: capture)
    }

    private func withBackupSnapshot<T: Sendable>(workspaceGeneration: UUID, destination: RemoteBackupDestination,
        authorize: () throws -> Void, capture: (RemoteBackupWorkspaceSnapshot) throws -> T) throws -> T {
        try lock.withLock {
            _ = try powerWorkspaceID(expected: workspaceGeneration)
            try authorize()
            guard !manualSyncActive else {
                throw WorkerFailure("sync_busy", "Wait for synchronization to finish before backing up.")
            }
            let reference = try referenceDirectoryURL()
            #if os(macOS)
            let referenceLease = try ReferenceRefreshLease(directory: reference)
            defer { referenceLease.release() }
            #endif
            return try capture(RemoteBackupWorkspaceSnapshot(workspaceGeneration: workspaceGeneration,
                destination: destination, database: readyDatabase(), settings: currentSettings(),
                preferences: currentBackupPreferences(), referenceDataURL: reference,
                contestingDataURL: fileManager.fileExists(atPath: contestingDataURL.path) ? contestingDataURL : nil))
        }
    }

    /// Outside every backup payload and created only by an explicit native boundary.
    func remoteBackupDirectory() throws -> URL {
        try lock.withLock {
            _ = try readyDatabase()
            return try workspaceSubdirectory("Remote Backup", create: true)
        }
    }

    /// Stages verified remote bytes into the ordinary local backup catalogue.
    /// The deterministic name makes an acknowledgement lost after publication
    /// idempotent; this does not install or restore the staged package.
    func stageRemoteBackupEnvelope(plan: RemoteBackupUploadPlan, data: Data,
                                   authorize: () throws -> Void) throws -> (name: String, preview: XLogBackupPreview) {
        try lock.withLock {
            _ = try powerWorkspaceID(expected: plan.workspaceGeneration)
            try authorize()
            guard !manualSyncActive else {
                throw WorkerFailure("sync_busy", "Wait for synchronization to finish before staging a remote backup.")
            }
            let name = "Remote-\(plan.backupID.uuidString.lowercased()).\(XLogBackupManager.packageExtension)"
            let package = try backupDirectory().appendingPathComponent(name, isDirectory: true)
            let preview = try XLogBackupManager().materializeRestoreEnvelope(
                data, expectedIdentity: plan.package, at: package)
            try authorize()
            return (name, preview)
        }
    }

    /// Native-only entry points: renderer IPC has no arm/capture capability.
    /// Keep generation checks and the database operation under the same lock.
    func powerOwnerSnapshot() throws -> OperatorDraftPowerOwnerSnapshot {
        try lock.withLock {
            let workspaceID = try powerWorkspaceID()
            let settings = try currentSettings()
            let draft = try readyDatabase().operatorDraft(initial: newOperatorDraft())
            return OperatorDraftPowerOwnerSnapshot(workspaceID: workspaceID, draft: draft, settings: settings)
        }
    }

    func configureDraftPower(expectedWorkspaceID: UUID) throws -> OperatorDraftPowerOwnerSnapshot {
        try lock.withLock {
            let workspaceID = try powerWorkspaceID(expected: expectedWorkspaceID)
            let settings = try currentSettings()
            let db = try readyDatabase()
            _ = try db.operatorDraft(initial: newOperatorDraft())
            let draft = try db.configureOperatorDraftPower(enabled: settings.automaticTransmitPower,
                fallback: settings.defaultPower, workspaceID: workspaceID)
            return OperatorDraftPowerOwnerSnapshot(workspaceID: workspaceID, draft: draft, settings: settings)
        }
    }

    func armDraftPower(context: OperatorDraftPowerContext, expectedWorkspaceID: UUID,
                       draftID: UUID, expectedRevision: Int64, now: Date) throws -> OperatorDraftPowerOwnerSnapshot {
        try lock.withLock {
            let workspaceID = try powerWorkspaceID(expected: expectedWorkspaceID)
            let settings = try currentSettings()
            guard settings.automaticTransmitPower else {
                throw WorkerFailure("power_capture_disabled", "Automatic transmit power capture is disabled.")
            }
            let draft = try readyDatabase().armOperatorDraftPower(context: context, workspaceID: workspaceID,
                draftID: draftID, expectedRevision: expectedRevision, now: now)
            return OperatorDraftPowerOwnerSnapshot(workspaceID: workspaceID, draft: draft, settings: settings)
        }
    }

    func captureDraftPower(sample: OperatorDraftPowerSample, expectedWorkspaceID: UUID,
                           scopeID: UUID, now: Date? = nil,
                           authorize: () -> Bool = { true }) throws -> OperatorDraftPowerOwnerSnapshot {
        try lock.withLock {
            let workspaceID = try powerWorkspaceID(expected: expectedWorkspaceID)
            let settings = try currentSettings()
            let db = try readyDatabase()
            let current = try db.operatorDraft(initial: newOperatorDraft())
            guard current.power?.workspaceID == workspaceID else {
                throw WorkerFailure("workspace_changed", "Configure power capture for the current workspace before receiving samples.")
            }
            guard settings.automaticTransmitPower else {
                return OperatorDraftPowerOwnerSnapshot(workspaceID: workspaceID, draft: current, settings: settings)
            }
            let draft = try db.captureOperatorDraftPower(sample: sample, scopeID: scopeID,
                                                        now: now, authorize: authorize)
            return OperatorDraftPowerOwnerSnapshot(workspaceID: workspaceID, draft: draft, settings: settings)
        }
    }

    func invalidateDraftPower(expectedWorkspaceID: UUID) throws -> OperatorDraftPowerOwnerSnapshot {
        try lock.withLock {
            let workspaceID = try powerWorkspaceID(expected: expectedWorkspaceID)
            let draft = try readyDatabase().invalidateOperatorDraftPower()
            return OperatorDraftPowerOwnerSnapshot(workspaceID: workspaceID, draft: draft, settings: try currentSettings())
        }
    }

    /// Call only while holding lock; edit-generation.json is outside backup data.
    private func powerWorkspaceID(expected: UUID? = nil) throws -> UUID {
        guard let current = UUID(uuidString: try editGeneration()) else { throw invalid() }
        guard expected == nil || expected == current else {
            throw WorkerFailure("workspace_changed", "The workspace changed; retire the previous power capture scope.")
        }
        return current
    }

    // Kept separate from the settings form so an older open form cannot
    // overwrite an immediately saved preference. Nil needs one-time migration
    // from the renderer's legacy preference, not implicit network permission.
    func automaticReferenceChecks() throws -> Bool? {
        try lock.withLock {
            _ = try readyDatabase()
            guard let defaults = workspace?.makeDefaults() else { throw invalid() }
            return defaults.object(forKey: "OM0RX-xLog.referenceAutoCheck.v1") as? Bool
        }
    }

    @discardableResult
    func configureReferenceChecks(enabled: Bool, onlyIfUnset: Bool) throws -> Bool {
        try lock.withLock {
            if onlyIfUnset, let existing = try automaticReferenceChecks() { return existing }
            _ = try readyDatabase()
            guard let defaults = workspace?.makeDefaults() else { throw invalid() }
            let key = "OM0RX-xLog.referenceAutoCheck.v1"
            defaults.set(enabled, forKey: key)
            guard defaults.object(forKey: key) as? Bool == enabled else {
                throw WorkerFailure("reference_configuration_failed", "The reference update preference was not saved.")
            }
            return enabled
        }
    }

    private func syncAuthorization(settings: XLogSettings) throws -> SyncAuthorization? {
        guard settings.logbookMode == .wavelog,
              let defaults = workspace?.makeDefaults(), let data = defaults.data(forKey: syncAuthorizationKey),
              data.count <= 8192, let value = try? JSONDecoder().decode(SyncAuthorization.self, from: data),
              value.matches(generation: try editGeneration(), service: try currentKeychainService(),
                            workspacePath: workspaceURL.standardizedFileURL.resolvingSymlinksInPath().path,
                            endpoint: settings.wavelogURL, stationID: settings.wavelogStationID,
                            targetRevision: try storedSettingsSnapshot().syncTargetRevision) else { return nil }
        return value
    }

    func configureAutomaticSync(enabled: Bool, intervalMinutes: Int, confirmed: Bool) throws {
        try lock.withLock {
            _ = try readyDatabase()
            guard !manualSyncActive else { throw WorkerFailure("sync_busy", "Wait for the current synchronization to finish.") }
            guard (1...60).contains(intervalMinutes) else { throw invalid() }
            guard let defaults = workspace?.makeDefaults() else { throw invalid() }
            if !enabled { defaults.removeObject(forKey: syncAuthorizationKey); return }
            guard confirmed else { throw WorkerFailure("sync_confirmation_required", "Confirm this logbook as the only synchronization writer.") }
            let settings = try storedSettingsSnapshot().settings
            guard settings.logbookMode == .wavelog, let url = URL(string: settings.wavelogURL) else {
                throw WorkerFailure("sync_mode_local", "Choose and configure Wavelog mode before enabling automatic sync.")
            }
            _ = try WavelogConfiguration(baseURL: url, token: "wl2_configuration_validation", stationID: settings.wavelogStationID)
            let authorization = SyncAuthorization(version: 2, generation: try editGeneration(), service: try currentKeychainService(),
                workspacePath: workspaceURL.standardizedFileURL.resolvingSymlinksInPath().path,
                endpoint: settings.wavelogURL, stationID: settings.wavelogStationID, intervalMinutes: intervalMinutes,
                targetRevision: try storedSettingsSnapshot().syncTargetRevision)
            let data = try JSONEncoder().encode(authorization)
            defaults.set(data, forKey: syncAuthorizationKey)
            guard defaults.data(forKey: syncAuthorizationKey) == data else {
                throw WorkerFailure("sync_configuration_failed", "Automatic sync consent was not saved.")
            }
        }
    }

    @discardableResult
    func beginManualSync(expected: XLogSettings? = nil, automatic: Bool = false) throws -> LiveLogbookSyncLease {
        try lock.withLock {
            _ = try readyDatabase()
            guard !manualSyncActive else { throw WorkerFailure("sync_busy", "Synchronization is already running.") }
            let settings = try currentSettings()
            guard settings.logbookMode == .wavelog else {
                throw WorkerFailure("sync_mode_local", "Choose Wavelog mode in Settings before synchronizing.")
            }
            if let expected, expected.wavelogURL != settings.wavelogURL || expected.wavelogStationID != settings.wavelogStationID {
                throw WorkerFailure("sync_configuration_changed", "The Wavelog destination changed before synchronization could start.")
            }
            guard !automatic || settings.automaticSync else { throw WorkerFailure("sync_disabled", "Automatic sync is no longer enabled.") }
            let lease = LiveLogbookSyncLease(id: UUID(), database: try readyDatabase(), generation: try editGeneration())
            syncLease = lease
            return lease
        }
    }

    func validateManualSync(_ lease: LiveLogbookSyncLease) throws {
        try lock.withLock {
            guard syncLease?.id == lease.id, database === lease.database,
                  try editGeneration() == lease.generation else {
                throw WorkerFailure("sync_configuration_changed", "The synchronization workspace changed.")
            }
        }
    }

    @discardableResult
    func endManualSync(_ lease: LiveLogbookSyncLease) -> Bool {
        lock.withLock {
            guard syncLease?.id == lease.id else { return false }
            syncLease = nil; return true
        }
    }

    private func currentCTYResolverSnapshot() throws -> (source: String, resolver: CTYResolver) {
        _ = try readyDatabase()
        let downloaded = workspaceURL.appendingPathComponent("Reference Data/cty.xml")
        if fileManager.fileExists(atPath: downloaded.path) {
            let attributes = try fileManager.attributesOfItem(atPath: downloaded.path)
            let source = [downloaded.path,
                          String((attributes[.systemNumber] as? NSNumber)?.uint64Value ?? 0),
                          String((attributes[.systemFileNumber] as? NSNumber)?.uint64Value ?? 0),
                          String((attributes[.size] as? NSNumber)?.uint64Value ?? 0),
                          String((attributes[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0)]
                .joined(separator: "|")
            if let cached = ctyResolverCache, cached.source == source { return cached }
            if let resolver = try? CTYResolver(xmlURL: downloaded) {
                ctyResolverCache = (source, resolver)
                return (source, resolver)
            }
        }
        if let cached = ctyResolverCache, cached.source == "bundled" { return cached }
        let resolver = try CTYResolver.bundled()
        ctyResolverCache = ("bundled", resolver)
        return ("bundled", resolver)
    }

    func currentCTYResolver() throws -> CTYResolver {
        try lock.withLock {
            try currentCTYResolverSnapshot().resolver
        }
    }

    func currentCTYResolverIfReady() -> CTYResolver? {
        guard lock.try() else { return nil }
        defer { lock.unlock() }
        return try? currentCTYResolverSnapshot().resolver
    }

    /// One immutable local classification view for passive cluster-like consumers.
    /// The key changes with workspace, QSO or CTY reference data without exposing
    /// paths or record content outside the worker.
    func clusterClassificationSnapshot() throws -> LiveClusterClassificationSnapshot {
        try lock.withLock {
            let database = try readyDatabase()
            let generation = try editGeneration()
            let qsoRevision = try database.currentRevision()
            let country = try currentCTYResolverSnapshot()
            let key = "\(generation)|\(qsoRevision)|\(country.source)"
            if let cached = clusterClassificationCache, cached.key == key { return cached }
            let records = try database.clusterContactRows().map { qso in
                ClusterContact(callsign: qso.call, band: qso.band, mode: qso.mode,
                    adif: qso.dxcc ?? country.resolver.resolve(qso.call, at: qso.start)?.adif,
                    date: qso.start, paperQSL: qso.qslReceived, lotwQSL: qso.lotwReceived)
            }
            let snapshot = LiveClusterClassificationSnapshot(key: key,
                index: ClusterClassificationIndex(records: records), resolver: country.resolver)
            clusterClassificationCache = snapshot
            return snapshot
        }
    }

    public func handle(method: String, params: [String: Any]) throws -> [String: Any] {
        try lock.withLock {
            if method.hasPrefix("spot_draft_") { return try handleSpotDraft(method: method, params: params) }
            switch method {
            case "workspace_status":
                try requireKeys(params, allowed: [])
                let exists = fileManager.fileExists(atPath: workspaceURL.path)
                if exists { try loadWorkspace() }
                var status: [String: Any] = ["workspace_exists": exists,
                                             "native_log_exists": fileManager.fileExists(atPath: nativeDatabaseURL.path),
                                             "source": exists ? "isolated_workspace" : "none",
                                             "qso_count": try database?.count() ?? 0,
                                             "pending_sync_count": try database?.pendingSyncCount() ?? 0,
                                             "outbox_count": try database?.outboxCount() ?? 0,
                                             "automatic_sync": false]
                if exists { status["generation"] = try editGeneration() }
                return status
            case "workspace_create":
                try requireKeys(params, allowed: ["mode"], required: ["mode"])
                guard let mode = params["mode"] as? String else { throw invalid() }
                guard !fileManager.fileExists(atPath: workspaceURL.path) else {
                    throw WorkerFailure("workspace_exists", "The integrated logbook already exists.")
                }
                let created: IntegrationWorkspace
                if runtimeProfile != .production, mode != "empty" {
                    throw WorkerFailure("test_workspace_empty_only", "Contesting Test can only create a new empty workspace.")
                }
                switch mode {
                case "copy_native":
                    created = try IntegrationWorkspaceBootstrap.create(sourceDatabaseURL: nativeDatabaseURL, at: workspaceURL)
                case "empty":
                    created = try IntegrationWorkspaceBootstrap.createEmpty(at: workspaceURL,
                        identityPrefix: runtimeProfile == .production
                            ? "com.oliverbross.OM0RXXLog.Integration."
                            : AppRuntimeProfile.contestingIdentityPrefix)
                default: throw invalid()
                }
                let nativeDefaults = inheritNativePreferences ? UserDefaults(suiteName: "com.oliverbross.OM0RXXLog") : nil
                let nativeSettings = nativeDefaults.map { SettingsStore(defaults: $0).load() }
                guard let isolatedDefaults = created.makeDefaults() else {
                    throw WorkerFailure("workspace_unavailable", "Could not create isolated preferences.")
                }
                var initialSettings = IntegrationWorkspace.safeSettings(from: nativeSettings)
                // A new isolated workspace has no Wavelog credential (none is
                // copied from native). Copying contacts or profile defaults is
                // not consent to sync this separate logbook.
                initialSettings.logbookMode = .local
                SettingsStore(defaults: isolatedDefaults).save(initialSettings)
                if mode == "copy_native", let nativeDefaults {
                    applyBackupPreferences(backupPreferences(from: nativeDefaults), to: isolatedDefaults)
                }
                workspace = created
                ctyResolverCache = nil
                database = try LogbookDatabase(url: created.databaseURL)
                _ = try database?.integrationSettings(seed: initialSettings)
                return ["mode": mode, "qso_count": created.qsoCount,
                        "pending_sync_count": created.pendingSyncCount,
                        "outbox_count": created.outboxCount, "automatic_sync": false]
            case "cluster_history":
                try requireKeys(params, allowed: ["call", "adif"], required: ["call"])
                guard let call = params["call"] as? String,
                      call.range(of: #"^[A-Za-z0-9/\-]{2,32}$"#, options: .regularExpression) != nil else { throw invalid() }
                let adif = params["adif"] == nil ? nil : try integer(params, "adif", default: 0, range: 1...1_000)
                let contacts = try readyDatabase().historyRows(call: call, adif: adif)
                return ["history": LocalContactHistory.project(rows: contacts, call: call, adif: adif,
                            resolver: try? currentCTYResolver())]
            case "logbook_cty_preview":
                try requireKeys(params, allowed: ["limit", "offset"])
                let limit = try integer(params, "limit", default: 20, range: 1...25)
                let offset = try integer(params, "offset", default: 0, range: 0...Int(Int32.max))
                let source = try currentCTYResolverSnapshot()
                return ["preview": try json(readyDatabase().pjCorrectionPreview(resolver: source.resolver, limit: limit, offset: offset)),
                        "source": source.source == "bundled" ? "bundled" : "downloaded",
                        "read_only": true]
            case "logbook_list":
                try requireKeys(params, allowed: ["search", "limit", "offset"])
                let search = try string(params, "search", max: 128) ?? ""
                let limit = try integer(params, "limit", default: 20, range: 1...25)
                let offset = try integer(params, "offset", default: 0, range: 0...Int(Int32.max))
                let db = try readyDatabase()
                let rows = try db.fetch(limit: limit, search: search, offset: offset)
                return ["qsos": try json(rows),
                        "offset": offset, "limit": limit,
                        "total": try db.count(search: search)]
            case "logbook_draft":
                try requireKeys(params, allowed: [])
                return ["qso": try json(newOperatorDraft())]
            case "logbook_operator_draft":
                try requireKeys(params, allowed: [])
                let generation = try editGeneration()
                return ["draft": try scopedSnapshot(readyDatabase().operatorDraft(initial: newOperatorDraft()), generation: generation)]
            case "logbook_operator_draft_receipt":
                try requireKeys(params, allowed: ["operationID", "generation"], required: ["operationID", "generation"])
                guard let value = params["operationID"] as? String, let id = UUID(uuidString: value) else { throw invalid() }
                let generation = try editGeneration()
                if try !matchesEditGeneration(params, generation) { return ["status": "workspace_changed", "generation": generation] }
                let receipt = try readyDatabase().operatorDraftReceipt(operationID: id)
                return ["receipt": try receipt.map { try scopedReceipt($0, field: "draft", generation: generation) } ?? NSNull()]
            case "logbook_operator_draft_qsy_clear":
                // Native-only admission supplies already-vetted observed RX evidence.
                // The durable draft revision and operation receipt are still the
                // final authority against newer typing, selection or a lost reply.
                try requireKeys(params, allowed: ["operationID", "draftID", "expectedRevision", "generation", "receiveFrequencyHz", "observedMode"],
                                required: ["operationID", "draftID", "expectedRevision", "generation", "receiveFrequencyHz", "observedMode"])
                let generation = try editGeneration()
                if try !matchesEditGeneration(params, generation) { return ["status": "workspace_changed", "generation": generation] }
                guard let operationText = params["operationID"] as? String,
                      let operationID = UUID(uuidString: operationText),
                      let draftText = params["draftID"] as? String,
                      let draftID = UUID(uuidString: draftText),
                      let observedMode = try string(params, "observedMode", max: 16) else { throw invalid() }
                let expectedRevision = try integer(params, "expectedRevision", default: -1, range: 0...9_007_199_254_740_990)
                let receiveFrequencyHz = try integer(params, "receiveFrequencyHz", default: -1, range: 1...1_000_000_000_000)
                let mutation = OperatorDraftMutation(operationID: operationID, draftID: draftID,
                    expectedRevision: Int64(expectedRevision), action: .clear)
                do {
                    let db = try readyDatabase()
                    if let receipt = try db.operatorDraftReceipt(operationID: operationID) {
                        guard receipt.mutation == mutation else { throw OperatorDraftError.operationReused }
                        return ["status": "applied", "receipt": try scopedReceipt(receipt, field: "draft", generation: generation)]
                    }
                    guard try currentSettings().clearAfterQSY else { return ["status": "disabled", "generation": generation] }
                    guard !db.spotDraftActivationActive else {
                        throw WorkerFailure("spot_activation_busy", "Wait for the current spot activation before clearing this draft.")
                    }
                    let blank = try newOperatorDraft()
                    let next = try OperatorDraftRadioFollow.applying(to: blank,
                        frequencyHz: Int64(receiveFrequencyHz), observedMode: observedMode, enabled: true)
                    guard let workspaceID = UUID(uuidString: generation) else { throw invalid() }
                    let settings = try currentSettings()
                    let receipt = try db.applyOperatorDraft(mutation, nextDraft: next,
                        powerConfiguration: (workspaceID, settings.automaticTransmitPower, settings.defaultPower))
                    return ["status": "applied", "receipt": try scopedReceipt(receipt, field: "draft", generation: generation)]
                } catch OperatorDraftError.conflict(let current) {
                    return ["status": "conflict", "draft": try scopedSnapshot(current, generation: generation)]
                } catch OperatorDraftError.operationReused {
                    throw WorkerFailure("draft_operation_reused", "This operation ID was already used for a different draft change.")
                } catch OperatorDraftError.notInitialized {
                    throw WorkerFailure("draft_not_initialized", "Load the shared operator draft before clearing it.")
                } catch OperatorDraftError.existingContact {
                    throw WorkerFailure("draft_existing_contact", "This draft cannot replace an existing logged contact.")
                } catch OperatorDraftError.invalid { throw invalid() }
                catch OperatorDraftPowerError.invalid { throw invalid() }
            case "logbook_operator_draft_radio_read", "logbook_operator_draft_radio_follow":
                // Native admission supplies observed radio evidence, never a renderer
                // replacement QSO. Project only onto the canonical revision below.
                try requireKeys(params, allowed: ["operationID", "draftID", "expectedRevision", "generation", "frequencyHz", "receiveFrequencyHz", "observedMode"],
                                required: ["operationID", "draftID", "expectedRevision", "generation", "frequencyHz", "observedMode"])
                let generation = try editGeneration()
                if try !matchesEditGeneration(params, generation) { return ["status": "workspace_changed", "generation": generation] }
                guard let operationText = params["operationID"] as? String, let operationID = UUID(uuidString: operationText),
                      let draftText = params["draftID"] as? String, let draftID = UUID(uuidString: draftText),
                      let observedMode = try string(params, "observedMode", max: 16) else { throw invalid() }
                let revision = try integer(params, "expectedRevision", default: -1, range: 0...9_007_199_254_740_990)
                let frequency = try integer(params, "frequencyHz", default: -1, range: 1...1_000_000_000_000)
                let receiveFrequency = params["receiveFrequencyHz"] == nil || params["receiveFrequencyHz"] is NSNull
                    ? nil : try integer(params, "receiveFrequencyHz", default: -1, range: 1...1_000_000_000_000)
                do {
                    let db = try readyDatabase()
                    if let receipt = try db.operatorDraftReceipt(operationID: operationID) {
                        guard receipt.mutation.draftID == draftID, receipt.mutation.expectedRevision == Int64(revision),
                              receipt.mutation.action == .replace, receipt.mutation.powerIntent == nil,
                              let previous = receipt.mutation.qso,
                              try OperatorDraftRadioFollow.applying(to: previous, frequencyHz: Int64(frequency),
                                  receiveFrequencyHz: receiveFrequency.map(Int64.init),
                                  observedMode: observedMode, enabled: true) == previous else { throw OperatorDraftError.operationReused }
                        return ["status": "applied", "receipt": try scopedReceipt(receipt, field: "draft", generation: generation)]
                    }
                    guard !db.spotDraftActivationActive else {
                        throw WorkerFailure("spot_activation_busy", "Wait for the current spot activation before reading into this draft.")
                    }
                    let current = try db.operatorDraft(initial: newOperatorDraft())
                    guard current.qso.id == draftID, current.revision == Int64(revision) else { throw OperatorDraftError.conflict(current) }
                    let projected = try OperatorDraftRadioFollow.applying(to: current.qso, frequencyHz: Int64(frequency),
                        receiveFrequencyHz: receiveFrequency.map(Int64.init),
                        observedMode: observedMode, enabled: true)
                    if method == "logbook_operator_draft_radio_follow", projected == current.qso {
                        return ["status": "unchanged", "draft": try scopedSnapshot(current, generation: generation)]
                    }
                    let mutation = OperatorDraftMutation(operationID: operationID, draftID: draftID,
                        expectedRevision: Int64(revision), action: .replace, qso: projected)
                    let receipt = try db.applyOperatorDraft(mutation, nextDraft: current.qso)
                    return ["status": "applied", "receipt": try scopedReceipt(receipt, field: "draft", generation: generation)]
                } catch OperatorDraftError.conflict(let current) {
                    return ["status": "conflict", "draft": try scopedSnapshot(current, generation: generation)]
                } catch OperatorDraftError.operationReused {
                    throw WorkerFailure("draft_operation_reused", "This operation ID was already used for a different draft change.")
                } catch OperatorDraftError.notInitialized {
                    throw WorkerFailure("draft_not_initialized", "Load the shared operator draft before reading into it.")
                } catch OperatorDraftError.existingContact {
                    throw WorkerFailure("draft_existing_contact", "This draft cannot replace an existing logged contact.")
                } catch OperatorDraftError.invalid { throw invalid() }
                catch OperatorDraftPowerError.invalid { throw invalid() }
            case "logbook_operator_draft_apply":
                try requireKeys(params, allowed: ["operationID", "draftID", "expectedRevision", "action", "qso", "generation", "powerIntent"],
                                required: ["operationID", "draftID", "expectedRevision", "action", "generation"])
                let generation = try editGeneration()
                if try !matchesEditGeneration(params, generation) { return ["status": "workspace_changed", "generation": generation] }
                _ = try integer(params, "expectedRevision", default: -1, range: 0...9_007_199_254_740_990)
                guard JSONSerialization.isValidJSONObject(params),
                      try JSONSerialization.data(withJSONObject: params).count <= 32_000 else { throw invalid() }
                try validatePowerIntent(params)
                let mutation: OperatorDraftMutation
                do { mutation = try decode(params) } catch { throw invalid() }
                guard try !readyDatabase().spotDraftActivationActive else {
                    throw WorkerFailure("spot_activation_busy", "Wait for the current spot activation before changing this draft.")
                }
                do {
                    let db = try readyDatabase()
                    let mutation = try preservingOperatorDraftWireDates(mutation, database: db)
                    let settings = try currentSettings()
                    guard let workspaceID = UUID(uuidString: generation) else { throw invalid() }
                    let receipt = try db.applyOperatorDraft(mutation, nextDraft: newOperatorDraft(),
                        powerConfiguration: (workspaceID, settings.automaticTransmitPower, settings.defaultPower))
                    return ["status": "applied", "receipt": try scopedReceipt(receipt, field: "draft", generation: generation)]
                } catch OperatorDraftError.conflict(let current) {
                    // Explicit non-applied result gives the client an atomic
                    // conflict snapshot without overwriting its pending text.
                    return ["status": "conflict", "draft": try scopedSnapshot(current, generation: generation)]
                } catch OperatorDraftError.operationReused {
                    throw WorkerFailure("draft_operation_reused", "This operation ID was already used for a different draft change.")
                } catch OperatorDraftError.notInitialized {
                    throw WorkerFailure("draft_not_initialized", "Load the shared operator draft before changing it.")
                } catch OperatorDraftError.existingContact {
                    throw WorkerFailure("draft_existing_contact", "This draft cannot replace an existing logged contact.")
                } catch OperatorDraftError.invalid { throw invalid() }
                catch OperatorDraftPowerError.invalid { throw invalid() }
            case "logbook_contact":
                try requireKeys(params, allowed: ["contactID"], required: ["contactID"])
                guard let text = params["contactID"] as? String, let id = UUID(uuidString: text) else { throw invalid() }
                let generation = try editGeneration()
                let contact = try readyDatabase().contactSnapshot(localID: id)
                return ["contact": try contact.map { try scopedSnapshot($0, generation: generation) } ?? NSNull(), "generation": generation]
            case "logbook_data_quality":
                try requireKeys(params, allowed: ["contactID", "generation", "expectedRevision", "conflictID"],
                                required: ["contactID", "generation", "expectedRevision"])
                guard let text = params["contactID"] as? String, let id = UUID(uuidString: text) else { throw invalid() }
                let revision = try integer(params, "expectedRevision", default: -1, range: 0...9_007_199_254_740_990)
                var conflictID: UUID?
                if let raw = params["conflictID"] {
                    guard let text = raw as? String, let value = UUID(uuidString: text) else { throw invalid() }
                    conflictID = value
                }
                let generation = try editGeneration(createIfMissing: false)
                if try !matchesEditGeneration(params, generation) { return ["status": "workspace_changed", "generation": generation] }
                let reference = try? currentCTYResolverSnapshot()
                do {
                    let report = try readyDatabase().contactDataQuality(contactID: id, expectedRevision: Int64(revision),
                        reference: reference.map { .init(resolver: $0.resolver, source: $0.source == "bundled" ? "bundled_cty" : "local_cty") },
                        conflictID: conflictID)
                    return ["generation": generation, "read_only": true,
                            "duplicate_review": "boundedLocalReview", "conflict_review": conflictID == nil ? "notRequested" : "retainedConflict",
                            "data_quality": try report.map { try dataQualityJSON($0) } ?? NSNull()]
                } catch LogbookContactError.conflict {
                    return ["status": "contact_changed", "generation": generation, "read_only": true]
                } catch LogbookContactError.invalid {
                    throw WorkerFailure("conflict_unavailable", "The retained conflict does not belong to this contact or is no longer available.")
                }
            case "logbook_correction_preview":
                try requireKeys(params, allowed: ["contactID", "generation", "expectedRevision", "evidence"],
                                required: ["contactID", "generation", "expectedRevision", "evidence"])
                guard let text = params["contactID"] as? String, let id = UUID(uuidString: text),
                      let suppliedEvidence = params["evidence"] as? [String: Any] else { throw invalid() }
                try requireKeys(suppliedEvidence,
                                allowed: ["field", "value", "source", "date", "dateRole", "rawDate", "referenceSource", "referenceVersion"],
                                required: ["field", "value", "source", "date", "dateRole", "rawDate", "referenceSource", "referenceVersion"])
                let revision = try integer(params, "expectedRevision", default: -1, range: 0...9_007_199_254_740_990)
                guard JSONSerialization.isValidJSONObject(params),
                      try JSONSerialization.data(withJSONObject: params).count <= 32_000 else { throw invalid() }
                let generation = try editGeneration(createIfMissing: false)
                if try !matchesEditGeneration(params, generation) {
                    return ["status": "workspace_changed", "generation": generation, "read_only": true]
                }
                let db = try readyDatabase()
                guard let current = try db.contactSnapshot(localID: id) else {
                    return ["status": "contact_missing", "generation": generation, "read_only": true, "review": NSNull()]
                }
                guard current.revision == Int64(revision) else {
                    return ["status": "contact_changed", "generation": generation, "read_only": true, "review": NSNull()]
                }
                let source = try currentCTYResolverSnapshot()
                let report = QSODataQuality.inspect(current, reference: .init(resolver: source.resolver,
                    source: source.source == "bundled" ? "bundled_cty" : "local_cty"))
                guard report.findings.contains(where: { $0.kind == .storedDXCCDisagreesWithReference }),
                      let comparison = report.referenceComparison,
                      comparison.field == "dxcc", comparison.source == .suppliedCTYReference,
                      let expectedEvidence = try dataQualityJSON(report)["referenceComparison"] as? [String: Any],
                      try JSONSerialization.data(withJSONObject: suppliedEvidence, options: [.sortedKeys])
                        == JSONSerialization.data(withJSONObject: expectedEvidence, options: [.sortedKeys]) else {
                    throw WorkerFailure("correction_evidence_changed", "The reviewed CTY comparison is no longer current; review the contact again.")
                }
                guard let correctedDXCC = Int(comparison.value), (1...1_000).contains(correctedDXCC) else {
                    throw WorkerFailure("correction_evidence_unusable", "The reviewed CTY comparison cannot form a bounded DXCC correction.")
                }
                var proposed = current.qso
                proposed.dxcc = correctedDXCC
                let review = LogbookContactUpdateReview.inspect(current: current, contactID: id,
                    expectedRevision: Int64(revision), proposed: proposed)
                guard review.failure == nil, review.diffStatus == .complete,
                      review.changes.count == 1, review.changes.first?.path == ["dxcc"] else {
                    throw WorkerFailure("correction_evidence_unusable", "The reviewed CTY comparison cannot form a bounded DXCC correction.")
                }
                return ["status": "reviewed", "generation": generation, "read_only": true,
                        "scope": "ctyReferenceDXCCOnly", "evidence": expectedEvidence,
                        "preview": ["contactID": id.uuidString, "expectedRevision": Int64(revision),
                                    "observedRevision": current.revision, "field": "dxcc",
                                    "retainedValue": current.qso.dxcc.map(String.init) as Any? ?? NSNull(),
                                    "proposedValue": String(correctedDXCC), "changeCount": review.changes.count,
                                    "diffStatus": review.diffStatus.rawValue],
                        "review": try json(review)]
            case "logbook_follow_up":
                try requireKeys(params, allowed: ["contactID", "generation"], required: ["contactID", "generation"])
                guard let text = params["contactID"] as? String, let id = UUID(uuidString: text) else { throw invalid() }
                let generation = try editGeneration()
                if try !matchesEditGeneration(params, generation) { return ["status": "workspace_changed", "generation": generation] }
                guard let followUp = try readyDatabase().onlineLogFollowUp(contactID: id) else {
                    return ["follow_up": NSNull(), "generation": generation, "read_only": true]
                }
                let uploads: [[String: Any]] = followUp.uploads.map {
                    ["service": $0.service.rawValue, "state": $0.state?.rawValue as Any? ?? NSNull(),
                     "receipt_revision": $0.receiptRevision as Any? ?? NSNull(), "current_revision": $0.isCurrentRevision,
                     "attempt_age_seconds": $0.attemptAgeSeconds as Any? ?? NSNull(),
                     "last_attempt_at": $0.lastAttemptAt.map { ISO8601DateFormatter().string(from: $0) } as Any? ?? NSNull(),
                     "acceptance_age_seconds": NSNull()]
                }
                let confirmations: [[String: Any]] = followUp.confirmations.map {
                    ["source": $0.source.rawValue, "received_status": $0.receivedStatus,
                     "received_date": $0.receivedDate as Any? ?? NSNull(), "match_age_seconds": NSNull()]
                }
                return ["generation": generation, "read_only": true, "follow_up": [
                    "contact_id": followUp.contactID.uuidString, "contact_revision": followUp.contactRevision,
                    "uploads": uploads, "confirmations": confirmations,
                    "award_impact": followUp.awardImpact.rawValue, "sponsor_credit": NSNull()]]
            case "logbook_contact_receipt":
                try requireKeys(params, allowed: ["operationID", "generation"], required: ["operationID", "generation"])
                guard let text = params["operationID"] as? String, let id = UUID(uuidString: text) else { throw invalid() }
                let generation = try editGeneration()
                if try !matchesEditGeneration(params, generation) { return ["status": "workspace_changed", "generation": generation] }
                let receipt = try readyDatabase().contactReceipt(operationID: id)
                return ["receipt": try receipt.map { try scopedReceipt($0, field: "contact", generation: generation) } ?? NSNull()]
            case "logbook_contact_apply":
                try requireKeys(params, allowed: ["operationID", "contactID", "expectedRevision", "action", "qso", "generation"],
                                required: ["operationID", "contactID", "expectedRevision", "action", "generation"])
                let generation = try editGeneration()
                if try !matchesEditGeneration(params, generation) { return ["status": "workspace_changed", "generation": generation] }
                _ = try integer(params, "expectedRevision", default: -1, range: 0...9_007_199_254_740_990)
                guard JSONSerialization.isValidJSONObject(params),
                      try JSONSerialization.data(withJSONObject: params).count <= 32_000 else { throw invalid() }
                let mutation: LogbookContactMutation
                do { mutation = try decode(params) } catch { throw invalid() }
                do {
                    return ["status": "applied", "receipt": try scopedReceipt(readyDatabase().applyContactMutation(mutation), field: "contact", generation: generation)]
                } catch LogbookContactError.conflict(let current) {
                    return ["status": "conflict", "contact": try current.map { try scopedSnapshot($0, generation: generation) } ?? NSNull()]
                } catch LogbookContactError.operationReused {
                    throw WorkerFailure("contact_operation_reused", "This operation ID was already used for a different contact change.")
                } catch LogbookContactError.invalid { throw invalid() }
            case "logbook_save":
                try requireKeys(params, allowed: ["qso"], required: ["qso"])
                guard let object = params["qso"] as? [String: Any] else { throw invalid() }
                let qso: QSO = try decode(object)
                let call = qso.call.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
                guard (3...32).contains(call.utf8.count),
                      call.utf8.allSatisfy({ (65...90).contains($0) || (48...57).contains($0) || $0 == 47 || $0 == 45 }),
                      !qso.band.isEmpty, qso.band.utf8.count <= 16,
                      !qso.mode.isEmpty, qso.mode.utf8.count <= 16,
                      qso.start.timeIntervalSince1970.isFinite,
                      (Date(timeIntervalSince1970: -2_208_988_800)...Date(timeIntervalSince1970: 4_102_444_800)).contains(qso.start),
                      qso.frequencyHz.map({ (1...1_000_000_000_000).contains($0) }) ?? true,
                      qso.receiveFrequencyHz.map({ (1...1_000_000_000_000).contains($0) }) ?? true else { throw invalid() }
                let db = try readyDatabase()
                try db.saveNewContactForOnlineLogs(qso)
                guard let saved = try db.lookup(localID: qso.id) else { throw WorkerFailure("not_found", "Saved QSO was not found.") }
                return ["qso": try json(saved)]
            case "logbook_delete", "logbook_undo":
                try requireKeys(params, allowed: ["id"], required: ["id"])
                guard let idText = params["id"] as? String, let id = UUID(uuidString: idText) else { throw invalid() }
                let db = try readyDatabase()
                guard var qso = try db.lookup(localID: id) else { throw WorkerFailure("not_found", "QSO was not found.") }
                qso.deletedAt = method == "logbook_delete" ? Date() : nil
                try db.save(qso)
                guard let saved = try db.lookup(localID: id) else { throw WorkerFailure("not_found", "Updated QSO was not found.") }
                return ["qso": try json(saved)]
            case "logbook_stats":
                try requireKeys(params, allowed: [])
                let db = try readyDatabase()
                let stats = try db.stats()
                let awards = try db.awardProgress()
                var statuses = Dictionary(try currentCTYResolver().entities.map { (String($0.adif), "needed") }, uniquingKeysWith: { first, _ in first })
                for (adif, status) in try db.dxccMapStatuses() { statuses[String(adif)] = status }
                let settings = try currentSettings()
                let home: Any = MaidenheadLocator.coordinate(settings.gridSquare).map {
                    ["lat": $0.latitude, "lon": $0.longitude, "call": settings.stationCall, "grid": settings.gridSquare] as [String: Any]
                } as Any? ?? NSNull()
                return ["stats": ["qso_count": stats.qsoCount, "dxcc_count": stats.dxccCount,
                                  "confirmed_count": stats.confirmedCount, "this_year_count": stats.thisYearCount],
                        "dxcc_statuses": statuses, "map_home": home,
                        "awards": awardJSON(awards),
                        "pending_sync_count": try db.pendingSyncCount(),
                        "outbox_count": try db.outboxCount()]
            case "logbook_catalog":
                try requireKeys(params, allowed: ["limit", "offset", "search", "delivery_state", "catalogue_group", "mode_facet", "role_facet"])
                let limit = try integer(params, "limit", default: 20, range: 1...25)
                let offset = try integer(params, "offset", default: 0, range: 0...Int(Int32.max))
                let catalog = try readyDatabase().awardCatalog()
                return try catalogJSON(catalog, offset: offset, limit: limit,
                                       search: try string(params, "search", max: 120) ?? "",
                                       delivery: try string(params, "delivery_state", max: 40) ?? "",
                                       group: try string(params, "catalogue_group", max: 32) ?? "",
                                       mode: try string(params, "mode_facet", max: 16) ?? "",
                                       role: try string(params, "role_facet", max: 16) ?? "")
            case "logbook_previous":
                try requireKeys(params, allowed: ["call", "limit"], required: ["call"])
                guard let call = try string(params, "call", max: 32), !call.isEmpty else { throw invalid() }
                let limit = try integer(params, "limit", default: 20, range: 1...25)
                return ["qsos": try json(try readyDatabase().previous(call: call, limit: limit))]
            case "logbook_duplicate":
                try requireKeys(params, allowed: ["call", "band", "mode", "exclude_id"], required: ["call", "band", "mode"])
                guard let rawCall = try string(params, "call", max: 32),
                      let rawBand = try string(params, "band", max: 16),
                      let rawMode = try string(params, "mode", max: 16) else { throw invalid() }
                let call = rawCall.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
                let band = rawBand.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
                let enteredMode = rawMode.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
                let mode = ["USB": "SSB", "LSB": "SSB", "CWR": "CW", "RTTYR": "RTTY"][enteredMode] ?? enteredMode
                guard call.range(of: #"^[A-Z0-9/\-]{2,32}$"#, options: .regularExpression) != nil,
                      band.range(of: #"^[a-z0-9]{1,16}$"#, options: .regularExpression) != nil,
                      mode.range(of: #"^[A-Z0-9\-]{1,16}$"#, options: .regularExpression) != nil else { throw invalid() }
                let excluded: UUID?
                if params["exclude_id"] != nil {
                    guard let text = params["exclude_id"] as? String, let id = UUID(uuidString: text) else { throw invalid() }
                    excluded = id
                } else { excluded = nil }
                let last = try readyDatabase().latestWorkedContact(call: call, band: band, mode: mode, excludingID: excluded)
                return ["call": call, "band": band, "mode": mode,
                        "last_worked_at": last.map { ISO8601DateFormatter().string(from: $0.start) } as Any? ?? NSNull()]
            case "logbook_matrix":
                try requireKeys(params, allowed: ["call"], required: ["call"])
                guard let call = try string(params, "call", max: 32), !call.isEmpty else { throw invalid() }
                let cells = try readyDatabase().bandModeMatrix(call: call)
                return ["cells": cells.map { ["band": $0.band, "mode": $0.mode,
                                                "worked": $0.worked, "confirmed": $0.confirmed] }]
            case "logbook_import_adif":
                if params["action"] as? String == "preview" {
                    try requireKeys(params, allowed: ["action", "text", "token", "generation", "chunk", "fieldMetadata"], required: ["action", "text"])
                    guard let text = params["text"] as? String else { throw invalid() }
                    let metadata: [ADIFFieldMetadata?]? = try params["fieldMetadata"].map { value in
                        let data = try JSONSerialization.data(withJSONObject: value)
                        guard data.count <= 16_384 else { throw invalid() }
                        return try decoder.decode([ADIFFieldMetadata?].self, from: data)
                    }
                    let preview = ADIFImportPreview(text: text, fieldMetadata: metadata)
                    let metadataBytes = try metadata.map { try encoder.encode($0).count } ?? 0
                    let issues = preview.issues.map { ["record": $0.recordNumber, "message": $0.message] as [String: Any] }
                    guard issues.isEmpty else { return ["records": preview.records.count, "issues": issues] }
                    let generation = try editGeneration()
                    let chunk = try integer(params, "chunk", default: 0, range: 0...9_999)
                    if params["token"] == nil {
                        guard chunk == 0, params["generation"] == nil else { throw invalid() }
                        let existing = try readyDatabase().fetchAll()
                        let formatter = ISO8601DateFormatter()
                        adifPreview = ADIFPreviewSession(token: UUID().uuidString, generation: generation,
                                                        created: Date(), index: ADIFDuplicatePreviewIndex(existing: existing),
                                                        existingByIdentity: Dictionary(grouping: existing, by: { qso in
                            SemanticQSOIdentity(call: qso.call, timestamp: formatter.string(from: qso.start), band: qso.band,
                                                mode: qso.submode.isEmpty ? qso.mode : qso.submode)
                        }), existingByID: Dictionary(uniqueKeysWithValues: existing.map { ($0.id, $0) }))
                    } else {
                        guard params["token"] as? String == adifPreview?.token,
                              params["generation"] as? String == generation,
                              adifPreview?.generation == generation,
                              let created = adifPreview?.created, Date().timeIntervalSince(created) < 300 else {
                            throw WorkerFailure("preview_expired", "The preview expired or the workspace changed. Review the file again.")
                        }
                    }
                    guard adifPreview?.nextChunk == chunk,
                          let count = adifPreview?.recordCount, count + preview.records.count <= 500_000,
                          adifPreview!.bytes + text.utf8.count + metadataBytes <= 32 * 1024 * 1024 else {
                        throw WorkerFailure("preview_sequence", "The preview sequence or record limit changed. Review the file again.")
                    }
                    let counts = try adifPreview!.index.review(preview)
                    let formatter = ISO8601DateFormatter()
                    var candidates: [UUID: QSO] = [:]
                    for record in preview.records {
                        guard let qso = QSO(adif: record) else { throw invalid() }
                        let key = SemanticQSOIdentity(call: qso.call, timestamp: formatter.string(from: qso.start), band: qso.band,
                                                     mode: qso.submode.isEmpty ? qso.mode : qso.submode)
                        for match in adifPreview!.existingByIdentity[key] ?? [] { candidates[match.id] = match }
                    }
                    // Freeze duplicate targets before the operator selects fields;
                    // validate typed replacements only in the selected apply plan.
                    let plan = try ADIFImportPlan(preview: preview, existing: Array(candidates.values),
                                                  duplicatePolicy: .skip)
                    var targets: [UUID: LogbookContactSnapshot] = [:]
                    var updateText = ""
                    for entry in plan.duplicates {
                        guard let id = entry.targetID, !adifPreview!.seenUpdateIDs.contains(id) else { continue }
                        guard let snapshot = try readyDatabase().contactSnapshot(localID: id),
                              snapshot.qso == adifPreview!.existingByID[id] else {
                            throw WorkerFailure("preview_changed", "A duplicate changed during preview. Review the file again.")
                        }
                        targets[id] = snapshot
                        // Retain the incoming values, not the planner's merged record.
                        updateText += preview.records[entry.recordNumber - 1].adifDocument.replacingOccurrences(of: "<ADIF_VER:5>3.1.7<EOH>\r\n", with: "", options: .anchored)
                        adifPreview!.seenUpdateIDs.insert(id)
                    }
                    adifPreview!.updateChunks.append((updateText, targets))
                    adifPreview!.bytes += text.utf8.count + metadataBytes
                    adifPreview!.nextChunk += 1
                    adifPreview!.recordCount += preview.records.count
                    return ["records": preview.records.count, "issues": issues, "generation": generation,
                            "token": adifPreview!.token, "inserts": counts.inserts, "duplicates": counts.duplicates]
                }
                if params["action"] as? String == "update" {
                    try requireKeys(params, allowed: ["action", "token", "generation", "chunk", "fields", "confirmed"],
                                    required: ["action", "token", "generation", "chunk", "fields", "confirmed"])
                    guard params["confirmed"] as? Bool == true else { throw invalid() }
                    guard var session = adifPreview, params["token"] as? String == session.token,
                          params["generation"] as? String == session.generation, try editGeneration() == session.generation,
                          Date().timeIntervalSince(session.created) < 300 else {
                        throw WorkerFailure("preview_expired", "The preview expired or the workspace changed. Review the file again.")
                    }
                    guard let raw = params["fields"] as? [String], (1...ADIFImportPlan.editableFields.count).contains(raw.count),
                          Set(raw).count == raw.count, Set(raw).isSubset(of: ADIFImportPlan.editableFields) else { throw invalid() }
                    let fields = Set(raw)
                    guard session.selectedFields == nil || session.selectedFields == fields else { throw invalid() }
                    let chunk = try integer(params, "chunk", default: -1, range: 0...9_999)
                    guard chunk < session.updateChunks.count, chunk <= session.nextApply else { throw invalid() }
                    if let count = session.applied[chunk] { return ["updated": count] }
                    let batch = session.updateChunks[chunk]
                    let updated = batch.text.isEmpty ? 0 : try readyDatabase().applyADIFUpdates(
                        preview: ADIFImportPreview(text: batch.text), fields: fields, expected: batch.targets)
                    session.selectedFields = fields; session.applied[chunk] = updated; session.nextApply += 1
                    adifPreview = session
                    return ["updated": updated]
                }
                try requireKeys(params, allowed: ["text", "generation", "fieldMetadata"], required: ["text"])
                if params["generation"] != nil, try !matchesEditGeneration(params, editGeneration()) {
                    throw WorkerFailure("workspace_changed", "The workspace changed after preview. Review the file again.")
                }
                guard let text = params["text"] as? String, text.utf8.count <= 16_384 else { throw invalid() }
                let metadata: [ADIFFieldMetadata?]? = try params["fieldMetadata"].map { value in
                    let data = try JSONSerialization.data(withJSONObject: value)
                    guard data.count <= 16_384 else { throw invalid() }
                    return try decoder.decode([ADIFFieldMetadata?].self, from: data)
                }
                let preview = ADIFImportPreview(text: text, fieldMetadata: metadata)
                guard preview.issues.isEmpty else { throw invalid() }
                let records = preview.records
                let qsos = try records.map { record -> QSO in
                    if let raw = record["FREQ"] {
                        guard let frequency = Double(raw), frequency.isFinite,
                              frequency >= 0, frequency <= 1_000_000 else { throw invalid() }
                    }
                    guard let qso = QSO(adif: record) else { throw invalid() }
                    return qso
                }
                let imported = try readyDatabase().importBatch(qsos)
                return ["imported": imported, "skipped_duplicates": qsos.count - imported]
            case "logbook_export_adif":
                if let action = params["action"] as? String {
                    if action == "begin" {
                        try requireKeys(params, allowed: ["action", "scope", "search", "ids"], required: ["action", "scope"])
                        let db = try readyDatabase()
                        let snapshot: ADIFExportSnapshot
                        switch params["scope"] as? String {
                        case "all":
                            guard params["search"] == nil, params["ids"] == nil else { throw invalid() }
                            snapshot = try db.adifExportSnapshot(scope: .all)
                        case "filtered":
                            guard params["ids"] == nil, let search = try string(params, "search", max: 128), !search.isEmpty else { throw invalid() }
                            snapshot = ADIFExportSnapshot(contacts: try db.fetch(limit: Int(Int32.max), search: search), scope: .all)
                        case "selected":
                            guard params["search"] == nil, let rawIDs = params["ids"] as? [String], (1...128).contains(rawIDs.count) else { throw invalid() }
                            let ids = try Set(rawIDs.map { raw -> UUID in guard let id = UUID(uuidString: raw) else { throw invalid() }; return id })
                            snapshot = try db.adifExportSnapshot(scope: .selected(ids))
                            guard snapshot.contactIDs.count == ids.count else { throw WorkerFailure("export_selection_changed", "A selected contact is no longer available. Select it again.") }
                        default: throw invalid()
                        }
                        let token = UUID().uuidString
                        adifExport = (token, try editGeneration(), Date(), snapshot)
                        return ["token": token, "total": snapshot.records.count]
                    }
                    guard action == "read" else { throw invalid() }
                    try requireKeys(params, allowed: ["action", "token", "offset", "limit"], required: ["action", "token"])
                    guard let export = adifExport, params["token"] as? String == export.token,
                          export.generation == (try editGeneration()), Date().timeIntervalSince(export.created) < 300 else {
                        throw WorkerFailure("export_expired", "The export snapshot expired or the workspace changed. Start the export again.")
                    }
                    let offset = try integer(params, "offset", default: 0, range: 0...Int(Int32.max))
                    let limit = try integer(params, "limit", default: 20, range: 1...25)
                    let records = export.snapshot.records.dropFirst(offset).prefix(limit)
                    let metadata: [Any] = try records.map { record in
                        if let value = record.fieldMetadata { try value.validate(fields: record.fields); return try json(value) }
                        return NSNull()
                    }
                    let body = records.map { record in
                        record.fields.keys.sorted().map { key in
                            let value = record.fields[key] ?? ""
                            return "<\(key):\(value.utf8.count)>\(value)"
                        }.joined() + "<EOR>\r\n"
                    }.joined()
                    return ["text": (offset == 0 ? "<ADIF_VER:5>3.1.7<EOH>\r\n" : "") + body, "count": records.count,
                            "offset": offset, "total": export.snapshot.records.count, "fieldMetadata": metadata]
                }
                try requireKeys(params, allowed: ["limit", "offset"])
                let limit = try integer(params, "limit", default: 20, range: 1...25)
                let offset = try integer(params, "offset", default: 0, range: 0...Int(Int32.max))
                let db = try readyDatabase()
                let qsos = try db.fetch(limit: limit, offset: offset)
                let metadata: [Any] = try qsos.map { qso in
                    if let value = qso.adifFieldMetadata { try value.validate(fields: qso.adifRecord.fields); return try json(value) }
                    return NSNull()
                }
                return ["text": qsos.map(\.adifRecord.adifDocument).joined(),
                        "count": qsos.count, "offset": offset, "total": try db.stats().qsoCount, "fieldMetadata": metadata]
            case "settings_load":
                try requireKeys(params, allowed: [])
                let generation = try editGeneration()
                let snapshot = try storedSettingsSnapshot()
                let settings = try presentedSettings(snapshot.settings)
                return ["settings": try json(settings), "revision": snapshot.revision,
                        "generation": generation, "automatic_sync": settings.automaticSync]
            case "settings_receipt":
                try requireKeys(params, allowed: ["operationID", "generation"], required: ["operationID", "generation"])
                guard let raw = params["operationID"] as? String, let operationID = UUID(uuidString: raw) else { throw invalid() }
                let generation = try editGeneration()
                if try !matchesEditGeneration(params, generation) {
                    return ["status": "workspace_changed", "generation": generation]
                }
                let receipt = try readyDatabase().integrationSettingsReceipt(operationID: operationID)
                return ["receipt": try receipt.map { try scopedReceipt($0, field: "snapshot", generation: generation) } ?? NSNull()]
            case "settings_save":
                try requireKeys(params, allowed: ["operationID", "expectedRevision", "generation", "settings"],
                                required: ["operationID", "expectedRevision", "generation", "settings"])
                guard let raw = params["operationID"] as? String, let operationID = UUID(uuidString: raw) else { throw invalid() }
                let generation = try editGeneration()
                if try !matchesEditGeneration(params, generation) {
                    return ["status": "workspace_changed", "generation": generation]
                }
                let expectedRevision = try integer(params, "expectedRevision", default: -1, range: 0...9_007_199_254_740_990)
                guard let object = params["settings"] as? [String: Any],
                      let mode = object["logbookMode"] as? String,
                      LogbookMode(rawValue: mode) != nil else { throw invalid() }
                let value: XLogSettings = try decode(object)
                let safe = IntegrationWorkspace.safeSettings(from: value)
                let database = try readyDatabase()
                let previous = try storedSettingsSnapshot()
                let mutation = IntegrationSettingsMutation(operationID: operationID,
                    expectedRevision: Int64(expectedRevision), settings: safe)
                if let receipt = try database.integrationSettingsReceipt(operationID: operationID) {
                    guard receipt.mutation == mutation else {
                        throw WorkerFailure("settings_operation_reused", "This settings operation ID was already used for different values.")
                    }
                    let current = try presentedSettings(receipt.snapshot.settings)
                    return ["status": "applied", "settings": try json(current),
                            "revision": receipt.snapshot.revision, "generation": generation,
                            "receipt": try scopedReceipt(receipt, field: "snapshot", generation: generation),
                            "automatic_sync": current.automaticSync]
                }
                let destinationChanged = !previous.settings.hasSameWavelogDestination(as: safe)
                let targetChanged = previous.settings.logbookMode != safe.logbookMode || destinationChanged
                if manualSyncActive && targetChanged {
                    throw WorkerFailure("sync_busy", "Wait for synchronization to finish before changing the Wavelog destination or mode.")
                }
                if destinationChanged, try database.linkedRemoteCount() > 0 {
                    throw WorkerFailure("sync_destination_change_blocked", "This logbook contains Wavelog-linked contacts. Create a new workspace or use a reviewed migration before changing the destination.")
                }
                do {
                    let receipt = try database.applyIntegrationSettings(mutation)
                    if targetChanged {
                        workspace?.makeDefaults()?.removeObject(forKey: syncAuthorizationKey)
                    }
                    let current = try presentedSettings(receipt.snapshot.settings)
                    return ["status": "applied", "settings": try json(current),
                            "revision": receipt.snapshot.revision, "generation": generation,
                            "receipt": try scopedReceipt(receipt, field: "snapshot", generation: generation),
                            "automatic_sync": current.automaticSync]
                } catch IntegrationSettingsError.conflict(let current) {
                    let presented = try presentedSettings(current.settings)
                    return ["status": "conflict", "settings": try json(presented),
                            "revision": current.revision, "generation": generation,
                            "automatic_sync": presented.automaticSync]
                } catch IntegrationSettingsError.operationReused {
                    throw WorkerFailure("settings_operation_reused", "This settings operation ID was already used for different values.")
                } catch IntegrationSettingsError.notInitialized {
                    throw WorkerFailure("settings_not_initialized", "Load settings before saving changes.")
                } catch IntegrationSettingsError.invalid { throw invalid() }
            case "workspace_rotor_configuration_load":
                try requireKeys(params, allowed: ["legacy"])
                let generation = try editGeneration()
                let seed: RotorConfiguration
                if let object = params["legacy"] as? [String: Any] {
                    seed = try rotorConfiguration(object)
                } else if params["legacy"] == nil {
                    seed = .defaults
                } else { throw invalid() }
                let snapshot = try readyDatabase().rotorConfiguration(seed: seed)
                return ["configuration": try json(snapshot.configuration), "revision": snapshot.revision,
                        "generation": generation]
            case "workspace_rotor_configuration_receipt":
                try requireKeys(params, allowed: ["operationID", "generation"], required: ["operationID", "generation"])
                guard let raw = params["operationID"] as? String, let operationID = UUID(uuidString: raw) else { throw invalid() }
                let generation = try editGeneration()
                if try !matchesEditGeneration(params, generation) {
                    return ["status": "workspace_changed", "generation": generation]
                }
                let receipt = try readyDatabase().rotorConfigurationReceipt(operationID: operationID)
                return ["receipt": try receipt.map { try scopedReceipt($0, field: "snapshot", generation: generation) } ?? NSNull()]
            case "workspace_rotor_configuration_save":
                try requireKeys(params, allowed: ["operationID", "expectedRevision", "generation", "configuration"],
                                required: ["operationID", "expectedRevision", "generation", "configuration"])
                guard let raw = params["operationID"] as? String, let operationID = UUID(uuidString: raw),
                      let object = params["configuration"] as? [String: Any] else { throw invalid() }
                let generation = try editGeneration()
                if try !matchesEditGeneration(params, generation) {
                    return ["status": "workspace_changed", "generation": generation]
                }
                let expectedRevision = try integer(params, "expectedRevision", default: -1, range: 0...9_007_199_254_740_990)
                let configuration: RotorConfiguration
                configuration = try rotorConfiguration(object)
                let mutation = RotorConfigurationMutation(operationID: operationID,
                    expectedRevision: Int64(expectedRevision), configuration: configuration)
                let database = try readyDatabase()
                if let receipt = try database.rotorConfigurationReceipt(operationID: operationID) {
                    guard receipt.mutation == mutation else {
                        throw WorkerFailure("rotor_configuration_operation_reused", "This rotor configuration operation ID was already used for different values.")
                    }
                    return ["status": "applied", "configuration": try json(receipt.snapshot.configuration),
                            "revision": receipt.snapshot.revision, "generation": generation,
                            "receipt": try scopedReceipt(receipt, field: "snapshot", generation: generation)]
                }
                do {
                    let receipt = try database.applyRotorConfiguration(mutation)
                    return ["status": "applied", "configuration": try json(receipt.snapshot.configuration),
                            "revision": receipt.snapshot.revision, "generation": generation,
                            "receipt": try scopedReceipt(receipt, field: "snapshot", generation: generation)]
                } catch RotorConfigurationError.conflict(let current) {
                    return ["status": "conflict", "configuration": try json(current.configuration),
                            "revision": current.revision, "generation": generation]
                } catch RotorConfigurationError.operationReused {
                    throw WorkerFailure("rotor_configuration_operation_reused", "This rotor configuration operation ID was already used for different values.")
                } catch RotorConfigurationError.notInitialized {
                    throw WorkerFailure("rotor_configuration_not_initialized", "Load rotor configuration before saving changes.")
                } catch RotorConfigurationError.invalid { throw invalid() }
            case "workspace_layout_load":
                try requireKeys(params, allowed: ["scope"])
                let scope = try workspaceLayoutScope(params)
                let generation = try editGeneration()
                return ["layout": try scopedLayoutSnapshot(readyDatabase().workspaceLayout(scope: scope), generation: generation, scope: scope)]
            case "workspace_layout_apply":
                try requireKeys(params, allowed: ["expectedRevision", "action", "presetID", "panel", "preset", "generation", "scope"],
                                required: ["expectedRevision", "action", "presetID", "generation"])
                let scope = try workspaceLayoutScope(params)
                let generation = try editGeneration()
                if try !matchesEditGeneration(params, generation) {
                    var response: [String: Any] = ["status": "workspace_changed", "generation": generation]
                    if scope != .normalLogging { response["scope"] = scope.rawValue }
                    return response
                }
                _ = try integer(params, "expectedRevision", default: -1, range: 0...9_007_199_254_740_990)
                guard JSONSerialization.isValidJSONObject(params),
                      try JSONSerialization.data(withJSONObject: params).count <= 32_000 else { throw invalid() }
                let mutation: WorkspaceLayoutMutation
                do { mutation = try decode(params) } catch { throw invalid() }
                do {
                    let layout = try readyDatabase().applyWorkspaceLayout(mutation, scope: scope)
                    return ["status": "applied", "layout": try scopedLayoutSnapshot(layout, generation: generation, scope: scope)]
                } catch WorkspaceLayoutError.conflict(let layout) {
                    return ["status": "conflict", "layout": try scopedLayoutSnapshot(layout, generation: generation, scope: scope)]
                } catch WorkspaceLayoutError.invalid { throw invalid() }
            case "workspace_preferences_load":
                try requireKeys(params, allowed: [])
                return try preferencesSnapshot()
            case "workspace_preferences_save":
                try requireKeys(params, allowed: ["preferences", "generation", "expectedRevision"],
                                required: ["preferences", "generation", "expectedRevision"])
                let current = try preferencesSnapshot()
                let expected = try integer(params, "expectedRevision", default: -1, range: 0...9_007_199_254_740_990)
                if try !matchesEditGeneration(params, current["generation"] as! String) {
                    return current.merging(["status": "workspace_changed"]) { _, new in new }
                }
                guard let object = params["preferences"] as? [String: Any],
                      Set(object.keys) == Set((current["preferences"] as! [String: Any]).keys) else { throw invalid() }
                let value: XLogBackupPreferences = try decode(object)
                try validateBackupPreferences(value)
                if expected != current["revision"] as? Int { return current.merging(["status": "conflict"]) { _, new in new } }
                guard let defaults = workspace?.makeDefaults() else {
                    throw WorkerFailure("workspace_required", "Create an isolated logbook first.")
                }
                if !NSDictionary(dictionary: object).isEqual(to: current["preferences"] as! [String: Any]) {
                    guard expected < 9_007_199_254_740_990 else { throw invalid() }
                    applyBackupPreferences(value, to: defaults)
                    defaults.set(expected + 1, forKey: "OM0RX-xLog.workspacePreferencesRevision")
                }
                return try preferencesSnapshot().merging(["status": "applied"]) { _, new in new }
            case "workspace_band_map_apply":
                return try applyBandMapPreferences(params)
            case "workspace_logbook_filters_apply":
                return try applySavedLogbookFilters(params)
            case "workspace_map_context":
                try requireKeys(params, allowed: [])
                let db = try readyDatabase()
                var result = try preferencesSnapshot()
                var statuses = Dictionary(try currentCTYResolver().entities.map { (String($0.adif), "needed") }, uniquingKeysWith: { first, _ in first })
                for (adif, status) in try db.dxccMapStatuses() { statuses[String(adif)] = status }
                let settings = try currentSettings()
                result["home"] = MaidenheadLocator.coordinate(settings.gridSquare).map {
                    ["lat": $0.latitude, "lon": $0.longitude, "call": settings.stationCall, "grid": settings.gridSquare] as [String: Any]
                } as Any? ?? NSNull()
                result["dxccStatuses"] = statuses
                return result
            case "backup_create":
                try requireKeys(params, allowed: ["name"])
                guard !manualSyncActive else { throw WorkerFailure("sync_busy", "Wait for synchronization to finish before backing up.") }
                guard params["name"] == nil || params["name"] is String else { throw invalid() }
                let name = try backupName(params["name"] as? String)
                let db = try readyDatabase()
                let root = try backupDirectory()
                let package = root.appendingPathComponent(name).appendingPathExtension(XLogBackupManager.packageExtension)
                let reference = try referenceDirectoryURL()
                #if os(macOS)
                let referenceLease = try ReferenceRefreshLease(directory: reference)
                defer { referenceLease.release() }
                #endif
                let preview = try XLogBackupManager().create(
                    database: db, at: package, settings: try currentSettings(),
                    preferences: try currentBackupPreferences(),
                    referenceDataURL: fileManager.fileExists(atPath: reference.path) ? reference : nil,
                    contestingDataURL: fileManager.fileExists(atPath: contestingDataURL.path) ? contestingDataURL : nil
                )
                return ["name": package.lastPathComponent, "manifest": try json(preview.manifest)]
            case "backup_list":
                try requireKeys(params, allowed: [])
                _ = try readyDatabase()
                let root = try backupDirectory()
                let entries = try fileManager.contentsOfDirectory(at: root, includingPropertiesForKeys: [.isDirectoryKey], options: [.skipsHiddenFiles])
                    .filter { $0.pathExtension == XLogBackupManager.packageExtension }
                    .sorted { $0.lastPathComponent > $1.lastPathComponent }
                    .prefix(100)
                let backups = entries.map { ["name": $0.lastPathComponent] }
                return ["backups": backups]
            case "backup_import":
                try requireKeys(params, allowed: ["source_path"], required: ["source_path"])
                _ = try readyDatabase()
                guard let path = try string(params, "source_path", max: 4096), LocalFilePath.isAbsoluteWithoutTraversal(path),
                      URL(fileURLWithPath: path).pathExtension.lowercased() == XLogBackupManager.packageExtension else { throw invalid() }
                let source = URL(fileURLWithPath: path).standardizedFileURL
                let root = try backupDirectory()
                guard !LocalFilePath.contains(source, in: workspaceURL) else {
                    throw WorkerFailure("unsafe_backup", "Select an external backup package without symbolic links.")
                }
                try validateBackupPackageLinks(source)
                let manager = XLogBackupManager()
                _ = try manager.inspect(at: source)
                let identifier = UUID().uuidString
                let staged = root.appendingPathComponent(".import-\(identifier).xlogbackup", isDirectory: true)
                let destination = root.appendingPathComponent("Imported-\(identifier).xlogbackup", isDirectory: true)
                var published = false
                defer { if !published { try? fileManager.removeItem(at: staged) } }
                try fileManager.copyItem(at: source, to: staged)
                try validateBackupPackageLinks(staged)
                let preview = try manager.inspect(at: staged)
                try fileManager.moveItem(at: staged, to: destination)
                published = true
                return ["name": destination.lastPathComponent, "manifest": try json(preview.manifest),
                        "includes_settings": preview.settings != nil,
                        "includes_preferences": preview.preferences != nil]
            case "backup_inspect":
                try requireKeys(params, allowed: ["name"], required: ["name"])
                _ = try readyDatabase()
                let package = try existingBackup(named: params["name"])
                let preview = try XLogBackupManager().inspect(at: package)
                return ["name": package.lastPathComponent, "manifest": try json(preview.manifest),
                        "includes_settings": preview.settings != nil,
                        "includes_preferences": preview.preferences != nil]
            case "backup_restore":
                guard try !readyDatabase().spotDraftActivationActive else {
                    throw WorkerFailure("spot_activation_busy", "Wait for the current spot activation before restoring.")
                }
                try requireKeys(params, allowed: ["name", "confirm_restore", "restore_settings", "restore_preferences", "restore_reference_data"], required: ["name", "confirm_restore"])
                guard params["confirm_restore"] as? Bool == true else {
                    throw WorkerFailure("restore_confirmation_required", "Confirm the isolated logbook restore before continuing.")
                }
                guard !manualSyncActive else { throw WorkerFailure("sync_busy", "Wait for synchronization to finish before restoring.") }
                _ = try readyDatabase()
                guard params["restore_settings"] == nil || params["restore_settings"] is Bool,
                      params["restore_preferences"] == nil || params["restore_preferences"] is Bool,
                      params["restore_reference_data"] == nil || params["restore_reference_data"] is Bool else { throw invalid() }
                let restoreSettings = params["restore_settings"] as? Bool ?? true
                let restorePreferences = params["restore_preferences"] as? Bool ?? false
                let restoreReference = params["restore_reference_data"] as? Bool ?? true
                let package = try existingBackup(named: params["name"])
                let manager = XLogBackupManager(fileManager: fileManager)
                let envelope = try manager.prepareRestoreEnvelope(at: package)
                let preview = envelope.preview
                if restoreReference, preview.manifest.includesReferenceData {
                    try manager.preflightReferenceDataInstallation(from: envelope)
                }
                if restorePreferences {
                    guard let preferences = preview.preferences else {
                        throw WorkerFailure("backup_preferences_missing", "The selected backup does not contain workspace preferences.")
                    }
                    try validateBackupPreferences(preferences)
                }
                let db = try readyDatabase()
                let retainedLayouts = restorePreferences ? nil : try WorkspaceLayoutScope.allCases.map {
                    ($0, try db.workspaceLayout(scope: $0))
                }
                let retainedSettings = try storedSettingsSnapshot()
                let settingsAfterRestore: XLogSettings
                do {
                    settingsAfterRestore = try preview.settingsForRestore(keeping: retainedSettings.settings,
                                                                         restoreSettings: restoreSettings)
                } catch XLogBackupError.settingsMissing {
                    throw WorkerFailure("backup_settings_missing", XLogBackupError.settingsMissing.localizedDescription)
                } catch XLogBackupError.syncDestinationChange {
                    throw WorkerFailure("sync_destination_change_blocked", XLogBackupError.syncDestinationChange.localizedDescription)
                }
                let retainedRotorConfiguration = try db.rotorConfiguration(seed: .defaults)
                let reference = try referenceDirectoryURL()
                #if os(macOS)
                let referenceLease = try ReferenceRefreshLease(directory: reference)
                defer { referenceLease.release() }
                #endif
                let recovery = try workspaceSubdirectory("Recovery", create: true)
                let rollbackName = "pre-restore-\(UUID().uuidString).\(XLogBackupManager.packageExtension)"
                let rollback = recovery.appendingPathComponent(rollbackName)
                _ = try manager.create(database: db, at: rollback,
                                       settings: try currentSettings(),
                                       preferences: try currentBackupPreferences(),
                                       referenceDataURL: fileManager.fileExists(atPath: reference.path) ? reference : nil,
                                       contestingDataURL: fileManager.fileExists(atPath: contestingDataURL.path) ? contestingDataURL : nil)
                // Invalidate old clients durably before any database replacement.
                // This sidecar is outside the backup payload and survives restart.
                _ = try editGeneration(rotate: true)
                // A crash or failed rollback must not reopen a mixture of old and
                // restored components on the next request/process launch.
                let restoreMarker = workspaceURL.appendingPathComponent(".restore-incomplete")
                try Data(rollbackName.utf8).write(to: restoreMarker, options: .atomic)
                db.close()
                database = nil
                ctyResolverCache = nil
                clusterClassificationCache = nil
                var replacements: [(live: URL, previous: URL?)] = []
                do {
                    let liveDatabase = workspaceURL.appendingPathComponent("OM0RX-xLog.sqlite")
                    let previousDatabase = try manager.installDatabase(from: envelope, to: liveDatabase,
                                                                       restoredSettings: settingsAfterRestore)
                    replacements.append((liveDatabase, previousDatabase))
                    if preview.manifest.includesContestingData == true {
                        let previous = try manager.installContestingData(from: envelope, to: contestingDataURL)
                        replacements.append((contestingDataURL, previous))
                    }
                    if restoreReference, preview.manifest.includesReferenceData {
                        let previous = try manager.installReferenceData(from: envelope, to: reference)
                        replacements.append((reference, previous))
                    }
                    database = try LogbookDatabase(url: workspaceURL.appendingPathComponent("OM0RX-xLog.sqlite"))
                    if let retainedLayouts {
                        for (scope, layout) in retainedLayouts {
                            try database?.preserveWorkspaceLayoutAfterRestore(layout, scope: scope)
                        }
                    }
                    guard let database else { throw WorkerFailure("workspace_unavailable", "The restored database is unavailable.") }
                    let restoredSeed = restoreSettings ? settingsAfterRestore : nil
                    let installed = try database.integrationSettings(seed: restoredSeed ?? retainedSettings.settings)
                    let settingsSnapshot: IntegrationSettingsSnapshot
                    if let restoredSeed {
                        settingsSnapshot = IntegrationSettingsSnapshot(
                            revision: installed.settings == restoredSeed ? installed.revision : min(installed.revision + 1, 9_007_199_254_740_991),
                            settings: restoredSeed
                        )
                    } else {
                        settingsSnapshot = retainedSettings
                    }
                    try database.installIntegrationSettingsAfterRestore(settingsSnapshot)
                    let restoredRotorConfiguration = try database.rotorConfiguration(seed: retainedRotorConfiguration.configuration)
                    try database.installRotorConfigurationAfterRestore(
                        restoreSettings ? restoredRotorConfiguration : retainedRotorConfiguration
                    )
                    try validateWorkspaceLocation()
                    workspace = try IntegrationWorkspaceBootstrap.open(at: workspaceURL,
                        expectedIdentityPrefix: runtimeProfile.identityPrefix)
                    let count = try database.count()
                    try fileManager.removeItem(at: restoreMarker)
                    // Preferences have no throwing writes. Publish them only after
                    // every fallible component and database operation succeeded.
                    if restorePreferences, let preferences = preview.preferences,
                       let defaults = workspace?.makeDefaults() {
                        applyBackupPreferences(preferences, to: defaults)
                    }
                    return ["restored": true, "qso_count": count,
                            "recovery_backup": rollbackName, "preferences_restored": restorePreferences,
                            "automatic_sync": false]
                } catch {
                    let restoreError = error
                    database?.close()
                    database = nil
                    do {
                        try rollbackRestore(replacements)
                        if let failure = restoreError as? XLogBackupError, case .rollbackFailed = failure {
                            throw failure
                        }
                        try validateWorkspaceLocation()
                        let recovered = try IntegrationWorkspaceBootstrap.open(at: workspaceURL,
                            expectedIdentityPrefix: runtimeProfile.identityPrefix)
                        database = try LogbookDatabase(url: recovered.databaseURL)
                        workspace = recovered
                        try fileManager.removeItem(at: restoreMarker)
                    } catch {
                        database?.close()
                        database = nil
                        throw WorkerFailure("restore_recovery_required",
                            "Restore could not finish or recover every original component. The workspace is blocked. Recover the pre-restore backup in Recovery/\(rollbackName) before continuing.")
                    }
                    throw restoreError
                }
            default:
                throw WorkerFailure("method_not_allowed", "Unknown live logbook method.")
            }
        }
    }

    private func handleSpotDraft(method: String, params: [String: Any]) throws -> [String: Any] {
        let generation = try editGeneration()
        let db = try readyDatabase()
        if method == "spot_draft_cw_pending" {
            try requireKeys(params, allowed: [], required: [])
            guard let workspaceID = UUID(uuidString: generation) else { throw invalid() }
            return ["operationIds": try db.pendingCWSpotDraftOperationIDs(generation: workspaceID).map(\.uuidString)]
        }
        if ["spot_draft_cw_status","spot_draft_cw_reconcile"].contains(method) {
            // Reconcile may close only the proven original CW receipt metadata.
            // Neither path applies a draft, releases a lease or grants RF authority.
            try requireKeys(params, allowed: ["operationID"], required: ["operationID"])
            guard let rawID=params["operationID"] as? String, let operationID=UUID(uuidString:rawID),
                  operationID != UUID(uuid:(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0)) else {throw invalid()}
            var result:[String:Any]=["operationId":rawID,"phase":"uncertain","reservationActive":false,
                "draftOnly":true,"tuneConfirmed":false,"rotor":"not_requested"]
            guard let workspaceID=UUID(uuidString:generation) else {throw invalid()}
            let stored:SpotDraftRecord?
            do {stored=try method=="spot_draft_cw_reconcile" ? db.reconcileCWSpotDraft(operationID:operationID,generation:workspaceID):db.spotDraftRecord(operationID:operationID)}
            catch {throw WorkerFailure("cw_receipt_unverified","This durable receipt cannot verify that CW callsign action.")}
            guard let record=stored else {
                result["error"]="No retained CW callsign receipt was found. Review Main Logging; no action was repeated."
                return result
            }
            do {try record.validateCWReceipt(operationID:operationID,generation:workspaceID)}
            catch {throw WorkerFailure("cw_receipt_unverified","This durable receipt cannot verify that CW callsign action.")}
            let active=db.spotDraftLiveLease(for:record) != nil
            result["phase"]=record.phase == .draft_applied && !active ? "uncertain":record.phase.rawValue
            result["reservationActive"]=active
            return result
        }
        let common: Set<String> = ["operationID", "generation"]
        switch method {
        case "spot_draft_apply":
            try requireKeys(params, allowed: common.union(["draftID", "expectedRevision", "spot"]),
                            required: common.union(["draftID", "expectedRevision", "spot"]))
        case "spot_draft_status", "spot_draft_abandon":
            try requireKeys(params, allowed: common, required: common)
        case "spot_draft_stage", "spot_draft_finish":
            let field = method == "spot_draft_stage" ? "stage" : "outcome"
            try requireKeys(params, allowed: common.union(["leaseID", field]), required: common.union(["leaseID", field]))
        default: throw WorkerFailure("method_not_allowed", "Unknown native spot activation method.")
        }
        if try !matchesEditGeneration(params, generation) { return ["status": "workspace_changed", "generation": generation] }
        guard let rawID = params["operationID"] as? String, let operationID = UUID(uuidString: rawID),
              let workspaceID = UUID(uuidString: generation) else { throw invalid() }
        func response(_ record: SpotDraftRecord, status: String, replay: Bool) throws -> [String: Any] {
            var result: [String: Any] = ["status": status, "replay": replay, "phase": record.phase.rawValue]
            var receipt = try scopedSnapshot(record.receipt, generation: generation)
            receipt["draft"] = try scopedSnapshot(record.receipt.draft, generation: generation)
            result["receipt"] = receipt
            if let leaseID = db.spotDraftLiveLease(for: record) { result["leaseID"] = leaseID.uuidString.lowercased() }
            return result
        }
        func abandoned() -> [String: Any] { ["status":"abandoned", "generation":generation, "receipt":NSNull(), "replay":true] }
        do {
            switch method {
            case "spot_draft_apply":
                _ = try integer(params, "expectedRevision", default: -1, range: 0...9_007_199_254_740_990)
                guard let spot = params["spot"] as? [String: Any] else { throw invalid() }
                try requireKeys(spot, allowed: ["call", "frequencyHz", "band", "mode", "country", "dxcc", "comment", "specialTags", "opportunity", "cwCallsign"],
                                required: ["call", "frequencyHz", "band", "mode", "country", "comment", "specialTags"])
                if !(spot["frequencyHz"] is NSNull && (spot["opportunity"] != nil || spot["cwCallsign"] != nil)) {
                    _ = try integer(spot, "frequencyHz", default: 0, range: 1...1_000_000_000_000)
                }
                if let opportunity = spot["opportunity"] as? [String: Any] {
                    try requireKeys(opportunity, allowed: ["kind", "reference", "referenceKind"], required: ["kind", "reference", "referenceKind"])
                }
                if let reference=spot["cwCallsign"] as? [String:Any] {
                    let keys:Set<String>=["sessionID","sourceID","streamToken","epoch","trackID","revision","selectionID"]
                    try requireKeys(reference,allowed:keys,required:keys)
                }
                if spot["dxcc"] != nil, !(spot["dxcc"] is NSNull) { _ = try integer(spot, "dxcc", default: 0, range: 1...1_000) }
                guard JSONSerialization.isValidJSONObject(params), try JSONSerialization.data(withJSONObject: params).count <= 16_384 else { throw invalid() }
                let command: SpotDraftCommand
                do { command = try decode(params); try command.validate() } catch { throw invalid() }
                let result = try db.applySpotDraft(command)
                return try response(result.record, status: "applied", replay: result.replay)
            case "spot_draft_status":
                guard let record = try db.spotDraftRecord(operationID: operationID) else {
                    if let prior = try db.spotDraftAbandonedGeneration(operationID: operationID) {
                        guard prior == workspaceID else { return ["status":"workspace_changed", "generation":generation] }
                        return abandoned()
                    }
                    return ["status": "not_found", "receipt": NSNull(), "replay": true, "generation": generation]
                }
                guard record.command.generation == workspaceID else { return ["status": "workspace_changed", "generation": generation] }
                return try response(record, status: "found", replay: true)
            case "spot_draft_abandon":
                if let record = try db.abandonSpotDraft(operationID: operationID, generation: workspaceID) {
                    return try response(record, status:"found", replay:true)
                }
                return abandoned()
            default:
                let field = method == "spot_draft_stage" ? "stage" : "outcome"
                guard let rawLease = params["leaseID"] as? String, let leaseID = UUID(uuidString: rawLease),
                      let rawPhase = params[field] as? String, let phase = SpotDraftPhase(rawValue: rawPhase) else { throw invalid() }
                if method == "spot_draft_stage" {
                    let staged = try db.stageSpotDraft(operationID: operationID, generation: workspaceID, leaseID: leaseID, stage: phase)
                    guard let record = try db.spotDraftRecord(operationID: operationID) else { throw invalid() }
                    return try response(record, status: staged ? "staged" : "already_staged", replay: !staged)
                }
                let record = try db.finishSpotDraft(operationID: operationID, generation: workspaceID, leaseID: leaseID, outcome: phase)
                return try response(record, status: "finished", replay: true)
            }
        } catch OperatorDraftError.conflict(let draft) {
            return ["status": "conflict", "draft": try scopedSnapshot(draft, generation: generation)]
        } catch SpotDraftError.operationReused {
            throw WorkerFailure("spot_operation_reused", "This spot operation ID was already used for a different selection.")
        } catch SpotDraftError.abandoned {
            return abandoned()
        } catch SpotDraftError.busy {
            throw WorkerFailure("spot_activation_busy", "Another spot activation is in progress.")
        } catch SpotDraftError.staleLease {
            throw WorkerFailure("spot_activation_stale", "The spot activation lease is no longer current; no action is permitted.")
        } catch SpotDraftError.invalidTransition {
            throw WorkerFailure("spot_activation_phase", "This spot activation phase cannot be advanced.")
        } catch OperatorDraftError.notInitialized {
            throw WorkerFailure("draft_not_initialized", "Load the shared operator draft before selecting a spot.")
        } catch OperatorDraftError.existingContact {
            throw WorkerFailure("draft_existing_contact", "A spot selection cannot replace a logged contact.")
        } catch OperatorDraftError.invalid { throw invalid() }
        catch OperatorDraftPowerError.invalid { throw invalid() }
    }

    private func editGeneration(rotate: Bool = false, createIfMissing: Bool = true) throws -> String {
        _ = try readyDatabase()
        let url = workspaceURL.appendingPathComponent("edit-generation.json")
        let values = try? url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
        if fileManager.fileExists(atPath: url.path) || values?.isSymbolicLink == true {
            guard values?.isRegularFile == true, values?.isSymbolicLink != true,
                  (values?.fileSize ?? 129) <= 128 else {
                throw WorkerFailure("unsafe_workspace", "Workspace edit identity is invalid; editing is unavailable.")
            }
            let data = try Data(contentsOf: url)
            guard let value = try? JSONDecoder().decode(UUID.self, from: data) else {
                throw WorkerFailure("unsafe_workspace", "Workspace edit identity is invalid; editing is unavailable.")
            }
            if !rotate { return value.uuidString.lowercased() }
        }
        guard createIfMissing else {
            throw WorkerFailure("workspace_identity_unavailable", "Open the current contact before requesting read-only findings.")
        }
        let value = UUID()
        try JSONEncoder().encode(value).write(to: url, options: .atomic)
        try LocalFilePermissions.protectFile(url, fileManager: fileManager)
        return value.uuidString.lowercased()
    }

    /// Codable omits nil properties; the bridge makes unavailable evidence explicit.
    private func dataQualityJSON(_ report: QSODataQuality.Report) throws -> [String: Any] {
        func evidence(_ value: QSODataQuality.Evidence) throws -> [String: Any] {
            guard var object = try json(value) as? [String: Any] else { throw invalid() }
            for key in ["date", "rawDate", "referenceSource", "referenceVersion"] where object[key] == nil { object[key] = NSNull() }
            return object
        }
        guard var object = try json(report) as? [String: Any] else { throw invalid() }
        object["retainedFields"] = try report.retainedFields.map(evidence)
        object["referenceComparison"] = try report.referenceComparison.map(evidence) ?? NSNull()
        object["retainedPowerObservation"] = try report.retainedPowerObservation.map(evidence) ?? NSNull()
        object["findings"] = try report.findings.map { finding -> [String: Any] in
            guard var value = try json(finding) as? [String: Any] else { throw invalid() }
            value["retained"] = try evidence(finding.retained)
            value["comparison"] = try finding.comparison.map(evidence) ?? NSNull()
            return value
        }
        return object
    }

    private func matchesEditGeneration(_ params: [String: Any], _ current: String) throws -> Bool {
        guard let text = params["generation"] as? String, let value = UUID(uuidString: text) else { throw invalid() }
        return value.uuidString.lowercased() == current
    }

    private func scopedSnapshot<T: Encodable>(_ value: T, generation: String) throws -> [String: Any] {
        guard var object = try json(value) as? [String: Any] else { throw invalid() }
        object["generation"] = generation
        return object
    }

    private func scopedLayoutSnapshot(_ value: WorkspaceLayoutSnapshot, generation: String,
                                      scope: WorkspaceLayoutScope) throws -> [String: Any] {
        var object = try scopedSnapshot(value, generation: generation)
        if scope != .normalLogging { object["scope"] = scope.rawValue }
        return object
    }

    private func scopedReceipt<T: Encodable>(_ value: T, field: String, generation: String) throws -> [String: Any] {
        guard var object = try json(value) as? [String: Any],
              var mutation = object["mutation"] as? [String: Any],
              var snapshot = object[field] as? [String: Any] else { throw invalid() }
        mutation["generation"] = generation; snapshot["generation"] = generation
        object["mutation"] = mutation; object[field] = snapshot
        return object
    }

    private func rollbackRestore(_ replacements: [(live: URL, previous: URL?)]) throws {
        var failure: Error?
        for replacement in replacements.reversed() {
            do {
                // Retain the failed candidate for diagnosis; never overwrite an
                // original or destroy a component whose rollback has failed.
                if fileManager.fileExists(atPath: replacement.live.path) {
                    let failed = replacement.live.deletingLastPathComponent()
                        .appendingPathComponent(".failed-restore-\(UUID().uuidString)-\(replacement.live.lastPathComponent)")
                    try fileManager.moveItem(at: replacement.live, to: failed)
                }
                if let previous = replacement.previous {
                    try fileManager.moveItem(at: previous, to: replacement.live)
                }
            } catch { failure = failure ?? error }
        }
        if let failure { throw failure }
    }

    private func loadWorkspace() throws {
        guard !fileManager.fileExists(atPath: workspaceURL.appendingPathComponent(".restore-incomplete").path) else {
            throw WorkerFailure("restore_recovery_required",
                "An interrupted restore needs recovery from the pre-restore backup in the workspace Recovery folder before continuing.")
        }
        if database != nil {
            try validateWorkspaceLocation()
            return
        }
        try validateWorkspaceLocation()
        let loaded: IntegrationWorkspace
        do { loaded = try IntegrationWorkspaceBootstrap.open(at: workspaceURL,
            expectedIdentityPrefix: runtimeProfile.identityPrefix) }
        catch IntegrationWorkspaceError.unsafePath {
            // Foundation may reject a Windows alias during bootstrap, before
            // the file-identity comparison below. Keep the same safe IPC error.
            throw WorkerFailure("unsafe_workspace", "The integration workspace path is unsafe.")
        }
        database = try LogbookDatabase(url: loaded.databaseURL)
        workspace = loaded
        ctyResolverCache = nil
    }

    private func validateWorkspaceLocation() throws {
        let dbURL = workspaceURL.appendingPathComponent("OM0RX-xLog.sqlite")
        guard fileManager.fileExists(atPath: workspaceURL.path), fileManager.fileExists(atPath: dbURL.path) else {
            throw WorkerFailure("workspace_required", "Create an isolated logbook workspace first.")
        }
        let boundary = supportDirectory.deletingLastPathComponent().standardizedFileURL
        var ancestor = workspaceURL.standardizedFileURL
        while ancestor.path != boundary.path {
            if fileManager.fileExists(atPath: ancestor.path) {
                let values = try ancestor.resourceValues(forKeys: [.isSymbolicLinkKey])
                guard values.isSymbolicLink != true else {
                    throw WorkerFailure("unsafe_workspace", "The integration workspace path is unsafe.")
                }
            }
            let parent = ancestor.deletingLastPathComponent()
            guard parent.path != ancestor.path else {
                throw WorkerFailure("unsafe_workspace", "The integration workspace path is unsafe.")
            }
            ancestor = parent
        }
        let directoryValues = try workspaceURL.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
        let databaseValues = try dbURL.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
        guard directoryValues.isDirectory == true, directoryValues.isSymbolicLink != true,
              databaseValues.isRegularFile == true, databaseValues.isSymbolicLink != true else {
            throw WorkerFailure("unsafe_workspace", "The integration workspace path is unsafe.")
        }
        let isolated = try fileManager.attributesOfItem(atPath: dbURL.path)
        for protectedURL in protectedProductionDatabaseURLs where fileManager.fileExists(atPath: protectedURL.path) {
            let native = try fileManager.attributesOfItem(atPath: protectedURL.path)
            if let nativeID = native[.systemFileNumber] as? NSNumber,
               let isolatedID = isolated[.systemFileNumber] as? NSNumber,
               nativeID == isolatedID {
                throw WorkerFailure("unsafe_workspace", "The integration database aliases the native logbook.")
            }
        }
    }

    private func readyDatabase() throws -> LogbookDatabase {
        try loadWorkspace()
        guard let database else {
            throw WorkerFailure("workspace_required", "Create an isolated logbook workspace first.")
        }
        if spotRecoveryDatabase !== database {
            try database.recoverSpotDraftActivations()
            spotRecoveryDatabase = database
        }
        return database
    }

    private func settingsStore() throws -> SettingsStore {
        _ = try readyDatabase()
        guard let defaults = workspace?.makeDefaults() else {
            throw WorkerFailure("workspace_unavailable", "Isolated preferences are unavailable.")
        }
        return SettingsStore(defaults: defaults)
    }

    private func storedSettingsSnapshot() throws -> IntegrationSettingsSnapshot {
        let seed = IntegrationWorkspace.safeSettings(from: try settingsStore().load())
        return try readyDatabase().integrationSettings(seed: seed)
    }

    private func presentedSettings(_ stored: XLogSettings) throws -> XLogSettings {
        var settings = stored
        settings.automaticSync = false
        if let authorization = try syncAuthorization(settings: settings) {
            settings.automaticSync = true
            settings.syncIntervalMinutes = authorization.intervalMinutes
        }
        return settings
    }

    private func backupDirectory() throws -> URL {
        try workspaceSubdirectory("Backups", create: true)
    }

    private func workspaceSubdirectory(_ name: String, create: Bool) throws -> URL {
        let directory = workspaceURL.appendingPathComponent(name, isDirectory: true)
        if create, !fileManager.fileExists(atPath: directory.path) {
            try fileManager.createDirectory(at: directory, withIntermediateDirectories: false,
                                            attributes: LocalFilePermissions.directoryAttributes)
        }
        let values = try directory.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
        guard values.isDirectory == true, values.isSymbolicLink != true else {
            throw WorkerFailure("unsafe_workspace", "A workspace data directory is unsafe.")
        }
        return directory
    }

    private func backupName(_ input: String?) throws -> String {
        let value = input ?? "OM0RX-xLog-\(ISO8601DateFormatter().string(from: Date()).replacingOccurrences(of: ":", with: "-"))"
        guard (1...80).contains(value.utf8.count), value != ".", value != "..",
              value.utf8.allSatisfy({ (65...90).contains($0) || (97...122).contains($0) || (48...57).contains($0) || $0 == 45 || $0 == 95 || $0 == 46 }) else { throw invalid() }
        return value
    }

    private func existingBackup(named value: Any?) throws -> URL {
        guard let name = value as? String, name.hasSuffix(".xlogbackup") else { throw invalid() }
        _ = try backupName(String(name.dropLast(".xlogbackup".count)))
        let package = try backupDirectory().appendingPathComponent(name, isDirectory: true)
        try validateBackupPackageLinks(package)
        return package
    }

    private func validateBackupPackageLinks(_ package: URL) throws {
        let attributes = try package.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
        guard attributes.isDirectory == true, attributes.isSymbolicLink != true else { throw invalid() }
        guard let enumerator = fileManager.enumerator(at: package, includingPropertiesForKeys: [.isSymbolicLinkKey]) else { throw invalid() }
        for case let child as URL in enumerator {
            guard try child.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink != true else {
                throw WorkerFailure("unsafe_backup", "The selected backup contains a symbolic link.")
            }
        }
    }

    private func currentBackupPreferences() throws -> XLogBackupPreferences {
        guard let defaults = workspace?.makeDefaults() else {
            throw WorkerFailure("workspace_required", "Create an isolated logbook first.")
        }
        return backupPreferences(from: defaults)
    }

    private func backupPreferences(from defaults: UserDefaults) -> XLogBackupPreferences {
        let supported = Set(BandPlan.bands)
        let bands: ([String]?, [String]) -> [String] = { input, fallback in
            var seen = Set<String>()
            let known = (input ?? fallback).filter { supported.contains($0) && seen.insert($0).inserted }
            return known.isEmpty ? fallback : known
        }
        var seenModes = Set<String>()
        let modes = (defaults.stringArray(forKey: "OM0RX-xLog.detachedBandMapModes") ?? ["cw", "data", "phone"])
            .filter { ["cw", "data", "phone"].contains($0) && seenModes.insert($0).inserted }
        let rawScale = defaults.object(forKey: "OM0RX-xLog.bandMapFontScale") as? Double ?? 1
        let savedData = defaults.data(forKey: "OM0RX-xLog.savedLogbookFilters")
        let decodedFilters = savedData.flatMap { data -> [XLogSavedLogbookFilter]? in
            guard data.count <= 16_384 else { return nil }
            return try? JSONDecoder().decode([XLogSavedLogbookFilter].self, from: data)
        } ?? []
        var seenFilterNames = Set<String>()
        let savedFilters = Array(decodedFilters.filter { filter in
            (try? savedFilterName(filter.name)) == filter.name && (try? savedFilterQuery(filter.query)) == filter.query &&
                seenFilterNames.insert(savedFilterKey(filter.name)).inserted
        }.prefix(32)).sorted {
            let left = savedFilterKey($0.name), right = savedFilterKey($1.name)
            return left == right ? $0.name < $1.name : left < right
        }
        return XLogBackupPreferences(
            deskBandMapBands: bands(defaults.stringArray(forKey: "OM0RX-xLog.deskBandMapBands"), ["20m"]),
            detachedBandMapBands: bands(defaults.stringArray(forKey: "OM0RX-xLog.detachedBandMapBands"), Array(BandPlan.bands.prefix(10))),
            deskBandMapFollowsRadio: defaults.object(forKey: "OM0RX-xLog.deskBandMapFollowsRadio") as? Bool ?? true,
            detachedBandMapLayout: defaults.string(forKey: "OM0RX-xLog.detachedBandMapLayout") == "Single row" ? "Single row" : "Adaptive grid",
            bandMapFontScale: rawScale.isFinite ? min(2, max(0.8, rawScale)) : 1,
            intelligenceBands: bands(defaults.stringArray(forKey: "OM0RX-xLog.intelligenceBands"), ["160m", "80m", "60m", "40m", "30m", "20m", "17m", "15m", "12m", "10m"]),
            clusterSpotOpensFullEditor: defaults.bool(forKey: "OM0RX-xLog.clusterSpotOpensFullEditor"),
            detachedBandMapFollowsRadio: defaults.bool(forKey: "OM0RX-xLog.detachedBandMapFollowsRadio"),
            detachedBandMapModes: modes,
            savedLogbookFilters: savedFilters
        )
    }

    private func validateBackupPreferences(_ value: XLogBackupPreferences) throws {
        let supported = Set(BandPlan.bands)
        for bands in [value.deskBandMapBands, value.detachedBandMapBands, value.intelligenceBands] {
            guard !bands.isEmpty, bands.count <= supported.count,
                  Set(bands).count == bands.count, Set(bands).isSubset(of: supported) else { throw invalid() }
        }
        guard ["Adaptive grid", "Single row"].contains(value.detachedBandMapLayout),
              value.bandMapFontScale.isFinite, (0.8...2).contains(value.bandMapFontScale) else { throw invalid() }
        guard value.detachedBandMapModes.count <= 3,
              Set(value.detachedBandMapModes).count == value.detachedBandMapModes.count,
              Set(value.detachedBandMapModes).isSubset(of: ["cw", "data", "phone"]) else { throw invalid() }
        try validateSavedLogbookFilters(value.savedLogbookFilters)
    }

    private func applyBackupPreferences(_ value: XLogBackupPreferences, to defaults: UserDefaults) {
        defaults.set(value.deskBandMapBands, forKey: "OM0RX-xLog.deskBandMapBands")
        defaults.set(value.detachedBandMapBands, forKey: "OM0RX-xLog.detachedBandMapBands")
        defaults.set(value.deskBandMapFollowsRadio, forKey: "OM0RX-xLog.deskBandMapFollowsRadio")
        defaults.set(value.detachedBandMapLayout, forKey: "OM0RX-xLog.detachedBandMapLayout")
        defaults.set(value.bandMapFontScale, forKey: "OM0RX-xLog.bandMapFontScale")
        defaults.set(value.intelligenceBands, forKey: "OM0RX-xLog.intelligenceBands")
        defaults.set(value.clusterSpotOpensFullEditor, forKey: "OM0RX-xLog.clusterSpotOpensFullEditor")
        defaults.set(value.detachedBandMapFollowsRadio, forKey: "OM0RX-xLog.detachedBandMapFollowsRadio")
        defaults.set(value.detachedBandMapModes, forKey: "OM0RX-xLog.detachedBandMapModes")
        defaults.set(try? JSONEncoder().encode(value.savedLogbookFilters), forKey: "OM0RX-xLog.savedLogbookFilters")
    }

    private func preferencesSnapshot() throws -> [String: Any] {
        _ = try readyDatabase()
        guard let defaults = workspace?.makeDefaults() else { throw WorkerFailure("workspace_required", "Create an isolated logbook first.") }
        let revision = defaults.integer(forKey: "OM0RX-xLog.workspacePreferencesRevision")
        guard (0...9_007_199_254_740_990).contains(revision) else { throw invalid() }
        return ["preferences": try json(backupPreferences(from: defaults)), "revision": revision,
                "generation": try editGeneration(), "stored": defaults.object(forKey: "OM0RX-xLog.deskBandMapBands") != nil]
    }

    /// Compare only fields changed by this control, under the same lock as the
    /// generation check and write. Unrelated windows' fields are never copied
    /// back from an old renderer snapshot.
    private func applyBandMapPreferences(_ params: [String: Any]) throws -> [String: Any] {
        try requireKeys(params, allowed: ["generation", "scope", "expected", "patch"], required: ["generation", "scope", "expected", "patch"])
        guard let scope = params["scope"] as? String, ["desk", "detached"].contains(scope),
              let expected = params["expected"] as? [String: Any], let patch = params["patch"] as? [String: Any],
              Set(expected.keys) == Set(patch.keys) else { throw invalid() }
        let fields = scope == "desk" ? ["bands": "deskBandMapBands", "followRadio": "deskBandMapFollowsRadio", "fontScale": "bandMapFontScale"]
            : ["bands": "detachedBandMapBands", "followRadio": "detachedBandMapFollowsRadio", "fontScale": "bandMapFontScale", "layout": "detachedBandMapLayout", "modes": "detachedBandMapModes"]
        guard Set(patch.keys).isSubset(of: Set(fields.keys)) else { throw invalid() }
        let current = try preferencesSnapshot()
        let original = current["preferences"] as! [String: Any]
        var next = original, baseline = original
        for (key, value) in patch {
            if key == "layout" {
                guard let layout = value as? String, ["row", "grid"].contains(layout),
                      let prior = expected[key] as? String, ["row", "grid"].contains(prior) else { throw invalid() }
                next[fields[key]!] = layout == "row" ? "Single row" : "Adaptive grid"
                baseline[fields[key]!] = prior == "row" ? "Single row" : "Adaptive grid"
            } else {
                next[fields[key]!] = value; baseline[fields[key]!] = expected[key]
            }
        }
        // Validate both client baselines and requested values before any write.
        let value: XLogBackupPreferences = try decode(next)
        let prior: XLogBackupPreferences = try decode(baseline)
        try validateBackupPreferences(value); try validateBackupPreferences(prior)
        if try !matchesEditGeneration(params, current["generation"] as! String) {
            return current.merging(["status": "workspace_changed"]) { _, new in new }
        }
        if !NSDictionary(dictionary: baseline).isEqual(to: original) {
            return current.merging(["status": "conflict"]) { _, new in new }
        }
        if !NSDictionary(dictionary: next).isEqual(to: original) {
            let revision = current["revision"] as! Int
            guard revision < 9_007_199_254_740_990, let defaults = workspace?.makeDefaults() else { throw invalid() }
            applyBackupPreferences(value, to: defaults)
            defaults.set(revision + 1, forKey: "OM0RX-xLog.workspacePreferencesRevision")
        }
        return try preferencesSnapshot().merging(["status": "applied"]) { _, new in new }
    }

    /// Mutate only the saved Logbook-query collection. Detached Logbook windows
    /// never receive authority to write the rest of the workspace preferences.
    private func applySavedLogbookFilters(_ params: [String: Any]) throws -> [String: Any] {
        try requireKeys(params, allowed: ["generation", "expected", "action", "name", "source", "query"],
                        required: ["generation", "expected", "action"])
        guard let action = params["action"] as? String else { throw invalid() }
        let expected = try decodeSavedLogbookFilters(params["expected"])
        try validateSavedLogbookFilters(expected)
        let current = try preferencesSnapshot()
        let originalObject = current["preferences"] as! [String: Any]
        var value: XLogBackupPreferences = try decode(originalObject)
        if try !matchesEditGeneration(params, current["generation"] as! String) {
            return current.merging(["status": "workspace_changed"]) { _, new in new }
        }
        guard value.savedLogbookFilters == expected else {
            return current.merging(["status": "conflict"]) { _, new in new }
        }
        var filters = value.savedLogbookFilters
        let existingIndex: (String) -> Int? = { source in
            filters.firstIndex { self.savedFilterKey($0.name) == self.savedFilterKey(source) }
        }
        switch action {
        case "save":
            try requireKeys(params, allowed: ["generation", "expected", "action", "name", "query"],
                            required: ["generation", "expected", "action", "name", "query"])
            let name = try savedFilterName(params["name"]), query = try savedFilterQuery(params["query"])
            guard filters.count < 32, existingIndex(name) == nil else { throw invalid() }
            filters.append(.init(name: name, query: query))
        case "clone":
            try requireKeys(params, allowed: ["generation", "expected", "action", "source", "name"],
                            required: ["generation", "expected", "action", "source", "name"])
            let source = try savedFilterName(params["source"]), name = try savedFilterName(params["name"])
            guard filters.count < 32, existingIndex(name) == nil, let index = existingIndex(source) else { throw invalid() }
            filters.append(.init(name: name, query: filters[index].query))
        case "rename":
            try requireKeys(params, allowed: ["generation", "expected", "action", "source", "name"],
                            required: ["generation", "expected", "action", "source", "name"])
            let source = try savedFilterName(params["source"]), name = try savedFilterName(params["name"])
            guard let index = existingIndex(source),
                  existingIndex(name).map({ $0 == index }) ?? true else { throw invalid() }
            filters[index].name = name
        case "update":
            try requireKeys(params, allowed: ["generation", "expected", "action", "source", "query"],
                            required: ["generation", "expected", "action", "source", "query"])
            let source = try savedFilterName(params["source"]), query = try savedFilterQuery(params["query"])
            guard let index = existingIndex(source) else { throw invalid() }
            filters[index].query = query
        case "delete":
            try requireKeys(params, allowed: ["generation", "expected", "action", "source"],
                            required: ["generation", "expected", "action", "source"])
            let source = try savedFilterName(params["source"])
            guard let index = existingIndex(source) else { throw invalid() }
            filters.remove(at: index)
        default:
            throw invalid()
        }
        filters.sort {
            let left = savedFilterKey($0.name), right = savedFilterKey($1.name)
            return left == right ? $0.name < $1.name : left < right
        }
        try validateSavedLogbookFilters(filters)
        if filters != value.savedLogbookFilters {
            let revision = current["revision"] as! Int
            guard revision < 9_007_199_254_740_990, let defaults = workspace?.makeDefaults() else { throw invalid() }
            value.savedLogbookFilters = filters
            applyBackupPreferences(value, to: defaults)
            defaults.set(revision + 1, forKey: "OM0RX-xLog.workspacePreferencesRevision")
        }
        return try preferencesSnapshot().merging(["status": "applied"]) { _, new in new }
    }

    private func decodeSavedLogbookFilters(_ raw: Any?) throws -> [XLogSavedLogbookFilter] {
        guard let raw, JSONSerialization.isValidJSONObject(raw),
              let data = try? JSONSerialization.data(withJSONObject: raw),
              let filters = try? JSONDecoder().decode([XLogSavedLogbookFilter].self, from: data) else { throw invalid() }
        return filters
    }

    private func validateSavedLogbookFilters(_ filters: [XLogSavedLogbookFilter]) throws {
        guard filters.count <= 32 else { throw invalid() }
        var names = Set<String>()
        for filter in filters {
            guard (try? savedFilterName(filter.name)) == filter.name,
                  (try? savedFilterQuery(filter.query)) == filter.query,
                  names.insert(savedFilterKey(filter.name)).inserted else { throw invalid() }
        }
    }

    private func savedFilterName(_ raw: Any?) throws -> String {
        guard let value = raw as? String, value == value.trimmingCharacters(in: .whitespacesAndNewlines),
              (1...48).contains(value.unicodeScalars.count), value.utf8.count <= 128,
              !value.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) || CharacterSet.newlines.contains($0) }) else { throw invalid() }
        return value
    }

    private func savedFilterQuery(_ raw: Any?) throws -> String {
        guard let value = raw as? String, value == value.trimmingCharacters(in: .whitespacesAndNewlines),
              (1...128).contains(value.unicodeScalars.count), value.utf8.count <= 512,
              !value.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) || CharacterSet.newlines.contains($0) }) else { throw invalid() }
        return value
    }

    private func savedFilterKey(_ value: String) -> String { value.lowercased() }

    private func newOperatorDraft() throws -> QSO {
        let settings = try currentSettings()
        return QSO(call: "", band: "20m", mode: "SSB", stationLocation: settings.stationLocation,
                   radio: settings.defaultRadio, txPower: settings.defaultPower,
                   operatorCall: settings.operatorCall, myCall: settings.stationCall, myGrid: settings.gridSquare)
    }

    private func requireKeys(_ params: [String: Any], allowed: Set<String>, required: Set<String> = []) throws {
        guard Set(params.keys).isSubset(of: allowed), required.isSubset(of: Set(params.keys)) else { throw invalid() }
    }

    private func validatePowerIntent(_ params: [String: Any]) throws {
        guard let raw = params["powerIntent"] else { return }
        guard params["action"] as? String == "replace", let intent = raw as? [String: Any],
              let action = intent["action"] as? String else { throw invalid() }
        switch action {
        case "manual":
            try requireKeys(intent, allowed: ["action", "value"], required: ["action", "value"])
            guard let value = intent["value"] as? String, value.utf8.count <= 343,
                  !value.contains("\0") else { throw invalid() }
        case "automatic":
            try requireKeys(intent, allowed: ["action"], required: ["action"])
        default:
            throw invalid()
        }
    }

    private func string(_ params: [String: Any], _ key: String, max: Int) throws -> String? {
        guard let value = params[key] else { return nil }
        guard let text = value as? String, text.utf8.count <= max else { throw invalid() }
        return text
    }

    private func workspaceLayoutScope(_ params: [String: Any]) throws -> WorkspaceLayoutScope {
        guard let raw = try string(params, "scope", max: 32) else { return .normalLogging }
        guard let scope = WorkspaceLayoutScope(rawValue: raw) else { throw invalid() }
        return scope
    }

    private func integer(_ params: [String: Any], _ key: String, default fallback: Int, range: ClosedRange<Int>) throws -> Int {
        guard let value = params[key] else { return fallback }
        // Decode the JSON integer itself: NSNumber conversion can silently
        // truncate fractions, and its ObjC type varies for small integers.
        guard JSONSerialization.isValidJSONObject([value]),
              let data = try? JSONSerialization.data(withJSONObject: [value]),
              let result = try? JSONDecoder().decode([Int].self, from: data).first,
              range.contains(result) else { throw invalid() }
        return result
    }

    private func decode<T: Decodable>(_ object: [String: Any]) throws -> T {
        guard JSONSerialization.isValidJSONObject(object) else { throw invalid() }
        return try decoder.decode(T.self, from: JSONSerialization.data(withJSONObject: object))
    }

    /// The wire format exposes whole seconds; unchanged wire dates retain the
    /// native precision before the database evaluates explicit time changes.
    /// Called under the workspace lock; the database still fences the revision.
    private func preservingOperatorDraftWireDates(_ mutation: OperatorDraftMutation,
                                                  database: LogbookDatabase) throws -> OperatorDraftMutation {
        guard mutation.action == .replace, var replacement = mutation.qso else { return mutation }
        let reference: QSO
        if let receipt = try database.operatorDraftReceipt(operationID: mutation.operationID) {
            // Replay must use the original input, even after automatic callsign
            // capture refreshed the draft time or Save advanced to another draft.
            guard let previous = receipt.mutation.qso else { return mutation }
            reference = previous
        } else {
            guard let current = try database.operatorDraft() else { throw OperatorDraftError.notInitialized }
            guard current.qso.id == mutation.draftID, current.revision == mutation.expectedRevision else { return mutation }
            reference = current.qso
        }
        let wire = try decoder.decode(QSO.self, from: encoder.encode(reference))
        if replacement.start == wire.start { replacement.start = reference.start }
        if replacement.end == wire.end { replacement.end = reference.end }
        return OperatorDraftMutation(operationID: mutation.operationID, draftID: mutation.draftID,
            expectedRevision: mutation.expectedRevision, action: mutation.action,
            qso: replacement, powerIntent: mutation.powerIntent)
    }

    private func rotorConfiguration(_ object: [String: Any]) throws -> RotorConfiguration {
        do {
            try requireKeys(object, allowed: ["owner", "native_dcu1", "hamlib", "auto_rotor_at_startup", "auto_rotor_bands"],
                            required: ["owner", "native_dcu1", "hamlib"])
            guard let native = object["native_dcu1"] as? [String: Any],
                  let hamlib = object["hamlib"] as? [String: Any],
                  let serial = hamlib["serial"] as? [String: Any] else { throw invalid() }
            try requireKeys(native, allowed: ["host", "port", "name"], required: ["host", "port", "name"])
            try requireKeys(hamlib, allowed: ["mode", "model", "path", "baud", "host", "port", "serial"],
                            required: ["mode", "path", "baud", "host", "port", "serial"])
            try requireKeys(serial, allowed: ["data_bits", "stop_bits", "parity", "handshake", "dtr_state", "rts_state"])
            let value: RotorConfiguration = try decode(object)
            try value.validate()
            return value
        } catch let failure as WorkerFailure { throw failure }
        catch { throw invalid() }
    }

    private func json<T: Encodable>(_ value: T) throws -> Any {
        try JSONSerialization.jsonObject(with: encoder.encode(value))
    }

    private func invalid() -> WorkerFailure {
        WorkerFailure("invalid_params", "Invalid live logbook parameters.")
    }

    private func awardJSON(_ value: AwardProgressSnapshot) -> [String: Any] {
        ["qso_count": value.qsoCount, "confirmed_qsos": value.confirmedQSOs,
         "dxcc_worked": value.dxccWorked, "dxcc_confirmed": value.dxccConfirmed,
         "cq_zones_worked": value.cqZonesWorked, "cq_zones_confirmed": value.cqZonesConfirmed,
         "states_worked": value.statesWorked, "states_confirmed": value.statesConfirmed,
         "grids_worked": value.gridsWorked, "grids_confirmed": value.gridsConfirmed,
         "mode_counts": value.modeCounts, "band_counts": value.bandCounts,
         "continent_counts": value.continentCounts, "year_counts": value.yearCounts,
         "achievements": value.achievements.map { ["code": $0.id, "title": $0.title, "current": $0.current, "target": $0.target, "completed": $0.current >= $0.target] as [String: Any] }]
    }

    private func catalogJSON(_ value: AwardCatalogSnapshot, offset: Int, limit: Int, search: String = "", delivery: String = "", group: String = "", mode: String = "", role: String = "") throws -> [String: Any] {
        guard ["", "global", "europe", "world", "specialty"].contains(group), ["", "cw", "ssb", "mixed"].contains(mode), ["", "hunter", "activator"].contains(role) else { throw invalid() }
        let matching = value.programmes.filter { programme in
            let research = programme.record.research
            let roleText = ([programme.record.name, programme.record.scopeOrCountingFocus] + research.values.map(\.displayText)).joined(separator: " ").lowercased()
            let modeText = research["modes"]?.displayText.lowercased() ?? ""
            return (delivery.isEmpty || programme.deliveryState.rawValue == delivery) &&
            (group.isEmpty || programme.record.catalogueGroup.rawValue == group) &&
            (mode.isEmpty || modeText.range(of: "\\b\(mode)\\b", options: .regularExpression) != nil) &&
            (role.isEmpty || (role == "hunter" ? roleText.contains("hunter") || roleText.contains("chaser") : roleText.contains("activator") || roleText.contains("activation"))) &&
            (search.isEmpty || [programme.record.name, programme.record.sponsor, programme.record.scopeOrCountingFocus, programme.record.id]
                .joined(separator: " ").localizedCaseInsensitiveContains(search))
        }
        let programmes = try matching.dropFirst(offset).prefix(limit).map { programme -> [String: Any] in
            ["record": try json(programme.record),
             "id": programme.record.id, "short_code": programme.record.shortCode,
             "name": programme.record.name, "sponsor": programme.record.sponsor,
             "catalogue_group": programme.record.catalogueGroup.rawValue,
             "scope_or_counting_focus": programme.record.scopeOrCountingFocus,
             "research_sections": programme.record.research.sorted { $0.key < $1.key }.map { ["title": $0.key.replacingOccurrences(of: "_", with: " "), "text": $0.value.displayText] },
             "open_questions": programme.record.openQuestions,
             "official_sources": try json(programme.record.officialSources),
             "checked_on_utc": programme.record.checkedOnUTC,
             "delivery_state": programme.deliveryState.rawValue,
             "delivery_detail": programme.deliveryDetail,
             "progress_code": programme.progress?.code as Any? ?? NSNull()]
        }
        return ["reference_date": value.referenceDate, "research_date": value.researchDate,
         "total_programmes": matching.count, "catalogue_total": value.programmes.count, "offset": offset, "limit": limit,
         "delivery_counts": Dictionary(grouping: value.programmes, by: { $0.deliveryState.rawValue }).mapValues(\.count),
         "programmes": programmes,
         "items": value.items.map { item in
             ["code": item.code, "title": item.title, "programme": item.programme,
              "worked": item.worked, "current": item.current,
              "sponsor_credited": item.sponsorCredited as Any? ?? NSNull(),
              "target": item.target, "unit": item.unit, "detail": item.detail,
              "breakdowns": item.breakdowns.map { ["label": $0.label, "value": $0.value,
                                                     "target": $0.target as Any? ?? NSNull()] }] as [String: Any]
         }]
    }
}

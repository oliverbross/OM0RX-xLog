import Foundation
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif

/// Shared local bridge to an explicitly created integration workspace. It never opens
/// LogbookDatabase() without a URL, and it never constructs a Wavelog client.
public final class LiveLogbookMethods: @unchecked Sendable {
    public static let shared = LiveLogbookMethods()

    private let lock = NSRecursiveLock()
    private let fileManager: FileManager
    private let supportDirectory: URL
    private let inheritNativePreferences: Bool
    private var database: LogbookDatabase?
    private var workspace: IntegrationWorkspace?
    private var ctyResolverCache: (source: String, resolver: CTYResolver)?
    private var manualSyncActive = false
    private let syncAuthorizationKey = "OM0RX-xLog.sync-authorization.v1"
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    public init(fileManager: FileManager = .default, supportDirectory: URL? = nil,
                inheritNativePreferences: Bool = true) {
        self.fileManager = fileManager
        self.inheritNativePreferences = inheritNativePreferences
        self.supportDirectory = supportDirectory ?? fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
    }

    private var nativeDatabaseURL: URL {
        supportDirectory.appendingPathComponent("OM0RX-xLog/OM0RX-xLog.sqlite")
    }

    private var workspaceURL: URL {
        supportDirectory.appendingPathComponent("OM0RX-xLog-Integrated Preview", isDirectory: true)
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

    func currentSettings() throws -> XLogSettings {
        try lock.withLock {
            var settings = IntegrationWorkspace.safeSettings(from: try settingsStore().load())
            if let authorization = try syncAuthorization(settings: settings) {
                settings.automaticSync = true
                settings.syncIntervalMinutes = authorization.intervalMinutes
            }
            return settings
        }
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
                            endpoint: settings.wavelogURL, stationID: settings.wavelogStationID) else { return nil }
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
            let settings = try settingsStore().load()
            guard settings.logbookMode == .wavelog, let url = URL(string: settings.wavelogURL) else {
                throw WorkerFailure("sync_mode_local", "Choose and configure Wavelog mode before enabling automatic sync.")
            }
            _ = try WavelogConfiguration(baseURL: url, token: "wl2_configuration_validation", stationID: settings.wavelogStationID)
            let authorization = SyncAuthorization(version: 1, generation: try editGeneration(), service: try currentKeychainService(),
                workspacePath: workspaceURL.standardizedFileURL.resolvingSymlinksInPath().path,
                endpoint: settings.wavelogURL, stationID: settings.wavelogStationID, intervalMinutes: intervalMinutes)
            let data = try JSONEncoder().encode(authorization)
            defaults.set(data, forKey: syncAuthorizationKey)
            guard defaults.data(forKey: syncAuthorizationKey) == data else {
                throw WorkerFailure("sync_configuration_failed", "Automatic sync consent was not saved.")
            }
        }
    }

    func beginManualSync(expected: XLogSettings? = nil, automatic: Bool = false) throws {
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
            manualSyncActive = true
        }
    }

    func endManualSync() {
        lock.withLock { manualSyncActive = false }
    }

    func currentCTYResolver() throws -> CTYResolver {
        try lock.withLock {
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
                if let cached = ctyResolverCache, cached.source == source { return cached.resolver }
                if let resolver = try? CTYResolver(xmlURL: downloaded) {
                    ctyResolverCache = (source, resolver)
                    return resolver
                }
            }
            if let cached = ctyResolverCache, cached.source == "bundled" { return cached.resolver }
            let resolver = try CTYResolver.bundled()
            ctyResolverCache = ("bundled", resolver)
            return resolver
        }
    }

    public func handle(method: String, params: [String: Any]) throws -> [String: Any] {
        try lock.withLock {
            switch method {
            case "workspace_status":
                try requireKeys(params, allowed: [])
                let exists = fileManager.fileExists(atPath: workspaceURL.path)
                if exists { try loadWorkspace() }
                return ["workspace_exists": exists,
                        "native_log_exists": fileManager.fileExists(atPath: nativeDatabaseURL.path),
                        "source": exists ? "isolated_workspace" : "none",
                        "qso_count": try database?.stats().qsoCount ?? 0,
                        "pending_sync_count": try database?.pendingSyncCount() ?? 0,
                        "outbox_count": try database?.outboxCount() ?? 0,
                        "automatic_sync": false]
            case "workspace_create":
                try requireKeys(params, allowed: ["mode"], required: ["mode"])
                guard let mode = params["mode"] as? String else { throw invalid() }
                guard !fileManager.fileExists(atPath: workspaceURL.path) else {
                    throw WorkerFailure("workspace_exists", "The integrated logbook already exists.")
                }
                let created: IntegrationWorkspace
                switch mode {
                case "copy_native":
                    created = try IntegrationWorkspaceBootstrap.create(sourceDatabaseURL: nativeDatabaseURL, at: workspaceURL)
                case "empty":
                    created = try IntegrationWorkspaceBootstrap.createEmpty(at: workspaceURL)
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
            case "logbook_operator_draft_apply":
                try requireKeys(params, allowed: ["operationID", "draftID", "expectedRevision", "action", "qso", "generation"],
                                required: ["operationID", "draftID", "expectedRevision", "action", "generation"])
                let generation = try editGeneration()
                if try !matchesEditGeneration(params, generation) { return ["status": "workspace_changed", "generation": generation] }
                _ = try integer(params, "expectedRevision", default: -1, range: 0...9_007_199_254_740_990)
                guard JSONSerialization.isValidJSONObject(params),
                      try JSONSerialization.data(withJSONObject: params).count <= 32_000 else { throw invalid() }
                let mutation: OperatorDraftMutation
                do { mutation = try decode(params) } catch { throw invalid() }
                do {
                    let receipt = try readyDatabase().applyOperatorDraft(mutation, nextDraft: newOperatorDraft())
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
            case "logbook_contact":
                try requireKeys(params, allowed: ["contactID"], required: ["contactID"])
                guard let text = params["contactID"] as? String, let id = UUID(uuidString: text) else { throw invalid() }
                let generation = try editGeneration()
                let contact = try readyDatabase().contactSnapshot(localID: id)
                return ["contact": try contact.map { try scopedSnapshot($0, generation: generation) } ?? NSNull(), "generation": generation]
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
                try db.save(qso)
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
                try requireKeys(params, allowed: ["text"], required: ["text"])
                guard let text = params["text"] as? String, text.utf8.count <= 16_384 else { throw invalid() }
                let records = ADIFParser().records(in: text)
                let terminators = try NSRegularExpression(pattern: "<EOR\\s*>", options: .caseInsensitive)
                    .numberOfMatches(in: text, range: NSRange(text.startIndex..., in: text))
                guard records.count > 0, records.count == terminators, records.count <= 128 else { throw invalid() }
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
                try requireKeys(params, allowed: ["limit", "offset"])
                let limit = try integer(params, "limit", default: 20, range: 1...25)
                let offset = try integer(params, "offset", default: 0, range: 0...Int(Int32.max))
                let db = try readyDatabase()
                let qsos = try db.fetch(limit: limit, offset: offset)
                return ["text": qsos.map(\.adifRecord.adifDocument).joined(),
                        "count": qsos.count, "offset": offset, "total": try db.stats().qsoCount]
            case "settings_load":
                try requireKeys(params, allowed: [])
                let settings = try currentSettings()
                return ["settings": try json(settings), "automatic_sync": settings.automaticSync]
            case "settings_save":
                try requireKeys(params, allowed: ["settings"], required: ["settings"])
                guard let object = params["settings"] as? [String: Any],
                      let mode = object["logbookMode"] as? String,
                      LogbookMode(rawValue: mode) != nil else { throw invalid() }
                let value: XLogSettings = try decode(object)
                let safe = IntegrationWorkspace.safeSettings(from: value)
                let store = try settingsStore()
                let previous = store.load()
                let targetChanged = previous.logbookMode != safe.logbookMode || previous.wavelogURL != safe.wavelogURL || previous.wavelogStationID != safe.wavelogStationID
                if manualSyncActive && targetChanged {
                    throw WorkerFailure("sync_busy", "Wait for synchronization to finish before changing the Wavelog destination or mode.")
                }
                if targetChanged { workspace?.makeDefaults()?.removeObject(forKey: syncAuthorizationKey) }
                store.save(safe)
                let current = try currentSettings()
                return ["settings": try json(current), "automatic_sync": current.automaticSync]
            case "workspace_layout_load":
                try requireKeys(params, allowed: [])
                let generation = try editGeneration()
                return ["layout": try scopedSnapshot(readyDatabase().workspaceLayout(), generation: generation)]
            case "workspace_layout_apply":
                try requireKeys(params, allowed: ["expectedRevision", "action", "presetID", "panel", "preset", "generation"],
                                required: ["expectedRevision", "action", "presetID", "generation"])
                let generation = try editGeneration()
                if try !matchesEditGeneration(params, generation) { return ["status": "workspace_changed", "generation": generation] }
                _ = try integer(params, "expectedRevision", default: -1, range: 0...9_007_199_254_740_990)
                guard JSONSerialization.isValidJSONObject(params),
                      try JSONSerialization.data(withJSONObject: params).count <= 32_000 else { throw invalid() }
                let mutation: WorkspaceLayoutMutation
                do { mutation = try decode(params) } catch { throw invalid() }
                do {
                    let layout = try readyDatabase().applyWorkspaceLayout(mutation)
                    return ["status": "applied", "layout": try scopedSnapshot(layout, generation: generation)]
                } catch WorkspaceLayoutError.conflict(let layout) {
                    return ["status": "conflict", "layout": try scopedSnapshot(layout, generation: generation)]
                } catch WorkspaceLayoutError.invalid { throw invalid() }
            case "workspace_preferences_load":
                try requireKeys(params, allowed: [])
                _ = try readyDatabase()
                guard let defaults = workspace?.makeDefaults() else {
                    throw WorkerFailure("workspace_required", "Create an isolated logbook first.")
                }
                return ["preferences": try json(backupPreferences(from: defaults)),
                        "stored": defaults.object(forKey: "OM0RX-xLog.deskBandMapBands") != nil]
            case "workspace_preferences_save":
                try requireKeys(params, allowed: ["preferences"], required: ["preferences"])
                _ = try readyDatabase()
                guard let object = params["preferences"] as? [String: Any] else { throw invalid() }
                let value: XLogBackupPreferences = try decode(object)
                try validateBackupPreferences(value)
                guard let defaults = workspace?.makeDefaults() else {
                    throw WorkerFailure("workspace_required", "Create an isolated logbook first.")
                }
                applyBackupPreferences(value, to: defaults)
                return ["preferences": try json(value)]
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
                    referenceDataURL: fileManager.fileExists(atPath: reference.path) ? reference : nil
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
                let manager = XLogBackupManager()
                let preview = try manager.inspect(at: package)
                if restorePreferences {
                    guard let preferences = preview.preferences else {
                        throw WorkerFailure("backup_preferences_missing", "The selected backup does not contain workspace preferences.")
                    }
                    try validateBackupPreferences(preferences)
                }
                let db = try readyDatabase()
                let retainedLayout = restorePreferences ? nil : try db.workspaceLayout()
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
                                       referenceDataURL: fileManager.fileExists(atPath: reference.path) ? reference : nil)
                // Invalidate old clients durably before any database replacement.
                // This sidecar is outside the backup payload and survives restart.
                _ = try editGeneration(rotate: true)
                db.close()
                database = nil
                ctyResolverCache = nil
                do {
                    _ = try manager.installDatabase(from: package, to: workspaceURL.appendingPathComponent("OM0RX-xLog.sqlite"))
                    if restoreReference, preview.manifest.includesReferenceData {
                        _ = try manager.installReferenceData(from: package, to: reference)
                    }
                    if restoreSettings, let settings = preview.settings {
                        guard let defaults = workspace?.makeDefaults() else {
                            throw WorkerFailure("workspace_unavailable", "Isolated preferences are unavailable.")
                        }
                        SettingsStore(defaults: defaults).save(IntegrationWorkspace.safeSettings(from: settings))
                    }
                    if restorePreferences, let preferences = preview.preferences,
                       let defaults = workspace?.makeDefaults() {
                        applyBackupPreferences(preferences, to: defaults)
                    }
                    database = try LogbookDatabase(url: workspaceURL.appendingPathComponent("OM0RX-xLog.sqlite"))
                    if let retainedLayout { try database?.preserveWorkspaceLayoutAfterRestore(retainedLayout) }
                    workspace = try IntegrationWorkspaceBootstrap.open(at: workspaceURL)
                    return ["restored": true, "qso_count": try database?.count() ?? 0,
                            "recovery_backup": rollbackName, "preferences_restored": restorePreferences,
                            "automatic_sync": false]
                } catch {
                    database = try? LogbookDatabase(url: workspaceURL.appendingPathComponent("OM0RX-xLog.sqlite"))
                    throw error
                }
            default:
                throw WorkerFailure("method_not_allowed", "Unknown live logbook method.")
            }
        }
    }

    private func editGeneration(rotate: Bool = false) throws -> String {
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
        let value = UUID()
        try JSONEncoder().encode(value).write(to: url, options: .atomic)
        try LocalFilePermissions.protectFile(url, fileManager: fileManager)
        return value.uuidString.lowercased()
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

    private func scopedReceipt<T: Encodable>(_ value: T, field: String, generation: String) throws -> [String: Any] {
        guard var object = try json(value) as? [String: Any],
              var mutation = object["mutation"] as? [String: Any],
              var snapshot = object[field] as? [String: Any] else { throw invalid() }
        mutation["generation"] = generation; snapshot["generation"] = generation
        object["mutation"] = mutation; object[field] = snapshot
        return object
    }

    private func loadWorkspace() throws {
        if database != nil {
            try validateWorkspaceLocation()
            return
        }
        let loaded: IntegrationWorkspace
        do { loaded = try IntegrationWorkspaceBootstrap.open(at: workspaceURL) }
        catch IntegrationWorkspaceError.unsafePath {
            // Foundation may reject a Windows alias during bootstrap, before
            // the file-identity comparison below. Keep the same safe IPC error.
            throw WorkerFailure("unsafe_workspace", "The integration workspace path is unsafe.")
        }
        if fileManager.fileExists(atPath: nativeDatabaseURL.path) {
            let native = try fileManager.attributesOfItem(atPath: nativeDatabaseURL.path)
            let isolated = try fileManager.attributesOfItem(atPath: loaded.databaseURL.path)
            if let nativeID = native[.systemFileNumber] as? NSNumber,
               let isolatedID = isolated[.systemFileNumber] as? NSNumber,
               nativeID == isolatedID {
                throw WorkerFailure("unsafe_workspace", "The integration database aliases the native logbook.")
            }
        }
        database = try LogbookDatabase(url: loaded.databaseURL)
        workspace = loaded
        ctyResolverCache = nil
    }

    private func validateWorkspaceLocation() throws {
        let directoryValues = try workspaceURL.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
        let dbURL = workspaceURL.appendingPathComponent("OM0RX-xLog.sqlite")
        let databaseValues = try dbURL.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
        guard directoryValues.isDirectory == true, directoryValues.isSymbolicLink != true,
              databaseValues.isRegularFile == true, databaseValues.isSymbolicLink != true else {
            throw WorkerFailure("unsafe_workspace", "The integration workspace path is unsafe.")
        }
        if fileManager.fileExists(atPath: nativeDatabaseURL.path) {
            let native = try fileManager.attributesOfItem(atPath: nativeDatabaseURL.path)
            let isolated = try fileManager.attributesOfItem(atPath: dbURL.path)
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
        return database
    }

    private func settingsStore() throws -> SettingsStore {
        _ = try readyDatabase()
        guard let defaults = workspace?.makeDefaults() else {
            throw WorkerFailure("workspace_unavailable", "Isolated preferences are unavailable.")
        }
        return SettingsStore(defaults: defaults)
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
        return XLogBackupPreferences(
            deskBandMapBands: bands(defaults.stringArray(forKey: "OM0RX-xLog.deskBandMapBands"), ["20m"]),
            detachedBandMapBands: bands(defaults.stringArray(forKey: "OM0RX-xLog.detachedBandMapBands"), Array(BandPlan.bands.prefix(10))),
            deskBandMapFollowsRadio: defaults.object(forKey: "OM0RX-xLog.deskBandMapFollowsRadio") as? Bool ?? true,
            detachedBandMapLayout: defaults.string(forKey: "OM0RX-xLog.detachedBandMapLayout") == "Single row" ? "Single row" : "Adaptive grid",
            bandMapFontScale: rawScale.isFinite ? min(2, max(0.8, rawScale)) : 1,
            intelligenceBands: bands(defaults.stringArray(forKey: "OM0RX-xLog.intelligenceBands"), ["160m", "80m", "60m", "40m", "30m", "20m", "17m", "15m", "12m", "10m"]),
            clusterSpotOpensFullEditor: defaults.bool(forKey: "OM0RX-xLog.clusterSpotOpensFullEditor"),
            detachedBandMapFollowsRadio: defaults.bool(forKey: "OM0RX-xLog.detachedBandMapFollowsRadio"),
            detachedBandMapModes: modes
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
    }

    private func newOperatorDraft() throws -> QSO {
        let settings = try currentSettings()
        return QSO(call: "", band: "20m", mode: "SSB", stationLocation: settings.stationLocation,
                   radio: settings.defaultRadio, txPower: settings.defaultPower,
                   operatorCall: settings.operatorCall, myCall: settings.stationCall, myGrid: settings.gridSquare)
    }

    private func requireKeys(_ params: [String: Any], allowed: Set<String>, required: Set<String> = []) throws {
        guard Set(params.keys).isSubset(of: allowed), required.isSubset(of: Set(params.keys)) else { throw invalid() }
    }

    private func string(_ params: [String: Any], _ key: String, max: Int) throws -> String? {
        guard let value = params[key] else { return nil }
        guard let text = value as? String, text.utf8.count <= max else { throw invalid() }
        return text
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

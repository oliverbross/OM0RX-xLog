#if os(macOS)
import Foundation
import XLogCore

/// Mac-only bridge to an explicitly created integration workspace. It never opens
/// LogbookDatabase() without a URL, and it never constructs a Wavelog client.
public final class LiveLogbookMethods: @unchecked Sendable {
    public static let shared = LiveLogbookMethods()

    private let lock = NSRecursiveLock()
    private let fileManager: FileManager
    private let supportDirectory: URL
    private var database: LogbookDatabase?
    private var workspace: IntegrationWorkspace?
    private var manualSyncActive = false
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    public init(fileManager: FileManager = .default, supportDirectory: URL? = nil) {
        self.fileManager = fileManager
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
        try lock.withLock { IntegrationWorkspace.safeSettings(from: try settingsStore().load()) }
    }

    func beginManualSync() throws {
        try lock.withLock {
            _ = try readyDatabase()
            guard !manualSyncActive else { throw WorkerFailure("sync_busy", "Synchronization is already running.") }
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
            if fileManager.fileExists(atPath: downloaded.path),
               let resolver = try? CTYResolver(xmlURL: downloaded) { return resolver }
            return try CTYResolver.bundled()
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
                let nativeDefaults = UserDefaults(suiteName: "com.oliverbross.OM0RXXLog")
                let nativeSettings = nativeDefaults.map { SettingsStore(defaults: $0).load() }
                guard let isolatedDefaults = created.makeDefaults() else {
                    throw WorkerFailure("workspace_unavailable", "Could not create isolated preferences.")
                }
                SettingsStore(defaults: isolatedDefaults).save(IntegrationWorkspace.safeSettings(from: nativeSettings))
                workspace = created
                database = try LogbookDatabase(url: created.databaseURL)
                return ["mode": mode, "qso_count": created.qsoCount,
                        "pending_sync_count": created.pendingSyncCount,
                        "outbox_count": created.outboxCount, "automatic_sync": false]
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
                let settings = try currentSettings()
                let draft = QSO(call: "", band: "20m", mode: "SSB",
                                stationLocation: settings.stationLocation,
                                radio: settings.defaultRadio,
                                txPower: settings.defaultPower,
                                operatorCall: settings.operatorCall,
                                myCall: settings.stationCall,
                                myGrid: settings.gridSquare)
                return ["qso": try json(draft)]
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
                return ["stats": ["qso_count": stats.qsoCount, "dxcc_count": stats.dxccCount,
                                  "confirmed_count": stats.confirmedCount, "this_year_count": stats.thisYearCount],
                        "awards": awardJSON(awards),
                        "pending_sync_count": try db.pendingSyncCount(),
                        "outbox_count": try db.outboxCount()]
            case "logbook_catalog":
                try requireKeys(params, allowed: ["limit", "offset", "search", "delivery_state"])
                let limit = try integer(params, "limit", default: 20, range: 1...25)
                let offset = try integer(params, "offset", default: 0, range: 0...Int(Int32.max))
                let catalog = try readyDatabase().awardCatalog()
                return try catalogJSON(catalog, offset: offset, limit: limit,
                                       search: try string(params, "search", max: 120) ?? "",
                                       delivery: try string(params, "delivery_state", max: 40) ?? "")
            case "logbook_previous":
                try requireKeys(params, allowed: ["call", "limit"], required: ["call"])
                guard let call = try string(params, "call", max: 32), !call.isEmpty else { throw invalid() }
                let limit = try integer(params, "limit", default: 20, range: 1...25)
                return ["qsos": try json(try readyDatabase().previous(call: call, limit: limit))]
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
                let store = try settingsStore()
                return ["settings": try json(IntegrationWorkspace.safeSettings(from: store.load())),
                        "automatic_sync": false]
            case "settings_save":
                try requireKeys(params, allowed: ["settings"], required: ["settings"])
                guard let object = params["settings"] as? [String: Any] else { throw invalid() }
                let value: XLogSettings = try decode(object)
                let safe = IntegrationWorkspace.safeSettings(from: value)
                try settingsStore().save(safe)
                return ["settings": try json(safe), "automatic_sync": false]
            case "backup_create":
                try requireKeys(params, allowed: ["name"])
                guard !manualSyncActive else { throw WorkerFailure("sync_busy", "Wait for synchronization to finish before backing up.") }
                guard params["name"] == nil || params["name"] is String else { throw invalid() }
                let name = try backupName(params["name"] as? String)
                let db = try readyDatabase()
                let root = try backupDirectory()
                let package = root.appendingPathComponent(name).appendingPathExtension(XLogBackupManager.packageExtension)
                let reference = try referenceDirectoryURL()
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
            case "backup_inspect":
                try requireKeys(params, allowed: ["name"], required: ["name"])
                _ = try readyDatabase()
                let package = try existingBackup(named: params["name"])
                let preview = try XLogBackupManager().inspect(at: package)
                return ["name": package.lastPathComponent, "manifest": try json(preview.manifest),
                        "includes_settings": preview.settings != nil,
                        "includes_preferences": preview.preferences != nil]
            case "backup_restore":
                try requireKeys(params, allowed: ["name", "confirm_restore", "restore_settings", "restore_reference_data"], required: ["name", "confirm_restore"])
                guard params["confirm_restore"] as? Bool == true else {
                    throw WorkerFailure("restore_confirmation_required", "Confirm the isolated logbook restore before continuing.")
                }
                guard !manualSyncActive else { throw WorkerFailure("sync_busy", "Wait for synchronization to finish before restoring.") }
                _ = try readyDatabase()
                guard params["restore_settings"] == nil || params["restore_settings"] is Bool,
                      params["restore_reference_data"] == nil || params["restore_reference_data"] is Bool else { throw invalid() }
                let restoreSettings = params["restore_settings"] as? Bool ?? true
                let restoreReference = params["restore_reference_data"] as? Bool ?? true
                let package = try existingBackup(named: params["name"])
                let manager = XLogBackupManager()
                let preview = try manager.inspect(at: package)
                let db = try readyDatabase()
                let reference = try referenceDirectoryURL()
                let recovery = try workspaceSubdirectory("Recovery", create: true)
                let rollbackName = "pre-restore-\(UUID().uuidString).\(XLogBackupManager.packageExtension)"
                let rollback = recovery.appendingPathComponent(rollbackName)
                _ = try manager.create(database: db, at: rollback,
                                       settings: try currentSettings(),
                                       preferences: try currentBackupPreferences(),
                                       referenceDataURL: fileManager.fileExists(atPath: reference.path) ? reference : nil)
                db.close()
                database = nil
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
                    database = try LogbookDatabase(url: workspaceURL.appendingPathComponent("OM0RX-xLog.sqlite"))
                    workspace = try IntegrationWorkspaceBootstrap.open(at: workspaceURL)
                    return ["restored": true, "qso_count": try database?.count() ?? 0,
                            "recovery_backup": rollbackName, "automatic_sync": false]
                } catch {
                    database = try? LogbookDatabase(url: workspaceURL.appendingPathComponent("OM0RX-xLog.sqlite"))
                    throw error
                }
            default:
                throw WorkerFailure("method_not_allowed", "Unknown live logbook method.")
            }
        }
    }

    private func loadWorkspace() throws {
        if database != nil {
            try validateWorkspaceLocation()
            return
        }
        let loaded = try IntegrationWorkspaceBootstrap.open(at: workspaceURL)
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
                                            attributes: [.posixPermissions: 0o700])
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
        let attributes = try package.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
        guard attributes.isDirectory == true, attributes.isSymbolicLink != true else { throw invalid() }
        guard let enumerator = fileManager.enumerator(at: package, includingPropertiesForKeys: [.isSymbolicLinkKey]) else { throw invalid() }
        for case let child as URL in enumerator {
            guard try child.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink != true else {
                throw WorkerFailure("unsafe_backup", "The selected backup contains a symbolic link.")
            }
        }
        return package
    }

    private func currentBackupPreferences() throws -> XLogBackupPreferences {
        guard let defaults = workspace?.makeDefaults() else {
            throw WorkerFailure("workspace_required", "Create an isolated logbook first.")
        }
        return XLogBackupPreferences(
            deskBandMapBands: defaults.stringArray(forKey: "OM0RX-xLog.deskBandMapBands") ?? ["20m"],
            detachedBandMapBands: defaults.stringArray(forKey: "OM0RX-xLog.detachedBandMapBands") ?? Array(BandPlan.bands.prefix(10)),
            deskBandMapFollowsRadio: defaults.object(forKey: "OM0RX-xLog.deskBandMapFollowsRadio") as? Bool ?? true,
            detachedBandMapLayout: defaults.string(forKey: "OM0RX-xLog.detachedBandMapLayout") ?? "Adaptive grid",
            bandMapFontScale: defaults.object(forKey: "OM0RX-xLog.bandMapFontScale") as? Double ?? 1,
            intelligenceBands: defaults.stringArray(forKey: "OM0RX-xLog.intelligenceBands") ?? ["160m", "80m", "60m", "40m", "30m", "20m", "17m", "15m", "12m", "10m"],
            clusterSpotOpensFullEditor: defaults.bool(forKey: "OM0RX-xLog.clusterSpotOpensFullEditor")
        )
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
        guard let number = value as? NSNumber, String(cString: number.objCType) != "c",
              let result = Int(exactly: number.int64Value), range.contains(result) else { throw invalid() }
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
         "continent_counts": value.continentCounts, "year_counts": value.yearCounts]
    }

    private func catalogJSON(_ value: AwardCatalogSnapshot, offset: Int, limit: Int, search: String = "", delivery: String = "") throws -> [String: Any] {
        let matching = value.programmes.filter { programme in
            (delivery.isEmpty || programme.deliveryState.rawValue == delivery) &&
            (search.isEmpty || [programme.record.name, programme.record.sponsor, programme.record.scopeOrCountingFocus, programme.record.id]
                .joined(separator: " ").localizedCaseInsensitiveContains(search))
        }
        let programmes = try matching.dropFirst(offset).prefix(limit).map { programme -> [String: Any] in
            ["record": try json(programme.record),
             "delivery_state": programme.deliveryState.rawValue,
             "delivery_detail": programme.deliveryDetail,
             "progress_code": programme.progress?.code as Any? ?? NSNull()]
        }
        return ["reference_date": value.referenceDate, "research_date": value.researchDate,
         "total_programmes": matching.count, "catalogue_total": value.programmes.count, "offset": offset, "limit": limit,
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
#endif

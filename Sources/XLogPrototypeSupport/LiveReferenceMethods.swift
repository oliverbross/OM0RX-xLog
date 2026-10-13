#if os(macOS)
import Foundation
import XLogCore

/// Integrated workspace reference cache. A native timer owns automatic checks;
/// constructing this actor or reading status never starts network activity.
actor LiveReferenceMethods {
    static let shared = LiveReferenceMethods()

    private let logbook: LiveLogbookMethods
    private let session: URLSession
    private(set) var refreshTask: Task<Void, Never>?
    private var automaticTask: Task<Void, Never>?
    private var nextAutomaticCheck: Date?
    private var planning = false
    private var automaticChecking = false
    private var stopped = false
    private var workspaceTransitions = 0
    private var workspaceRevision = 0
    private let scheduleOperation: (@Sendable () async throws -> Void)?
    private var validatedCache: (files: [String: FileIdentity], unavailable: Set<String>)?
    private var lastResult = "Not refreshed in this session"
    private struct FileIdentity: Equatable {
        let size: Int64
        let modified: TimeInterval
        let fileNumber: UInt64
    }
    private var cachedDirectory: (path: String, files: [ActivationReferenceKind: FileIdentity], value: ActivationReferenceDirectory)?

    init(logbook: LiveLogbookMethods = .shared, session: URLSession = .shared,
         scheduleOperation: (@Sendable () async throws -> Void)? = nil) {
        self.logbook = logbook
        self.session = session
        self.scheduleOperation = scheduleOperation
    }

    func startAutomaticChecks() {
        guard automaticTask == nil, !stopped else { return }
        automaticTask = Task { [weak self] in
            while !Task.isCancelled {
                if let owner = self { await owner.automaticTick() } else { return }
                do { try await Task.sleep(nanoseconds: 15_000_000_000) } catch { return }
            }
        }
    }

    func automaticTick(now: Date = Date()) async {
        guard !stopped, workspaceTransitions == 0, !planning, !automaticChecking, refreshTask == nil,
              (try? logbook.automaticReferenceChecks()) == true else { return }
        guard nextAutomaticCheck == nil || now >= nextAutomaticCheck! else { return }
        automaticChecking = true
        defer { automaticChecking = false }
        let revision = workspaceRevision
        // The per-source deadlines decide whether HTTP is needed. A short
        // native heartbeat avoids a second-hour delay after a slow download
        // and catches up after sleep without relying on a visible webview.
        nextAutomaticCheck = now.addingTimeInterval(60)
        do {
            if let scheduleOperation { try await scheduleOperation() }
            else {
                let result = try await handle(method: "reference_schedule", params: [:])
                if revision == workspaceRevision, !stopped, workspaceTransitions == 0,
                   result["running"] as? Bool == false,
                   let deadline = result["next_check_at"] as? String,
                   let date = ISO8601DateFormatter().date(from: deadline) {
                    nextAutomaticCheck = date
                }
            }
        } catch {
            guard revision == workspaceRevision, !stopped, workspaceTransitions == 0 else { return }
            nextAutomaticCheck = now.addingTimeInterval(ReferenceCheckPlan.failureBackoff)
            lastResult = "Scheduled check could not start; it will retry automatically."
        }
    }

    func resetAutomaticDeadline() {
        workspaceRevision += 1
        nextAutomaticCheck = nil
    }

    func suspendForWorkspaceChange() async {
        workspaceTransitions += 1
        workspaceRevision += 1
        refreshTask?.cancel()
        await refreshTask?.value
        validatedCache = nil
        cachedDirectory = nil
    }

    func finishWorkspaceChange() {
        workspaceTransitions = max(0, workspaceTransitions - 1)
        nextAutomaticCheck = nil
    }

    func terminate() async {
        stopped = true
        workspaceRevision += 1
        automaticTask?.cancel(); automaticTask = nil
        refreshTask?.cancel()
        await refreshTask?.value
    }

    func handle(method: String, params: [String: Any]) async throws -> [String: Any] {
        guard !stopped, workspaceTransitions == 0 else {
            throw WorkerFailure("reference_unavailable", "Reference services are stopping or changing workspace.")
        }
        let directory = try logbook.referenceDirectoryURL()
        switch method {
        case "reference_configure":
            guard Set(params.keys).isSubset(of: ["enabled", "only_if_unset"]),
                  let enabled = params["enabled"] as? NSNumber, CFGetTypeID(enabled) == CFBooleanGetTypeID(),
                  params["only_if_unset"] == nil || (params["only_if_unset"] as? NSNumber).map({ CFGetTypeID($0) == CFBooleanGetTypeID() }) == true else { throw invalid() }
            let saved = try logbook.configureReferenceChecks(enabled: enabled.boolValue,
                onlyIfUnset: params["only_if_unset"] as? Bool ?? false)
            resetAutomaticDeadline()
            // The worker-owned loop will observe this choice; no network is
            // awaited by the immediate preference-save acknowledgement.
            return ["automatic_check": saved]
        case "reference_status":
            guard params.isEmpty else { throw invalid() }
            _ = try logbook.openedDatabase()
            let updater = try ReferenceDataUpdater(directory: directory, session: session)
            let state = await updater.currentState()
            return try status(state, directory: directory)
        case "reference_resolve":
            guard Set(params.keys) == ["comment", "special_tags"],
                  let comment = params["comment"] as? String, comment.count <= 8_192,
                  let tags = params["special_tags"] as? [String], tags.count <= 32,
                  tags.allSatisfy({ $0.count <= 128 }) else { throw invalid() }
            return try resolve(comment: comment, tags: tags, directory: directory)
        case "reference_refresh":
            guard Set(params.keys) == ["source"], let source = params["source"] as? String,
                  ["clublog_lotw", "activations", "wavelog_catalog"].contains(source) else { throw invalid() }
            _ = try logbook.openedDatabase()
            guard refreshTask == nil, !planning else { throw WorkerFailure("reference_busy", "A reference update is already running.") }
            let settings = try logbook.currentSettings()
            guard source != "wavelog_catalog" || settings.logbookMode == .wavelog else {
                throw WorkerFailure("reference_configuration_required", "Choose Wavelog mode before refreshing its catalog.")
            }
            let updater = try ReferenceDataUpdater(directory: directory, session: session)
            let secrets = SecretStore(service: try logbook.currentKeychainService())
            let clubKey = source == "clublog_lotw" ? (try secrets.load(.clubLogAPIKey) ?? "") : ""
            let token = source == "wavelog_catalog" ? (try secrets.load(.wavelogToken) ?? "") : ""
            guard source != "wavelog_catalog" || !token.isEmpty else {
                throw WorkerFailure("reference_configuration_required", "Save an integrated Wavelog token before refreshing its catalog.")
            }
            guard let clubURL = URL(string: settings.clubLogCTYURL),
                  let lotwURL = URL(string: settings.lotwActivityURL),
                  let wavelogURL = URL(string: settings.wavelogURL) else { throw invalid() }
            let lease = try ReferenceRefreshLease(directory: directory)
            lastResult = "Updating \(source)"
            refreshTask = Task {
                defer { lease.release() }
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
        case "reference_schedule":
            guard params.isEmpty else { throw invalid() }
            guard try logbook.automaticReferenceChecks() == true else {
                return ["running": refreshTask != nil, "scheduled": [String](), "automatic_check": false]
            }
            guard refreshTask == nil, !planning else {
                return ["running": true, "scheduled": [String](), "automatic_check": true]
            }
            planning = true
            let revision = workspaceRevision
            defer { planning = false }
            let lease = try ReferenceRefreshLease(directory: directory)
            var leaseTransferred = false
            defer { if !leaseTransferred { lease.release() } }
            _ = try logbook.openedDatabase()
            let settings = try logbook.currentSettings()
            let secrets = SecretStore(service: try logbook.currentKeychainService())
            let clubKey = try secrets.load(.clubLogAPIKey) ?? ""
            let token = settings.logbookMode == .wavelog ? (try secrets.load(.wavelogToken) ?? "") : ""
            let updater = try ReferenceDataUpdater(directory: directory, session: session)
            let clubURL = URL(string: settings.clubLogCTYURL)
            let lotwURL = URL(string: settings.lotwActivityURL)
            let wavelogURL = URL(string: settings.wavelogURL)
            var expectedIdentities: [String: String] = [:]
            if let clubURL, !clubKey.isEmpty,
               let requestURL = ReferenceDataUpdater.clubLogRequestURL(clubURL, apiKey: clubKey) {
                expectedIdentities["cty.xml"] = ReferenceDataUpdater.sourceIdentity(for: requestURL)
            }
            if let lotwURL {
                expectedIdentities["lotw-user-activity.csv"] = ReferenceDataUpdater.sourceIdentity(for: lotwURL)
            }
            for kind in [ActivationReferenceKind.pota, .sota, .iota, .wwff] {
                if let url = ReferenceDataUpdater.activationSourceURLs[kind] {
                    expectedIdentities[kind.fileName] = ReferenceDataUpdater.sourceIdentity(for: url)
                }
            }
            if settings.logbookMode == .wavelog, let wavelogURL, !token.isEmpty,
               let requestURL = ReferenceDataUpdater.wavelogCatalogURL(wavelogURL) {
                expectedIdentities["wavelog-catalog.json"] = ReferenceDataUpdater.sourceIdentity(
                    for: requestURL, credential: token)
            }
            let unavailable = try await unavailableCaches(updater: updater, directory: directory)
            let plan = ReferenceCheckPlan.make(
                state: await updater.currentState(), now: Date(),
                clubLogConfigured: expectedIdentities["cty.xml"] != nil,
                wavelogConfigured: expectedIdentities["wavelog-catalog.json"] != nil,
                expectedIdentities: expectedIdentities, unavailableSources: unavailable
            )
            let due = plan.due
            let next = plan.nextCheckAt.map { ISO8601DateFormatter().string(from: $0) } ?? NSNull() as Any
            guard !stopped, workspaceTransitions == 0, revision == workspaceRevision,
                  try logbook.automaticReferenceChecks() == true,
                  refreshTask == nil, !due.isEmpty else {
                return ["running": refreshTask != nil, "scheduled": [String](),
                        "due": due, "next_check_at": next]
            }
            lastResult = "Checking scheduled reference sources"
            leaseTransferred = true
            refreshTask = Task {
                defer { lease.release() }
                var failed = false
                let hasCTY = due.contains("cty.xml")
                let hasLoTW = due.contains("lotw-user-activity.csv")
                if hasCTY, let clubURL, self.mayContinueScheduledChecks(revision: revision) {
                    do { _ = try await updater.refreshClubLog(clubURL, apiKey: clubKey) }
                    catch { failed = true }
                } else if hasCTY { failed = true }
                if hasLoTW, let lotwURL, self.mayContinueScheduledChecks(revision: revision) {
                    do { _ = try await updater.refreshLoTW(lotwURL) }
                    catch { failed = true }
                } else if hasLoTW { failed = true }
                for kind in [ActivationReferenceKind.pota, .sota, .iota, .wwff] where due.contains(kind.fileName) {
                    guard self.mayContinueScheduledChecks(revision: revision) else { break }
                    do { _ = try await updater.refreshActivationDirectory(kind) }
                    catch { failed = true }
                }
                if due.contains("wavelog-catalog.json"), let wavelogURL, self.mayContinueScheduledChecks(revision: revision) {
                    do { _ = try await updater.refreshWavelogCatalog(baseURL: wavelogURL, token: token) }
                    catch { failed = true }
                } else if due.contains("wavelog-catalog.json") { failed = true }
                self.finish(!self.mayContinueScheduledChecks(revision: revision)
                    ? "Scheduled checks stopped; remaining sources were not checked."
                    : failed ? "Some scheduled checks failed; validated cache was retained."
                             : "Scheduled reference checks completed")
            }
            return ["running": true, "scheduled": due, "due": due, "next_check_at": next]
        default:
            throw WorkerFailure("method_not_allowed", "Unknown reference-data operation.")
        }
    }

    private func mayContinueScheduledChecks(revision: Int) -> Bool {
        !stopped && workspaceTransitions == 0 && workspaceRevision == revision && !Task.isCancelled
            && (try? logbook.automaticReferenceChecks()) == true
    }

    private func unavailableCaches(updater: ReferenceDataUpdater, directory: URL) async throws -> Set<String> {
        var files: [String: FileIdentity] = [:]
        for name in ["cty.xml", "lotw-user-activity.csv", "wavelog-catalog.json"]
            + [ActivationReferenceKind.pota, .sota, .iota, .wwff].map(\.fileName) {
            let path = directory.appendingPathComponent(name).path
            if let attributes = try? FileManager.default.attributesOfItem(atPath: path),
               attributes[.type] as? FileAttributeType == .typeRegular {
                files[name] = FileIdentity(size: (attributes[.size] as? NSNumber)?.int64Value ?? 0,
                    modified: (attributes[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0,
                    fileNumber: (attributes[.systemFileNumber] as? NSNumber)?.uint64Value ?? 0)
            }
        }
        if let cached = validatedCache, cached.files == files { return cached.unavailable }
        let unavailable = await updater.unavailableCachedSources()
        validatedCache = (files, unavailable)
        return unavailable
    }

    private func status(_ state: ReferenceDataState, directory: URL) throws -> [String: Any] {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let stateJSON = try JSONSerialization.jsonObject(with: encoder.encode(state))
        let downloaded = directory.appendingPathComponent("cty.xml")
        let usingDownloadedCTY = FileManager.default.fileExists(atPath: downloaded.path)
            && (try? CTYResolver(xmlURL: downloaded)) != nil
        return ["running": refreshTask != nil, "status": lastResult,
                "automatic_check": try logbook.automaticReferenceChecks() as Any? ?? NSNull(),
                "cty_source": usingDownloadedCTY ? "workspace_download" : "bundled",
                "state": stateJSON]
    }

    private func finish(_ result: String) {
        lastResult = result
        refreshTask = nil
    }

    private func resolve(comment: String, tags: [String], directory: URL) throws -> [String: Any] {
        let parsed = AwardReferenceParser.extract(comment: comment, specialTags: tags)
        let text = ([comment] + tags).joined(separator: " ").uppercased()
        let castleRaw = [parsed.sigInfo].filter { !$0.isEmpty }
            + matches(#"\b(?:WCA|COTA|CASTLE)[-:\s]+[A-Z0-9][A-Z0-9/-]{1,24}\b"#, in: text)
        let castle = castleRaw.first.flatMap(castleReference)
        let potaMatches = AwardReferenceParser.potaReferences(comment: comment, specialTags: tags)
        let potaPrimary = potaMatches.first ?? ""
        let directoryData = try activationDirectory(at: directory)
        let fields: [String: String] = [
            "potaReference": potaPrimary, "sotaReference": parsed.sota,
            "iota": parsed.iota, "wwffReference": parsed.wwff,
            "sig": castle?.programme ?? parsed.sig, "sigInfo": castle?.reference ?? parsed.sigInfo,
        ]
        var candidates: [(ActivationReferenceKind, String, String?)] = []
        var seen = Set<String>()
        func add(_ kind: ActivationReferenceKind, _ reference: String, _ original: String? = nil) {
            guard !reference.isEmpty, seen.insert("\(kind.rawValue):\(reference)").inserted else { return }
            candidates.append((kind, reference, original))
        }
        let patterns: [(ActivationReferenceKind, String, String)] = [
            (.pota, potaPrimary, #"\b[A-Z0-9]{1,3}-\d{4,5}\b"#),
            (.sota, parsed.sota, #"\b[A-Z0-9]{1,3}/[A-Z0-9]{1,3}-\d{3,4}\b"#),
            (.iota, parsed.iota, #"\b(?:AF|AN|AS|EU|NA|OC|SA)-\d{3}\b"#),
            (.wwff, parsed.wwff, #"\b[A-Z0-9]{1,4}FF-\d{3,5}\b"#),
        ]
        for (kind, primary, pattern) in patterns {
            add(kind, primary)
            if kind == .pota {
                for value in potaMatches { add(kind, value) }
            } else {
                for value in matches(pattern, in: text) { add(kind, value) }
            }
        }
        for raw in castleRaw {
            if let value = castleReference(raw) { add(.castle, value.reference, raw) }
        }
        let references: [[String: String]] = candidates.compactMap { kind, reference, original in
            let match = directoryData.exactMatch(reference, kind: kind)
                ?? original.flatMap { directoryData.exactMatch($0, kind: kind) }
            let status = !directoryData.hasData(for: kind) ? "not_installed" : match == nil ? "not_found" : "verified"
            return ["kind": kind.rawValue, "reference": reference, "status": status,
                    "name": match?.name ?? "", "detail": match?.detail ?? ""]
        }
        return ["fields": fields, "references": references]
    }

    private func castleReference(_ raw: String) -> (programme: String, reference: String)? {
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard !value.isEmpty else { return nil }
        for programme in ["WCA", "COTA", "CASTLE"] {
            for separator in [" ", "-", ":", "/"] where value.hasPrefix(programme + separator) {
                let stripped = String(value.dropFirst(programme.count + separator.count))
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                if !stripped.isEmpty { return (programme, stripped) }
            }
        }
        // An unfamiliar castle reference is never silently rewritten.
        return ("CASTLE", value)
    }

    private func matches(_ pattern: String, in text: String) -> [String] {
        guard let expression = try? NSRegularExpression(pattern: pattern) else { return [] }
        return expression.matches(in: text, range: NSRange(text.startIndex..., in: text)).compactMap { match in
            Range(match.range, in: text).map { String(text[$0]) }
        }
    }

    private func activationDirectory(at directory: URL) throws -> ActivationReferenceDirectory {
        let manager = FileManager.default
        var files: [ActivationReferenceKind: FileIdentity] = [:]
        for kind in ActivationReferenceKind.allCases {
            let file = directory.appendingPathComponent(kind.fileName)
            guard manager.fileExists(atPath: file.path) else { continue }
            let attributes = try manager.attributesOfItem(atPath: file.path)
            guard attributes[.type] as? FileAttributeType == .typeRegular else {
                throw WorkerFailure("reference_data_invalid", "An installed reference directory is not a regular file.")
            }
            files[kind] = FileIdentity(
                size: (attributes[.size] as? NSNumber)?.int64Value ?? -1,
                modified: (attributes[.modificationDate] as? Date)?.timeIntervalSince1970 ?? -1,
                fileNumber: (attributes[.systemFileNumber] as? NSNumber)?.uint64Value ?? 0
            )
        }
        if let cachedDirectory, cachedDirectory.path == directory.path, cachedDirectory.files == files {
            return cachedDirectory.value
        }
        let loaded: ActivationReferenceDirectory
        do { loaded = try ActivationReferenceDirectory(directory: directory) }
        catch { throw WorkerFailure("reference_data_invalid", "An installed reference directory could not be parsed.") }
        cachedDirectory = (directory.path, files, loaded)
        return loaded
    }

    private func invalid() -> WorkerFailure {
        WorkerFailure("invalid_params", "Invalid reference-data request.")
    }
}
#endif

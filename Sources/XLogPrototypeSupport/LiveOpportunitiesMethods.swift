import Foundation
import XClusterIntegrationCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif

/// Read-only operator opportunities. The Chaser view refreshes feeds independently;
/// plain snapshots remain local, and no operation here contacts station hardware.
actor LiveOpportunitiesMethods {
    static let shared = LiveOpportunitiesMethods()
    private struct Feed: Codable {
        var items: [PublicOpportunity] = []
        var lastSuccess: Date?
        var lastAttempt: Date?
        var safeError: String? = nil
    }
    private let logbook: LiveLogbookMethods
    private let session: URLSession
    private let clusterSpots: () async -> [[String: Any]]
    private var loaded = false
    private var feeds: [String: Feed] = [:]
    private var refreshing: [String: Task<Void, Never>] = [:]
    private var terminated = false
    private var cachedDirectory: (path: String, identity: String, value: ActivationReferenceDirectory)?
    private let names = ["pota", "sota", "wwff", "wwbota", "425dxn"]
    private let timestampFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    init(logbook: LiveLogbookMethods = .shared, session: URLSession? = nil,
         clusterSpots: @escaping () async -> [[String: Any]] = {
             await LiveClusterMethods.shared.currentSpotRowsIfStarted()
         }) {
        self.logbook = logbook
        self.clusterSpots = clusterSpots
        if let session { self.session = session }
        else {
            let config = URLSessionConfiguration.ephemeral
            config.httpCookieAcceptPolicy = .never
            config.httpShouldSetCookies = false
            config.urlCredentialStorage = nil
            self.session = URLSession(configuration: config)
        }
    }

    func handle(method: String, params: [String: Any]) async throws -> [String: Any] {
        guard !terminated else { throw WorkerFailure("worker_stopping", "The opportunity service has shut down.") }
        _ = try logbook.openedDatabase()
        try loadCache()
        switch method {
        case "opportunities_snapshot":
            guard params.isEmpty else { throw invalid() }
        case "opportunities_refresh":
            guard Set(params.keys).isSubset(of: ["source", "automatic"]), let source = params["source"] as? String,
                  params["automatic"] == nil || params["automatic"] is Bool,
                  names.contains(source) || source == "all" else { throw invalid() }
            if source == "all" {
                let automatic = params["automatic"] as? Bool ?? true
                await withTaskGroup(of: Void.self) { group in
                    for name in names { group.addTask { await self.refresh(name, automatic: automatic) } }
                }
            } else { await refresh(source, automatic: params["automatic"] as? Bool ?? false) }
        default:
            throw WorkerFailure("method_not_allowed", "Unknown opportunity operation.")
        }
        guard !terminated else { throw WorkerFailure("worker_stopping", "The opportunity service has shut down.") }
        return try await snapshot()
    }

    func terminate() {
        terminated = true
        for task in refreshing.values { task.cancel() }
        refreshing.removeAll()
    }

    /// Returns only the already-retained public feed values. This never starts
    /// a refresh, reads cluster state, or changes the cache; the caller supplies
    /// the evaluation clock so expiry remains deterministic.
    func retainedItems() throws -> [PublicOpportunity] {
        guard !terminated else { throw WorkerFailure("worker_stopping", "The opportunity service has shut down.") }
        _ = try logbook.openedDatabase()
        try loadCache(createDirectory: false)
        return names.flatMap { feeds[$0]?.items ?? [] }
    }

    private func refresh(_ source: String, automatic: Bool = false) async {
        guard !terminated else { return }
        if let pending = refreshing[source] { await pending.value; return }
        // Shared across windows/remounts. Slow or unavailable sources cannot
        // create overlapping downloads or a tight retry loop.
        let interval: TimeInterval = source == "425dxn" && feeds[source]?.safeError == nil ? 6 * 3_600 : 60
        let oldCalendar = source == "425dxn" && feeds[source]?.items.contains(where: { $0.startsAt == nil }) == true
        if automatic, !oldCalendar, let attempt = feeds[source]?.lastAttempt, Date().timeIntervalSince(attempt) < interval { return }
        let task = Task { await self.fetch(source) }
        refreshing[source] = task
        await task.value
        refreshing.removeValue(forKey: source)
    }

    private func fetch(_ source: String) async {
        var prior = feeds[source] ?? Feed()
        prior.lastAttempt = Date()
        feeds[source] = prior
        do {
            guard let url = URL(string: OpportunityFeedParser.sourceURL(source)) else { throw OpportunityFeedError.invalidBody }
            var request = URLRequest(url: url)
            request.timeoutInterval = 15
            request.setValue("application/json", forHTTPHeaderField: "Accept")
            let data = try await OpportunityDownload.fetch(request, configuration: session.configuration)
            let items = try OpportunityFeedParser.parse(data, source: source, observedAt: Date())
            guard !terminated, !Task.isCancelled else { return }
            prior.items = items
            prior.lastSuccess = Date()
            prior.safeError = nil
            feeds[source] = prior
            try? saveCache()
        } catch {
            guard !terminated, !Task.isCancelled else { return }
            prior.safeError = "SOURCE_UNAVAILABLE_OR_INVALID"
            feeds[source] = prior
            try? saveCache()
        }
    }

    private func snapshot() async throws -> [String: Any] {
        let now = Date()
        var all = names.flatMap { feeds[$0]?.items ?? [] }.filter { $0.expiresAt > now }
        // Cluster rows supplement official data. Their source and reference
        // evidence remain distinct; an unvalidated comment is not a park name.
        let spots = await clusterSpots()
        var latestByCall: [String: [String: Any]] = [:]
        for row in spots {
            guard let call = row["callsign"] as? String,
                  let khz = row["frequencyKHz"] as? Double, khz.isFinite, khz >= 100, khz <= 1_000_000,
                  let received = row["receivedAt"] as? Double, received.isFinite else { continue }
            let age = now.timeIntervalSince(Date(timeIntervalSinceReferenceDate: received))
            guard age >= -60, age <= 3_600 else { continue }
            let key = call.uppercased()
            if received > (latestByCall[key]?["receivedAt"] as? Double ?? -.infinity) { latestByCall[key] = row }
        }
        for row in spots.prefix(350) {
                guard let call = row["callsign"] as? String,
                      let comment = row["comment"] as? String,
                      let id = row["id"] as? String,
                      let khz = row["frequencyKHz"] as? Double,
                      khz.isFinite, khz >= 100, khz <= 1_000_000 else { continue }
                let references = AwardReferenceParser.extract(comment: comment,
                    specialTags: row["specialTags"] as? [String] ?? [])
                let observed = (row["receivedAt"] as? Double).map(Date.init(timeIntervalSinceReferenceDate:)) ?? now
                guard observed <= now.addingTimeInterval(60), now.timeIntervalSince(observed) <= 3_600 else { continue }
                let castle = ["WCA", "COTA", "CASTLE"].contains(references.sig) ? references.sigInfo : ""
                let values = [("pota", references.pota), ("sota", references.sota),
                              ("wwff", references.wwff), ("iota", references.iota),
                              ("castle", castle)]
                for (kind, reference) in values where !reference.isEmpty {
                    all.append(PublicOpportunity(id: "cluster:\(id):\(kind)", kind: kind,
                        callsign: call, reference: reference, name: "",
                        frequencyHz: Int64((khz * 1_000).rounded()),
                        mode: row["mode"] as? String ?? "", observedAt: observed,
                        expiresAt: observed.addingTimeInterval(3_600),
                        source: "Configured DX cluster", sourceURL: "", comment: comment))
                }
        }
        let database = try logbook.openedDatabase()
        let history = try database.opportunityReferenceHistory()
        let byReference = Dictionary(uniqueKeysWithValues: history.map { ("\($0.kind.lowercased()):\($0.reference.uppercased())", $0) })
        let classification = try? logbook.clusterClassificationSnapshot()
        let directory = try activationDirectory()
        let selected = Array(all.sorted { $0.observedAt > $1.observedAt }.prefix(300))
        let items: [[String: Any]] = selected.map { item in
            let calendar = item.kind == "dxpedition" || item.kind == "special_event"
            let reference = calendar ? OpportunityFeedParser.iotaReference(in: item.reference + " " + item.name) ?? item.reference : item.reference
            let referenceKind = calendar && OpportunityFeedParser.iotaReference(in: reference) != nil ? "iota" : item.kind
            let key = "\(referenceKind):\(reference.uppercased())"
            let evidence = byReference[key]
            let kind = ActivationReferenceKind(rawValue: referenceKind)
            let match = kind.flatMap { directory.exactMatch(reference, kind: $0) }
            let directoryLocation = match?.latitude != nil && match?.longitude != nil
            let feedLocation = item.latitude != nil && item.longitude != nil
            let aliases = Set((item.callsigns ?? [item.callsign]).map { $0.uppercased() })
            let operationActive = (item.startsAt ?? .distantPast) <= now && (item.endsAt ?? item.expiresAt) > now
            let latestSpot = calendar && operationActive ? aliases.compactMap { latestByCall[$0] }
                .max { ($0["receivedAt"] as? Double ?? 0) < ($1["receivedAt"] as? Double ?? 0) } : nil
            let callsign = latestSpot?["callsign"] as? String ?? item.callsign
            let frequency = latestSpot.flatMap { ($0["frequencyKHz"] as? Double).map { Int64(($0 * 1_000).rounded()) } } ?? item.frequencyHz
            let areaLocation = directoryLocation && kind == .iota
            let referenceStatus = kind.map { !directory.hasData(for: $0) ? "not_installed" : match == nil ? "not_found" : "verified" } ?? "not_applicable"
            let country = classification?.resolver.resolve(callsign, at: item.startsAt ?? item.observedAt)
            let modeHistory = country.flatMap { entity in
                classification.map { $0.index.dxccModeHistory(adif: entity.adif) }
            }
            let confirmedModes = modeHistory?.confirmed ?? []
            let confirmedSet = Set(confirmedModes)
            let workedOnlyModes = (modeHistory?.worked ?? []).filter { !confirmedSet.contains($0) }
            let dxccHistory: Any = country.map { ["adif": $0.adif, "entity": $0.name,
                "worked_modes": workedOnlyModes, "confirmed_modes": confirmedModes] as [String: Any] } ?? NSNull()
            return ["id": item.id, "kind": item.kind, "callsign": callsign,
                    "reference": reference, "reference_kind": referenceKind,
                    "programmes": referenceKind != item.kind ? [item.kind, referenceKind] : [item.kind],
                    "name": item.name.isEmpty ? match?.name ?? "" : item.name,
                    "frequency_hz": frequency as Any? ?? NSNull(), "mode": latestSpot?["mode"] as? String ?? item.mode,
                    "observed_at": iso(item.observedAt), "expires_at": iso(item.expiresAt),
                    "source": item.source, "source_url": item.sourceURL, "comment": item.comment,
                    "reference_status": referenceStatus,
                    "latitude": (directoryLocation ? match?.latitude : feedLocation ? item.latitude : nil) as Any? ?? NSNull(),
                    "longitude": (directoryLocation ? match?.longitude : feedLocation ? item.longitude : nil) as Any? ?? NSNull(),
                    "location_source": areaLocation ? "IOTA group centre — approximate area, not station position" : directoryLocation ? "Reference directory" : feedLocation ? "Public feed" : "No published coordinates",
                    "location_accuracy": areaLocation ? "reference_area" : directoryLocation || feedLocation ? "reference_position" : "unavailable",
                    "activity": calendar ? latestSpot == nil ? "scheduled" : "spotted_operation" : "live_spot",
                    "starts_at": item.startsAt.map(iso) as Any? ?? NSNull(),
                    "ends_at": calendar ? iso(item.endsAt ?? item.expiresAt) as Any : NSNull(),
                    "latest_spot_at": latestSpot.flatMap { ($0["receivedAt"] as? Double).map { iso(Date(timeIntervalSinceReferenceDate: $0)) } } as Any? ?? NSNull(),
                    "dxcc_history": dxccHistory,
                    "worked_count": evidence?.workedCount ?? 0,
                    "confirmed_count": evidence?.confirmedCount ?? 0,
                    "band_modes": evidence?.bandModes.map { cell in
                        ["band": cell.band, "mode": cell.mode,
                         "worked_count": cell.workedCount, "confirmed_count": cell.confirmedCount] as [String: Any]
                    } ?? []] as [String: Any]
        }
        let sources: [[String: Any]] = names.map { source in
            let feed = feeds[source] ?? Feed()
            let age = feed.lastSuccess.map { now.timeIntervalSince($0) }
            let ttl: TimeInterval = source == "425dxn" ? 25 * 3_600 : 300
            let state = feed.lastSuccess == nil ? "unavailable" : feed.safeError != nil || (age ?? .infinity) > ttl ? "stale" : "current"
            return ["source": source, "state": state, "count": feed.items.filter { $0.expiresAt > now }.count,
                    "refreshing": refreshing[source] != nil,
                    "source_url": OpportunityFeedParser.sourceURL(source),
                    "last_success": feed.lastSuccess.map(iso) as Any? ?? NSNull(),
                    "last_attempt": feed.lastAttempt.map(iso) as Any? ?? NSNull(),
                    "safe_error": feed.safeError as Any? ?? NSNull()] as [String: Any]
        }
        return ["generated_at": iso(now), "items": items, "total_available": all.count,
                "history_state": "ready", "sources": sources,
                "selection_tunes": false, "transmit": false]
    }

    private func cacheURL(createDirectory: Bool = true) throws -> URL {
        let directory = logbook.workspaceDirectoryURL.appendingPathComponent("Opportunities", isDirectory: true)
        let fm = FileManager.default
        if fm.fileExists(atPath: directory.path) {
            let values = try directory.resourceValues(forKeys: [.isSymbolicLinkKey, .isDirectoryKey])
            guard values.isSymbolicLink != true && values.isDirectory == true else { throw invalid() }
        } else if createDirectory { try fm.createDirectory(at: directory, withIntermediateDirectories: false) }
        let file = directory.appendingPathComponent("public-feed-cache.json")
        if fm.fileExists(atPath: file.path) {
            guard try file.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink != true else { throw invalid() }
        }
        return file
    }
    private func activationDirectory() throws -> ActivationReferenceDirectory {
        let directory = try logbook.referenceDirectoryURL()
        var parts: [String] = []
        for kind in ActivationReferenceKind.allCases {
            let file = directory.appendingPathComponent(kind.fileName)
            guard FileManager.default.fileExists(atPath: file.path) else { continue }
            let attributes = try FileManager.default.attributesOfItem(atPath: file.path)
            guard attributes[.type] as? FileAttributeType == .typeRegular else { throw invalid() }
            parts.append([kind.rawValue,
                          String((attributes[.size] as? NSNumber)?.int64Value ?? -1),
                          String((attributes[.modificationDate] as? Date)?.timeIntervalSince1970 ?? -1),
                          String((attributes[.systemFileNumber] as? NSNumber)?.uint64Value ?? 0)].joined(separator: ":"))
        }
        let identity = parts.joined(separator: "|")
        if let cachedDirectory, cachedDirectory.path == directory.path,
           cachedDirectory.identity == identity { return cachedDirectory.value }
        let loaded = try ActivationReferenceDirectory(directory: directory)
        cachedDirectory = (directory.path, identity, loaded)
        return loaded
    }
    private func loadCache(createDirectory: Bool = true) throws {
        guard !loaded else { return }
        let url = try cacheURL(createDirectory: createDirectory)
        if FileManager.default.fileExists(atPath: url.path) {
            let data = try Data(contentsOf: url)
            guard data.count <= 8_388_608 else { throw invalid() }
            feeds = try JSONDecoder().decode([String: Feed].self, from: data)
            feeds = feeds.filter { names.contains($0.key) }
        }
        loaded = true
    }
    private func saveCache() throws {
        let data = try JSONEncoder().encode(feeds)
        guard data.count <= 8_388_608 else { throw invalid() }
        try data.write(to: cacheURL(), options: .atomic)
    }
    private func iso(_ date: Date) -> String {
        timestampFormatter.string(from: date)
    }
    private func invalid() -> WorkerFailure { WorkerFailure("invalid_params", "Invalid opportunity request or cache.") }
}

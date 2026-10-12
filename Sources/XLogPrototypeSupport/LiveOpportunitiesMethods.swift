import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif

/// Read-only operator opportunities. Public feeds are fetched only after an
/// explicit refresh; loading this actor never contacts a publisher or a radio.
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
    private var cachedDirectory: (path: String, identity: String, value: ActivationReferenceDirectory)?
    private let names = ["pota", "sota", "wwff", "wwbota", "425dxn"]

    init(logbook: LiveLogbookMethods = .shared, session: URLSession? = nil,
         clusterSpots: @escaping () async -> [[String: Any]] = {
             #if os(macOS)
             await LiveClusterMethods.shared.currentSpotRowsIfStarted()
             #else
             []
             #endif
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
        _ = try logbook.openedDatabase()
        try loadCache()
        switch method {
        case "opportunities_snapshot":
            guard params.isEmpty else { throw invalid() }
        case "opportunities_refresh":
            guard Set(params.keys) == ["source"], let source = params["source"] as? String,
                  names.contains(source) else { throw invalid() }
            await refresh(source)
        default:
            throw WorkerFailure("method_not_allowed", "Unknown opportunity operation.")
        }
        return try await snapshot()
    }

    private func refresh(_ source: String) async {
        var prior = feeds[source] ?? Feed()
        prior.lastAttempt = Date()
        do {
            guard let url = URL(string: OpportunityFeedParser.sourceURL(source)) else { throw OpportunityFeedError.invalidBody }
            var request = URLRequest(url: url)
            request.timeoutInterval = 15
            request.setValue("application/json", forHTTPHeaderField: "Accept")
            let data = try await OpportunityDownload.fetch(request, configuration: session.configuration)
            let items = try OpportunityFeedParser.parse(data, source: source, observedAt: Date())
            prior.items = items
            prior.lastSuccess = Date()
            prior.safeError = nil
            feeds[source] = prior
            try? saveCache()
        } catch {
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
        let directory = try activationDirectory()
        let selected = Array(all.sorted { $0.observedAt > $1.observedAt }.prefix(300))
        let items: [[String: Any]] = selected.map { item in
            let key = "\(item.kind):\(item.reference.uppercased())"
            let evidence = byReference[key]
            let kind = ActivationReferenceKind(rawValue: item.kind)
            let match = kind.flatMap { directory.exactMatch(item.reference, kind: $0) }
            let referenceStatus = kind.map { !directory.hasData(for: $0) ? "not_installed" : match == nil ? "not_found" : "verified" } ?? "not_applicable"
            return ["id": item.id, "kind": item.kind, "callsign": item.callsign,
                    "reference": item.reference, "name": item.name.isEmpty ? match?.name ?? "" : item.name,
                    "frequency_hz": item.frequencyHz as Any? ?? NSNull(), "mode": item.mode,
                    "observed_at": iso(item.observedAt), "expires_at": iso(item.expiresAt),
                    "source": item.source, "source_url": item.sourceURL, "comment": item.comment,
                    "reference_status": referenceStatus,
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
            return ["source": source, "state": state, "count": feed.items.count,
                    "source_url": OpportunityFeedParser.sourceURL(source),
                    "last_success": feed.lastSuccess.map(iso) as Any? ?? NSNull(),
                    "last_attempt": feed.lastAttempt.map(iso) as Any? ?? NSNull(),
                    "safe_error": feed.safeError as Any? ?? NSNull()] as [String: Any]
        }
        return ["generated_at": iso(now), "items": items, "total_available": all.count,
                "history_state": "ready", "sources": sources,
                "selection_tunes": false, "transmit": false]
    }

    private func cacheURL() throws -> URL {
        let directory = logbook.workspaceDirectoryURL.appendingPathComponent("Opportunities", isDirectory: true)
        let fm = FileManager.default
        if fm.fileExists(atPath: directory.path) {
            let values = try directory.resourceValues(forKeys: [.isSymbolicLinkKey, .isDirectoryKey])
            guard values.isSymbolicLink != true && values.isDirectory == true else { throw invalid() }
        } else { try fm.createDirectory(at: directory, withIntermediateDirectories: false) }
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
    private func loadCache() throws {
        guard !loaded else { return }
        let url = try cacheURL()
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
    private func iso(_ date: Date) -> String { ISO8601DateFormatter().string(from: date) }
    private func invalid() -> WorkerFailure { WorkerFailure("invalid_params", "Invalid opportunity request or cache.") }
}

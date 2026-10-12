#if os(macOS)
import Foundation
import XLogCore

/// Explicit refresh of the integrated workspace's own reference cache.
/// Nothing starts at app launch, and the native xLog cache is never opened.
actor LiveReferenceMethods {
    static let shared = LiveReferenceMethods()

    private let logbook: LiveLogbookMethods
    private let session: URLSession
    private var refreshTask: Task<Void, Never>?
    private var lastResult = "Not refreshed in this session"
    private struct FileIdentity: Equatable {
        let size: Int64
        let modified: TimeInterval
        let fileNumber: UInt64
    }
    private var cachedDirectory: (path: String, files: [ActivationReferenceKind: FileIdentity], value: ActivationReferenceDirectory)?

    init(logbook: LiveLogbookMethods = .shared, session: URLSession = .shared) {
        self.logbook = logbook
        self.session = session
    }

    func handle(method: String, params: [String: Any]) async throws -> [String: Any] {
        let directory = try logbook.referenceDirectoryURL()
        switch method {
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
            guard refreshTask == nil else { throw WorkerFailure("reference_busy", "A reference update is already running.") }
            let settings = try logbook.currentSettings()
            let updater = try ReferenceDataUpdater(directory: directory, session: session)
            let secrets = SecretStore(service: try logbook.currentKeychainService())
            let clubKey = try secrets.load(.clubLogAPIKey) ?? ""
            let token = try secrets.load(.wavelogToken) ?? ""
            guard source != "wavelog_catalog" || !token.isEmpty else {
                throw WorkerFailure("reference_configuration_required", "Save an integrated Wavelog token before refreshing its catalog.")
            }
            guard let clubURL = URL(string: settings.clubLogCTYURL),
                  let lotwURL = URL(string: settings.lotwActivityURL),
                  let wavelogURL = URL(string: settings.wavelogURL) else { throw invalid() }
            lastResult = "Updating \(source)"
            refreshTask = Task {
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
        default:
            throw WorkerFailure("method_not_allowed", "Unknown reference-data operation.")
        }
    }

    private func status(_ state: ReferenceDataState, directory: URL) throws -> [String: Any] {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let stateJSON = try JSONSerialization.jsonObject(with: encoder.encode(state))
        let downloaded = directory.appendingPathComponent("cty.xml")
        let usingDownloadedCTY = FileManager.default.fileExists(atPath: downloaded.path)
            && (try? CTYResolver(xmlURL: downloaded)) != nil
        return ["running": refreshTask != nil, "status": lastResult,
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
        let castleKeys = Set(castleRaw.compactMap(castleReference).map(\.reference))
        let wwffKeys = Set(matches(#"\b[A-Z0-9]{1,4}FF-\d{3,5}\b"#, in: text))
        let potaMatches = text.contains("POTA")
            ? matches(#"\b[A-Z0-9]{1,3}-\d{4,5}\b"#, in: text)
                .filter { !castleKeys.contains($0) && !wwffKeys.contains($0) } : []
        let potaPrimary = castleKeys.contains(parsed.pota) || wwffKeys.contains(parsed.pota)
            ? (potaMatches.first ?? "") : parsed.pota
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

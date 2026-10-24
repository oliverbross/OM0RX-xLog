import Foundation
import XContestCore
#if os(macOS)
import XLogCore
#else
import XLogPortableCore
#endif

/// Application-relative launch information for the bundled Not1MM host.
/// Production never searches PATH or a user Python installation.
struct PythonContestHostConfiguration: Sendable, Equatable {
    let executableURL: URL
    let launcherURL: URL
    let dataRootURL: URL
    let sslCertificateFileURL: URL?

    init(executableURL: URL, launcherURL: URL, dataRootURL: URL,
         sslCertificateFileURL: URL? = nil) {
        self.executableURL = executableURL
        self.launcherURL = launcherURL
        self.dataRootURL = dataRootURL
        self.sslCertificateFileURL = sslCertificateFileURL
    }

    static func bundled(applicationSupport: URL, bundle: Bundle = .main,
                        fileManager: FileManager = .default) throws -> Self {
        guard let resources = bundle.resourceURL else {
            throw ContestLaneError.confirmed("contest_host_unavailable", "The bundled contest resources are unavailable.")
        }
        let executable = bundle.bundleURL.appendingPathComponent(
            "Contents/Frameworks/Python.framework/Versions/3.12/bin/python3.12")
        let launcher = resources.appendingPathComponent("Not1MM/python/contest_host/launcher.py")
        let certificate = bundle.bundleURL.appendingPathComponent(
            "Contents/Frameworks/Python.framework/Versions/3.12/etc/openssl/cert.pem")
        let dataRoot = applicationSupport.appendingPathComponent("Contesting/Python", isDirectory: true)
        let certificateValues = try? certificate.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
        guard fileManager.isExecutableFile(atPath: executable.path),
              fileManager.isReadableFile(atPath: launcher.path),
              fileManager.isReadableFile(atPath: certificate.path),
              certificateValues?.isRegularFile == true,
              certificateValues?.isSymbolicLink == false else {
            throw ContestLaneError.confirmed("contest_host_unavailable", "The bundled contest runtime is incomplete.")
        }
        return Self(executableURL: executable, launcherURL: launcher, dataRootURL: dataRoot,
                    sslCertificateFileURL: certificate)
    }
}

/// Serialized JSONL bridge to the actual pinned Not1MM Python plugin host.
/// The child owns contest SQL only; it cannot open station or network services.
actor PythonContestLane {
    private struct Pending {
        let id: String
        let continuation: CheckedContinuation<Data, Error>
    }

    private let configuration: PythonContestHostConfiguration
    private let fileManager: FileManager
    private let reference: ContestReferenceData
    private let n1mmUDPAllowed: Bool
    private var process: Process?
    private var input: FileHandle?
    private var output: FileHandle?
    private var errorOutput: FileHandle?
    private var outputReader: Task<Void, Never>?
    private var errorReader: Task<Void, Never>?
    private var processGeneration: UInt64 = 0
    private var outputBuffer = Data()
    private var pending: Pending?
    private var tail: Task<Void, Never>?
    private var terminalShutdown = false
    private var activeSessionID: String?
    private var activeWorkspaceGeneration: String?
    private var activeProjection: [String: Any]?
    private var assistanceLane: PythonContestAssistanceLane?
    private var callHistoryLane: PythonContestCallHistoryLane?

    init(configuration: PythonContestHostConfiguration, fileManager: FileManager = .default,
         reference: ContestReferenceData? = nil, n1mmUDPAllowed: Bool = false) throws {
        self.configuration = configuration
        self.fileManager = fileManager
        self.reference = try reference ?? ContestReferenceData.bundled()
        self.n1mmUDPAllowed = n1mmUDPAllowed
        guard configuration.dataRootURL.isFileURL,
              configuration.launcherURL.isFileURL,
              configuration.executableURL.isFileURL,
              configuration.sslCertificateFileURL?.isFileURL != false else {
            throw ContestLaneError.confirmed("contest_host_invalid", "The contest host paths are invalid.")
        }
    }

    func handle(method: String, params: [String: Any]) async throws -> [String: Any] {
        let previous = tail
        let operation = Task { [self] in
            await previous?.value
            var effectiveParams = params
            if method == "contest_cw_context" {
                guard let activeSessionID else {
                    throw ContestLaneError.confirmed("contest_session_inactive", "Open a contest before using CW.")
                }
                effectiveParams["sessionID"] = activeSessionID
            }
            if method == "contest_output_claim" {
                guard let activeSessionID, params["sessionID"] as? String == activeSessionID else {
                    throw ContestLaneError.confirmed("contest_session_inactive", "The output action belongs to an inactive contest.")
                }
            }
            var result = try await perform(method: method, params: effectiveParams)
            if ["contest_session_open", "contest_open"].contains(method),
               let projection = result["projection"] as? [String: Any],
               let reconciled = try await reconcileCountryPrefixes(projection: projection) {
                result["projection"] = reconciled
            }
            if method == "contest_log" || method == "contest_log_page" || method == "contest_check_partial" {
                canonicalizeCountryPrefixes(in: &result)
            }
            if method == "contest_score" {
                result["countryUniverse"] = reference.entityNamesByPrefix.keys.sorted().map { prefix -> [String: Any] in
                    ["value": prefix, "label": reference.entityNamesByPrefix[prefix] ?? prefix,
                     "continent": reference.countryContinentsByPrefix[prefix].map { $0 as Any } ?? NSNull()]
                }
            }
            if let projection = result["projection"] as? [String: Any] {
                activeProjection = projection
            }
            if Self.createsSession(method) {
                let projection = activeProjection
                activeSessionID = projection?["sessionID"] as? String ?? result["sessionID"] as? String
                activeWorkspaceGeneration = projection?["workspaceGeneration"] as? String
            } else if method == "contest_session_open" || method == "contest_open" {
                let projection = activeProjection
                activeSessionID = projection?["sessionID"] as? String
                activeWorkspaceGeneration = projection?["workspaceGeneration"] as? String
            }
            if Self.createsSession(method) || ["contest_session_open", "contest_open"].contains(method),
               let lane = try? callHistory(),
               let activation = await lane.reconcileCurrent(), activation["state"] as? String == "active",
               let sessionID = activeSessionID,
               let refreshed = try? await perform(method: "contest_projection", params: ["sessionID": sessionID]),
               let projection = refreshed["projection"] as? [String: Any] {
                result["projection"] = projection
                activeProjection = projection
            }
            return result
        }
        tail = Task { _ = try? await operation.value }
        return try await operation.value
    }

    func digitalDestination() throws -> WSJTXContestDestination {
        guard let projection = activeProjection,
              projection["digitalLoggingSupported"] as? Bool == true,
              let sessionID = projection["sessionID"] as? String,
              let workspaceGeneration = projection["workspaceGeneration"] as? String,
              let pluginID = projection["pluginID"] as? String,
              let sourceRevision = projection["sourceRevision"] as? String,
              sessionID == activeSessionID, workspaceGeneration == activeWorkspaceGeneration else {
            throw ContestLaneError.confirmed("digital_unsupported",
                "The active contest has no original Not1MM digital logging handler.")
        }
        return .init(sessionID: sessionID, workspaceGeneration: workspaceGeneration,
                     pluginID: pluginID, sourceRevision: sourceRevision)
    }

    func fldigiTransmitDestination() throws -> WSJTXContestDestination {
        guard let projection = activeProjection,
              projection["fldigiTransmitAvailable"] as? Bool == true,
              let sessionID = projection["sessionID"] as? String,
              let workspaceGeneration = projection["workspaceGeneration"] as? String,
              let pluginID = projection["pluginID"] as? String,
              let sourceRevision = projection["sourceRevision"] as? String,
              sessionID == activeSessionID, workspaceGeneration == activeWorkspaceGeneration else {
            throw ContestLaneError.confirmed("fldigi_transmit_unsupported",
                "The active contest has no original fldigi transmit path.")
        }
        return .init(sessionID: sessionID, workspaceGeneration: workspaceGeneration,
                     pluginID: pluginID, sourceRevision: sourceRevision)
    }

    func ingestDigital(_ record: ADIFRecord, destination: WSJTXContestDestination) async throws -> Bool {
        let previous = tail
        let operation = Task { [self] in
            await previous?.value
            guard destination == (try? digitalDestination()),
                  let projection = activeProjection,
                  let revision = (projection["revision"] as? NSNumber)?.uint64Value,
                  let semanticIdentity = record.semanticIdentityHash,
                  let call = record["CALL"]?.trimmingCharacters(in: .whitespacesAndNewlines).uppercased(),
                  !call.isEmpty else {
                throw ContestLaneError.confirmed("stale_context",
                    "The digital contact belongs to a retired contest destination.")
            }
            var params: [String: Any] = [
                "sessionID": destination.sessionID,
                "workspaceGeneration": destination.workspaceGeneration,
                "operationID": UUID().uuidString.lowercased(),
                "expectedRevision": revision,
                "semanticIdentity": semanticIdentity,
                "packet": record.fields,
            ]
            if let country = countryWire(call) { params["countries"] = [call: country] }
            let result = try await perform(method: "contest_digital_ingest", params: params)
            guard destination == (try? digitalDestination()) else {
                throw ContestLaneError.confirmed("stale_context",
                    "The contest changed before the digital contact was confirmed.")
            }
            if let next = result["projection"] as? [String: Any] { activeProjection = next }
            return result["digitalDuplicate"] as? Bool == true
        }
        tail = Task { _ = try? await operation.value }
        return try await operation.value
    }

    func shutdown() async {
        terminalShutdown = true
        await assistanceLane?.shutdown()
        assistanceLane = nil
        callHistoryLane = nil
        failPending(.uncertain("contest_host_stopped", "The contest host stopped before its reply was confirmed."))
        stopProcess()
    }

    /// Retire every in-memory/output owner before backup restore replaces the
    /// contest stores. Unlike terminal shutdown, a later explicit contest open
    /// may start a fresh child against the restored databases.
    func prepareForRestore() async {
        await assistanceLane?.shutdown()
        assistanceLane = nil
        callHistoryLane = nil
        failPending(.uncertain("contest_host_stopped", "The contest host stopped before its reply was confirmed."))
        stopProcess()
        activeSessionID = nil
        activeWorkspaceGeneration = nil
        activeProjection = nil
    }

    func handleAssistance(method: String, params: [String: Any]) async throws -> [String: Any] {
        guard !terminalShutdown else {
            throw ContestLaneError.confirmed("worker_stopping", "The contest host is shutting down.")
        }
        let lane: PythonContestAssistanceLane
        if let assistanceLane { lane = assistanceLane }
        else {
            let created = try PythonContestAssistanceLane(
                contestingRoot: configuration.dataRootURL.standardizedFileURL.deletingLastPathComponent()) { [weak self] context in
                    guard let self else {
                        throw ContestLaneError.confirmed("stale_context", "The callsign suggestion belongs to another contest context.")
                    }
                    try await self.validateAssistance(context)
                }
            assistanceLane = created
            lane = created
        }
        return try await lane.handle(method: method, params: params)
    }

    func handleCallHistory(method: String, params: [String: Any]) async throws -> [String: Any] {
        guard !terminalShutdown else {
            throw ContestLaneError.confirmed("worker_stopping", "The contest host is shutting down.")
        }
        // A history commit can await many staged host calls. Admit the whole
        // operation through the same tail as ordinary contest requests so an
        // actor re-entrance cannot collide with `pending` or interleave a
        // projection/mutation between begin, chunks, commit and cancellation.
        let previous = tail
        let operation = Task { [self] in
            await previous?.value
            guard !terminalShutdown else {
                throw ContestLaneError.confirmed("worker_stopping", "The contest host is shutting down.")
            }
            return try await callHistory().handle(method: method, params: params)
        }
        tail = Task { _ = try? await operation.value }
        return try await operation.value
    }

    private func callHistory() throws -> PythonContestCallHistoryLane {
        if let callHistoryLane { return callHistoryLane }
        let created = try PythonContestCallHistoryLane(
                contestingRoot: configuration.dataRootURL.standardizedFileURL.deletingLastPathComponent(),
                hostRequest: { [weak self] method, params in
                    guard let self else {
                        throw ContestLaneError.confirmed("stale_history_context", "The call-history request belongs to another contest context.")
                    }
                    return try await self.perform(method: method, params: params)
                }) { [weak self] in
                    guard let self else {
                        throw ContestLaneError.confirmed("stale_history_context", "The call-history request belongs to another contest context.")
                    }
                    return try await self.callHistoryScope()
                }
        callHistoryLane = created
        return created
    }

    private func callHistoryScope() throws -> PythonContestCallHistoryScope {
        guard let projection = activeProjection,
              let sessionID = projection["sessionID"] as? String,
              let workspaceGeneration = projection["workspaceGeneration"] as? String,
              let revision = (projection["revision"] as? NSNumber)?.int64Value,
              let draftID = projection["draftID"] as? String,
              let referenceID = projection["referenceID"] as? String,
              let identity = projection["ruleIdentity"] as? [String: Any],
              let ruleID = identity["id"] as? String,
              let ruleVersion = identity["version"] as? String,
              let ruleEdition = identity["edition"] as? String,
              let ruleSourceRevision = identity["sourceRevision"] as? String,
              sessionID == activeSessionID, workspaceGeneration == activeWorkspaceGeneration else {
            throw ContestLaneError.confirmed("stale_history_context", "Open an active Python contest before using call history.")
        }
        let fields = projection["fields"] as? [[String: Any]] ?? []
        let callsign = fields.first { $0["id"] as? String == "callsign" }?["value"] as? String ?? ""
        return .init(sessionID: sessionID, workspaceGeneration: workspaceGeneration,
                     revision: revision, draftID: draftID, callsign: callsign,
                     ruleIdentity: .init(id: ruleID, version: ruleVersion, edition: ruleEdition,
                                         sourceRevision: ruleSourceRevision),
                     referenceDataVersion: referenceID)
    }

    private func validateAssistance(_ scope: ContestAssistanceScope) throws {
        guard scope.sessionID == activeSessionID,
              scope.workspaceGeneration == activeWorkspaceGeneration else {
            throw ContestLaneError.confirmed("stale_context", "The callsign suggestion belongs to another contest context.")
        }
    }

    private func perform(method: String, params: [String: Any]) async throws -> [String: Any] {
        guard !terminalShutdown else {
            throw ContestLaneError.confirmed("worker_stopping", "The contest host is shutting down.")
        }
        guard method.hasPrefix("contest_"), method.utf8.count <= 64 else {
            throw ContestLaneError.confirmed("method_not_allowed", "The contest host method is unavailable.")
        }
        try startIfNeeded()
        let requestID = UUID().uuidString.lowercased()
        let object: [String: Any] = ["id": requestID, "method": method,
                                     "params": try referencedParams(method: method, params: params)]
        guard JSONSerialization.isValidJSONObject(object),
              let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]),
              data.count + 1 <= PrototypeWorker.maxRequestBytes else {
            throw ContestLaneError.confirmed("invalid_params", "Contest request data is invalid or too large.")
        }
        var frame = data
        frame.append(10)
        let response = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Data, Error>) in
            guard pending == nil, let input else {
                continuation.resume(throwing: ContestLaneError.uncertain(
                    "contest_host_busy", "The contest host could not admit the request."))
                return
            }
            pending = Pending(id: requestID, continuation: continuation)
            do { try input.write(contentsOf: frame) }
            catch {
                pending = nil
                continuation.resume(throwing: ContestLaneError.uncertain(
                    "contest_host_write_failed", "The contest host did not confirm the request."))
                stopProcess()
                return
            }
            Task { [weak self] in
                try? await Task.sleep(nanoseconds: 45_000_000_000)
                await self?.timeOut(requestID)
            }
        }
        guard response.count < PrototypeWorker.maxResponseBytes,
              let envelope = try? JSONSerialization.jsonObject(with: response) as? [String: Any],
              Set(envelope.keys).isSubset(of: ["id", "ok", "result", "error"]),
              envelope["id"] as? String == requestID,
              let ok = envelope["ok"] as? Bool else {
            stopProcess()
            throw ContestLaneError.uncertain("contest_host_protocol", "The contest host reply was invalid.")
        }
        if ok, let result = envelope["result"] as? [String: Any] { return result }
        if !ok, let error = envelope["error"] as? [String: Any],
           let code = error["code"] as? String, code.utf8.count <= 64,
           let message = error["message"] as? String, message.utf8.count <= 512 {
            return try Self.raise(code: code, message: message, outcome: error["outcome"] as? String)
        }
        throw ContestLaneError.uncertain("contest_host_protocol", "The contest host reply was incomplete.")
    }

    private static func raise(code: String, message: String, outcome: String?) throws -> [String: Any] {
        if outcome == "uncertain" { throw ContestLaneError.uncertain(code, message) }
        throw ContestLaneError.confirmed(code, message)
    }

    private static func createsSession(_ method: String) -> Bool {
        ["contest_session_create", "contest_create", "contest_legacy_import"].contains(method)
    }

    private func referencedParams(method: String, params: [String: Any]) throws -> [String: Any] {
        var result = params
        if Self.createsSession(method), result["reference"] == nil,
           let station = result["station"] as? [String: Any], let call = station["Call"] as? String {
            guard let country = countryWire(call) else {
                throw ContestLaneError.confirmed("station_country_unresolved", "Resolve the station country before creating this contest.")
            }
            result["reference"] = ["id": reference.version, "countries": [call.uppercased(): country]]
        }
        let fields = result["fields"] as? [String: Any]
        if result["countries"] == nil {
            // Radio follow clears the departed draft call and sends the next
            // call separately. Hydrate it before Python adopts that spot and
            // prefills its exchange; normal typed calls still resolve here.
            let observedCall = method == "contest_draft_apply" && result["observedVFOChange"] as? Bool == true
                ? result["observedSpotCallsign"] as? String : nil
            var countries: [String: [String: Any]] = [:]
            for rawCall in [fields?["callsign"] as? String, observedCall].compactMap({ $0 }) {
                let call = rawCall.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
                if !call.isEmpty, let country = countryWire(call) { countries[call] = country }
            }
            if !countries.isEmpty {
                result["countries"] = countries
                result["referenceID"] = reference.version
            }
        }
        if method == "contest_spot_points_preview", result["countries"] == nil,
           let spots = result["spots"] as? [[String: Any]] {
            var countries: [String: [String: Any]] = [:]
            for spot in spots {
                guard let rawCallsign = spot["callsign"] as? String else { continue }
                let callsign = rawCallsign.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
                if let country = countryWire(callsign) { countries[callsign] = country }
            }
            result["countries"] = countries
            result["referenceID"] = reference.version
        }
        return result
    }

    private func countryWire(_ rawCallsign: String) -> [String: Any]? {
        let callsign = rawCallsign.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard let resolved = reference.resolver.resolveCountryEndpointWithPrimaryPrefix(callsign, at: Date()),
              !resolved.primaryPrefix.isEmpty else { return nil }
        let country = resolved.country
        return ["entity": country.name, "continent": country.continent,
                "cq": country.cqZone, "itu": country.ituZone, "primary_pfx": resolved.primaryPrefix]
    }

    private func reconcileCountryPrefixes(projection: [String: Any]) async throws -> [String: Any]? {
        guard projection["pluginID"] as? String == "cq_ww_ssb",
              let sessionID = projection["sessionID"] as? String,
              let workspaceGeneration = projection["workspaceGeneration"] as? String,
              let referenceID = projection["referenceID"] as? String,
              let revision = (projection["revision"] as? NSNumber)?.intValue else { return nil }
        var repairs: [[String: Any]] = []
        var offset = 0
        while true {
            let page = try await perform(method: "contest_log", params: [
                "sessionID": sessionID, "expectedRevision": revision, "offset": offset, "limit": 100,
            ])
            let rows = page["rows"] as? [[String: Any]] ?? []
            for row in rows {
                guard let qsoID = row["ID"] as? String,
                      let call = row["Call"] as? String,
                      let current = row["CountryPrefix"] as? String,
                      let storedCountry = row["country_identity"] as? [String: Any],
                      let country = countryWire(call),
                      sameCountryEndpoint(storedCountry, country),
                      let corrected = country["primary_pfx"] as? String,
                      !corrected.isEmpty,
                      current.uppercased() != corrected.uppercased() else { continue }
                repairs.append(["qsoID": qsoID, "callsign": call.uppercased(), "country": country])
            }
            offset += rows.count
            let total = (page["total"] as? NSNumber)?.intValue ?? offset
            if rows.isEmpty || offset >= total { break }
        }
        guard !repairs.isEmpty else { return nil }
        var currentProjection = projection
        var expectedRevision = revision
        for start in stride(from: 0, to: repairs.count, by: 100) {
            let end = min(start + 100, repairs.count)
            let result = try await perform(method: "contest_country_reconcile", params: [
                "sessionID": sessionID, "workspaceGeneration": workspaceGeneration,
                "operationID": UUID().uuidString.lowercased(), "expectedRevision": expectedRevision,
                "referenceID": referenceID, "repairs": Array(repairs[start..<end]),
            ])
            if let next = result["projection"] as? [String: Any] {
                currentProjection = next
                expectedRevision = (next["revision"] as? NSNumber)?.intValue ?? expectedRevision + 1
            }
        }
        return currentProjection
    }

    private func sameCountryEndpoint(_ lhs: [String: Any], _ rhs: [String: Any]) -> Bool {
        guard let lhsEntity = lhs["entity"] as? String, let rhsEntity = rhs["entity"] as? String,
              let lhsContinent = lhs["continent"] as? String, let rhsContinent = rhs["continent"] as? String,
              let lhsCQ = lhs["cq"] as? NSNumber, let rhsCQ = rhs["cq"] as? NSNumber,
              let lhsITU = lhs["itu"] as? NSNumber, let rhsITU = rhs["itu"] as? NSNumber else { return false }
        return lhsEntity.caseInsensitiveCompare(rhsEntity) == .orderedSame
            && lhsContinent.caseInsensitiveCompare(rhsContinent) == .orderedSame
            && lhsCQ.intValue == rhsCQ.intValue && lhsITU.intValue == rhsITU.intValue
    }

    private func canonicalizeCountryPrefixes(in result: inout [String: Any]) {
        guard var rows = result["rows"] as? [[String: Any]] else { return }
        for index in rows.indices {
            guard let call = rows[index]["Call"] as? String,
                  let storedCountry = rows[index]["country_identity"] as? [String: Any],
                  let country = countryWire(call), sameCountryEndpoint(storedCountry, country),
                  let corrected = country["primary_pfx"] as? String, !corrected.isEmpty else { continue }
            rows[index]["CountryPrefix"] = corrected
        }
        result["rows"] = rows
    }

    private func startIfNeeded() throws {
        if let process, process.isRunning { return }
        guard !terminalShutdown else {
            throw ContestLaneError.confirmed("worker_stopping", "The contest host is shutting down.")
        }
        try fileManager.createDirectory(at: configuration.dataRootURL,
                                        withIntermediateDirectories: true,
                                        attributes: [.posixPermissions: 0o700])
        let standardInput = Pipe(), standardOutput = Pipe(), standardError = Pipe()
        let child = Process()
        processGeneration &+= 1
        let generation = processGeneration
        child.executableURL = configuration.executableURL
        child.arguments = ["-I", "-B", configuration.launcherURL.path,
                           "--data-root", configuration.dataRootURL.path]
        child.environment = Self.childEnvironment(n1mmUDPAllowed: n1mmUDPAllowed,
                                                  sslCertificateFileURL: configuration.sslCertificateFileURL)
        child.standardInput = standardInput
        child.standardOutput = standardOutput
        child.standardError = standardError
        child.terminationHandler = { [weak self] _ in
            Task { await self?.observeChildTermination(generation: generation) }
        }
        do { try child.run() }
        catch {
            throw ContestLaneError.confirmed("contest_host_unavailable", "The bundled contest host could not start.")
        }
        process = child
        input = standardInput.fileHandleForWriting
        output = standardOutput.fileHandleForReading
        errorOutput = standardError.fileHandleForReading
        outputBuffer.removeAll(keepingCapacity: true)
        let outputHandle = standardOutput.fileHandleForReading
        outputReader = Task.detached { [weak self] in
            while !Task.isCancelled {
                let data = outputHandle.availableData
                guard !data.isEmpty else { break }
                await self?.consume(data, generation: generation)
            }
            await self?.observeChildTermination(generation: generation)
        }
        let errorHandle = standardError.fileHandleForReading
        // Drain and discard diagnostics. They can contain contact data and must
        // never cross the renderer or normal application log boundary.
        errorReader = Task.detached {
            while !Task.isCancelled, !errorHandle.availableData.isEmpty {}
        }
    }

    static func childEnvironment(n1mmUDPAllowed: Bool, sslCertificateFileURL: URL? = nil) -> [String: String] {
        var environment = [
            "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8",
            "PYTHONNOUSERSITE": "1", "PYTHONDONTWRITEBYTECODE": "1",
        ]
        if let sslCertificateFileURL { environment["SSL_CERT_FILE"] = sslCertificateFileURL.path }
        if n1mmUDPAllowed { environment["XLOG_CONTEST_N1MM_UDP_ALLOWED"] = "1" }
        return environment
    }

    private func consume(_ data: Data, generation: UInt64) {
        guard generation == processGeneration else { return }
        guard !data.isEmpty else {
            Task { [weak self] in await self?.observeChildTermination(generation: generation) }
            return
        }
        outputBuffer.append(data)
        guard outputBuffer.count < PrototypeWorker.maxResponseBytes else {
            failPending(.uncertain("contest_host_response_too_large", "The contest host reply exceeded its limit."))
            stopProcess()
            return
        }
        while let newline = outputBuffer.firstIndex(of: 10) {
            var line = Data(outputBuffer[..<newline])
            outputBuffer.removeSubrange(...newline)
            if line.last == 13 { line.removeLast() }
            guard let current = pending else {
                stopProcess()
                return
            }
            pending = nil
            current.continuation.resume(returning: line)
        }
    }

    private func timeOut(_ id: String) {
        guard pending?.id == id else { return }
        failPending(.uncertain("contest_host_timeout", "The contest host reply was not confirmed."))
        stopProcess()
    }

    private func observeChildTermination(generation: UInt64) async {
        // FileHandle may publish the final data chunk and process termination on
        // different queues. Yield once so a complete final reply wins that race.
        try? await Task.sleep(nanoseconds: 25_000_000)
        guard generation == processGeneration else { return }
        guard process?.isRunning != true else { return }
        failPending(.uncertain("contest_host_ended", "The contest host ended before its reply was confirmed."))
        stopProcess(terminate: false)
    }

    private func failPending(_ error: ContestLaneError) {
        guard let current = pending else { return }
        pending = nil
        current.continuation.resume(throwing: error)
    }

    private func stopProcess(terminate: Bool = true) {
        processGeneration &+= 1
        outputReader?.cancel()
        errorReader?.cancel()
        try? input?.close()
        try? output?.close()
        try? errorOutput?.close()
        if terminate, let process, process.isRunning { process.terminate() }
        process = nil
        input = nil
        output = nil
        errorOutput = nil
        outputReader = nil
        errorReader = nil
        outputBuffer.removeAll(keepingCapacity: true)
    }
}

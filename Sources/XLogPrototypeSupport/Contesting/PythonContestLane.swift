import Foundation
import XContestCore

/// Application-relative launch information for the bundled Not1MM host.
/// Production never searches PATH or a user Python installation.
struct PythonContestHostConfiguration: Sendable, Equatable {
    let executableURL: URL
    let launcherURL: URL
    let dataRootURL: URL

    static func bundled(applicationSupport: URL, bundle: Bundle = .main,
                        fileManager: FileManager = .default) throws -> Self {
        guard let resources = bundle.resourceURL else {
            throw ContestLaneError.confirmed("contest_host_unavailable", "The bundled contest resources are unavailable.")
        }
        let executable = bundle.bundleURL.appendingPathComponent(
            "Contents/Frameworks/Python.framework/Versions/3.12/bin/python3.12")
        let launcher = resources.appendingPathComponent("Not1MM/python/contest_host/launcher.py")
        let dataRoot = applicationSupport.appendingPathComponent("Contesting/Python", isDirectory: true)
        guard fileManager.isExecutableFile(atPath: executable.path),
              fileManager.isReadableFile(atPath: launcher.path) else {
            throw ContestLaneError.confirmed("contest_host_unavailable", "The bundled contest runtime is incomplete.")
        }
        return Self(executableURL: executable, launcherURL: launcher, dataRootURL: dataRoot)
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
    private var process: Process?
    private var input: FileHandle?
    private var output: FileHandle?
    private var errorOutput: FileHandle?
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
         reference: ContestReferenceData? = nil) throws {
        self.configuration = configuration
        self.fileManager = fileManager
        self.reference = try reference ?? ContestReferenceData.bundled()
        guard configuration.dataRootURL.isFileURL,
              configuration.launcherURL.isFileURL,
              configuration.executableURL.isFileURL else {
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
            let result = try await perform(method: method, params: effectiveParams)
            if let projection = result["projection"] as? [String: Any] {
                activeProjection = projection
            }
            if method == "contest_session_create" || method == "contest_create" {
                let projection = activeProjection
                activeSessionID = projection?["sessionID"] as? String ?? result["sessionID"] as? String
                activeWorkspaceGeneration = projection?["workspaceGeneration"] as? String
            } else if method == "contest_session_open" || method == "contest_open" {
                let projection = activeProjection
                activeSessionID = projection?["sessionID"] as? String
                activeWorkspaceGeneration = projection?["workspaceGeneration"] as? String
            }
            return result
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
        let lane: PythonContestCallHistoryLane
        if let callHistoryLane { lane = callHistoryLane }
        else {
            let created = try PythonContestCallHistoryLane(
                contestingRoot: configuration.dataRootURL.standardizedFileURL.deletingLastPathComponent()) { [weak self] in
                    guard let self else {
                        throw ContestLaneError.confirmed("stale_history_context", "The call-history request belongs to another contest context.")
                    }
                    return try await self.callHistoryScope()
                }
            callHistoryLane = created
            lane = created
        }
        return try await lane.handle(method: method, params: params)
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

    private func referencedParams(method: String, params: [String: Any]) throws -> [String: Any] {
        var result = params
        if (method == "contest_session_create" || method == "contest_create"), result["reference"] == nil,
           let station = result["station"] as? [String: Any], let call = station["Call"] as? String {
            guard let country = countryWire(call) else {
                throw ContestLaneError.confirmed("station_country_unresolved", "Resolve the station country before creating this contest.")
            }
            result["reference"] = ["id": reference.version, "countries": [call.uppercased(): country]]
        }
        let fields = result["fields"] as? [String: Any]
        if result["countries"] == nil, let call = fields?["callsign"] as? String,
           !call.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
           let country = countryWire(call) {
            result["countries"] = [call.uppercased(): country]
            result["referenceID"] = reference.version
        }
        return result
    }

    private func countryWire(_ rawCallsign: String) -> [String: Any]? {
        let callsign = rawCallsign.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard let country = reference.resolveCountryEndpoint(callsign, at: Date()),
              let prefix = reference.primaryPrefixes[country.adif], !prefix.isEmpty else { return nil }
        return ["entity": country.name, "continent": country.continent,
                "cq": country.cqZone, "itu": country.ituZone, "primary_pfx": prefix]
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
        child.executableURL = configuration.executableURL
        child.arguments = ["-I", "-B", configuration.launcherURL.path,
                           "--data-root", configuration.dataRootURL.path]
        child.environment = [
            "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8",
            "PYTHONNOUSERSITE": "1", "PYTHONDONTWRITEBYTECODE": "1",
        ]
        child.standardInput = standardInput
        child.standardOutput = standardOutput
        child.standardError = standardError
        standardOutput.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            Task { await self?.consume(data) }
        }
        // Drain and discard diagnostics. They can contain contact data and must
        // never cross the renderer or normal application log boundary.
        standardError.fileHandleForReading.readabilityHandler = { handle in
            _ = handle.availableData
        }
        child.terminationHandler = { [weak self] _ in
            Task { await self?.observeChildTermination() }
        }
        do { try child.run() }
        catch {
            standardOutput.fileHandleForReading.readabilityHandler = nil
            standardError.fileHandleForReading.readabilityHandler = nil
            throw ContestLaneError.confirmed("contest_host_unavailable", "The bundled contest host could not start.")
        }
        process = child
        input = standardInput.fileHandleForWriting
        output = standardOutput.fileHandleForReading
        errorOutput = standardError.fileHandleForReading
        outputBuffer.removeAll(keepingCapacity: true)
    }

    private func consume(_ data: Data) {
        guard !data.isEmpty else {
            Task { [weak self] in await self?.observeChildTermination() }
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

    private func observeChildTermination() async {
        // FileHandle may publish the final data chunk and process termination on
        // different queues. Yield once so a complete final reply wins that race.
        try? await Task.sleep(nanoseconds: 25_000_000)
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
        output?.readabilityHandler = nil
        errorOutput?.readabilityHandler = nil
        try? input?.close()
        try? output?.close()
        try? errorOutput?.close()
        if terminate, let process, process.isRunning { process.terminate() }
        process = nil
        input = nil
        output = nil
        errorOutput = nil
        outputBuffer.removeAll(keepingCapacity: true)
    }
}

import Foundation

actor ContestExportArtifactCache {
    struct Limits: Sendable {
        let maxArtifacts: Int
        let maxAggregateBytes: Int
        let maxArtifactBytes: Int
        let maxKnownRequests: Int
        let ttlNanoseconds: UInt64
        let chunkLimit: Int

        static let production = Limits(maxArtifacts: 4, maxAggregateBytes: 64 * 1_024 * 1_024,
                                       maxArtifactBytes: 32 * 1_024 * 1_024, maxKnownRequests: 1_024,
                                       ttlNanoseconds: 10 * 60 * 1_000_000_000, chunkLimit: 64 * 1_024)
    }

    private struct Entry: Sendable {
        let artifact: ContestExportArtifact
        let prepared: ContestExportPreparedArtifact
        let expiresAt: UInt64
    }
    private struct Pending: Sendable {
        let token: UUID
        let task: Task<ContestExportArtifact, Error>
        let reservedBytes: Int
    }

    private let limits: Limits
    private let now: @Sendable () -> UInt64
    private let beforeGenerationApply: (@Sendable (UInt64) async -> Void)?
    private var known: [UUID: ContestExportPrepareRequest] = [:]
    private var terminal: [UUID: String] = [:]
    private var entries: [UUID: Entry] = [:]
    private var inFlight: [UUID: Pending] = [:]
    private var aggregateBytes = 0
    private var reservedBytes = 0
    private var latestGenerationTicket: UInt64 = 0
    private var isShutdown = false

    init(limits: Limits = .production,
         now: @escaping @Sendable () -> UInt64 = { DispatchTime.now().uptimeNanoseconds },
         beforeGenerationApply: (@Sendable (UInt64) async -> Void)? = nil) {
        self.limits = limits
        self.now = now
        self.beforeGenerationApply = beforeGenerationApply
    }

    func prepare(_ request: ContestExportPrepareRequest,
                 produce: @escaping @Sendable () async throws -> ContestExportArtifact) async throws -> ContestExportPreparedArtifact {
        guard !isShutdown else { throw ContestExportLaneError("artifact_unavailable", "The prepared export cache is shut down.") }
        purgeExpired()
        if let original = known[request.exportID] {
            guard original == request else { throw ContestExportLaneError("request_conflict", "The export ID was already used for another request.") }
            if let entry = entries[request.exportID] { return entry.prepared }
            if let pending = inFlight[request.exportID] { return try await finish(request, pending: pending) }
            if let code = terminal[request.exportID], code != "retryable_failure" { throw terminalError(code) }
            try requireProducerCapacity()
            terminal.removeValue(forKey: request.exportID)
            return try await start(request, produce: produce, capacityReserved: true)
        }
        guard known.count < limits.maxKnownRequests else {
            throw ContestExportLaneError("cache_full", "The prepared export cache is full.")
        }
        try requireProducerCapacity()
        known[request.exportID] = request
        return try await start(request, produce: produce, capacityReserved: true)
    }

    private func start(_ request: ContestExportPrepareRequest,
                       produce: @escaping @Sendable () async throws -> ContestExportArtifact,
                       capacityReserved: Bool = false) async throws -> ContestExportPreparedArtifact {
        if !capacityReserved { try requireProducerCapacity() }
        let task = Task { try await produce() }
        let pending = Pending(token: UUID(), task: task, reservedBytes: limits.maxArtifactBytes)
        inFlight[request.exportID] = pending
        reservedBytes += pending.reservedBytes
        return try await finish(request, pending: pending)
    }

    func read(_ request: ContestExportReadRequest) throws -> ContestExportChunk {
        guard !isShutdown else { throw ContestExportLaneError("artifact_unavailable", "The prepared export cache is shut down.") }
        purgeExpired()
        guard let entry = entries[request.exportID] else {
            throw ContestExportLaneError("artifact_unavailable", "The prepared export is unavailable or expired.")
        }
        try requireScope(sessionID: request.sessionID, generation: request.workspaceGeneration, entry: entry)
        guard request.length > 0, request.length <= limits.chunkLimit,
              request.offset >= 0, request.offset <= entry.artifact.data.count,
              request.length <= entry.artifact.data.count - request.offset else {
            throw ContestExportLaneError("invalid_range", "The requested export byte range is invalid.")
        }
        let end = request.offset + request.length
        let bytes = entry.artifact.data.subdata(in: request.offset..<end)
        return ContestExportChunk(artifactID: request.exportID, sessionID: request.sessionID,
                                  workspaceGeneration: request.workspaceGeneration,
                                  revision: entry.artifact.revision, offset: request.offset,
                                  dataBase64: bytes.base64EncodedString(), eof: end == entry.artifact.data.count,
                                  byteLength: entry.artifact.data.count, sha256: entry.prepared.sha256)
    }

    func release(_ request: ContestExportReleaseRequest) throws -> ContestExportReleaseResult {
        guard !isShutdown else { throw ContestExportLaneError("artifact_unavailable", "The prepared export cache is shut down.") }
        purgeExpired()
        guard let original = known[request.exportID] else {
            return ContestExportReleaseResult(artifactID: request.exportID, released: false)
        }
        guard original.sessionID == request.sessionID,
              original.workspaceGeneration == request.workspaceGeneration else {
            throw ContestExportLaneError("wrong_scope", "The prepared export belongs to another session or workspace.")
        }
        let removed = entries.removeValue(forKey: request.exportID)
        if let removed { aggregateBytes -= removed.artifact.data.count }
        inFlight[request.exportID]?.task.cancel()
        terminal[request.exportID] = "artifact_unavailable"
        return ContestExportReleaseResult(artifactID: request.exportID, released: removed != nil)
    }

    func shutdown() {
        isShutdown = true
        for pending in inFlight.values { pending.task.cancel() }
        entries.removeAll()
        aggregateBytes = 0
        for id in Array(known.keys) {
            if inFlight[id] == nil {
                known.removeValue(forKey: id)
                terminal.removeValue(forKey: id)
            } else {
                terminal[id] = "artifact_unavailable"
            }
        }
    }

    func applyGeneration(_ generation: UUID, ticket: UInt64) async -> Bool {
        if let beforeGenerationApply { await beforeGenerationApply(ticket) }
        guard !isShutdown, ticket > latestGenerationTicket else { return false }
        latestGenerationTicket = ticket
        for (id, request) in known where request.workspaceGeneration != generation {
            if let removed = entries.removeValue(forKey: id) { aggregateBytes -= removed.artifact.data.count }
            inFlight[id]?.task.cancel()
            terminal[id] = "artifact_unavailable"
        }
        return true
    }

    private func finish(_ request: ContestExportPrepareRequest,
                        pending: Pending) async throws -> ContestExportPreparedArtifact {
        do {
            let artifact = try await pending.task.value
            if let existing = entries[request.exportID] { return existing.prepared }
            if let code = terminal[request.exportID] { throw terminalError(code) }
            guard known[request.exportID] == request,
                  inFlight[request.exportID]?.token == pending.token else {
                throw ContestExportLaneError("artifact_unavailable", "The prepared export is no longer available.")
            }
            guard artifact.sessionID == request.sessionID,
                  artifact.workspaceGeneration == request.workspaceGeneration,
                  artifact.revision == request.expectedRevision,
                  artifact.generatedAtUTC == request.generatedAtUTC,
                  artifact.format == request.format,
                  artifact.requestedHeader == request.header else {
                _ = removePending(request.exportID, token: pending.token)
                terminal[request.exportID] = "artifact_unavailable"
                throw ContestExportLaneError("invalid_result", "The prepared export does not match its request coordinate.")
            }
            guard artifact.data.count <= limits.maxArtifactBytes else {
                _ = removePending(request.exportID, token: pending.token)
                terminal[request.exportID] = "export_too_large"
                throw terminalError("export_too_large")
            }
            let prepared = ContestExportPreparedArtifact(
                artifactID: request.exportID, sessionID: artifact.sessionID,
                workspaceGeneration: artifact.workspaceGeneration, revision: artifact.revision,
                format: artifact.format, inputSchemaVersion: artifact.inputSchemaVersion,
                formatterVersion: artifact.formatterVersion, generatedAtUTC: artifact.generatedAtUTC,
                qsoCount: artifact.qsoCount, totalPoints: artifact.totalPoints,
                multiplierCount: artifact.multiplierCount, claimedScore: artifact.claimedScore,
                byteLength: artifact.data.count, sha256: ContestExportDigest.sha256(artifact.data),
                chunkLimit: limits.chunkLimit,
                expiresAfterSeconds: Int(limits.ttlNanoseconds / 1_000_000_000))
            let expiresAt = now().addingReportingOverflow(limits.ttlNanoseconds)
            let deadline = expiresAt.overflow ? UInt64.max : expiresAt.partialValue
            _ = removePending(request.exportID, token: pending.token)
            entries[request.exportID] = Entry(artifact: artifact, prepared: prepared, expiresAt: deadline)
            aggregateBytes += artifact.data.count
            return prepared
        } catch {
            if inFlight[request.exportID]?.token == pending.token {
                _ = removePending(request.exportID, token: pending.token)
                if isShutdown {
                    known.removeValue(forKey: request.exportID)
                    terminal.removeValue(forKey: request.exportID)
                } else if terminal[request.exportID] == nil {
                    terminal[request.exportID] = "retryable_failure"
                }
            }
            if let laneError = error as? ContestExportLaneError,
               ["invalid_result", "export_too_large", "cache_full"].contains(laneError.code) {
                throw laneError
            }
            if isShutdown { throw ContestExportLaneError("artifact_unavailable", "The prepared export cache is shut down.") }
            if let code = terminal[request.exportID], code != "retryable_failure" { throw terminalError(code) }
            throw error
        }
    }

    private func purgeExpired() {
        let instant = now()
        for (id, entry) in entries where instant >= entry.expiresAt {
            entries.removeValue(forKey: id)
            aggregateBytes -= entry.artifact.data.count
            terminal[id] = "artifact_unavailable"
        }
    }

    private func requireScope(sessionID: UUID, generation: UUID, entry: Entry) throws {
        guard entry.artifact.sessionID == sessionID,
              entry.artifact.workspaceGeneration == generation else {
            throw ContestExportLaneError("wrong_scope", "The prepared export belongs to another session or workspace.")
        }
    }

    private func requireProducerCapacity() throws {
        guard entries.count + inFlight.count < limits.maxArtifacts,
              limits.maxArtifactBytes <= limits.maxAggregateBytes - aggregateBytes - reservedBytes else {
            throw ContestExportLaneError("cache_full", "The prepared export cache has insufficient producer capacity.")
        }
    }

    @discardableResult
    private func removePending(_ id: UUID, token: UUID? = nil) -> Pending? {
        guard let pending = inFlight[id], token == nil || pending.token == token else { return nil }
        inFlight.removeValue(forKey: id)
        reservedBytes -= pending.reservedBytes
        return pending
    }

    private func terminalError(_ code: String) -> ContestExportLaneError {
        switch code {
        case "export_too_large": return ContestExportLaneError(code, "The formatted export exceeds the per-artifact limit.")
        case "cache_full": return ContestExportLaneError(code, "The prepared export cache has insufficient capacity.")
        default: return ContestExportLaneError("artifact_unavailable", "The prepared export is unavailable or expired.")
        }
    }
}


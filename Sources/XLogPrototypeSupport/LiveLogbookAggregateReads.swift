import Foundation
import Dispatch
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif

enum LiveLogbookAggregateChange: Error {
    case superseded
    case retired

    var failure: WorkerFailure {
        switch self {
        case .superseded:
            WorkerFailure("logbook_refresh_superseded", "The logbook changed while its progress was updating.")
        case .retired:
            WorkerFailure("logbook_refresh_retired", "The logbook workspace changed while its progress was updating.")
        }
    }
}

struct LiveLogbookAggregateQuery: Sendable {
    let kind: LogbookAggregateKind
    let expectedGeneration: String?
    var limit = 20
    var offset = 0
    var search = ""
    var delivery = ""
    var group = ""
    var mode = ""
    var role = ""
}

struct LiveLogbookAggregateOwner: Sendable {
    let database: LogbookDatabase
    let generation: String
    let authority: LogbookAggregateAuthority

    func sharesWorkspace(with other: Self) -> Bool {
        database === other.database && generation == other.generation
            && authority.fileIdentity == other.authority.fileIdentity
    }
}

struct LiveLogbookAggregateReply: @unchecked Sendable {
    let payload: [String: Any]
    let owner: LiveLogbookAggregateOwner
}

typealias LiveLogbookAggregateEvaluator = @Sendable
    (LogbookAggregateSnapshot, LogbookAggregateCancellation) throws -> LogbookAggregateResult

/// Only progress reads use this lane. Foreground mutations and settings retain
/// their existing owner; neither the primary connection nor its locks cross IO.
actor LiveLogbookAggregateReads {
    private struct Key: Hashable {
        let epoch: UUID
        let database: ObjectIdentifier
        let generation: String
        let authority: LogbookAggregateAuthority
        let request: LogbookAggregateRequest
    }

    private struct Cached {
        let key: Key
        let result: LogbookAggregateResult
    }

    private final class Flight {
        let key: Key
        let owner: LiveLogbookAggregateOwner
        let cancellation: LogbookAggregateCancellation
        let task: Task<LogbookAggregateResult, Error>
        var completion: Result<LogbookAggregateResult, Error>?

        init(key: Key, owner: LiveLogbookAggregateOwner, cancellation: LogbookAggregateCancellation,
             task: Task<LogbookAggregateResult, Error>) {
            self.key = key; self.owner = owner; self.cancellation = cancellation; self.task = task
        }
    }

    private let service: LiveLogbookMethods
    private let statisticsQueue = DispatchQueue(label: "xlog.logbook-statistics", qos: .utility)
    private let catalogueQueue = DispatchQueue(label: "xlog.logbook-catalogue", qos: .utility)
    private let evaluate: LiveLogbookAggregateEvaluator
    private var epoch = UUID()
    private var suspended = 0
    private var terminal = false
    // Fixed at two physical operations: one per kind. Cold stats cannot wait
    // behind catalogue evaluation; retained windows still join identical work.
    private var active: [LogbookAggregateKind: Flight] = [:]
    // One small typed result for each kind, never contact arrays or shaped pages.
    private var cached: [LogbookAggregateKind: Cached] = [:]

    init(service: LiveLogbookMethods,
         evaluate: @escaping LiveLogbookAggregateEvaluator = { try $0.evaluate(cancellation: $1) }) {
        self.service = service; self.evaluate = evaluate
    }

    func handle(method: String, params: [String: Any]) async throws -> LiveLogbookAggregateReply {
        // Validate even when admission is suspended; a progress route must not
        // turn malformed input into a successful retry or broaden its allowlist.
        let query = try service.aggregateQuery(method: method, params: params)
        var retries = 0
        while true {
            guard !terminal else { throw WorkerFailure("worker_stopping", "The worker is shutting down.") }
            guard suspended == 0 else { throw LiveLogbookAggregateChange.retired.failure }
            do {
                let owner = try service.aggregateReadOwner(expectedGeneration: query.expectedGeneration)
                let request = try LogbookAggregateRequest.current(query.kind)
                let key = Key(epoch: epoch, database: ObjectIdentifier(owner.database), generation: owner.generation,
                              authority: owner.authority, request: request)
                if let value = cached[query.kind], value.key == key {
                    return LiveLogbookAggregateReply(payload: try service.renderAggregate(value.result, owner: owner, query: query), owner: owner)
                }

                let flight: Flight
                if let running = active[query.kind] {
                    flight = running
                    if running.key != key { running.cancellation.cancel() }
                } else {
                    let cancellation = LogbookAggregateCancellation()
                    let queue = query.kind == .statistics ? statisticsQueue : catalogueQueue
                    let evaluate = evaluate, url = owner.database.url
                    let authority = owner.authority
                    let task = Task.detached(priority: .utility) {
                        try await Self.compute(queue: queue, url: url, authority: authority, request: request,
                                               cancellation: cancellation, evaluate: evaluate)
                    }
                    flight = Flight(key: key, owner: owner, cancellation: cancellation, task: task)
                    active[query.kind] = flight
                }
                let outcome = await flight.task.result
                let completion = finish(flight, outcome: outcome)
                // A superseded same-kind operation must release its reader
                // before replacement work is admitted. Other kinds never wait.
                guard flight.key == key else {
                    if epoch != key.epoch { throw LiveLogbookAggregateChange.retired }
                    let current = try service.aggregateReadOwner(expectedGeneration: query.expectedGeneration)
                    if !current.sharesWorkspace(with: owner) { throw LiveLogbookAggregateChange.retired }
                    if current.authority != owner.authority { throw LiveLogbookAggregateChange.superseded }
                    continue
                }
                let result = try completion.get()
                return LiveLogbookAggregateReply(payload: try service.renderAggregate(result, owner: owner, query: query), owner: owner)
            } catch {
                guard let change = change(error) else { throw error }
                // Churn is bounded and demand-driven. Never publish the earlier
                // revision, enqueue every intermediate QSO, or spin indefinitely.
                if retries == 0, suspended == 0, !terminal {
                    retries += 1
                    continue
                }
                throw change.failure
            }
        }
    }

    private static func compute(queue: DispatchQueue, url: URL, authority: LogbookAggregateAuthority,
                                request: LogbookAggregateRequest, cancellation: LogbookAggregateCancellation,
                                evaluate: @escaping LiveLogbookAggregateEvaluator) async throws -> LogbookAggregateResult {
        try await withCheckedThrowingContinuation { continuation in
            queue.async {
                do {
                    try cancellation.check()
                    let snapshot = try LogbookDatabase.readAggregateSnapshot(at: url, authority: authority,
                        request: request, cancellation: cancellation)
                    // The readonly handle is already closed before pure work.
                    try cancellation.check()
                    let result = try evaluate(snapshot, cancellation)
                    try cancellation.check()
                    continuation.resume(returning: result)
                } catch { continuation.resume(throwing: error) }
            }
        }
    }

    private func finish(_ flight: Flight, outcome: Result<LogbookAggregateResult, Error>) -> Result<LogbookAggregateResult, Error> {
        if let completion = flight.completion { return completion }
        defer { if active[flight.key.request.kind] === flight { active.removeValue(forKey: flight.key.request.kind) } }
        let completion: Result<LogbookAggregateResult, Error>
        if terminal {
            completion = .failure(WorkerFailure("worker_stopping", "The worker is shutting down."))
        } else if flight.key.epoch != epoch || suspended != 0 {
            completion = .failure(LiveLogbookAggregateChange.retired)
        } else {
            do {
                let result = try outcome.get()
                guard result.request == flight.key.request else { throw LogbookDatabaseError.corruptRecord }
                try service.acceptAggregate(result, owner: flight.owner)
                cached[result.request.kind] = Cached(key: flight.key, result: result)
                completion = .success(result)
            } catch {
                if error is CancellationError {
                    do {
                        let current = try service.aggregateReadOwner()
                        completion = .failure(current.sharesWorkspace(with: flight.owner)
                            ? LiveLogbookAggregateChange.superseded : .retired)
                    } catch { completion = .failure(error) }
                } else { completion = .failure(error) }
            }
        }
        flight.completion = completion
        return completion
    }

    private func change(_ error: Error) -> LiveLogbookAggregateChange? {
        if let value = error as? LiveLogbookAggregateChange { return value }
        if let value = error as? LogbookAggregateReadError {
            switch value { case .superseded: return .superseded; case .retired: return .retired }
        }
        if let value = error as? LogbookDatabaseError, case .syncBusy = value { return .superseded }
        return nil
    }

    /// Retirement after a durable save must never wait for optional work before
    /// returning its acknowledgement. A later request joins the latest revision.
    func observeContactChange() {
        for flight in active.values { flight.cancellation.cancel() }
        cached.removeAll()
    }

    func observeRevision(_ revision: Int64) {
        for flight in active.values where flight.owner.authority.revision != revision { flight.cancellation.cancel() }
        cached = cached.filter { $0.value.key.authority.revision == revision }
    }

    func suspendForWorkspaceChange() async {
        suspended += 1
        epoch = UUID(); cached.removeAll()
        let flights = Array(active.values)
        for flight in flights { flight.cancellation.cancel() }
        for flight in flights {
            _ = await flight.task.result
            if active[flight.key.request.kind] === flight { active.removeValue(forKey: flight.key.request.kind) }
        }
    }

    func finishWorkspaceChange() { suspended = max(0, suspended - 1) }

    func terminate() async {
        terminal = true
        epoch = UUID(); cached.removeAll()
        let flights = Array(active.values)
        for flight in flights { flight.cancellation.cancel() }
        for flight in flights {
            _ = await flight.task.result
            if active[flight.key.request.kind] === flight { active.removeValue(forKey: flight.key.request.kind) }
        }
    }
}

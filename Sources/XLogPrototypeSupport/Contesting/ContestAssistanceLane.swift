import Foundation
import XContestCore

struct ContestAssistanceScope: Equatable, Hashable, Sendable {
    let sessionID: String
    let workspaceGeneration: String
}

enum ContestAssistanceDatasetAdmission: Equatable, Sendable {
    case expectedDigestMatched
    case operatorOrProviderPolicyApprovedComputedDigest
}

enum ContestAssistanceLaneError: Error, Equatable {
    case dataUnavailable
    case unverifiedDataset
    case invalidLimits
    case invalidContext
    case requestReused
    case capacityExceeded
    case cancelled
    case stopped
    case resultUnavailable
    case staleResult
    case unknownMatch
}

/// Owns bounded, read-only SCP computations and their short-lived selection evidence.
/// It never reads or writes a draft, exchange, station service, or transmitter owner.
actor ContestAssistanceLane {
    struct Limits: Equatable, Sendable {
        var maximumOperations: Int = 8
        var maximumCachedResults: Int = 8
        var maximumKnownRequests: Int = 128

        fileprivate var isValid: Bool {
            (1...32).contains(maximumOperations) && (1...32).contains(maximumCachedResults) &&
                (1...1_024).contains(maximumKnownRequests)
        }
    }

    typealias ScopeValidator = @Sendable (ContestAssistanceScope) async throws -> Void
    typealias Search = @Sendable (ContestSCPIndex, String, ContestAssistanceContext) async throws -> ContestSCPQueryResult

    private struct Operation: Sendable {
        let token: UInt64
        let scope: ContestAssistanceScope
        let context: ContestAssistanceContext
        var task: Task<ContestSCPQueryResult, Error>?
        var retired: Bool
    }

    private let index: ContestSCPIndex?
    private let limits: Limits
    private let validateScope: ScopeValidator
    private let search: Search
    private var operations: [UInt64: Operation] = [:]
    private var currentByScope: [ContestAssistanceScope: UInt64] = [:]
    private var cached: [ContestAssistanceContext: ContestSCPQueryResult] = [:]
    private var cacheOrder: [ContestAssistanceContext] = []
    private var knownRequestIDs: [String] = []
    private var nextToken: UInt64 = 0
    private var terminalShutdown = false

    init(index: ContestSCPIndex?, admission: ContestAssistanceDatasetAdmission,
         limits: Limits = .init(), validateScope: @escaping ScopeValidator,
         search: Search? = nil) throws {
        guard limits.isValid else { throw ContestAssistanceLaneError.invalidLimits }
        if let index {
            switch (admission, index.dataset.digestVerification) {
            case (.expectedDigestMatched, .matchedExpectedSHA256),
                 (.operatorOrProviderPolicyApprovedComputedDigest, .computedOnly):
                break
            default:
                throw ContestAssistanceLaneError.unverifiedDataset
            }
        }
        self.index = index
        self.limits = limits
        self.validateScope = validateScope
        self.search = search ?? { index, query, context in
            try await index.matches(query: query, context: context,
                                    options: .init(limit: 20, maximumEvaluations: 100_000))
        }
    }

    func query(_ query: String, context: ContestAssistanceContext) async throws -> ContestSCPQueryResult {
        try requireRunning()
        guard let index else { throw ContestAssistanceLaneError.dataUnavailable }
        guard (2...32).contains(query.utf8.count), query.utf8.allSatisfy({ $0 < 128 }) else {
            throw ContestSCPError.invalidQuery
        }
        let scope = try checkedScope(context)
        let token = try admit(context: context, scope: scope)

        do {
            try await validateScope(scope)
            try requireCurrent(token)

            let task = Task { [search] in
                try Task.checkCancellation()
                await Task.yield()
                try Task.checkCancellation()
                return try await search(index, query, context)
            }
            guard attach(task: task, to: token) else {
                task.cancel()
                throw ContestAssistanceLaneError.cancelled
            }
            let result = try await task.value
            try requireCurrent(token)
            guard result.context == context else { throw ContestAssistanceLaneError.staleResult }
            try await validateScope(scope)
            try requireCurrent(token)

            settle(token)
            cache(result, for: context)
            return result
        } catch {
            let stopped = terminalShutdown
            let retired = operations[token]?.retired ?? false
            settle(token)
            if stopped { throw ContestAssistanceLaneError.stopped }
            if retired || error is CancellationError || error as? ContestAssistanceLaneError == .cancelled {
                throw ContestAssistanceLaneError.cancelled
            }
            throw error
        }
    }

    /// Cancels or invalidates only the exact request context. Retired work keeps
    /// its capacity and request-ID ownership until the underlying call settles.
    @discardableResult
    func cancel(context: ContestAssistanceContext) throws -> Bool {
        _ = try checkedScope(context)
        var found = false
        if let token = operations.first(where: { $0.value.context == context })?.key {
            retire(token)
            found = true
        }
        if cached.removeValue(forKey: context) != nil {
            cacheOrder.removeAll { $0 == context }
            found = true
        }
        return found
    }

    /// Resolves selection only through the server-held result and immutable index.
    /// The only returned value is the index's authoritative callsign.
    func selectedCallsign(matchID: String, context: ContestAssistanceContext) async throws -> String {
        try requireRunning()
        guard let index else { throw ContestAssistanceLaneError.dataUnavailable }
        let scope = try checkedScope(context)
        try await validateScope(scope)
        try requireRunning()
        guard let result = cached[context] else { throw ContestAssistanceLaneError.resultUnavailable }
        let callsign: String
        do {
            callsign = try index.selectedCallsign(matchID: matchID, from: result, expectedContext: context)
        } catch ContestSCPError.staleContext {
            throw ContestAssistanceLaneError.staleResult
        } catch ContestSCPError.unknownMatch {
            throw ContestAssistanceLaneError.unknownMatch
        }
        try await validateScope(scope)
        try requireRunning()
        guard cached[context] == result else { throw ContestAssistanceLaneError.resultUnavailable }
        return callsign
    }

    func shutdown() {
        guard !terminalShutdown else { return }
        terminalShutdown = true
        for token in Array(operations.keys) { retire(token) }
        cached.removeAll(keepingCapacity: false)
        cacheOrder.removeAll(keepingCapacity: false)
    }

    private func admit(context: ContestAssistanceContext, scope: ContestAssistanceScope) throws -> UInt64 {
        let requestIsOwned = operations.values.contains { $0.context.requestID == context.requestID }
        let requestIsCached = cached.keys.contains { $0.requestID == context.requestID }
        guard !knownRequestIDs.contains(context.requestID), !requestIsOwned, !requestIsCached else {
            throw ContestAssistanceLaneError.requestReused
        }
        guard operations.count < limits.maximumOperations else { throw ContestAssistanceLaneError.capacityExceeded }
        knownRequestIDs.append(context.requestID)
        if knownRequestIDs.count > limits.maximumKnownRequests { knownRequestIDs.removeFirst() }

        evictCached(scope: scope)
        if let previous = currentByScope[scope] { retire(previous) }
        nextToken += 1
        let token = nextToken
        operations[token] = Operation(token: token, scope: scope, context: context, task: nil, retired: false)
        currentByScope[scope] = token
        return token
    }

    private func attach(task: Task<ContestSCPQueryResult, Error>, to token: UInt64) -> Bool {
        guard var operation = operations[token], !operation.retired,
              currentByScope[operation.scope] == token, !terminalShutdown else { return false }
        operation.task = task
        operations[token] = operation
        return true
    }

    private func requireCurrent(_ token: UInt64) throws {
        try requireRunning()
        guard let operation = operations[token], !operation.retired,
              currentByScope[operation.scope] == token else { throw ContestAssistanceLaneError.cancelled }
    }

    private func retire(_ token: UInt64) {
        guard var operation = operations[token], !operation.retired else { return }
        operation.retired = true
        operation.task?.cancel()
        operations[token] = operation
        if currentByScope[operation.scope] == token { currentByScope.removeValue(forKey: operation.scope) }
    }

    private func settle(_ token: UInt64) {
        guard let operation = operations.removeValue(forKey: token) else { return }
        if currentByScope[operation.scope] == token { currentByScope.removeValue(forKey: operation.scope) }
    }

    private func requireRunning() throws {
        guard !terminalShutdown else { throw ContestAssistanceLaneError.stopped }
    }

    private func checkedScope(_ context: ContestAssistanceContext) throws -> ContestAssistanceScope {
        guard Self.isCanonicalUUID(context.sessionID), Self.isCanonicalUUID(context.workspaceGeneration),
              Self.isCanonicalUUID(context.requestID) else { throw ContestAssistanceLaneError.invalidContext }
        return ContestAssistanceScope(sessionID: context.sessionID, workspaceGeneration: context.workspaceGeneration)
    }

    private func evictCached(scope: ContestAssistanceScope) {
        let contexts = cacheOrder.filter {
            $0.sessionID == scope.sessionID && $0.workspaceGeneration == scope.workspaceGeneration
        }
        for context in contexts { cached.removeValue(forKey: context) }
        if !contexts.isEmpty { cacheOrder.removeAll { contexts.contains($0) } }
    }

    private func cache(_ result: ContestSCPQueryResult, for context: ContestAssistanceContext) {
        cached[context] = result
        cacheOrder.removeAll { $0 == context }
        cacheOrder.append(context)
        while cacheOrder.count > limits.maximumCachedResults {
            cached.removeValue(forKey: cacheOrder.removeFirst())
        }
    }

    private static func isCanonicalUUID(_ value: String) -> Bool {
        guard let uuid = UUID(uuidString: value) else { return false }
        return value == uuid.uuidString.lowercased()
    }
}

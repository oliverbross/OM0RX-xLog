// GPL-3.0-only; Copyright Oliver Bross OM0RX.
import Foundation

public enum TuneStatus: String, Codable, Sendable {
    case idle, pending, acknowledged, confirmed, timedOut, failed, unknownDisconnected, superseded, unsupported, shutdown
    public var isPending: Bool { self == .pending || self == .acknowledged }
}

public struct TuneRequest: Codable, Equatable, Sendable {
    public let id: UUID
    public let context: ProviderContext
    public let target: TuneTarget
    public let issuedAt: TimeInterval
    public let deadline: TimeInterval
    public let baselineSequence: UInt64
    public var commandRequest: StationCommandRequest { .init(id: id, context: context, command: .tune(target)) }
}

/// A deterministic, transport-free state machine. Its owner serializes calls and supplies a
/// monotonic clock shared with provider observation timestamps. Nothing here sends radio commands.
public struct TuneCoordinator: Sendable {
    public private(set) var context: ProviderContext?
    public private(set) var snapshot: ObservedStationSnapshot?
    public private(set) var request: TuneRequest?
    public private(set) var status: TuneStatus = .idle
    public private(set) var failureDetail: String?
    public private(set) var outcomes: [UUID: TuneStatus] = [:]
    public let maximumSnapshotAge: TimeInterval
    private var outcomeOrder: [UUID] = []
    private var capabilities: Set<StationCapability> = []
    private var stopped = false
    private var sessionActive = false
    private var lastTime: TimeInterval?

    public init(maximumSnapshotAge: TimeInterval = 2) throws {
        guard maximumSnapshotAge.isFinite, maximumSnapshotAge > 0, maximumSnapshotAge <= 60 else {
            throw StationContractError.invalidTimeout
        }
        self.maximumSnapshotAge = maximumSnapshotAge
    }

    public mutating func activate(profile: StationProfile, context: ProviderContext,
                                  capabilities: Set<StationCapability>) throws {
        guard !stopped else { throw StationContractError.stopped }
        try profile.validate()
        guard context.profileID == profile.id,
              self.context.map({ context.generation > $0.generation && context.sessionID != $0.sessionID }) ?? true else {
            throw StationContractError.invalidContext
        }
        finishPending(.superseded)
        self.context = context; self.capabilities = capabilities
        sessionActive = true
        snapshot = nil; request = nil; status = .idle; failureDetail = nil
    }

    public mutating func begin(target: TuneTarget, now: TimeInterval, timeout: TimeInterval = 12,
                               requestID: UUID = UUID()) throws -> TuneRequest {
        guard !stopped else { throw StationContractError.stopped }
        try checkClock(now); advanceInternal(now); try target.validate()
        guard timeout.isFinite, timeout > 0, timeout <= 120, (now + timeout).isFinite else {
            throw StationContractError.invalidTimeout
        }
        guard outcomes[requestID] == nil, request?.id != requestID else { throw StationContractError.invalidContext }
        guard sessionActive, let context, let snapshot, snapshot.context == context,
              snapshot.authoritative, snapshot.readiness == .ready,
              snapshot.hasValidRadioState,
              snapshot.isFresh(at: now, maximumAge: maximumSnapshotAge) else { throw StationContractError.notReady }
        guard target.requiredCapabilities.isSubset(of: capabilities),
              target.requiredCapabilities.isSubset(of: snapshot.capabilities) else {
            record(requestID, .unsupported)
            if !status.isPending { status = .unsupported }
            throw StationContractError.unsupported
        }
        finishPending(.superseded)
        let next = TuneRequest(id: requestID, context: context, target: target, issuedAt: now,
                               deadline: now + timeout, baselineSequence: snapshot.sequence)
        request = next; status = .pending; failureDetail = nil
        return next
    }

    /// Returns false for callbacks from previous profiles/sessions, replayed sequences,
    /// backwards observation timestamps, future timestamps or a stopped owner.
    @discardableResult
    public mutating func receive(_ value: ObservedStationSnapshot, now: TimeInterval) -> Bool {
        guard !stopped, sessionActive, value.context == context, clockIsValid(now),
              value.observedAt.isFinite, value.observedAt <= now,
              snapshot.map({ value.sequence > $0.sequence && value.observedAt >= $0.observedAt }) ?? true else { return false }
        lastTime = now
        advanceInternal(now)
        snapshot = value
        if value.readiness == .disconnected {
            disconnect(context: value.context)
            return true
        }
        guard status.isPending, let request else { return true }
        if value.readiness == .unknown {
            finishPending(.unknownDisconnected)
        } else if value.authoritative, value.readiness == .ready,
                  value.isFresh(at: now, maximumAge: maximumSnapshotAge),
                  value.sequence > request.baselineSequence, value.observedAt > request.issuedAt,
                  request.target.requiredCapabilities.isSubset(of: value.capabilities), request.target.matches(value) {
            finishPending(.confirmed)
        }
        return true
    }

    @discardableResult
    public mutating func acknowledge(_ acknowledgement: ProviderAcknowledgement, now: TimeInterval) -> Bool {
        guard currentCallback(acknowledgement.requestID, acknowledgement.context), clockIsValid(now) else { return false }
        lastTime = now; advanceInternal(now)
        guard status.isPending else { return false }
        status = .acknowledged
        return true
    }

    @discardableResult
    public mutating func fail(requestID: UUID, context: ProviderContext, detail: String, now: TimeInterval) -> Bool {
        guard currentCallback(requestID, context), clockIsValid(now) else { return false }
        lastTime = now; advanceInternal(now)
        guard status.isPending else { return false }
        failureDetail = String(detail.prefix(512)); finishPending(.failed); return true
    }

    public mutating func disconnect(context: ProviderContext) {
        guard !stopped, self.context == context else { return }
        finishPending(.unknownDisconnected); snapshot = nil; sessionActive = false; status = .unknownDisconnected
    }

    public mutating func advance(now: TimeInterval) throws {
        try checkClock(now); advanceInternal(now)
    }

    public mutating func shutdown() {
        finishPending(.shutdown); stopped = true; sessionActive = false; snapshot = nil; context = nil; status = .shutdown
    }

    private func currentCallback(_ id: UUID, _ callbackContext: ProviderContext) -> Bool {
        !stopped && sessionActive && status.isPending && request?.id == id && request?.context == callbackContext && context == callbackContext
    }
    private func clockIsValid(_ now: TimeInterval) -> Bool {
        now.isFinite && (lastTime.map { now >= $0 } ?? true)
    }
    private mutating func checkClock(_ now: TimeInterval) throws {
        guard clockIsValid(now) else { throw StationContractError.invalidClock }
        lastTime = now
    }
    private mutating func advanceInternal(_ now: TimeInterval) {
        if status.isPending, let request, now >= request.deadline { finishPending(.timedOut) }
    }
    private mutating func finishPending(_ terminal: TuneStatus) {
        guard status.isPending, let request else { return }
        status = terminal; record(request.id, terminal)
    }
    private mutating func record(_ id: UUID, _ terminal: TuneStatus) {
        outcomes[id] = terminal; outcomeOrder.append(id)
        if outcomeOrder.count > 64 { outcomes.removeValue(forKey: outcomeOrder.removeFirst()) }
    }
}

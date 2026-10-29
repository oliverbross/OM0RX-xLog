import Foundation
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif

/// Synchronous emission/commit fence. No radio commands and no database owner.
/// A sample carries the scope visible when it arrived, never a later QSO scope.
final class NativeDraftPowerGate: @unchecked Sendable {
    struct State: Sendable {
        let epoch: UInt64
        let context: OperatorDraftPowerContext?
        let suspended: Bool
    }
    struct Lease: Sendable {
        let epoch: UInt64
        let workspaceID: UUID
        let scope: OperatorDraftPowerScope
    }
    struct Reading: Sendable {
        let lease: Lease
        let sample: OperatorDraftPowerSample
    }
    private let lock = NSRecursiveLock()
    private var epoch: UInt64 = 0
    private struct Selection { let provider: String?; let id: String? }
    private var selections: [String: Selection] = [:]
    private var provider: String? { radioID.flatMap { selections[$0]?.provider } }
    private var selectionID: String? { radioID.flatMap { selections[$0]?.id } }
    private struct Source {
        let id: UUID
        let endpointID: String
        var sequence: UInt64 = 0
        var sessionID: UUID?
        var startedAt: Date?
        var ready = false
    }
    private var radioID: String?
    private var activeGeneration: UInt64 = 0
    private var sources: [String: Source] = [:]
    private var source: Source? { radioID.flatMap { sources[$0] } }
    private var sourceID: UUID? { source?.id }
    private var endpointID: String? { source?.endpointID }
    private var sessionID: UUID? { source?.sessionID }
    private var startedAt: Date? { source?.startedAt }
    private var ready: Bool { source?.ready == true }
    private var suspended = false
    private var terminated = false
    private var lease: Lease?
    private var acceptedPeakWatts: Double?
    private var latestObservedAt: Date?
    private var changed: (@Sendable () -> Void)?
    private var received: (@Sendable (Reading) -> Void)?

    func install(changed: @escaping @Sendable () -> Void,
                 received: @escaping @Sendable (Reading) -> Void) {
        lock.withLock { self.changed = changed; self.received = received }
    }

    func select(provider: String?, selectionID: String?, radioID: String = "radio1") {
        let callback = lock.withLock { () -> (@Sendable () -> Void)? in
            guard !terminated, ["radio1", "radio2"].contains(radioID) else { return nil }
            let previous = selections[radioID]
            guard previous?.provider != provider || previous?.id != selectionID else { return nil }
            selections[radioID] = Selection(provider: provider, id: selectionID)
            guard self.radioID == radioID else { return nil }
            retire(); return changed
        }
        callback?()
    }

    enum ActiveAdmission: Equatable { case applied, unchanged, superseded }

    /// Selection notices retain per-slot metadata; only native routing authority
    /// selects the draft's meter. A nil authority fences capture during routing.
    @discardableResult func activate(radioID: String?, generation: UInt64) -> ActiveAdmission {
        let (admission, callback) = lock.withLock { () -> (ActiveAdmission, (@Sendable () -> Void)?) in
            guard !terminated, generation > 0, radioID.map({ ["radio1", "radio2"].contains($0) }) ?? true else { return (.superseded, nil) }
            guard generation >= activeGeneration else { return (.superseded, nil) }
            if generation == activeGeneration {
                return (self.radioID == radioID ? .unchanged : .superseded, nil)
            }
            activeGeneration = generation; self.radioID = radioID
            retire(); return (.applied, changed)
        }
        callback?()
        return admission
    }

    func attach(sourceID: UUID, endpointID: String, radioID: String = "radio1") {
        let callback = lock.withLock { () -> (@Sendable () -> Void)? in
            guard !terminated, ["radio1", "radio2"].contains(radioID) else { return nil }
            sources[radioID] = Source(id: sourceID, endpointID: endpointID)
            guard self.radioID == radioID else { return nil }
            retire(); return changed
        }
        callback?()
    }

    func connection(sourceID: UUID, sequence: UInt64, sessionID: UUID, startedAt: Date?, ready: Bool) {
        let callback = lock.withLock { () -> (@Sendable () -> Void)? in
            guard !terminated, let slot = sources.first(where: { $0.value.id == sourceID })?.key,
                  var source = sources[slot], sequence > source.sequence else { return nil }
            let contextChanged = source.sessionID != sessionID || source.startedAt != startedAt || source.ready != ready
            source.sequence = sequence; source.sessionID = sessionID; source.startedAt = startedAt; source.ready = ready
            sources[slot] = source
            guard contextChanged, slot == radioID else { return nil }
            retire(); return changed
        }
        callback?()
    }

    func detach(radioID: String = "radio1") {
        let callback = lock.withLock { () -> (@Sendable () -> Void)? in
            sources.removeValue(forKey: radioID)
            guard self.radioID == radioID else { return nil }
            retire(); return changed
        }
        callback?()
    }

    func suspend(_ value: Bool) {
        let callback = lock.withLock { () -> (@Sendable () -> Void)? in
            suspended = value; retire(); return changed
        }
        callback?()
    }

    func terminate() {
        lock.withLock { terminated = true; retire(); changed = nil; received = nil }
    }

    func state() -> State {
        lock.withLock {
            let context: OperatorDraftPowerContext?
            if !terminated, !suspended, provider == "direct_agent", ready,
               let selectionID, let endpointID, let sessionID, let startedAt {
                context = .init(providerID: endpointID, selectionID: selectionID,
                    sessionID: sessionID, sessionStartedAt: startedAt)
            } else { context = nil }
            return State(epoch: epoch, context: context, suspended: suspended || terminated)
        }
    }

    func arm(_ draft: OperatorDraftSnapshot, workspaceID: UUID, state: State) {
        lock.withLock {
            guard epoch == state.epoch, !suspended, !terminated else { return }
            guard let scope = draft.power?.activeScope, scope.context == state.context else {
                clearLease(); return
            }
            if lease?.scope.id != scope.id || lease?.workspaceID != workspaceID { clearLease() }
            lease = Lease(epoch: epoch, workspaceID: workspaceID, scope: scope)
        }
    }

    func disarm() { lock.withLock { clearLease() } }

    func observe(sourceID: UUID, sample: OperatorDraftPowerSample, frequencyHz: Int64, mode: String) {
        lock.withLock {
            guard !terminated, !suspended, ready, self.sourceID == sourceID,
                  let lease, lease.epoch == epoch, let received,
                  lease.scope.context.sessionID == sample.sessionID,
                  OperatorDraftPowerSample.matches(source: sample.source,
                                                   meterSource: lease.scope.context.meterSource),
                  sample.isFresh(at: Date()),
                  [sample.observedAt, sample.radioObservedAt, sample.receivedAt].allSatisfy({
                      $0 >= lease.scope.armedAt && $0 >= lease.scope.context.sessionStartedAt
                  }),
                  lease.scope.contact.frequencyHz == frequencyHz,
                  Self.matches(contactMode: lease.scope.contact.mode, observedMode: mode) else { return }
            if let acceptedPeakWatts {
                // Once a peak is durable, later lower/duplicate observations
                // cannot change TX_PWR. Retain observation ordering without
                // pre-marking uncommitted watts or suppressing a failed retry.
                guard latestObservedAt.map({ sample.observedAt >= $0 }) ?? true else { return }
                latestObservedAt = sample.observedAt
                guard sample.watts > acceptedPeakWatts else { return }
            }
            // Handler only queues work. Queue inside the emission lock so two
            // overlapping callbacks cannot reverse a short peak and later zero.
            received(Reading(lease: lease, sample: sample))
        }
    }

    /// Called again after service/DB locks and BEGIN IMMEDIATE are acquired.
    /// A true result admits this transaction before subsequent revocation;
    /// no gate lock is held during database waiting, writes, or COMMIT.
    func permits(_ reading: Reading) -> Bool {
        lock.withLock {
            !terminated && !suspended && ready && reading.lease.epoch == epoch
                && lease?.scope.id == reading.lease.scope.id
                && lease?.workspaceID == reading.lease.workspaceID
        }
    }

    /// Acknowledgement follows successful durable commit, never mere emission.
    func recordCaptured(_ reading: Reading, draft: OperatorDraftSnapshot) {
        lock.withLock {
            guard !terminated, !suspended, reading.lease.epoch == epoch,
                  lease?.scope.id == reading.lease.scope.id,
                  lease?.workspaceID == reading.lease.workspaceID,
                  draft.power?.activeScope?.id == reading.lease.scope.id,
                  let selected = draft.power?.selectedSample,
                  let durableObservedAt = draft.power?.lastObservedAt,
                  selected.sessionID == reading.lease.scope.context.sessionID,
                  selected.observedAt >= reading.lease.scope.armedAt else { return }
            acceptedPeakWatts = max(acceptedPeakWatts ?? 0, selected.watts)
            latestObservedAt = max(latestObservedAt ?? durableObservedAt, durableObservedAt)
        }
    }

    private func clearLease() { lease = nil; acceptedPeakWatts = nil; latestObservedAt = nil }
    private func retire() { epoch &+= 1; clearLease() }
    private static func matches(contactMode: String, observedMode: String) -> Bool {
        let observed = observedMode.uppercased()
        switch contactMode.uppercased() {
        case "SSB": return ["USB", "LSB", "SSB"].contains(observed)
        case "CW": return ["CW", "CWL", "CWU"].contains(observed)
        case "FT8", "FT4", "FT2", "PSK", "PSK31", "PSK63", "RTTY", "JTTY", "DATA", "DIGI", "JT65", "JT9", "MFSK", "OLIVIA":
            return ["DIGU", "DIGL", "DATA", "RTTY", contactMode.uppercased()].contains(observed)
        default: return contactMode.uppercased() == observed
        }
    }
}

/// Task creation alone is not FIFO. Preserve callback order explicitly without
/// blocking the radio's actor on SQLite or holding a lock across an await.
final class NativeDraftPowerDelivery: @unchecked Sendable {
    private let lock = NSLock()
    private var pending: Task<Void, Never>?

    func enqueue(_ operation: @escaping @Sendable () async -> Void) {
        lock.withLock {
            let previous = pending
            pending = Task { await previous?.value; await operation() }
        }
    }

    func drain() async {
        let task = lock.withLock { pending }
        await task?.value
    }
}

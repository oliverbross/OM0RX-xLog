#if os(macOS)
import Foundation
import XLogCore

/// Pure scheduling decision. A legacy `updatedAt` is not evidence of a
/// successful validated check, so only per-source checkedAt advances TTL.
struct ReferenceCheckPlan: Equatable {
    static let failureBackoff: TimeInterval = 60 * 60
    static let daily: TimeInterval = 24 * 60 * 60
    static let weekly: TimeInterval = 7 * daily

    let due: [String]
    let nextCheckAt: Date?

    static func make(state: ReferenceDataState, now: Date,
                     clubLogConfigured: Bool, wavelogConfigured: Bool,
                     expectedIdentities: [String: String] = [:]) -> Self {
        let sources: [(String, TimeInterval, Bool)] = [
            ("cty.xml", daily, clubLogConfigured),
            ("lotw-user-activity.csv", weekly, true),
            (ActivationReferenceKind.pota.fileName, weekly, true),
            (ActivationReferenceKind.sota.fileName, weekly, true),
            (ActivationReferenceKind.iota.fileName, weekly, true),
            (ActivationReferenceKind.wwff.fileName, weekly, true),
            ("wavelog-catalog.json", weekly, wavelogConfigured),
        ]
        var due: [String] = []
        var next: Date?
        for (source, interval, enabled) in sources where enabled {
            let metadata = state.sourceMetadata[source]
            let sourceChanged = expectedIdentities[source].map {
                state.validators[source]?.sourceIdentity != $0
            } ?? false
            let checkDue = sourceChanged ? Date.distantPast
                : (metadata?.checkedAt?.addingTimeInterval(interval) ?? .distantPast)
            // A failed attempt must not reset successful freshness, but also
            // must not retry on every poll or app wake.
            let retryDue = metadata?.status == "failed"
                ? metadata?.lastAttemptAt?.addingTimeInterval(failureBackoff) ?? .distantPast
                : Date.distantPast
            let deadline = max(checkDue, retryDue)
            if deadline <= now { due.append(source) }
            else if next == nil || deadline < next! { next = deadline }
        }
        return Self(due: due, nextCheckAt: next)
    }
}
#endif

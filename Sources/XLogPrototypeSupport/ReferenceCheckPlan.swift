#if os(macOS)
import Foundation
import XLogCore

/// Pure scheduling decision. A legacy `updatedAt` is not evidence of a
/// successful validated check, so only per-source checkedAt advances the
/// hourly check deadline.
struct ReferenceCheckPlan: Equatable {
    static let hourly: TimeInterval = 60 * 60
    static let failureBackoff: TimeInterval = 60 * 60

    let due: [String]
    let nextCheckAt: Date?

    static func make(state: ReferenceDataState, now: Date,
                     clubLogConfigured: Bool, wavelogConfigured: Bool,
                     expectedIdentities: [String: String] = [:],
                     unavailableSources: Set<String> = []) -> Self {
        let sources: [(String, Bool)] = [
            ("cty.xml", clubLogConfigured),
            ("lotw-user-activity.csv", true),
            (ActivationReferenceKind.pota.fileName, true),
            (ActivationReferenceKind.sota.fileName, true),
            (ActivationReferenceKind.iota.fileName, true),
            (ActivationReferenceKind.wwff.fileName, true),
            ("wavelog-catalog.json", wavelogConfigured),
        ]
        var due: [String] = []
        var next: Date?
        for (source, enabled) in sources where enabled {
            let metadata = state.sourceMetadata[source]
            let sourceChanged = expectedIdentities[source].map {
                state.validators[source]?.sourceIdentity != $0
            } ?? false
            let checkDue = sourceChanged || unavailableSources.contains(source) ? Date.distantPast
                : (metadata?.checkedAt?.addingTimeInterval(hourly) ?? .distantPast)
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

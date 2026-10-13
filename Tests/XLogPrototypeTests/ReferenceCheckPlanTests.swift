#if os(macOS)
import Foundation
import Testing
import XLogCore
@testable import XLogPrototypeSupport

@Suite("Automatic reference check planning")
struct ReferenceCheckPlanTests {
    private static let sources = [
        "cty.xml", "lotw-user-activity.csv", "pota-parks.csv", "sota-summits.csv",
        "iota-groups.json", "wwff-directory.csv", "wavelog-catalog.json",
    ]
    private let now = Date(timeIntervalSince1970: 1_800_000_000)

    private func checkedState() -> ReferenceDataState {
        var state = ReferenceDataState()
        for source in Self.sources {
            state.sourceMetadata[source] = ReferenceSourceMetadata(
                checkedAt: now, status: "up_to_date")
            state.validators[source] = ReferenceDataValidator(sourceIdentity: "old-hash")
        }
        return state
    }

    private func plan(_ state: ReferenceDataState, at date: Date,
                      identities: [String: String] = [:],
                      unavailableSources: Set<String> = []) -> ReferenceCheckPlan {
        ReferenceCheckPlan.make(state: state, now: date,
            clubLogConfigured: true, wavelogConfigured: true, expectedIdentities: identities,
            unavailableSources: unavailableSources)
    }

    @Test("Every enabled source becomes due at exactly one hour")
    func hourlyBoundary() {
        #expect(ReferenceCheckPlan.hourly == 3_600)
        let state = checkedState()
        let deadline = now.addingTimeInterval(3_600)
        let before = plan(state, at: deadline.addingTimeInterval(-1))
        #expect(before.due.isEmpty)
        #expect(before.nextCheckAt == deadline)
        for date in [deadline, deadline.addingTimeInterval(1)] {
            let due = plan(state, at: date)
            #expect(due.due == Self.sources)
            #expect(due.nextCheckAt == nil)
        }
    }

    @Test("Only validated checks establish freshness")
    func legacyAndDownloadDatesAreNotChecks() {
        var state = ReferenceDataState(clubLogUpdatedAt: now, lotwUpdatedAt: now,
            wavelogCatalogUpdatedAt: now,
            activationUpdatedAt: ["pota": now, "sota": now, "iota": now, "wwff": now])
        #expect(plan(state, at: now).due == Self.sources)
        for source in Self.sources {
            state.sourceMetadata[source] = ReferenceSourceMetadata(
                downloadedAt: now, lastAttemptAt: now, status: "updated")
        }
        let due = plan(state, at: now)
        #expect(due.due == Self.sources)
        #expect(due.nextCheckAt == nil)
    }

    @Test("Only checkedAt controls freshness regardless of download dates", arguments: sources)
    func checkedAtControlsFreshness(source: String) {
        var state = checkedState()
        state.sourceMetadata[source]?.downloadedAt = now.addingTimeInterval(-604_800)
        state.sourceMetadata[source]?.lastAttemptAt = now.addingTimeInterval(-30)
        let fresh = plan(state, at: now.addingTimeInterval(3_599))
        #expect(fresh.due.isEmpty)
        #expect(fresh.nextCheckAt == now.addingTimeInterval(3_600))
        state.sourceMetadata[source]?.checkedAt = now.addingTimeInterval(-3_600)
        state.sourceMetadata[source]?.downloadedAt = now
        state.sourceMetadata[source]?.lastAttemptAt = now
        #expect(plan(state, at: now).due == [source])
    }

    @Test("Disabled sources neither become due nor set the next deadline",
          arguments: [false, true], [false, true])
    func configuredSources(clubLog: Bool, wavelog: Bool) {
        let expected = Self.sources.filter {
            ($0 != "cty.xml" || clubLog) && ($0 != "wavelog-catalog.json" || wavelog)
        }
        let neverChecked = ReferenceCheckPlan.make(state: ReferenceDataState(), now: now,
            clubLogConfigured: clubLog, wavelogConfigured: wavelog)
        #expect(neverChecked.due == expected)
        #expect(neverChecked.nextCheckAt == nil)

        var state = checkedState()
        if !clubLog { state.sourceMetadata["cty.xml"]?.checkedAt = .distantPast }
        if !wavelog { state.sourceMetadata["wavelog-catalog.json"]?.checkedAt = .distantPast }
        let disabled = Set(Self.sources.filter { !expected.contains($0) })
        let identities = Dictionary(uniqueKeysWithValues: disabled.map { ($0, "new-hash") })
        let fresh = ReferenceCheckPlan.make(state: state, now: now,
            clubLogConfigured: clubLog, wavelogConfigured: wavelog,
            expectedIdentities: identities, unavailableSources: disabled)
        #expect(fresh.due.isEmpty)
        #expect(fresh.nextCheckAt == now.addingTimeInterval(3_600))
    }

    @Test("Failed stale sources retry at exactly one hour", arguments: sources)
    func failureBackoffBoundary(source: String) {
        #expect(ReferenceCheckPlan.failureBackoff == 3_600)
        var state = checkedState()
        state.sourceMetadata[source] = ReferenceSourceMetadata(
            checkedAt: now.addingTimeInterval(-3_601),
            lastAttemptAt: now.addingTimeInterval(-30), status: "failed")
        let deadline = now.addingTimeInterval(3_570)
        let before = plan(state, at: deadline.addingTimeInterval(-1))
        #expect(before.due.isEmpty)
        #expect(before.nextCheckAt == deadline)
        for date in [deadline, deadline.addingTimeInterval(1)] {
            let due = plan(state, at: date)
            #expect(due.due == [source])
            #expect(due.nextCheckAt == now.addingTimeInterval(3_600))
        }
        #expect(state.sourceMetadata[source]?.checkedAt == now.addingTimeInterval(-3_601))
    }

    @Test("Retry never advances the successful check deadline", arguments: sources)
    func laterFreshnessDeadlineWins(source: String) {
        var state = checkedState()
        state.sourceMetadata[source] = ReferenceSourceMetadata(
            checkedAt: now.addingTimeInterval(-100),
            lastAttemptAt: now.addingTimeInterval(-200), status: "failed")
        let deadline = now.addingTimeInterval(3_500)
        #expect(plan(state, at: deadline.addingTimeInterval(-1)).due.isEmpty)
        #expect(plan(state, at: now).nextCheckAt == deadline)
        #expect(plan(state, at: deadline).due == [source])
    }

    @Test("Failed sources without attempt evidence are immediately due", arguments: sources)
    func failureWithoutAttempt(source: String) {
        var state = checkedState()
        state.sourceMetadata[source] = ReferenceSourceMetadata(status: "failed")
        #expect(plan(state, at: now).due == [source])
    }

    @Test("Changed or missing source identity is immediately due", arguments: sources)
    func changedSourceIdentity(source: String) {
        var state = checkedState()
        #expect(plan(state, at: now, identities: [source: "old-hash"]).due.isEmpty)
        #expect(plan(state, at: now, identities: [source: "new-hash"]).due == [source])
        state.validators[source] = nil
        #expect(plan(state, at: now, identities: [source: "new-hash"]).due == [source])
    }

    @Test("Identity changes retain the hourly failure backoff", arguments: sources)
    func changedSourceBackoff(source: String) {
        var state = checkedState()
        state.sourceMetadata[source]?.status = "failed"
        state.sourceMetadata[source]?.lastAttemptAt = now.addingTimeInterval(-30)
        let identities = [source: "new-hash"]
        let deadline = now.addingTimeInterval(3_570)
        let before = plan(state, at: deadline.addingTimeInterval(-1), identities: identities)
        #expect(before.due.isEmpty)
        #expect(before.nextCheckAt == deadline)
        for date in [deadline, deadline.addingTimeInterval(1)] {
            #expect(plan(state, at: date, identities: identities).due == [source])
        }
    }

    @Test("Unavailable cache is immediately due despite a fresh check", arguments: sources)
    func unavailableCache(source: String) {
        let due = plan(checkedState(), at: now, unavailableSources: [source])
        #expect(due.due == [source])
        #expect(due.nextCheckAt == now.addingTimeInterval(3_600))
    }

    @Test("Unavailable cache retains the hourly failure backoff", arguments: sources)
    func unavailableCacheBackoff(source: String) {
        var state = checkedState()
        state.sourceMetadata[source]?.status = "failed"
        state.sourceMetadata[source]?.lastAttemptAt = now.addingTimeInterval(-30)
        let deadline = now.addingTimeInterval(3_570)
        let before = plan(state, at: deadline.addingTimeInterval(-1), unavailableSources: [source])
        #expect(before.due.isEmpty)
        #expect(before.nextCheckAt == deadline)
        for date in [deadline, deadline.addingTimeInterval(1)] {
            #expect(plan(state, at: date, unavailableSources: [source]).due == [source])
        }
    }

    @Test("The earliest enabled deadline drives the next check")
    func earliestDeadline() {
        var state = checkedState()
        state.sourceMetadata["sota-summits.csv"]?.checkedAt = now.addingTimeInterval(-120)
        state.sourceMetadata["pota-parks.csv"]?.checkedAt = now.addingTimeInterval(-60)
        let fresh = plan(state, at: now)
        #expect(fresh.due.isEmpty)
        #expect(fresh.nextCheckAt == now.addingTimeInterval(3_480))
        let due = plan(state, at: now.addingTimeInterval(3_480))
        #expect(due.due == ["sota-summits.csv"])
        #expect(due.nextCheckAt == now.addingTimeInterval(3_540))
    }
}
#endif

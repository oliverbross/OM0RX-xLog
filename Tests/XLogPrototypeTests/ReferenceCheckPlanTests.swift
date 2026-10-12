#if os(macOS)
import Foundation
import Testing
import XLogCore
@testable import XLogPrototypeSupport

@Suite("Automatic reference check planning")
struct ReferenceCheckPlanTests {
    @Test("Legacy dates never fabricate validated checks or downloads")
    func legacyStateIsDue() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let legacy = ReferenceDataState(clubLogUpdatedAt: now, lotwUpdatedAt: now)
        let plan = ReferenceCheckPlan.make(state: legacy, now: now,
                                           clubLogConfigured: false, wavelogConfigured: false)
        #expect(!plan.due.contains("cty.xml"))
        #expect(!plan.due.contains("wavelog-catalog.json"))
        #expect(plan.due.contains("lotw-user-activity.csv"))
        #expect(plan.due.contains("pota-parks.csv"))
    }

    @Test("Successful checks respect daily and weekly TTL; failure has bounded retry")
    func successAndRetry() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        var state = ReferenceDataState()
        state.sourceMetadata["cty.xml"] = ReferenceSourceMetadata(
            downloadedAt: now.addingTimeInterval(-100_000),
            checkedAt: now.addingTimeInterval(-ReferenceCheckPlan.daily + 60),
            lastAttemptAt: now.addingTimeInterval(-60), status: "up_to_date")
        state.sourceMetadata["lotw-user-activity.csv"] = ReferenceSourceMetadata(
            checkedAt: now.addingTimeInterval(-ReferenceCheckPlan.weekly - 1),
            lastAttemptAt: now.addingTimeInterval(-30), status: "failed")
        let before = ReferenceCheckPlan.make(state: state, now: now,
                                              clubLogConfigured: true, wavelogConfigured: false)
        #expect(!before.due.contains("cty.xml"))
        #expect(!before.due.contains("lotw-user-activity.csv"))
        #expect(before.nextCheckAt == now.addingTimeInterval(60))
        let later = ReferenceCheckPlan.make(state: state, now: now.addingTimeInterval(3_601),
                                             clubLogConfigured: true, wavelogConfigured: false)
        #expect(later.due.contains("cty.xml"))
        #expect(later.due.contains("lotw-user-activity.csv"))
    }

    @Test("Changed endpoint or token becomes due immediately without exposing identity")
    func changedSourceIdentity() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        var state = ReferenceDataState()
        for source in ["cty.xml", "wavelog-catalog.json"] {
            state.sourceMetadata[source] = ReferenceSourceMetadata(checkedAt: now, status: "up_to_date")
            state.validators[source] = ReferenceDataValidator(eTag: "fixture", sourceIdentity: "old-hash")
        }
        let matching = ReferenceCheckPlan.make(state: state, now: now,
            clubLogConfigured: true, wavelogConfigured: true,
            expectedIdentities: ["cty.xml": "old-hash", "wavelog-catalog.json": "old-hash"])
        #expect(!matching.due.contains("cty.xml"))
        #expect(!matching.due.contains("wavelog-catalog.json"))
        let changed = ReferenceCheckPlan.make(state: state, now: now,
            clubLogConfigured: true, wavelogConfigured: true,
            expectedIdentities: ["cty.xml": "new-cty-hash", "wavelog-catalog.json": "new-token-hash"])
        #expect(changed.due.contains("cty.xml"))
        #expect(changed.due.contains("wavelog-catalog.json"))
        state.sourceMetadata["cty.xml"]?.status = "failed"
        state.sourceMetadata["cty.xml"]?.lastAttemptAt = now
        let backedOff = ReferenceCheckPlan.make(state: state, now: now,
            clubLogConfigured: true, wavelogConfigured: true,
            expectedIdentities: ["cty.xml": "new-cty-hash"])
        #expect(!backedOff.due.contains("cty.xml"))
    }
}
#endif

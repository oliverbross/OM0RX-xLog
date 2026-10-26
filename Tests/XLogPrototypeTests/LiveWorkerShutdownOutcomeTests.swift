import Testing
@testable import XLogPrototypeSupport

struct LiveWorkerShutdownOutcomeTests {
    @Test func retirementOutcomesKeepEachFailureDistinct() {
        #expect(LiveWorkerShutdownOutcome.resolve(onlineLogsRetired: true, contestSpotsRetired: true) == .clean)
        #expect(LiveWorkerShutdownOutcome.resolve(onlineLogsRetired: false, contestSpotsRetired: true) == .onlineLogRecoveryFailed)
        #expect(LiveWorkerShutdownOutcome.resolve(onlineLogsRetired: true, contestSpotsRetired: false) == .contestSpotWithdrawalFailed)
        #expect(LiveWorkerShutdownOutcome.resolve(onlineLogsRetired: false, contestSpotsRetired: false) == .backgroundRetirementFailed)
        #expect(LiveWorkerShutdownOutcome.contestSpotWithdrawalFailed.rawValue == 71)
    }
}

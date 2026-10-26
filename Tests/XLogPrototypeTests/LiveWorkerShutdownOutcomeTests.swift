import Testing
@testable import XLogPrototypeSupport

struct LiveWorkerShutdownOutcomeTests {
    @Test func retirementOutcomesKeepEachFailureDistinct() {
        #expect(LiveWorkerShutdownOutcome.resolve(onlineLogsRetired: true, contestSpotsRetired: true) == .clean)
        #expect(LiveWorkerShutdownOutcome.resolve(onlineLogsRetired: false, contestSpotsRetired: true) == .onlineLogRecoveryFailed)
        #expect(LiveWorkerShutdownOutcome.resolve(onlineLogsRetired: true, contestSpotsRetired: false) == .contestSpotCleanupDeferred)
        #expect(LiveWorkerShutdownOutcome.resolve(onlineLogsRetired: false, contestSpotsRetired: false) == .backgroundRetirementFailed)
        #expect(LiveWorkerShutdownOutcome.contestSpotWithdrawalFailed.rawValue == 71)
        #expect(LiveWorkerShutdownOutcome.clean.permitsRestart)
        #expect(LiveWorkerShutdownOutcome.contestSpotCleanupDeferred.permitsRestart)
        #expect(!LiveWorkerShutdownOutcome.onlineLogRecoveryFailed.permitsRestart)
        #expect(!LiveWorkerShutdownOutcome.backgroundRetirementFailed.permitsRestart)
        #expect(!LiveWorkerShutdownOutcome.contestSpotWithdrawalFailed.permitsRestart)
    }
}

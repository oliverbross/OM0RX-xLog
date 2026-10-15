import Foundation
import Testing
@testable import XLogCore

@Suite("Online-log restore safety")
struct OnlineLogRestoreSafetyTests {
    @Test func databaseIsPublishedWithRestoredUploadConsentAlreadyRevoked() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-restore-queue-\(UUID())")
        defer { try? FileManager.default.removeItem(at: root) }
        let source = try LogbookDatabase(url: root.appendingPathComponent("source.sqlite"))
        defer { source.close() }
        for service in OnlineLogService.allCases {
            _ = try source.configureOnlineLogEnrollment(service: service, enabled: true)
        }
        let qso = QSO(call: "VK8NSB", band: "20m", mode: "CW", myCall: "OM0RX")
        try source.saveNewContactForOnlineLogs(qso)
        let package = root.appendingPathComponent("queued.xlogbackup")
        let manager = XLogBackupManager()
        let preferences = XLogBackupPreferences(deskBandMapBands: [], detachedBandMapBands: [],
            deskBandMapFollowsRadio: false, detachedBandMapLayout: "Adaptive grid", bandMapFontScale: 1,
            intelligenceBands: [], clusterSpotOpensFullEditor: false)
        _ = try manager.create(database: source, at: package, settings: .defaults, preferences: preferences)
        let originalBytes = try Data(contentsOf: package.appendingPathComponent("OM0RX-xLog.sqlite"))

        // The remote provider accepted the contact after the backup was taken.
        for service in OnlineLogService.allCases {
            let plan = try source.prepareOnlineLogDelivery(service: service, contactID: qso.id)
            let attempt = UUID()
            #expect(try source.claimOnlineLogDelivery(plan, attemptID: attempt).shouldDispatch)
            _ = try source.resolveOnlineLogDelivery(plan, attemptID: attempt, resolution: .delivered(remoteID: "42"))
        }

        let liveURL = root.appendingPathComponent("live.sqlite")
        _ = try manager.installDatabase(from: package, to: liveURL)
        // No post-install owner callback is required, even if the process stops here.
        let restored = try LogbookDatabase(url: liveURL)
        defer { restored.close() }
        #expect(try restored.lookup(localID: qso.id) != nil)
        for service in OnlineLogService.allCases {
            #expect(try !restored.onlineLogEnrollmentStatus(service: service).enabled)
            #expect(try restored.onlineLogCandidateIDs(service: service).isEmpty)
            _ = try restored.configureOnlineLogEnrollment(service: service, enabled: true)
            let plan = try restored.prepareOnlineLogDelivery(service: service, contactID: qso.id)
            #expect(throws: OnlineLogDeliveryError.notEnrolled) {
                try restored.claimOnlineLogDelivery(plan, attemptID: UUID())
            }
            #expect(try source.onlineLogEnrollmentStatus(service: service).enabled)
            #expect(try source.onlineLogDeliverySummary(service: service).counts[.delivered] == 1)
        }
        #expect(try Data(contentsOf: package.appendingPathComponent("OM0RX-xLog.sqlite")) == originalBytes)
    }
}

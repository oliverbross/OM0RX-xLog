import Foundation
import Testing
@testable import XLogPrototypeSupport
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif

private final class OnlineLogProbe: @unchecked Sendable {
    private let lock = NSLock()
    private var credentialReadsValue = 0
    private var deliveriesValue = 0
    func readCredential(_ value: String?) -> String? {
        lock.withLock { credentialReadsValue += 1 }
        return value
    }
    func delivered() { lock.withLock { deliveriesValue += 1 } }
    var credentialReads: Int { lock.withLock { credentialReadsValue } }
    var deliveries: Int { lock.withLock { deliveriesValue } }
}

private actor OnlineLogDeliveryGate {
    private var started = false
    private var released = false
    private var startWaiters: [CheckedContinuation<Void, Never>] = []
    private var releaseWaiters: [CheckedContinuation<Void, Never>] = []
    func markStartedAndWait() async {
        started = true
        startWaiters.forEach { $0.resume() }; startWaiters.removeAll()
        if released { return }
        await withCheckedContinuation { releaseWaiters.append($0) }
    }
    func waitUntilStarted() async {
        if started { return }
        await withCheckedContinuation { startWaiters.append($0) }
    }
    func release() {
        released = true
        releaseWaiters.forEach { $0.resume() }; releaseWaiters.removeAll()
    }
}

private enum OnlineLogFixtureError: Error { case credentialUnavailable }

@Suite("Native online-log delivery owner", .serialized)
struct LiveOnlineLogDeliveryServiceTests {
    private func fixture() throws -> (LiveLogbookMethods, LogbookDatabase, URL) {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-online-owner-\(UUID())")
        let logbook = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        _ = try logbook.handle(method: "workspace_create", params: ["mode": "empty"])
        return (logbook, try logbook.openedDatabase(), root)
    }

    @Test func everyOnlineLogCredentialMutationFencesDeliveryOwnership() {
        for account in ["qrz-logbook-key", "clublog-api-key", "clublog-email",
                        "clublog-application-password", "clublog-callsign"] {
            #expect(LiveWorker.fencesOnlineLogDelivery(method: "secret_save", params: ["account": account]))
        }
        #expect(LiveWorker.fencesOnlineLogDelivery(method: "online_log_configure", params: [:]))
        #expect(!LiveWorker.fencesOnlineLogDelivery(method: "secret_save", params: ["account": "qrz-password"]))
    }

    @Test func disabledOrEmptyEnrollmentNeverReadsCredentialOrRunsDelivery() async throws {
        let (logbook, database, root) = try fixture()
        defer { database.close(); try? FileManager.default.removeItem(at: root) }
        let probe = OnlineLogProbe()
        let service = LiveOnlineLogDeliveryService(logbook: logbook,
            credential: { probe.readCredential("fixture-key") },
            delivery: { _, _, _, _ in probe.delivered(); throw OnlineLogDeliveryError.invalidPlan })

        await service.runDue()
        #expect(probe.credentialReads == 0)
        #expect(probe.deliveries == 0)
        _ = try database.configureOnlineLogEnrollment(service: .qrz, enabled: true)
        await service.runDue()
        #expect(probe.credentialReads == 0)
        #expect(probe.deliveries == 0)
        await service.terminate()
    }

    @Test func invalidCredentialNeverClaimsCandidateAndValidDeliveryRetiresIt() async throws {
        let (logbook, database, root) = try fixture()
        defer { database.close(); try? FileManager.default.removeItem(at: root) }
        _ = try database.configureOnlineLogEnrollment(service: .qrz, enabled: true)
        let qso = QSO(call: "VK9ABC", start: Date(timeIntervalSince1970: 1_700_000_900),
                      band: "20m", mode: "CW", myCall: "OM0RX")
        try database.saveNewContactForOnlineLogs(qso)
        let invalidProbe = OnlineLogProbe()
        let invalid = LiveOnlineLogDeliveryService(logbook: logbook,
            credential: { invalidProbe.readCredential(" bad key ") },
            delivery: { _, _, _, _ in invalidProbe.delivered(); throw OnlineLogDeliveryError.invalidPlan })
        await invalid.runDue()
        #expect(invalidProbe.credentialReads == 1)
        #expect(invalidProbe.deliveries == 0)
        #expect(try database.onlineLogCandidateIDs(service: .qrz) == [qso.id])
        await invalid.terminate()

        let probe = OnlineLogProbe()
        let service = LiveOnlineLogDeliveryService(logbook: logbook,
            credential: { probe.readCredential("fixture-key") },
            delivery: { database, contactID, _, now in
                probe.delivered()
                let plan = try database.prepareOnlineLogDelivery(service: .qrz, contactID: contactID)
                let attempt = UUID()
                guard try database.claimOnlineLogDelivery(plan, attemptID: attempt, at: now).shouldDispatch else {
                    throw OnlineLogDeliveryError.operationMismatch
                }
                return try database.resolveOnlineLogDelivery(plan, attemptID: attempt,
                    resolution: .delivered(remoteID: "42"), at: now)
            })
        await service.runDue(now: Date(timeIntervalSince1970: 1_000))
        #expect(probe.credentialReads == 1)
        #expect(probe.deliveries == 1)
        #expect(try database.onlineLogCandidateIDs(service: .qrz).isEmpty)
        await service.terminate()
    }

    @Test func throwingProviderCredentialDoesNotStarveIndependentProvider() async throws {
        let (logbook, database, root) = try fixture()
        defer { database.close(); try? FileManager.default.removeItem(at: root) }
        _ = try database.configureOnlineLogEnrollment(service: .qrz, enabled: true)
        _ = try database.configureOnlineLogEnrollment(service: .clubLog, enabled: true)
        let qso = QSO(call: "EA8TEST", start: Date(timeIntervalSince1970: 1_700_000_950),
                      band: "20m", mode: "CW", myCall: "OM0RX")
        try database.saveNewContactForOnlineLogs(qso)
        let qrz = OnlineLogProbe(), club = OnlineLogProbe()
        let service = LiveOnlineLogDeliveryService(logbook: logbook, testingProviders: [
            .init(service: .qrz, credential: {
                _ = qrz.readCredential(nil)
                throw OnlineLogFixtureError.credentialUnavailable
            }, delivery: { _, _, _, _ in
                qrz.delivered(); throw OnlineLogDeliveryError.invalidPlan
            }),
            .init(service: .clubLog, credential: { club.readCredential("fixture-club") },
                  delivery: { database, contactID, _, now in
                club.delivered()
                let plan = try database.prepareOnlineLogDelivery(service: .clubLog, contactID: contactID)
                let attempt = UUID()
                guard try database.claimOnlineLogDelivery(plan, attemptID: attempt, at: now).shouldDispatch else {
                    throw OnlineLogDeliveryError.operationMismatch
                }
                return try database.resolveOnlineLogDelivery(plan, attemptID: attempt,
                    resolution: .delivered(remoteID: nil), at: now)
            }),
        ])

        await service.runDue(now: Date(timeIntervalSince1970: 1_000))
        #expect(qrz.credentialReads == 1)
        #expect(qrz.deliveries == 0)
        #expect(club.credentialReads == 1)
        #expect(club.deliveries == 1)
        let qrzStatus = await service.providerStatusFields(service: .qrz)
        #expect(qrzStatus["provider_issue_code"] as? String == "credential_unavailable")
        #expect(qrzStatus.values.contains { String(describing: $0).contains("credentialUnavailable") } == false)
        let clubStatus = await service.providerStatusFields(service: .clubLog)
        #expect(clubStatus["provider_issue_code"] is NSNull)
        #expect(try database.onlineLogCandidateIDs(service: .qrz) == [qso.id])
        #expect(try database.onlineLogCandidateIDs(service: .clubLog).isEmpty)
        await service.terminate()
    }

    @Test func startupRecoveryRetiresInterruptedCandidateBeforeCredentialAccess() async throws {
        let (logbook, database, root) = try fixture()
        defer { database.close(); try? FileManager.default.removeItem(at: root) }
        _ = try database.configureOnlineLogEnrollment(service: .qrz, enabled: true)
        let qso = QSO(call: "KL7ABC", start: Date(timeIntervalSince1970: 1_700_001_000),
                      band: "15m", mode: "SSB", myCall: "OM0RX")
        try database.saveNewContactForOnlineLogs(qso)
        let plan = try database.prepareOnlineLogDelivery(service: .qrz, contactID: qso.id)
        #expect(try database.claimOnlineLogDelivery(plan, attemptID: UUID()).shouldDispatch)
        let probe = OnlineLogProbe()
        let service = LiveOnlineLogDeliveryService(logbook: logbook,
            credential: { probe.readCredential("fixture-key") },
            delivery: { _, _, _, _ in probe.delivered(); throw OnlineLogDeliveryError.invalidPlan })

        await service.runDue()
        #expect(probe.credentialReads == 0)
        #expect(probe.deliveries == 0)
        #expect(try database.onlineLogCandidateIDs(service: .qrz).isEmpty)
        let receipt = try #require(try database.onlineLogDeliveryReceipt(service: .qrz, contactID: qso.id,
                                                                          contactRevision: plan.contact.revision))
        #expect(receipt.state == .uncertain)
        #expect(receipt.safeErrorCode == "interrupted_after_dispatch")
        await service.terminate()
    }

    @Test func serviceStatusIsAggregateOnlyAndDisableCancelsPendingCandidate() async throws {
        let (logbook, database, root) = try fixture()
        defer { database.close(); try? FileManager.default.removeItem(at: root) }
        _ = try database.configureOnlineLogEnrollment(service: .qrz, enabled: true)
        let qso = QSO(call: "VE1ABC", start: Date(timeIntervalSince1970: 1_700_001_100),
                      band: "10m", mode: "FT8", myCall: "OM0RX")
        try database.saveNewContactForOnlineLogs(qso)
        let services = LiveServiceMethods(logbook: logbook)
        let status = try await services.handle(method: "online_log_status", params: [:])
        #expect(status["enabled"] as? Bool == true)
        #expect(status["pending_new_contacts"] as? Int == 1)
        #expect(status["states"] as? [String: Int] == [
            "dispatching": 0, "deferred": 0, "delivered": 0, "rejected": 0, "uncertain": 0,
        ])
        #expect(status.values.contains { ($0 as? String) == qso.call } == false)

        let disabled = try await services.handle(method: "online_log_configure", params: [
            "enabled": NSNumber(value: false), "confirm_new_contacts_only": NSNumber(value: false),
        ])
        #expect(disabled["enabled"] as? Bool == false)
        #expect(disabled["pending_new_contacts"] as? Int == 0)
        await services.terminate()
    }

    @Test func serviceStatusIncludesBoundedSafePerContactAttentionRows() async throws {
        let (logbook, database, root) = try fixture()
        defer { database.close(); try? FileManager.default.removeItem(at: root) }
        _ = try database.configureOnlineLogEnrollment(service: .qrz, enabled: true)
        let qso = QSO(call: "VK8REVIEW", start: Date(timeIntervalSince1970: 1_700_001_150),
                      band: "15m", mode: "MFSK", submode: "FT4", comment: "must-not-project",
                      myCall: "OM0RX")
        try database.saveNewContactForOnlineLogs(qso)
        let plan = try database.prepareOnlineLogDelivery(service: .qrz, contactID: qso.id)
        let attempt = UUID(), attempted = Date(timeIntervalSince1970: 1_700_001_200)
        _ = try database.claimOnlineLogDelivery(plan, attemptID: attempt, at: attempted)
        _ = try database.resolveOnlineLogDelivery(plan, attemptID: attempt,
            resolution: .uncertain(code: "transport_unknown"), at: attempted)
        let services = LiveServiceMethods(logbook: logbook)

        let status = try await services.handle(method: "online_log_status", params: ["service": "qrz"])
        let rows = try #require(status["attention"] as? [[String: Any]])
        #expect(rows.count == 1)
        #expect(rows[0]["contact_id"] as? String == qso.id.uuidString)
        #expect(rows[0]["call"] as? String == "VK8REVIEW")
        #expect(rows[0]["band"] as? String == "15m")
        #expect(rows[0]["mode"] as? String == "FT4")
        #expect(rows[0]["state"] as? String == "uncertain")
        #expect(rows[0]["safe_error_code"] as? String == "transport_unknown")
        #expect(rows[0]["available_actions"] as? [String] == ["inspect", "confirm_delivered"])
        let text = String(decoding: try JSONSerialization.data(withJSONObject: status), as: UTF8.self)
        #expect(!text.contains("must-not-project"))
        #expect(!text.contains(attempt.uuidString))
        #expect(!text.contains(plan.payloadSHA256))
        #expect(try database.onlineLogDeliveryReceipt(service: .qrz, contactID: qso.id,
            contactRevision: plan.contact.revision)?.state == .uncertain)
        let generation = try #require(status["generation"] as? String)
        let reconciled = try await services.handle(method: "online_log_reconcile", params: [
            "service": "qrz", "contact_id": qso.id.uuidString,
            "contact_revision": NSNumber(value: plan.contact.revision), "generation": generation,
            "action": "confirm_delivered", "confirm_remote_state": NSNumber(value: true),
        ])
        #expect((reconciled["attention"] as? [[String: Any]])?.isEmpty == true)
        #expect(try database.onlineLogDeliveryReceipt(service: .qrz, contactID: qso.id,
            contactRevision: plan.contact.revision)?.state == .delivered)
        #expect(try database.onlineLogCandidateIDs(service: .qrz).isEmpty)
        await #expect(throws: Error.self) {
            _ = try await services.handle(method: "online_log_reconcile", params: [
                "service": "qrz", "contact_id": qso.id.uuidString,
                "contact_revision": NSNumber(value: plan.contact.revision), "generation": generation,
                "action": "confirm_delivered", "confirm_remote_state": NSNumber(value: true),
            ])
        }
        await services.terminate()
    }

    @Test func serviceStatusAndDisableRemainProviderScoped() async throws {
        let (logbook, database, root) = try fixture()
        defer { database.close(); try? FileManager.default.removeItem(at: root) }
        _ = try database.configureOnlineLogEnrollment(service: .qrz, enabled: true)
        _ = try database.configureOnlineLogEnrollment(service: .clubLog, enabled: true)
        let qso = QSO(call: "VE2ABC", start: Date(timeIntervalSince1970: 1_700_001_200),
                      band: "10m", mode: "FT8", myCall: "OM0RX")
        try database.saveNewContactForOnlineLogs(qso)
        let services = LiveServiceMethods(logbook: logbook)

        let club = try await services.handle(method: "online_log_status", params: ["service": "club_log"])
        #expect(club["service"] as? String == "club_log")
        #expect(club["enabled"] as? Bool == true)
        #expect(club["pending_new_contacts"] as? Int == 1)
        _ = try await services.handle(method: "online_log_configure", params: [
            "service": "club_log", "enabled": NSNumber(value: false),
            "confirm_new_contacts_only": NSNumber(value: false),
        ])
        #expect(try database.onlineLogCandidateIDs(service: .clubLog).isEmpty)
        #expect(try database.onlineLogCandidateIDs(service: .qrz) == [qso.id])
        #expect(try database.onlineLogEnrollmentStatus(service: .qrz).enabled)
        await services.terminate()
    }

    @Test func rejectionRevocationStopsTheAlreadyCachedBatch() async throws {
        let (logbook, database, root) = try fixture()
        defer { database.close(); try? FileManager.default.removeItem(at: root) }
        _ = try database.configureOnlineLogEnrollment(service: .qrz, enabled: true)
        let first = QSO(call: "JA1ABC", start: Date(timeIntervalSince1970: 1_700_001_300),
                        band: "20m", mode: "CW", myCall: "OM0RX")
        let second = QSO(call: "JA2ABC", start: Date(timeIntervalSince1970: 1_700_001_310),
                         band: "20m", mode: "CW", myCall: "OM0RX")
        try database.saveNewContactForOnlineLogs(first)
        try database.saveNewContactForOnlineLogs(second)
        let probe = OnlineLogProbe()
        let service = LiveOnlineLogDeliveryService(logbook: logbook, credential: { "fixture-key" },
            delivery: { database, _, _, _ in
                probe.delivered()
                _ = try database.configureOnlineLogEnrollment(service: .qrz, enabled: false)
                throw OnlineLogDeliveryError.invalidPlan
            })

        await service.runDue()
        #expect(probe.deliveries == 1)
        #expect(try !database.onlineLogEnrollmentStatus(service: .qrz).enabled)
        #expect(try database.onlineLogCandidateIDs(service: .qrz).isEmpty)
        await service.terminate()
    }

    @Test func terminalRetirementWaitsForAcceptedDeliveryAndPreservesDurableOutbox() async throws {
        let (logbook, database, root) = try fixture()
        defer { database.close(); try? FileManager.default.removeItem(at: root) }
        _ = try database.configureOnlineLogEnrollment(service: .qrz, enabled: true)
        let qso = QSO(call: "VK8DRAIN", start: Date(timeIntervalSince1970: 1_700_001_400),
                      band: "20m", mode: "FT8", myCall: "OM0RX")
        try database.saveNewContactForOnlineLogs(qso)
        let persistedPlan = try database.prepareOnlineLogDelivery(service: .qrz, contactID: qso.id)
        let gate = OnlineLogDeliveryGate()
        let service = LiveOnlineLogDeliveryService(logbook: logbook, credential: { "fixture-key" },
            delivery: { database, contactID, _, now in
                await gate.markStartedAndWait()
                let plan = try database.prepareOnlineLogDelivery(service: .qrz, contactID: contactID)
                let attempt = UUID()
                guard try database.claimOnlineLogDelivery(plan, attemptID: attempt, at: now).shouldDispatch else {
                    throw OnlineLogDeliveryError.operationMismatch
                }
                return try database.resolveOnlineLogDelivery(plan, attemptID: attempt,
                    resolution: .delivered(remoteID: "drained"), at: now)
            })
        await service.requestDelivery()
        await gate.waitUntilStarted()
        let retiring = Task { await service.terminate() }
        await Task.yield()
        #expect(await service.hasScheduledWorkForTesting())
        await gate.release()
        #expect(await retiring.value)
        #expect(try database.lookup(localID: qso.id) != nil)
        let receipt = try #require(try database.onlineLogDeliveryReceipt(service: .qrz,
            contactID: qso.id, contactRevision: persistedPlan.contact.revision))
        #expect(receipt.state == .uncertain)
    }

    @Test func retirementRecoveryFailureIsReportedInsteadOfClaimingCleanExit() async throws {
        let (logbook, database, root) = try fixture()
        defer { database.close(); try? FileManager.default.removeItem(at: root) }
        let service = LiveOnlineLogDeliveryService(logbook: logbook,
            retirementRecovery: { throw OnlineLogDeliveryError.invalidPlan },
            credential: { "fixture-key" },
            delivery: { _, _, _, _ in throw OnlineLogDeliveryError.invalidPlan })
        await service.startAutomaticDelivery()
        #expect(await service.terminate() == false)
    }

    @Test func inactiveContestingOwnerDoesNotRewriteExistingDispatchReceipt() async throws {
        let (logbook, database, root) = try fixture()
        defer { database.close(); try? FileManager.default.removeItem(at: root) }
        _ = try database.configureOnlineLogEnrollment(service: .qrz, enabled: true)
        let qso = QSO(call: "VK8OWN", start: Date(timeIntervalSince1970: 1_700_001_500),
                      band: "20m", mode: "FT8", myCall: "OM0RX")
        try database.saveNewContactForOnlineLogs(qso)
        let plan = try database.prepareOnlineLogDelivery(service: .qrz, contactID: qso.id)
        #expect(try database.claimOnlineLogDelivery(plan, attemptID: UUID()).shouldDispatch)
        let service = LiveOnlineLogDeliveryService(logbook: logbook,
            backgroundOwnershipAllowed: { false }, credential: { "fixture-key" },
            delivery: { _, _, _, _ in throw OnlineLogDeliveryError.invalidPlan })
        #expect(await service.terminate())
        let receipt = try #require(try database.onlineLogDeliveryReceipt(service: .qrz,
            contactID: qso.id, contactRevision: plan.contact.revision))
        #expect(receipt.state == .dispatching)
    }
}

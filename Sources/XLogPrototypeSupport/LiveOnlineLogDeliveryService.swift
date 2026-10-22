import Foundation
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif

/// Native, renderer-independent owner for prospective online-log uploads.
/// Construction is inert. The database enrollment switch remains the sole
/// authority to read a credential or dispatch provider traffic.
actor LiveOnlineLogDeliveryService {
    private enum Credential: Sendable {
        case qrz(String)
        case clubLog(ClubLogCredentials)
    }
    private struct Provider: Sendable {
        let service: OnlineLogService
        let credential: @Sendable () throws -> Credential?
        let delivery: @Sendable (LogbookDatabase, UUID, Credential, Date) async throws -> OnlineLogDeliveryReceipt
    }
    struct TestingProvider: Sendable {
        let service: OnlineLogService
        let credential: @Sendable () throws -> String?
        let delivery: @Sendable (LogbookDatabase, UUID, String, Date) async throws -> OnlineLogDeliveryReceipt
    }

    private let logbook: LiveLogbookMethods
    private let providers: [Provider]
    private let externalIOAllowed: @Sendable () -> Bool
    private let backgroundOwnershipAllowed: @Sendable () -> Bool
    private let retirementRecovery: @Sendable () throws -> Void
    private var automaticTask: Task<Void, Never>?
    private var deliveryTask: Task<Void, Never>?
    private var recoveredGeneration: String?
    private var providerIssueCodes: [OnlineLogService: String] = [:]
    private var workspaceTransitions = 0
    private var stopped = false
    private var backgroundOwnershipStarted = false

    init(logbook: LiveLogbookMethods = .shared,
         externalIOAllowed: @escaping @Sendable () -> Bool = { AppRuntimeProfile.current.externalIOAllowed },
         backgroundOwnershipAllowed: @escaping @Sendable () -> Bool = { true },
         retirementRecovery: (@Sendable () throws -> Void)? = nil) {
        self.logbook = logbook
        self.externalIOAllowed = externalIOAllowed
        self.backgroundOwnershipAllowed = backgroundOwnershipAllowed
        self.retirementRecovery = retirementRecovery ?? { try Self.recoverInterrupted(logbook: logbook) }
        let qrz = Provider(service: .qrz, credential: {
            let service = try logbook.currentKeychainService()
            guard let key = try WorkspaceCredentialStore(service: service).load(.qrzLogbookKey), Self.valid(accessKey: key) else {
                return nil
            }
            return .qrz(key)
        }, delivery: { database, contactID, credential, now in
            guard case .qrz(let accessKey) = credential else { throw OnlineLogDeliveryError.invalidPlan }
            let transport = try QRZLogbookTransport()
            return try await QRZLogbookDeliveryCoordinator(database: database, transport: transport)
                .deliver(contactID: contactID, accessKey: accessKey, now: now)
        })
        let clubLog = Provider(service: .clubLog, credential: {
            let service = try logbook.currentKeychainService()
            let secrets = WorkspaceCredentialStore(service: service)
            guard let email = try secrets.load(.clubLogEmail),
                  let password = try secrets.load(.clubLogApplicationPassword),
                  let callsign = try secrets.load(.clubLogCallsign),
                  let apiKey = try secrets.load(.clubLogAPIKey) else { return nil }
            let credentials = ClubLogCredentials(email: email, applicationPassword: password,
                                                 callsign: callsign, apiKey: apiKey)
            return credentials.isValid ? .clubLog(credentials) : nil
        }, delivery: { database, contactID, credential, now in
            guard case .clubLog(let credentials) = credential else { throw OnlineLogDeliveryError.invalidPlan }
            let transport = try ClubLogTransport()
            return try await ClubLogDeliveryCoordinator(database: database, transport: transport)
                .deliver(contactID: contactID, credentials: credentials, now: now)
        })
        providers = [qrz, clubLog]
    }

    /// QRZ-only injection seam retained for deterministic owner tests.
    init(logbook: LiveLogbookMethods,
         externalIOAllowed: @escaping @Sendable () -> Bool = { true },
         backgroundOwnershipAllowed: @escaping @Sendable () -> Bool = { true },
         retirementRecovery: (@Sendable () throws -> Void)? = nil,
         credential: @escaping @Sendable () throws -> String?,
         delivery: @escaping @Sendable (LogbookDatabase, UUID, String, Date) async throws -> OnlineLogDeliveryReceipt) {
        self.logbook = logbook
        self.externalIOAllowed = externalIOAllowed
        self.backgroundOwnershipAllowed = backgroundOwnershipAllowed
        self.retirementRecovery = retirementRecovery ?? { try Self.recoverInterrupted(logbook: logbook) }
        providers = [Provider(service: .qrz, credential: {
            guard let key = try credential(), Self.valid(accessKey: key) else { return nil }
            return .qrz(key)
        }, delivery: { database, contactID, value, now in
            guard case .qrz(let key) = value else { throw OnlineLogDeliveryError.invalidPlan }
            return try await delivery(database, contactID, key, now)
        })]
    }

    init(logbook: LiveLogbookMethods,
         externalIOAllowed: @escaping @Sendable () -> Bool = { true },
         backgroundOwnershipAllowed: @escaping @Sendable () -> Bool = { true },
         retirementRecovery: (@Sendable () throws -> Void)? = nil,
         testingProviders: [TestingProvider]) {
        self.logbook = logbook
        self.externalIOAllowed = externalIOAllowed
        self.backgroundOwnershipAllowed = backgroundOwnershipAllowed
        self.retirementRecovery = retirementRecovery ?? { try Self.recoverInterrupted(logbook: logbook) }
        providers = testingProviders.map { provider in
            Provider(service: provider.service, credential: {
                guard let value = try provider.credential() else { return nil }
                return .qrz(value)
            }, delivery: { database, contactID, credential, now in
                guard case .qrz(let value) = credential else { throw OnlineLogDeliveryError.invalidPlan }
                return try await provider.delivery(database, contactID, value, now)
            })
        }
    }

    func startAutomaticDelivery() {
        guard backgroundOwnershipAllowed(), externalIOAllowed(), automaticTask == nil, !stopped else { return }
        backgroundOwnershipStarted = true
        requestDelivery()
        automaticTask = Task { [weak self] in
            while !Task.isCancelled {
                do { try await Task.sleep(nanoseconds: 15_000_000_000) } catch { return }
                if let owner = self { await owner.requestDelivery() } else { return }
            }
        }
    }

    /// Schedules and coalesces a bounded pass; the caller never waits for HTTP.
    func requestDelivery() {
        guard backgroundOwnershipAllowed(), externalIOAllowed(), !stopped,
              workspaceTransitions == 0, deliveryTask == nil else { return }
        backgroundOwnershipStarted = true
        deliveryTask = Task(priority: .utility) { [weak self] in
            await self?.runDue()
            await self?.finishDeliveryTask()
        }
    }

    func runDue(now: Date = Date()) async {
        guard backgroundOwnershipAllowed(), externalIOAllowed(), !stopped, workspaceTransitions == 0 else { return }
        do {
            let generation = try logbook.syncOwnerContext()["generation"] as? String
            guard let generation else { return }
            let database = try logbook.openedDatabase()
            if recoveredGeneration != generation {
                _ = try database.recoverInterruptedOnlineLogDeliveries()
                recoveredGeneration = generation
            }
            for provider in providers {
                do {
                    let status = try database.onlineLogEnrollmentStatus(service: provider.service)
                    guard status.enabled else {
                        providerIssueCodes[provider.service] = nil
                        continue
                    }
                    let candidates = try database.onlineLogCandidateIDs(service: provider.service, limit: 16)
                    guard !candidates.isEmpty else { continue }
                    // Invalid, unavailable or throwing credentials must never
                    // consume this provider's candidates or starve another.
                    let credential: Credential
                    do {
                        guard let loaded = try provider.credential() else {
                            providerIssueCodes[provider.service] = "credential_unavailable"
                            continue
                        }
                        credential = loaded
                        providerIssueCodes[provider.service] = nil
                    } catch {
                        providerIssueCodes[provider.service] = "credential_unavailable"
                        continue
                    }
                    for contactID in candidates {
                        guard !stopped, workspaceTransitions == 0, !Task.isCancelled else { return }
                        // A prior delivery may have disabled the provider and
                        // deleted the remaining queue. Never dispatch a cached ID
                        // after that revocation.
                        guard try database.onlineLogEnrollmentStatus(service: provider.service).enabled else { break }
                        guard try database.isOnlineLogCandidate(service: provider.service, contactID: contactID) else { continue }
                        do { _ = try await provider.delivery(database, contactID, credential, now) }
                        catch OnlineLogDeliveryError.notDue { continue }
                        catch OnlineLogDeliveryError.staleContact { continue }
                        catch OnlineLogDeliveryError.deliveryUncertain { continue }
                        catch { continue }
                    }
                } catch {
                    // Provider setup and vault errors are isolated and never
                    // surfaced verbatim because they may contain secret data.
                    continue
                }
            }
        } catch {
            // Status is intentionally local-only in this slice. Never surface a
            // vault/provider error because it may contain secret material.
        }
    }

    func suspendForOwnershipChange() async {
        workspaceTransitions += 1
        let running = deliveryTask
        running?.cancel()
        await running?.value
        deliveryTask = nil
        recoveredGeneration = nil
    }

    func finishOwnershipChange() {
        workspaceTransitions = max(0, workspaceTransitions - 1)
        if workspaceTransitions == 0, backgroundOwnershipAllowed() { requestDelivery() }
    }

    func beginTermination() {
        stopped = true
        automaticTask?.cancel(); automaticTask = nil
        deliveryTask?.cancel()
    }

    @discardableResult func terminate() async -> Bool {
        beginTermination()
        let running = deliveryTask
        await running?.value
        deliveryTask = nil
        // A cancelled provider may already have crossed dispatch admission.
        // Convert that durable state to explicit uncertainty before the worker
        // can report clean retirement; deferred work remains queued unchanged.
        guard backgroundOwnershipAllowed(), backgroundOwnershipStarted else { return true }
        do {
            try retirementRecovery()
            return true
        } catch {
            return false
        }
    }

    func hasScheduledWorkForTesting() -> Bool {
        automaticTask != nil || deliveryTask != nil
    }

    /// Safe status fields only. Provider and vault error text is never retained.
    func providerStatusFields(service: OnlineLogService) -> [String: Any] {
        ["provider_issue_code": providerIssueCodes[service] as Any? ?? NSNull()]
    }

    private func finishDeliveryTask() { deliveryTask = nil }

    private static func recoverInterrupted(logbook: LiveLogbookMethods) throws {
        let status = try logbook.handle(method: "workspace_status", params: [:])
        guard let workspaceExists = status["workspace_exists"] as? Bool else {
            throw OnlineLogDeliveryError.invalidPlan
        }
        if workspaceExists {
            _ = try logbook.openedDatabase().recoverInterruptedOnlineLogDeliveries()
        }
    }

    private static func valid(accessKey: String) -> Bool {
        !accessKey.isEmpty && accessKey.utf8.count <= 256 &&
            !accessKey.unicodeScalars.contains(where: {
                CharacterSet.whitespacesAndNewlines.contains($0) || CharacterSet.controlCharacters.contains($0)
            })
    }
}

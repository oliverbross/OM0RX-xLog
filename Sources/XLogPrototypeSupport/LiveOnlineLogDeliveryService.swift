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

    private let logbook: LiveLogbookMethods
    private let providers: [Provider]
    private var automaticTask: Task<Void, Never>?
    private var deliveryTask: Task<Void, Never>?
    private var recoveredGeneration: String?
    private var workspaceTransitions = 0
    private var stopped = false

    init(logbook: LiveLogbookMethods = .shared) {
        self.logbook = logbook
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
         credential: @escaping @Sendable () throws -> String?,
         delivery: @escaping @Sendable (LogbookDatabase, UUID, String, Date) async throws -> OnlineLogDeliveryReceipt) {
        self.logbook = logbook
        providers = [Provider(service: .qrz, credential: {
            guard let key = try credential(), Self.valid(accessKey: key) else { return nil }
            return .qrz(key)
        }, delivery: { database, contactID, value, now in
            guard case .qrz(let key) = value else { throw OnlineLogDeliveryError.invalidPlan }
            return try await delivery(database, contactID, key, now)
        })]
    }

    func startAutomaticDelivery() {
        guard automaticTask == nil, !stopped else { return }
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
        guard !stopped, workspaceTransitions == 0, deliveryTask == nil else { return }
        deliveryTask = Task(priority: .utility) { [weak self] in
            await self?.runDue()
            await self?.finishDeliveryTask()
        }
    }

    func runDue(now: Date = Date()) async {
        guard !stopped, workspaceTransitions == 0 else { return }
        do {
            let generation = try logbook.syncOwnerContext()["generation"] as? String
            guard let generation else { return }
            let database = try logbook.openedDatabase()
            if recoveredGeneration != generation {
                _ = try database.recoverInterruptedOnlineLogDeliveries()
                recoveredGeneration = generation
            }
            for provider in providers {
                let status = try database.onlineLogEnrollmentStatus(service: provider.service)
                guard status.enabled else { continue }
                let candidates = try database.onlineLogCandidateIDs(service: provider.service, limit: 16)
                guard !candidates.isEmpty else { continue }
                // Invalid or unavailable credentials must never consume a candidate.
                guard let credential = try provider.credential() else { continue }
                for contactID in candidates {
                    guard !stopped, workspaceTransitions == 0, !Task.isCancelled else { return }
                    do { _ = try await provider.delivery(database, contactID, credential, now) }
                    catch OnlineLogDeliveryError.notDue { continue }
                    catch OnlineLogDeliveryError.staleContact { continue }
                    catch OnlineLogDeliveryError.deliveryUncertain { continue }
                    catch { continue }
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
        if workspaceTransitions == 0 { requestDelivery() }
    }

    func beginTermination() {
        stopped = true
        automaticTask?.cancel(); automaticTask = nil
        deliveryTask?.cancel()
    }

    func terminate() async {
        beginTermination()
        let running = deliveryTask
        await running?.value
        deliveryTask = nil
    }

    private func finishDeliveryTask() { deliveryTask = nil }

    private static func valid(accessKey: String) -> Bool {
        !accessKey.isEmpty && accessKey.utf8.count <= 256 &&
            !accessKey.unicodeScalars.contains(where: {
                CharacterSet.whitespacesAndNewlines.contains($0) || CharacterSet.controlCharacters.contains($0)
            })
    }
}

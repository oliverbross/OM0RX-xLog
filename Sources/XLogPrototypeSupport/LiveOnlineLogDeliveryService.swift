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
    typealias Credential = @Sendable () throws -> String?
    typealias Delivery = @Sendable (LogbookDatabase, UUID, String, Date) async throws -> OnlineLogDeliveryReceipt

    private let logbook: LiveLogbookMethods
    private let credential: Credential
    private let delivery: Delivery
    private var automaticTask: Task<Void, Never>?
    private var deliveryTask: Task<Void, Never>?
    private var recoveredGeneration: String?
    private var workspaceTransitions = 0
    private var stopped = false

    init(logbook: LiveLogbookMethods = .shared,
         credential: Credential? = nil,
         delivery: Delivery? = nil) {
        self.logbook = logbook
        self.credential = credential ?? {
            let service = try logbook.currentKeychainService()
            return try WorkspaceCredentialStore(service: service).load(.qrzLogbookKey)
        }
        self.delivery = delivery ?? { database, contactID, accessKey, now in
            let transport = try QRZLogbookTransport()
            return try await QRZLogbookDeliveryCoordinator(database: database, transport: transport)
                .deliver(contactID: contactID, accessKey: accessKey, now: now)
        }
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
            let status = try database.onlineLogEnrollmentStatus(service: .qrz)
            guard status.enabled else { return }
            let candidates = try database.onlineLogCandidateIDs(service: .qrz, limit: 16)
            guard !candidates.isEmpty else { return }
            // Invalid or unavailable credentials must never consume a candidate.
            guard let accessKey = try credential(), Self.valid(accessKey: accessKey) else { return }
            for contactID in candidates {
                guard !stopped, workspaceTransitions == 0, !Task.isCancelled else { return }
                do { _ = try await delivery(database, contactID, accessKey, now) }
                catch OnlineLogDeliveryError.notDue { continue }
                catch OnlineLogDeliveryError.staleContact { continue }
                catch OnlineLogDeliveryError.deliveryUncertain { continue }
                catch { continue }
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

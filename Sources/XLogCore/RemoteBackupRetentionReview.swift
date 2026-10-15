import Foundation

/// Provider-observed identity retained only after independent byte verification.
/// Non-secret metadata, not a deletion capability. Each provider must use its
/// own validated opaque namespaces so identities cannot be rebound across adapters.
public struct RemoteBackupVerifiedObject: Equatable, Sendable, Codable {
    public let provider: RemoteBackupProvider
    public let providerAccountID: String
    public let objectID: String
    public let revision: String

    public init(provider: RemoteBackupProvider, providerAccountID: String, objectID: String, revision: String) throws {
        func opaque(_ value: String, prefix: String) -> Bool {
            value.hasPrefix(prefix) && value.utf8.count <= 512 && value.count > prefix.count
                && value.dropFirst(prefix.count).utf8.allSatisfy {
                    (65...90).contains($0) || (97...122).contains($0) || (48...57).contains($0) || [45, 95].contains($0)
                }
        }
        let valid: Bool
        switch provider {
        case .dropbox:
            valid = opaque(providerAccountID, prefix: "dbid:") && opaque(objectID, prefix: "id:")
                && (9...128).contains(revision.utf8.count)
                && revision.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) })
        case .googleDrive:
            valid = opaque(providerAccountID, prefix: "gdrive:")
                && opaque(objectID, prefix: "gfile:") && opaque(revision, prefix: "grev:")
        default:
            valid = false
        }
        guard valid else {
            throw RemoteBackupPlanningError.invalidReceipt
        }
        self.provider = provider; self.providerAccountID = providerAccountID; self.objectID = objectID; self.revision = revision
    }

    private enum CodingKeys: String, CodingKey { case provider, providerAccountID, objectID, revision }
    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        guard let provider = RemoteBackupProvider(rawValue: try values.decode(String.self, forKey: .provider)) else {
            throw RemoteBackupPlanningError.invalidReceipt
        }
        try self.init(provider: provider, providerAccountID: values.decode(String.self, forKey: .providerAccountID),
            objectID: values.decode(String.self, forKey: .objectID), revision: values.decode(String.self, forKey: .revision))
    }
    public func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(provider.rawValue, forKey: .provider)
        try values.encode(providerAccountID, forKey: .providerAccountID)
        try values.encode(objectID, forKey: .objectID); try values.encode(revision, forKey: .revision)
    }
}

public enum RemoteBackupRetentionProtection: Equatable, Sendable {
    case keepAll, foreignContext, unverified, missingRemoteIdentity, foreignAccount, ambiguousIdentity
    case deletionClaimed, newestVerified, clockReview
}

public struct RemoteBackupProtectedReceipt: Equatable, Sendable {
    public let receipt: RemoteBackupUploadReceipt
    public let reason: RemoteBackupRetentionProtection
}

/// Passive review of durable application-owned receipts, not a provider listing
/// or authority to delete. Legacy verified receipts without a pinned remote object
/// are protected and do not count toward the minimum verified backups retained.
public struct RemoteBackupRetentionReview: Equatable, Sendable {
    public let workspaceGeneration: UUID
    public let destination: RemoteBackupDestination
    public let candidates: [RemoteBackupUploadReceipt]
    public let protected: [RemoteBackupProtectedReceipt]

    public init(workspaceGeneration: UUID, destination: RemoteBackupDestination, providerAccountID: String,
                receipts: [RemoteBackupUploadReceipt], deletionClaims: Set<UUID> = [], at now: Date) throws {
        guard workspaceGeneration.uuidString != "00000000-0000-0000-0000-000000000000",
              now.timeIntervalSince1970.isFinite, now.timeIntervalSince1970 >= 0,
              destination.provider == .dropbox else { throw RemoteBackupPlanningError.staleContext }
        // Validate the account expectation with the same bounded provider syntax.
        _ = try RemoteBackupVerifiedObject(provider: .dropbox, providerAccountID: providerAccountID,
            objectID: "id:validation", revision: "000000000")
        self.workspaceGeneration = workspaceGeneration; self.destination = destination
        let counts = Dictionary(grouping: receipts, by: { $0.plan.backupID }).mapValues(\.count)
        let objects = Dictionary(grouping: receipts.compactMap { receipt -> String? in
            receipt.remoteObject.map { "\($0.provider.rawValue)\n\($0.providerAccountID)\n\($0.objectID)" }
        }, by: { $0 }).mapValues(\.count)
        let ordered = receipts.sorted { left, right in
            if left.plan.backupID != right.plan.backupID { return left.plan.backupID.uuidString < right.plan.backupID.uuidString }
            return left.plan.workspaceGeneration.uuidString < right.plan.workspaceGeneration.uuidString
        }
        var protected: [RemoteBackupProtectedReceipt] = [], eligible: [RemoteBackupUploadReceipt] = []
        for receipt in ordered {
            let reason: RemoteBackupRetentionProtection?
            if destination.retention.latestVerifiedCount == nil { reason = .keepAll }
            else if receipt.plan.workspaceGeneration != workspaceGeneration || receipt.plan.destination != destination { reason = .foreignContext }
            else if deletionClaims.contains(receipt.plan.backupID) { reason = .deletionClaimed }
            else if case .verified = receipt.outcome {
                if let object = receipt.remoteObject {
                    let key = "\(object.provider.rawValue)\n\(object.providerAccountID)\n\(object.objectID)"
                    if object.provider != destination.provider || object.providerAccountID != providerAccountID { reason = .foreignAccount }
                    else if counts[receipt.plan.backupID] != 1 || objects[key] != 1 { reason = .ambiguousIdentity }
                    else { reason = nil }
                } else { reason = .missingRemoteIdentity }
            } else { reason = .unverified }
            if let reason { protected.append(RemoteBackupProtectedReceipt(receipt: receipt, reason: reason)) }
            else { eligible.append(receipt) }
        }
        eligible.sort {
            guard case .verified(_, let left) = $0.outcome, case .verified(_, let right) = $1.outcome else { return false }
            if left != right { return left > right }
            return $0.plan.backupID.uuidString < $1.plan.backupID.uuidString
        }
        let clockReview = eligible.contains { if case .verified(_, let date) = $0.outcome { return date > now || date.timeIntervalSince1970 < 0 }; return false }
        if clockReview {
            candidates = []
            protected += eligible.map { RemoteBackupProtectedReceipt(receipt: $0, reason: .clockReview) }
        } else {
            let keep = destination.retention.latestVerifiedCount ?? eligible.count
            candidates = Array(eligible.dropFirst(keep))
            protected += eligible.prefix(keep).map { RemoteBackupProtectedReceipt(receipt: $0, reason: .newestVerified) }
        }
        self.protected = protected
    }
}

public protocol RemoteBackupDeletionTransport: Sendable {
    /// Delete only when the provider's current object revision still equals the
    /// independently verified revision retained in the candidate receipt.
    func deleteIfRevisionMatches(candidate: RemoteBackupUploadReceipt) async throws -> RemoteBackupVerifiedObject
}

public enum RemoteBackupDeletionError: Error, Equatable, Sendable {
    /// A request may have reached the provider. The durable claim prevents replay.
    case executionUncertain
}

public struct RemoteBackupDeletionReceipt: Equatable, Sendable {
    public let candidate: RemoteBackupUploadReceipt
    public let remoteObject: RemoteBackupVerifiedObject
    public let deletedAt: Date

    public init(candidate: RemoteBackupUploadReceipt, remoteObject: RemoteBackupVerifiedObject,
                deletedAt: Date) throws {
        guard candidate.remoteObject == remoteObject,
              case .verified(let package, _) = candidate.outcome,
              package == candidate.plan.package,
              deletedAt.timeIntervalSince1970.isFinite, deletedAt.timeIntervalSince1970 >= 0 else {
            throw RemoteBackupPlanningError.invalidReceipt
        }
        self.candidate = candidate; self.remoteObject = remoteObject; self.deletedAt = deletedAt
    }
}

/// One durable, non-replayable deletion claim per backup ID. The marker is
/// written before transport. A crash, cancellation or lost reply therefore remains
/// uncertain and protected from a second delete attempt.
public actor RemoteBackupDeletionCoordinator {
    private let store: RemoteBackupOperationStore

    public init(stateDirectory: URL) throws {
        store = try RemoteBackupOperationStore(directory: stateDirectory)
    }

    public static func claimedBackupIDs(stateDirectory: URL) throws -> Set<UUID> {
        Set(try RemoteBackupUploadCoordinator.persistedReceipts(stateDirectory: stateDirectory)
            .map(\.plan.backupID))
    }

    public func delete(candidate: RemoteBackupUploadReceipt, workspaceGeneration: UUID,
                       destination: RemoteBackupDestination,
                       transport: any RemoteBackupDeletionTransport,
                       at now: Date = Date()) async throws -> RemoteBackupDeletionReceipt {
        try candidate.plan.validate(workspaceGeneration: workspaceGeneration, destination: destination)
        guard case .verified(let package, _) = candidate.outcome, package == candidate.plan.package,
              let expected = candidate.remoteObject, expected.provider == destination.provider else {
            throw RemoteBackupPlanningError.invalidReceipt
        }
        try Task.checkCancellation()
        if try store.reserve(plan: candidate.plan) != nil {
            throw RemoteBackupExecutionError.operationInProgress
        }
        do {
            let observed = try await transport.deleteIfRevisionMatches(candidate: candidate)
            guard observed == expected else { throw RemoteBackupPlanningError.invalidReceipt }
            let receipt = try RemoteBackupDeletionReceipt(candidate: candidate,
                remoteObject: observed, deletedAt: now)
            try store.complete(candidate)
            return receipt
        } catch {
            // The preflight claim remains durable. Never replay an ambiguous delete.
            throw RemoteBackupDeletionError.executionUncertain
        }
    }
}

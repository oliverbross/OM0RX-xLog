import Foundation

/// One exact contest row captured in a revision-bound normal-log transfer manifest.
/// `sourcePayload` is the canonical JSON received from the contest owner; it is
/// retained for provenance and conflict review and never used as semantic identity.
public struct ContestLogTransferItem: Codable, Hashable, Sendable {
    public let qsoID: UUID
    public let sourceDigest: String
    public let sourcePayload: Data
    public let qso: QSO

    public init(qsoID: UUID, sourceDigest: String, sourcePayload: Data, qso: QSO) {
        self.qsoID = qsoID
        self.sourceDigest = sourceDigest
        self.sourcePayload = sourcePayload
        self.qso = qso
    }
}

public struct ContestLogTransferManifest: Codable, Hashable, Sendable {
    public let id: UUID
    public let contestSessionID: UUID
    public let workspaceGeneration: UUID
    public let sourceRevision: Int64
    public let sourceDigest: String
    public let provenance: String
    public let createdAt: Date
    public let items: [ContestLogTransferItem]

    public init(id: UUID = UUID(), contestSessionID: UUID, workspaceGeneration: UUID,
                sourceRevision: Int64, sourceDigest: String, provenance: String,
                createdAt: Date = Date(), items: [ContestLogTransferItem]) {
        self.id = id
        self.contestSessionID = contestSessionID
        self.workspaceGeneration = workspaceGeneration
        self.sourceRevision = sourceRevision
        self.sourceDigest = sourceDigest
        self.provenance = provenance
        self.createdAt = createdAt
        self.items = items
    }
}

public struct ContestLogTransferReceipt: Codable, Hashable, Sendable {
    public let contestSessionID: UUID
    public let qsoID: UUID
    public let manifestID: UUID
    public let sourceRevision: Int64
    public let sourceDigest: String
    public let targetQSOID: UUID
    public let insertedAt: Date
}

public struct ContestLogTransferIssue: Codable, Hashable, Sendable {
    public let qsoID: UUID
    public let code: String
    public let message: String

    public init(qsoID: UUID, code: String, message: String) {
        self.qsoID = qsoID
        self.code = code
        self.message = message
    }
}

public struct ContestLogTransferResult: Codable, Hashable, Sendable {
    public let manifest: ContestLogTransferManifest
    public let inserted: [ContestLogTransferReceipt]
    public let alreadyTransferred: [ContestLogTransferReceipt]
    public let conflicts: [ContestLogTransferIssue]
    public let errors: [ContestLogTransferIssue]

    public init(manifest: ContestLogTransferManifest,
                inserted: [ContestLogTransferReceipt] = [],
                alreadyTransferred: [ContestLogTransferReceipt] = [],
                conflicts: [ContestLogTransferIssue] = [],
                errors: [ContestLogTransferIssue] = []) {
        self.manifest = manifest
        self.inserted = inserted
        self.alreadyTransferred = alreadyTransferred
        self.conflicts = conflicts
        self.errors = errors
    }
}

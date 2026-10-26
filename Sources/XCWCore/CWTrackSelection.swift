// Copyright © 2026 Oliver Bross OM0RX. SPDX-License-Identifier: GPL-3.0-only
import Foundation

/// A renderer may identify retained evidence, never supply a callsign or RF
/// target. Resolving this reference is passive and grants no operating action.
public struct CWTrackReference: Codable, Equatable, Sendable {
    public let sessionID: UUID
    public let sourceID: UUID
    public let streamToken: UUID
    public let epoch: String
    public let trackID: UUID
    public let revision: String
    public let selectionID: UUID
}

public struct CWTrackSelection: Encodable, Equatable, Sendable {
    public let reference: CWTrackReference
    public let callsign: String
}

public struct CWResolvedTrackSelection: Encodable, Equatable, Sendable {
    public let reference: CWTrackReference
    public let callsign: String
    public let radioID: String
    public let provider: CWProvider
    public let frequencyHz: Int64?
}

public enum CWTrackSelectionError: Error, Equatable {
    case staleEvidence, frequencyUnqualified
}

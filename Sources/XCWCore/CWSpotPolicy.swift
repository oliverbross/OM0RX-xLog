// Copyright © 2026 Oliver Bross OM0RX. SPDX-License-Identifier: GPL-3.0-only
import Foundation

public enum CWSpotRejection: String, Codable, Sendable {
    case unqualifiedQuality = "quality_not_qualified", replay, staleSource = "stale_source", unmappedFrequency = "unmapped_frequency"
    case contaminated, ambiguous, insufficientOccurrences = "insufficient_occurrences", cooldown, invalidEvidence = "invalid_evidence"
}
public struct CWConfirmedSpot: Codable, Hashable, Sendable, Identifiable {
    public let id: UUID
    public let sessionID: UUID
    public let sourceID: UUID
    public let radioID: String
    public let provider: CWProvider
    public let receiverID: String
    public let streamToken: UUID
    public let epoch: String
    public let trackID: UUID
    public let callsign: String
    public let frequencyHz: Int64
    public let observedAt: Date
    public let occurrenceRanges: [String]
    public let policyVersion: Int
    public let originInstanceID: UUID
    public let modelSHA256: String
    public var sourceKind: String { "local_cw" }
    public func validateProvenance() throws {
        guard ["radio1","radio2"].contains(radioID),provider != .replay,
              !receiverID.isEmpty,receiverID.utf8.count<=128,
              let number=UInt64(epoch),String(number)==epoch,
              policyVersion==1,modelSHA256==CWSpotPolicy.modelSHA256,
              CWTransmittingIdentity.plausible(callsign),(100_000...1_000_000_000).contains(frequencyHz),
              observedAt.timeIntervalSince1970.isFinite,(2...8).contains(occurrenceRanges.count) else {throw CWContractError.invalidSamples}
        var end:UInt64=0
        for range in occurrenceRanges {
            let pieces=range.split(separator:":",omittingEmptySubsequences:false)
            guard pieces.count==2,let first=UInt64(pieces[0]),let next=UInt64(pieces[1]),
                  String(first)==pieces[0],String(next)==pieces[1],first>=end,first<next else {throw CWContractError.invalidSamples}
            end=next
        }
    }
}

public struct CWSpotDecision: Sendable {
    public let spot: CWConfirmedSpot?
    public let rejection: CWSpotRejection?
}

/// Production begins unqualified. This flag is not an operator preference and
/// must not be exposed as an API override: G4 requires a held-out scorecard.
public struct CWSpotPolicy: Sendable {
    public static let modelSHA256="ef120799457bca042d4690944f0faf93268eb4654e7f50f28784ad63bdc1fe02"
    private let qualityQualified: Bool
    private let origin: UUID
    private struct Emitted: Sendable { let call:String; let source:UUID; let hz:Int64; let at:UInt64 }
    private var emitted:[Emitted]=[]
    public init(origin: UUID = UUID()) { self.origin=origin; self.qualityQualified=false }
    // Internal for policy-unit fixtures only. No worker/renderer input can enable it.
    init(qualifiedForTests: Bool, origin: UUID = UUID()) { self.origin=origin; qualityQualified=qualifiedForTests }

    public mutating func evaluate(descriptor d: CWStreamDescriptor, trackID: UUID, frequencyHz: Int64,
                                  occurrences: [CWIdentityOccurrence], channelSample: UInt64, latestSampleNS: UInt64,
                                  nowNS: UInt64, observedAt: Date, transmitting: Bool?, clean: Bool,
                                  ambiguous: Bool) -> CWSpotDecision {
        func reject(_ reason:CWSpotRejection) -> CWSpotDecision { CWSpotDecision(spot:nil,rejection:reason) }
        guard !d.replay, d.provider != .replay else { return reject(.replay) }
        guard d.mappingQualified, d.spectralSign != nil, (d.usableLowerHz...d.usableUpperHz).contains(frequencyHz) else { return reject(.unmappedFrequency) }
        guard nowNS >= latestSampleNS, nowNS - latestSampleNS <= 2_000_000_000 else { return reject(.staleSource) }
        guard transmitting == false, clean else { return reject(.contaminated) }
        guard !ambiguous else { return reject(.ambiguous) }
        guard !occurrences.isEmpty, occurrences.count <= 128,
              occurrences.allSatisfy({ CWTransmittingIdentity.plausible($0.callsign) && $0.firstSample < $0.endSample &&
                  ["de_self_identification","cq_self_identification"].contains($0.pattern) }) else { return reject(.invalidEvidence) }
        let newest=occurrences.map(\.endSample).max()!
        guard channelSample >= newest, channelSample-newest <= 60*3200 else { return reject(.staleSource) }
        let evidence=occurrences.filter{channelSample >= $0.firstSample && channelSample-$0.firstSample <= 60*3200}
        let calls=Set(evidence.map(\.callsign))
        guard calls.count == 1, let call=calls.first else { return reject(.ambiguous) }
        var distinct:[CWIdentityOccurrence]=[]
        for item in evidence.sorted(by:{$0.firstSample<$1.firstSample}) {
            if distinct.last.map({$0.endSample <= item.firstSample}) ?? true { distinct.append(item) }
        }
        guard distinct.count>=2 else { return reject(.insufficientOccurrences) }
        guard qualityQualified else { return reject(.unqualifiedQuality) }
        emitted.removeAll{nowNS < $0.at || nowNS-$0.at >= 120_000_000_000}
        guard !emitted.contains(where:{$0.call==call && $0.source==d.sourceID && abs($0.hz-frequencyHz)<=100}) else { return reject(.cooldown) }
        if emitted.count>=1024 { emitted.removeFirst() }
        emitted.append(Emitted(call:call,source:d.sourceID,hz:frequencyHz,at:nowNS))
        let spot=CWConfirmedSpot(id:UUID(),sessionID:d.sessionID,sourceID:d.sourceID,radioID:d.radioID,provider:d.provider,
            receiverID:d.receiverID,streamToken:d.streamToken,epoch:d.epoch,trackID:trackID,callsign:call,
            frequencyHz:frequencyHz,observedAt:observedAt,
            occurrenceRanges:distinct.suffix(8).map{"\($0.firstSample):\($0.endSample)"},policyVersion:1,originInstanceID:origin,
            modelSHA256:Self.modelSHA256)
        return CWSpotDecision(spot:spot,rejection:nil)
    }
}

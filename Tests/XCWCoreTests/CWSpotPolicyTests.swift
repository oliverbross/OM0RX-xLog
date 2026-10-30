// Copyright © 2026 Oliver Bross OM0RX. SPDX-License-Identifier: GPL-3.0-only
import XCTest
@testable import XCWCore

final class CWSpotPolicyTests: XCTestCase {
    private func descriptor(replay: Bool = false, mapping: Bool = true) throws -> CWStreamDescriptor {
        try CWStreamDescriptor(sessionID:UUID(),sourceID:UUID(),radioID:"radio1",provider:replay ? .replay : .tciIQ,
                               receiverID:"0",epoch:"1",centreHz:14_025_000,sampleRate:96_000,spectralSign:1,
                               usableLowerHz:13_985_000,usableUpperHz:14_065_000,mappingQualified:mapping,replay:replay)
    }
    private func tokens(_ text:String,first:UInt64 = 0) throws -> [CWAlignedToken] {
        try text.enumerated().map{try CWAlignedToken(symbol:String($0.element),firstSample:first+UInt64($0.offset)*160,
                                                     endSample:first+UInt64($0.offset)*160+80)}
    }
    private func evaluate(_ policy:inout CWSpotPolicy,_ d:CWStreamDescriptor,_ calls:[CWIdentityOccurrence],
                          hz:Int64 = 14_025_000,now:UInt64 = 1_000_000_000,latest:UInt64 = 1_000_000_000,
                          tx:Bool? = false,clean:Bool = true,ambiguous:Bool = false,fixtureRF:Bool=true) -> CWSpotDecision {
        let observed=calls.map{CWIdentityOccurrence(callsign:$0.callsign,firstSample:$0.firstSample,endSample:$0.endSample,pattern:$0.pattern,
            rfObservation:fixtureRF ? try? CWCarrierObservation(offsetHz:Double(hz-d.centreHz)/Double(d.spectralSign ?? 1),sample:$0.endSample):$0.rfObservation)}
        return policy.evaluate(descriptor:d,trackID:UUID(),frequencyHz:hz,occurrences:observed,
                        channelSample:calls.map(\.endSample).max() ?? 0,latestSampleNS:latest,
                        nowNS:now,observedAt:Date(timeIntervalSince1970:0),transmitting:tx,clean:clean,ambiguous:ambiguous)
    }
    func testOnlyTransmittingPatternsAndCompletedCallsBecomeOccurrences() throws {
        XCTAssertEqual(CWTransmittingIdentity.occurrences(in:try tokens("CQ CQ DE OM0RX OM0RX K ")).map(\.callsign),["OM0RX","OM0RX"])
        XCTAssertEqual(CWTransmittingIdentity.occurrences(in:try tokens("K1ABC DE OM0RX ")).map(\.callsign),["OM0RX"])
        XCTAssertTrue(CWTransmittingIdentity.occurrences(in:try tokens("K1ABC 5NN 001 ")).isEmpty)
        XCTAssertTrue(CWTransmittingIdentity.occurrences(in:try tokens("CQ OM0R? ")).isEmpty)
        XCTAssertTrue(CWTransmittingIdentity.occurrences(in:try tokens("CQ OM0RX")).isEmpty)
        for call in ["EA8/OM0RX/P","3DA0WW","GB100RSGB","N0A"] { XCTAssertTrue(CWTransmittingIdentity.plausible(call)) }
        for call in ["599","DX","OM0R?","/OM0RX","OM0RX//P"] { XCTAssertFalse(CWTransmittingIdentity.plausible(call)) }
    }
    func testTwoSelfIDsNeedTheirOwnPastCarrierEvidence() throws {
        let d=try descriptor(),calls=CWTransmittingIdentity.occurrences(in:try tokens("CQ OM0RX OM0RX "))
        var policy=CWSpotPolicy(qualifiedForTests:true)
        XCTAssertEqual(evaluate(&policy,d,calls,fixtureRF:false).rejection,.frequencyEvidenceUnavailable)
        let invalid=calls.map{CWIdentityOccurrence(callsign:$0.callsign,firstSample:$0.firstSample,endSample:$0.endSample,pattern:$0.pattern,
            rfObservation:try! CWCarrierObservation(offsetHz:0,sample:$0.endSample+1))}
        XCTAssertEqual(evaluate(&policy,d,invalid,fixtureRF:false).rejection,.frequencyEvidenceUnavailable)
        let valid=calls.map{CWIdentityOccurrence(callsign:$0.callsign,firstSample:$0.firstSample,endSample:$0.endSample,pattern:$0.pattern,
            rfObservation:try! CWCarrierObservation(offsetHz:600,sample:$0.endSample))}
        XCTAssertEqual(evaluate(&policy,d,valid,fixtureRF:false).rejection,.invalidEvidence,"The current window's frequency cannot replace the measured self-ID frequency")
    }
    func testRepeatedInferenceDoesNotSupplyDistinctTransmissions() throws {
        let d=try descriptor(), one=CWTransmittingIdentity.occurrences(in:try tokens("CQ OM0RX "))
        var policy=CWSpotPolicy(qualifiedForTests:true)
        XCTAssertEqual(evaluate(&policy,d,one+one+one).rejection,.insufficientOccurrences)
        let real=CWTransmittingIdentity.occurrences(in:try tokens("CQ OM0RX OM0RX "))
        XCTAssertNotNil(evaluate(&policy,d,real).spot)
        XCTAssertEqual(evaluate(&policy,d,real,hz:14_025_090).rejection,.cooldown)
        XCTAssertNotNil(evaluate(&policy,d,real,hz:14_026_000).spot)
        XCTAssertNotNil(evaluate(&policy,try descriptor(),real).spot) // another source keeps provenance
    }
    func testDistinctDESelfIDsSurviveSeparateOversAndEarlierStationsRemainAmbiguous() throws {
        let repeated=CWTransmittingIdentity.occurrences(in:try tokens("K1ABC DE OM0RX K K1ABC DE OM0RX K "))
        XCTAssertEqual(repeated.map(\.callsign),["OM0RX","OM0RX"])
        var policy=CWSpotPolicy(qualifiedForTests:true)
        XCTAssertNotNil(evaluate(&policy,try descriptor(),repeated).spot)
        let samePhrase=CWTransmittingIdentity.occurrences(in:try tokens("CQ K1ABC DE OM0RX OM0RX K "))
        XCTAssertEqual(samePhrase.map(\.callsign),["OM0RX","OM0RX"])
        let separate=CWTransmittingIdentity.occurrences(in:try tokens("CQ K1ABC K DE OM0RX OM0RX K "))
        XCTAssertEqual(separate.map(\.callsign),["K1ABC","OM0RX","OM0RX"])
        XCTAssertEqual(evaluate(&policy,try descriptor(),separate).rejection,.ambiguous)
        let paused=CWTransmittingIdentity.occurrences(in:try tokens("CQ K1ABC ")+tokens("DE OM0RX OM0RX K ",first:10000))
        XCTAssertEqual(paused.map(\.callsign),["K1ABC","OM0RX","OM0RX"])
        XCTAssertEqual(evaluate(&policy,try descriptor(),paused).rejection,.ambiguous)
        XCTAssertEqual(CWTransmittingIdentity.occurrences(in:try tokens("CQ OM0RX AR K1ABC ")).map(\.callsign),["OM0RX"])
    }
    func testOverlappingAlternativeRangesCannotCreateTwoSelfIDs() throws {
        let alternatives=[(UInt64(0),UInt64(100)),(0,200),(150,250)].map{
            CWIdentityOccurrence(callsign:"OM0RX",firstSample:$0.0,endSample:$0.1,pattern:"de_self_identification")
        }
        var policy=CWSpotPolicy(qualifiedForTests:true)
        XCTAssertEqual(evaluate(&policy,try descriptor(),alternatives).rejection,.insufficientOccurrences)
    }
    func testProductionQualityGateAndAllDestinationFences() throws {
        let d=try descriptor(), calls=CWTransmittingIdentity.occurrences(in:try tokens("CQ OM0RX OM0RX "))
        var production=CWSpotPolicy()
        XCTAssertEqual(evaluate(&production,d,calls).rejection,.unqualifiedQuality)
        var fixture=CWSpotPolicy(qualifiedForTests:true)
        XCTAssertEqual(evaluate(&fixture,try descriptor(replay:true),calls).rejection,.replay)
        XCTAssertEqual(evaluate(&fixture,try descriptor(mapping:false),calls).rejection,.unmappedFrequency)
        XCTAssertEqual(evaluate(&fixture,d,calls,now:4_000_000_001).rejection,.staleSource)
        XCTAssertEqual(evaluate(&fixture,d,calls,tx:true).rejection,.contaminated)
        XCTAssertEqual(evaluate(&fixture,d,calls,tx:nil).rejection,.contaminated)
        XCTAssertEqual(evaluate(&fixture,d,calls,clean:false).rejection,.contaminated)
        XCTAssertEqual(evaluate(&fixture,d,calls,ambiguous:true).rejection,.ambiguous)
        let conflict=CWTransmittingIdentity.occurrences(in:try tokens("CQ OM0RX DL1ABC "))
        XCTAssertEqual(evaluate(&fixture,d,conflict).rejection,.ambiguous)
    }
    func testCommittedTextRequiresAlignedAgreementAndLeavesTailProvisional() throws {
        var reconciler=CWTranscriptReconciler()
        let copy=try tokens("CQ OM0RX OM0RX K ",first:4000)
        let first=try reconciler.process(copy,firstSample:0,endSample:19200)
        XCTAssertTrue(first.committed.isEmpty); XCTAssertEqual(first.provisional,copy)
        let second=try reconciler.process(copy,firstSample:3200,endSample:22400)
        XCTAssertEqual(second.newCommitted,copy)
        XCTAssertEqual(CWTransmittingIdentity.occurrences(in:second.committed).count,2)
        let third=try reconciler.process(copy,firstSample:3200,endSample:25600)
        XCTAssertTrue(third.newCommitted.isEmpty)
        let changed=try tokens("CQ OM0RZ OM0RX K ",first:4000)
        XCTAssertTrue(try reconciler.process(changed,firstSample:3200,endSample:28800).ambiguous)
        reconciler.reset()
        XCTAssertTrue(try reconciler.process(copy,firstSample:0,endSample:19200).committed.isEmpty)
    }
}

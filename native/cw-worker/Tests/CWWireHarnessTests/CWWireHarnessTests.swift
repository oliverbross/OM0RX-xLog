// Copyright © 2026 Oliver Bross OM0RX. SPDX-License-Identifier: GPL-3.0-only
import Foundation
import XCTest
import XCWCore

final class CWWireHarnessTests:XCTestCase {
    private let token=UUID(uuidString:"00112233-4455-6677-8899-aabbccddeeff")!
    private func descriptor() throws -> CWStreamDescriptor {
        try CWStreamDescriptor(sessionID:UUID(),sourceID:UUID(),radioID:"radio2",provider:.replay,receiverID:"1",
            streamToken:token,epoch:"17",centreHz:14025000,sampleRate:96000,spectralSign:-1,
            usableLowerHz:14015000,usableUpperHz:14045000,replay:true)
    }
    private func le(_ data:Data,_ offset:Int,_ count:Int) -> UInt64 {
        (0..<count).reduce(0){$0|UInt64(data[offset+$1])<<($1*8)}
    }
    func testOpenUsesExplicitLEMetadataAndInverseRFOrientation() throws {
        let frame=try CWComputeWire.open(descriptor())
        XCTAssertEqual(String(decoding:frame.prefix(4),as:UTF8.self),"XCW1")
        XCTAssertEqual(le(frame,4,4),72);XCTAssertEqual(le(frame,8,2),1);XCTAssertEqual(le(frame,10,2),1)
        XCTAssertEqual(frame.subdata(in:12..<28),Data([0,17,34,51,68,85,102,119,136,153,170,187,204,221,238,255]))
        XCTAssertEqual(le(frame,28,8),17);XCTAssertEqual(le(frame,52,4),96000)
        XCTAssertEqual(Double(bitPattern:le(frame,60,8)),-20000)
        XCTAssertEqual(Double(bitPattern:le(frame,68,8)),10000);XCTAssertEqual(le(frame,76,4),1)
    }
    func testIQCountIsComplexAndDurationIsBounded() throws {
        let d=try descriptor()
        let block=try CWIQBlock(descriptor:d,sequence:9,firstSample:200,receivedMonotonicNS:1,samples:[0.5,-1,0.25,-0.75])
        let frame=try CWComputeWire.iq(block)
        XCTAssertEqual(le(frame,4,4),68);XCTAssertEqual(le(frame,10,2),5)
        XCTAssertEqual(le(frame,36,8),9);XCTAssertEqual(le(frame,44,8),200);XCTAssertEqual(le(frame,56,4),2)
        XCTAssertEqual(Float(bitPattern:UInt32(le(frame,60,4))),0.5)
        XCTAssertEqual(Float(bitPattern:UInt32(le(frame,64,4))),-1)
        let oversize=try CWIQBlock(descriptor:d,sequence:0,firstSample:0,receivedMonotonicNS:0,samples:Array(repeating:0,count:24002))
        XCTAssertThrowsError(try CWComputeWire.iq(oversize))
        XCTAssertEqual(le(try CWComputeWire.end(d,gap:true),10,2),6)
        XCTAssertEqual(le(CWComputeWire.stop(),10,2),4)
        XCTAssertEqual(le(CWComputeWire.metrics(sequence:UInt64.max),36,8),UInt64.max)
    }
    func testMuteFrameCarriesOnlyCaptureAndTrackIdentity() throws {
        let track=UUID(uuidString:"01234567-89ab-cdef-0123-456789abcdef")!
        let frame=try CWComputeWire.mute(descriptor(),trackID:track)
        XCTAssertEqual(le(frame,4,4),68);XCTAssertEqual(le(frame,10,2),8);XCTAssertEqual(le(frame,28,8),17)
        XCTAssertEqual(le(frame,36,8),0);XCTAssertEqual(le(frame,44,8),0);XCTAssertEqual(le(frame,52,4),0);XCTAssertEqual(le(frame,56,4),0)
        XCTAssertEqual(frame.subdata(in:60..<76),Data([1,35,69,103,137,171,205,239,1,35,69,103,137,171,205,239]))
    }
    func testFocusFramesCarryCaptureTrackRevisionOrExactEmptyClear() throws {
        let track=UUID(uuidString:"01234567-89ab-cdef-0123-456789abcdef")!
        let frame=try CWComputeWire.focus(descriptor(),trackID:track,revision:UInt64.max)
        XCTAssertEqual(le(frame,4,4),68);XCTAssertEqual(le(frame,10,2),9);XCTAssertEqual(le(frame,28,8),17)
        XCTAssertEqual(le(frame,36,8),UInt64.max);XCTAssertEqual(le(frame,44,8),0);XCTAssertEqual(le(frame,52,4),0);XCTAssertEqual(le(frame,56,4),0)
        let clear=CWComputeWire.clearFocus();XCTAssertEqual(le(clear,4,4),52);XCTAssertEqual(le(clear,10,2),10)
        XCTAssertTrue(clear.dropFirst(12).allSatisfy{$0==0})
    }
    private func decode() -> [String:Any] {
        ["type":"decode","stream_token":"00112233445566778899aabbccddeeff","epoch":"17", "track_id":token.uuidString.lowercased(),
         "state":"provisional","first_sample":"0","end_sample":"19200","source_first_sample":"8192","filter_delay_seconds":0.02,
         "track_revision":"0","offset_hz":-4100.0,"ambiguous":false,"replay":true,"text":"A ","inference_ms":100.0,
         "tokens":[["symbol":"A","first_sample":"100","end_sample":"148","log_score":-0.2],
                   ["symbol":" ","first_sample":"19200","end_sample":"19200","log_score":-0.1]]]
    }
    private func event(_ value:[String:Any]) throws -> CWComputeEvent { try CWComputeWire.event(JSONSerialization.data(withJSONObject:value)) }
    func testDecodePreservesRawTextButPaddingCannotBecomeAnOccurrence() throws {
        guard case .decode(let value)=try event(decode()) else { return XCTFail("Expected decode") }
        XCTAssertEqual(value.text,"A ");XCTAssertEqual(value.track.epoch,17);XCTAssertTrue(value.track.replay)
        XCTAssertEqual(value.tokens.compactMap(\.aligned).map(\.symbol),["A"])
    }
    func testWrongShapesAndLossyCountersFailClosed() throws {
        for (key,value):(String,Any) in [("extra",1),("epoch",17),("epoch","017"),("epoch","18446744073709551616"),
                                       ("replay",1),("offset_hz",true),("text","A\n"),("state","retired"),("stream_token","bad")] {
            var record=decode();record[key]=value
            XCTAssertThrowsError(try event(record),key)
        }
        var record=decode();record["tokens"]=[["symbol":"A","first_sample":"100","end_sample":"99","log_score":-0.2]]
        XCTAssertThrowsError(try event(record))
        XCTAssertThrowsError(try CWComputeWire.event(Data(repeating:32,count:131073)))
    }
    func testSignalEstimatesRequireFiniteValuesAndExplicitNoiseBandwidth() throws {
        var record=decode();record["estimated_wpm"]=24.5;record["estimated_snr_db"]=12.0;record["snr_reference_hz"]=2500
        guard case .decode(let value)=try event(record) else{return XCTFail("Expected decode")}
        XCTAssertEqual(value.estimatedWPM,24.5);XCTAssertEqual(value.estimatedSNRDB,12);XCTAssertEqual(value.snrReferenceHz,2500)
        for (key,bad):(String,Any) in [("estimated_wpm",true),("estimated_wpm",81),("estimated_snr_db",151),("snr_reference_hz",500)] {
            var invalid=record;invalid[key]=bad;XCTAssertThrowsError(try event(invalid))
        }
        record.removeValue(forKey:"snr_reference_hz");XCTAssertThrowsError(try event(record))
        let noMeasurement=try event(decode())
        guard case .decode(let missing)=noMeasurement else{return XCTFail("Expected decode")}
        XCTAssertNil(missing.estimatedWPM);XCTAssertNil(missing.estimatedSNRDB)
    }
    func testReadyAndMetricsUseBoundedTypes() throws {
        let ready:[String:Any]=["type":"ready","protocol_version":1,"sample_rate":3200,"max_spans":2,"max_tracks_per_span":16,
                                "inference_workers":2,"runtime_version":"1.24.3"]
        guard case .ready(let runtime)=try event(ready) else { return XCTFail("Expected ready") }
        XCTAssertEqual(runtime,"1.24.3")
        var bad=ready;bad["protocol_version"]=true;XCTAssertThrowsError(try event(bad))
        let metrics:[String:Any]=["type":"status","request_sequence":"18446744073709551615","sources":2,"tracks":32,"pending":32,
                                  "in_flight":2,"coalesced":"4","dropped_events":"0"]
        guard case .metrics(let m)=try event(metrics) else { return XCTFail("Expected metrics") }
        XCTAssertEqual(m.requestSequence,UInt64.max);XCTAssertEqual(m.tracks,32)
    }
    func testTranscriptSampleMathDoesNotWrapAtUInt64Limit() throws {
        var transcript=CWTranscriptReconciler()
        let start=UInt64.max-19200
        let token=try CWAlignedToken(symbol:"A",firstSample:start+100,endSample:start+148)
        _ = try transcript.process([token],firstSample:start,endSample:UInt64.max-3200)
        _ = try transcript.process([token],firstSample:start,endSample:UInt64.max)
    }
}

// Copyright © 2026 Oliver Bross OM0RX. SPDX-License-Identifier: GPL-3.0-only
#if os(macOS)
import Foundation
import XCTest
@testable import XCWCore

/// Explicit diagnostic replay through the existing supervisor/child. No station,
/// database, policy-qualified calls, cluster listener or live destination exists.
final class CWRecordingReplayTests:XCTestCase {
    private func metrics(_ owner:CWComputeProcess,_ output:CWRecordingOutput,_ sequence:UInt64) async throws -> CWNativeMetrics {
        try await owner.metrics(sequence:sequence)
        for _ in 0..<400 {
            if let value=await output.metrics(sequence){return value}
            try await Task.sleep(nanoseconds:5_000_000)
        }
        throw CWComputeError.startupTimeout
    }
    func testOperatorRecordingOfflineDiagnostics() async throws {
        let env=ProcessInfo.processInfo.environment
        guard let path=env["XCW_REAL_IQ_MANIFEST"],let destination=env["XCW_REAL_IQ_OUTPUT"] else{throw XCTSkip("Provide an explicit private IQ import manifest and fresh diagnostic output.")}
        var root=URL(fileURLWithPath:#filePath);for _ in 0..<5{root.deleteLastPathComponent()}
        let privateRoot=root.appendingPathComponent(".build",isDirectory:true).path+"/"
        let manifestURL=URL(fileURLWithPath:path).standardizedFileURL,outputURL=URL(fileURLWithPath:destination).standardizedFileURL
        guard path.hasPrefix(privateRoot),manifestURL.path==path,manifestURL.resolvingSymlinksInPath()==manifestURL,
              destination.hasPrefix(privateRoot),outputURL.path==destination,
              outputURL.deletingLastPathComponent().resolvingSymlinksInPath()==outputURL.deletingLastPathComponent(),
              !FileManager.default.fileExists(atPath:destination) else{throw CWComputeError.resourceValidation}
        let manifestSize=try XCTUnwrap(FileManager.default.attributesOfItem(atPath:path)[.size] as? NSNumber).uint64Value
        guard manifestSize>0,manifestSize<=2*1024*1024 else{throw CWComputeError.resourceValidation}
        let manifest=try XCTUnwrap(JSONSerialization.jsonObject(with:Data(contentsOf:manifestURL)) as? [String:Any])
        let hashes=try XCTUnwrap(manifest["files_sha256"] as? [String:String])
        let names=hashes.keys.filter{$0.hasSuffix(".sigmf-data")};guard names.count==1 else{throw CWComputeError.resourceValidation}
        let name=names[0];guard !name.contains("/"),!name.contains("..") else{throw CWComputeError.resourceValidation}
        let input=manifestURL.deletingLastPathComponent().appendingPathComponent(name)
        guard input.resolvingSymlinksInPath()==input,try CWComputeResources.digest(input,maximumBytes:64*1024*1024)==hashes[name] else{throw CWComputeError.resourceValidation}
        let byteCount=try XCTUnwrap(FileManager.default.attributesOfItem(atPath:input.path)[.size] as? NSNumber).uint64Value
        guard byteCount>0,byteCount%8==0 else{throw CWComputeError.invalidFrame}
        let metadata=try XCTUnwrap(manifest["metadata"] as? [String:Any]),global=try XCTUnwrap(metadata["global"] as? [String:Any])
        let captures=try XCTUnwrap(metadata["captures"] as? [[String:Any]])
        let rate=try XCTUnwrap(global["core:sample_rate"] as? Int),centre=try XCTUnwrap(captures.first?["core:frequency"] as? Int64)
        guard global["core:datatype"] as? String=="cf32_le",[48000,96000,192000].contains(rate),
              captures.count==1,captures[0]["core:sample_start"] as? Int==0,
              UInt32(littleEndian:0x01020304)==0x01020304 else{throw CWComputeError.resourceValidation}
        let descriptor=try CWStreamDescriptor(sessionID:UUID(),sourceID:UUID(),radioID:"radio2",provider:.replay,receiverID:"file",epoch:"1",
            centreHz:centre,sampleRate:rate,spectralSign:nil,usableLowerHz:centre-Int64(rate/2),usableUpperHz:centre+Int64(rate/2),mappingQualified:false,replay:true)
        let owner=CWComputeProcess(),output=CWRecordingOutput(),resources=try cwHarnessResources()
        let stream=try await owner.start(resources:resources)
        let pump=Task{do{for try await event in stream{await output.record(event)}}catch{await output.failed(String(describing:error))}}
        var first:UInt64=0,sequence:UInt64=0,request:UInt64=1,failure:String?
        let started=DispatchTime.now().uptimeNanoseconds
        do {
            for _ in 0..<500 {if await owner.snapshot().state=="ready"{break};try await Task.sleep(nanoseconds:10_000_000)}
            try await owner.open(descriptor)
            let file=try FileHandle(forReadingFrom:input);defer{try? file.close()}
            while let data=try file.read(upToCount:min(8192,rate/16)*8),!data.isEmpty {
                guard data.count%8==0,DispatchTime.now().uptimeNanoseconds-started<180_000_000_000 else{throw CWComputeError.invalidFrame}
                var samples=[Float](repeating:0,count:data.count/4)
                samples.withUnsafeMutableBytes{target in data.withUnsafeBytes{target.copyMemory(from:$0)}}
                try await owner.send(CWIQBlock(descriptor:descriptor,sequence:sequence,firstSample:first,receivedMonotonicNS:DispatchTime.now().uptimeNanoseconds,samples:samples))
                first+=UInt64(samples.count/2);sequence+=1
                // Correctness replay: service every pending window before the
                // next input. This is explicitly not a real-rate capacity test.
                let deadline=DispatchTime.now().uptimeNanoseconds+30_000_000_000
                while true {
                    let value=try await metrics(owner,output,request);request+=1
                    if value.pending==0,value.inFlight==0{break}
                    guard DispatchTime.now().uptimeNanoseconds<deadline else{throw CWComputeError.startupTimeout}
                    try await Task.sleep(nanoseconds:5_000_000)
                }
            }
        } catch{failure=String(describing:error)}
        await owner.stop();await pump.value
        var report=await output.report()
        if let eventFailure=report["event_failure"] as? String{failure=failure ?? eventFailure}
        if first != byteCount/8{failure=failure ?? "Recording was not completely delivered"}
        report["input_sha256"]=hashes[name];report["input_complex_frames"]=String(first);report["input_sample_rate"]=rate
        report["input_centre_hz_metadata"]=centre;report["input_capture_metadata"]=captures
        report["input_preprocessing"]=manifest["preprocessing"] ?? NSNull()
        report["replay_mode"]="offline_flow_controlled_no_rate_claim";report["rf_mapping_qualified"]=false
        report["quality_qualified"]=false;report["latency_qualified"]=false;report["independent_morse_annotations"]=false
        report["acquisition_continuity_verified"]=false;report["rf_orientation_verified"]=false
        report["model_sha256"]=try CWComputeResources.digest(resources.model,maximumBytes:32*1024*1024)
        report["native_sha256"]=try CWComputeResources.digest(resources.executable,maximumBytes:32*1024*1024)
        report["elapsed_seconds"]=Double(DispatchTime.now().uptimeNanoseconds-started)/1e9
        report["status"]=failure==nil ? "completed_unqualified_recording_replay":"incomplete"
        if let failure{report["failure"]=failure}
        let bytes=try JSONSerialization.data(withJSONObject:report,options:[.prettyPrinted,.sortedKeys])
        guard bytes.count<=16*1024*1024 else{throw CWComputeError.outputOverflow}
        try bytes.write(to:outputURL,options:.withoutOverwriting)
        try FileManager.default.setAttributes([.posixPermissions:0o600],ofItemAtPath:destination)
        XCTAssertNil(failure);XCTAssertGreaterThan(first,0)
        let allReplay=await output.allReplay;XCTAssertTrue(allReplay)
        print("Operator recording diagnostic: \(first) complex samples; \(destination)")
    }
}
private actor CWRecordingOutput {
    private var latest:CWNativeMetrics?,rows:[[String:Any]]=[],error:String?
    private var decoded=0,discardedRows=0
    private(set) var allReplay=true
    func failed(_ value:String){error=value}
    func metrics(_ sequence:UInt64)->CWNativeMetrics?{latest?.requestSequence==sequence ? latest:nil}
    func record(_ event:CWComputeEvent) {
        switch event {
        case .metrics(let value):latest=value
        case .track(let value):allReplay = allReplay && value.replay
        case .decode(let value):
            allReplay = allReplay && value.track.replay;decoded+=1
            guard rows.count<1024 else{discardedRows+=1;return}
            rows.append(["track_id":value.track.trackID,"revision":String(value.track.revision),"offset_hz_i_plus_jq":value.track.offsetHz,
                "window_first_sample":String(value.track.firstSample),"window_end_sample":String(value.track.endSample),
                "source_first_sample":String(value.track.sourceFirstSample),"text_provisional":value.text,"ambiguous":value.track.ambiguous,
                "wpm_estimate":value.estimatedWPM.map{$0 as Any} ?? NSNull(),"snr_db_estimate":value.estimatedSNRDB.map{$0 as Any} ?? NSNull(),
                "snr_reference_hz":value.snrReferenceHz.map{$0 as Any} ?? NSNull(),"model_run_ms":value.inferenceMilliseconds,
                "tokens_truncated":value.tokens.count>256,"tokens":value.tokens.prefix(256).map{["symbol":$0.symbol,"first":String($0.firstSample),"end":String($0.endSample),"raw_log_score":$0.logScore] as [String:Any]}])
        case .ready:break
        }
    }
    func report()->[String:Any] {
        var value:[String:Any]=["decode_events":decoded,"discarded_diagnostic_rows":discardedRows,"all_events_replay":allReplay,"rows":rows]
        if let error{value["event_failure"]=error}
        if let latest{value["last_native_metrics"]=["sources":latest.sources,"tracks":latest.tracks,"pending":latest.pending,"in_flight":latest.inFlight,"coalesced":String(latest.coalesced),"dropped_events":String(latest.droppedEvents)]}
        return value
    }
}
#endif

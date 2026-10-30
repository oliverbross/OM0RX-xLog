// Copyright © 2026 Oliver Bross OM0RX. SPDX-License-Identifier: GPL-3.0-only
#if os(macOS)
import Foundation
import XCTest
import XCWCore

final class CWComputeProcessTests:XCTestCase {
    private func resources(probe:Bool=false,badHash:Bool=false) throws -> CWComputeResources {
        var root=URL(fileURLWithPath:#filePath);for _ in 0..<5 {root.deleteLastPathComponent()}
        let binary=root.appendingPathComponent(probe ? ".build/cw-native/cw-process-probe":".build/cw-native/xlog-cw-worker")
        let runtime=URL(fileURLWithPath:ProcessInfo.processInfo.environment["XCW_TEST_RUNTIME"] ?? "/private/tmp/onnxruntime-osx-arm64-1.24.3/lib/libonnxruntime.1.24.3.dylib")
        guard FileManager.default.fileExists(atPath:binary.path),FileManager.default.fileExists(atPath:runtime.path) else {
            throw XCTSkip("Build native CW test executables and provide the pinned official runtime first.")
        }
        return CWComputeResources(executable:binary,model:root.appendingPathComponent("vendor/deepcw-engine/model.onnx"),runtime:runtime,
            executableSHA256:badHash ? String(repeating:"0",count:64):try CWComputeResources.digest(binary,maximumBytes:32*1024*1024),
            runtimeSHA256:"81b90223e770bfaea12783cb99370258387bae7ed70ff7e99f2717382800d217",runtimeVersion:"1.24.3")
    }
    private func source(_ receiver:String="0") throws -> CWStreamDescriptor {
        try CWStreamDescriptor(sessionID:UUID(),sourceID:UUID(),radioID:"radio2",provider:.replay,receiverID:receiver,epoch:"1",
            centreHz:14025000,sampleRate:96000,spectralSign:1,usableLowerHz:13986000,usableUpperHz:14064000,replay:true)
    }
    private func wait(iterations:Int=500,_ predicate:() async -> Bool) async throws {
        for _ in 0..<iterations {if await predicate(){return};try await Task.sleep(nanoseconds:10_000_000)}
        throw CWComputeError.startupTimeout
    }
    private func consume(_ stream:AsyncThrowingStream<CWComputeEvent,Error>,into collector:CWEventCollector) -> Task<Void,Never> {
        Task {do {for try await event in stream {await collector.record(event)}} catch {await collector.failed(error as? CWComputeError)}}
    }
    func testRealChildHandshakeTwoSourcesExactFramesAndScopedStop() async throws {
        let owner=CWComputeProcess(),events=CWEventCollector()
        let stream=try await owner.start(resources:resources()),pump=consume(stream,into:events)
        try await wait{await owner.snapshot().state=="ready"}
        let first=try source(),second=try source("1")
        try await owner.open(first);try await owner.open(second)
        let block=try CWIQBlock(descriptor:first,sequence:0,firstSample:0,receivedMonotonicNS:DispatchTime.now().uptimeNanoseconds,
                               samples:Array(repeating:0,count:4096))
        try await owner.send(block);try await owner.metrics(sequence:9)
        try await wait{await events.metrics(sequence:9)?.sources==2}
        // A nonexistent native target is a bounded no-op. Exact focus/clear
        // frames must keep the real child and both source leases alive.
        try await owner.focus(first,trackID:UUID(),revision:0)
        try await owner.focus(nil,trackID:nil,revision:0)
        try await owner.metrics(sequence:11)
        try await wait{await events.metrics(sequence:11)?.sources==2}
        await owner.end(first);try await owner.metrics(sequence:10)
        try await wait{await events.metrics(sequence:10)?.sources==1}
        let state=await owner.snapshot();XCTAssertEqual(state.sources,1);XCTAssertEqual(state.runtimeVersion,"1.24.3")
        await owner.stop();await pump.value
        let stopped=await owner.snapshot();XCTAssertEqual(stopped.state,"stopped");XCTAssertEqual(stopped.sources,0)
        XCTAssertEqual(stopped.queuedBytes,0)
    }
    func testStaleInputRetiresOnlyItsSource() async throws {
        let owner=CWComputeProcess(),events=CWEventCollector()
        let stream=try await owner.start(resources:resources()),pump=consume(stream,into:events)
        try await wait{await owner.snapshot().state=="ready"}
        let first=try source(),second=try source("1");try await owner.open(first);try await owner.open(second)
        let stale=try CWIQBlock(descriptor:first,sequence:0,firstSample:0,receivedMonotonicNS:DispatchTime.now().uptimeNanoseconds-300_000_000,samples:[0,0])
        do {try await owner.send(stale);XCTFail("Stale source must fail")} catch {}
        try await owner.metrics(sequence:42);try await wait{await events.metrics(sequence:42)?.sources==1}
        let state=await owner.snapshot();XCTAssertEqual(state.state,"ready");XCTAssertEqual(state.sources,1)
        await owner.stop();await pump.value
    }
    func testSwiftSupervisorDeliversRealNativeIQCopyWithoutLiveDestinations() async throws {
        let owner=CWComputeProcess(),events=CWEventCollector()
        let stream=try await owner.start(resources:resources()),pump=consume(stream,into:events)
        try await wait{await owner.snapshot().state=="ready"}
        var root=URL(fileURLWithPath:#filePath);for _ in 0..<5 {root.deleteLastPathComponent()}
        let file=try FileHandle(forReadingFrom:root.appendingPathComponent(".build/cw-fixtures/two-stations-96k.cf32"))
        defer {try? file.close()}
        let source=try source();try await owner.open(source)
        var sequence:UInt64=0,first:UInt64=0
        let started=DispatchTime.now().uptimeNanoseconds
        do {
            while let data=try file.read(upToCount:8192*8),!data.isEmpty {
                try await wait{await owner.snapshot().queuedBytes==0}
                let bytes=[UInt8](data)
                XCTAssertEqual(bytes.count%8,0)
                var samples:[Float]=[];samples.reserveCapacity(bytes.count/4)
                for at in stride(from:0,to:bytes.count,by:4) {
                    samples.append(Float(bitPattern:UInt32(bytes[at])|UInt32(bytes[at+1])<<8|UInt32(bytes[at+2])<<16|UInt32(bytes[at+3])<<24))
                }
                // This is continuous real-rate ingress, not accelerated exposure
                // without child flow control. Keep the original block deadline:
                // a delayed producer must still fail the 250-ms freshness guard.
                let end=first+UInt64(samples.count/2)
                let due=started+end*1_000_000_000/UInt64(source.sampleRate)
                let now=DispatchTime.now().uptimeNanoseconds
                if now<due{try await Task.sleep(nanoseconds:due-now)}
                try await owner.send(CWIQBlock(descriptor:source,sequence:sequence,firstSample:first,
                    receivedMonotonicNS:due,samples:samples))
                first+=UInt64(samples.count/2);sequence+=1
            }
            try await wait {
                let first=await events.hasCall("OM0RX",offset:6200),second=await events.hasCall("DL1ABC",offset:-4100)
                return first && second
            }
        } catch {await owner.stop();await pump.value;throw error}
        await owner.stop();await pump.value
        let state=await owner.snapshot();XCTAssertEqual(state.state,"stopped")
    }
    func testStopWhilePreparingIsIdempotentAndAllowsFreshChild() async throws {
        let owner=CWComputeProcess()
        let first=try await owner.start(resources:resources())
        async let a:Void=owner.stop();async let b:Void=owner.stop();_ = await(a,b)
        let stopped=await owner.snapshot();XCTAssertEqual(stopped.state,"stopped")
        let collector=CWEventCollector(),second=try await owner.start(resources:resources())
        let pump=consume(second,into:collector);try await wait{await owner.snapshot().state=="ready"}
        await owner.stop();await pump.value
        _ = first // retain the first stream through the restart to expose late callbacks
    }
    func testResourceMismatchNeverStartsChildAndUnexpectedExitIsIsolated() async throws {
        let owner=CWComputeProcess()
        do {_ = try await owner.start(resources:resources(badHash:true));XCTFail("Bad binary hash must fail")}
        catch {XCTAssertEqual(error as? CWComputeError,.resourceValidation)}
        let rejected=await owner.snapshot();XCTAssertEqual(rejected.state,"failed");XCTAssertEqual(rejected.sources,0)
        let collector=CWEventCollector(),stream=try await owner.start(resources:resources(probe:true)),pump=consume(stream,into:collector)
        try await wait{await owner.snapshot().state=="failed"}
        await pump.value
        let failed=await owner.snapshot();XCTAssertNotNil(failed.failure)
        await owner.stop();let stopped=await owner.snapshot();XCTAssertEqual(stopped.state,"stopped")
    }
    func testStartupWatchdogKillsAndReapsChildThatIgnoresTermination() async throws {
        let original=try resources(probe:true)
        let directory=FileManager.default.temporaryDirectory.appendingPathComponent("xlog-cw-watchdog-\(UUID())")
        try FileManager.default.createDirectory(at:directory,withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])
        defer {try? FileManager.default.removeItem(at:directory)}
        let executable=directory.appendingPathComponent("cw-stall-probe")
        try FileManager.default.copyItem(at:original.executable,to:executable)
        let stalled=CWComputeResources(executable:executable,model:original.model,runtime:original.runtime,
            executableSHA256:original.executableSHA256,runtimeSHA256:original.runtimeSHA256,runtimeVersion:original.runtimeVersion)
        let owner=CWComputeProcess(),collector=CWEventCollector()
        let stream=try await owner.start(resources:stalled),pump=consume(stream,into:collector)
        try await wait(iterations:700){await owner.snapshot().state=="failed"}
        await pump.value
        let failed=await owner.snapshot();XCTAssertEqual(failed.failure,.startupTimeout)
        // A new child can start only after the timed-out PID was reaped.
        let good=try await owner.start(resources:resources()),goodPump=consume(good,into:collector)
        try await wait{await owner.snapshot().state=="ready"}
        await owner.stop();await goodPump.value
    }
}

private actor CWEventCollector {
    private var events:[CWComputeEvent]=[]
    private var error:CWComputeError?
    func record(_ value:CWComputeEvent) {events.append(value);if events.count>128 {events.removeFirst()}}
    func failed(_ value:CWComputeError?) {error=value}
    func metrics(sequence:UInt64) -> CWNativeMetrics? {
        for case .metrics(let value) in events.reversed() where value.requestSequence==sequence {return value}
        return nil
    }
    func hasCall(_ call:String,offset:Double) -> Bool {
        for case .decode(let value) in events where value.track.replay && value.text.contains(call) && abs(value.track.offsetHz-offset)<15 {return true}
        return false
    }
}
#endif

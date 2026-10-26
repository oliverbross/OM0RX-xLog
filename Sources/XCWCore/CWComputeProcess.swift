// Copyright © 2026 Oliver Bross OM0RX. SPDX-License-Identifier: GPL-3.0-only
#if os(macOS)
import Foundation
import Dispatch
import CryptoKit
import Darwin
import CCWProcess

public struct CWComputeResources: Sendable {
    public let executable:URL
    public let model:URL
    public let runtime:URL
    public let executableSHA256:String
    public let runtimeSHA256:String
    public let runtimeVersion:String
    public init(executable:URL,model:URL,runtime:URL,executableSHA256:String,runtimeSHA256:String,runtimeVersion:String) {
        self.executable=executable;self.model=model;self.runtime=runtime;self.executableSHA256=executableSHA256
        self.runtimeSHA256=runtimeSHA256;self.runtimeVersion=runtimeVersion
    }
    public static func digest(_ url:URL,maximumBytes:Int) throws -> String {
        let values=try url.resourceValues(forKeys:[.isRegularFileKey,.isSymbolicLinkKey,.fileSizeKey])
        guard url.isFileURL,values.isRegularFile==true,values.isSymbolicLink != true,
              let size=values.fileSize,size>0,size<=maximumBytes else { throw CWComputeError.resourceValidation }
        let file=try FileHandle(forReadingFrom:url);defer{try? file.close()}
        var hash=SHA256(),count=0
        while let data=try file.read(upToCount:65536),!data.isEmpty {
            count+=data.count;guard count<=maximumBytes else {throw CWComputeError.resourceValidation};hash.update(data:data)
        }
        return hash.finalize().map{String(format:"%02x",$0)}.joined()
    }
    func validate() throws {
        guard FileManager.default.isExecutableFile(atPath:executable.path),
              try Self.digest(executable,maximumBytes:32*1024*1024)==executableSHA256,
              try Self.digest(model,maximumBytes:16*1024*1024)==CWSpotPolicy.modelSHA256,
              try Self.digest(model.deletingLastPathComponent().appendingPathComponent("model.onnx.json"),maximumBytes:16384) ==
                "b4342157b90229ee7380e165f3d8036179b80d1e6ae02f2557388b7fcd558c01",
              try Self.digest(runtime,maximumBytes:128*1024*1024)==runtimeSHA256 else {throw CWComputeError.resourceValidation}
    }
}

public struct CWComputeSnapshot:Sendable {
    public let state:String
    public let runtimeVersion:String?
    public let sources:Int
    public let queuedBytes:Int
    public let failure:CWComputeError?
}

/// Only the existing Swift worker creates this owner. No renderer/supervisor
/// starts a second child. This actor never opens a radio or a logbook.
public actor CWComputeProcess {
    private enum PipeKind:Sendable { case output,error }
    private enum Chunk:Sendable { case bytes(PipeKind,Data),eof(PipeKind) }
    private struct Write:Sendable {
        let id=UUID()
        let bytes:Data
        let source:String?
        let durationNS:UInt64
        let receivedNS:UInt64
    }
    private let ioQueue=DispatchQueue(label:"com.oliverbross.xlog.cw.compute.io",qos:.utility)
    private var input:DispatchIO?,output:DispatchIO?,errors:DispatchIO?
    private var pump:Task<Void,Never>?,monitor:Task<Void,Never>?
    private var ingress:AsyncThrowingStream<Chunk,Error>.Continuation?
    private var events:AsyncThrowingStream<CWComputeEvent,Error>.Continuation?
    private var pid:Int32?
    private var childID:UUID?
    private var resources:CWComputeResources?
    private var state="stopped",runtimeVersion:String?,failure:CWComputeError?
    private var retiring=false,startedNS:UInt64=0
    private var intentFence=UUID()
    private var stopWaiters:[CheckedContinuation<Void,Never>]=[]
    private var stdout=Data(),stderr=Data()
    private var sources:[String:CWStreamDescriptor]=[:],gates:[String:CWContinuityGate]=[:]
    private var writes:[Write]=[],activeWrite:Write?
    public init() {}

    deinit {
        pump?.cancel();monitor?.cancel();ingress?.finish();events?.finish()
        input?.close(flags:.stop);output?.close(flags:.stop);errors?.close(flags:.stop)
        if let pid {
            _ = xcw_terminate(pid,1)
            Task.detached {
                for _ in 0..<100 {
                    var code:Int32=0;if xcw_poll(pid,&code) != 0 {return}
                    try? await Task.sleep(nanoseconds:20_000_000)
                }
            }
        }
    }
    private static func key(_ descriptor:CWStreamDescriptor) -> String { descriptor.streamToken.uuidString.replacingOccurrences(of:"-",with:"").lowercased() }
    private var now:UInt64 {DispatchTime.now().uptimeNanoseconds}
    private var queuedBytes:Int {writes.reduce(activeWrite?.bytes.count ?? 0){$0+$1.bytes.count}}
    public func snapshot() -> CWComputeSnapshot {CWComputeSnapshot(state:state,runtimeVersion:runtimeVersion,sources:sources.count,queuedBytes:queuedBytes,failure:failure)}

    public func start(resources:CWComputeResources) async throws -> AsyncThrowingStream<CWComputeEvent,Error> {
        let intent=intentFence
        if retiring {await withCheckedContinuation{stopWaiters.append($0)}}
        guard intentFence==intent,!Task.isCancelled else {throw CWComputeError.stopped}
        guard pid==nil,!retiring else {throw CWComputeError.occupied}
        do {try resources.validate()} catch {state="failed";failure = .resourceValidation;throw CWComputeError.resourceValidation}
        var child=XCWChild(pid:-1,input_fd:-1,output_fd:-1,error_fd:-1)
        let result=resources.executable.path.withCString{path in resources.model.path.withCString{model in xcw_spawn(path,model,&child)}}
        guard result==0 else {state="failed";failure = .spawnFailed(Int32(result));throw CWComputeError.spawnFailed(Int32(result))}
        let id=UUID();pid=child.pid;childID=id;self.resources=resources;state="starting";failure=nil;runtimeVersion=nil;startedNS=now
        stdout.removeAll();stderr.removeAll();sources.removeAll();gates.removeAll();writes.removeAll();activeWrite=nil
        let incoming=AsyncThrowingStream<Chunk,Error>.makeStream(bufferingPolicy:.bufferingOldest(8))
        let outgoing=AsyncThrowingStream<CWComputeEvent,Error>.makeStream(bufferingPolicy:.bufferingOldest(64))
        ingress=incoming.continuation;events=outgoing.continuation
        outgoing.continuation.onTermination = { [weak self] reason in
            if case .cancelled=reason {Task{await self?.stop()}}
        }
        let inputFD=child.input_fd,outputFD=child.output_fd,errorFD=child.error_fd
        input=DispatchIO(type:.stream,fileDescriptor:inputFD,queue:ioQueue){_ in Darwin.close(inputFD)}
        output=DispatchIO(type:.stream,fileDescriptor:outputFD,queue:ioQueue){_ in Darwin.close(outputFD)}
        errors=DispatchIO(type:.stream,fileDescriptor:errorFD,queue:ioQueue){_ in Darwin.close(errorFD)}
        Self.read(output!,kind:.output,queue:ioQueue,to:incoming.continuation)
        Self.read(errors!,kind:.error,queue:ioQueue,to:incoming.continuation)
        pump=Task{[weak self] in
            do {for try await chunk in incoming.stream {await self?.consume(chunk,id:id)}}
            catch {await self?.fail(error as? CWComputeError ?? .invalidEvent,id:id)}
        }
        monitor=Task{[weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds:50_000_000)
                if Task.isCancelled {return}
                await self?.checkChild(id:id)
            }
        }
        return outgoing.stream
    }

    private nonisolated static func read(_ pipe:DispatchIO,kind:PipeKind,queue:DispatchQueue,to continuation:AsyncThrowingStream<Chunk,Error>.Continuation) {
        pipe.setLimit(lowWater:1)
        pipe.read(offset:0,length:4096,queue:queue){done,data,error in
            if let data,!data.isEmpty {
                if case .dropped=continuation.yield(.bytes(kind,Data(data))) {
                    continuation.finish(throwing:CWComputeError.outputOverflow);pipe.close(flags:.stop);return
                }
            }
            if error != 0 {continuation.finish(throwing:CWComputeError.childExited(Int32(error)));return}
            if done {
                if data?.isEmpty ?? true {_ = continuation.yield(.eof(kind))}
                else {Self.read(pipe,kind:kind,queue:queue,to:continuation)}
            }
        }
    }

    private func consume(_ chunk:Chunk,id:UUID) async {
        guard childID==id else{return}
        switch chunk {
        case .eof(.output):await fail(.childExited(-1),id:id)
        case .eof(.error):break
        case .bytes(.error,let data):
            stderr.append(data);if stderr.count>8192 {stderr.removeFirst(stderr.count-8192)}
        case .bytes(.output,let data):
            stdout.append(data)
            while let end=stdout.firstIndex(of:10) {
                let line=Data(stdout[..<end]);stdout.removeSubrange(...end)
                do {try receive(CWComputeWire.event(line))}
                catch {await fail(error as? CWComputeError ?? .invalidEvent,id:id);return}
            }
            if stdout.count>CWComputeWire.maximumEventBytes {await fail(.outputOverflow,id:id)}
        }
    }
    private func receive(_ event:CWComputeEvent) throws {
        switch event {
        case .ready(let version):
            guard state=="starting",version==resources?.runtimeVersion else {throw CWComputeError.resourceValidation}
            runtimeVersion=version;state="ready"
        case .decode(let value):
            guard state=="ready",let descriptor=sources[value.track.streamToken],UInt64(descriptor.epoch)==value.track.epoch,
                  descriptor.replay==value.track.replay else{return}
        case .track(let value):
            guard state=="ready",let descriptor=sources[value.streamToken],UInt64(descriptor.epoch)==value.epoch,
                  descriptor.replay==value.replay else{return}
        case .metrics:guard state=="ready" else{return}
        }
        if case .dropped=events?.yield(event) {throw CWComputeError.outputOverflow}
    }

    public func open(_ descriptor:CWStreamDescriptor) throws {
        let key=Self.key(descriptor)
        guard state=="ready",sources[key]==nil,sources.count<2 else {throw CWComputeError.occupied}
        let bytes=try CWComputeWire.open(descriptor)
        try enqueue(Write(bytes:bytes,source:key,durationNS:0,receivedNS:now))
        sources[key]=descriptor;gates[key]=CWContinuityGate()
    }
    public func send(_ block:CWIQBlock) throws {
        let key=Self.key(block.descriptor)
        guard state=="ready",sources[key]==block.descriptor else {throw CWComputeError.invalidFrame}
        do {
            var gate=gates[key] ?? CWContinuityGate();try gate.accept(block,now:now);gates[key]=gate
            let bytes=try CWComputeWire.iq(block)
            try enqueue(Write(bytes:bytes,source:key,durationNS:UInt64(block.sampleCount)*1_000_000_000/UInt64(block.descriptor.sampleRate),receivedNS:block.receivedMonotonicNS))
        } catch {
            end(block.descriptor,gap:true)
            throw error
        }
    }
    public func end(_ descriptor:CWStreamDescriptor,gap:Bool=false) {
        let key=Self.key(descriptor)
        guard sources.removeValue(forKey:key) != nil else{return}
        gates.removeValue(forKey:key);writes.removeAll{$0.source==key}
        if let bytes=try? CWComputeWire.end(descriptor,gap:gap),writes.count<16 {
            writes.insert(Write(bytes:bytes,source:nil,durationNS:0,receivedNS:now),at:0);writeNext()
        }
    }
    public func metrics(sequence:UInt64) throws {
        guard state=="ready" else {throw CWComputeError.stopped}
        try enqueue(Write(bytes:CWComputeWire.metrics(sequence:sequence),source:nil,durationNS:0,receivedNS:now))
    }
    private func enqueue(_ value:Write) throws {
        guard writes.count<16,queuedBytes+value.bytes.count<=1_048_576 else {throw CWComputeError.inputOverflow}
        if let source=value.source {
            let pending=writes.filter{$0.source==source}.reduce(activeWrite?.source==source ? activeWrite!.durationNS:0){$0+$1.durationNS}
            guard pending+value.durationNS<=250_000_000 else {throw CWComputeError.inputOverflow}
        }
        guard now>=value.receivedNS,now-value.receivedNS<=250_000_000 else{throw CWComputeError.staleInput}
        writes.append(value);writeNext()
    }
    private func writeNext() {
        guard activeWrite==nil,!writes.isEmpty,let pipe=input,let id=childID else{return}
        let value=writes.removeFirst();activeWrite=value
        if now<value.receivedNS || now-value.receivedNS>250_000_000 {
            Task{await self.fail(.staleInput,id:id)};return
        }
        let data=value.bytes.withUnsafeBytes{DispatchData(bytes:$0)}
        pipe.write(offset:0,data:data,queue:ioQueue){[weak self] done,_,error in
            if done || error != 0 {Task{await self?.written(value.id,child:id,error:Int32(error))}}
        }
    }
    private func written(_ write:UUID,child id:UUID,error:Int32) async {
        guard childID==id,activeWrite?.id==write else{return}
        activeWrite=nil
        if error != 0 {await fail(.childExited(error),id:id)} else {writeNext()}
    }
    private func checkChild(id:UUID) async {
        guard childID==id,let pid else{return}
        var code:Int32=0;let result=xcw_poll(pid,&code)
        if result != 0 {self.pid=nil;await fail(.childExited(result==1 ? code:result),id:id);return}
        if state=="starting",now-startedNS>5_000_000_000 {await fail(.startupTimeout,id:id);return}
        if let activeWrite,now-activeWrite.receivedNS>1_000_000_000 {await fail(.inputOverflow,id:id)}
    }
    private func fail(_ error:CWComputeError,id:UUID) async {
        guard childID==id else{return}
        failure=error;state="failed";await retire(preserveFailure:true)
    }
    public func stop() async {
        intentFence=UUID()
        if retiring {
            await withCheckedContinuation{stopWaiters.append($0)}
            if pid==nil {failure=nil;state="stopped"}
            return
        }
        failure=nil;state="stopping";await retire(preserveFailure:false)
    }
    private func retire(preserveFailure:Bool) async {
        guard !retiring else{return};retiring=true
        childID=nil;sources.removeAll();gates.removeAll();writes.removeAll();activeWrite=nil
        monitor?.cancel();monitor=nil;pump?.cancel();pump=nil
        ingress?.finish();ingress=nil
        if preserveFailure {events?.finish(throwing:failure ?? CWComputeError.stopped)} else {events?.finish()};events=nil
        input?.close(flags:.stop);output?.close(flags:.stop);errors?.close(flags:.stop);input=nil;output=nil;errors=nil
        if let pid {
            // The failing reader/monitor may be the task being cancelled.
            // Reaping must retain its deadline even when that caller is cancelled.
            let reaped=await Task.detached(priority:.utility){
                _ = xcw_terminate(pid,0)
                for index in 0..<75 {
                    var code:Int32=0
                    if xcw_poll(pid,&code) != 0 {return true}
                    if index==25 {_ = xcw_terminate(pid,1)}
                    try? await Task.sleep(nanoseconds:20_000_000)
                }
                return false
            }.value
            if reaped {self.pid=nil}
        }
        if pid != nil {failure = .childExited(-1);state="failed"}
        else if !preserveFailure {state="stopped"}
        stdout.removeAll();stderr.removeAll();retiring=false
        let waiting=stopWaiters;stopWaiters.removeAll();for waiter in waiting {waiter.resume()}
    }
}
#endif

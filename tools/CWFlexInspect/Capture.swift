// Developer-only bounded receive capture through the existing Flex owner.
// No panadapter creation/tuning, RF release, QSO or spot destinations.
import Foundation
import CryptoKit
import Darwin
import XCatIntegrationCore

private struct CaptureFailure:Error,CustomStringConvertible {
    let description:String
    init(_ message:String){description=message}
}
private struct CaptureOptions {
    let connection:Options
    let panadapter:String,channel:Int,directory:URL
    let expectedSerial:String?
    init(_ arguments:[String]) throws {
        guard [13,15].contains(arguments.count),["--capture","--verify-handoff"].contains(arguments[0]) else{throw CaptureFailure("Capture requires --host, --station, --panadapter, --channel, --seconds and --directory; optionally --expected-serial.")}
        var values:[String:String]=[:]
        for index in stride(from:1,to:arguments.count,by:2) {
            let key=arguments[index]
            guard ["--host","--station","--panadapter","--channel","--seconds","--directory","--expected-serial"].contains(key),values[key]==nil else{throw CaptureFailure("Invalid capture arguments.")}
            values[key]=arguments[index+1]
        }
        guard ["--host","--station","--panadapter","--channel","--seconds","--directory"].allSatisfy({values[$0] != nil}) else{throw CaptureFailure("A required capture argument is missing.")}
        expectedSerial=values["--expected-serial"]
        if let serial=expectedSerial {
            guard (1...64).contains(serial.utf8.count),serial.utf8.allSatisfy({(48...57).contains($0)||(65...90).contains($0)||(97...122).contains($0)||$0==45}) else{throw CaptureFailure("Expected radio serial is malformed.")}
        }
        connection=try Options(["--inspect","--host",values["--host"]!,"--station",values["--station"]!,"--seconds",values["--seconds"]!])
        guard let rawPan=values["--panadapter"],rawPan.count==8,let pan=UInt32(rawPan,radix:16),pan>0,
              String(format:"%08x",pan)==rawPan,
              let channel=values["--channel"].flatMap(Int.init),(1...8).contains(channel),String(channel)==values["--channel"],
              let path=values["--directory"],path.hasPrefix("/") else{throw CaptureFailure("Invalid capture resource or private directory.")}
        let url=URL(fileURLWithPath:path).standardizedFileURL
        guard url.path==path,url.deletingLastPathComponent().resolvingSymlinksInPath().path==url.deletingLastPathComponent().path else{throw CaptureFailure("Capture parent must be canonical and already exist.")}
        self.panadapter=rawPan;self.channel=channel;directory=url
    }
    func requireExpectedSerial(_ actual:String) throws {
        guard expectedSerial==nil || expectedSerial==actual else{throw CaptureFailure("Fresh manufacturer discovery does not match the operator-selected radio serial.")}
    }
}
private actor CaptureWriter {
    let options:CaptureOptions,iq:FileHandle,journal:FileHandle
    var digest=SHA256(),bytes=0,blocks=0,samples:UInt64=0
    var capture:FlexIQCapture?
    let started=Date()
    let utc=ISO8601DateFormatter()
    init(_ options:CaptureOptions) throws {
        self.options=options
        guard mkdir(options.directory.path,0o700)==0 else{throw CaptureFailure("Capture directory already exists or cannot be created.")}
        func create(_ name:String) throws -> FileHandle {
            let fd=open(options.directory.appendingPathComponent(name).path,O_CREAT|O_EXCL|O_WRONLY|O_NOFOLLOW,0o600)
            guard fd>=0 else{throw CaptureFailure("Cannot create private capture file.")}
            return FileHandle(fileDescriptor:fd,closeOnDealloc:true)
        }
        iq=try create("samples.cf32");journal=try create("blocks.jsonl")
    }
    func record(_ block:FlexIQBlock) throws {
        let current=block.capture
        guard current.sampleRate==96000,block.packet.sampleRate==96000,current.panadapter.id==options.panadapter,
              current.panadapter.channel==options.channel,block.sequence==UInt64(blocks),block.firstSample==samples,
              capture.map({$0==current}) ?? true else{throw CaptureFailure("Capture identity/rate/continuity changed; partial evidence retained.")}
        capture=current
        let data=block.packet.samples.withUnsafeBytes{Data($0)}
        guard bytes+data.count<=64*1024*1024 else{throw CaptureFailure("Finite capture byte budget reached.")}
        let row:[String:Any]=["sequence":String(block.sequence),"firstSample":String(block.firstSample),
            "sampleCount":block.packet.samples.count/2,"receivedMonotonicNS":String(block.receivedMonotonicNS),
            "packetCounter":Int(block.packet.packetCounter),"fileByteOffset":bytes,"utcReceipt":utc.string(from:Date())]
        try iq.write(contentsOf:data);digest.update(data:data)
        var line=try JSONSerialization.data(withJSONObject:row,options:[.sortedKeys]);line.append(10)
        try journal.write(contentsOf:line)
        bytes+=data.count;samples+=UInt64(block.packet.samples.count/2);blocks+=1
    }
    func finish(error:String?,phase:String,identity:FlexIQIdentity?,verifyOnly:Bool,diagnostics:[FlexIQDiagnosticEvent],inputDiagnostics:FlexIQInputDiagnostics?,reportedClientAddress:String?) throws -> [String:Any] {
        try iq.synchronize();try journal.synchronize();try iq.close();try journal.close()
        var selection:[String:Any]=["host":options.connection.host,"station":options.connection.station,"panadapter":options.panadapter,"daxIQChannel":options.channel]
        if let serial=options.expectedSerial {selection["expectedSerial"]=serial}
        let creationAttempted:Any=diagnostics.contains{$0.operation=="command" && $0.detail.hasPrefix("stream create ")}
            ? true:diagnostics.count<128 ? false as Any:NSNull()
        var result:[String:Any]=["instrument":"xlog-cw-flex-bounded-capture-v1","receiveOnly":true,
            "status":error==nil ? (verifyOnly ? "verified_handoff_no_stream_created":blocks>0 ? "captured_unqualified_iq":"incomplete"):"incomplete","sampleRate":96000,
            "lastPhase":phase,"cleanupRequested":true,"stationSideCleanupVerified":false,
            "streamCreationAttempted":creationAttempted,"controlDiagnosticsMayBeTruncated":diagnostics.count>=128,
            "directory":options.directory.path,"blocks":blocks,"complexSamples":String(samples),"bytes":bytes,
            "sampleSHA256":digest.finalize().map{String(format:"%02x",$0)}.joined(),
            "format":"little_endian_float32_IQ_normalized_1_over_32768","startedUTC":ISO8601DateFormatter().string(from:started),
            "endedUTC":ISO8601DateFormatter().string(from:Date()),"rfMappingQualified":false,"independentAnnotations":false,
            "operatorSelection":selection]
        if let capture {
            result["physicalIdentity"]=["model":capture.identity.model,"serial":capture.identity.serial,"address":capture.identity.address,"controlPort":Int(capture.identity.controlPort)]
            result["capture"]=["streamToken":capture.streamToken.uuidString,"epoch":String(capture.epoch),"connectionGeneration":capture.connectionGeneration,
                "stationHandle":String(capture.stationHandle),"streamID":String(format:"%08x",capture.streamID),"centreHz":capture.panadapter.centreHz.map{$0 as Any} ?? NSNull(),
                "receiveAntenna":capture.panadapter.receiveAntenna.map{$0 as Any} ?? NSNull(),"pathProperties":capture.panadapter.pathProperties]
        }
        if let error{result["error"]=error}
        if let identity {result["verifiedDiscoveryIdentity"]=["model":identity.model,"serial":identity.serial,"address":identity.address,"controlPort":Int(identity.controlPort)]}
        result["controlDiagnostics"]=try JSONSerialization.jsonObject(with:JSONEncoder().encode(diagnostics))
        result["udpInputDiagnostics"]=try inputDiagnostics.map{try JSONSerialization.jsonObject(with:JSONEncoder().encode($0))} ?? NSNull()
        result["radioReportedClientAddress"]=reportedClientAddress.map{$0 as Any} ?? NSNull()
        let data=try JSONSerialization.data(withJSONObject:result,options:[.prettyPrinted,.sortedKeys])
        try data.write(to:options.directory.appendingPathComponent("capture.json"),options:.withoutOverwriting)
        return result
    }
}
enum CWFlexCapture {
    static func selfTest() throws {
        let path=FileManager.default.currentDirectoryPath+"/.build/cw-capture-self-test-"+UUID().uuidString
        let valid=["--capture","--host","192.168.0.199","--station","Fixture","--panadapter","40000000","--channel","1","--seconds","2","--directory",path]
        _ = try CaptureOptions(valid)
        let pinned=try CaptureOptions(valid+["--expected-serial","1234-5678-8400-0001"])
        try pinned.requireExpectedSerial("1234-5678-8400-0001")
        do{try pinned.requireExpectedSerial("another-radio");throw CaptureFailure("A different physical radio was accepted.")}catch let failure as CaptureFailure where failure.description.contains("does not match"){}
        for serial in ["","has a space","bad\nserial"] {
            do{_ = try CaptureOptions(valid+["--expected-serial",serial])}catch{continue}
            throw CaptureFailure("Malformed expected radio serial was accepted.")
        }
        var missing=valid;missing[1]="--expected-serial";missing[2]="1234-5678-8400-0001"
        do{_ = try CaptureOptions(missing);throw CaptureFailure("Missing host was accepted.")}catch let failure as CaptureFailure where failure.description.contains("required capture argument"){}
        for (index,value) in [(2,"8.8.8.8"),(6,"not-a-pan"),(8,"9"),(10,"31"),(12,"relative/path")] {
            var invalid=valid;invalid[index]=value
            do {_ = try CaptureOptions(invalid)} catch {continue}
            throw CaptureFailure("Invalid capture option accepted.")
        }
        guard !FileManager.default.fileExists(atPath:path) else{throw CaptureFailure("Parser self-test created a capture directory.")}
    }
    static func run(_ arguments:[String],verifyOnly:Bool=false) async throws {
        let options=try CaptureOptions(arguments),writer=try CaptureWriter(options)
        let client=FlexRadioClient(host:options.connection.host,stationName:options.connection.station)
        let lease=UUID()
        var failure:String?
        var phase="preflight",identity:FlexIQIdentity?
        var reportedClientAddress:String?
        do {
            await client.start()
            var inventory=await client.iqCapabilities()
            for _ in 0..<24 {
                if inventory.ready,inventory.transmitStateKnownOff,inventory.panadapters.contains(where:{$0.id==options.panadapter && $0.channel==options.channel && $0.clientHandle==inventory.stationHandle}) {break}
                try await Task.sleep(for:.milliseconds(500));inventory=await client.iqCapabilities()
            }
            guard inventory.ready,inventory.transmitStateKnownOff,inventory.panadapters.contains(where:{$0.id==options.panadapter && $0.channel==options.channel && $0.clientHandle==inventory.stationHandle}) else{throw CaptureFailure("Selected Station/panadapter/channel lacks fresh receive readiness.")}
            reportedClientAddress=try? await client.inspectIQClientAddress()
            phase="physical_discovery_and_handoff"
            try await client.authorizeIQHandoff(panadapterID:options.panadapter,inventoryRevision:inventory.inventoryRevision)
            let verified=await client.iqCapabilities()
            identity=verified.identity
            guard verified.identity?.model.hasPrefix("FLEX-8400")==true else{throw CaptureFailure("Manufacturer discovery did not verify the intended FLEX-8400.")}
            try options.requireExpectedSerial(verified.identity!.serial)
            if !verifyOnly {
            phase="native_iq_start"
            let subscription=try await client.startIQ(panadapterID:options.panadapter,sampleRate:96000,leaseID:lease)
            phase="receiving"
            try await withThrowingTaskGroup(of:Bool.self) { group in
                group.addTask {
                    for try await block in subscription.blocks {try Task.checkCancellation();try await writer.record(block)}
                    return false
                }
                group.addTask {try await Task.sleep(for:.seconds(options.connection.seconds));return true}
                defer{group.cancelAll()}
                guard try await group.next()==true else{throw CaptureFailure("IQ ended before the bounded capture completed.")}
            }
            }
        } catch {failure="\(phase): \(error)"}
        // Never ordinary stop(): it can release unrelated radio output.
        await client.stopIQ(leaseID:lease);await client.stopTransportOnly()
        let result=try await writer.finish(error:failure,phase:phase,identity:identity,verifyOnly:verifyOnly,diagnostics:client.iqDiagnostics(),inputDiagnostics:client.iqInputDiagnostics(),reportedClientAddress:reportedClientAddress)
        try FileHandle.standardOutput.write(contentsOf:JSONSerialization.data(withJSONObject:result,options:[.prettyPrinted,.sortedKeys]));print("")
        if let failure{throw CaptureFailure(failure)}
        if !verifyOnly && result["status"] as? String != "captured_unqualified_iq" {throw CaptureFailure("No usable IQ capture arrived.")}
    }
}

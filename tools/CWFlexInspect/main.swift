// Copyright © 2026 Oliver Bross OM0RX. SPDX-License-Identifier: GPL-3.0-only
// Explicit, bounded metadata inspection. Never grants handoff or starts IQ.
import Foundation
import XCatIntegrationCore

private struct InvalidArguments:Error,CustomStringConvertible {
    var description:String {"Use --self-test, or --inspect --host PRIVATE_IPV4 --station NAME --seconds 2..30"}
}
struct Options {
    let host:String,station:String,seconds:Int
    init(_ arguments:[String]) throws {
        guard arguments.count==7,arguments[0]=="--inspect" else{throw InvalidArguments()}
        var values:[String:String]=[:]
        for index in stride(from:1,to:arguments.count,by:2) {
            let key=arguments[index]
            guard ["--host","--station","--seconds"].contains(key),values[key]==nil else{throw InvalidArguments()}
            values[key]=arguments[index+1]
        }
        guard let host=values["--host"],let station=values["--station"],let seconds=values["--seconds"].flatMap(Int.init),
              (2...30).contains(seconds),(1...64).contains(station.utf8.count),
              station.utf8.allSatisfy({$0>=32 && $0<127}),station==station.trimmingCharacters(in:.whitespaces) else{throw InvalidArguments()}
        let pieces=host.split(separator:".",omittingEmptySubsequences:false)
        let numbers=pieces.compactMap{UInt8($0)}
        guard pieces.count==4,numbers.count==4,zip(pieces,numbers).allSatisfy({String($0.1)==$0.0}),
              numbers[0]==10 || numbers[0]==127 || numbers[0]==192 && numbers[1]==168 || numbers[0]==172 && (16...31).contains(numbers[1]),
              numbers[3]>0,numbers[3]<255 else{throw InvalidArguments()}
        self.host=host;self.station=station;self.seconds=seconds
    }
}
private actor Observations {
    var capabilities:FlexIQCapabilities?
    var observedAt:Date?
    var controlTransmitObservation:ControlTransmitObservation?
    var messages:[String]=[]
    func record(_ value:FlexIQCapabilities,control:FlexRadioClient.TransmitObservation?){
        capabilities=value;observedAt=Date()
        controlTransmitObservation=control.map{ControlTransmitObservation(readAt:Date(),revision:String($0.revision),isConnected:$0.isConnected,isTransmitting:$0.isTransmitting)}
    }
    func message(_ value:String){messages.append(String(value.prefix(160)));if messages.count>20{messages.removeFirst(messages.count-20)}}
    func report(_ options:Options,diagnostics:[FlexIQDiagnosticEvent])->Report {
        Report(host:options.host,stationRequested:options.station,requestedSeconds:options.seconds,
            observedAt:observedAt,observedCapabilities:capabilities,controlTransmitObservation:controlTransmitObservation,messages:messages,controlDiagnostics:diagnostics)
    }
}
private struct ControlTransmitObservation:Encodable {
    let readAt:Date,revision:String,isConnected:Bool,isTransmitting:Bool
}
private struct Report:Encodable {
    let instrument="xlog-cw-flex-passive-inspection-v2"
    let receiveOnly=true,iqAcquired=false,handoffGranted=false
    let host:String,stationRequested:String,requestedSeconds:Int
    let observedAt:Date?
    let observedCapabilities:FlexIQCapabilities?
    let controlTransmitObservation:ControlTransmitObservation?
    let messages:[String]
    let controlDiagnostics:[FlexIQDiagnosticEvent]
}
@main struct CWFlexInspect {
    static func main() async {
        do {
            let arguments=Array(CommandLine.arguments.dropFirst())
            if ["--capture","--verify-handoff"].contains(arguments.first ?? "") {
                try await CWFlexCapture.run(arguments,verifyOnly:arguments.first=="--verify-handoff");return
            }
            if arguments==["--self-test"] {
                try CWFlexCapture.selfTest()
                _ = try Options(["--inspect","--host","192.168.0.199","--station","Red-Dingo","--seconds","12"])
                for invalid in [[],["--host","192.168.0.199"],
                    ["--inspect","--host","8.8.8.8","--station","Test","--seconds","12"],
                    ["--inspect","--host","192.168.0.199","--station","Test","--seconds","31"],
                    ["--inspect","--host","192.168.0.199","--host","Test","--seconds","12"]] {
                    do{_ = try Options(invalid);throw NSError(domain:"Invalid input accepted",code:1)}catch is InvalidArguments{}
                }
                print("{\"selfTest\":\"passed\",\"networkOpened\":false}");return
            }
            let options=try Options(arguments),observations=Observations()
            let client=FlexRadioClient(host:options.host,stationName:options.station,onState:{_,message in
                Task{await observations.message(message)}
            })
            await client.start()
            let reader=Task {
                while !Task.isCancelled {
                    let capability=await client.iqCapabilities()
                    let transmit=await client.transmitObservation()
                    guard !Task.isCancelled else{return}
                    await observations.record(capability,control:transmit)
                    do{try await Task.sleep(for:.milliseconds(500))}catch{return}
                }
            }
            try? await Task.sleep(for:.seconds(options.seconds))
            reader.cancel()
            // Ordinary stop() releases RF/CW. Passive inspection must only close
            // this transport; no stream was created and no handoff was granted.
            await client.stopTransportOnly();await reader.value
            let encoder=JSONEncoder();encoder.outputFormatting=[.sortedKeys,.prettyPrinted];encoder.dateEncodingStrategy = .iso8601
            let report=await observations.report(options,diagnostics:client.iqDiagnostics())
            try FileHandle.standardOutput.write(contentsOf:encoder.encode(report));print("")
        } catch {
            try? FileHandle.standardError.write(contentsOf:Data("\(error)\n".utf8));exit(2)
        }
    }
}

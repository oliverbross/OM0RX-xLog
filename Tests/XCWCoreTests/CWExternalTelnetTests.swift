// Copyright © 2026 Oliver Bross OM0RX. SPDX-License-Identifier: GPL-3.0-only
#if os(macOS)
import Foundation
import Darwin
import XCTest
@testable import XCWCore

final class CWExternalTelnetTests:XCTestCase {
    func testInstalledClientReceivesLiveCopyOriginalUTCHistoryAndReconnects() async throws {
        guard let path=ProcessInfo.processInfo.environment["XCW_TEST_TELNET"],FileManager.default.isExecutableFile(atPath:path) else {
            throw XCTSkip("Explicitly select an installed Telnet client with XCW_TEST_TELNET for isolated interoperability acceptance.")
        }
        let executable=URL(fileURLWithPath:path).resolvingSymlinksInPath()
        let hash=try CWComputeResources.digest(executable,maximumBytes:32*1024*1024)
        // Marked isolated test sink, synthetic accepted records, ephemeral
        // loopback only. No production app, radio, decoder or upstream output.
        let now=Date(timeIntervalSince1970:1_793_332_830),server=CWLocalClusterServer(wallClock:{now})
        try await server.start(port:0)
        for _ in 0..<500 {
            if await server.snapshot().state=="listening" {break}
            try await Task.sleep(nanoseconds:5_000_000)
        }
        let state=await server.snapshot(),port=try XCTUnwrap(state.port)
        XCTAssertEqual(state.address,"127.0.0.1");XCTAssertEqual(state.state,"listening")
        let old=spot(at:now.addingTimeInterval(-90)),live=spot(at:now)
        let oldLine=try CWSpotWire.line(old,stationCallsign:"N0CALL"),liveLine=try CWSpotWire.line(live,stationCallsign:"N0CALL")
        XCTAssertNotEqual(oldLine,liveLine,"The original UTC minute must differ from the live one")
        _ = try await server.publish(old,stationCallsign:"N0CALL")
        var peers:[CWExternalTelnetPeer]=[]
        do {
            for attempt in 0..<2 {
                let peer=try CWExternalTelnetPeer(path:executable.path,port:port);peers.append(peer)
                let banner=try await peer.until("login: ");XCTAssertTrue(banner.contains("# OM0RX-xLog Local CW"))
                try peer.send("isolated-telnet-fixture\n")
                let login=try await peer.until("Local CW spots only.")
                XCTAssertFalse(login.contains("DX de "),"Login must not silently replay history")
                if attempt==0 {
                    _ = try await server.publish(live,stationCallsign:"N0CALL")
                    let copy=try await peer.until("Z\n")
                    XCTAssertTrue(copy.contains(liveLine.replacingOccurrences(of:"\r\n",with:"\n")))
                    XCTAssertTrue(copy.contains("14025.123"));XCTAssertTrue(copy.contains("K1ABC/P"))
                }
                try peer.send("sh/dx/100\n")
                let history=try await peer.until("# End of history")
                XCTAssertEqual(history.components(separatedBy:"DX de ").count-1,2)
                XCTAssertTrue(history.contains(oldLine.replacingOccurrences(of:"\r\n",with:"\n")))
                XCTAssertTrue(history.contains(liveLine.replacingOccurrences(of:"\r\n",with:"\n")))
                try peer.send("bye\n");try await peer.waitForExit()
                XCTAssertEqual(peer.process.terminationReason,.exit)
                XCTAssertTrue([0,1].contains(peer.process.terminationStatus))
            }
            let connected=await server.snapshot();XCTAssertEqual(connected.acceptedConnections,2)
            await server.stop();let stopped=await server.snapshot()
            XCTAssertEqual(stopped.state,"off");XCTAssertEqual(stopped.clients,0)
            XCTAssertEqual(try CWComputeResources.digest(executable,maximumBytes:32*1024*1024),hash)
            print("CW isolated external Telnet receipt: client=\(executable.path) sha256=\(hash) endpoint=127.0.0.1:\(port) sessions=2 live=\(liveLine.trimmingCharacters(in:.newlines)) history=\(oldLine.trimmingCharacters(in:.newlines)) exit=\(peers.map{$0.process.terminationStatus}) listener=off clients=0")
        } catch {
            await server.stop()
            for peer in peers {await peer.cleanup()}
            throw error
        }
    }
    private func spot(at:Date)->CWConfirmedSpot {
        CWConfirmedSpot(id:UUID(),sessionID:UUID(),sourceID:UUID(),radioID:"radio1",provider:.tciIQ,receiverID:"0",streamToken:UUID(),
            epoch:"1",trackID:UUID(),callsign:"K1ABC/P",frequencyHz:14025123,observedAt:at,occurrenceRanges:["0:100","200:300"],
            policyVersion:1,originInstanceID:UUID(),modelSHA256:CWSpotPolicy.modelSHA256)
    }
}

private final class CWExternalTelnetPeer {
    let process=Process()
    private let input=Pipe(),output=Pipe()
    init(path:String,port:Int) throws {
        process.executableURL=URL(fileURLWithPath:path)
        // No user .telnetrc, auto-login or terminal escape commands.
        process.arguments=["-4","-c","-K","-E","127.0.0.1",String(port)]
        process.environment=["PATH":"/usr/bin:/bin","LANG":"C","TERM":"dumb"]
        process.standardInput=input;process.standardOutput=output;process.standardError=output
        try process.run()
        let descriptor=output.fileHandleForReading.fileDescriptor
        _ = fcntl(descriptor,F_SETFL,fcntl(descriptor,F_GETFL)|O_NONBLOCK)
    }
    func send(_ text:String) throws {try input.fileHandleForWriting.write(contentsOf:Data(text.utf8))}
    func until(_ marker:String) async throws -> String {
        let deadline=ProcessInfo.processInfo.systemUptime+5
        var result=Data(),buffer=[UInt8](repeating:0,count:4096)
        while ProcessInfo.processInfo.systemUptime<deadline {
            let count=Darwin.read(output.fileHandleForReading.fileDescriptor,&buffer,buffer.count)
            if count>0 {result.append(contentsOf:buffer.prefix(count))}
            else if count<0 && errno != EAGAIN && errno != EWOULDBLOCK {throw CWComputeError.stopped}
            guard result.count<=128*1024 else {throw CWComputeError.invalidEvent}
            let text=String(decoding:result,as:UTF8.self).replacingOccurrences(of:"\r\n",with:"\n")
            if text.contains(marker) {return text}
            if !process.isRunning {throw CWComputeError.stopped}
            try await Task.sleep(nanoseconds:5_000_000)
        }
        throw CWComputeError.startupTimeout
    }
    func waitForExit() async throws {
        for _ in 0..<500 {
            if !process.isRunning {return}
            try await Task.sleep(nanoseconds:5_000_000)
        }
        throw CWComputeError.startupTimeout
    }
    func cleanup() async {
        try? input.fileHandleForWriting.close()
        if (try? await waitForExit()) != nil {return}
        if process.isRunning {process.terminate()}
        if (try? await waitForExit()) != nil {return}
        if process.isRunning {_ = Darwin.kill(process.processIdentifier,SIGKILL)}
    }
}
#endif

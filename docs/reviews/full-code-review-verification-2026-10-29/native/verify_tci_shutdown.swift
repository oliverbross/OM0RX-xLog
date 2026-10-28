import Foundation
@testable import XLogPrototypeSupport

Task {
    do {
        let root=URL(fileURLWithPath:CommandLine.arguments[1])
        let port=Int(CommandLine.arguments[2])!
        try AppRuntimeProfile.configure(.contestingTest(supportRoot:root))
        let logbook=LiveLogbookMethods(supportDirectory:root,inheritNativePreferences:false)
        let worker=LiveWorker(logbook:logbook,ownsProcessSessions:true,runtimeProfile:.contestingTest(supportRoot:root))
        _ = try await LiveStationMethods.handle("station_connect",params:["radio_id":"radio1","provider":"direct_tci","endpoint":"ws://127.0.0.1:\(port)","trx":0,"channel":0])
        for _ in 0..<100 {
            if FileManager.default.fileExists(atPath:root.appendingPathComponent("handshake.ok").path) {break}
            try await Task.sleep(nanoseconds:20_000_000)
        }
        guard FileManager.default.fileExists(atPath:root.appendingPathComponent("handshake.ok").path) else {throw NSError(domain:"probe",code:1,userInfo:[NSLocalizedDescriptionKey:"Fake WebSocket handshake was not observed"])}
        let outcome=await worker.shutdownOutcome()
        try await Task.sleep(nanoseconds:300_000_000)
        let closedAfterShutdown=FileManager.default.fileExists(atPath:root.appendingPathComponent("closed.ok").path)
        let after=try await LiveStationMethods.handle("station_snapshot",params:["radio_id":"radio1","provider":"direct_tci"])
        _ = try await LiveStationMethods.handle("station_disconnect",params:["radio_id":"radio1","provider":"direct_tci"])
        for _ in 0..<100 {
            if FileManager.default.fileExists(atPath:root.appendingPathComponent("closed.ok").path) {break}
            try await Task.sleep(nanoseconds:20_000_000)
        }
        let result:[String:Any]=["shutdownOutcome":outcome.rawValue,"websocketClosedAfterWorkerShutdown":closedAfterShutdown,"websocketClosedAfterExplicitRoutedDisconnect":FileManager.default.fileExists(atPath:root.appendingPathComponent("closed.ok").path),"routedSnapshotAfterShutdown":after,"scope":"actual compiled modules and loopback-only stdlib fake WebSocket; no radio commands or hardware"]
        print(String(data:try JSONSerialization.data(withJSONObject:result,options:[.sortedKeys,.prettyPrinted]),encoding:.utf8)!)
        exit(0)
    } catch {print("probe failed:",error);exit(1)}
}
dispatchMain()

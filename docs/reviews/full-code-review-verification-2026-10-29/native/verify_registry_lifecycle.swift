import Foundation
@testable import XLogPrototypeSupport

func passive(_ provider:String,_ radio:String) async -> String {
    do {
        _ = try await LiveStationMethods.handle("station_disconnect",params:["provider":provider,"radio_id":radio])
        return "accepted"
    } catch let failure as WorkerFailure { return failure.code }
    catch { return String(describing:error) }
}

Task {
    do {
        let fixture=URL(fileURLWithPath:"/tmp/xlog-review-verification-20261028-12824393/native/private-worker")
        try FileManager.default.createDirectory(at:fixture,withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])
        try AppRuntimeProfile.configure(.contestingTest(supportRoot:fixture))
        let logbook=LiveLogbookMethods(supportDirectory:fixture,inheritNativePreferences:false)
        let worker=LiveWorker(logbook:logbook,ownsProcessSessions:true,runtimeProfile:.contestingTest(supportRoot:fixture))
        let providers=["direct_agent","direct_flex_lan","direct_tci"]
        var before:[String:String]=[:]
        for radio in ["radio1","radio2"] { for provider in providers { before[radio+"/"+provider]=await passive(provider,radio) } }
        let outcome=await worker.shutdownOutcome()
        var after:[String:String]=[:]
        for radio in ["radio1","radio2"] { for provider in providers { after[radio+"/"+provider]=await passive(provider,radio) } }
        var shared:[String:String]=[:]
        do { _ = try await LiveStationSession.shared.handle("station_disconnect",params:["provider":"direct_agent"]); shared["direct_agent"]="accepted" } catch let error as WorkerFailure {shared["direct_agent"]=error.code}
        do { _ = try await LiveFlexSession.shared.handle("station_disconnect",params:["provider":"direct_flex_lan"]); shared["direct_flex_lan"]="accepted" } catch let error as WorkerFailure {shared["direct_flex_lan"]=error.code}
        do { _ = try await LiveTCISession.shared.handle("station_disconnect",params:["provider":"direct_tci"]); shared["direct_tci"]="accepted" } catch let error as WorkerFailure {shared["direct_tci"]=error.code}
        let value:[String:Any]=["shutdownOutcome":outcome.rawValue,"before":before,"after":after,"sharedAfter":shared,"scope":"actual compiled modules; no connections or service startup; all global external I/O disabled"]
        let data=try JSONSerialization.data(withJSONObject:value,options:[.prettyPrinted,.sortedKeys])
        print(String(data:data,encoding:.utf8)!)
        exit(0)
    } catch { print("probe failed:",error);exit(1) }
}
dispatchMain()

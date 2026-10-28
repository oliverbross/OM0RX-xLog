import Foundation
import XLogCore
@testable import XLogPrototypeSupport

actor FakeRPC: FldigiXMLRPCCalling {
    var methods:[String]=[]
    func call(method:String,string:String?) async throws { methods.append(method) }
    func calls()->[String] {methods}
}
final class FakeReceiver: WSJTXDatagramReceiving, @unchecked Sendable {
    func start(address:String,port:UInt16) throws {}
    func stop() {}
}

Task {
    do {
        let root=URL(fileURLWithPath:"/tmp/xlog-review-verification-20261028-12824393/native/fldigi-module-fixtures")
        try FileManager.default.createDirectory(at:root,withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])
        let lease=WSJTXContestDestination(sessionID:UUID().uuidString,workspaceGeneration:UUID().uuidString,pluginID:"cq_ww_rtty",sourceRevision:"fixture")
        var rows:[[String:Any]]=[]
        for state in ["never_configured","disabled","receive_only","external_io_disabled"] {
            for lifecycle in ["shutdown","workspace_change"] {
                let rpc=FakeRPC(),enabled=state != "external_io_disabled"
                let bridge=LiveFldigiBridge(configurationURL:root.appendingPathComponent(state+"-"+lifecycle+"-"+UUID().uuidString+".json"),externalIOAllowed:{enabled},receiverFactory:{_,_ in FakeReceiver()},rpc:rpc)
                if state=="disabled" || state=="receive_only" {
                    _ = try await bridge.handle(method:"fldigi_configure",params:["configuration":["receive_enabled":state=="receive_only","transmit_enabled":false]],receiveDestination:lease,transmitDestination:nil,contestImporter:{_,_ in false})
                    if state=="receive_only" { _ = try await bridge.handle(method:"fldigi_start",params:[:],receiveDestination:lease,transmitDestination:nil,contestImporter:{_,_ in false}) }
                }
                if lifecycle=="shutdown" {await bridge.stopForShutdown()} else {await bridge.suspendForWorkspaceChange()}
                rows.append(["configuration":state,"lifecycle":lifecycle,"calls":await rpc.calls()])
            }
        }
        let data=try JSONSerialization.data(withJSONObject:["source":"actual compiled XLogPrototypeSupport; fake RPC/receiver only; no neighboring stubs","rows":rows],options:[.prettyPrinted,.sortedKeys])
        print(String(data:data,encoding:.utf8)!)
        exit(0)
    } catch {print("probe failed:",error);exit(1)}
}
dispatchMain()

import Foundation
private actor FakeRPC: FldigiXMLRPCCalling {
    var calls: [String] = []
    func call(method: String, string: String?) async throws { calls.append(method) }
    func recorded() -> [String] { calls }
}
@main struct Repro {
    static func main() async throws {
        let path = URL(fileURLWithPath: "/tmp/xlog-review-20261028-4bd554a/native/nonexistent-fldigi-configuration.json")
        let shutdownRPC = FakeRPC()
        let shutdownBridge = LiveFldigiBridge(configurationURL: path, externalIOAllowed: { true }, rpc: shutdownRPC)
        await shutdownBridge.stopForShutdown()
        print("Never-configured bridge shutdown RPC calls:", await shutdownRPC.recorded())
        let workspaceRPC = FakeRPC()
        let workspaceBridge = LiveFldigiBridge(configurationURL: path, externalIOAllowed: { true }, rpc: workspaceRPC)
        await workspaceBridge.suspendForWorkspaceChange()
        print("Never-configured bridge workspace-change RPC calls:", await workspaceRPC.recorded())
    }
}

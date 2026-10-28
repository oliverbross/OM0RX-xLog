import Foundation
struct WorkerFailure: Error { let code: String; let message: String; init(_ code: String, _ message: String) { self.code = code; self.message = message } }
struct ContestLaneError: Error { let code: String }
struct AppRuntimeProfile { static var current: Self { Self() }; var externalIOAllowed: Bool { true }; var connectedLoopbackAcceptance: Bool { false } }
struct LiveLogbookMethods { static let shared = Self(); var workspaceDirectoryURL: URL { URL(fileURLWithPath: "/tmp/unused-review") } }
final class SpotIngressGate: @unchecked Sendable { init(limit: Int) {}; func admit(bytes: Int) -> Bool { true }; func finish() {} }
protocol WSJTXDatagramReceiving: AnyObject { func start(address: String, port: UInt16) throws; func stop() }
final class WSJTXUDPReceiver: WSJTXDatagramReceiving { init(onDatagram: @escaping @Sendable (Data,String)->Void, onEvent: @escaping @Sendable (String)->Void) {}; func start(address:String,port:UInt16)throws{};func stop(){} }
public struct WSJTXContestDestination: Codable, Equatable, Sendable { let sessionID:String; let workspaceGeneration:String; let pluginID:String; let sourceRevision:String; var laneID = "laneA"; var bindingVersion = 0 }
enum WSJTXMessageError: Error { case invalid }

import Foundation
import XCTest
import XCWCore
@testable import XLogPrototypeSupport
#if os(macOS)
final class LiveCWDecodeMethodsTests:XCTestCase {
    func testListenerPreferencesArePassiveAndStopCancelsPreparedStartWithoutModel() async throws {
        let gate=CWListenerPrepareGate(),provider=CWMethodsTestProvider()
        let owner=LiveCWDecodeMethods(configurationURL:file(),provider:provider,
            resources:{throw CWComputeError.resourceValidation},prepareListener:{await gate.prepare()})
        let initial=try await owner.handle(method:"cw_decode_snapshot",params:[:]),before=try configuration(initial)
        let next=try CWDecodeConfiguration(listenerEnabled:true,listenerPort:49193)
        let saved=try await save(owner,next,previous:before)
        XCTAssertEqual((saved["listener"] as? [String:Any])?["state"] as? String,"off")
        XCTAssertEqual(saved["resourcesAvailable"] as? Bool,false)
        let starting=Task{try await owner.handle(method:"cw_decode_listener_start",params:["expected_revision":next.revision.uuidString])}
        for _ in 0..<1000 {if await gate.entered(){break};try await Task.sleep(nanoseconds:1_000_000)}
        let prepared=await gate.entered();XCTAssertTrue(prepared)
        _ = try await owner.handle(method:"cw_decode_listener_stop",params:[:])
        await gate.release()
        do {_ = try await starting.value;XCTFail("A stopped pending listener must not bind later")}
        catch {XCTAssertEqual((error as? WorkerFailure)?.code,"cw_cancelled")}
        let snapshot=try await owner.handle(method:"cw_decode_snapshot",params:[:]),acquisitions=await provider.acquisitions()
        XCTAssertEqual((snapshot["listener"] as? [String:Any])?["state"] as? String,"off")
        XCTAssertEqual(acquisitions,0)
        await owner.terminate()
    }
    private func file() -> URL {
        let directory=FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".cache/cw-methods-\(UUID())")
        addTeardownBlock{try? FileManager.default.removeItem(at:directory)}
        return directory.appendingPathComponent("CWDecode/settings.json")
    }
    private func configuration(_ snapshot:[String:Any]) throws -> CWDecodeConfiguration {
        let object=try XCTUnwrap(snapshot["configuration"] as? [String:Any])
        return try CWDecodeConfiguration.decode(JSONSerialization.data(withJSONObject:object))
    }
    private func save(_ owner:LiveCWDecodeMethods,_ next:CWDecodeConfiguration,previous:CWDecodeConfiguration) async throws -> [String:Any] {
        let object=try JSONSerialization.jsonObject(with:JSONEncoder().encode(next))
        return try await owner.handle(method:"cw_decode_configuration_save",params:["expected_revision":previous.revision.uuidString,"configuration":object])
    }
    func testSnapshotIsPassiveAndMissingResourcesBlockStartBeforeIQ() async throws {
        let provider=CWMethodsTestProvider(),url=file()
        let owner=LiveCWDecodeMethods(configurationURL:url,provider:provider,resources:{throw CWComputeError.resourceValidation})
        let initial=try await owner.handle(method:"cw_decode_snapshot",params:[:]),before=try configuration(initial)
        XCTAssertEqual(initial["resourcesAvailable"] as? Bool,false)
        XCTAssertFalse(FileManager.default.fileExists(atPath:url.path))
        let source=try CWSourceConfiguration(radioID:"radio1",provider:.tciIQ,receiverID:"0")
        let next=try CWDecodeConfiguration(sources:[source])
        _ = try await save(owner,next,previous:before)
        do {_ = try await owner.handle(method:"cw_decode_start",params:["expected_revision":next.revision.uuidString]);XCTFail("Missing offline resources must fail")}
        catch {XCTAssertEqual((error as? WorkerFailure)?.code,"cw_resources_unavailable")}
        let acquisitions=await provider.acquisitions();XCTAssertEqual(acquisitions,0)
        await owner.terminate()
    }
    func testConfigurationUsesCASAndRejectsUnknownFields() async throws {
        let owner=LiveCWDecodeMethods(configurationURL:file(),provider:CWMethodsTestProvider(),resources:{throw CWComputeError.resourceValidation})
        let initial=try await owner.handle(method:"cw_decode_snapshot",params:[:]),before=try configuration(initial)
        let next=try CWDecodeConfiguration(listenerPort:7400)
        _ = try await save(owner,next,previous:before)
        do {_ = try await save(owner,CWDecodeConfiguration(),previous:before);XCTFail("Stale settings must fail")}
        catch {XCTAssertEqual((error as? WorkerFailure)?.code,"cw_configuration_changed")}
        var object=try XCTUnwrap(JSONSerialization.jsonObject(with:JSONEncoder().encode(CWDecodeConfiguration())) as? [String:Any])
        object["modelURL"]="https://example.invalid/model"
        do {_ = try await owner.handle(method:"cw_decode_configuration_save",params:["expected_revision":next.revision.uuidString,"configuration":object]);XCTFail("Unknown field must fail")}
        catch {XCTAssertEqual((error as? WorkerFailure)?.code,"invalid_params")}
        let current=try await owner.handle(method:"cw_decode_snapshot",params:[:])
        XCTAssertEqual(try configuration(current),next)
        await owner.terminate()
    }
    func testTerminateRejectsNewCommandsAndSnapshotParametersAreStrict() async throws {
        let owner=LiveCWDecodeMethods(configurationURL:file(),provider:CWMethodsTestProvider(),resources:{throw CWComputeError.resourceValidation})
        do {_ = try await owner.handle(method:"cw_decode_snapshot",params:["start":true]);XCTFail("Snapshot must remain passive")}
        catch {XCTAssertEqual((error as? WorkerFailure)?.code,"invalid_params")}
        await owner.terminate()
        do {_ = try await owner.handle(method:"cw_decode_start",params:[:]);XCTFail("Terminal owner must reject commands")}
        catch {XCTAssertEqual((error as? WorkerFailure)?.code,"worker_stopping")}
    }
    func testBundleLocatorRequiresActualOfflineFiles() throws {
        let root=file().deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("Test.app/Contents")
        let model=root.appendingPathComponent("Resources/CWDecode")
        try FileManager.default.createDirectory(at:model,withIntermediateDirectories:true)
        let manifest=CWBundleManifest(version:1,sourceCommit:String(repeating:"a",count:40),runtimeVersion:"1.24.3",
            executableSHA256:String(repeating:"a",count:64),runtimeSHA256:String(repeating:"b",count:64),modelSHA256:CWSpotPolicy.modelSHA256)
        try JSONEncoder().encode(manifest).write(to:model.appendingPathComponent("manifest.json"))
        let executable=root.appendingPathComponent("MacOS/xlog-prototype-worker")
        XCTAssertThrowsError(try CWBundleResources.locate(executable:executable))
        for file in [root.appendingPathComponent("MacOS/xlog-cw-worker"),root.appendingPathComponent("Frameworks/libonnxruntime.dylib"),
                     model.appendingPathComponent("model.onnx"),model.appendingPathComponent("model.onnx.json")] {
            try FileManager.default.createDirectory(at:file.deletingLastPathComponent(),withIntermediateDirectories:true)
            try Data([1]).write(to:file)
            try FileManager.default.setAttributes([.posixPermissions:0o700],ofItemAtPath:file.path)
        }
        XCTAssertEqual(try CWBundleResources.locate(executable:executable).runtimeVersion,"1.24.3")
        XCTAssertThrowsError(try CWBundleResources.locate(executable:URL(fileURLWithPath:"/arbitrary/worker")))
    }
}
private actor CWMethodsTestProvider:CWIQSourceProviding {
    private var count=0
    func acquisitions()->Int{count}
    func acquire(_ source:CWSourceConfiguration,sessionID:UUID,leaseID:UUID) throws -> AsyncThrowingStream<CWIQBlock,Error> {
        count+=1;throw CWComputeError.stopped
    }
    func current(_ source:CWSourceConfiguration,sessionID:UUID,leaseID:UUID)->CWStreamDescriptor?{nil}
    func release(_ source:CWSourceConfiguration,leaseID:UUID){}
}
private actor CWListenerPrepareGate {
    private var started=false,waiter:CheckedContinuation<Void,Never>?
    func prepare() async {started=true;await withCheckedContinuation{waiter=$0}}
    func entered()->Bool{started}
    func release(){waiter?.resume();waiter=nil}
}
#endif

// Copyright © 2026 Oliver Bross OM0RX. SPDX-License-Identifier: GPL-3.0-only
#if os(macOS)
import Foundation
import XCWCore

actor LiveCWDecodeMethods {
    private let store: CWConfigurationStore
    private let session: CWDecodeSession
    private let resources: @Sendable () throws -> CWComputeResources
    private var terminated=false,mutation=false
    init(logbook: LiveLogbookMethods = .shared,configurationURL: URL? = nil,
         provider: any CWIQSourceProviding = LiveCWIQProvider(),compute: any CWComputeControlling = CWComputeProcess(),
         resources: @escaping @Sendable () throws -> CWComputeResources = {try CWBundleResources.locate()}) {
        let url=configurationURL ?? (logbook === LiveLogbookMethods.shared
            ? FileManager.default.urls(for:.applicationSupportDirectory,in:.userDomainMask)[0]
                .appendingPathComponent("OM0RX-xLog Integration Services/CWDecode/settings.json")
            : logbook.workspaceDirectoryURL.appendingPathComponent("CWDecode/settings.json"))
        store=CWConfigurationStore(url:url);session=CWDecodeSession(provider:provider,compute:compute);self.resources=resources
    }
    func terminate() async {terminated=true;await session.stop()}
    func handle(method: String,params: [String:Any]) async throws -> [String:Any] {
        guard !terminated else {throw WorkerFailure("worker_stopping","CW Decode is shutting down.")}
        switch method {
        case "cw_decode_snapshot":
            guard params.isEmpty else {throw invalid()}
        case "cw_decode_stop":
            guard params.isEmpty else {throw invalid()}
            // Stop does not wait for an in-progress Start request to release
            // mutation admission; the session revokes that intent immediately.
            await session.stop()
        case "cw_decode_start":
            guard Set(params.keys)==["expected_revision"],let raw=params["expected_revision"] as? String,
                  let revision=UUID(uuidString:raw) else {throw invalid()}
            guard !mutation else {throw WorkerFailure("cw_busy","CW Decode is applying another request.")}
            mutation=true;defer{mutation=false}
            let configuration=try store.load()
            guard revision==configuration.revision else {throw changed()}
            let resolved: CWComputeResources
            do {resolved=try resources()} catch {throw WorkerFailure("cw_resources_unavailable","The bundled CW decoder is unavailable. Install a complete CW Decode build.")}
            try await session.start(configuration:configuration,resources:resolved)
        case "cw_decode_configuration_save":
            guard Set(params.keys)==["expected_revision","configuration"],let raw=params["expected_revision"] as? String,
                  let revision=UUID(uuidString:raw),let object=params["configuration"] as? [String:Any],
                  Set(object.keys)==["version","revision","sources","listenerEnabled","listenerPort","automaticSpots"],
                  let sources=object["sources"] as? [[String:Any]],sources.allSatisfy({Set($0.keys)==["id","radioID","provider","receiverID","sampleRate"]}) else {throw invalid()}
            guard !mutation else {throw WorkerFailure("cw_busy","CW Decode is applying another request.")}
            mutation=true;defer{mutation=false}
            let active=await session.snapshot()
            guard active.state=="stopped",!terminated else {throw WorkerFailure("cw_stop_required","Stop CW Decode before changing its sources.")}
            let value: CWDecodeConfiguration
            do {value=try CWDecodeConfiguration.decode(JSONSerialization.data(withJSONObject:object))} catch {throw invalid()}
            try store.save(value,expectedRevision:revision)
        default:throw WorkerFailure("unknown_method","Unknown CW Decode method.")
        }
        return try await snapshot()
    }
    private func snapshot() async throws -> [String:Any] {
        let configuration=try store.load(),snapshot=await session.snapshot()
        var result=try Self.object(snapshot)
        result["configuration"]=try Self.object(configuration)
        result["resourcesAvailable"]=(try? resources()) != nil
        result["qualityStatus"]="awaiting_live_qualification"
        return result
    }
    private static func object<T:Encodable>(_ value:T) throws -> [String:Any] {
        guard let result=try JSONSerialization.jsonObject(with:JSONEncoder().encode(value)) as? [String:Any] else {throw CWComputeError.invalidEvent}
        return result
    }
    private func invalid()->WorkerFailure {WorkerFailure("invalid_params","Invalid CW Decode request.")}
    private func changed()->WorkerFailure {WorkerFailure("cw_configuration_changed","CW Decode settings changed. Reload before starting.")}
}
#endif

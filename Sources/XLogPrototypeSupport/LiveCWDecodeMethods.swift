// Copyright © 2026 Oliver Bross OM0RX. SPDX-License-Identifier: GPL-3.0-only
#if os(macOS)
import Foundation
import XCWCore

actor LiveCWDecodeMethods {
    private let store: CWConfigurationStore
    private let session: CWDecodeSession
    private let resources: @Sendable () throws -> CWComputeResources
    private let listener:CWLocalClusterServer
    private let prepareListener:@Sendable () async throws -> Void
    private let ingestSpot:@Sendable (CWConfirmedSpot,String) async throws -> Bool
    private let stationCallsign:@Sendable () throws -> String
    private let featureEnabled:@Sendable ()->Bool
    private var publisher:Task<Void,Never>?
    private var spotOutputFailure:String?
    private var listenerIntent=UUID()
    private var handoffIntent=UUID()
    private var terminated=false,mutation=false
    init(logbook: LiveLogbookMethods = .shared,configurationURL: URL? = nil,
         provider: any CWIQSourceProviding = LiveCWIQProvider(),compute: any CWComputeControlling = CWComputeProcess(),
         resources: @escaping @Sendable () throws -> CWComputeResources = {try CWBundleResources.locate()},
         listener:CWLocalClusterServer = CWLocalClusterServer(),prepareListener:@escaping @Sendable () async throws -> Void = {},
         ingestSpot:@escaping @Sendable (CWConfirmedSpot,String) async throws -> Bool = {_,_ in false},
         featureEnabled:@escaping @Sendable ()->Bool={CWBundleResources.experimentalEnabled()}) {
        let url=configurationURL ?? (logbook === LiveLogbookMethods.shared
            ? FileManager.default.urls(for:.applicationSupportDirectory,in:.userDomainMask)[0]
                .appendingPathComponent("OM0RX-xLog Integration Services/CWDecode/settings.json")
            : logbook.workspaceDirectoryURL.appendingPathComponent("CWDecode/settings.json"))
        store=CWConfigurationStore(url:url);session=CWDecodeSession(provider:provider,compute:compute,spotPolicy:CWSpotPolicy(origin:listener.instanceID));self.resources=resources
        self.listener=listener;self.prepareListener=prepareListener
        self.ingestSpot=ingestSpot;stationCallsign={try logbook.currentSettings().stationCall}
        self.featureEnabled=featureEnabled
    }
    func terminate() async {terminated=true;publisher?.cancel();publisher=nil;listenerIntent=UUID();handoffIntent=UUID();await LiveStationMethods.cwFlexRevokeHandoffs();await listener.stop();await session.stop()}
    func handle(method: String,params: [String:Any]) async throws -> [String:Any] {
        guard !terminated else {throw WorkerFailure("worker_stopping","CW Decode is shutting down.")}
        if ["cw_decode_start","cw_decode_listener_start","cw_decode_flex_handoff"].contains(method),!featureEnabled() {
            throw WorkerFailure("cw_feature_disabled","CW Decode is disabled in this build while input and release qualification are incomplete.")
        }
        if publisher==nil {
            let events=session.acceptedSpots
            publisher=Task{[weak self] in for await spot in events {guard !Task.isCancelled else{return};await self?.publish(spot)}}
        }
        switch method {
        case "cw_decode_snapshot":
            guard params.isEmpty else {throw invalid()}
        case "cw_decode_stop":
            guard params.isEmpty else {throw invalid()}
            // Stop does not wait for an in-progress Start request to release
            // mutation admission; the session revokes that intent immediately.
            handoffIntent=UUID();await LiveStationMethods.cwFlexRevokeHandoffs();await session.stop()
        case "cw_decode_flex_handoff":
            guard Set(params.keys)==["expected_revision","radio_id","panadapter_id","inventory_revision"],
                  let raw=params["expected_revision"] as? String,let revision=UUID(uuidString:raw),
                  let radioID=params["radio_id"] as? String,let pan=params["panadapter_id"] as? String,
                  let inventory=params["inventory_revision"] as? String,inventory.count<=20,UInt64(inventory) != nil else{throw invalid()}
            guard !mutation else{throw WorkerFailure("cw_busy","CW Decode is applying another request.")}
            mutation=true;defer{mutation=false}
            let configuration=try store.load(),intent=handoffIntent
            guard revision==configuration.revision else{throw changed()}
            guard configuration.sources.contains(where:{$0.radioID==radioID && $0.provider == .flexDAXIQ && $0.receiverID==pan}) else{throw invalid()}
            do {try await LiveStationMethods.cwFlexHandoff(radioID:radioID,panadapterID:pan,inventoryRevision:inventory)}
            catch {throw WorkerFailure("cw_flex_handoff_unavailable","FLEX handoff could not be verified. Check the Station, panadapter, DAX ownership and local discovery, then reload resources.")}
            guard !terminated,handoffIntent==intent else {
                await LiveStationMethods.cwFlexRevokeHandoffs();throw WorkerFailure("cw_cancelled","FLEX handoff was cancelled.")
            }
        case "cw_decode_listener_stop":
            guard params.isEmpty else {throw invalid()}
            listenerIntent=UUID();await listener.stop()
        case "cw_decode_listener_start":
            guard Set(params.keys)==["expected_revision"],let raw=params["expected_revision"] as? String,
                  let revision=UUID(uuidString:raw) else {throw invalid()}
            guard !mutation else {throw WorkerFailure("cw_busy","CW Decode is applying another request.")}
            mutation=true;defer{mutation=false}
            let configuration=try store.load(),intent=listenerIntent
            guard revision==configuration.revision else {throw changed()}
            guard configuration.listenerEnabled else {throw WorkerFailure("cw_listener_disabled","Enable the Local CW server in settings before starting it.")}
            try await prepareListener()
            guard !terminated,listenerIntent==intent else {throw WorkerFailure("cw_cancelled","Local CW server start was cancelled.")}
            do {try await listener.start(port:configuration.listenerPort)} catch {
                let state=await listener.snapshot().state
                throw WorkerFailure(state=="loop_blocked" ? "cw_self_loop":"cw_listener_unavailable",
                    state=="loop_blocked" ? "The Local CW server cannot also be an inbound cluster source.":"The Local CW server could not start on that port.")
            }
            guard !terminated,listenerIntent==intent else {
                await listener.stop();throw WorkerFailure("cw_cancelled","Local CW server start was cancelled.")
            }
        case "cw_decode_start":
            guard Set(params.keys)==["expected_revision"],let raw=params["expected_revision"] as? String,
                  let revision=UUID(uuidString:raw) else {throw invalid()}
            guard !mutation else {throw WorkerFailure("cw_busy","CW Decode is applying another request.")}
            mutation=true;defer{mutation=false}
            let configuration=try store.load()
            guard revision==configuration.revision else {throw changed()}
            guard !configuration.sources.isEmpty else {throw WorkerFailure("cw_no_sources","Choose at least one IQ source before starting CW Decode.")}
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
            let value: CWDecodeConfiguration
            do {value=try CWDecodeConfiguration.decode(JSONSerialization.data(withJSONObject:object))} catch {throw invalid()}
            let previous=try store.load(),active=await session.snapshot(),endpoint=await listener.snapshot()
            guard !terminated else {throw WorkerFailure("worker_stopping","CW Decode is shutting down.")}
            guard active.state=="stopped" || (value.sources==previous.sources && value.automaticSpots==previous.automaticSpots) else {
                throw WorkerFailure("cw_stop_required","Stop CW Decode before changing its sources or spot preference.")
            }
            guard !["starting","listening"].contains(endpoint.state) ||
                    (value.listenerEnabled==previous.listenerEnabled && value.listenerPort==previous.listenerPort) else {
                throw WorkerFailure("cw_listener_stop_required","Stop the Local CW server before changing its endpoint.")
            }
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
        result["featureEnabled"]=featureEnabled()
        result["qualityStatus"]="awaiting_live_qualification"
        if let spotOutputFailure{result["spotOutputFailure"]=spotOutputFailure}
        result["listener"]=try Self.object(await listener.snapshot())
        guard featureEnabled() else{result["capabilities"]=[];return result}
        async let first=LiveStationMethods.cwTCICapabilities(radioID:"radio1")
        async let second=LiveStationMethods.cwTCICapabilities(radioID:"radio2")
        async let flexFirst=LiveStationMethods.cwFlexCapabilities(radioID:"radio1")
        async let flexSecond=LiveStationMethods.cwFlexCapabilities(radioID:"radio2")
        let capabilities=await [first,second]
        var rows=try zip(["radio1","radio2"],capabilities).map {radio,value -> [String:Any] in
            var row=try value.map{try Self.object($0)} ?? ["ready":false,"receivers":[],"requestableSampleRates":[]]
            row["radioID"]=radio;row["provider"]="tci_iq";return row
        }
        let flexCapabilities=await [flexFirst,flexSecond]
        rows += try zip(["radio1","radio2"],flexCapabilities).map {radio,value -> [String:Any] in
            var row=try value.map{try Self.object($0)} ?? ["ready":false,"panadapters":[],"requestableSampleRates":[]]
            row["receivers"]=[];row["radioID"]=radio;row["provider"]="flex_dax_iq";return row
        }
        result["capabilities"]=rows
        return result
    }
    private func publish(_ spot:CWConfirmedSpot) async {
        guard !terminated,await session.canPublish(spot),let call=try? stationCallsign(),(try? CWSpotWire.reporter(call)) != nil else{return}
        do {
            _ = try await ingestSpot(spot,call)
            guard !terminated,await session.canPublish(spot) else{return}
            _ = try await listener.publish(spot,stationCallsign:call)
            spotOutputFailure=nil
        } catch {spotOutputFailure="local_cw_output_unavailable"}
    }
    private static func object<T:Encodable>(_ value:T) throws -> [String:Any] {
        guard let result=try JSONSerialization.jsonObject(with:JSONEncoder().encode(value)) as? [String:Any] else {throw CWComputeError.invalidEvent}
        return result
    }
    private func invalid()->WorkerFailure {WorkerFailure("invalid_params","Invalid CW Decode request.")}
    private func changed()->WorkerFailure {WorkerFailure("cw_configuration_changed","CW Decode settings changed. Reload before starting.")}
}
#endif

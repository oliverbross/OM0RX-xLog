import Foundation
#if os(macOS)
import XCatIntegrationCore
import XLogCore

/// A synchronous actor reservation closes the gap between the two providers'
/// asynchronous attachment checks when connect IPC requests arrive together.
actor StationProviderClaim {
    static let shared = StationProviderClaim()
    private var owner: String?
    private var ownerLease: UUID?

    func reserve(_ provider: String, lease: UUID? = nil) throws {
        guard owner == nil || owner == provider && ownerLease == lease else {
            throw WorkerFailure("station_busy", "Disconnect the other station provider before connecting.")
        }
        owner = provider
        ownerLease = lease
    }

    func release(_ provider: String, lease: UUID? = nil) {
        if owner == provider && ownerLease == lease { owner = nil; ownerLease = nil }
    }
}

#endif

/// Routing, capture registration and retirement share these exact owners.
/// A private registry may be injected without owning any process-wide service.
struct StationRetirementResult: Sendable, Equatable {
    let unconfirmedRadioIDs: Set<String>
}

enum StationOwnerRetirement: Sendable, Equatable { case retired, unconfirmed }

struct StationRadioRegistry: Sendable {
    static let shared = StationRadioRegistry()
    #if os(macOS)
    let claims: [String: StationProviderClaim]
    let agents: [String: LiveStationSession]
    let flex: [String: LiveFlexSession]
    let tci: [String: LiveTCISession]

    init(agents: [String: LiveStationSession]? = nil, flex: [String: LiveFlexSession]? = nil,
         tciFactory: @Sendable (StationProviderClaim) -> LiveTCISession = { LiveTCISession(claim: $0) }) {
        let claims = ["radio1": StationProviderClaim(), "radio2": StationProviderClaim()]
        self.claims = claims
        self.agents = agents ?? ["radio1": LiveStationSession(radioID: "radio1"), "radio2": LiveStationSession(radioID: "radio2")]
        self.flex = flex ?? ["radio1": LiveFlexSession(), "radio2": LiveFlexSession()]
        self.tci = claims.mapValues(tciFactory)
    }

    func installPowerCapture(_ capture: NativeDraftPowerGate) async {
        for owner in agents.values { await owner.installPowerCapture(capture) }
    }

    func terminate() async -> StationRetirementResult {
        await withTaskGroup(of: (String, StationOwnerRetirement).self) { group in
            for (id, owner) in agents { group.addTask { (id, await owner.terminate()) } }
            for (id, owner) in flex { group.addTask { (id, await owner.terminate()) } }
            for (id, owner) in tci { group.addTask { await owner.terminate(); return (id, .retired) } }
            var unconfirmed = Set<String>()
            for await (id, outcome) in group where outcome == .unconfirmed { unconfirmed.insert(id) }
            return StationRetirementResult(unconfirmedRadioIDs: unconfirmed)
        }
    }
    #endif
}

/// The Mac worker talks to the real xCat loopback service. No values are
/// synthesized when that service or its radio is unavailable.
enum LiveStationMethods {
    #if os(macOS)
    static func cwFlexCapabilities(radioID:String) async -> FlexIQCapabilities?{await StationRadioRegistry.shared.flex[radioID]?.cwIQCapabilities()}
    static func cwFlexRevokeHandoffs() async {
        async let first:Void=StationRadioRegistry.shared.flex["radio1"]?.cwRevokeIQHandoffs() ?? ()
        async let second:Void=StationRadioRegistry.shared.flex["radio2"]?.cwRevokeIQHandoffs() ?? ()
        _ = await(first,second)
    }
    static func cwFlexHandoff(radioID:String,panadapterID:String,inventoryRevision:String) async throws {
        guard let owner=StationRadioRegistry.shared.flex[radioID] else{throw invalidParams()}
        try await owner.cwAuthorizeIQHandoff(panadapterID:panadapterID,inventoryRevision:inventoryRevision)
    }
    static func cwStartFlex(radioID:String,panadapterID:String,sampleRate:Int,leaseID:UUID) async throws -> FlexIQSubscription {
        guard let owner=StationRadioRegistry.shared.flex[radioID] else{throw invalidParams()}
        return try await owner.cwStartIQ(panadapterID:panadapterID,sampleRate:sampleRate,leaseID:leaseID)
    }
    static func cwStopFlex(radioID:String,leaseID:UUID) async{await StationRadioRegistry.shared.flex[radioID]?.cwStopIQ(leaseID:leaseID)}
    static func cwFlexCapture(radioID:String,leaseID:UUID) async -> FlexIQCapture?{await StationRadioRegistry.shared.flex[radioID]?.cwIQCapture(leaseID:leaseID)}
    static func cwTCICapabilities(radioID:String) async -> TCIIQCapabilities? {
        await StationRadioRegistry.shared.tci[radioID]?.cwIQCapabilities()
    }
    static func cwStartTCI(radioID:String,receiver:Int,sampleRate:Int,leaseID:UUID) async throws -> TCIIQSubscription {
        guard let owner=StationRadioRegistry.shared.tci[radioID] else {throw invalidParams()}
        return try await owner.cwStartIQ(receiver:receiver,sampleRate:sampleRate,leaseID:leaseID)
    }
    static func cwStopTCI(radioID:String,leaseID:UUID) async {await StationRadioRegistry.shared.tci[radioID]?.cwStopIQ(leaseID:leaseID)}
    static func cwTCICapture(radioID:String,leaseID:UUID) async -> TCIIQCapture? {
        await StationRadioRegistry.shared.tci[radioID]?.cwIQCapture(leaseID:leaseID)
    }
    #endif
    static let methods: Set<String> = ["station_snapshot", "station_tune", "station_action", "station_receive_filter",
                                       "station_connect", "station_disconnect", "station_reconnect",
                                       "station_forget", "station_configuration", "station_configuration_save",
                                       "station_radio_control", "station_rotor_snapshot", "station_rotor_connect", "station_rotor_disconnect",
                                       "station_rotor_goto", "station_rotor_stop", "station_add_spot", "station_remove_spot",
                                       "station_cat_servers"]

    struct Endpoint: Equatable {
        let host: String
        let port: UInt16

        init(_ params: [String: Any], allowed: Set<String>) throws {
            guard Set(params.keys).isSubset(of: allowed.union(["host", "port"])) else {
                throw invalidParams()
            }
            let requestedHost = params["host"] as? String ?? "127.0.0.1"
            guard params["host"] == nil || params["host"] is String,
                  requestedHost == "127.0.0.1" || requestedHost == "localhost" else {
                throw invalidParams()
            }
            host = "127.0.0.1"
            if let value = params["port"] {
                let number = try integer(value)
                guard (1...65_535).contains(number) else { throw invalidParams() }
                port = UInt16(number)
            } else {
                port = 14_532
            }
        }
    }

    static func handle(_ method: String, params: [String: Any], registry: StationRadioRegistry = .shared) async throws -> [String: Any] {
        guard methods.contains(method) else {
            throw WorkerFailure("method_not_allowed", "Station method is not available.")
        }
        #if !os(macOS)
        if !["station_snapshot", "station_tune", "station_action"].contains(method)
            || params["provider"] as? String == "direct_agent" {
            throw WorkerFailure("unsupported_platform", "Live station control is available on macOS only.")
        }
        #endif
        #if os(macOS)
        guard params["provider"] == nil || params["provider"] is String else { throw invalidParams() }
        // The rotor has its own process-wide transport and lifetime. It is not
        // owned by Radio 1 or Radio 2, so route it before requiring radio_id.
        // Keeping it behind the radio selector made every native rotor request
        // fail validation and left the coordinator in an uncertain half-state.
        if method.hasPrefix("station_rotor_") {
            var rotorParams = params
            rotorParams.removeValue(forKey: "radio_id")
            return try await LiveRotorSession.shared.handle(method, params: rotorParams)
        }
        guard let radioID = params["radio_id"] as? String,
              ["radio1", "radio2"].contains(radioID),
              let claim = registry.claims[radioID],
              let agent = registry.agents[radioID],
              let flex = registry.flex[radioID],
              let tci = registry.tci[radioID] else { throw invalidParams() }
        var routed = params
        routed.removeValue(forKey: "radio_id")
        let selectedProvider = params["provider"] as? String ?? "xcat_loopback"
        if selectedProvider == "direct_tci" {
            var result = try await tci.handle(method, params: routed); result["radio_id"] = radioID; return result
        }
        if selectedProvider == "direct_flex_lan" {
            if method == "station_connect" {
                let remote = await agent.snapshot()
                guard remote["transport_state"] as? String == RadioConnectionState.stopped.rawValue,
                      remote["radio"] is NSNull else {
                    throw WorkerFailure("station_busy", "Disconnect the Remote Station Agent before connecting direct FLEX.")
                }
                try await claim.reserve(selectedProvider)
            }
            do {
                var result = try await flex.handle(method, params: routed)
                if method == "station_disconnect" {
                    await claim.release(selectedProvider)
                }
                result["radio_id"] = radioID
                return result
            } catch {
                if method == "station_connect", !(await flex.isAttached()) {
                    await claim.release(selectedProvider)
                }
                throw error
            }
        }
        if LiveStationSession.methods.contains(method) {
            guard selectedProvider == "direct_agent" else { throw invalidParams() }
            if method == "station_connect" {
                guard !(await flex.isAttached()) else {
                    throw WorkerFailure("station_busy", "Disconnect direct FLEX before connecting the Remote Station Agent.")
                }
                try await claim.reserve(selectedProvider)
            }
            do {
                var result = try await agent.handle(method, params: routed)
                if method == "station_disconnect" {
                    await claim.release(selectedProvider)
                } else if method == "station_forget" {
                    let state = await agent.snapshot()
                    if state["transport_state"] as? String == RadioConnectionState.stopped.rawValue,
                       state["radio"] is NSNull {
                        await claim.release(selectedProvider)
                    }
                }
                result["radio_id"] = radioID; return result
            } catch {
                if method == "station_connect" {
                    let state = await agent.snapshot()
                    if state["transport_state"] as? String == RadioConnectionState.stopped.rawValue,
                       state["radio"] is NSNull {
                        await claim.release(selectedProvider)
                    }
                } else if method == "station_forget" {
                    let state = await agent.snapshot()
                    if state["transport_state"] as? String == RadioConnectionState.stopped.rawValue,
                       state["radio"] is NSNull {
                        await claim.release(selectedProvider)
                    }
                }
                throw error
            }
        }
        let provider = selectedProvider
        if provider == "direct_agent" {
            guard Set(routed.keys).isSubset(of: method == "station_tune"
                ? ["provider", "frequency_hz", "mode", "expected_generation"] : method == "station_action"
                ? ["provider", "action", "expected_generation", "expected_native_intent"] : ["provider"]) else { throw invalidParams() }
            if method == "station_snapshot" { var result = await agent.snapshot(); result["radio_id"] = radioID; return result }
            if method == "station_tune" {
                let target = try tuneTarget(routed)
                let expected = try routed["expected_generation"].map { raw -> UInt64 in
                    let value = try integer(raw)
                    guard (0...9_007_199_254_740_991).contains(value) else { throw invalidParams() }
                    return UInt64(value)
                }
                var result = try await agent.tune(frequencyHz: target.0, mode: target.1, expectedGeneration: expected); result["radio_id"] = radioID; return result
            }
            guard let action = routed["action"] as? String,
                  ["standby", "operate", "tune", "cancel"].contains(action) else { throw invalidParams() }
            let expected = try routed["expected_generation"].map { raw -> UInt64 in
                let value = try integer(raw)
                guard ["cancel", "tune", "operate", "standby"].contains(action), (0...9_007_199_254_740_991).contains(value) else { throw invalidParams() }
                return UInt64(value)
            }
            let nativeIntent = try routed["expected_native_intent"].map { raw -> UInt64 in
                let value = try integer(raw)
                guard ["cancel", "tune", "operate", "standby"].contains(action), expected != nil,
                      (1...9_007_199_254_740_991).contains(value) else { throw invalidParams() }
                return UInt64(value)
            }
            var result = try await agent.action(action, expectedGeneration: expected, expectedNativeIntent: nativeIntent); result["radio_id"] = radioID; return result
        }
        guard provider == "xcat_loopback" else { throw invalidParams() }
        #endif
        let endpoint = try Endpoint(params, allowed: method == "station_tune"
            ? ["frequency_hz", "mode", "provider"] : method == "station_action"
            ? ["action", "bearing", "band", "provider"] : ["provider"])
        let requestedTune: (Int64, String)?
        let actionCommand: (String, String)?
        switch method {
        case "station_snapshot":
            requestedTune = nil
            actionCommand = nil
        case "station_tune":
            requestedTune = try tuneTarget(params)
            actionCommand = nil
        default:
            guard let action = params["action"] as? String else { throw invalidParams() }
            let command: String
            switch action {
            case "standby", "operate", "tune", "cancel", "rotor_stop":
                guard params["bearing"] == nil, params["band"] == nil else { throw invalidParams() }
                command = action
            case "rotor_goto":
                guard let bearingValue = params["bearing"],
                      let band = params["band"] as? String,
                      ["160m", "80m", "60m", "40m", "30m", "20m", "17m", "15m", "12m", "10m", "6m", "4m", "2m", "70cm", "Other"].contains(band),
                      let bearing = try finiteNumber(bearingValue),
                      (0...360).contains(bearing) else { throw invalidParams() }
                command = String(format: "rotor_goto %.1f %@", locale: Locale(identifier: "en_US_POSIX"), bearing, band)
            default:
                throw invalidParams()
            }
            requestedTune = nil
            actionCommand = (action, command)
        }

        #if os(macOS)
        let client = XCatClient(host: endpoint.host, port: endpoint.port)
        do {
            if let (frequency, mode) = requestedTune {
                let before = try await client.stationSnapshot()
                guard before.radio?.observed == true, before.radio?.connected == true else {
                    throw WorkerFailure("station_unavailable", "Observed radio state is unavailable.")
                }
                try await client.tune(frequencyHz: frequency, mode: mode)
                try await client.waitForObservedSimplex(frequencyHz: frequency, mode: mode)
                let after = try await client.stationSnapshot()
                guard after.radio?.confirmsSimplex(frequencyHz: frequency, radioMode: expectedRadioMode(mode, frequencyHz: frequency)) == true else {
                    throw WorkerFailure("station_superseded", "The observed radio target changed before completion.")
                }
                return ["accepted": true, "confirmed": true, "state": project(after)]
            }
            if let (action, command) = actionCommand {
                let before = try await client.stationSnapshot()
                guard before.station.allowedActions.contains(action) else {
                    throw WorkerFailure("station_action_blocked", "The station does not currently allow this action.")
                }
                try await client.stationAction(command)
                let after = try await client.stationSnapshot()
                return ["accepted": true, "confirmed": false, "action": action, "state": project(after)]
            }
            return project(try await client.stationSnapshot())
        } catch let failure as WorkerFailure {
            throw failure
        } catch let error as XCatClientError {
            switch error {
            case .connect, .read, .write:
                throw WorkerFailure("station_unavailable", "The xCat station service is unavailable.")
            case .timeout:
                throw WorkerFailure("station_timeout", "The station did not confirm the operation in time.")
            case .invalidHost, .invalidResponse:
                throw WorkerFailure("station_protocol", "The xCat station response is invalid.")
            }
        } catch {
            throw WorkerFailure("station_unavailable", "The station operation failed.")
        }
        #else
        throw WorkerFailure("unsupported_platform", "Live station control is available on macOS only.")
        #endif
    }

    private static func invalidParams() -> WorkerFailure {
        WorkerFailure("invalid_params", "Invalid station parameters.")
    }

    private static func tuneTarget(_ params: [String: Any]) throws -> (Int64, String) {
        guard let rawFrequency = params["frequency_hz"],
              let mode = params["mode"] as? String,
              (1...12).contains(mode.utf8.count),
              mode.utf8.allSatisfy({ (65...90).contains($0) || (48...57).contains($0) }),
              (100_000...1_000_000_000).contains(try integer(rawFrequency)) else {
            throw invalidParams()
        }
        return (try integer(rawFrequency), mode)
    }

    private static func integer(_ value: Any) throws -> Int64 {
        guard let number = jsonNumber(value),
              number.doubleValue.rounded() == number.doubleValue,
              number.doubleValue >= Double(Int64.min),
              number.doubleValue < Double(Int64.max) else { throw invalidParams() }
        return number.int64Value
    }

    private static func finiteNumber(_ value: Any) throws -> Double? {
        guard let number = jsonNumber(value) else { throw invalidParams() }
        return number.doubleValue
    }

    private static func jsonNumber(_ value: Any) -> NSNumber? {
        // Foundation bridges JSON booleans to NSNumber too. CoreFoundation's
        // type IDs are unavailable in the Windows toolchain; preserve the JSON
        // scalar distinction without guessing NSNumber's platform class/type.
        guard let number = value as? NSNumber, number.doubleValue.isFinite,
              let encoded = try? JSONSerialization.data(withJSONObject: [number]),
              encoded != Data("[true]".utf8), encoded != Data("[false]".utf8) else { return nil }
        return number
    }

    #if os(macOS)
    private static func expectedRadioMode(_ mode: String, frequencyHz: Int64) -> String {
        switch mode {
        case "SSB": frequencyHz < 10_000_000 ? "LSB" : "USB"
        case "FT8", "FT4", "FT2", "RTTY", "JTTY", "PSK", "DIGI": "DIGU"
        default: mode
        }
    }

    private static func project(_ state: XCatStationSnapshot) -> [String: Any] {
        let radio: Any = state.radio.map { radio in
            ["observed": radio.observed ?? false, "connected": radio.connected,
             "frequency_hz": radio.frequencyHz, "mode": radio.mode,
             "receive_frequency_hz": optional(radio.receiveFrequencyHz),
             "transmit_frequency_hz": optional(radio.transmitFrequencyHz),
             "receive_vfo": optional(radio.receiveVFO), "transmit_vfo": optional(radio.transmitVFO),
             "split": optional(radio.split), "transmitting": optional(radio.isTransmitting)] as [String: Any]
        } ?? NSNull()
        let station = state.station
        let rotor = state.rotor
        let propagation = state.propagation
        return [
            "source": "xcat_loopback", "available": state.available,
            "generated_at": state.generatedAt, "radio": radio,
            "station": ["available": station.available, "commissioned": station.commissioned,
                        "coordinator_state": station.coordinatorState,
                        "allowed_actions": station.allowedActions,
                        "kpa_operate": optional(station.kpaOperate), "band": station.band,
                        "route_alignment": station.routeAlignment, "interlock_state": station.interlockState,
                        "tx_power_watts": optional(station.txPowerWatts), "swr": optional(station.swr),
                        "swr_is_live": station.swrIsLive, "rf_drive_watts": optional(station.rfDriveWatts),
                        "kpa_detail_primary": station.kpaDetailPrimary,
                        "kpa_detail_secondary": station.kpaDetailSecondary,
                        "kat_detail_primary": station.katDetailPrimary,
                        "kat_detail_secondary": station.katDetailSecondary,
                        "route_detail": station.routeDetail, "alarm_summary": station.alarmSummary] as [String: Any],
            "rotor": ["connected": rotor.connected, "name": rotor.name,
                      "home_grid": optional(rotor.homeGrid), "azimuth": optional(rotor.azimuth),
                      "target_bearing": optional(rotor.targetBearing), "target_label": rotor.targetLabel,
                      "status": rotor.status, "moving": rotor.isMoving,
                      "motion_direction": rotor.motionDirection] as [String: Any],
            "propagation": ["status": propagation.status, "updated_at": optional(propagation.updatedAt),
                            "solar_flux": optional(propagation.solarFlux), "a_index": optional(propagation.aIndex),
                            "k_index": optional(propagation.kIndex), "x_ray": propagation.xRay,
                            "bands": propagation.bands.map {
                                ["name": $0.name, "day": $0.day, "night": $0.night]
                            }] as [String: Any]
        ]
    }

    private static func optional<T>(_ value: T?) -> Any { value.map { $0 as Any } ?? NSNull() }
    #endif
}

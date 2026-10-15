import Foundation
#if os(macOS)
import XCatIntegrationCore
import XLogCore

/// A synchronous actor reservation closes the gap between the two providers'
/// asynchronous attachment checks when connect IPC requests arrive together.
actor StationProviderClaim {
    static let shared = StationProviderClaim()
    private var owner: String?

    func reserve(_ provider: String) throws {
        guard owner == nil || owner == provider else {
            throw WorkerFailure("station_busy", "Disconnect the other station provider before connecting.")
        }
        owner = provider
    }

    func release(_ provider: String) {
        if owner == provider { owner = nil }
    }
}
#endif

/// The Mac worker talks to the real xCat loopback service. No values are
/// synthesized when that service or its radio is unavailable.
enum LiveStationMethods {
    static let methods: Set<String> = ["station_snapshot", "station_tune", "station_action",
                                       "station_connect", "station_disconnect", "station_reconnect",
                                       "station_forget", "station_configuration", "station_configuration_save",
                                       "station_radio_control", "station_rotor_snapshot", "station_rotor_connect", "station_rotor_disconnect",
                                       "station_rotor_goto", "station_rotor_stop", "station_add_spot", "station_cat_servers"]

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

    static func handle(_ method: String, params: [String: Any]) async throws -> [String: Any] {
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
        let selectedProvider = params["provider"] as? String ?? "xcat_loopback"
        if selectedProvider == "direct_flex_lan" {
            if method == "station_connect" {
                let remote = await LiveStationSession.shared.snapshot()
                guard remote["transport_state"] as? String == RadioConnectionState.stopped.rawValue,
                      remote["radio"] is NSNull else {
                    throw WorkerFailure("station_busy", "Disconnect the Remote Station Agent before connecting direct FLEX.")
                }
                try await StationProviderClaim.shared.reserve(selectedProvider)
            }
            do {
                let result = try await LiveFlexSession.shared.handle(method, params: params)
                if method == "station_disconnect" {
                    await StationProviderClaim.shared.release(selectedProvider)
                }
                return result
            } catch {
                if method == "station_connect", !(await LiveFlexSession.shared.isAttached()) {
                    await StationProviderClaim.shared.release(selectedProvider)
                }
                throw error
            }
        }
        if LiveStationSession.methods.contains(method) {
            guard selectedProvider == "direct_agent" else { throw invalidParams() }
            if method == "station_connect" {
                guard !(await LiveFlexSession.shared.isAttached()) else {
                    throw WorkerFailure("station_busy", "Disconnect direct FLEX before connecting the Remote Station Agent.")
                }
                try await StationProviderClaim.shared.reserve(selectedProvider)
            }
            do {
                let result = try await LiveStationSession.shared.handle(method, params: params)
                if method == "station_disconnect" {
                    await StationProviderClaim.shared.release(selectedProvider)
                } else if method == "station_forget" {
                    let state = await LiveStationSession.shared.snapshot()
                    if state["transport_state"] as? String == RadioConnectionState.stopped.rawValue,
                       state["radio"] is NSNull {
                        await StationProviderClaim.shared.release(selectedProvider)
                    }
                }
                return result
            } catch {
                if method == "station_connect" {
                    let state = await LiveStationSession.shared.snapshot()
                    if state["transport_state"] as? String == RadioConnectionState.stopped.rawValue,
                       state["radio"] is NSNull {
                        await StationProviderClaim.shared.release(selectedProvider)
                    }
                } else if method == "station_forget" {
                    let state = await LiveStationSession.shared.snapshot()
                    if state["transport_state"] as? String == RadioConnectionState.stopped.rawValue,
                       state["radio"] is NSNull {
                        await StationProviderClaim.shared.release(selectedProvider)
                    }
                }
                throw error
            }
        }
        let provider = selectedProvider
        if provider == "direct_agent" {
            guard Set(params.keys).isSubset(of: method == "station_tune"
                ? ["provider", "frequency_hz", "mode", "expected_generation"] : method == "station_action"
                ? ["provider", "action"] : ["provider"]) else { throw invalidParams() }
            if method == "station_snapshot" { return await LiveStationSession.shared.snapshot() }
            if method == "station_tune" {
                let target = try tuneTarget(params)
                let expected = try params["expected_generation"].map { raw -> UInt64 in
                    let value = try integer(raw)
                    guard (0...9_007_199_254_740_991).contains(value) else { throw invalidParams() }
                    return UInt64(value)
                }
                return try await LiveStationSession.shared.tune(frequencyHz: target.0, mode: target.1, expectedGeneration: expected)
            }
            guard let action = params["action"] as? String,
                  ["standby", "operate", "tune", "cancel"].contains(action) else { throw invalidParams() }
            return try await LiveStationSession.shared.action(action)
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
        case "FT8", "FT4", "FT2", "RTTY", "PSK", "DIGI": "DIGU"
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

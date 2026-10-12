#if os(macOS)
import Darwin
import Foundation
import XCatIntegrationCore

protocol FlexSessionRadio: RadioControlling {
    func start() async
    func reconnectNow() async
    func stopTransportOnly() async
    func transmitObservation() async -> FlexRadioClient.TransmitObservation?
    func rfPowerObservation() async -> FlexRadioClient.RFPowerObservation?
}

extension FlexRadioClient: FlexSessionRadio {}

/// Explicit direct-IP FLEX owner. A command ACK is never promoted to observed
/// success, and disconnect only sends RF release commands for this session's
/// own ambiguous or confirmed transmit attempts.
actor LiveFlexSession {
    struct Configuration: Sendable {
        let host: String
        let port: UInt16
        let stationName: String
        let allowTransmit: Bool
    }
    typealias Factory = @Sendable (
        Configuration,
        @escaping FlexRadioClient.StateHandler,
        @escaping FlexRadioClient.SnapshotHandler
    ) -> any FlexSessionRadio

    static let shared = LiveFlexSession()
    private let factory: Factory
    private let readbackTimeout: Duration
    private var radio: (any FlexSessionRadio)?
    private var configuration: Configuration?
    private var observed: RadioSnapshot?
    private var observedRevision: UInt64 = 0
    private var observedAt: Date?
    private var observedTransmit: Bool?
    private var observedPower: Int?
    private var transportState: RadioConnectionState = .stopped
    private var connectionGeneration: UInt64 = 0
    private var operationEpoch: UInt64 = 0
    private var activeControl = false
    private var transitioning = false
    private var terminal = false
    private var ownsPTT = false
    private var ownsCW = false
    private var ownsTune = false

    init(readbackTimeout: Duration = .seconds(4), factory: @escaping Factory = { config, onState, onSnapshot in
        FlexRadioClient(host: config.host, port: config.port, stationName: config.stationName,
                        sliceLetter: "A", onState: onState, onSnapshot: onSnapshot)
    }) {
        self.readbackTimeout = readbackTimeout
        self.factory = factory
    }

    func handle(_ method: String, params: [String: Any]) async throws -> [String: Any] {
        guard params["provider"] as? String == "direct_flex_lan" else { throw invalid() }
        if terminal { throw WorkerFailure("worker_stopping", "The direct FLEX session is shutting down.") }
        switch method {
        case "station_connect":
            let config = try Self.configuration(params)
            try await connect(config)
            return snapshot()
        case "station_disconnect":
            try keys(params, ["provider"])
            try await disconnect()
            return snapshot()
        case "station_reconnect":
            try keys(params, ["provider"])
            guard !transitioning, !activeControl, let radio else { throw busy() }
            operationEpoch &+= 1
            observed = nil
            observedAt = nil
            observedTransmit = nil
            observedPower = nil
            transportState = .connecting
            await radio.reconnectNow()
            return snapshot()
        case "station_snapshot":
            try keys(params, ["provider"])
            return snapshot()
        case "station_tune":
            try keys(params, ["provider", "frequency_hz", "mode"])
            guard let hz = Self.integer(params["frequency_hz"]), (100_000...1_000_000_000).contains(hz),
                  let requestedMode = params["mode"] as? String,
                  (1...12).contains(requestedMode.utf8.count),
                  requestedMode.utf8.allSatisfy({ (65...90).contains($0) || (48...57).contains($0) }) else { throw invalid() }
            return try await tune(hz, mode: Self.radioMode(requestedMode, frequencyHz: hz))
        case "station_radio_control":
            return try await control(params)
        case "station_action":
            try keys(params, ["provider", "action"])
            guard let action = params["action"] as? String else { throw invalid() }
            if action == "tune" { return try await transmit(on: true, tune: true) }
            if action == "cancel" { return try await transmit(on: false, tune: true) }
            throw WorkerFailure("station_action_blocked", "Amplifier operate and standby are not available through direct FLEX control.")
        default:
            throw WorkerFailure("method_not_allowed", "Unknown direct FLEX method.")
        }
    }

    func terminate() async {
        terminal = true
        try? await disconnect()
    }

    func isAttached() -> Bool { radio != nil || transitioning }

    private func connect(_ next: Configuration) async throws {
        guard !transitioning else { throw busy() }
        transitioning = true
        defer { transitioning = false }
        if radio != nil { try await retireCurrent() }
        guard !terminal else { throw WorkerFailure("worker_stopping", "The direct FLEX session is shutting down.") }
        connectionGeneration &+= 1
        let generation = connectionGeneration
        let newRadio = factory(next, { [weak self] state, _ in
            Task { await self?.recordState(state, generation: generation) }
        }, { [weak self] snapshot in
            Task { await self?.recordSnapshot(snapshot, generation: generation) }
        })
        radio = newRadio
        configuration = next
        observed = nil
        observedAt = nil
        observedTransmit = nil
        observedPower = nil
        transportState = .connecting
        await newRadio.start()
        guard !terminal, generation == connectionGeneration else {
            await newRadio.stopTransportOnly()
            throw WorkerFailure("station_superseded", "The direct FLEX connection changed before completion.")
        }
    }

    private func disconnect() async throws {
        guard !transitioning else { throw busy() }
        transitioning = true
        defer { transitioning = false }
        try await retireCurrent()
    }

    private func retireCurrent() async throws {
        operationEpoch &+= 1
        let deadline = ContinuousClock.now.advanced(by: .seconds(6))
        while activeControl && ContinuousClock.now < deadline {
            try? await Task.sleep(for: .milliseconds(25))
        }
        guard !activeControl else {
            throw WorkerFailure("station_busy", "A transmit control is still in flight; disconnect was not confirmed.")
        }
        guard let radio else { return }
        if ownsPTT || ownsCW || ownsTune { try await releaseOwned(radio) }
        await radio.stopTransportOnly()
        connectionGeneration &+= 1
        self.radio = nil
        configuration = nil
        observed = nil
        observedAt = nil
        observedTransmit = nil
        observedPower = nil
        transportState = .stopped
    }

    private func releaseOwned(_ radio: any FlexSessionRadio) async throws {
        var failed = false
        let revision = await radio.transmitObservation()?.revision ?? 0
        if ownsCW {
            do { try await radio.clearCW() } catch { failed = true }
        }
        // `setTransmit(false)` also cancels tune in the copied FLEX client.
        do { try await radio.setTransmit(false) } catch { failed = true }
        do {
            try await waitForTransmitObservation(radio, after: revision, epoch: nil, on: false)
        } catch { failed = true }
        guard !failed else {
            throw WorkerFailure("release_unconfirmed", "Owned FLEX transmit release was not observed; connection retained for retry.")
        }
        ownsPTT = false; ownsCW = false; ownsTune = false
    }

    private func tune(_ hz: Int64, mode: String) async throws -> [String: Any] {
        let (radio, epoch) = try beginControl(needsTransmit: false)
        defer { activeControl = false }
        guard let before = observed, before.isConnected, before.vfo("A") != nil else {
            throw WorkerFailure("station_unavailable", "Observed FLEX VFO A is unavailable; no tune command was sent.")
        }
        guard !(ownsPTT || ownsCW || ownsTune) else {
            throw WorkerFailure("station_action_blocked", "Stop and confirm transmit release before changing the FLEX VFO.")
        }
        try await requireTransmitIdle(radio)
        try requireEpoch(epoch)
        if Self.confirmsSimplex(before, frequencyHz: hz, mode: mode) {
            return ["accepted": true, "confirmed": true, "state": snapshot()]
        }
        if before.slice.uppercased() != "A" || before.vfo("A")?.isReceive != true {
            try await requireTransmitIdle(radio)
            try requireEpoch(epoch)
            let revision = observedRevision
            try await radio.setReceiveVFO(0)
            _ = try await waitForObservation(after: revision, epoch: epoch) {
                $0.isConnected && $0.slice.uppercased() == "A" && $0.vfo("A")?.isReceive == true
            }
        }
        try requireEpoch(epoch)
        guard observed?.vfo("A") != nil else { throw unavailable() }
        if observed?.transmitSlice.uppercased() != "A" || observed?.vfo("A")?.isTransmit != true {
            try await requireTransmitIdle(radio)
            try requireEpoch(epoch)
            let revision = observedRevision
            try await radio.setSplitTransmit(false)
            _ = try await waitForObservation(after: revision, epoch: epoch) {
                $0.isConnected && $0.transmitSlice.uppercased() == "A" && $0.vfo("A")?.isTransmit == true
            }
        }
        try requireEpoch(epoch)
        try await requireTransmitIdle(radio)
        try requireEpoch(epoch)
        let revision = observedRevision
        do {
            try await radio.setFrequencyAndMode(hz, mode: mode)
        } catch {
            throw WorkerFailure("station_rejected", "The direct FLEX tune was rejected or its outcome is uncertain.")
        }
        _ = try await waitForObservation(after: revision, epoch: epoch) {
            Self.confirmsSimplex($0, frequencyHz: hz, mode: mode)
        }
        return ["accepted": true, "confirmed": true, "state": snapshot()]
    }

    private func control(_ params: [String: Any]) async throws -> [String: Any] {
        guard let control = params["control"] as? String else { throw invalid() }
        switch control {
        case "ptt":
            try keys(params, ["provider", "control", "enabled"])
            guard let enabled = Self.bool(params["enabled"]) else { throw invalid() }
            return try await transmit(on: enabled, tune: false)
        case "send_cw":
            try keys(params, ["provider", "control", "text"])
            guard let text = params["text"] as? String, (1...128).contains(text.utf8.count),
                  text.unicodeScalars.allSatisfy({ (32...126).contains($0.value) && $0 != "|" }) else { throw invalid() }
            let (radio, epoch) = try beginControl(needsTransmit: true)
            defer { activeControl = false }
            try await requireTransmitIdle(radio)
            try requireEpoch(epoch)
            ownsCW = true
            do { try await radio.sendCW(text) }
            catch { throw WorkerFailure("station_rejected", "CW delivery was not confirmed; release ownership retained.") }
            try requireEpoch(epoch)
            return ["accepted": true, "confirmed": false, "control": control, "state": snapshot()]
        case "clear_cw":
            try keys(params, ["provider", "control"])
            guard ownsCW else { throw WorkerFailure("station_action_blocked", "This session has no CW transmission to clear.") }
            let (radio, epoch) = try beginControl(needsTransmit: false)
            defer { activeControl = false }
            let revision = await radio.transmitObservation()?.revision ?? 0
            try await radio.clearCW()
            try await waitForTransmitObservation(radio, after: revision, epoch: epoch, on: false)
            ownsCW = false; ownsPTT = false; ownsTune = false
            return ["accepted": true, "confirmed": true, "control": control, "state": snapshot()]
        case "set_cw_speed":
            try keys(params, ["provider", "control", "words_per_minute"])
            guard let speed = Self.integer(params["words_per_minute"]), (5...100).contains(speed) else { throw invalid() }
            let (radio, epoch) = try beginControl(needsTransmit: false)
            defer { activeControl = false }
            try await radio.setCWSpeed(Int(speed))
            try requireEpoch(epoch)
            return ["accepted": true, "confirmed": false, "control": control, "state": snapshot()]
        case "set_frequency_a", "set_frequency_b":
            try keys(params, ["provider", "control", "frequency_hz"])
            guard let hz = Self.integer(params["frequency_hz"]), (100_000...1_000_000_000).contains(hz) else { throw invalid() }
            let letter = control == "set_frequency_a" ? "A" : "B"
            let (radio, epoch) = try beginControl(needsTransmit: false)
            defer { activeControl = false }
            try await requireSafeReceiveMutation(radio, letter: letter, epoch: epoch)
            let revision = observedRevision
            do {
                if letter == "A" { try await radio.setPrimaryFrequency(hz) }
                else { try await radio.setSecondaryFrequency(hz) }
            } catch { throw rejectedControl() }
            _ = try await waitForObservation(after: revision, epoch: epoch) {
                $0.isConnected && $0.vfo(letter)?.frequencyHz == hz
            }
            return ["accepted": true, "confirmed": true, "control": control, "state": snapshot()]
        case "set_mode":
            try keys(params, ["provider", "control", "mode"])
            guard let mode = Self.mode(params["mode"]) else { throw invalid() }
            let (radio, epoch) = try beginControl(needsTransmit: false)
            defer { activeControl = false }
            try await requireSafeReceiveMutation(radio, letter: observed?.slice.uppercased() ?? "", epoch: epoch)
            let revision = observedRevision
            do { try await radio.setMode(mode) } catch { throw rejectedControl() }
            _ = try await waitForObservation(after: revision, epoch: epoch) {
                $0.isConnected && $0.mode.uppercased() == mode
            }
            return ["accepted": true, "confirmed": true, "control": control, "state": snapshot()]
        case "set_receive_vfo":
            try keys(params, ["provider", "control", "vfo"])
            guard let letter = params["vfo"] as? String, ["A", "B"].contains(letter) else { throw invalid() }
            let (radio, epoch) = try beginControl(needsTransmit: false)
            defer { activeControl = false }
            try await requireSafeReceiveMutation(radio, letter: letter, epoch: epoch)
            let revision = observedRevision
            do { try await radio.setReceiveVFO(letter == "A" ? 0 : 1) } catch { throw rejectedControl() }
            _ = try await waitForObservation(after: revision, epoch: epoch) {
                $0.isConnected && $0.slice.uppercased() == letter && $0.vfo(letter)?.isReceive == true
            }
            return ["accepted": true, "confirmed": true, "control": control, "state": snapshot()]
        case "set_split":
            try keys(params, ["provider", "control", "enabled"])
            guard let enabled = Self.bool(params["enabled"]) else { throw invalid() }
            let letter = enabled ? "B" : "A"
            let (radio, epoch) = try beginControl(needsTransmit: false)
            defer { activeControl = false }
            try await requireSafeReceiveMutation(radio, letter: letter, epoch: epoch)
            let revision = observedRevision
            do { try await radio.setSplitTransmit(enabled) } catch { throw rejectedControl() }
            _ = try await waitForObservation(after: revision, epoch: epoch) {
                $0.isConnected && $0.transmitSlice.uppercased() == letter && $0.vfo(letter)?.isTransmit == true
            }
            return ["accepted": true, "confirmed": true, "control": control, "state": snapshot()]
        case "set_rit", "set_xit":
            try keys(params, ["provider", "control", "enabled", "offset_hz", "vfo"])
            guard let enabled = Self.bool(params["enabled"]),
                  let offset = Self.integer(params["offset_hz"]), (-9_999...9_999).contains(offset),
                  params["vfo"] == nil || ["A", "B"].contains(params["vfo"] as? String ?? "") else { throw invalid() }
            let letter = params["vfo"] as? String ?? observed?.slice.uppercased() ?? ""
            let (radio, epoch) = try beginControl(needsTransmit: false)
            defer { activeControl = false }
            try await requireSafeReceiveMutation(radio, letter: letter, epoch: epoch)
            let revision = observedRevision
            do {
                if control == "set_rit" { try await radio.setRIT(enabled: enabled, offsetHz: Int(offset), vfo: letter) }
                else { try await radio.setXIT(enabled: enabled, offsetHz: Int(offset), vfo: letter) }
            } catch { throw rejectedControl() }
            _ = try await waitForObservation(after: revision, epoch: epoch) {
                guard let vfo = $0.vfo(letter) else { return false }
                return control == "set_rit" ? vfo.ritEnabled == enabled && vfo.ritOffsetHz == Int(offset)
                    : vfo.xitEnabled == enabled && vfo.xitOffsetHz == Int(offset)
            }
            return ["accepted": true, "confirmed": true, "control": control, "state": snapshot()]
        case "set_rf_power":
            try keys(params, ["provider", "control", "watts"])
            guard let watts = Self.integer(params["watts"]), (0...100).contains(watts) else { throw invalid() }
            let (radio, epoch) = try beginControl(needsTransmit: false)
            defer { activeControl = false }
            try await requireSafeReceiveMutation(radio, letter: observed?.slice.uppercased() ?? "", epoch: epoch)
            let revision = await radio.rfPowerObservation()?.revision ?? 0
            do { try await radio.setRFPower(Int(watts)) } catch { throw rejectedControl() }
            let power = try await waitForRFPowerObservation(radio, after: revision, epoch: epoch,
                                                             watts: Int(watts))
            observedPower = power.level
            return ["accepted": true, "confirmed": true, "control": control, "state": snapshot()]
        default:
            throw WorkerFailure("station_action_blocked", "This direct FLEX control is not yet supported.")
        }
    }

    private func requireSafeReceiveMutation(_ radio: any FlexSessionRadio, letter: String,
                                            epoch: UInt64) async throws {
        guard let observed, observed.isConnected, observed.vfo(letter) != nil else {
            throw WorkerFailure("station_unavailable", "The requested FLEX VFO is not observed; no control was sent.")
        }
        guard !(ownsPTT || ownsCW || ownsTune) else {
            throw WorkerFailure("station_action_blocked", "Stop and confirm transmit release before changing FLEX radio settings.")
        }
        try await requireTransmitIdle(radio)
        try requireEpoch(epoch)
    }

    private func requireTransmitIdle(_ radio: any FlexSessionRadio) async throws {
        guard let sample = await radio.transmitObservation(), sample.isConnected else {
            throw WorkerFailure("station_unavailable", "FLEX interlock receive state has not been observed.")
        }
        guard !sample.isTransmitting else {
            throw WorkerFailure("station_action_blocked", "FLEX radio is transmitting; receive-side controls are blocked.")
        }
    }

    private func rejectedControl() -> WorkerFailure {
        WorkerFailure("station_rejected", "FLEX control was rejected or its outcome is uncertain.")
    }

    private func transmit(on: Bool, tune: Bool) async throws -> [String: Any] {
        if !on && !(ownsPTT || ownsCW || ownsTune) {
            throw WorkerFailure("station_action_blocked", "This session does not own a transmit control to release.")
        }
        let (radio, epoch) = try beginControl(needsTransmit: on)
        defer { activeControl = false }
        let before = await radio.transmitObservation()
        let revision = before?.revision ?? 0
        if on {
            guard let before, before.isConnected else {
                throw WorkerFailure("station_unavailable", "FLEX interlock transmit state has not been observed.")
            }
            guard !before.isTransmitting else {
                throw WorkerFailure("station_action_blocked", "FLEX radio is already transmitting.")
            }
            try requireEpoch(epoch)
        }
        if on {
            if tune { ownsTune = true } else { ownsPTT = true }
        }
        do {
            if on && tune { try await radio.setTransmit(.tune) }
            else if !on && ownsCW {
                try await radio.clearCW()
                try await radio.setTransmit(false)
            }
            else { try await radio.setTransmit(on) }
        } catch {
            throw WorkerFailure("station_rejected", "FLEX transmit outcome is uncertain; release ownership retained.")
        }
        try await waitForTransmitObservation(radio, after: revision, epoch: epoch, on: on)
        if !on { ownsPTT = false; ownsCW = false; ownsTune = false }
        return ["accepted": true, "confirmed": true, "action": tune ? (on ? "tune" : "cancel") : "ptt",
                "state": snapshot()]
    }

    private func beginControl(needsTransmit: Bool) throws -> (any FlexSessionRadio, UInt64) {
        guard !transitioning, !activeControl, let radio,
              transportState == .ready, observed?.isConnected == true else { throw unavailable() }
        guard !needsTransmit || configuration?.allowTransmit == true else {
            throw WorkerFailure("station_action_blocked", "Explicit transmit opt-in is required for direct FLEX control.")
        }
        guard !needsTransmit || !(ownsPTT || ownsCW || ownsTune) else {
            throw WorkerFailure("station_action_blocked", "The FLEX radio is already transmitting or has an unresolved release.")
        }
        if needsTransmit, let observed {
            guard observed.vfo(observed.slice)?.isReceive == true,
                  observed.vfo(observed.transmitSlice)?.isTransmit == true else {
                throw WorkerFailure("station_unavailable", "FLEX receive/transmit slice ownership is not explicitly observed.")
            }
        }
        activeControl = true
        return (radio, operationEpoch)
    }

    private func waitForObservation(
        after revision: UInt64, epoch: UInt64?, timeout: Duration? = nil,
        matching: (RadioSnapshot) -> Bool
    ) async throws -> RadioSnapshot {
        let deadline = ContinuousClock.now.advanced(by: timeout ?? readbackTimeout)
        while ContinuousClock.now < deadline {
            try Task.checkCancellation()
            if let epoch { try requireEpoch(epoch) }
            if observedRevision > revision, transportState == .ready,
               let observed, matching(observed) { return observed }
            try await Task.sleep(for: .milliseconds(40))
        }
        throw WorkerFailure("station_timeout", "A fresh authoritative FLEX readback did not confirm the control.")
    }

    private func waitForTransmitObservation(_ radio: any FlexSessionRadio, after revision: UInt64,
                                            epoch: UInt64?, on: Bool) async throws {
        let deadline = ContinuousClock.now.advanced(by: readbackTimeout)
        while ContinuousClock.now < deadline {
            try Task.checkCancellation()
            if let epoch { try requireEpoch(epoch) }
            let sample = await radio.transmitObservation()
            if let sample, sample.revision > revision, sample.isConnected,
               sample.isTransmitting == on, transportState == .ready { return }
            try await Task.sleep(for: .milliseconds(40))
        }
        throw WorkerFailure("station_timeout", "A fresh FLEX interlock readback did not confirm transmit state.")
    }

    private func waitForRFPowerObservation(_ radio: any FlexSessionRadio, after revision: UInt64,
                                           epoch: UInt64, watts: Int) async throws -> FlexRadioClient.RFPowerObservation {
        let deadline = ContinuousClock.now.advanced(by: readbackTimeout)
        while ContinuousClock.now < deadline {
            try Task.checkCancellation()
            try requireEpoch(epoch)
            let sample = await radio.rfPowerObservation()
            try requireEpoch(epoch)
            if let sample, sample.revision > revision, sample.isConnected,
               sample.level == watts, transportState == .ready { return sample }
            try await Task.sleep(for: .milliseconds(40))
        }
        throw WorkerFailure("station_timeout", "A fresh FLEX RF-power status did not confirm the requested setting.")
    }

    private func requireEpoch(_ epoch: UInt64) throws {
        guard epoch == operationEpoch, !terminal, radio != nil else {
            throw WorkerFailure("station_superseded", "The direct FLEX session changed during the operation.")
        }
    }

    private func recordState(_ state: RadioConnectionState, generation: UInt64) {
        guard generation == connectionGeneration else { return }
        transportState = state
        if state != .ready {
            operationEpoch &+= 1
            observed = nil
            observedAt = nil
            observedTransmit = nil
            observedPower = nil
        }
    }

    private func recordSnapshot(_ snapshot: RadioSnapshot, generation: UInt64) async {
        let sample = await radio?.transmitObservation()
        let power = await radio?.rfPowerObservation()
        guard generation == connectionGeneration else { return }
        observed = snapshot
        observedRevision &+= 1
        observedAt = Date()
        observedTransmit = sample?.isTransmitting
        observedPower = power?.isConnected == true ? power?.level : nil
    }

    private func snapshot() -> [String: Any] {
        let current = transportState == .ready && observed?.isConnected == true ? observed : nil
        let radioProjection: Any = current.map { value in
            ["observed": true, "connected": true, "frequency_hz": value.frequencyHz,
             "mode": value.mode, "receive_frequency_hz": value.frequencyHz,
             "transmit_frequency_hz": value.transmitFrequencyHz,
             "receive_vfo": value.vfo(value.slice)?.isReceive == true ? value.slice as Any : NSNull(),
             "transmit_vfo": value.vfo(value.transmitSlice)?.isTransmit == true ? value.transmitSlice as Any : NSNull(),
             "split": value.vfo(value.slice)?.isReceive == true && value.vfo(value.transmitSlice)?.isTransmit == true
                 ? (value.slice != value.transmitSlice || value.frequencyHz != value.transmitFrequencyHz) as Any : NSNull(),
             "transmitting": observedTransmit as Any? ?? NSNull(),
              "rf_power_level": observedPower as Any? ?? NSNull(),
             "observed_at": observedAt?.timeIntervalSince1970 as Any? ?? NSNull(),
             "received_at": observedAt?.timeIntervalSince1970 as Any? ?? NSNull(),
             "vfos": value.vfos.map { vfo in
                 ["letter": vfo.letter, "frequency_hz": vfo.frequencyHz, "mode": vfo.mode,
                  "receive": vfo.isReceive, "transmit": vfo.isTransmit] as [String: Any]
             }] as [String: Any]
        } ?? NSNull()
        return ["source": "direct_flex_lan", "available": current != nil,
                "transport_state": transportState.rawValue, "generated_at": Date().timeIntervalSince1970,
                "radio": radioProjection, "station": NSNull(), "rotor": NSNull(),
                "propagation": NSNull(), "allow_transmit": configuration?.allowTransmit ?? false,
                "capabilities": ["supported_commands": supportedCommands(current),
                                 "unavailable_commands": observedPower == nil
                                     ? ["set_rit", "set_xit", "set_rf_power", "station_cat_servers"]
                                     : ["set_rit", "set_xit", "station_cat_servers"],
                                 "requires_transmit_opt_in": true] as [String: Any]]
    }

    private func supportedCommands(_ current: RadioSnapshot?) -> [String] {
        var result = ["station_snapshot", "station_tune", "station_connect", "station_disconnect",
                      "station_reconnect", "set_frequency_a", "set_mode", "set_receive_vfo",
                      "set_split", "set_cw_speed", "ptt", "send_cw", "clear_cw", "tune", "cancel"]
        if current?.vfo("B") != nil { result.append("set_frequency_b") }
        if current != nil && observedPower != nil { result.append("set_rf_power") }
        return result.sorted()
    }

    static func confirmsSimplex(_ value: RadioSnapshot, frequencyHz: Int64, mode: String) -> Bool {
        value.isConnected && value.frequencyHz == frequencyHz && value.transmitFrequencyHz == frequencyHz
            && value.mode.uppercased() == mode && value.slice.uppercased() == "A"
            && value.transmitSlice.uppercased() == "A"
            && value.vfo("A")?.isReceive == true && value.vfo("A")?.isTransmit == true
    }

    private static func radioMode(_ mode: String, frequencyHz: Int64) -> String {
        switch mode {
        case "SSB": frequencyHz < 10_000_000 ? "LSB" : "USB"
        case "FT8", "FT4", "FT2", "RTTY", "PSK", "DIGI": "DIGU"
        default: mode
        }
    }

    private static func mode(_ value: Any?) -> String? {
        guard let mode = value as? String, (1...12).contains(mode.utf8.count),
              mode.utf8.allSatisfy({ (65...90).contains($0) || (48...57).contains($0) }) else { return nil }
        return mode
    }

    private static func configuration(_ params: [String: Any]) throws -> Configuration {
        guard Set(params.keys) == ["provider", "host", "station_name"] ||
              Set(params.keys) == ["provider", "host", "station_name", "port"] ||
              Set(params.keys) == ["provider", "host", "station_name", "allow_transmit"] ||
              Set(params.keys) == ["provider", "host", "station_name", "port", "allow_transmit"],
              let host = params["host"] as? String, privateIP(host),
              let stationName = params["station_name"] as? String,
              (1...64).contains(stationName.utf8.count),
              stationName.unicodeScalars.allSatisfy({ (32...126).contains($0.value) && $0 != "|" }),
              let portNumber = params["port"].map(integer) ?? 4992,
              (1...65535).contains(portNumber),
              params["allow_transmit"] == nil || bool(params["allow_transmit"]) != nil else { throw invalid() }
        return Configuration(host: host, port: UInt16(portNumber), stationName: stationName,
                             allowTransmit: bool(params["allow_transmit"]) ?? false)
    }

    private static func privateIP(_ host: String) -> Bool {
        guard !host.isEmpty, host.utf8.count <= 64, !host.contains("%") else { return false }
        var v4 = in_addr()
        if host.withCString({ inet_pton(AF_INET, $0, &v4) }) == 1 {
            let bytes = withUnsafeBytes(of: &v4) { Array($0) }
            return bytes[0] == 10 || bytes[0] == 127 ||
                (bytes[0] == 172 && (16...31).contains(bytes[1])) ||
                (bytes[0] == 192 && bytes[1] == 168) ||
                (bytes[0] == 169 && bytes[1] == 254) ||
                (bytes[0] == 100 && (64...127).contains(bytes[1]))
        }
        var v6 = in6_addr()
        guard host.withCString({ inet_pton(AF_INET6, $0, &v6) }) == 1 else { return false }
        let bytes = withUnsafeBytes(of: &v6) { Array($0) }
        return (bytes[0] & 0xfe) == 0xfc ||
            (bytes[0] == 0xfe && (bytes[1] & 0xc0) == 0x80) ||
            bytes.dropFirst(15).first == 1 && bytes.prefix(15).allSatisfy({ $0 == 0 })
    }

    private func keys(_ params: [String: Any], _ allowed: Set<String>) throws {
        guard Set(params.keys).isSubset(of: allowed) else { throw Self.invalid() }
    }
    private static func integer(_ value: Any?) -> Int64? {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
        let numeric = number.doubleValue
        guard numeric.isFinite, numeric.rounded() == numeric,
              numeric >= Double(Int64.min), numeric < 9_223_372_036_854_775_808 else { return nil }
        return number.int64Value
    }
    private static func bool(_ value: Any?) -> Bool? {
        guard let number = value as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() else { return nil }
        return number.boolValue
    }
    private static func invalid() -> WorkerFailure { WorkerFailure("invalid_params", "Invalid direct FLEX parameters.") }
    private func invalid() -> WorkerFailure { Self.invalid() }
    private func unavailable() -> WorkerFailure { WorkerFailure("station_unavailable", "Connect and observe the direct FLEX radio first.") }
    private func busy() -> WorkerFailure { WorkerFailure("station_busy", "Another direct FLEX lifecycle operation is in progress.") }
}
#endif

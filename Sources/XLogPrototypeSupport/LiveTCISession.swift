import Foundation
#if os(macOS)
import XCatIntegrationCore

/// Worker-owned TCI adapter. Receive controls and finite TCI 2.1 PTT/CW share
/// one configured session, native admission and authoritative TRX readback.
actor LiveTCISession {
    private static let receiveFrequencyRange = 100_000...1_000_000_000
    struct Configuration: Sendable {
        let endpoint: URL
        let address: TCIReceiverAddress
        let allowTransmit: Bool
    }
    typealias Factory = @Sendable (Configuration) -> TCIReadOnlyWebSocketSession
    static let shared = LiveTCISession()
    private let factory: Factory
    private let claim: StationProviderClaim
    private let clock: @Sendable () -> Date
    private var session: TCIReadOnlyWebSocketSession?
    private var connectionID: UUID?
    private var generation: UInt64 = 0
    private var sequence: UInt64 = 0
    private var observation: TCIReadOnlySessionObservation?
    private var receivedAt: Date?
    private var updates: Task<Void, Never>?
    private var observationHeartbeat:Task<Void,Never>?
    private var terminal = false
    private var allowTransmit=false
    private var pttOwner:String?
    private var pttPending=false
    private var pttReleaseRequired=false
    private var pttConfirmed=false
    private var cwOwned=false
    private var outputRevision:UInt64=0
    private var nativeIntent:Int=0
    private var outputTRXBaseline:UInt64=0
    private var cwSawTX=false
    private var outputConnectionGeneration:UInt64=0
    private var pendingOutputRevision:UInt64?

    init(claim: StationProviderClaim = .shared, clock: @escaping @Sendable () -> Date = { Date() },
         factory: @escaping Factory = { TCIReadOnlyWebSocketSession(endpoint: $0.endpoint, configuredAddress: $0.address) }) {
        self.claim = claim; self.clock = clock; self.factory = factory
    }

    func handle(_ method: String, params: [String: Any]) async throws -> [String: Any] {
        guard params["provider"] as? String == "direct_tci" else { throw invalid() }
        switch method {
        case "station_snapshot":
            guard Set(params.keys) == ["provider"] else { throw invalid() }
            return snapshot()
        case "station_connect":
            let configuration = try Self.configuration(params)
            guard !terminal else { throw WorkerFailure("worker_stopping", "TCI observation is shutting down.") }
            guard session == nil, connectionID == nil else { throw WorkerFailure("station_busy", "Disconnect TCI before connecting again.") }
            try advanceGeneration()
            let id = UUID(); connectionID = id; sequence = 0; observation = nil; receivedAt = nil
            do {
                try await claim.reserve("direct_tci", lease: id)
                guard !terminal, connectionID == id else { throw cancelled() }
                let active = factory(configuration); session = active
                allowTransmit=configuration.allowTransmit
                let stream = await active.observations()
                guard !terminal, connectionID == id else { await active.disconnect(); throw cancelled() }
                updates = Task { [weak self] in
                    for await value in stream {
                        guard !Task.isCancelled else { return }
                        await self?.record(value, connectionID: id)
                    }
                }
                try await active.connect()
                guard !terminal, connectionID == id else { await active.disconnect(); throw cancelled() }
                let value = await active.currentObservation()
                guard !terminal, connectionID == id else { await active.disconnect(); throw cancelled() }
                record(value, connectionID: id)
                observationHeartbeat=Task{[weak self] in
                    while !Task.isCancelled {
                        do{try await Task.sleep(for:.seconds(1))}catch{return}
                        guard !Task.isCancelled else{return}
                        await self?.refreshOutputObservation(connectionID:id)
                    }
                }
                return snapshot()
            } catch {
                if connectionID == id {
                    updates?.cancel(); updates = nil
                    let closing = session; session = nil; connectionID = nil
                    observation = nil; receivedAt = nil
                    await closing?.disconnect()
                }
                await claim.release("direct_tci", lease: id)
                if let failure = error as? WorkerFailure { throw failure }
                throw WorkerFailure("station_unavailable", "TCI connection failed; no automatic retry was started.")
            }
        case "station_disconnect":
            guard Set(params.keys) == ["provider"] else { throw invalid() }
            try advanceGeneration()
            await disconnect()
            return snapshot()
        case "station_tune":
            guard Set(params.keys) == ["provider", "frequency_hz", "mode", "expected_generation"],
                  !terminal,
                  let active = session,
                  let id = connectionID,
                  let expected = Self.integer(params["expected_generation"]),
                  expected >= 0,
                  UInt64(expected) == generation else { throw invalid() }
            let (frequencyHz, mode) = try Self.tuneTarget(params)
            let transportGeneration = (await active.currentObservation()).generation
            do {
                let confirmed = try await active.tuneReceive(
                    frequencyHz: frequencyHz,
                    mode: mode,
                    expectedGeneration: transportGeneration
                )
                guard !terminal, connectionID == id, session === active else { throw cancelled() }
                record(confirmed, connectionID: id)
                let state = snapshot()
                guard let radio = state["radio"] as? [String: Any],
                      radio["frequency_hz"] as? Int64 == frequencyHz,
                      radio["mode"] as? String == mode,
                      radio["transmitting"] as? Bool == false else {
                    throw WorkerFailure("station_superseded", "The authoritative TCI receive target changed before completion.")
                }
                return ["accepted": true, "confirmed": true, "state": state]
            } catch let failure as WorkerFailure {
                throw failure
            } catch let failure as TCITuneSessionError {
                throw Self.tuneFailure(failure)
            } catch {
                throw WorkerFailure("station_unknown", "TCI tune outcome is unknown. No tune was replayed.")
            }
        case "station_receive_filter":
            guard Set(params.keys) == ["provider", "lower_hz", "upper_hz", "expected_generation"],
                  !terminal, let active = session, let id = connectionID,
                  let expected = Self.integer(params["expected_generation"]), expected >= 0, UInt64(expected) == generation,
                  let lower = Self.integer(params["lower_hz"]), let upper = Self.integer(params["upper_hz"]),
                  (-24_000...24_000).contains(lower), (-24_000...24_000).contains(upper), lower < upper else { throw invalid() }
            let transportGeneration = (await active.currentObservation()).generation
            do {
                let confirmed = try await active.adjustReceiveFilter(lowerHz: Int64(lower), upperHz: Int64(upper), expectedGeneration: transportGeneration)
                guard !terminal, connectionID == id, session === active else { throw cancelled() }
                record(confirmed, connectionID: id)
                let state = snapshot()
                guard let tci = state["tci"] as? [String: Any],
                      tci["filter_lower_hz"] as? Int64 == Int64(lower), tci["filter_upper_hz"] as? Int64 == Int64(upper),
                      (state["radio"] as? [String: Any])?["transmitting"] as? Bool == false else { throw cancelled() }
                return ["accepted": true, "confirmed": true, "state": state]
            } catch let failure as TCITuneSessionError { throw Self.tuneFailure(failure) }
        case "station_radio_control":
            return try await radioControl(params)
        case "station_transmit_permission":
            // Disable only. Re-enabling is an explicit new saved connection.
            // Native orchestration invokes the canonical CW Stop / durable PTT
            // release after this barrier; obligations remain retained here.
            guard Set(params.keys)==["provider","expected_generation","allow_transmit"],params["allow_transmit"] as? Bool==false,
                  let expected=Self.integer(params["expected_generation"]),expected>=0,UInt64(expected)==generation,!terminal,session != nil else{throw invalid()}
            allowTransmit=false;outputRevision &+= 1;pendingOutputRevision=nil
            return ["disabled":true,"state":snapshot()]
        case "station_add_spot":
            guard Set(params.keys) == ["provider", "spot"], !terminal,
                  let active = session, let id = connectionID,
                  let payload = params["spot"] as? [String: Any],
                  Set(payload.keys) == ["frequency_hz", "callsign", "mode", "source", "spotter",
                                        "comment", "timestamp", "lifetime_seconds", "priority", "color_hex"],
                  let frequency = Self.integer(payload["frequency_hz"]), Self.receiveFrequencyRange.contains(frequency),
                  let timestamp = Self.integer(payload["timestamp"]),
                  timestamp >= Int(Date().timeIntervalSince1970) - 86_400,
                  timestamp <= Int(Date().timeIntervalSince1970) + 300,
                  let lifetime = Self.integer(payload["lifetime_seconds"]), (30...86_400).contains(lifetime),
                  let priority = Self.integer(payload["priority"]), (1...5).contains(priority),
                  let callsign = Self.spotText(payload["callsign"], maximum: 32, required: true),
                  let mode = Self.spotText(payload["mode"], maximum: 16, required: true),
                  let source = Self.spotText(payload["source"], maximum: 32, required: true),
                  let spotter = Self.spotText(payload["spotter"], maximum: 32, required: false),
                  let comment = Self.spotText(payload["comment"], maximum: 96, required: false),
                  let color = payload["color_hex"] as? String,
                  color.range(of: #"^#[0-9A-Fa-f]{6}$"#, options: .regularExpression) != nil else { throw invalid() }
            let transportGeneration = (await active.currentObservation()).generation
            do {
                try await active.addSpot(frequencyHz: Int64(frequency), callsign: callsign, mode: mode,
                                         source: source, spotter: spotter, comment: comment, colorHex: color,
                                         expectedGeneration: transportGeneration)
                guard !terminal, connectionID == id, session === active else { throw cancelled() }
                return ["accepted": true, "confirmed": false, "state": snapshot()]
            } catch let failure as TCITuneSessionError { throw Self.tuneFailure(failure) }
        case "station_remove_spot":
            guard Set(params.keys) == ["provider", "callsign", "frequency_hz"], !terminal,
                  let active = session, let id = connectionID,
                  let frequency = Self.integer(params["frequency_hz"]), Self.receiveFrequencyRange.contains(frequency),
                  let callsign = Self.spotText(params["callsign"], maximum: 32, required: true) else { throw invalid() }
            let transportGeneration = (await active.currentObservation()).generation
            do {
                try await active.deleteSpot(callsign: callsign, expectedGeneration: transportGeneration)
                guard !terminal, connectionID == id, session === active else { throw cancelled() }
                return ["accepted": true, "confirmed": false, "state": snapshot()]
            } catch let failure as TCITuneSessionError { throw Self.tuneFailure(failure) }
        default:
            throw WorkerFailure("method_not_allowed", "TCI permits explicit connection, receive controls, spots and admitted TCI 2.1 PTT/CW.")
        }
    }

    func terminate() async { terminal = true; await disconnect() }
    func isAttached() -> Bool { connectionID != nil || session != nil }


    private func disconnect() async {
        let closing = session, id = connectionID
        connectionID = nil; session = nil; updates?.cancel(); updates = nil
        observationHeartbeat?.cancel();observationHeartbeat=nil
        observation = nil; receivedAt = nil; sequence = 0
        allowTransmit=false;outputRevision &+= 1
        // Do not erase a physical release obligation on a disconnected socket.
        if pttReleaseRequired || cwOwned {pttConfirmed=false;pttPending=false}
        await closing?.disconnect()
        if let id { await claim.release("direct_tci", lease: id) }
    }
    private func advanceGeneration() throws {
        guard generation < 9_007_199_254_740_991 else { throw WorkerFailure("station_changed", "TCI generation exhausted.") }
        generation += 1
    }
    private func record(_ value: TCIReadOnlySessionObservation, connectionID id: UUID) {
        guard !terminal, connectionID == id, value.sequence > sequence else { return }
        sequence = value.sequence; observation = value; receivedAt = value.evidenceReceivedAt
        if let transmitting=value.snapshot?.transceiver.transmitting,value.trxEvidenceSequence>outputTRXBaseline,!pttPending,outputConnectionGeneration==generation {
            if pttOwner != nil {pttConfirmed = transmitting == pttReleaseRequired}
            if cwOwned && transmitting{cwSawTX=true}
            if cwOwned && cwSawTX && !transmitting {cwOwned=false;cwSawTX=false}
        }
    }
    private func refreshOutputObservation(connectionID id:UUID)async {
        guard !terminal,connectionID==id,let active=session else{return}
        let transportGeneration=await active.currentObservation().generation
        try? await active.refreshTransmitObservation(expectedGeneration:transportGeneration)
    }
    private func radioControl(_ params:[String:Any]) async throws->[String:Any]{
        guard let control=params["control"] as? String,let expected=Self.integer(params["expected_generation"]),expected>=0,UInt64(expected)==generation,
              !terminal,let active=session,let id=connectionID else{throw invalid()}
        let release=control=="clear_cw" || control=="ptt" && params["enabled"] as? Bool==false
        var keys:Set<String>=["provider","control","expected_generation"]
        let command:TCIOutboundCommand
        let owner:String?
        var retiredBeforeAcquisition=false
        switch control {
        case "ptt":
            keys.formUnion(["enabled","source","ptt_owner_id","expected_native_intent"])
            guard params["source"] as? String=="gui",let enabled=params["enabled"] as? Bool,
                  let owned=params["ptt_owner_id"] as? String,UUID(uuidString:owned) != nil,
                  let state=observation?.snapshot,
                  let intent=Self.integer(params["expected_native_intent"]),(1...9_007_199_254_740_991).contains(intent),intent>nativeIntent else{throw invalid()}
            owner=owned
            if enabled {
                guard !pttReleaseRequired,!cwOwned else{throw blocked("An earlier output/release obligation must be resolved.")}
            }else if pttReleaseRequired && pttOwner != owned{throw blocked("PTT off must address the retained original owner.")}
            else if !pttReleaseRequired{retiredBeforeAcquisition=true}
            nativeIntent=intent
            command = .setTRX(trx:state.address.trx,enabled:enabled)
        case "send_cw":
            keys.insert("text");guard let text=params["text"] as? String,let state=observation?.snapshot else{throw invalid()}
            guard !pttReleaseRequired,!cwOwned else{throw blocked("Wait for current CW or use Stop.")}
            owner=nil;command = .sendCW(trx:state.address.trx,text:text)
        case "clear_cw":
            owner=nil;command = .stopCW
        case "set_cw_speed":
            keys.insert("words_per_minute");guard let wpm=Self.integer(params["words_per_minute"]),!pttReleaseRequired,!cwOwned else{throw invalid()}
            owner=nil;command = .setCWMacrosSpeed(wpm:wpm)
        default:throw WorkerFailure("method_not_allowed","This TCI output operation is unsupported.")
        }
        guard Set(params.keys)==keys else{throw invalid()}
        guard let state=observation?.snapshot,state.protocolAnnouncement.version=="2.1",
              state.protocolAnnouncement.program.lowercased()=="expertsdr3",state.receiveOnly==false else{throw blocked("This TCI server version has no qualified output contract.")}
        if control != "ptt",state.trxCount != 1{throw blocked("CW Stop and macro speed are global; select a one-TRX TCI server configuration.")}
        if !release {
            guard state.transceiver.transmitEnabled==true,state.transceiver.transmitting==false,
                  let stamp=observation?.trxEvidenceReceivedAt,(-1...3).contains(clock().timeIntervalSince(stamp)) else{throw blocked("Output requires fresh addressed RX and server TX_ENABLE.")}
        }
        if case let .sendCW(_,text)=command {
            guard !text.trimmingCharacters(in:.whitespaces).isEmpty,text.utf8.count<=128,
                  text.utf8.allSatisfy({(65...90).contains($0)||(48...57).contains($0)||Array(" /?=+.,-".utf8).contains($0)}),
                  ["CW","CWR"].contains(state.transceiver.modulation ?? "") else{throw invalid()}
        }
        if case let .setCWMacrosSpeed(wpm)=command,!(1...60).contains(wpm){throw invalid()}
        guard release || allowTransmit else{throw blocked("Enable TCI transmit permission in saved radio setup and reconnect deliberately.")}
        guard release || pendingOutputRevision==nil else{throw blocked("A TCI output command is still pending; Stop remains available.")}
        outputRevision &+= 1
        let revision=outputRevision
        if release {pendingOutputRevision=nil}else{pendingOutputRevision=revision}
        defer{if pendingOutputRevision==revision{pendingOutputRevision=nil}}
        outputTRXBaseline=observation?.trxEvidenceSequence ?? 0
        outputConnectionGeneration=generation
        if control=="ptt"{if !release{pttOwner=owner;pttReleaseRequired=true};pttPending=true;pttConfirmed=false}
        if control=="send_cw"{cwOwned=true;cwSawTX=false}
        let transportGeneration=await active.currentObservation().generation
        guard connectionID==id,outputRevision==revision else{throw cancelled()}
        if retiredBeforeAcquisition {
            // Off overtook its queued On: retire the ordinal and request RX
            // evidence, without switching an unrelated CAT/CW transmitter off.
            pttOwner=owner;pttPending=false;pttConfirmed=false
            try? await active.refreshTransmitObservation(expectedGeneration:transportGeneration)
            return ["accepted":true,"control":"ptt","enabled":false,"owner_id":owner as Any,"confirmed":false,"state":snapshot()]
        }
        do {
            let confirmed=try await active.transmit(command,expectedGeneration:transportGeneration)
            guard connectionID==id,session===active,outputRevision==revision else{throw cancelled()}
            record(confirmed,connectionID:id)
            if control=="ptt"{pttPending=false;pttConfirmed=true;pttReleaseRequired = !release}
            if control=="clear_cw" {
                // Socket acknowledgement alone cannot establish idle. Retain
                // native CW ownership until a newer addressed RX report.
                cwOwned=confirmed.snapshot?.transceiver.transmitting != false
            }
            let state=snapshot()
            if control=="ptt"{return ["accepted":true,"control":"ptt","enabled":!release,"owner_id":owner as Any,"confirmed":true,"state":state]}
            return ["accepted":true,"control":control,"confirmed":control=="clear_cw","state":state]
        }catch{
            if connectionID==id,outputRevision==revision{pttPending=false;pttConfirmed=false}
            if let failure=error as? WorkerFailure{throw failure}
            if let failure=error as? TCITuneSessionError{throw Self.tuneFailure(failure)}
            throw WorkerFailure("station_unknown","TCI output outcome is unknown; use Stop, do not replay.")
        }
    }
    private func blocked(_ message:String)->WorkerFailure{WorkerFailure("station_action_blocked",message)}
    private func snapshot() -> [String: Any] {
        let state = observation?.availability == .available ? observation?.snapshot : nil
        let fresh = receivedAt.map { (-1...5).contains(clock().timeIntervalSince($0)) } ?? false
        let protocolSupported=state?.protocolAnnouncement.version=="2.1" && state?.protocolAnnouncement.program.lowercased()=="expertsdr3" && state?.receiveOnly==false
        let cwSupported=protocolSupported && state?.trxCount==1
        let commands = (state == nil ? [String]() : ["station_tune", "station_add_spot", "station_remove_spot"]
            + (state?.transceiver.receiveFilter == nil ? [] : ["station_receive_filter"])
            ) + (protocolSupported ? ["ptt"]:[]) + (cwSupported ? ["send_cw","clear_cw","set_cw_speed"]:[])
        let radio: Any = state.map { s in
            ["connected": true, "observed": true, "frequency_hz": s.frequencyHz,
             "receive_frequency_hz": s.frequencyHz, "mode": s.transceiver.modulation as Any? ?? NSNull(),
             "transmit_frequency_hz": NSNull(), "receive_vfo": NSNull(), "transmit_vfo": NSNull(),
             "split": s.transceiver.splitEnabled as Any? ?? NSNull(),
             "transmitting": s.transceiver.transmitting as Any? ?? NSNull(),
             "rf_power_level": NSNull(), "vfos": [],
             "observed_at": receivedAt?.timeIntervalSince1970 as Any? ?? NSNull(),
             "received_at": receivedAt?.timeIntervalSince1970 as Any? ?? NSNull()] as [String: Any]
        } ?? NSNull()
        let transport: String = switch observation?.availability {
        case .connecting: "connecting"
        case .synchronizing: "synchronizing"
        case .available: "ready"
        default: "stopped"
        }
        let ptt: [String: Any] = ["source":"gui","owner_id":pttOwner as Any? ?? NSNull(),
                "pending":pttPending,"confirmed":pttConfirmed,"release_required":pttReleaseRequired,
                "transmitting":state?.transceiver.transmitting as Any? ?? NSNull()]
        let station: [String: Any] = ["available": false, "commissioned": false, "radio_known": state != nil,
                            "radio_stale": !fresh || state == nil, "allowed_actions": [String](),
                             "supported_commands": commands]
        let capabilities: [String: Any] = ["read_only": false, "receive_control_only": !protocolSupported,
                                 "supported_commands": commands,
                                  "requires_transmit_opt_in": true]
        let outputReason: String = !protocolSupported ? "Requires ExpertSDR3 TCI 2.1 transceiver." : !allowTransmit ? "Transmit permission is off." : !cwSupported ? "CW requires one TRX because Stop and speed are server-global." : "Requires fresh addressed RX and server TX_ENABLE; RF is unverified."
        let tci: [String: Any] = ["read_only": false, "receive_control_only": !protocolSupported,
                        "transmit_enabled":state?.transceiver.transmitEnabled as Any? ?? NSNull(),
                        "trx_observed_at":observation?.trxEvidenceReceivedAt?.timeIntervalSince1970 as Any? ?? NSNull(),
                        "cw_macros_speed":observation?.cwMacrosSpeed as Any? ?? NSNull(),
                        "cw_owned":cwOwned,"output_supported":protocolSupported,"cw_supported":cwSupported,
                        "output_reason":outputReason,
                        "observation_sequence": sequence,
                        "filter_lower_hz": state?.transceiver.receiveFilter?.lowHz as Any? ?? NSNull(),
                        "filter_upper_hz": state?.transceiver.receiveFilter?.highHz as Any? ?? NSNull(),
                        "filter_scope": "trx",
                         "split_observed_at": state == nil ? NSNull() : observation?.splitEvidenceReceivedAt?.timeIntervalSince1970 as Any? ?? NSNull(),
                        "availability": observation?.availability.rawValue ?? "unavailable",
                        "failure": failureCode(observation?.failure),
                        "trx": state?.address.trx as Any? ?? NSNull(), "channel": state?.address.channel as Any? ?? NSNull(),
                        "device": state?.device as Any? ?? NSNull(), "receive_only": state?.receiveOnly as Any? ?? NSNull(),
                        "program": state?.protocolAnnouncement.program as Any? ?? NSNull(), "protocol_version": state?.protocolAnnouncement.version as Any? ?? NSNull(),
                        "trx_count": state?.trxCount as Any? ?? NSNull(), "channel_count": state?.channelCount as Any? ?? NSNull(),
                        "supported_modulations": state?.supportedModulations as Any? ?? NSNull()]
        return ["source": "direct_tci", "available": state != nil, "generation": generation,
                "transport_state": transport, "generated_at": receivedAt?.timeIntervalSince1970 as Any? ?? NSNull(),
                "radio": radio, "allow_transmit": allowTransmit,
                "carrier_tune":["pending":false,"release_required":false], "ptt":ptt,
                "station":station, "capabilities":capabilities,
                "rotor": NSNull(), "propagation": NSNull(), "tci":tci]
    }
    private func failureCode(_ failure: TCIReadOnlySessionFailure?) -> Any {
        switch failure {
        case .connectionFailed: "connection_failed"
        case .transportClosed: "transport_closed"
        case .protocolViolation: "protocol_violation"
        case .binaryMessageTooLarge: "binary_message_too_large"
        case nil: NSNull()
        }
    }
    private static func configuration(_ params: [String: Any]) throws -> Configuration {
        guard Set(params.keys).subtracting(["allow_transmit"]) == ["provider", "endpoint", "trx", "channel"],
              params["allow_transmit"] == nil || params["allow_transmit"] is Bool,
              let text = params["endpoint"] as? String, text.utf8.count <= 2048,
              text == text.trimmingCharacters(in: .whitespacesAndNewlines), text.rangeOfCharacter(from: .controlCharacters) == nil,
              let parts = URLComponents(string: text), let url = parts.url,
              ["ws", "wss"].contains(parts.scheme?.lowercased() ?? ""), parts.host?.isEmpty == false,
              parts.user == nil, parts.password == nil, parts.query == nil, parts.fragment == nil,
              parts.port.map({ (1...65535).contains($0) }) ?? true,
              let trx = integer(params["trx"]), let channel = integer(params["channel"]),
              (0..<TCIProtocolLimits.default.maximumTRXCount).contains(trx),
              (0..<TCIProtocolLimits.default.maximumChannelCount).contains(channel) else { throw invalid() }
        return Configuration(endpoint: url, address: TCIReceiverAddress(trx: trx, channel: channel),allowTransmit:params["allow_transmit"] as? Bool ?? false)
    }
    private static func integer(_ raw: Any?) -> Int? {
        guard let raw, let bytes = try? JSONSerialization.data(withJSONObject: [raw]),
              let values = try? JSONDecoder().decode([Int].self, from: bytes) else { return nil }
        return values.first
    }
    private static func spotText(_ raw: Any?, maximum: Int, required: Bool) -> String? {
        guard let value = raw as? String,
              value.utf8.count <= maximum,
              value.rangeOfCharacter(from: .controlCharacters) == nil else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return required && trimmed.isEmpty ? nil : trimmed
    }
    private static func tuneTarget(_ params: [String: Any]) throws -> (Int64, String) {
        guard let frequency = integer(params["frequency_hz"]),
              receiveFrequencyRange.contains(frequency),
              let rawMode = params["mode"] as? String,
              !rawMode.isEmpty, rawMode.utf8.count <= 16,
              rawMode.utf8.allSatisfy({ (48...57).contains($0) || (65...90).contains($0) }) else {
            throw invalid()
        }
        let mode: String = switch rawMode {
        case "SSB": frequency < 10_000_000 ? "LSB" : "USB"
        case "FT8", "FT4", "FT2", "RTTY", "JTTY", "PSK", "DIGI": "DIGU"
        default: rawMode
        }
        return (Int64(frequency), mode)
    }
    private static func tuneFailure(_ failure: TCITuneSessionError) -> WorkerFailure {
        switch failure {
        case .invalidTarget:
            WorkerFailure("invalid_params", "TCI rejected the requested receive target.")
        case .notReady, .staleObservation:
            WorkerFailure("station_unavailable", "TCI requires a fresh READY observation before receive control.")
        case .transmitting:
            WorkerFailure("station_action_blocked", "TCI receive control is blocked while transmit state is not authoritatively off.")
        case .commandInFlight:
            WorkerFailure("station_busy", "A TCI receive control is already awaiting readback.")
        case .connectionChanged, .transportClosed:
            WorkerFailure("station_unknown", "TCI disconnected during receive control; its outcome is unknown and was not replayed.")
        case .readbackTimedOut:
            WorkerFailure("station_timeout", "TCI did not confirm the requested receive target; no control was replayed.")
        }
    }
    private static func invalid() -> WorkerFailure { WorkerFailure("invalid_params", "Invalid TCI parameters.") }
    private func invalid() -> WorkerFailure { Self.invalid() }
    private func cancelled() -> WorkerFailure { WorkerFailure("station_superseded", "TCI connection was retired before completion.") }
}
#endif

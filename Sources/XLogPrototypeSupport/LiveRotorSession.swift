#if os(macOS)
import Foundation
import CoreFoundation
import XCatIntegrationCore

/// A rotor transport has its own lifetime, independent of either radio owner.
/// Closing it is a queue barrier, not proof that the antenna has stopped moving.
protocol RotorTransport: AnyObject, Sendable {
    func start()
    func stopAndDrain() async
    func turn(to bearing: Double) async throws
    func stopRotation() async throws
}

extension DCU1RotatorClient: RotorTransport {}

actor LiveRotorSession {
    static let shared = LiveRotorSession()
    typealias Factory = @Sendable (String, UInt16, @escaping DCU1RotatorClient.StateHandler,
                                   @escaping DCU1RotatorClient.AzimuthHandler) -> any RotorTransport

    private let factory: Factory
    private var client: (any RotorTransport)?
    private var state: DCU1RotatorClient.State = .stopped
    private var name = "Rotor"
    private var status = "Disconnected"
    private var azimuth: Double?
    private var observedAt: Date?
    private var generation: UInt64 = 0
    private var observation = RotorObservation()
    private var commandRevision: UInt64 = 0
    private var retirement: Task<Void, Never>?
    private var terminalShutdown = false

    init(factory: @escaping Factory = { host, port, onState, onAzimuth in
        DCU1RotatorClient(host: host, port: port, pollMilliseconds: 500,
                          onState: onState, onAzimuth: onAzimuth)
    }) {
        self.factory = factory
    }

    func handle(_ method: String, params: [String: Any]) async throws -> [String: Any] {
        try requireActive()
        switch method {
        case "station_rotor_snapshot":
            try requireKeys(params, allowed: ["provider"])
            return projection()
        case "station_rotor_connect":
            try requireKeys(params, allowed: ["provider", "host", "port", "name"])
            let host = try LiveStationSession.validatedRotorHost(params["host"])
            guard let port = try Self.integer(params["port"]), (1...65_535).contains(port) else {
                throw Self.invalidParams()
            }
            let requestedName = (params["name"] as? String ?? "Rotor").trimmingCharacters(in: .whitespacesAndNewlines)
            guard params["name"] == nil || params["name"] is String,
                  (1...64).contains(requestedName.utf8.count) else { throw Self.invalidParams() }
            guard client == nil, retirement == nil else {
                throw WorkerFailure("station_busy", "Disconnect the current DCU-1 rotor before connecting again.")
            }
            generation &+= 1
            let captured = generation
            let next = factory(host, UInt16(port),
                { [weak self] newState, _ in Task { await self?.recordState(newState, generation: captured) } },
                { [weak self] value in Task { await self?.recordAzimuth(value, generation: captured) } })
            client = next
            name = requestedName
            state = .connecting
            status = "Connecting"
            next.start()
            return projection()
        case "station_rotor_disconnect":
            try requireKeys(params, allowed: ["provider"])
            await retire()
            return projection()
        case "station_rotor_goto":
            try requireKeys(params, allowed: ["provider", "bearing", "label"])
            guard let number = params["bearing"] as? NSNumber,
                  CFGetTypeID(number) != CFBooleanGetTypeID(),
                  number.doubleValue.isFinite, (0...360).contains(number.doubleValue),
                  params["label"] == nil || params["label"] is String else { throw Self.invalidParams() }
            guard state == .connected, let client else {
                throw WorkerFailure("station_unavailable", "The rotor is not connected.")
            }
            commandRevision &+= 1
            let revision = commandRevision, captured = generation
            do { try await client.turn(to: number.doubleValue) }
            catch { throw WorkerFailure("station_rejected", "The rotor rejected the turn command.") }
            guard captured == generation, revision == commandRevision else { throw changed() }
            let label = (params["label"] as? String).map { String($0.prefix(64)) } ?? "Manual bearing"
            observation.request(number.doubleValue, label: label)
            return ["accepted": true, "confirmed": false, "action": "rotor_goto"]
        case "station_rotor_stop":
            try requireKeys(params, allowed: ["provider"])
            guard state == .connected, let client else {
                throw WorkerFailure("station_unavailable", "The rotor is not connected.")
            }
            commandRevision &+= 1
            let revision = commandRevision, captured = generation
            do { try await client.stopRotation() }
            catch { throw WorkerFailure("station_rejected", "The rotor rejected the stop command.") }
            guard captured == generation, revision == commandRevision else { throw changed() }
            observation.stopRequested()
            return ["accepted": true, "confirmed": false, "action": "rotor_stop"]
        default:
            throw WorkerFailure("method_not_allowed", "Rotor method is not available.")
        }
    }

    func projection() -> [String: Any] {
        ["connected": state == .connected, "name": name,
         "status": state == .connected ? observation.status : status,
         "azimuth": Self.optional(azimuth), "observed_at": Self.optional(observedAt?.timeIntervalSince1970),
         "target_bearing": Self.optional(observation.target), "target_label": observation.label,
         "moving": Self.optional(observation.moving), "motion_direction": Self.optional(observation.direction)]
    }

    func isAttached() -> Bool { client != nil }

    func terminate() async {
        terminalShutdown = true
        await retire()
    }

    private func retire() async {
        if let retirement {
            await retirement.value
            return
        }
        generation &+= 1
        commandRevision &+= 1
        let previous = client
        client = nil
        state = .stopped
        status = "Disconnected"
        azimuth = nil
        observedAt = nil
        observation = RotorObservation()
        let drain = Task<Void, Never> { if let previous { await previous.stopAndDrain() } }
        retirement = drain
        await drain.value
        retirement = nil
    }

    private func recordState(_ next: DCU1RotatorClient.State, generation captured: UInt64) {
        guard client != nil, captured == generation else { return }
        state = next
        status = next.rawValue.capitalized
        if next != .connected { azimuth = nil; observedAt = nil }
    }

    private func recordAzimuth(_ value: Double, generation captured: UInt64) {
        guard client != nil, captured == generation, state == .connected,
              value.isFinite, (0...360).contains(value) else { return }
        azimuth = value
        observedAt = Date()
        observation.observe(value)
    }

    private func requireActive() throws {
        guard !terminalShutdown else {
            throw WorkerFailure("worker_stopping", "The rotor service is shutting down; no new command was started.")
        }
    }

    private func requireKeys(_ params: [String: Any], allowed: Set<String>) throws {
        guard Set(params.keys).isSubset(of: allowed), params["provider"] as? String == "direct_agent" else {
            throw Self.invalidParams()
        }
    }

    private static func integer(_ raw: Any?) throws -> Int64? {
        guard let raw else { return nil }
        guard let value = raw as? NSNumber, CFGetTypeID(value) != CFBooleanGetTypeID(),
              value.doubleValue.isFinite, value.doubleValue.rounded() == value.doubleValue,
              value.doubleValue >= Double(Int64.min), value.doubleValue < Double(Int64.max) else {
            throw invalidParams()
        }
        return value.int64Value
    }

    private static func optional(_ value: Any?) -> Any { value ?? NSNull() }
    private static func invalidParams() -> WorkerFailure {
        WorkerFailure("invalid_params", "Invalid direct rotor parameters.")
    }
    private func changed() -> WorkerFailure {
        WorkerFailure("station_changed", "The rotor owner changed during the request; no outcome is confirmed.")
    }
}
#endif

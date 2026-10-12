#if os(macOS)
import Foundation
import CoreFoundation
import XCatIntegrationCore

protocol SpotDatagramReceiving: AnyObject {
    func start(port: UInt16) throws
    func stop()
}

extension UDPSpotReceiver: SpotDatagramReceiving {}

/// Admit datagrams before allocating an async task. Actor isolation alone
/// does not bound the number of payloads retained in its mailbox.
final class SpotIngressGate: @unchecked Sendable {
    private let lock = NSLock()
    private let limit: Int
    private var pending = 0
    private var dropped = 0
    init(limit: Int = 128) { self.limit = limit }
    func admit(bytes: Int) -> Bool {
        lock.lock(); defer { lock.unlock() }
        guard bytes > 0, bytes <= 16_384, pending < limit else {
            dropped += 1; return false
        }
        pending += 1
        return true
    }
    func finish() {
        lock.lock(); defer { lock.unlock() }
        pending -= 1
    }
    var droppedCount: Int {
        lock.lock(); defer { lock.unlock() }
        return dropped
    }
}

/// One dedupe and delivery boundary for RUMlog UDP and xCluster FLEX spots.
/// A reservation is rolled back on rejected or uncertain delivery; success
/// means a matching Remote Agent ACK, never visual confirmation on the radio.
actor SpotForwardBroker {
    static let shared = SpotForwardBroker { spot in
        let payload: [String: Any] = [
            "frequency_hz": spot.frequencyHz, "callsign": spot.callsign,
            "mode": spot.mode, "source": spot.source, "spotter": spot.spotter,
            "comment": spot.comment, "timestamp": spot.timestamp,
            "lifetime_seconds": spot.lifetimeSeconds, "priority": spot.priority,
            "color_hex": spot.colorHex
        ]
        let result = try await LiveStationMethods.handle("station_add_spot", params: [
            "provider": "direct_agent", "spot": payload
        ])
        guard result["accepted"] as? Bool == true else {
            throw WorkerFailure("station_rejected", "The Remote Station Agent did not accept the spot.")
        }
    }

    private let deliver: @Sendable (FlexSpot) async throws -> Void
    private var accepted: [String: (at: Date, priority: Int)] = [:]
    private var pending: Set<String> = []

    init(deliver: @escaping @Sendable (FlexSpot) async throws -> Void) {
        self.deliver = deliver
    }

    /// Returns false for a duplicate or an already-pending matching spot.
    func forward(_ spot: FlexSpot, now: Date = Date()) async throws -> Bool {
        let key = "\(spot.callsign)|\(spot.frequencyHz)"
        accepted = accepted.filter { now.timeIntervalSince($0.value.at) < 180 }
        if accepted.count >= 4_096 {
            for old in accepted.sorted(by: { $0.value.at < $1.value.at }).prefix(1_024) {
                accepted.removeValue(forKey: old.key)
            }
        }
        if let prior = accepted[key], prior.priority >= spot.priority { return false }
        guard pending.count < 256 else {
            throw WorkerFailure("spot_broker_busy", "Spot forwarding is busy; retry after the current deliveries settle.")
        }
        // A higher-priority copy arriving while this exact callsign/frequency
        // is in flight is deliberately suppressed, never reported as accepted.
        // A repeated higher-priority spot after ACK replaces the lower style.
        guard pending.insert(key).inserted else { return false }
        defer { pending.remove(key) }
        try await deliver(spot)
        accepted[key] = (now, spot.priority)
        if accepted.count > 4_096 {
            for old in accepted.sorted(by: { $0.value.at < $1.value.at }).prefix(1_024) {
                accepted.removeValue(forKey: old.key)
            }
        }
        return true
    }

    func cacheSizeForTesting() -> Int { accepted.count }
}

/// Opt-in loopback-only RUMlog Logbook/Contest UDP ingestion owned by the xLog
/// worker. The native parser and eleven original style categories are reused.
public actor LiveSpotBridge {
    public static let shared = LiveSpotBridge()

    private let configurationURL: URL
    private let broker: SpotForwardBroker
    private let workspaceAvailable: @Sendable () throws -> Bool
    private let receiverFactory: @Sendable (SpotFeed, @escaping @Sendable (Data) -> Void,
                                            @escaping @Sendable (String) -> Void) -> SpotDatagramReceiving
    private var configuration: SpotBridgeConfiguration?
    private var logbookReceiver: SpotDatagramReceiving?
    private var contestReceiver: SpotDatagramReceiving?
    private var receiverGeneration: UUID?
    private var receivedCount = 0
    private var acceptedCount = 0
    private var rejectedCount = 0
    private var duplicateCount = 0
    private var status = "Off"
    private let ingress = SpotIngressGate()

    init(configurationURL: URL? = nil, broker: SpotForwardBroker = .shared,
         workspaceAvailable: @escaping @Sendable () throws -> Bool = {
             (try LiveLogbookMethods.shared.handle(method: "workspace_status", params: [:]))["workspace_exists"] as? Bool == true
         },
         receiverFactory: @escaping @Sendable (SpotFeed, @escaping @Sendable (Data) -> Void,
                                               @escaping @Sendable (String) -> Void) -> SpotDatagramReceiving = { feed, handler, event in
             UDPSpotReceiver(label: "com.om0rx.xlog.rumlog.\(feed.rawValue.lowercased())",
                             onDatagram: handler, onEvent: event)
         }) {
        self.configurationURL = configurationURL ?? LiveLogbookMethods.shared.workspaceDirectoryURL
            .appendingPathComponent("spot-bridge.json")
        self.broker = broker
        self.workspaceAvailable = workspaceAvailable
        self.receiverFactory = receiverFactory
    }

    public func handle(method: String, params: [String: Any]) async throws -> [String: Any] {
        switch method {
        case "spot_bridge_snapshot":
            try require(params, allowed: [])
            return try snapshot()
        case "spot_bridge_configure":
            try require(params, allowed: ["configuration"], required: ["configuration"])
            try requireWorkspace()
            guard let object = params["configuration"] as? [String: Any] else { throw invalid() }
            let next = try decodeConfiguration(object)
            try validate(next)
            try save(next)
            configuration = next
            if !next.enabled { stopReceivers() }
            else if logbookReceiver != nil || contestReceiver != nil { stopReceivers(); status = "Settings saved; restart listeners." }
            return try snapshot()
        case "spot_bridge_start":
            try require(params, allowed: [])
            try requireWorkspace()
            let config = try load()
            guard config.enabled else {
                throw WorkerFailure("spot_bridge_disabled", "Enable the RUMlog spot bridge before starting listeners.")
            }
            try startReceivers(config)
            return try snapshot()
        case "spot_bridge_stop":
            try require(params, allowed: [])
            stopReceivers()
            var config = try load()
            config.enabled = false
            if (try? workspaceExists()) == true { try save(config) }
            configuration = config
            status = "Off"
            return try snapshot()
        default:
            throw WorkerFailure("method_not_allowed", "Unknown RUMlog spot bridge method.")
        }
    }

    public func stopForShutdown() {
        stopReceivers()
        status = "Worker stopped"
    }

    func ingest(_ data: Data, feed: SpotFeed) async {
        guard let generation = receiverGeneration else { return }
        await ingest(data, feed: feed, generation: generation)
    }

    private func ingest(_ data: Data, feed: SpotFeed, generation: UUID) async {
        guard receiverGeneration == generation, logbookReceiver != nil,
              contestReceiver != nil, configuration?.enabled == true else { return }
        receivedCount += 1
        guard !data.isEmpty, data.count <= 16_384 else {
            rejectedCount += 1
            status = "Rejected an oversized or empty UDP spot."
            return
        }
        do {
            let parsed = try RUMlogSpotParser.parse(data, feed: feed)
            let config = try load()
            let spot = try parsed.flexSpot(feed: feed, style: config.style(for: parsed.category))
            let now = Int64(Date().timeIntervalSince1970)
            guard spot.timestamp >= now - 86_400, spot.timestamp <= now + 300 else { throw invalid() }
            guard receiverGeneration == generation else { return }
            if try await broker.forward(spot) {
                guard receiverGeneration == generation else { return }
                acceptedCount += 1
                status = "Accepted by Remote Station Agent; FLEX display is not verified."
            } else {
                guard receiverGeneration == generation else { return }
                duplicateCount += 1
                status = "Duplicate or pending spot suppressed; no new acceptance confirmed."
            }
        } catch {
            guard receiverGeneration == generation else { return }
            rejectedCount += 1
            status = "Spot rejected or forwarding unavailable; no FLEX success confirmed."
        }
    }

    private func startReceivers(_ config: SpotBridgeConfiguration) throws {
        if logbookReceiver != nil || contestReceiver != nil { return }
        let generation = UUID()
        receiverGeneration = generation
        let ingress = self.ingress
        let logbook = receiverFactory(.logbook, { [weak self] data in
            guard ingress.admit(bytes: data.count) else { return }
            Task {
                defer { ingress.finish() }
                await self?.ingest(data, feed: .logbook, generation: generation)
            }
        }, { [weak self] event in
            Task { await self?.receiverEvent(event, generation: generation) }
        })
        let contest = receiverFactory(.contest, { [weak self] data in
            guard ingress.admit(bytes: data.count) else { return }
            Task {
                defer { ingress.finish() }
                await self?.ingest(data, feed: .contest, generation: generation)
            }
        }, { [weak self] event in
            Task { await self?.receiverEvent(event, generation: generation) }
        })
        do {
            try logbook.start(port: config.logbookPort)
            try contest.start(port: config.contestPort)
            logbookReceiver = logbook
            contestReceiver = contest
            status = "Listening on loopback UDP \(config.logbookPort) and \(config.contestPort)."
        } catch {
            logbook.stop()
            contest.stop()
            receiverGeneration = nil
            status = "Could not bind both RUMlog ports exclusively; no listener is active."
            throw WorkerFailure("spot_bridge_bind_failed", status)
        }
    }

    private func stopReceivers() {
        receiverGeneration = nil
        logbookReceiver?.stop()
        contestReceiver?.stop()
        logbookReceiver = nil
        contestReceiver = nil
    }

    private func receiverEvent(_ event: String, generation: UUID) {
        guard receiverGeneration == generation else { return }
        if event.hasPrefix("UDP listener failed:") {
            stopReceivers()
            status = "RUMlog UDP listener failed; both feeds stopped. Restart after resolving the port conflict."
        }
    }

    private func snapshot() throws -> [String: Any] {
        let config = try load()
        let styles = Dictionary(uniqueKeysWithValues: DXSpotCategory.allCases.map { category in
            let style = config.style(for: category)
            return (category.rawValue, ["priority": style.priority,
                                        "colorHex": style.colorHex,
                                        "lifetimeSeconds": style.lifetimeSeconds] as [String: Any])
        })
        let object: [String: Any] = ["enabled": config.enabled,
                                     "logbookPort": Int(config.logbookPort),
                                     "contestPort": Int(config.contestPort),
                                     "styles": styles]
        return ["configuration": object, "running": logbookReceiver != nil && contestReceiver != nil,
                "received_count": receivedCount, "accepted_count": acceptedCount,
                "rejected_count": rejectedCount, "duplicate_count": duplicateCount,
                "dropped_count": ingress.droppedCount,
                "status": status, "display_confirmed": false]
    }

    private func load() throws -> SpotBridgeConfiguration {
        if let configuration { return configuration }
        try validatePath()
        guard FileManager.default.fileExists(atPath: configurationURL.path) else {
            let initial = SpotBridgeConfiguration(enabled: false)
            configuration = initial
            return initial
        }
        let data = try Data(contentsOf: configurationURL)
        guard data.count <= 16_384 else { throw invalid() }
        let value = try JSONDecoder().decode(SpotBridgeConfiguration.self, from: data)
        try validate(value)
        configuration = value
        return value
    }

    private func save(_ value: SpotBridgeConfiguration) throws {
        try validatePath()
        let directory = configurationURL.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                                                attributes: [.posixPermissions: 0o700])
        try JSONEncoder().encode(value).write(to: configurationURL, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: configurationURL.path)
    }

    private func validatePath() throws {
        for url in [configurationURL.deletingLastPathComponent(), configurationURL] {
            if FileManager.default.fileExists(atPath: url.path),
               try url.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink == true {
                throw WorkerFailure("unsafe_configuration", "Spot bridge configuration cannot use a symbolic link.")
            }
        }
    }

    private func workspaceExists() throws -> Bool {
        try workspaceAvailable()
    }

    private func requireWorkspace() throws {
        guard try workspaceExists() else {
            throw WorkerFailure("workspace_required", "Create the integrated workspace before enabling the RUMlog spot bridge.")
        }
    }

    private func validate(_ value: SpotBridgeConfiguration) throws {
        guard value.logbookPort >= 1_024, value.contestPort >= 1_024,
              value.logbookPort != value.contestPort,
              value.styles.count <= DXSpotCategory.allCases.count,
              value.styles.values.allSatisfy({ (1...5).contains($0.priority) &&
                  (30...86_400).contains($0.lifetimeSeconds) &&
                  $0.colorHex.range(of: #"^#[0-9A-Fa-f]{6}$"#, options: .regularExpression) != nil }) else {
            throw invalid()
        }
    }

    private func decodeConfiguration(_ object: [String: Any]) throws -> SpotBridgeConfiguration {
        guard Set(object.keys) == ["enabled", "logbookPort", "contestPort", "styles"],
              let enabledNumber = object["enabled"] as? NSNumber,
              CFGetTypeID(enabledNumber) == CFBooleanGetTypeID(),
              let logbookPort = exactInteger(object["logbookPort"]),
              let contestPort = exactInteger(object["contestPort"]),
              (1_024...65_535).contains(logbookPort), (1_024...65_535).contains(contestPort),
              let rawStyles = object["styles"] as? [String: Any],
              Set(rawStyles.keys) == Set(DXSpotCategory.allCases.map(\.rawValue)) else { throw invalid() }
        var styles: [DXSpotCategory: SpotStyle] = [:]
        for category in DXSpotCategory.allCases {
            guard let raw = rawStyles[category.rawValue] as? [String: Any],
                  Set(raw.keys) == ["priority", "colorHex", "lifetimeSeconds"],
                  let priority = exactInteger(raw["priority"]), (1...5).contains(priority),
                  let colorHex = raw["colorHex"] as? String,
                  colorHex.range(of: #"^#[0-9A-Fa-f]{6}$"#, options: .regularExpression) != nil,
                  let lifetime = exactInteger(raw["lifetimeSeconds"]),
                  (30...86_400).contains(lifetime) else { throw invalid() }
            styles[category] = SpotStyle(priority: priority, colorHex: colorHex,
                                         lifetimeSeconds: lifetime)
        }
        let config = SpotBridgeConfiguration(enabled: enabledNumber.boolValue,
                                             logbookPort: UInt16(logbookPort),
                                             contestPort: UInt16(contestPort), styles: styles)
        try validate(config)
        return config
    }

    private func exactInteger(_ value: Any?) -> Int? {
        guard let number = value as? NSNumber,
              CFGetTypeID(number) != CFBooleanGetTypeID(),
              number.doubleValue.isFinite,
              number.doubleValue.rounded(.towardZero) == number.doubleValue,
              number.doubleValue >= Double(Int.min),
              number.doubleValue < Double(Int.max),
              Int64(exactly: number.doubleValue) == number.int64Value else { return nil }
        return Int(exactly: number.int64Value)
    }

    private func require(_ params: [String: Any], allowed: Set<String>, required: Set<String> = []) throws {
        guard Set(params.keys).isSubset(of: allowed), required.isSubset(of: Set(params.keys)) else { throw invalid() }
    }

    private func invalid() -> WorkerFailure {
        WorkerFailure("invalid_params", "Invalid RUMlog spot bridge configuration or request.")
    }
}
#endif

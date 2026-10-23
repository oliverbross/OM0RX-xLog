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

/// One dedupe and delivery boundary for RUMlog UDP and xCluster radio spots.
/// A reservation is rolled back on rejected or uncertain delivery; success
/// means a matching Remote Agent ACK, never visual confirmation on the radio.
actor SpotForwardBroker {
    private struct InventoryEntry: Codable, Equatable {
        let provider: String
        let radioID: String
        let callsign: String
        let frequencyHz: Int64
        let owner: String
        let acceptedAt: TimeInterval

        var key: String { "\(provider)|\(radioID)|\(callsign)|\(frequencyHz)" }
    }
    private struct InventoryDocument: Codable {
        let version: Int
        var spots: [InventoryEntry]
    }

    private static let defaultInventoryURL = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("OM0RX-xLog Integration Services", isDirectory: true)
        .appendingPathComponent("forwarded-radio-spots.json")
    static let shared = SpotForwardBroker(inventoryURL: defaultInventoryURL, targetedDeliver: { spot, provider, preferredRadioID in
        let payload: [String: Any] = [
            "frequency_hz": spot.frequencyHz, "callsign": spot.callsign,
            "mode": spot.mode, "source": spot.source, "spotter": spot.spotter,
            "comment": spot.comment, "timestamp": spot.timestamp,
            "lifetime_seconds": spot.lifetimeSeconds, "priority": spot.priority,
            "color_hex": spot.colorHex
        ]
        var lastError: Error?
        for radioID in preferredRadioID.map({ [$0] }) ?? ["radio1", "radio2"] {
            do {
                let result = try await LiveStationMethods.handle("station_add_spot", params: [
                    "provider": provider, "radio_id": radioID, "spot": payload
                ])
                guard result["accepted"] as? Bool == true else {
                    throw WorkerFailure("station_rejected", "The selected radio did not accept the spot.")
                }
                return radioID
            } catch { lastError = error }
        }
        throw lastError ?? WorkerFailure("station_rejected", "No configured radio accepted the spot.")
    }, targetedRemove: { spot, provider, acceptedRadioID in
        guard let radioID = acceptedRadioID else {
            throw WorkerFailure("station_rejected", "The accepted radio identity for this xLog spot is unavailable.")
        }
        let result = try await LiveStationMethods.handle("station_remove_spot", params: [
            "provider": provider, "radio_id": radioID,
            "callsign": spot.callsign, "frequency_hz": spot.frequencyHz,
        ])
        guard result["accepted"] as? Bool == true else {
            throw WorkerFailure("station_rejected", "The selected radio did not remove the spot.")
        }
    })

    private let deliver: @Sendable (FlexSpot, String, String?) async throws -> String?
    private let removeDelivery: @Sendable (FlexSpot, String, String?) async throws -> Void
    private let inventoryURL: URL?
    private var accepted: [String: (at: Date, priority: Int, radioID: String?)] = [:]
    private var recentRemovalTargets: [String: (radioID: String, at: Date)] = [:]
    private var pending: Set<String> = []
    private var pendingWaiters: [String: [CheckedContinuation<Void, Never>]] = [:]

    init(deliver: @escaping @Sendable (FlexSpot, String) async throws -> Void,
         remove: @escaping @Sendable (FlexSpot, String) async throws -> Void = { _, _ in
             throw WorkerFailure("station_action_blocked", "This spot transport does not support removal.")
         }) {
        self.inventoryURL = nil
        self.deliver = { spot, provider, _ in try await deliver(spot, provider); return nil }
        self.removeDelivery = { spot, provider, _ in try await remove(spot, provider) }
    }

    init(inventoryURL: URL,
         targetedDeliver: @escaping @Sendable (FlexSpot, String, String?) async throws -> String,
         targetedRemove: @escaping @Sendable (FlexSpot, String, String?) async throws -> Void) {
        self.inventoryURL = inventoryURL
        self.deliver = targetedDeliver
        self.removeDelivery = targetedRemove
    }

    init(deliver: @escaping @Sendable (FlexSpot) async throws -> Void) {
        self.inventoryURL = nil
        self.deliver = { spot, _, _ in try await deliver(spot); return nil }
        self.removeDelivery = { _, _, _ in
            throw WorkerFailure("station_action_blocked", "This spot transport does not support removal.")
        }
    }

    /// Returns false for a duplicate or an already-pending matching spot.
    func forward(_ spot: FlexSpot, provider: String = "direct_agent", now: Date = Date(),
                 replacingExisting: Bool = false) async throws -> Bool {
        let key = "\(provider)|\(spot.callsign)|\(spot.frequencyHz)"
        accepted = accepted.filter { now.timeIntervalSince($0.value.at) < 180 }
        if accepted.count >= 4_096 {
            for old in accepted.sorted(by: { $0.value.at < $1.value.at }).prefix(1_024) {
                accepted.removeValue(forKey: old.key)
            }
        }
        // Contest scoring can change a retained spot from multiplier to QSO or
        // dupe without changing its callsign/frequency. The contest publisher
        // owns its own unchanged-signature fence, so an explicitly changed
        // classification must be allowed to repaint the radio spot.
        let recentRemoval = recentRemovalTargets.removeValue(forKey: key)
        var preferredRadioID = accepted[key]?.radioID ?? recentRemoval.flatMap {
            now.timeIntervalSince($0.at) < 30 ? $0.radioID : nil
        }
        if replacingExisting {
            while pending.contains(key) {
                await withCheckedContinuation { pendingWaiters[key, default: []].append($0) }
            }
            preferredRadioID = accepted[key]?.radioID ?? preferredRadioID
            accepted.removeValue(forKey: key)
        }
        if let prior = accepted[key], prior.priority >= spot.priority { return false }
        preferredRadioID = accepted[key]?.radioID ?? preferredRadioID
        guard pending.count < 256 else {
            throw WorkerFailure("spot_broker_busy", "Spot forwarding is busy; retry after the current deliveries settle.")
        }
        // A higher-priority copy arriving while this exact callsign/frequency
        // is in flight is deliberately suppressed, never reported as accepted.
        // A repeated higher-priority spot after ACK replaces the lower style.
        guard pending.insert(key).inserted else { return false }
        defer { finishPending(key) }
        let radioID = try await deliver(spot, provider, preferredRadioID)
        accepted[key] = (now, spot.priority, radioID)
        if let radioID {
            do { try persistAccepted(spot, provider: provider, radioID: radioID, acceptedAt: now) }
            catch {
                accepted.removeValue(forKey: key)
                try? await removeDelivery(spot, provider, radioID)
                throw error
            }
        }
        if accepted.count > 4_096 {
            for old in accepted.sorted(by: { $0.value.at < $1.value.at }).prefix(1_024) {
                accepted.removeValue(forKey: old.key)
            }
        }
        return true
    }

    func remove(_ spot: FlexSpot, provider: String = "direct_agent") async throws -> Bool {
        let key = "\(provider)|\(spot.callsign)|\(spot.frequencyHz)"
        while pending.contains(key) {
            await withCheckedContinuation { pendingWaiters[key, default: []].append($0) }
        }
        guard pending.count < 256 else {
            throw WorkerFailure("spot_broker_busy", "Spot forwarding is busy; retry after the current deliveries settle.")
        }
        guard pending.insert(key).inserted else { return false }
        defer { finishPending(key) }
        let radioID: String?
        if let acceptedRadioID = accepted[key]?.radioID { radioID = acceptedRadioID }
        else { radioID = try persistedRadioID(for: spot, provider: provider) }
        try await removeDelivery(spot, provider, radioID)
        accepted.removeValue(forKey: key)
        if let radioID {
            recentRemovalTargets[key] = (radioID, Date())
            if recentRemovalTargets.count > 4_096 { recentRemovalTargets.removeAll(keepingCapacity: true) }
            try removePersisted(spot, provider: provider, radioID: radioID)
        }
        return true
    }

    /// Contest startup invokes this before publishing its first authoritative
    /// snapshot. Only exact spots previously accepted from xLog's Normal
    /// Logging owner are withdrawn; third-party and contest-owned spots are not
    /// addressed.
    func withdrawNormalForwardedSpots() async throws -> Int {
        try await withdrawForwardedSpots(owner: "normal_logging")
    }

    /// A replacement Contest worker invokes this before publishing its first
    /// authoritative snapshot so spots retained after a failed prior shutdown
    /// are removed using their durable radio identities.
    func withdrawContestForwardedSpots() async throws -> Int {
        try await withdrawForwardedSpots(owner: "contesting")
    }

    private func withdrawForwardedSpots(owner: String) async throws -> Int {
        var document = try loadInventory()
        let owned = document.spots.filter { $0.owner == owner }
        guard !owned.isEmpty else { return 0 }
        var removedKeys = Set<String>(), firstFailure: Error?
        for entry in owned {
            do {
                let spot = try FlexSpot(frequencyHz: entry.frequencyHz, callsign: entry.callsign, mode: "CW",
                                        source: "xLog module transition", spotter: "", comment: "",
                                        timestamp: Int64(Date().timeIntervalSince1970), lifetimeSeconds: 600,
                                        priority: 1, colorHex: "#AEB5B7")
                try await removeDelivery(spot, entry.provider, entry.radioID)
                removedKeys.insert(entry.key)
                accepted.removeValue(forKey: "\(entry.provider)|\(entry.callsign)|\(entry.frequencyHz)")
            } catch {
                if firstFailure == nil { firstFailure = error }
            }
        }
        if !removedKeys.isEmpty {
            document.spots.removeAll { removedKeys.contains($0.key) }
            try saveInventory(document)
        }
        if let firstFailure { throw firstFailure }
        return removedKeys.count
    }

    private func finishPending(_ key: String) {
        pending.remove(key)
        let waiters = pendingWaiters.removeValue(forKey: key) ?? []
        for waiter in waiters { waiter.resume() }
    }

    private func loadInventory() throws -> InventoryDocument {
        guard let inventoryURL else { return InventoryDocument(version: 1, spots: []) }
        let data: Data
        do { data = try Data(contentsOf: inventoryURL, options: [.mappedIfSafe]) }
        catch let error as CocoaError where error.code == .fileReadNoSuchFile {
            return InventoryDocument(version: 1, spots: [])
        }
        guard data.count <= 1_048_576,
              let document = try? JSONDecoder().decode(InventoryDocument.self, from: data),
              document.version == 1, document.spots.count <= 4_096,
              document.spots.allSatisfy({ ["direct_agent", "direct_tci"].contains($0.provider)
                  && ["radio1", "radio2"].contains($0.radioID)
                  && !$0.callsign.isEmpty && $0.callsign.utf8.count <= 32
                  && (100_000...60_000_000).contains($0.frequencyHz)
                  && ["normal_logging", "contesting"].contains($0.owner)
                  && $0.acceptedAt.isFinite }) else {
            throw WorkerFailure("spot_inventory_invalid", "The xLog radio spot inventory is invalid; no radio spots were removed.")
        }
        return document
    }

    private func saveInventory(_ document: InventoryDocument) throws {
        guard let inventoryURL else { return }
        try FileManager.default.createDirectory(at: inventoryURL.deletingLastPathComponent(),
                                                withIntermediateDirectories: true)
        try JSONEncoder().encode(document).write(to: inventoryURL, options: [.atomic])
    }

    private func persistAccepted(_ spot: FlexSpot, provider: String, radioID: String, acceptedAt: Date) throws {
        var document = try loadInventory()
        let owner = spot.source == "xLog Contest" ? "contesting" : "normal_logging"
        let entry = InventoryEntry(provider: provider, radioID: radioID, callsign: spot.callsign,
                                   frequencyHz: spot.frequencyHz, owner: owner,
                                   acceptedAt: acceptedAt.timeIntervalSince1970)
        document.spots.removeAll { $0.provider == provider && $0.callsign == spot.callsign && $0.frequencyHz == spot.frequencyHz }
        document.spots.append(entry)
        if document.spots.count > 4_096 {
            document.spots.sort { $0.acceptedAt < $1.acceptedAt }
            document.spots.removeFirst(document.spots.count - 4_096)
        }
        try saveInventory(document)
    }

    private func persistedRadioID(for spot: FlexSpot, provider: String) throws -> String? {
        try loadInventory().spots.last { $0.provider == provider && $0.callsign == spot.callsign
            && $0.frequencyHz == spot.frequencyHz }?.radioID
    }

    private func removePersisted(_ spot: FlexSpot, provider: String, radioID: String) throws {
        var document = try loadInventory()
        document.spots.removeAll { $0.provider == provider && $0.radioID == radioID
            && $0.callsign == spot.callsign && $0.frequencyHz == spot.frequencyHz }
        try saveInventory(document)
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

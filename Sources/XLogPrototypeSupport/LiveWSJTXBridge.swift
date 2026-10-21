#if os(macOS)
import Foundation
import Darwin
import XLogCore

protocol WSJTXDatagramReceiving: AnyObject {
    func start(address: String, port: UInt16) throws
    func stop()
}

struct WSJTXLoggedADIF: Equatable, Sendable {
    let schema: UInt32
    let instanceID: String
    let text: String
}

enum WSJTXMessageError: Error {
    case invalid
}

/// Bounded parser for the documented WSJT-X QDataStream UDP envelope.
/// Unknown message types are ignored so newer WSJT-X versions remain compatible.
enum WSJTXMessageParser {
    private static let magic: UInt32 = 0xadbccbda
    private static let loggedADIFType: UInt32 = 12
    private static let maximumADIFBytes = 16_384

    static func loggedADIF(from data: Data) throws -> WSJTXLoggedADIF? {
        var cursor = Cursor(data)
        guard try cursor.uint32() == magic else { throw WSJTXMessageError.invalid }
        let schema = try cursor.uint32()
        guard schema > 0 else { throw WSJTXMessageError.invalid }
        let type = try cursor.uint32()
        guard type == loggedADIFType else { return nil }
        let instance = try cursor.utf8(maximumBytes: 256)
        let text = try cursor.utf8(maximumBytes: maximumADIFBytes)
        guard !instance.isEmpty, !text.isEmpty else { throw WSJTXMessageError.invalid }
        return WSJTXLoggedADIF(schema: schema, instanceID: instance, text: text)
    }

    private struct Cursor {
        let data: Data
        var offset = 0

        init(_ data: Data) { self.data = data }

        mutating func uint32() throws -> UInt32 {
            guard offset <= data.count - 4 else { throw WSJTXMessageError.invalid }
            let value = data[offset..<(offset + 4)].reduce(UInt32(0)) { ($0 << 8) | UInt32($1) }
            offset += 4
            return value
        }

        mutating func utf8(maximumBytes: Int) throws -> String {
            let count = try uint32()
            guard count != UInt32.max, count <= UInt32(maximumBytes) else { throw WSJTXMessageError.invalid }
            let length = Int(count)
            guard offset <= data.count - length,
                  let value = String(data: data[offset..<(offset + length)], encoding: .utf8) else {
                throw WSJTXMessageError.invalid
            }
            offset += length
            return value
        }
    }
}

/// Receive-only IPv4 UDP endpoint. Multicast joins are supported because the
/// WSJT-X protocol explicitly permits several logging clients on one feed.
final class WSJTXUDPReceiver: WSJTXDatagramReceiving, @unchecked Sendable {
    typealias DatagramHandler = @Sendable (Data, String) -> Void
    typealias EventHandler = @Sendable (String) -> Void

    private let queue = DispatchQueue(label: "com.om0rx.xlog.wsjtx.udp")
    private let lock = NSLock()
    private let onDatagram: DatagramHandler
    private let onEvent: EventHandler
    private var source: DispatchSourceRead?
    private var descriptor: Int32 = -1
    private var generation: UUID?

    init(onDatagram: @escaping DatagramHandler, onEvent: @escaping EventHandler = { _ in }) {
        self.onDatagram = onDatagram
        self.onEvent = onEvent
    }

    func start(address: String, port: UInt16) throws {
        var parsed = in_addr()
        guard address.withCString({ inet_pton(AF_INET, $0, &parsed) }) == 1 else {
            throw WorkerFailure("invalid_params", "Use a numeric IPv4 loopback or multicast address.")
        }
        let hostOrder = UInt32(bigEndian: parsed.s_addr)
        let firstOctet = hostOrder >> 24
        let multicast = (224...239).contains(firstOctet)
        guard multicast || hostOrder == 0x7f00_0001 else {
            throw WorkerFailure("invalid_params", "WSJT-X UDP must use 127.0.0.1 or an IPv4 multicast address.")
        }

        let fd = Darwin.socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP)
        guard fd >= 0 else { throw WorkerFailure("wsjtx_bind_failed", "Could not create the WSJT-X UDP listener.") }
        var installed = false
        defer { if !installed { Darwin.close(fd) } }

        if multicast {
            var enabled: Int32 = 1
            guard setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &enabled, socklen_t(MemoryLayout.size(ofValue: enabled))) == 0,
                  setsockopt(fd, SOL_SOCKET, SO_REUSEPORT, &enabled, socklen_t(MemoryLayout.size(ofValue: enabled))) == 0 else {
                throw WorkerFailure("wsjtx_bind_failed", "Could not prepare the multicast WSJT-X listener.")
            }
        }
        var local = sockaddr_in()
        local.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        local.sin_family = sa_family_t(AF_INET)
        local.sin_port = port.bigEndian
        local.sin_addr = multicast ? in_addr(s_addr: INADDR_ANY) : parsed
        let bound = withUnsafePointer(to: &local) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        guard bound == 0 else { throw WorkerFailure("wsjtx_bind_failed", "Could not bind the WSJT-X UDP address and port.") }
        if multicast {
            var membership = ip_mreq(imr_multiaddr: parsed, imr_interface: in_addr(s_addr: INADDR_ANY))
            guard setsockopt(fd, IPPROTO_IP, IP_ADD_MEMBERSHIP, &membership,
                             socklen_t(MemoryLayout.size(ofValue: membership))) == 0 else {
                throw WorkerFailure("wsjtx_bind_failed", "Could not join the WSJT-X multicast group.")
            }
        }
        guard fcntl(fd, F_SETFL, O_NONBLOCK) == 0 else {
            throw WorkerFailure("wsjtx_bind_failed", "Could not configure the WSJT-X UDP listener.")
        }

        let session = UUID()
        let reader = DispatchSource.makeReadSource(fileDescriptor: fd, queue: queue)
        let accepted = lock.withLock { () -> Bool in
            guard source == nil else { return false }
            source = reader; descriptor = fd; generation = session
            return true
        }
        guard accepted else {
            reader.setCancelHandler { Darwin.close(fd) }
            reader.resume(); reader.cancel(); installed = true
            throw WorkerFailure("wsjtx_bind_failed", "The WSJT-X UDP listener is already running.")
        }
        reader.setEventHandler { [weak self] in self?.drain(fd: fd, generation: session) }
        reader.setCancelHandler { Darwin.close(fd) }
        reader.resume()
        installed = true
        onEvent("Listening on \(address):\(port)")
    }

    func stop() {
        let old = lock.withLock { () -> DispatchSourceRead? in
            let prior = source
            source = nil; descriptor = -1; generation = nil
            return prior
        }
        old?.cancel()
    }

    private func drain(fd: Int32, generation: UUID) {
        while lock.withLock({ self.generation == generation && descriptor == fd }) {
            var buffer = [UInt8](repeating: 0, count: 65_535)
            var sender = sockaddr_in(), senderSize = socklen_t(MemoryLayout<sockaddr_in>.size)
            let count = withUnsafeMutablePointer(to: &sender) { pointer in
                pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                    Darwin.recvfrom(fd, &buffer, buffer.count, 0, $0, &senderSize)
                }
            }
            if count > 0 {
                guard sender.sin_family == sa_family_t(AF_INET) else { continue }
                let address = UInt32(bigEndian: sender.sin_addr.s_addr)
                let endpoint = "\(address >> 24).\((address >> 16) & 255).\((address >> 8) & 255).\(address & 255):\(UInt16(bigEndian: sender.sin_port))"
                onDatagram(Data(buffer.prefix(Int(count))), endpoint)
            } else if count == 0 || errno == EAGAIN || errno == EWOULDBLOCK {
                return
            } else {
                onEvent("UDP listener failed")
                stop()
                return
            }
        }
    }
}

private struct WSJTXBridgeConfiguration: Codable, Equatable {
    var enabled = false
    var address = "127.0.0.1"
    var port: UInt16 = 2_237
}

public enum WSJTXLoggingRoute: String, Sendable {
    case normalLogging = "normal_logging"
    case contestSurfaceOrdinaryLogbook = "active_contest_surface"
}

public struct WSJTXContestDestination: Equatable, Sendable {
    public let sessionID: String
    public let workspaceGeneration: String
    public let pluginID: String
    public let sourceRevision: String
}

public actor LiveWSJTXBridge {
    public static let shared = LiveWSJTXBridge()

    private let configurationURL: URL
    private let workspaceAvailable: @Sendable () throws -> Bool
    private let importer: @Sendable (String) throws -> (imported: Int, skipped: Int)
    private let classificationLogbook: LiveLogbookMethods?
    private let externalIOAllowed: @Sendable () -> Bool
    private let receiverFactory: @Sendable (@escaping @Sendable (Data, String) -> Void,
                                             @escaping @Sendable (String) -> Void) -> WSJTXDatagramReceiving
    private var configuration: WSJTXBridgeConfiguration?
    private var receiver: WSJTXDatagramReceiving?
    private var receiverGeneration: UUID?
    private var workspaceSuspensionDepth = 0
    private var terminalShutdown = false
    private var onImported: (@Sendable () -> Void)?
    private var contestDestination: WSJTXContestDestination?
    private var contestImporter: (@Sendable (ADIFRecord, WSJTXContestDestination) async throws -> Bool)?
    private var receivedCount = 0
    private var importedCount = 0
    private var duplicateCount = 0
    private var ignoredCount = 0
    private var rejectedCount = 0
    private var status = "Off"
    private let ingress = SpotIngressGate(limit: 64)
    private var activity = WSJTXActivity()
    private var activityClassificationKey = ""
    private var activityClassificationRevision: UInt64 = 0

    init(configurationURL: URL? = nil,
         workspaceAvailable: @escaping @Sendable () throws -> Bool = {
             (try LiveLogbookMethods.shared.handle(method: "workspace_status", params: [:]))["workspace_exists"] as? Bool == true
         },
         importer: @escaping @Sendable (String) throws -> (imported: Int, skipped: Int) = {
             try LiveLogbookMethods.shared.importLoggedADIF($0)
         },
         classificationLogbook: LiveLogbookMethods? = nil,
         externalIOAllowed: @escaping @Sendable () -> Bool = { AppRuntimeProfile.current.externalIOAllowed },
         receiverFactory: @escaping @Sendable (@escaping @Sendable (Data, String) -> Void,
                                                @escaping @Sendable (String) -> Void) -> WSJTXDatagramReceiving = {
             WSJTXUDPReceiver(onDatagram: $0, onEvent: $1)
         }) {
        self.configurationURL = configurationURL ?? LiveLogbookMethods.shared.workspaceDirectoryURL
            .appendingPathComponent("wsjtx-bridge.json")
        self.workspaceAvailable = workspaceAvailable
        self.importer = importer
        self.classificationLogbook = classificationLogbook ?? (configurationURL == nil ? .shared : nil)
        self.externalIOAllowed = externalIOAllowed
        self.receiverFactory = receiverFactory
    }

    public func install(onImported: @escaping @Sendable () -> Void) { self.onImported = onImported }

    public func startIfEnabled() {
        guard externalIOAllowed(), !terminalShutdown, workspaceSuspensionDepth == 0 else { return }
        guard (try? workspaceAvailable()) == true, let config = try? load(), config.enabled else { return }
        try? startReceiver(config)
    }

    public func suspendForWorkspaceChange() {
        workspaceSuspensionDepth += 1
        stopReceiver(); configuration = nil; retireContestDestination(); status = "Paused for workspace change"
    }
    public func finishWorkspaceChange() {
        guard workspaceSuspensionDepth > 0 else { return }
        workspaceSuspensionDepth -= 1
        guard workspaceSuspensionDepth == 0, !terminalShutdown else { return }
        configuration = nil; startIfEnabled()
    }
    public func stopForShutdown() {
        terminalShutdown = true
        stopReceiver(); retireContestDestination(); status = "Worker stopped"
    }

    public func handle(method: String, params: [String: Any],
                       route: WSJTXLoggingRoute = .normalLogging,
                       contestDestinationProvider: (@Sendable () async throws -> WSJTXContestDestination)? = nil,
                       contestImporter: (@Sendable (ADIFRecord, WSJTXContestDestination) async throws -> Bool)? = nil) async throws -> [String: Any] {
        let availableContest = try? await contestDestinationProvider?()
        if let current = contestDestination, current != availableContest {
            stopReceiver(); retireContestDestination()
            status = "The active contest changed; the digital destination was retired."
        }
        switch method {
        case "wsjtx_snapshot":
            try require(params, allowed: [])
            return try snapshot(route: route, availableContest: availableContest)
        case "wsjtx_configure":
            try require(params, allowed: ["configuration"], required: ["configuration"])
            try requireStartAvailable()
            try requireWorkspace()
            guard let value = params["configuration"] as? [String: Any] else { throw invalid() }
            let (next, destination) = try decode(value)
            if destination == "active_contest" {
                guard let lease = availableContest, let contestImporter else {
                    throw WorkerFailure("digital_unsupported", "The active contest cannot receive WSJT-X logged contacts.")
                }
                self.contestDestination = lease
                self.contestImporter = contestImporter
            } else { retireContestDestination() }
            let persisted = destination == "active_contest"
                ? WSJTXBridgeConfiguration(enabled: false, address: next.address, port: next.port)
                : next
            try save(persisted); configuration = next
            if !next.enabled { stopReceiver(); status = "Off" }
            else if receiver != nil { stopReceiver(); status = "Settings saved; restart the listener." }
            return try snapshot(route: route, availableContest: availableContest)
        case "wsjtx_start":
            try require(params, allowed: [])
            try requireStartAvailable()
            try requireWorkspace()
            let config = try load()
            guard config.enabled else { throw WorkerFailure("wsjtx_disabled", "Enable WSJT-X logging before starting the listener.") }
            try startReceiver(config)
            return try snapshot(route: route, availableContest: availableContest)
        case "wsjtx_stop":
            try require(params, allowed: [])
            var config = try load(); config.enabled = false
            stopReceiver()
            if (try? workspaceAvailable()) == true { try save(config) }
            configuration = config; retireContestDestination(); status = "Off"
            return try snapshot(route: route, availableContest: availableContest)
        default:
            throw WorkerFailure("method_not_allowed", "Unknown WSJT-X logging method.")
        }
    }

    func ingest(_ data: Data, sender: String = "127.0.0.1:2237") async {
        guard let generation = receiverGeneration else { return }
        await ingest(data, sender: sender, generation: generation)
    }

    private func ingest(_ data: Data, sender: String, generation: UUID) async {
        guard receiverGeneration == generation, receiver != nil, configuration?.enabled == true else { return }
        receivedCount += 1
        do {
            if let message = try WSJTXActivityMessage.parse(data) {
                activity.receive(message, sender: sender, now: UInt64(Date().timeIntervalSince1970 * 1000))
                return
            }
            guard let message = try WSJTXMessageParser.loggedADIF(from: data) else {
                ignoredCount += 1; status = "Listening; a non-log WSJT-X message was ignored."; return
            }
            let duplicate: Bool
            let imported: Int
            if let destination = contestDestination, let contestImporter {
                let records = ADIFParser().records(in: message.text)
                guard records.count == 1, records[0].fields.count <= 64 else { throw WSJTXMessageError.invalid }
                duplicate = try await contestImporter(records[0], destination)
                imported = duplicate ? 0 : 1
            } else {
                let result = try importer(message.text)
                duplicate = result.skipped > 0
                imported = result.imported
            }
            guard receiverGeneration == generation else { return }
            importedCount += imported
            duplicateCount += duplicate ? 1 : 0
            status = imported > 0 ? (contestDestination == nil ? "Logged 1 WSJT-X contact locally." : "Logged 1 WSJT-X contact to the active contest.")
                : "WSJT-X contact already exists; duplicate suppressed."
            if imported > 0 { onImported?() }
        } catch let failure as ContestLaneError where ["stale_context", "contest_session_inactive"].contains(failure.code) {
            guard receiverGeneration == generation else { return }
            rejectedCount += 1; stopReceiver(); retireContestDestination()
            status = "The contest changed; the late WSJT-X contact was rejected and the listener stopped."
        } catch {
            guard receiverGeneration == generation else { return }
            rejectedCount += 1
            activity.invalidate(sender: sender)
            status = "Rejected an invalid WSJT-X datagram or ADIF record; the logbook was unchanged."
        }
    }

    private func startReceiver(_ config: WSJTXBridgeConfiguration) throws {
        guard externalIOAllowed() else {
            throw WorkerFailure("external_io_disabled", "External services are disabled in OM0RX-xLog Contesting Test.")
        }
        try requireStartAvailable()
        if receiver != nil { return }
        let generation = UUID(); receiverGeneration = generation
        let ingress = self.ingress
        let next = receiverFactory({ [weak self] data, sender in
            guard ingress.admit(bytes: data.count) else { return }
            Task { defer { ingress.finish() }; await self?.ingest(data, sender: sender, generation: generation) }
        }, { [weak self] event in Task { await self?.receiverEvent(event, generation: generation) } })
        do {
            try next.start(address: config.address, port: config.port)
            receiver = next
            status = "Listening receive-only on \(config.address):\(config.port)."
        } catch {
            next.stop(); receiverGeneration = nil
            status = "Could not start the WSJT-X UDP listener."
            throw error
        }
    }

    private func stopReceiver() {
        receiverGeneration = nil; receiver?.stop(); receiver = nil
        activity.reset()
    }

    private func retireContestDestination() {
        contestDestination = nil
        contestImporter = nil
    }

    private func requireStartAvailable() throws {
        if terminalShutdown {
            throw WorkerFailure("worker_stopping", "The WSJT-X listener cannot start while the application is shutting down.")
        }
        if workspaceSuspensionDepth > 0 {
            throw WorkerFailure("workspace_transition", "The WSJT-X listener cannot start while the workspace is changing.")
        }
    }

    private func receiverEvent(_ event: String, generation: UUID) {
        guard receiverGeneration == generation else { return }
        if event.hasPrefix("UDP listener failed") { stopReceiver(); status = "WSJT-X UDP listener failed and stopped." }
    }

    private func snapshot(route: WSJTXLoggingRoute = .normalLogging,
                          availableContest: WSJTXContestDestination? = nil) throws -> [String: Any] {
        let config = try load()
        let now = UInt64(Date().timeIntervalSince1970 * 1000)
        let inputs = activity.classificationInputs(now: now)
        var classifications: [String: WSJTXActivityClassification] = [:]
        if !inputs.isEmpty, let logbook = classificationLogbook {
            do {
                let source = try logbook.clusterClassificationSnapshot()
                if source.key != activityClassificationKey {
                    activityClassificationKey = source.key
                    activityClassificationRevision = min(activityClassificationRevision + 1, 9_007_199_254_740_991)
                }
                classifications = Dictionary(uniqueKeysWithValues: inputs.map { input in
                    let adif = source.resolver.resolve(input.callsign,
                        at: Date(timeIntervalSince1970: Double(input.receivedAt) / 1_000))?.adif
                    let value = source.index.classify(call: input.callsign, band: input.band, mode: input.mode, adif: adif)
                    return (input.id, WSJTXActivityClassification(callStatus: value.callStatus,
                                                                  dxccStatus: value.dxccStatus))
                })
            } catch {
                if activityClassificationKey != "unavailable" {
                    activityClassificationKey = "unavailable"
                    activityClassificationRevision = min(activityClassificationRevision + 1, 9_007_199_254_740_991)
                }
            }
        }
        let destination = contestDestination == nil ? "ordinary_logbook" : "active_contest"
        let activeContest: Any = availableContest.map { ["session_id": $0.sessionID, "plugin_id": $0.pluginID] } ?? NSNull()
        return ["configuration": ["enabled": config.enabled, "address": config.address, "port": Int(config.port),
                                  "destination": destination],
                "logging_destination": destination, "request_origin": route.rawValue,
                "contest_target_supported": availableContest != nil, "mutation_available": true,
                "active_contest": activeContest,
                "running": receiver != nil, "received_count": receivedCount, "imported_count": importedCount,
                "duplicate_count": duplicateCount, "ignored_count": ignoredCount, "rejected_count": rejectedCount,
                "dropped_count": ingress.droppedCount, "status": status, "receive_only": true,
                "activity": activity.snapshot(now: now, available: receiver != nil,
                    classificationRevision: activityClassificationRevision, classifications: classifications)]
    }

    private func load() throws -> WSJTXBridgeConfiguration {
        if let configuration { return configuration }
        try validatePath()
        guard FileManager.default.fileExists(atPath: configurationURL.path) else {
            let value = WSJTXBridgeConfiguration(); configuration = value; return value
        }
        let data = try Data(contentsOf: configurationURL)
        guard data.count <= 4_096 else { throw invalid() }
        let value = try JSONDecoder().decode(WSJTXBridgeConfiguration.self, from: data)
        try validate(value); configuration = value; return value
    }

    private func save(_ value: WSJTXBridgeConfiguration) throws {
        try validate(value); try validatePath()
        let directory = configurationURL.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                                                attributes: [.posixPermissions: 0o700])
        try JSONEncoder().encode(value).write(to: configurationURL, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: configurationURL.path)
    }

    private func decode(_ object: [String: Any]) throws -> (WSJTXBridgeConfiguration, String) {
        let keys = Set(object.keys), baseKeys: Set<String> = ["enabled", "address", "port"]
        guard (keys == baseKeys || keys == baseKeys.union(["destination"])), let enabled = object["enabled"] as? Bool,
              let address = object["address"] as? String, let port = object["port"] as? NSNumber,
              CFGetTypeID(port) != CFBooleanGetTypeID(), port.doubleValue.rounded() == port.doubleValue,
              (1...65_535).contains(port.intValue) else { throw invalid() }
        let destination = object["destination"] as? String ?? "ordinary_logbook"
        guard ["ordinary_logbook", "active_contest"].contains(destination) else { throw invalid() }
        let value = WSJTXBridgeConfiguration(enabled: enabled, address: address, port: UInt16(port.intValue))
        try validate(value); return (value, destination)
    }

    private func validate(_ value: WSJTXBridgeConfiguration) throws {
        var parsed = in_addr()
        guard value.address.utf8.count <= 45,
              value.address.withCString({ inet_pton(AF_INET, $0, &parsed) }) == 1 else { throw invalid() }
        let hostOrder = UInt32(bigEndian: parsed.s_addr), firstOctet = hostOrder >> 24
        guard hostOrder == 0x7f00_0001 || (224...239).contains(firstOctet) else { throw invalid() }
    }

    private func validatePath() throws {
        for url in [configurationURL.deletingLastPathComponent(), configurationURL] where FileManager.default.fileExists(atPath: url.path) {
            if try url.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink == true {
                throw WorkerFailure("unsafe_configuration", "WSJT-X configuration cannot use a symbolic link.")
            }
        }
    }

    private func requireWorkspace() throws {
        guard try workspaceAvailable() else { throw WorkerFailure("workspace_unavailable", "Create the local logbook before configuring WSJT-X logging.") }
    }

    private func require(_ params: [String: Any], allowed: Set<String>, required: Set<String> = []) throws {
        guard Set(params.keys).isSubset(of: allowed), required.isSubset(of: Set(params.keys)) else { throw invalid() }
    }

    private func invalid() -> WorkerFailure { WorkerFailure("invalid_params", "Invalid WSJT-X logging configuration.") }
}
#endif

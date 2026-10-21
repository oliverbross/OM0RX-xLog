#if os(macOS)
import Foundation
import CryptoKit
import XLogCore

protocol FldigiXMLRPCCalling: Sendable {
    func call(method: String, string: String?) async throws
}

private final class FldigiXMLRPCClient: FldigiXMLRPCCalling, @unchecked Sendable {
    private let endpoint = URL(string: "http://127.0.0.1:7362/RPC2")!

    func call(method: String, string: String?) async throws {
        let parameter = string.map { "<params><param><value><string>\(Self.escape($0))</string></value></param></params>" } ?? "<params/>"
        let body = "<?xml version=\"1.0\"?><methodCall><methodName>\(method)</methodName>\(parameter)</methodCall>"
        guard body.utf8.count <= 16_384 else { throw WorkerFailure("fldigi_invalid", "The fldigi command is too large.") }
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"; request.timeoutInterval = 5
        request.setValue("text/xml", forHTTPHeaderField: "Content-Type")
        request.httpBody = Data(body.utf8)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard data.count <= 65_536, let http = response as? HTTPURLResponse, http.statusCode == 200,
              let text = String(data: data, encoding: .utf8), text.contains("<methodResponse>"), !text.contains("<fault>") else {
            throw WorkerFailure("fldigi_rpc_failed", "fldigi rejected the XML-RPC command.")
        }
    }

    private static func escape(_ value: String) -> String {
        value.replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
            .replacingOccurrences(of: "'", with: "&apos;")
    }
}

private struct FldigiConfiguration: Codable, Equatable {
    var receiveEnabled = false
    var transmitEnabled = false
}

public actor LiveFldigiBridge {
    public static let shared = LiveFldigiBridge()
    private static let maximumADIFBytes = 16_384
    private static let maximumActions = 12

    private let configurationURL: URL
    private let externalIOAllowed: @Sendable () -> Bool
    private let receiverFactory: @Sendable (@escaping @Sendable (Data, String) -> Void,
                                             @escaping @Sendable (String) -> Void) -> WSJTXDatagramReceiving
    private let rpc: FldigiXMLRPCCalling
    private var configuration: FldigiConfiguration?
    private var receiver: WSJTXDatagramReceiving?
    private var receiverGeneration: UUID?
    private var transmitGeneration = UUID()
    private var terminalShutdown = false
    private var contestDestination: WSJTXContestDestination?
    private var contestImporter: (@Sendable (ADIFRecord, WSJTXContestDestination) async throws -> Bool)?
    private var receivedCount = 0, importedCount = 0, duplicateCount = 0, rejectedCount = 0
    private var status = "Off"
    private let ingress = SpotIngressGate(limit: 64)

    init(configurationURL: URL? = nil,
         externalIOAllowed: @escaping @Sendable () -> Bool = { AppRuntimeProfile.current.externalIOAllowed },
         receiverFactory: @escaping @Sendable (@escaping @Sendable (Data, String) -> Void,
                                                @escaping @Sendable (String) -> Void) -> WSJTXDatagramReceiving = {
             WSJTXUDPReceiver(onDatagram: $0, onEvent: $1)
         }, rpc: FldigiXMLRPCCalling = FldigiXMLRPCClient()) {
        self.configurationURL = configurationURL ?? LiveLogbookMethods.shared.workspaceDirectoryURL
            .appendingPathComponent("fldigi-bridge.json")
        self.externalIOAllowed = externalIOAllowed
        self.receiverFactory = receiverFactory
        self.rpc = rpc
    }

    public func stopForShutdown() async {
        terminalShutdown = true; stopReceiver(); retireDestination(); transmitGeneration = UUID(); status = "Worker stopped"
        await returnToReceive()
    }

    public func suspendForWorkspaceChange() async {
        stopReceiver(); retireDestination(); transmitGeneration = UUID()
        let stopped = FldigiConfiguration(receiveEnabled: false, transmitEnabled: false)
        try? save(stopped); configuration = stopped
        status = "Workspace changed; fldigi receive and transmit were stopped."
        await returnToReceive()
    }

    public func handle(method: String, params: [String: Any],
                       receiveDestination: WSJTXContestDestination?, transmitDestination: WSJTXContestDestination?,
                       contestImporter: (@Sendable (ADIFRecord, WSJTXContestDestination) async throws -> Bool)?,
                       transmitDestinationProvider: (@Sendable () async throws -> WSJTXContestDestination)? = nil) async throws -> [String: Any] {
        if let current = contestDestination, current != receiveDestination {
            stopReceiver(); retireDestination(); status = "The active contest changed; the fldigi receive lease was retired."
        }
        switch method {
        case "fldigi_snapshot":
            try require(params, allowed: [])
        case "fldigi_configure":
            try require(params, allowed: ["configuration"], required: ["configuration"])
            guard let object = params["configuration"] as? [String: Any],
                  Set(object.keys) == ["receive_enabled", "transmit_enabled"],
                  let receive = object["receive_enabled"] as? Bool,
                  let transmit = object["transmit_enabled"] as? Bool else { throw invalid() }
            if receive { guard let destination = receiveDestination, let contestImporter else {
                throw WorkerFailure("digital_unsupported", "The active contest cannot receive fldigi logged contacts.")
            }; contestDestination = destination; self.contestImporter = contestImporter }
            else { stopReceiver(); retireDestination() }
            guard !transmit || transmitDestination != nil else {
                throw WorkerFailure("fldigi_transmit_unsupported", "The active contest has no original fldigi transmit path.")
            }
            let wasTransmitting = (try load()).transmitEnabled
            if wasTransmitting && !transmit {
                transmitGeneration = UUID()
                await returnToReceive()
            }
            let next = FldigiConfiguration(receiveEnabled: receive, transmitEnabled: transmit)
            try save(FldigiConfiguration(receiveEnabled: false, transmitEnabled: transmit)); configuration = next
        case "fldigi_start":
            try require(params, allowed: [])
            let config = try load()
            guard config.receiveEnabled else { throw WorkerFailure("fldigi_disabled", "Enable fldigi logged-QSO receive before starting.") }
            guard let destination = receiveDestination, let contestImporter else {
                throw WorkerFailure("digital_unsupported", "The active contest cannot receive fldigi logged contacts.")
            }
            contestDestination = destination; self.contestImporter = contestImporter
            try startReceiver()
        case "fldigi_stop":
            try require(params, allowed: [])
            stopReceiver(); retireDestination(); transmitGeneration = UUID()
            var next = try load(); next.receiveEnabled = false; next.transmitEnabled = false
            try save(next); configuration = next; status = "Off"
            await returnToReceive()
        case "fldigi_send":
            try require(params, allowed: ["actions"], required: ["actions"])
            guard externalIOAllowed(), !terminalShutdown else {
                throw WorkerFailure("external_io_disabled", "External services are disabled in OM0RX-xLog Contesting Test.")
            }
            let config = try load()
            guard config.transmitEnabled, let destination = transmitDestination else {
                throw WorkerFailure("fldigi_transmit_disabled", "Enable fldigi macro transmit for this contest first.")
            }
            guard let actions = params["actions"] as? [[String: Any]], (1...Self.maximumActions).contains(actions.count) else { throw invalid() }
            let generation = transmitGeneration
            for action in actions {
                let payload = try validate(action: action, destination: destination)
                do { try await rpc.call(method: "main.tx", string: nil) }
                catch { await returnToReceive(); throw error }
                let currentDestination = try? await transmitDestinationProvider?()
                guard generation == transmitGeneration, !terminalShutdown, destination == transmitDestination,
                      transmitDestinationProvider == nil || currentDestination == destination else {
                    await returnToReceive()
                    throw WorkerFailure("stale_context", "The contest or fldigi output lease changed before text was sent.")
                }
                do { try await rpc.call(method: "text.add_tx", string: payload) }
                catch { await returnToReceive(); throw error }
            }
            status = "Sent \(actions.count) fldigi macro\(actions.count == 1 ? "" : "s")."
        default:
            throw WorkerFailure("method_not_allowed", "Unknown fldigi method.")
        }
        return try snapshot(receiveDestination: receiveDestination, transmitDestination: transmitDestination)
    }

    func ingest(_ data: Data, sender: String = "127.0.0.1:9876") async {
        guard let generation = receiverGeneration else { return }
        await ingest(data, sender: sender, generation: generation)
    }

    private func ingest(_ data: Data, sender: String, generation: UUID) async {
        guard receiverGeneration == generation, receiver != nil, data.count <= Self.maximumADIFBytes,
              sender.hasPrefix("127.0.0.1:"), let destination = contestDestination, let contestImporter else { return }
        receivedCount += 1
        do {
            guard let text = String(data: data, encoding: .utf8), text != "NONE" else { throw invalid() }
            let records = ADIFParser().records(in: text)
            guard records.count == 1, records[0].fields.count <= 64 else { throw invalid() }
            let duplicate = try await contestImporter(records[0], destination)
            guard receiverGeneration == generation, contestDestination == destination else { return }
            if duplicate { duplicateCount += 1; status = "fldigi contact already exists; duplicate suppressed." }
            else { importedCount += 1; status = "Logged 1 fldigi contact to the active contest." }
        } catch let failure as ContestLaneError where ["stale_context", "contest_session_inactive"].contains(failure.code) {
            guard receiverGeneration == generation else { return }
            rejectedCount += 1; stopReceiver(); retireDestination()
            status = "The contest changed; the late fldigi contact was rejected and receive stopped."
        } catch {
            guard receiverGeneration == generation else { return }
            rejectedCount += 1; status = "Rejected an invalid fldigi ADIF datagram; the contest log was unchanged."
        }
    }

    private func startReceiver() throws {
        guard externalIOAllowed(), !terminalShutdown else {
            throw WorkerFailure("external_io_disabled", "External services are disabled in OM0RX-xLog Contesting Test.")
        }
        if receiver != nil { return }
        let generation = UUID(); receiverGeneration = generation; let ingress = self.ingress
        let next = receiverFactory({ [weak self] data, sender in
            guard ingress.admit(bytes: data.count) else { return }
            Task { defer { ingress.finish() }; await self?.ingest(data, sender: sender, generation: generation) }
        }, { _ in })
        do { try next.start(address: "127.0.0.1", port: 9_876); receiver = next; status = "Receiving fldigi logged QSOs on 127.0.0.1:9876." }
        catch { next.stop(); receiverGeneration = nil; throw error }
    }

    private func stopReceiver() { receiverGeneration = nil; receiver?.stop(); receiver = nil }
    private func retireDestination() { contestDestination = nil; contestImporter = nil }
    private func returnToReceive() async {
        guard externalIOAllowed() else { return }
        try? await rpc.call(method: "main.rx", string: nil)
    }

    private func validate(action: [String: Any], destination: WSJTXContestDestination) throws -> String {
        guard Set(action.keys).isSuperset(of: ["kind", "payload", "payloadUTF8Bytes", "payloadSHA256", "nlBefore", "rxAfter", "sessionID", "workspaceGeneration", "sourceRevision"]),
              action["kind"] as? String == "fldigi", action["sessionID"] as? String == destination.sessionID,
              action["workspaceGeneration"] as? String == destination.workspaceGeneration,
              action["sourceRevision"] as? String == destination.sourceRevision,
              let raw = action["payload"] as? String, let bytes = action["payloadUTF8Bytes"] as? NSNumber,
              let digest = action["payloadSHA256"] as? String, let nlBefore = action["nlBefore"] as? Bool,
              let rxAfter = action["rxAfter"] as? Bool else { throw invalid() }
        let encoded = Data(raw.utf8)
        let actualDigest = SHA256.hash(data: encoded).map { String(format: "%02x", $0) }.joined()
        guard encoded.count <= 4_096, bytes.intValue == encoded.count, actualDigest == digest else { throw invalid() }
        var payload = raw.replacingOccurrences(of: "^M", with: "\n")
        if nlBefore { payload = "\n" + payload }
        if rxAfter { payload += "^r" }
        return payload
    }

    private func snapshot(receiveDestination: WSJTXContestDestination?, transmitDestination: WSJTXContestDestination?) throws -> [String: Any] {
        let config = try load()
        return ["configuration": ["receive_enabled": config.receiveEnabled, "transmit_enabled": config.transmitEnabled],
                "receive_supported": receiveDestination != nil, "transmit_supported": transmitDestination != nil,
                "receive_running": receiver != nil, "received_count": receivedCount, "imported_count": importedCount,
                "duplicate_count": duplicateCount, "rejected_count": rejectedCount, "status": status,
                "udp_endpoint": "127.0.0.1:9876", "xmlrpc_endpoint": "http://127.0.0.1:7362/RPC2"]
    }

    private func load() throws -> FldigiConfiguration {
        if let configuration { return configuration }
        guard FileManager.default.fileExists(atPath: configurationURL.path) else { let value = FldigiConfiguration(); configuration = value; return value }
        let data = try Data(contentsOf: configurationURL); guard data.count <= 4_096 else { throw invalid() }
        let value = try JSONDecoder().decode(FldigiConfiguration.self, from: data); configuration = value; return value
    }
    private func save(_ value: FldigiConfiguration) throws {
        let directory = configurationURL.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try JSONEncoder().encode(value).write(to: configurationURL, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: configurationURL.path)
    }
    private func require(_ params: [String: Any], allowed: Set<String>, required: Set<String> = []) throws {
        guard Set(params.keys).isSubset(of: allowed), required.isSubset(of: Set(params.keys)) else { throw invalid() }
    }
    private func invalid() -> WorkerFailure { WorkerFailure("invalid_params", "Invalid fldigi configuration or output action.") }
}
#endif

#if os(macOS)
import Foundation
import CryptoKit
#if canImport(FoundationXML)
import FoundationXML
#endif
import XLogCore

protocol FldigiXMLRPCCalling: Sendable {
    func call(method: String, string: String?) async throws
    func receivedText() async throws -> (text:String,instance:String,version:String)
}
extension FldigiXMLRPCCalling {
    func receivedText() async throws -> (text:String,instance:String,version:String) {throw WorkerFailure("fldigi_rx_unsupported","This fldigi transport does not expose non-destructive received text.")}
}

private final class FldigiXMLRPCClient: FldigiXMLRPCCalling, @unchecked Sendable {
    private let endpoint = URL(string: "http://127.0.0.1:7362/RPC2")!

    func call(method: String, string: String?) async throws {
        let parameter = string.map { "<params><param><value><string>\(Self.escape($0))</string></value></param></params>" } ?? "<params/>"
        _ = try await read(method:method,parameter:parameter,requireValue:false)
    }
    func receivedText() async throws -> (text:String,instance:String,version:String) {
        let name=try await read(method:"fldigi.name"),version=try await read(method:"fldigi.version"),directory=try await read(method:"fldigi.config_dir")
        guard let length=Int(try await read(method:"text.get_rx_length")),length>=0,length<=100_000_000 else{throw WorkerFailure("fldigi_rpc_failed","Invalid fldigi receive length.")}
        let count=min(length,8192),start=max(0,length-count)
        let encoded=try await read(method:"text.get_rx",parameter:"<params><param><value><int>\(start)</int></value></param><param><value><int>\(count)</int></value></param></params>")
        guard let bytes=Data(base64Encoded:encoded,options:.ignoreUnknownCharacters),bytes.count<=32768,let text=String(data:bytes,encoding:.utf8)else{throw WorkerFailure("fldigi_rpc_failed","Invalid fldigi received text.")}
        let instance=SHA256.hash(data:Data((name+"/"+version+"/"+directory).utf8)).map{String(format:"%02x",$0)}.joined()
        return (text,instance,version)
    }
    private func read(method:String,parameter:String="<params/>",requireValue:Bool=true) async throws -> String {
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
        guard !text.contains("<!DOCTYPE"),!text.contains("<!ENTITY")else{throw WorkerFailure("fldigi_rpc_failed","Unsupported XML entity declaration.")}
        let reader=FldigiValue();let parser=XMLParser(data:data);parser.delegate=reader;parser.shouldResolveExternalEntities=false
        guard parser.parse(),reader.values.count==1 || !requireValue && reader.values.isEmpty else{throw WorkerFailure("fldigi_rpc_failed","Invalid typed XML-RPC response.")}
        return reader.values.first ?? ""
    }

    private static func escape(_ value: String) -> String {
        value.replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
            .replacingOccurrences(of: "'", with: "&apos;")
    }
}
private final class FldigiValue:NSObject,XMLParserDelegate {
    var values:[String]=[],current:String?,text=""
    func parser(_ parser:XMLParser,didStartElement name:String,namespaceURI:String?,qualifiedName:String?,attributes:[String:String]){if ["string","base64","int","i4"].contains(name){current=name;text=""}}
    func parser(_ parser:XMLParser,foundCharacters string:String){if current != nil{text+=string}}
    func parser(_ parser:XMLParser,didEndElement name:String,namespaceURI:String?,qualifiedName:String?){if name==current{values.append(text);current=nil}}
}

private struct FldigiConfiguration: Codable, Equatable {
    var receiveEnabled = false
    var transmitEnabled = false
}
private struct FldigiCompleted:Codable {
    let id:String,packet:[String:String],sender:String,destination:WSJTXContestDestination,at:Date
    var record:ADIFRecord{ADIFRecord(fields:packet)}
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
    private var rxText: (id:String,text:String,instance:String,version:String,at:Date,destination:WSJTXContestDestination)?
    private var completed: [FldigiCompleted] = []
    private var completedRecoveryError:String?
    private let ingress = SpotIngressGate(limit: 64)
    // Set before an admitted TX request can reach RPC. A lost reply retains
    // the duty; configuration alone never grants cleanup of another engine.
    private var transmitDuty: UUID?
    private var sendInFlight = false
    private var releasesInFlight = 0
    private var releaseUncertain = false

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
        let recovery=self.configurationURL.appendingPathExtension("completed.json")
        if FileManager.default.fileExists(atPath:recovery.path){
            do{
                guard try recovery.resourceValues(forKeys:[.isSymbolicLinkKey]).isSymbolicLink != true else{throw WSJTXMessageError.invalid}
                let data=try Data(contentsOf:recovery);guard data.count<=1_048_576 else{throw WSJTXMessageError.invalid}
                completed=try JSONDecoder().decode([FldigiCompleted].self,from:data)
                guard completed.count<=100 else{throw WSJTXMessageError.invalid}
            }catch{completed=[];completedRecoveryError="Unreadable completed-event recovery was preserved. Resolve it before receiving or accepting another event."}
        }
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
        case "fldigi_accept_completed":
            try require(params,allowed:["id","sessionID","workspaceGeneration","laneID","bindingVersion"],required:["id","sessionID","workspaceGeneration","laneID","bindingVersion"])
            guard receiver != nil,let destination=receiveDestination,contestDestination==destination,let row=completed.first(where:{$0.id==params["id"] as? String}),row.destination==destination,
                  params["sessionID"] as? String==destination.sessionID,params["workspaceGeneration"] as? String==destination.workspaceGeneration,
                  params["laneID"] as? String==destination.laneID,params["bindingVersion"] as? Int==destination.bindingVersion,
                  completedRecoveryError==nil,let contestImporter else{throw WorkerFailure("stale_context","Review the current completed fldigi event and explicit lane.")}
            let generation=receiverGeneration
            var record=row.record;record.fields["APP_XLOG_EXTERNAL_INSTANCE"]="fldigi/observed-udp/\(row.sender)/operator-reviewed"
            let duplicate=try await contestImporter(record,destination)
            guard generation==receiverGeneration,contestDestination==destination else{throw WorkerFailure("stale_context","The fldigi completion context changed.")}
            importedCount += duplicate ? 0:1;duplicateCount += duplicate ? 1:0
            completed.removeAll{$0.id==row.id};try saveCompleted();status=duplicate ? "External event already committed; receipt reconciled.":"Reviewed external event durably committed."
        case "fldigi_rx_text":
            try require(params,allowed:[])
            guard externalIOAllowed() || AppRuntimeProfile.current.connectedLoopbackAcceptance,!terminalShutdown,let destination=receiveDestination else{throw WorkerFailure("digital_unsupported","Received-text access needs an admitted digital contest.")}
            let generation=transmitGeneration,received=try await rpc.receivedText()
            guard generation==transmitGeneration,!terminalShutdown else{throw WorkerFailure("stale_context","The fldigi receive context changed.")}
            let id=UUID().uuidString;rxText=(id,received.text,received.instance,received.version,Date(),destination)
            return ["id":id,"text":received.text,"instanceID":received.instance,"engineVersion":received.version,"receivedAtMS":Date().timeIntervalSince1970*1000,"state":"received_evidence","transmitted":false]
        case "fldigi_select":
            try require(params,allowed:["id","token"],required:["id","token"])
            guard let evidence=rxText,evidence.id==params["id"] as? String,evidence.destination==receiveDestination,Date().timeIntervalSince(evidence.at)<=60,
                  let token=params["token"] as? String,!token.isEmpty,token.utf8.count<=128,evidence.text.components(separatedBy:.whitespacesAndNewlines).contains(token) else{throw WorkerFailure("stale_decode","Review fresh fldigi text and select an exact received token.")}
            return ["value":token,"source":"fldigi/\(evidence.instance)/\(evidence.id)","laneID":evidence.destination.laneID,"bindingVersion":evidence.destination.bindingVersion,
                    "sessionID":evidence.destination.sessionID,"workspaceGeneration":evidence.destination.workspaceGeneration,"transmitted":false]
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
            await returnToReceive(emergency: true)
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
            let payloads = try actions.map { try validate(action: $0, destination: destination) }
            guard !sendInFlight, releasesInFlight == 0, !releaseUncertain else {
                throw WorkerFailure("fldigi_release_required", "Wait for pending output and use Stop to confirm receive before transmitting again.")
            }
            let generation = transmitGeneration
            let duty = UUID()
            transmitDuty = duty; sendInFlight = true
            defer { sendInFlight = false }
            do {
                for payload in payloads {
                    guard generation == transmitGeneration, !terminalShutdown else {
                        throw WorkerFailure("stale_context", "The fldigi output lease was retired.")
                    }
                    try await rpc.call(method: "main.tx", string: nil)
                    let currentDestination = try? await transmitDestinationProvider?()
                    guard generation == transmitGeneration, !terminalShutdown, destination == transmitDestination,
                          transmitDestinationProvider == nil || currentDestination == destination else {
                        throw WorkerFailure("stale_context", "The contest or fldigi output lease changed before text was sent.")
                    }
                    try await rpc.call(method: "text.add_tx", string: payload)
                    guard generation == transmitGeneration, !terminalShutdown else {
                        throw WorkerFailure("stale_context", "The fldigi output lease changed while text was pending.")
                    }
                }
            } catch {
                await returnToReceive(duty: duty, retiringSend: true)
                throw error
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
            guard contestDestination==destination else{return}
            if !completed.contains(where:{$0.sender==sender&&$0.record.fields==records[0].fields}){
                guard completed.count<100 else{throw WorkerFailure("digital_inbox_full","Review retained completions before receiving more.")}
                completed.append(FldigiCompleted(id:UUID().uuidString,packet:records[0].fields,sender:sender,destination:destination,at:Date()))
                try saveCompleted()
            }
            status="Externally completed fldigi event awaiting explicit instance/destination review; not logged."
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
        guard completedRecoveryError==nil else{throw WorkerFailure("digital_recovery_required",completedRecoveryError!)}
        guard externalIOAllowed() || AppRuntimeProfile.current.connectedLoopbackAcceptance, !terminalShutdown else {
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
    private func retireDestination() { contestDestination = nil; contestImporter = nil; rxText=nil }
    private func saveCompleted() throws {
        guard completedRecoveryError==nil else{throw WorkerFailure("digital_recovery_required",completedRecoveryError!)}
        let path=configurationURL.appendingPathExtension("completed.json")
        if FileManager.default.fileExists(atPath:path.path),try path.resourceValues(forKeys:[.isSymbolicLinkKey]).isSymbolicLink==true{throw WorkerFailure("unsafe_configuration","Completed-event recovery cannot use a symbolic link.")}
        try JSONEncoder().encode(completed).write(to:path,options:.atomic)
        try FileManager.default.setAttributes([.posixPermissions:0o600],ofItemAtPath:path.path)
    }
    private func returnToReceive(duty: UUID? = nil, retiringSend: Bool = false, emergency: Bool = false) async {
        let expected = duty ?? transmitDuty
        guard emergency || expected != nil else { return }
        guard externalIOAllowed() else { releaseUncertain = expected != nil; return }
        releasesInFlight += 1
        defer { releasesInFlight -= 1 }
        do {
            try await rpc.call(method: "main.rx", string: nil)
            // RX may overtake a pending TX/text RPC. That send must retire and
            // issue its own final release before this duty can be forgotten.
            if transmitDuty == expected, !sendInFlight || retiringSend {
                transmitDuty = nil; releaseUncertain = false
            }
        } catch {
            releaseUncertain = true
            status = "fldigi receive release is unconfirmed; use Stop to retry before transmitting."
        }
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
                "transmit_release_required": transmitDuty != nil, "transmit_release_uncertain": releaseUncertain,
                "duplicate_count": duplicateCount, "rejected_count": rejectedCount, "status": status,
                "completed":completed.filter{$0.destination==receiveDestination}.map{["id":$0.id,"sender":$0.sender,"packet":$0.packet,"state":"externally_completed_pending_review","instanceEvidence":"UDP has no engine identity; verify the external app before accepting"] as [String:Any]},
                "recovery_error":completedRecoveryError as Any? ?? NSNull(),
                "retained_completed_count":completed.count,
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

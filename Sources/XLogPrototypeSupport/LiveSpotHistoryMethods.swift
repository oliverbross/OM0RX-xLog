import Foundation
import XClusterIntegrationCore
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif

/// One bounded admission queue and serial SQLite writer, independent of live
/// cluster, QSO and station actors. Callbacks only admit immutable values.
final class LiveSpotHistoryMethods: @unchecked Sendable {
    private enum Item {
        case observation(ClusterSpotObservation)
        case connection(UUID, ClusterHistoryConnectionEvent)
    }
    private struct HealthSnapshot: Sendable {
        let summary: SpotHistoryHealthSummary
        let notCommitted: Int
    }
    private let lock = NSLock()
    private let writer = DispatchQueue(label: "xlog.spot-history.writer", qos: .utility)
    private let reader = DispatchQueue(label: "xlog.spot-history.reader", qos: .utility)
    private let url: URL
    private let capacity: Int
    private let startedAt = Date()
    private let processID = UUID()
    private let processGapID = UUID()
    private let shutdownGapID = UUID()
    private var pending: [Item] = []
    private var scheduled: Int?
    private var token = 0
    private var inFlight = false
    private var accepting = true
    private var stopped = false
    private var unrecorded = 0
    private var gapPending = 0
    private var connectionGapPending = 0
    private var errorCode: String?
    private var unavailable = false
    private var activeQueries = 0
    private var retryAttempt = 0
    private var batchLimit = 100
    private var connectionRows: [UUID: ClusterHistoryConnectionEvent] = [:]
    // Each handle is touched only on its corresponding DispatchQueue.
    private var writeDatabase: SpotHistoryDatabase?
    private var readDatabase: SpotHistoryDatabase?
    private var gapRetry: (id: UUID, at: Date, count: Int, connections: Int)?
    private var failureEvent: (id: UUID, at: Date, code: String)?

    init(url: URL, capacity: Int = 4096) {
        self.url = url
        self.capacity = max(1, min(capacity, 4096))
    }

    func observe(_ observation: ClusterSpotObservation) { admit(.observation(observation)) }
    func connection(_ event: ClusterHistoryConnectionEvent) {
        lock.withLock {
            guard accepting else { return }
            // Only the most recent transition per configured server is exposed.
            if connectionRows[event.clusterID] == nil, connectionRows.count >= 128 {
                let oldest = connectionRows.values.filter { $0.phase != .connected }.min { $0.occurredAt < $1.occurredAt }
                    ?? connectionRows.values.min { $0.occurredAt < $1.occurredAt }
                if let oldest { connectionRows.removeValue(forKey: oldest.clusterID) }
            }
            connectionRows[event.clusterID] = event
        }
        admit(.connection(UUID(), event))
    }

    private func admit(_ item: Item) {
        lock.withLock {
            guard accepting else { return }
            guard pending.count < capacity else {
                if case .observation = item { unrecorded += 1; gapPending += 1 }
                else { connectionGapPending += 1 }
                errorCode = "history_queue_overflow"
                return
            }
            pending.append(item)
            if !inFlight {
                if scheduled == nil { scheduleLocked(delay: 0.2) }
                else if pending.count == 100 { scheduleLocked(delay: 0) }
            }
        }
    }

    private func scheduleLocked(delay: Double) {
        token += 1
        let next = token
        scheduled = next
        writer.asyncAfter(deadline: .now() + delay) { [weak self] in self?.pump(token: next) }
    }

    private func database() throws -> SpotHistoryDatabase {
        if let writeDatabase { return writeDatabase }
        let created = try SpotHistoryDatabase(url: url)
        let previous = try created.healthSummary()
        if let previousID = previous.lastProcessID, previousID != processID, !previous.lastProcessClean {
            try created.appendHistoryEvent(id: processGapID, occurredAt: startedAt, kind: "recording_gap",
                payloadJSON: Self.payload(["code": "history_unclean_shutdown", "unknownLoss": true,
                    "processID": processID.uuidString, "previousProcessID": previousID.uuidString, "count": 0]))
        }
        try created.appendHistoryEvent(id: processID, occurredAt: startedAt, kind: "process_start",
            payloadJSON: Self.payload(["processID": processID.uuidString]))
        writeDatabase = created
        return created
    }

    private func pump(token expected: Int) {
        let accepted = lock.withLock { () -> Bool in
            guard accepting, scheduled == expected, !inFlight else { return false }
            scheduled = nil; inFlight = true; return true
        }
        guard accepted else { return }
        let succeeded = flushOneBatch()
        lock.withLock {
            inFlight = false
            if accepting, !pending.isEmpty || gapPending > 0 || connectionGapPending > 0 {
                scheduleLocked(delay: succeeded ? 0 : min(30, 5 * pow(2, Double(min(retryAttempt - 1, 3)))))
            }
        }
    }

    /// Failed jobs remain at the head with their original IDs for idempotent retry.
    private func flushOneBatch() -> Bool {
        let items = lock.withLock { Array(pending.prefix(batchLimit)) }
        do {
            let database = try database()
            let gaps = lock.withLock { (gapPending, connectionGapPending) }
            if gaps.0 > 0 || gaps.1 > 0 {
                let job = gapRetry ?? (UUID(), Date(), gaps.0, gaps.1)
                gapRetry = job
                try database.appendHistoryEvent(id: job.id, occurredAt: job.at, kind: "recording_gap",
                    payloadJSON: try Self.payload(["count": job.count, "lostConnectionEvents": job.connections,
                        "unknownLoss": job.connections > 0, "code": "history_unrecorded_reports", "processID": processID.uuidString]))
                lock.withLock { gapPending -= job.count; connectionGapPending -= job.connections }
                gapRetry = nil
            }
            if let event = failureEvent {
                try database.appendHistoryEvent(id: event.id, occurredAt: event.at, kind: "recording_error",
                    payloadJSON: try Self.payload(["code": event.code, "processID": processID.uuidString]))
                failureEvent = nil
            }
            var consumed = 0
            var observations: [SpotHistoryObservation] = []
            for item in items {
                switch item {
                case .observation(let observation):
                    observations.append(try stored(observation)); consumed += 1
                case .connection(let id, let event):
                    if !observations.isEmpty { break }
                    try database.appendHistoryEvent(id: id, occurredAt: event.occurredAt, kind: "connection",
                        payloadJSON: try Self.payload(["sessionID": event.sessionID.uuidString,
                            "clusterID": event.clusterID.uuidString, "phase": event.phase.rawValue,
                            "clusterName": event.clusterName, "clusterHost": event.clusterHost,
                            "clusterPort": event.clusterPort, "transportGeneration": event.transportGeneration.uuidString]))
                    consumed += 1
                }
                if case .connection = item, !observations.isEmpty { break }
            }
            if !observations.isEmpty { try database.append(observations) }
            lock.withLock {
                pending.removeFirst(consumed)
                unavailable = false
                retryAttempt = 0; batchLimit = 100
                if unrecorded == 0 { errorCode = nil }
            }
            return true
        } catch {
            let invalidJob: Bool
            switch error {
            case SpotHistoryDatabaseError.invalidInput, SpotHistoryDatabaseError.identityConflict: invalidJob = true
            case is EncodingError: invalidJob = true
            default: invalidJob = false
            }
            if invalidJob, !items.isEmpty {
                lock.withLock {
                    errorCode = Self.code(error)
                    if items.count > 1 { batchLimit = 1 }
                    else {
                        let rejected = pending.removeFirst()
                        if case .observation = rejected { unrecorded += 1; gapPending += 1 }
                        else { connectionGapPending += 1 }
                        batchLimit = 100
                    }
                }
                return true
            }
            lock.withLock { errorCode = Self.code(error); unavailable = writeDatabase == nil; retryAttempt += 1 }
            if failureEvent == nil { failureEvent = (UUID(), Date(), Self.code(error)) }
            return false
        }
    }

    private struct CaptureMetadata: Encodable {
        let classified: ClassifiedClusterSpot
        let contactRevision: Int
        let clusterPort: Int
        let transportGeneration: UUID
        let commentLocation = "observation.comment"
    }

    private func stored(_ observation: ClusterSpotObservation) throws -> SpotHistoryObservation {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys]
        var metadataSpot = observation.classified
        // The full comment is retained in the observation itself; duplicating it
        // inside escaped JSON can consume the metadata bound without new data.
        metadataSpot.comment = ""
        let classification = try encoder.encode(CaptureMetadata(classified: metadataSpot,
            contactRevision: observation.contactRevision, clusterPort: observation.clusterPort,
            transportGeneration: observation.transportGeneration))
        let raw = observation.raw, spot = observation.classified
        return .init(id: observation.id, sessionID: observation.sessionID, sequence: observation.sequence,
            clusterID: observation.clusterID, clusterName: observation.clusterName, clusterHost: observation.clusterHost,
            arrivedAt: observation.arrivedAt, reportedAt: observation.reportedAt,
            timeBasis: observation.timeBasis, recordKind: observation.recordKind, rawLine: observation.rawLine,
            callsign: raw.callsign, spotter: raw.spotter, frequencyKHz: raw.frequencyKHz,
            frequencyText: raw.frequencyText, band: spot.band, mode: spot.mode, source: spot.source,
            country: spot.country, adif: spot.adif, comment: raw.comment, specialTags: spot.specialTags,
            callStatus: spot.callStatus, dxccStatus: spot.dxccStatus,
            classificationJSON: String(decoding: classification, as: UTF8.self))
    }

    func stop() async {
        lock.withLock { accepting = false; scheduled = nil }
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            writer.async {
                let deadline = Date().addingTimeInterval(5)
                while self.lock.withLock({ !self.pending.isEmpty || self.gapPending > 0 || self.connectionGapPending > 0 }), Date() < deadline {
                    if !self.flushOneBatch() { break }
                }
                let lost = self.lock.withLock { () -> Int in
                    let lost = self.pending.reduce(0) { count, item in if case .observation = item { return count + 1 }; return count }
                    if !self.pending.isEmpty {
                        self.unrecorded += lost
                        self.connectionGapPending += self.pending.count - lost
                        self.pending.removeAll()
                        self.errorCode = self.errorCode ?? "history_shutdown_gap"
                    }
                    self.stopped = true
                    return lost
                }
                let remainingGap = self.lock.withLock { self.gapPending }
                let lostConnections = self.lock.withLock { self.connectionGapPending }
                let incomplete = lost > 0 || remainingGap > 0 || lostConnections > 0 || self.failureEvent != nil
                if incomplete, let database = self.writeDatabase {
                    try? database.appendHistoryEvent(id: self.shutdownGapID, occurredAt: Date(), kind: "recording_gap",
                        payloadJSON: Self.payload(["code": "history_shutdown_gap", "count": lost + remainingGap,
                            "lostConnectionEvents": lostConnections, "unknownLoss": self.failureEvent != nil || lostConnections > 0,
                            "processID": self.processID.uuidString]))
                } else if let database = self.writeDatabase {
                    try? database.appendHistoryEvent(id: UUID(), occurredAt: Date(), kind: "clean_stop",
                        payloadJSON: Self.payload(["processID": self.processID.uuidString]))
                }
                self.writeDatabase?.close(); self.writeDatabase = nil
                self.reader.async {
                    self.readDatabase?.close(); self.readDatabase = nil
                    continuation.resume()
                }
            }
        }
    }

    func handle(method: String, params: [String: Any]) async throws -> [String: Any] {
        let query: SpotHistoryQuery?
        let identifier: UUID?
        switch method {
        case "spot_history_status":
            guard params.isEmpty else { throw Self.invalid() }
            query = nil; identifier = nil
        case "spot_history_query", "spot_history_stats":
            query = try Self.query(params, stats: method == "spot_history_stats"); identifier = nil
        case "spot_history_detail":
            guard Set(params.keys) == ["id"], let text = params["id"] as? String,
                  let id = UUID(uuidString: text) else { throw Self.invalid() }
            identifier = id; query = nil
        default: throw WorkerFailure("method_not_allowed", "Unknown Spot History method.")
        }
        let admission = lock.withLock { () -> String? in
            if !accepting { return "worker_stopping" }
            if activeQueries >= 8 { return "history_busy" }
            activeQueries += 1; return nil
        }
        if let admission { throw WorkerFailure(admission, "Spot History cannot start this request.") }
        defer { lock.withLock { activeQueries -= 1 } }
        // Opening an archive never creates a cluster session or reads a vault.
        let available = await withCheckedContinuation { (continuation: CheckedContinuation<HealthSnapshot?, Never>) in
            writer.async {
                guard self.lock.withLock({ self.accepting }) else {
                    continuation.resume(returning: nil)
                    return
                }
                do {
                    let summary = try self.database().healthSummary()
                    // Serialize the durable count and pending-gap snapshot with
                    // commits, so one gap cannot be counted on both sides.
                    let pending = self.lock.withLock { self.gapPending }
                    continuation.resume(returning: HealthSnapshot(summary: summary, notCommitted: pending))
                }
                catch {
                    self.lock.withLock { self.unavailable = true; self.errorCode = Self.code(error) }
                    continuation.resume(returning: nil)
                }
            }
        }
        guard let available else {
            guard lock.withLock({ accepting }) else { throw WorkerFailure("worker_stopping", "Spot History has shut down.") }
            if method == "spot_history_status" { return ["status": NSNull(), "recording": recording()] }
            throw WorkerFailure("history_unavailable", "Spot History is unavailable. Existing archive data was left intact.")
        }
        return try await withCheckedThrowingContinuation { continuation in
            reader.async {
                do {
                    guard self.lock.withLock({ self.accepting }) else { throw WorkerFailure("worker_stopping", "Spot History has shut down.") }
                    let database: SpotHistoryDatabase
                    if let existing = self.readDatabase { database = existing }
                    else { database = try SpotHistoryDatabase(url: self.url); self.readDatabase = database }
                    let result: [String: Any]
                    switch method {
                    case "spot_history_status":
                        var recording = self.recording()
                        let events = try database.historyEvents(limit: 128)
                        recording["events"] = try Self.json(events)
                        let summary = available.summary
                        recording["retainedGap"] = summary.unknownGap || summary.knownUnrecorded > 0
                        recording["unknownGap"] = summary.unknownGap
                        recording["eventsTruncated"] = events.count == 128
                        let notCommitted = available.notCommitted
                        recording["unrecorded"] = Int(min(Int64(Int.max - notCommitted), summary.knownUnrecorded)) + notCommitted
                        result = ["status": try Self.json(database.status()), "recording": recording]
                    case "spot_history_query":
                        var page = try Self.json(database.query(query!)) as! [String: Any]
                        page["rows"] = (page["rows"] as? [[String: Any]] ?? []).map { row in
                            var row = row
                            row.removeValue(forKey: "rawLine"); row.removeValue(forKey: "classificationJSON")
                            let bounds = ["clusterName": 128, "clusterHost": 253, "country": 256,
                                "callsign": 64, "spotter": 64, "frequencyText": 64, "band": 32,
                                "mode": 32, "source": 32, "callStatus": 64, "dxccStatus": 64,
                                "timeBasis": 32, "recordKind": 32, "comment": 512]
                            var shortened = false
                            for (field, maximum) in bounds {
                                if let original = row[field] as? String {
                                    let clean = String(String.UnicodeScalarView(original.unicodeScalars.filter { $0.value >= 0x20 && $0.value != 0x7f }))
                                    let displayed = String(decoding: Data(clean.utf8.prefix(maximum)), as: UTF8.self)
                                    if displayed != original { shortened = true }
                                    row[field] = displayed
                                    if field == "comment" { row["commentTruncated"] = displayed != original }
                                }
                            }
                            if let tags = row["specialTags"] as? [String] {
                                let displayed = tags.prefix(16).map { tag in
                                    let clean = String(String.UnicodeScalarView(tag.unicodeScalars.filter { $0.value >= 0x20 && $0.value != 0x7f }))
                                    return String(decoding: Data(clean.utf8.prefix(64)), as: UTF8.self)
                                }
                                shortened = shortened || displayed != tags
                                row["specialTags"] = displayed
                            }
                            row["metadataTruncated"] = shortened
                            return row
                        }
                        result = ["page": page]
                    case "spot_history_stats": result = ["stats": try Self.json(database.stats(query!))]
                    default:
                        if let row = try database.detail(id: identifier!) { result = ["observation": try Self.json(row)] }
                        else { result = ["observation": NSNull()] }
                    }
                    continuation.resume(returning: result)
                } catch {
                    if let failure = error as? WorkerFailure { continuation.resume(throwing: failure) }
                    else if case SpotHistoryDatabaseError.invalidCursor = error {
                        continuation.resume(throwing: WorkerFailure("history_invalid_cursor", "This history cursor does not match the search. Refresh the search."))
                    } else if case SpotHistoryDatabaseError.invalidInput = error { continuation.resume(throwing: Self.invalid()) }
                    else {
                        continuation.resume(throwing: WorkerFailure("history_unavailable", "Spot History could not read the archive."))
                    }
                }
            }
        }
    }

    private func recording() -> [String: Any] {
        lock.withLock {
            let state = stopped ? "stopped" : unavailable ? "unavailable" : errorCode != nil || unrecorded > 0 ? "degraded" : connectionRows.values.contains { $0.phase == .connected } ? "recording" : "idle"
            let formatter = ISO8601DateFormatter()
            let connections: [[String: Any]] = connectionRows.values.sorted { $0.clusterID.uuidString < $1.clusterID.uuidString }.map {
                ["sessionID": $0.sessionID.uuidString, "clusterID": $0.clusterID.uuidString,
                 "clusterName": $0.clusterName, "phase": $0.phase.rawValue, "at": formatter.string(from: $0.occurredAt)]
            }
            return ["state": state, "queued": pending.count, "unrecorded": unrecorded,
                "errorCode": errorCode as Any? ?? NSNull(), "connections": connections,
                "startedAt": formatter.string(from: startedAt)]
        }
    }

    private static func query(_ params: [String: Any], stats: Bool) throws -> SpotHistoryQuery {
        let keys: Set<String> = ["call", "spotter", "match", "from", "to", "band", "mode", "source", "limit", "cursor", "watermark"]
        guard Set(params.keys).isSubset(of: keys) else { throw invalid() }
        func text(_ key: String, maximum: Int, fallback: String = "") throws -> String {
            guard let value = params[key], !(value is NSNull) else { return fallback }
            guard let value = value as? String, value.utf8.count <= maximum,
                  !value.unicodeScalars.contains(where: { $0.value < 0x20 || $0.value == 0x7f }) else { throw invalid() }
            return value
        }
        func integer(_ key: String) throws -> Int64? {
            guard let value = params[key], !(value is NSNull) else { return nil }
            guard let number = value as? NSNumber, !Self.isJSONBoolean(number),
                  number.doubleValue.isFinite, number.doubleValue >= 0, number.doubleValue < 9_007_199_254_740_992,
                  number.doubleValue.rounded() == number.doubleValue else { throw invalid() }
            return number.int64Value
        }
        func date(_ key: String) throws -> Date? {
            let value = try text(key, maximum: 40)
            if value.isEmpty { return nil }
            guard value.hasSuffix("Z") else { throw invalid() }
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = formatter.date(from: value) { return date }
            formatter.formatOptions = [.withInternetDateTime]
            guard let date = formatter.date(from: value) else { throw invalid() }
            return date
        }
        let match = try text("match", maximum: 8, fallback: "exact")
        let limit = try integer("limit") ?? 100
        let from = try date("from"), to = try date("to")
        let cursor = try text("cursor", maximum: 4096)
        guard ["exact", "prefix"].contains(match), (1...100).contains(limit),
              from == nil || to == nil || from! < to!, !stats || cursor.isEmpty else { throw invalid() }
        return .init(call: try text("call", maximum: 64), spotter: try text("spotter", maximum: 64), match: match,
            from: from, to: to, band: try text("band", maximum: 32), mode: try text("mode", maximum: 32),
            source: try text("source", maximum: 32), limit: Int(limit), cursor: cursor.isEmpty ? nil : cursor,
            watermark: try integer("watermark"))
    }

    private static func isJSONBoolean(_ number: NSNumber) -> Bool {
        // Match the portable service boundary without CoreFoundation type IDs.
        guard let encoded = try? JSONSerialization.data(withJSONObject: [number]) else { return false }
        return encoded == Data("[true]".utf8) || encoded == Data("[false]".utf8)
    }

    private static func json<T: Encodable>(_ value: T) throws -> Any {
        let encoder = JSONEncoder(); encoder.dateEncodingStrategy = .iso8601
        return try JSONSerialization.jsonObject(with: encoder.encode(value))
    }
    private static func payload(_ value: [String: Any]) throws -> String {
        String(decoding: try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]), as: UTF8.self)
    }
    private static func invalid() -> WorkerFailure { WorkerFailure("invalid_params", "Invalid Spot History request.") }
    private static func code(_ error: Error) -> String {
        switch error {
        case SpotHistoryDatabaseError.unsafePath: return "history_unsafe_path"
        case SpotHistoryDatabaseError.futureSchema: return "history_future_schema"
        case SpotHistoryDatabaseError.invalidInput: return "history_invalid_observation"
        case SpotHistoryDatabaseError.identityConflict: return "history_identity_conflict"
        case SpotHistoryDatabaseError.corruptRecord: return "history_corrupt_record"
        case is EncodingError: return "history_invalid_observation"
        default: return "history_database_error"
        }
    }
}

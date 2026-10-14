import Foundation
#if canImport(SQLite3)
import SQLite3
#else
import CSQLitePrototype
#endif

public enum LogbookDatabaseError: Error, LocalizedError {
    case open(String)
    case sqlite(String)
    case corruptRecord
    case closed
    case syncBusy
    case syncRunChanged

    public var errorDescription: String? {
        switch self {
        case let .open(message): return "Could not open the xLog database: \(message)"
        case let .sqlite(message): return "xLog database error: \(message)"
        case .corruptRecord: return "A stored QSO could not be decoded."
        case .closed: return "The xLog database is closed."
        case .syncBusy: return "Synchronization is already running for this database."
        case .syncRunChanged: return "The synchronization database session changed."
        }
    }
}

public struct OpportunityReferenceHistory: Codable, Equatable, Sendable {
    public struct BandMode: Codable, Equatable, Sendable {
        public var band: String
        public var mode: String
        public var workedCount: Int
        public var confirmedCount: Int
    }
    public var kind: String
    public var reference: String
    public var workedCount: Int
    public var confirmedCount: Int
    public var bandModes: [BandMode]
}

/// Exact contact inputs needed by xCluster classification, without decoding
/// the rest of each full QSO record. Confirmation remains the consumer's rule:
/// raw QSL strings are intentionally not collapsed into a Boolean here.
public struct ClusterContactRow: Codable, Equatable, Sendable {
    public let call: String
    public let band: String
    public let mode: String
    public let dxcc: Int?
    public let start: Date
    public let qslReceived: String
    public let lotwReceived: String

    public init(call: String, band: String, mode: String, dxcc: Int?, start: Date,
                qslReceived: String, lotwReceived: String) {
        self.call = call
        self.band = band
        self.mode = mode
        self.dxcc = dxcc
        self.start = start
        self.qslReceived = qslReceived
        self.lotwReceived = lotwReceived
    }
}

/// Fields used by callsign/country intelligence. Large country histories must
/// not decode every editable QSO field or arbitrary ADIF payload just to count
/// contacts and paint a small band/mode matrix.
public struct ContactHistoryRow: Decodable, Sendable {
    public let id: UUID
    public let call: String
    public let start: Date
    public let band: String
    public let mode: String
    public let submode: String
    public let dxcc: Int?
    public let qslReceived: String
    public let lotwReceived: String
    public let lotwSent: String
    public let gridSquare: String
    public let rstSent: String
    public let rstReceived: String
    public let deletedAt: Date?

    public init(_ qso: QSO) {
        id = qso.id; call = qso.call; start = qso.start; band = qso.band
        mode = qso.mode; submode = qso.submode; dxcc = qso.dxcc
        qslReceived = qso.qslReceived; lotwReceived = qso.lotwReceived; lotwSent = qso.lotwSent
        gridSquare = qso.gridSquare; rstSent = qso.rstSent; rstReceived = qso.rstReceived
        deletedAt = qso.deletedAt
    }
}

public final class LogbookDatabase: @unchecked Sendable {
    private var handle: OpaquePointer?
    private let lock = NSRecursiveLock()
    let syncAdmission = SyncDatabaseAdmission()
    private var syncRunID: UUID?
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()
    private static let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
    private var cachedDataVersion: Int?
    private var cachedStats: LogbookStats?
    private var cachedStatsYearStart: TimeInterval?
    private var cachedAwards: AwardProgressSnapshot?
    private var cachedDXCCStatuses: [Int: String]?
    private var cachedAwardCatalog: AwardCatalogSnapshot?
    private var cachedOpportunityReferences: [OpportunityReferenceHistory]?
    private var cachedClusterContactRows: [ClusterContactRow]?
    // Eligibility is never restored from disk. A reopened/restored database
    // requires a new native arm before any persisted scope can receive samples.
    private var operatorPowerScopeID: UUID?
    private var spotDraftLeaseID: UUID?

    public let url: URL

    public static func defaultURL() throws -> URL {
        let support = try FileManager.default.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        return support.appendingPathComponent("OM0RX-xLog", isDirectory: true)
            .appendingPathComponent("OM0RX-xLog.sqlite")
    }

    public init(url: URL? = nil) throws {
        self.url = try url ?? Self.defaultURL()
        try FileManager.default.createDirectory(
            at: self.url.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        let flags = SQLITE_OPEN_CREATE | SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX
        guard sqlite3_open_v2(self.url.path, &handle, flags, nil) == SQLITE_OK else {
            let message = handle.map { String(cString: sqlite3_errmsg($0)) } ?? "unknown error"
            sqlite3_close(handle)
            throw LogbookDatabaseError.open(message)
        }
        sqlite3_busy_timeout(handle, 5_000)
        try execute("PRAGMA journal_mode=WAL;")
        try execute("PRAGMA foreign_keys=ON;")
        try migrate()
    }

    deinit { close() }

    public func close() {
        withDatabaseLock {
            guard let handle else { return }
            syncRunID = nil
            spotDraftLeaseID = nil
            sqlite3_close_v2(handle)
            self.handle = nil
        }
    }

    public func backup(to destination: URL) throws {
        try withDatabaseLock {
            guard let handle else { throw LogbookDatabaseError.closed }
            let fileManager = FileManager.default
            try fileManager.createDirectory(
                at: destination.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            if fileManager.fileExists(atPath: destination.path) {
                try fileManager.removeItem(at: destination)
            }

            var destinationHandle: OpaquePointer?
            let flags = SQLITE_OPEN_CREATE | SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX
            guard sqlite3_open_v2(destination.path, &destinationHandle, flags, nil) == SQLITE_OK,
                  let destinationHandle else {
                let message = destinationHandle.map { String(cString: sqlite3_errmsg($0)) } ?? "unknown error"
                sqlite3_close(destinationHandle)
                throw LogbookDatabaseError.open("Could not create backup: \(message)")
            }
            defer { sqlite3_close(destinationHandle) }

            guard let backup = sqlite3_backup_init(destinationHandle, "main", handle, "main") else {
                throw LogbookDatabaseError.sqlite(String(cString: sqlite3_errmsg(destinationHandle)))
            }
            let result = sqlite3_backup_step(backup, -1)
            let finish = sqlite3_backup_finish(backup)
            guard result == SQLITE_DONE, finish == SQLITE_OK else {
                throw LogbookDatabaseError.sqlite(String(cString: sqlite3_errmsg(destinationHandle)))
            }
            guard sqlite3_exec(destinationHandle, "PRAGMA journal_mode=DELETE;", nil, nil, nil) == SQLITE_OK else {
                throw LogbookDatabaseError.sqlite(String(cString: sqlite3_errmsg(destinationHandle)))
            }
        }
    }

    public func save(_ value: QSO, markDirty: Bool = true) throws {
        try save(value, markDirty: markDirty, onlineLogCandidate: false)
    }

    /// The prospective-enrollment check and insert share a SQLite write lock,
    /// so another connection cannot enable/disable between the contact commit
    /// and candidate registration.
    public func saveNewContactForOnlineLogs(_ value: QSO, markDirty: Bool = true) throws {
        try withDatabaseLock {
            try execute("BEGIN IMMEDIATE;")
            do {
                try save(value, markDirty: markDirty, onlineLogCandidate: true)
                try execute("COMMIT;")
            } catch { try? execute("ROLLBACK;"); throw error }
        }
    }

    private func save(_ value: QSO, markDirty: Bool, onlineLogCandidate: Bool) throws {
        try withDatabaseLock {
            if spotDraftLeaseID != nil, try readOperatorDraft()?.qso.id == value.id { throw SpotDraftError.busy }
            let isNewOnlineLogCandidate: Bool
            if onlineLogCandidate { isNewOnlineLogCandidate = try lookup(localID: value.id) == nil }
            else { isNewOnlineLogCandidate = false }
            let qso = normalizedForSave(value, markDirty: markDirty, updatedAt: Date())
            try qso.adifFieldMetadata?.validate(fields: qso.adifRecord.fields)
            if qso.adifFieldMetadata != nil, try encoder.encode(qso).count > 24_576 { throw ADIFPlanningError.invalidPreview }
            let data = try encoder.encode(qso)
            let sql = """
            INSERT INTO qsos(local_id,wavelog_id,call,qso_start,band,mode,frequency_hz,is_dirty,deleted_at,updated_at,record_json,baseline_json)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(local_id) DO UPDATE SET
              wavelog_id=excluded.wavelog_id, call=excluded.call, qso_start=excluded.qso_start,
              band=excluded.band, mode=excluded.mode, frequency_hz=excluded.frequency_hz,
              is_dirty=excluded.is_dirty, deleted_at=excluded.deleted_at,
              updated_at=excluded.updated_at, record_json=excluded.record_json,
              baseline_json=CASE WHEN excluded.is_dirty = 0 THEN excluded.baseline_json ELSE qsos.baseline_json END;
            """
            try withStatement(sql) { statement in
                bind(qso.id.uuidString, to: 1, in: statement)
                bind(qso.wavelogID, to: 2, in: statement)
                bind(qso.call, to: 3, in: statement)
                sqlite3_bind_double(statement, 4, qso.start.timeIntervalSince1970)
                bind(qso.band, to: 5, in: statement)
                bind(qso.mode, to: 6, in: statement)
                bind(qso.frequencyHz, to: 7, in: statement)
                sqlite3_bind_int(statement, 8, qso.isDirty ? 1 : 0)
                if let deletedAt = qso.deletedAt { sqlite3_bind_double(statement, 9, deletedAt.timeIntervalSince1970) }
                else { sqlite3_bind_null(statement, 9) }
                sqlite3_bind_double(statement, 10, qso.updatedAt.timeIntervalSince1970)
                _ = data.withUnsafeBytes { bytes in
                    sqlite3_bind_blob(statement, 11, bytes.baseAddress, Int32(bytes.count), Self.transient)
                }
                if markDirty {
                    sqlite3_bind_null(statement, 12)
                } else {
                    let baseline = try syncFingerprint(qso)
                    _ = baseline.withUnsafeBytes { bytes in
                        sqlite3_bind_blob(statement, 12, bytes.baseAddress, Int32(bytes.count), Self.transient)
                    }
                }
                try stepDone(statement)
            }
            if isNewOnlineLogCandidate, qso.deletedAt == nil {
                try withStatement("""
                    INSERT OR IGNORE INTO xlog_online_log_candidates(service,local_id,enrolled_at)
                    SELECT service,?,? FROM xlog_online_log_enrollments WHERE active=1;
                    """) { statement in
                        bind(qso.id.uuidString, to: 1, in: statement)
                        sqlite3_bind_double(statement, 2, qso.updatedAt.timeIntervalSince1970)
                        try stepDone(statement)
                    }
            } else if qso.deletedAt != nil {
                // A contact deleted before first delivery is cancelled. Restoring
                // it later is an edit, not a newly logged QSO, so it stays out.
                try withStatement("DELETE FROM xlog_online_log_candidates WHERE local_id=?;") { statement in
                    bind(qso.id.uuidString, to: 1, in: statement)
                    try stepDone(statement)
                }
            }
            invalidateQSOAggregates()
        }
    }

    /// Enrollment is explicit and prospective. Enabling never scans existing
    /// rows; disabling drops only unsent candidate membership, not contacts or
    /// provider receipts. Re-enabling starts another new-contacts-only boundary.
    public func configureOnlineLogEnrollment(service: OnlineLogService, enabled: Bool,
                                             at date: Date = Date()) throws -> OnlineLogEnrollmentStatus {
        try withDatabaseLock {
            try execute("BEGIN IMMEDIATE;")
            do {
                try withStatement("""
                    INSERT INTO xlog_online_log_enrollments(service,active,enabled_at) VALUES(?,?,?)
                    ON CONFLICT(service) DO UPDATE SET active=excluded.active,enabled_at=excluded.enabled_at;
                    """) { statement in
                        bind(service.rawValue, to: 1, in: statement)
                        sqlite3_bind_int(statement, 2, enabled ? 1 : 0)
                        if enabled { sqlite3_bind_double(statement, 3, date.timeIntervalSince1970) }
                        else { sqlite3_bind_null(statement, 3) }
                        try stepDone(statement)
                    }
                if !enabled {
                    try withStatement("DELETE FROM xlog_online_log_candidates WHERE service=?;") { statement in
                        bind(service.rawValue, to: 1, in: statement)
                        try stepDone(statement)
                    }
                }
                let status = try onlineLogEnrollmentStatus(service: service)
                try execute("COMMIT;")
                return status
            } catch { try? execute("ROLLBACK;"); throw error }
        }
    }

    public func onlineLogEnrollmentStatus(service: OnlineLogService) throws -> OnlineLogEnrollmentStatus {
        try withDatabaseLock {
            var enabled = false, enabledAt: Date?
            try withStatement("SELECT active,enabled_at FROM xlog_online_log_enrollments WHERE service=?;") { statement in
                bind(service.rawValue, to: 1, in: statement)
                let step = sqlite3_step(statement)
                if step == SQLITE_ROW {
                    enabled = sqlite3_column_int(statement, 0) == 1
                    if sqlite3_column_type(statement, 1) != SQLITE_NULL {
                        enabledAt = Date(timeIntervalSince1970: sqlite3_column_double(statement, 1))
                    }
                } else if step != SQLITE_DONE { throw error() }
            }
            let count = try withStatement("SELECT COUNT(*) FROM xlog_online_log_candidates WHERE service=?;") { statement in
                bind(service.rawValue, to: 1, in: statement)
                guard sqlite3_step(statement) == SQLITE_ROW else { throw error() }
                return Int(sqlite3_column_int64(statement, 0))
            }
            return OnlineLogEnrollmentStatus(service: service, enabled: enabled,
                                             enabledAt: enabledAt, pendingNewContacts: count)
        }
    }

    public func onlineLogCandidateIDs(service: OnlineLogService, limit: Int = 100) throws -> [UUID] {
        try withDatabaseLock {
            guard (1...500).contains(limit) else { throw OnlineLogDeliveryError.invalidPlan }
            return try withStatement("""
                SELECT c.local_id FROM xlog_online_log_candidates c
                JOIN qsos q ON q.local_id=c.local_id
                WHERE c.service=? AND q.deleted_at IS NULL ORDER BY c.enrolled_at,c.local_id LIMIT ?;
                """) { statement in
                    bind(service.rawValue, to: 1, in: statement)
                    sqlite3_bind_int(statement, 2, Int32(limit))
                    var values: [UUID] = []
                    var step = sqlite3_step(statement)
                    while step == SQLITE_ROW {
                        guard let text = sqlite3_column_text(statement, 0),
                              let id = UUID(uuidString: String(cString: text)) else {
                            throw LogbookDatabaseError.corruptRecord
                        }
                        values.append(id); step = sqlite3_step(statement)
                    }
                    guard step == SQLITE_DONE else { throw error() }
                    return values
                }
        }
    }

    public func onlineLogDeliverySummary(service: OnlineLogService) throws -> OnlineLogDeliverySummary {
        try withDatabaseLock {
            var counts = Dictionary(uniqueKeysWithValues: OnlineLogDeliveryState.allCases.map { ($0, 0) })
            try withStatement("SELECT state,COUNT(*) FROM xlog_online_log_deliveries WHERE service=? GROUP BY state;") { statement in
                bind(service.rawValue, to: 1, in: statement)
                var step = sqlite3_step(statement)
                while step == SQLITE_ROW {
                    guard let text = sqlite3_column_text(statement, 0),
                          let state = OnlineLogDeliveryState(rawValue: String(cString: text)) else {
                        throw LogbookDatabaseError.corruptRecord
                    }
                    counts[state] = Int(sqlite3_column_int64(statement, 1))
                    step = sqlite3_step(statement)
                }
                guard step == SQLITE_DONE else { throw error() }
            }
            var latestState: OnlineLogDeliveryState?, latestAttemptAt: Date?, latestCode: String?
            try withStatement("""
                SELECT state,last_attempt_at,last_error_code FROM xlog_online_log_deliveries
                WHERE service=? ORDER BY last_attempt_at DESC,local_id DESC LIMIT 1;
                """) { statement in
                    bind(service.rawValue, to: 1, in: statement)
                    let step = sqlite3_step(statement)
                    if step == SQLITE_ROW {
                        guard let text = sqlite3_column_text(statement, 0),
                              let state = OnlineLogDeliveryState(rawValue: String(cString: text)) else {
                            throw LogbookDatabaseError.corruptRecord
                        }
                        latestState = state
                        latestAttemptAt = Date(timeIntervalSince1970: sqlite3_column_double(statement, 1))
                        latestCode = sqlite3_column_text(statement, 2).map { String(cString: $0) }
                    } else if step != SQLITE_DONE { throw error() }
                }
            return OnlineLogDeliverySummary(enrollment: try onlineLogEnrollmentStatus(service: service),
                counts: counts, latestState: latestState, latestAttemptAt: latestAttemptAt,
                latestSafeErrorCode: latestCode)
        }
    }

    /// One joined SELECT pairs the contact with its revision atomically, including
    /// pre-migration rows (revision zero) without rewriting/scanning the logbook.
    public func contactSnapshot(localID: UUID) throws -> LogbookContactSnapshot? {
        try withDatabaseLock {
            try withStatement("SELECT q.record_json, COALESCE(r.revision,0) FROM qsos q LEFT JOIN xlog_contact_revisions r ON r.local_id=q.local_id WHERE q.local_id=?;") { statement in
                bind(localID.uuidString, to: 1, in: statement)
                let step = sqlite3_step(statement)
                if step == SQLITE_DONE { return nil }
                guard step == SQLITE_ROW, let bytes = sqlite3_column_blob(statement, 0) else { throw error() }
                let qso = try decoder.decode(QSO.self, from: Data(bytes: bytes, count: Int(sqlite3_column_bytes(statement, 0))))
                return LogbookContactSnapshot(revision: sqlite3_column_int64(statement, 1), qso: qso)
            }
        }
    }

    public func prepareOnlineLogDelivery(service: OnlineLogService, contactID: UUID) throws -> OnlineLogDeliveryPlan {
        try withDatabaseLock {
            guard let contact = try contactSnapshot(localID: contactID), contact.qso.deletedAt == nil else {
                throw OnlineLogDeliveryError.staleContact
            }
            return try OnlineLogDeliveryPlan(service: service, contact: contact,
                                             adif: contact.qso.adifRecord.recordDocument)
        }
    }

    public func onlineLogDeliveryReceipt(service: OnlineLogService, contactID: UUID,
                                         contactRevision: Int64) throws -> OnlineLogDeliveryReceipt? {
        try withDatabaseLock {
            try withStatement("""
                SELECT payload_sha256,state,attempt_id,attempt_count,last_attempt_at,next_attempt_at,remote_id,last_error_code
                FROM xlog_online_log_deliveries WHERE service=? AND local_id=? AND contact_revision=?;
                """) { statement in
                    bind(service.rawValue, to: 1, in: statement)
                    bind(contactID.uuidString, to: 2, in: statement)
                    sqlite3_bind_int64(statement, 3, contactRevision)
                    let step = sqlite3_step(statement)
                    if step == SQLITE_DONE { return nil }
                    guard step == SQLITE_ROW,
                          let hash = sqlite3_column_text(statement, 0).map({ String(cString: $0) }),
                          let stateText = sqlite3_column_text(statement, 1).map({ String(cString: $0) }),
                          let state = OnlineLogDeliveryState(rawValue: stateText),
                          let attemptText = sqlite3_column_text(statement, 2).map({ String(cString: $0) }),
                          let attemptID = UUID(uuidString: attemptText) else { throw LogbookDatabaseError.corruptRecord }
                    let next = sqlite3_column_type(statement, 5) == SQLITE_NULL
                        ? nil : Date(timeIntervalSince1970: sqlite3_column_double(statement, 5))
                    return OnlineLogDeliveryReceipt(service: service, contactID: contactID,
                        contactRevision: contactRevision, payloadSHA256: hash, state: state,
                        attemptID: attemptID, attemptCount: Int(sqlite3_column_int(statement, 3)),
                        lastAttemptAt: Date(timeIntervalSince1970: sqlite3_column_double(statement, 4)),
                        nextAttemptAt: next,
                        remoteID: sqlite3_column_text(statement, 6).map { String(cString: $0) },
                        safeErrorCode: sqlite3_column_text(statement, 7).map { String(cString: $0) })
                }
        }
    }

    /// Persist the exact immutable contact revision before any provider request.
    /// Replaying the same or a terminal claim never authorizes another request.
    public func claimOnlineLogDelivery(_ plan: OnlineLogDeliveryPlan, attemptID: UUID,
                                       at date: Date = Date()) throws -> OnlineLogDeliveryClaim {
        try withDatabaseLock {
            try execute("BEGIN IMMEDIATE;")
            do {
                // The write transaction closes the review-to-claim race across
                // separate LogbookDatabase connections to the same SQLite file.
                guard let current = try contactSnapshot(localID: plan.contact.qso.id), current == plan.contact,
                      try OnlineLogDeliveryPlan(service: plan.service, contact: current,
                                                adif: current.qso.adifRecord.recordDocument) == plan else {
                    throw OnlineLogDeliveryError.staleContact
                }
                if let existing = try onlineLogDeliveryReceipt(service: plan.service, contactID: plan.contact.qso.id,
                                                                contactRevision: plan.contact.revision) {
                    guard existing.payloadSHA256 == plan.payloadSHA256 else { throw OnlineLogDeliveryError.operationMismatch }
                    if existing.attemptID == attemptID || existing.state != .deferred {
                        if Self.isTerminalOnlineLogDelivery(existing.state) {
                            try retireOnlineLogCandidate(service: plan.service, contactID: plan.contact.qso.id)
                        }
                        try execute("COMMIT;")
                        return OnlineLogDeliveryClaim(receipt: existing, shouldDispatch: false)
                    }
                    guard existing.attemptCount < 3 else {
                        try execute("COMMIT;")
                        return OnlineLogDeliveryClaim(receipt: existing, shouldDispatch: false)
                    }
                    if let due = existing.nextAttemptAt, due > date { throw OnlineLogDeliveryError.notDue }
                    try withStatement("""
                        UPDATE xlog_online_log_deliveries SET state='dispatching',attempt_id=?,attempt_count=?,
                          last_attempt_at=?,next_attempt_at=NULL,remote_id=NULL,last_error_code=NULL
                        WHERE service=? AND local_id=? AND contact_revision=?;
                        """) { statement in
                            bind(attemptID.uuidString, to: 1, in: statement)
                            sqlite3_bind_int(statement, 2, Int32(existing.attemptCount + 1))
                            sqlite3_bind_double(statement, 3, date.timeIntervalSince1970)
                            bind(plan.service.rawValue, to: 4, in: statement)
                            bind(plan.contact.qso.id.uuidString, to: 5, in: statement)
                            sqlite3_bind_int64(statement, 6, plan.contact.revision)
                            try stepDone(statement)
                        }
                } else {
                    try withStatement("""
                        INSERT INTO xlog_online_log_deliveries(
                          service,local_id,contact_revision,payload_sha256,state,attempt_id,attempt_count,last_attempt_at
                        ) VALUES(?,?,?,?,?,?,1,?);
                        """) { statement in
                            bind(plan.service.rawValue, to: 1, in: statement)
                            bind(plan.contact.qso.id.uuidString, to: 2, in: statement)
                            sqlite3_bind_int64(statement, 3, plan.contact.revision)
                            bind(plan.payloadSHA256, to: 4, in: statement)
                            bind(OnlineLogDeliveryState.dispatching.rawValue, to: 5, in: statement)
                            bind(attemptID.uuidString, to: 6, in: statement)
                            sqlite3_bind_double(statement, 7, date.timeIntervalSince1970)
                            try stepDone(statement)
                        }
                }
                guard let receipt = try onlineLogDeliveryReceipt(service: plan.service, contactID: plan.contact.qso.id,
                                                                  contactRevision: plan.contact.revision) else {
                    throw LogbookDatabaseError.corruptRecord
                }
                try execute("COMMIT;")
                return OnlineLogDeliveryClaim(receipt: receipt, shouldDispatch: true)
            } catch { try? execute("ROLLBACK;"); throw error }
        }
    }

    public func resolveOnlineLogDelivery(_ plan: OnlineLogDeliveryPlan, attemptID: UUID,
                                         resolution: OnlineLogDeliveryResolution,
                                         disableEnrollmentOnRejection: Bool = false,
                                         at date: Date = Date()) throws -> OnlineLogDeliveryReceipt {
        try withDatabaseLock {
            try execute("BEGIN IMMEDIATE;")
            do {
                guard let existing = try onlineLogDeliveryReceipt(service: plan.service, contactID: plan.contact.qso.id,
                    contactRevision: plan.contact.revision), existing.payloadSHA256 == plan.payloadSHA256,
                      existing.attemptID == attemptID else { throw OnlineLogDeliveryError.operationMismatch }
                if existing.state != .dispatching {
                    if Self.isTerminalOnlineLogDelivery(existing.state) {
                        try retireOnlineLogCandidate(service: plan.service, contactID: plan.contact.qso.id)
                    }
                    try execute("COMMIT;")
                    return existing
                }
                let state: OnlineLogDeliveryState
                var nextAttempt: Date?, remoteID: String?, code: String?
                switch resolution {
                case .delivered(let identifier):
                    guard identifier.map({ !$0.isEmpty && $0.utf8.count <= 64 && $0.allSatisfy(\.isNumber) }) ?? true else {
                        throw OnlineLogDeliveryError.invalidPlan
                    }
                    state = .delivered; remoteID = identifier
                case .rateLimited(let providerDate):
                    if existing.attemptCount >= 3 { state = .rejected; code = "retry_limit" }
                    else {
                        state = .deferred; code = "rate_limited"
                        let floor = date.addingTimeInterval(30 * pow(2, Double(existing.attemptCount - 1)))
                        let ceiling = date.addingTimeInterval(3_600)
                        nextAttempt = max(floor, min(providerDate ?? floor, ceiling))
                    }
                case .rejected(let value): state = .rejected; code = value
                case .uncertain(let value): state = .uncertain; code = value
                }
                if let code {
                    guard !code.isEmpty, code.utf8.count <= 64,
                          code.utf8.allSatisfy({ (48...57).contains($0) || (97...122).contains($0) || $0 == 95 }) else {
                        throw OnlineLogDeliveryError.invalidPlan
                    }
                }
                try withStatement("""
                    UPDATE xlog_online_log_deliveries SET state=?,next_attempt_at=?,remote_id=?,last_error_code=?
                    WHERE service=? AND local_id=? AND contact_revision=? AND attempt_id=?;
                    """) { statement in
                        bind(state.rawValue, to: 1, in: statement)
                        if let nextAttempt { sqlite3_bind_double(statement, 2, nextAttempt.timeIntervalSince1970) }
                        else { sqlite3_bind_null(statement, 2) }
                        bind(remoteID, to: 3, in: statement); bind(code, to: 4, in: statement)
                        bind(plan.service.rawValue, to: 5, in: statement)
                        bind(plan.contact.qso.id.uuidString, to: 6, in: statement)
                        sqlite3_bind_int64(statement, 7, plan.contact.revision)
                        bind(attemptID.uuidString, to: 8, in: statement)
                        try stepDone(statement)
                    }
                guard let receipt = try onlineLogDeliveryReceipt(service: plan.service, contactID: plan.contact.qso.id,
                                                                  contactRevision: plan.contact.revision) else {
                    throw LogbookDatabaseError.corruptRecord
                }
                if Self.isTerminalOnlineLogDelivery(receipt.state) {
                    try retireOnlineLogCandidate(service: plan.service, contactID: plan.contact.qso.id)
                }
                if disableEnrollmentOnRejection, receipt.state == .rejected {
                    try withStatement("""
                        INSERT INTO xlog_online_log_enrollments(service,active,enabled_at) VALUES(?,0,NULL)
                        ON CONFLICT(service) DO UPDATE SET active=0,enabled_at=NULL;
                        """) { statement in
                            bind(plan.service.rawValue, to: 1, in: statement)
                            try stepDone(statement)
                        }
                    try withStatement("DELETE FROM xlog_online_log_candidates WHERE service=?;") { statement in
                        bind(plan.service.rawValue, to: 1, in: statement)
                        try stepDone(statement)
                    }
                }
                try execute("COMMIT;")
                return receipt
            } catch { try? execute("ROLLBACK;"); throw error }
        }
    }

    /// Call once when a worker starts. A process that died after claiming an
    /// INSERT cannot know whether QRZ committed it, so startup never retries it.
    public func recoverInterruptedOnlineLogDeliveries() throws -> Int {
        try withDatabaseLock {
            try execute("BEGIN IMMEDIATE;")
            do {
                let count = try withStatement("SELECT COUNT(*) FROM xlog_online_log_deliveries WHERE state='dispatching';") {
                    statement -> Int in
                    guard sqlite3_step(statement) == SQLITE_ROW else { throw error() }
                    return Int(sqlite3_column_int(statement, 0))
                }
                try execute("UPDATE xlog_online_log_deliveries SET state='uncertain',next_attempt_at=NULL,last_error_code='interrupted_after_dispatch' WHERE state='dispatching';")
                try execute("""
                    DELETE FROM xlog_online_log_candidates
                    WHERE EXISTS (
                      SELECT 1 FROM xlog_online_log_deliveries d
                      WHERE d.service=xlog_online_log_candidates.service
                        AND d.local_id=xlog_online_log_candidates.local_id
                        AND d.state IN ('delivered','rejected','uncertain')
                    );
                    """)
                try execute("COMMIT;")
                return count
            } catch { try? execute("ROLLBACK;"); throw error }
        }
    }

    private static func isTerminalOnlineLogDelivery(_ state: OnlineLogDeliveryState) -> Bool {
        switch state {
        case .delivered, .rejected, .uncertain: true
        case .dispatching, .deferred: false
        }
    }

    private func retireOnlineLogCandidate(service: OnlineLogService, contactID: UUID) throws {
        try withStatement("DELETE FROM xlog_online_log_candidates WHERE service=? AND local_id=?;") { statement in
            bind(service.rawValue, to: 1, in: statement)
            bind(contactID.uuidString, to: 2, in: statement)
            try stepDone(statement)
        }
    }

    /// A bounded ADIF update batch is all-or-nothing. The SQLite write lock also
    /// fences other database connections between duplicate lookup and save.
    public func applyADIFUpdates(preview: ADIFImportPreview, fields: Set<String>,
                                 expected: [UUID: LogbookContactSnapshot]) throws -> Int {
        try withDatabaseLock {
            guard !fields.isEmpty, fields.isSubset(of: ADIFImportPlan.editableFields),
                  preview.records.count <= 128, expected.count <= 128 else { throw LogbookContactError.invalid }
            try execute("BEGIN IMMEDIATE;")
            do {
                var candidates: [UUID: QSO] = [:]
                for record in preview.records {
                    guard let incoming = QSO(adif: record) else { throw LogbookContactError.invalid }
                    let matches = try withStatement("""
                        SELECT record_json FROM qsos WHERE deleted_at IS NULL
                        AND qso_start >= ? AND qso_start < ? LIMIT 129;
                        """) { statement in
                        let second = floor(incoming.start.timeIntervalSince1970)
                        sqlite3_bind_double(statement, 1, second); sqlite3_bind_double(statement, 2, second + 1)
                        return try decodeRows(statement)
                    }
                    // Keep identity normalization in the shared planner. Reject
                    // pathological same-second populations rather than truncate.
                    guard matches.count <= 128 else { throw LogbookContactError.invalid }
                    for match in matches { candidates[match.id] = match }
                }
                let plan = try ADIFImportPlan(preview: preview, existing: Array(candidates.values), duplicatePolicy: .updateFields(fields))
                // Even no-op targets must still match the reviewed revision.
                let matches = try ADIFImportPlan(preview: preview, existing: expected.values.map(\.qso), duplicatePolicy: .updateFields(fields))
                guard Set(plan.updates.compactMap(\.targetID)) == Set(matches.updates.compactMap(\.targetID)) else { throw LogbookContactError.invalid }
                for (id, reviewed) in expected {
                    guard try contactSnapshot(localID: id) == reviewed else { throw LogbookContactError.conflict(try contactSnapshot(localID: id)) }
                }
                for entry in plan.updates {
                    guard let id = entry.targetID, var qso = expected[id]?.qso else { throw LogbookContactError.invalid }
                    // Change only supported selected properties. All other QSO
                    // metadata, remote mapping and unknown ADIF fields survive.
                    for field in fields {
                        guard let value = entry.record[field] else { continue }
                        switch field {
                        case "NAME": qso.name = value
                        case "QTH": qso.qth = value
                        case "GRIDSQUARE": qso.gridSquare = value
                        case "COMMENT": qso.comment = value
                        case "NOTES": qso.notes = value
                        case "RST_SENT": qso.rstSent = value
                        case "RST_RCVD": qso.rstReceived = value
                        case "QSL_SENT": qso.qslSent = value
                        case "QSL_RCVD": qso.qslReceived = value
                        case "QSL_SENT_VIA": qso.qslMethod = value
                        case "QSL_VIA": qso.qslVia = value
                        case "LOTW_QSL_SENT": qso.lotwSent = value
                        case "LOTW_QSL_RCVD": qso.lotwReceived = value
                        case "IOTA": qso.iota = value
                        case "SOTA_REF": qso.sotaReference = value
                        case "POTA_REF": qso.potaReference = value
                        case "WWFF_REF": qso.wwffReference = value
                        case "COUNTRY": qso.country = value
                        case "DXCC":
                            if value.isEmpty { qso.dxcc = nil }
                            else {
                                guard let code = Int(value) else { throw LogbookContactError.invalid }
                                qso.dxcc = code
                            }
                        case "CONT": qso.continent = value
                        case "CQZ": qso.cqZone = value
                        case "ITUZ": qso.ituZone = value
                        case "STATE": qso.state = value
                        case "CNTY": qso.county = value
                        case "SIG": qso.sig = value
                        case "SIG_INFO": qso.sigInfo = value
                        case "DARC_DOK": qso.dok = value
                        case "TX_PWR": qso.txPower = value
                        case "OPERATOR": qso.operatorCall = value
                        case "STATION_CALLSIGN": qso.myCall = value
                        case "MY_GRIDSQUARE": qso.myGrid = value
                        case "PROP_MODE": qso.propagationMode = value
                        case "EMAIL": qso.email = value
                        default: throw LogbookContactError.invalid
                        }
                    }
                    var validation = qso; validation.wavelogID = nil
                    try validation.validateOperatorDraft(forSave: true)
                    try save(qso)
                }
                try execute("COMMIT;")
                return plan.updates.count
            } catch { try? execute("ROLLBACK;"); throw error }
        }
    }

    public func contactReceipt(operationID: UUID) throws -> LogbookContactReceipt? {
        try withDatabaseLock {
            try withStatement("SELECT payload FROM xlog_contact_receipts WHERE operation_id=?;") { statement in
                bind(operationID.uuidString, to: 1, in: statement)
                let step = sqlite3_step(statement)
                if step == SQLITE_DONE { return nil }
                guard step == SQLITE_ROW, let bytes = sqlite3_column_blob(statement, 0) else { throw error() }
                return try decoder.decode(LogbookContactReceipt.self, from: Data(bytes: bytes, count: Int(sqlite3_column_bytes(statement, 0))))
            }
        }
    }

    public func applyContactMutation(_ mutation: LogbookContactMutation) throws -> LogbookContactReceipt {
        try withDatabaseLock {
            guard (0..<9_007_199_254_740_991).contains(mutation.expectedRevision) else { throw LogbookContactError.invalid }
            try execute("BEGIN IMMEDIATE;")
            do {
                if let receipt = try contactReceipt(operationID: mutation.operationID) {
                    guard receipt.mutation == mutation else { throw LogbookContactError.operationReused }
                    try execute("COMMIT;")
                    return receipt
                }
                let snapshot = try contactSnapshot(localID: mutation.contactID)
                guard let current = snapshot, current.revision == mutation.expectedRevision else {
                    throw LogbookContactError.conflict(snapshot)
                }
                var updated = current.qso
                switch mutation.action {
                case .update:
                    guard current.qso.deletedAt == nil, let qso = mutation.qso,
                          qso.id == current.qso.id, qso.wavelogID == current.qso.wavelogID,
                          qso.deletedAt == nil else { throw LogbookContactError.invalid }
                    // Reuse bounded contact validation, without forbidding the
                    // existing remote mapping. The supplied mapping must match.
                    var validation = qso; validation.wavelogID = nil
                    do { try validation.validateOperatorDraft(forSave: true) }
                    catch { throw LogbookContactError.invalid }
                    updated = qso
                case .delete:
                    guard mutation.qso == nil, current.qso.deletedAt == nil else { throw LogbookContactError.invalid }
                    updated.deletedAt = Date()
                case .restore:
                    guard mutation.qso == nil, current.qso.deletedAt != nil else { throw LogbookContactError.invalid }
                    updated.deletedAt = nil
                }
                try save(updated)
                guard let contact = try contactSnapshot(localID: mutation.contactID), contact.revision == current.revision + 1 else {
                    throw LogbookDatabaseError.corruptRecord
                }
                let receipt = LogbookContactReceipt(mutation: mutation, contact: contact)
                let payload = try encoder.encode(receipt)
                try withStatement("INSERT INTO xlog_contact_receipts(operation_id,payload) VALUES(?,?);") { statement in
                    bind(mutation.operationID.uuidString, to: 1, in: statement)
                    _ = payload.withUnsafeBytes { sqlite3_bind_blob(statement, 2, $0.baseAddress, Int32($0.count), Self.transient) }
                    try stepDone(statement)
                }
                try execute("COMMIT;")
                return receipt
            } catch {
                try? execute("ROLLBACK;")
                throw error
            }
        }
    }

    /// Initial creation and all mutations use SQLite's write lock as well as the
    /// instance lock, so two service instances cannot accept the same revision.
    public func operatorDraft(initial: QSO) throws -> OperatorDraftSnapshot {
        try withDatabaseLock {
            if let existing = try readOperatorDraft() { return existing }
            try execute("BEGIN IMMEDIATE;")
            do {
                if let existing = try readOperatorDraft() {
                    try execute("COMMIT;")
                    return existing
                }
                try initial.validateOperatorDraft(forSave: false)
                guard try lookup(localID: initial.id) == nil else { throw OperatorDraftError.existingContact }
                let draft = OperatorDraftSnapshot(revision: 0, qso: initial)
                try writeOperatorDraft(draft)
                try execute("COMMIT;")
                return draft
            } catch {
                try? execute("ROLLBACK;")
                throw error
            }
        }
    }

    /// Lives in the database so backups include portable layouts atomically.
    /// Physical display placement remains machine-local in the native shell.
    public func workspaceLayout() throws -> WorkspaceLayoutSnapshot {
        try withDatabaseLock { try readWorkspaceLayout() }
    }

    /// Native synchronization admission journal. Opaque to portable contact data;
    /// restoring a workspace must fence it with the workspace generation.
    public func syncMutationJournal() throws -> Data? {
        try withDatabaseLock {
            try withStatement("SELECT payload FROM xlog_sync_mutation_owner WHERE singleton=1;") { statement in
                let step = sqlite3_step(statement)
                if step == SQLITE_DONE { return nil }
                guard step == SQLITE_ROW, let bytes = sqlite3_column_blob(statement, 0),
                      (1...1_048_576).contains(Int(sqlite3_column_bytes(statement, 0))) else {
                    throw LogbookDatabaseError.corruptRecord
                }
                return Data(bytes: bytes, count: Int(sqlite3_column_bytes(statement, 0)))
            }
        }
    }

    public func saveSyncMutationJournal(_ payload: Data) throws {
        guard (1...1_048_576).contains(payload.count) else { throw LogbookDatabaseError.corruptRecord }
        try withDatabaseLock {
            try withStatement("INSERT OR REPLACE INTO xlog_sync_mutation_owner(singleton,payload) VALUES(1,?);") { statement in
                _ = payload.withUnsafeBytes { sqlite3_bind_blob(statement, 1, $0.baseAddress, Int32($0.count), Self.transient) }
                try stepDone(statement)
            }
        }
    }

    public func remoteBackupCommandJournal() throws -> Data? {
        try withDatabaseLock {
            try withStatement("SELECT payload FROM xlog_remote_backup_commands WHERE singleton=1;") { statement in
                let step = sqlite3_step(statement)
                if step == SQLITE_DONE { return nil }
                guard step == SQLITE_ROW, let bytes = sqlite3_column_blob(statement, 0),
                      (1...1_048_576).contains(Int(sqlite3_column_bytes(statement, 0))) else { throw LogbookDatabaseError.corruptRecord }
                return Data(bytes: bytes, count: Int(sqlite3_column_bytes(statement, 0)))
            }
        }
    }

    public func saveRemoteBackupCommandJournal(_ payload: Data) throws {
        guard (1...1_048_576).contains(payload.count) else { throw LogbookDatabaseError.corruptRecord }
        try withDatabaseLock {
            try withStatement("INSERT OR REPLACE INTO xlog_remote_backup_commands(singleton,payload) VALUES(1,?);") { statement in
                _ = payload.withUnsafeBytes { sqlite3_bind_blob(statement, 1, $0.baseAddress, Int32($0.count), Self.transient) }
                try stepDone(statement)
            }
        }
    }

    /// Seeds legacy Integration settings once, then reads only the database-owned
    /// snapshot. The caller supplies the isolated UserDefaults value for migration;
    /// it is never consulted again after this row exists.
    public func integrationSettings(seed: XLogSettings) throws -> IntegrationSettingsSnapshot {
        try withDatabaseLock {
            if let existing = try readIntegrationSettings() { return existing }
            let snapshot = IntegrationSettingsSnapshot(revision: 0, settings: seed)
            try snapshot.validate()
            try execute("BEGIN IMMEDIATE;")
            do {
                if let existing = try readIntegrationSettings() {
                    try execute("COMMIT;")
                    return existing
                }
                try writeIntegrationSettings(snapshot)
                try execute("COMMIT;")
                return snapshot
            } catch {
                try? execute("ROLLBACK;")
                throw error
            }
        }
    }

    public func applyIntegrationSettings(_ mutation: IntegrationSettingsMutation) throws -> IntegrationSettingsReceipt {
        try withDatabaseLock {
            guard (0...9_007_199_254_740_990).contains(mutation.expectedRevision) else {
                throw IntegrationSettingsError.invalid
            }
            let requested = IntegrationSettingsSnapshot(revision: mutation.expectedRevision, settings: mutation.settings)
            try requested.validate()
            try execute("BEGIN IMMEDIATE;")
            do {
                if let receipt = try readIntegrationSettingsReceipt(operationID: mutation.operationID) {
                    guard receipt.mutation == mutation else { throw IntegrationSettingsError.operationReused }
                    try execute("COMMIT;")
                    return receipt
                }
                guard let current = try readIntegrationSettings() else { throw IntegrationSettingsError.notInitialized }
                guard current.revision == mutation.expectedRevision else {
                    throw IntegrationSettingsError.conflict(current)
                }
                let targetChanged = current.settings.logbookMode != mutation.settings.logbookMode
                    || current.settings.wavelogURL != mutation.settings.wavelogURL
                    || current.settings.wavelogStationID != mutation.settings.wavelogStationID
                let next = IntegrationSettingsSnapshot(
                    revision: current.settings == mutation.settings ? current.revision : current.revision + 1,
                    settings: mutation.settings,
                    syncTargetRevision: current.syncTargetRevision + (targetChanged ? 1 : 0)
                )
                try next.validate()
                if next != current { try writeIntegrationSettings(next) }
                let receipt = IntegrationSettingsReceipt(mutation: mutation, snapshot: next)
                let payload = try encoder.encode(receipt)
                guard payload.count <= 131_072 else { throw IntegrationSettingsError.invalid }
                try withStatement("INSERT INTO xlog_settings_receipts(operation_id,payload) VALUES(?,?);") { statement in
                    bind(mutation.operationID.uuidString, to: 1, in: statement)
                    _ = payload.withUnsafeBytes { sqlite3_bind_blob(statement, 2, $0.baseAddress, Int32($0.count), Self.transient) }
                    try stepDone(statement)
                }
                try execute("COMMIT;")
                return receipt
            } catch {
                try? execute("ROLLBACK;")
                throw error
            }
        }
    }

    public func integrationSettingsReceipt(operationID: UUID) throws -> IntegrationSettingsReceipt? {
        try withDatabaseLock { try readIntegrationSettingsReceipt(operationID: operationID) }
    }

    /// Restore has already rotated the workspace generation. Replace the restored
    /// database's settings row and retire receipts from its former generation.
    public func installIntegrationSettingsAfterRestore(_ snapshot: IntegrationSettingsSnapshot) throws {
        try withDatabaseLock {
            try snapshot.validate()
            try execute("BEGIN IMMEDIATE;")
            do {
                try writeIntegrationSettings(snapshot)
                try execute("DELETE FROM xlog_settings_receipts;")
                try execute("COMMIT;")
            } catch {
                try? execute("ROLLBACK;")
                throw error
            }
        }
    }

    private func readIntegrationSettings() throws -> IntegrationSettingsSnapshot? {
        try withStatement("SELECT payload FROM xlog_integration_settings WHERE singleton=1;") { statement in
            let step = sqlite3_step(statement)
            if step == SQLITE_DONE { return nil }
            guard step == SQLITE_ROW, let bytes = sqlite3_column_blob(statement, 0),
                  (1...65_536).contains(Int(sqlite3_column_bytes(statement, 0))) else {
                throw LogbookDatabaseError.corruptRecord
            }
            let snapshot = try decoder.decode(IntegrationSettingsSnapshot.self,
                from: Data(bytes: bytes, count: Int(sqlite3_column_bytes(statement, 0))))
            try snapshot.validate()
            return snapshot
        }
    }

    private func writeIntegrationSettings(_ snapshot: IntegrationSettingsSnapshot) throws {
        let payload = try encoder.encode(snapshot)
        guard payload.count <= 65_536 else { throw IntegrationSettingsError.invalid }
        try withStatement("INSERT INTO xlog_integration_settings(singleton,payload) VALUES(1,?) ON CONFLICT(singleton) DO UPDATE SET payload=excluded.payload;") { statement in
            _ = payload.withUnsafeBytes { sqlite3_bind_blob(statement, 1, $0.baseAddress, Int32($0.count), Self.transient) }
            try stepDone(statement)
        }
    }

    private func readIntegrationSettingsReceipt(operationID: UUID) throws -> IntegrationSettingsReceipt? {
        try withStatement("SELECT payload FROM xlog_settings_receipts WHERE operation_id=?;") { statement in
            bind(operationID.uuidString, to: 1, in: statement)
            let step = sqlite3_step(statement)
            if step == SQLITE_DONE { return nil }
            guard step == SQLITE_ROW, let bytes = sqlite3_column_blob(statement, 0),
                  (1...131_072).contains(Int(sqlite3_column_bytes(statement, 0))) else {
                throw LogbookDatabaseError.corruptRecord
            }
            let receipt = try decoder.decode(IntegrationSettingsReceipt.self,
                from: Data(bytes: bytes, count: Int(sqlite3_column_bytes(statement, 0))))
            try receipt.snapshot.validate()
            guard receipt.mutation.operationID == operationID,
                  (0...9_007_199_254_740_990).contains(receipt.mutation.expectedRevision),
                  receipt.snapshot.settings == receipt.mutation.settings,
                  receipt.snapshot.revision == receipt.mutation.expectedRevision
                    || receipt.snapshot.revision == receipt.mutation.expectedRevision + 1 else {
                throw LogbookDatabaseError.corruptRecord
            }
            return receipt
        }
    }

    public func rotorConfiguration(seed: RotorConfiguration) throws -> RotorConfigurationSnapshot {
        try withDatabaseLock {
            if let existing = try readRotorConfiguration() { return existing }
            let snapshot = RotorConfigurationSnapshot(revision: 0, configuration: seed)
            try snapshot.validate()
            try execute("BEGIN IMMEDIATE;")
            do {
                if let existing = try readRotorConfiguration() {
                    try execute("COMMIT;")
                    return existing
                }
                try writeRotorConfiguration(snapshot)
                try execute("COMMIT;")
                return snapshot
            } catch {
                try? execute("ROLLBACK;")
                throw error
            }
        }
    }

    public func applyRotorConfiguration(_ mutation: RotorConfigurationMutation) throws -> RotorConfigurationReceipt {
        try withDatabaseLock {
            guard (0...9_007_199_254_740_990).contains(mutation.expectedRevision) else {
                throw RotorConfigurationError.invalid
            }
            try mutation.configuration.validate()
            try execute("BEGIN IMMEDIATE;")
            do {
                if let receipt = try readRotorConfigurationReceipt(operationID: mutation.operationID) {
                    guard receipt.mutation == mutation else { throw RotorConfigurationError.operationReused }
                    try execute("COMMIT;")
                    return receipt
                }
                guard let current = try readRotorConfiguration() else { throw RotorConfigurationError.notInitialized }
                guard current.revision == mutation.expectedRevision else {
                    throw RotorConfigurationError.conflict(current)
                }
                let next = RotorConfigurationSnapshot(
                    revision: current.configuration == mutation.configuration ? current.revision : current.revision + 1,
                    configuration: mutation.configuration
                )
                try next.validate()
                if next != current { try writeRotorConfiguration(next) }
                let receipt = RotorConfigurationReceipt(mutation: mutation, snapshot: next)
                let payload = try encoder.encode(receipt)
                guard payload.count <= 32_768 else { throw RotorConfigurationError.invalid }
                try withStatement("INSERT INTO xlog_rotor_configuration_receipts(operation_id,payload) VALUES(?,?);") { statement in
                    bind(mutation.operationID.uuidString, to: 1, in: statement)
                    _ = payload.withUnsafeBytes { sqlite3_bind_blob(statement, 2, $0.baseAddress, Int32($0.count), Self.transient) }
                    try stepDone(statement)
                }
                try execute("COMMIT;")
                return receipt
            } catch {
                try? execute("ROLLBACK;")
                throw error
            }
        }
    }

    public func rotorConfigurationReceipt(operationID: UUID) throws -> RotorConfigurationReceipt? {
        try withDatabaseLock { try readRotorConfigurationReceipt(operationID: operationID) }
    }

    public func installRotorConfigurationAfterRestore(_ snapshot: RotorConfigurationSnapshot) throws {
        try withDatabaseLock {
            try snapshot.validate()
            try execute("BEGIN IMMEDIATE;")
            do {
                try writeRotorConfiguration(snapshot)
                try execute("DELETE FROM xlog_rotor_configuration_receipts;")
                try execute("COMMIT;")
            } catch {
                try? execute("ROLLBACK;")
                throw error
            }
        }
    }

    private func readRotorConfiguration() throws -> RotorConfigurationSnapshot? {
        try withStatement("SELECT payload FROM xlog_rotor_configuration WHERE singleton=1;") { statement in
            let step = sqlite3_step(statement)
            if step == SQLITE_DONE { return nil }
            guard step == SQLITE_ROW, let bytes = sqlite3_column_blob(statement, 0),
                  (1...16_384).contains(Int(sqlite3_column_bytes(statement, 0))) else {
                throw LogbookDatabaseError.corruptRecord
            }
            let snapshot = try decoder.decode(RotorConfigurationSnapshot.self,
                from: Data(bytes: bytes, count: Int(sqlite3_column_bytes(statement, 0))))
            try snapshot.validate()
            return snapshot
        }
    }

    private func writeRotorConfiguration(_ snapshot: RotorConfigurationSnapshot) throws {
        let payload = try encoder.encode(snapshot)
        guard payload.count <= 16_384 else { throw RotorConfigurationError.invalid }
        try withStatement("INSERT INTO xlog_rotor_configuration(singleton,payload) VALUES(1,?) ON CONFLICT(singleton) DO UPDATE SET payload=excluded.payload;") { statement in
            _ = payload.withUnsafeBytes { sqlite3_bind_blob(statement, 1, $0.baseAddress, Int32($0.count), Self.transient) }
            try stepDone(statement)
        }
    }

    private func readRotorConfigurationReceipt(operationID: UUID) throws -> RotorConfigurationReceipt? {
        try withStatement("SELECT payload FROM xlog_rotor_configuration_receipts WHERE operation_id=?;") { statement in
            bind(operationID.uuidString, to: 1, in: statement)
            let step = sqlite3_step(statement)
            if step == SQLITE_DONE { return nil }
            guard step == SQLITE_ROW, let bytes = sqlite3_column_blob(statement, 0),
                  (1...32_768).contains(Int(sqlite3_column_bytes(statement, 0))) else {
                throw LogbookDatabaseError.corruptRecord
            }
            let receipt = try decoder.decode(RotorConfigurationReceipt.self,
                from: Data(bytes: bytes, count: Int(sqlite3_column_bytes(statement, 0))))
            try receipt.snapshot.validate()
            guard receipt.mutation.operationID == operationID,
                  (0...9_007_199_254_740_990).contains(receipt.mutation.expectedRevision),
                  receipt.snapshot.configuration == receipt.mutation.configuration,
                  receipt.snapshot.revision == receipt.mutation.expectedRevision
                    || receipt.snapshot.revision == receipt.mutation.expectedRevision + 1 else {
                throw LogbookDatabaseError.corruptRecord
            }
            return receipt
        }
    }

    /// Restore coordinator only: retain current preferences when an operator
    /// restores contacts without opting into workspace-preference restoration.
    /// The caller rotates the workspace generation before replacing the DB.
    public func preserveWorkspaceLayoutAfterRestore(_ snapshot: WorkspaceLayoutSnapshot) throws {
        try withDatabaseLock {
            guard (0...9_007_199_254_740_991).contains(snapshot.revision) else { throw WorkspaceLayoutError.invalid }
            try snapshot.document.validate()
            let payload = try encoder.encode(snapshot)
            guard payload.count <= 262_144 else { throw WorkspaceLayoutError.invalid }
            try withStatement("INSERT INTO xlog_workspace_layout(singleton,payload) VALUES(1,?) ON CONFLICT(singleton) DO UPDATE SET payload=excluded.payload;") { statement in
                _ = payload.withUnsafeBytes { sqlite3_bind_blob(statement, 1, $0.baseAddress, Int32($0.count), Self.transient) }
                try stepDone(statement)
            }
        }
    }

    public func applyWorkspaceLayout(_ mutation: WorkspaceLayoutMutation) throws -> WorkspaceLayoutSnapshot {
        try withDatabaseLock {
            try execute("BEGIN IMMEDIATE;")
            do {
                let next = try mutation.applying(to: readWorkspaceLayout())
                let payload = try encoder.encode(next)
                guard payload.count <= 262_144 else { throw WorkspaceLayoutError.invalid }
                try withStatement("INSERT INTO xlog_workspace_layout(singleton,payload) VALUES(1,?) ON CONFLICT(singleton) DO UPDATE SET payload=excluded.payload;") { statement in
                    _ = payload.withUnsafeBytes { sqlite3_bind_blob(statement, 1, $0.baseAddress, Int32($0.count), Self.transient) }
                    try stepDone(statement)
                }
                try execute("COMMIT;")
                return next
            } catch { try? execute("ROLLBACK;"); throw error }
        }
    }

    private func readWorkspaceLayout() throws -> WorkspaceLayoutSnapshot {
        try withStatement("SELECT payload FROM xlog_workspace_layout WHERE singleton=1;") { statement in
            let step = sqlite3_step(statement)
            if step == SQLITE_DONE { return WorkspaceLayoutSnapshot(revision: 0, document: .defaults) }
            guard step == SQLITE_ROW, let bytes = sqlite3_column_blob(statement, 0),
                  (1...262_144).contains(Int(sqlite3_column_bytes(statement, 0))) else { throw LogbookDatabaseError.corruptRecord }
            let value = try decoder.decode(WorkspaceLayoutSnapshot.self, from: Data(bytes: bytes, count: Int(sqlite3_column_bytes(statement, 0))))
            guard (0...9_007_199_254_740_991).contains(value.revision) else { throw WorkspaceLayoutError.invalid }
            try value.document.validate()
            return value
        }
    }

    public func operatorDraftReceipt(operationID: UUID) throws -> OperatorDraftReceipt? {
        try withDatabaseLock {
            try withStatement("SELECT payload FROM xlog_operator_receipts WHERE operation_id = ?;") { statement in
                bind(operationID.uuidString, to: 1, in: statement)
                let step = sqlite3_step(statement)
                if step == SQLITE_DONE { return nil }
                guard step == SQLITE_ROW, let bytes = sqlite3_column_blob(statement, 0) else { throw error() }
                return try decoder.decode(OperatorDraftReceipt.self, from: Data(bytes: bytes, count: Int(sqlite3_column_bytes(statement, 0))))
            }
        }
    }

    /// Native-owner API, deliberately not a renderer method. The workspace
    /// owner must fence its current generation before entering this database.
    public func configureOperatorDraftPower(enabled: Bool, fallback: String,
                                            workspaceID: UUID) throws -> OperatorDraftSnapshot {
        try withDatabaseLock {
            let previousAuthority = operatorPowerScopeID
            let result = try updateOperatorDraftPower { current in
                let needsMigration = current.power == nil
                var power = try needsMigration
                    ? OperatorDraftPowerState(qso: current.qso, workspaceID: workspaceID)
                    : current.power!
                if power.workspaceID != workspaceID {
                    try power.rebindWorkspace(qso: current.qso, workspaceID: workspaceID)
                }
                try power.configure(enabled: enabled, fallback: fallback)
                // Legacy drafts have no explicit intent record. Preserve an
                // unfinished contact's value until the operator opts back in.
                if needsMigration && (!current.qso.call.isEmpty || current.qso.txPower != fallback) {
                    try power.manual(value: current.qso.txPower)
                }
                return OperatorDraftSnapshot(revision: current.revision,
                    qso: power.applying(to: current.qso), power: power)
            }
            operatorPowerScopeID = result.power?.activeScope?.id == previousAuthority ? previousAuthority : nil
            return result
        }
    }

    /// Arming is tied to the contact revision inspected by the native owner.
    /// A later typing change cannot silently attach an old selection to a new QSO.
    public func armOperatorDraftPower(context: OperatorDraftPowerContext, workspaceID: UUID,
                                       draftID: UUID, expectedRevision: Int64,
                                       now: Date) throws -> OperatorDraftSnapshot {
        try withDatabaseLock {
            let previousAuthority = operatorPowerScopeID
            let result = try updateOperatorDraftPower { current in
                guard current.qso.id == draftID, current.revision == expectedRevision else {
                    throw OperatorDraftError.conflict(current)
                }
                guard var power = current.power, power.workspaceID == workspaceID else {
                    throw OperatorDraftError.notInitialized
                }
                if previousAuthority == nil || previousAuthority != power.activeScope?.id {
                    try power.invalidateSession()
                }
                _ = try power.arm(context: context, qso: current.qso, workspaceID: workspaceID, now: now)
                return OperatorDraftSnapshot(revision: current.revision,
                    qso: power.applying(to: current.qso), power: power)
            }
            operatorPowerScopeID = result.power?.activeScope?.id
            return result
        }
    }

    /// Meter updates retain the edit revision and do not create typing receipts.
    /// The same SQLite write transaction serializes capture with Save/Replace.
    public func captureOperatorDraftPower(sample: OperatorDraftPowerSample,
                                           scopeID: UUID, now: Date? = nil,
                                           authorize: () -> Bool = { true }) throws -> OperatorDraftSnapshot {
        try withDatabaseLock {
            try updateOperatorDraftPower { current in
                guard operatorPowerScopeID == scopeID, var power = current.power else { return current }
                // Freshness is evaluated after database/transaction acquisition
                // in native calls; an explicit time remains available to tests.
                guard try power.accept(sample: sample, expectedScopeID: scopeID, now: now ?? Date()) else { return current }
                // The short native fence is the admission linearization point.
                // Later revocation may proceed while this admitted write commits.
                guard authorize() else { return current }
                return OperatorDraftSnapshot(revision: current.revision,
                    qso: power.applying(to: current.qso), power: power)
            }
        }
    }

    public func invalidateOperatorDraftPower() throws -> OperatorDraftSnapshot {
        try withDatabaseLock {
            operatorPowerScopeID = nil
            return try updateOperatorDraftPower { current in
                guard var power = current.power else { return current }
                try power.invalidateSession()
                return OperatorDraftSnapshot(revision: current.revision,
                    qso: power.applying(to: current.qso), power: power)
            }
        }
    }

    private func updateOperatorDraftPower(
        _ change: (OperatorDraftSnapshot) throws -> OperatorDraftSnapshot
    ) throws -> OperatorDraftSnapshot {
        try execute("BEGIN IMMEDIATE;")
        do {
            guard let current = try readOperatorDraft() else { throw OperatorDraftError.notInitialized }
            let updated = try change(current)
            guard updated.revision == current.revision, updated.qso.id == current.qso.id else {
                throw OperatorDraftError.invalid
            }
            try updated.qso.validateOperatorDraft(forSave: false)
            try updated.power?.validate()
            if updated != current { try writeOperatorDraft(updated) }
            try execute("COMMIT;")
            return updated
        } catch {
            try? execute("ROLLBACK;")
            throw error
        }
    }

    /// Save, draft advance and receipt are one transaction. A repeated operation
    /// returns its original receipt even after another window advances the draft.
    /// Only creating new contacts is exposed here; editing a logged QSO requires
    /// a separate record revision contract and cannot hijack this draft's ID.
    public func applyOperatorDraft(_ mutation: OperatorDraftMutation, nextDraft: QSO,
                                  powerConfiguration: (workspaceID: UUID, enabled: Bool, fallback: String)? = nil) throws -> OperatorDraftReceipt {
        try withDatabaseLock {
            guard spotDraftLeaseID == nil else { throw SpotDraftError.busy }
            guard (0..<9_007_199_254_740_991).contains(mutation.expectedRevision) else { throw OperatorDraftError.invalid }
            try execute("BEGIN IMMEDIATE;")
            do {
                if let receipt = try operatorDraftReceipt(operationID: mutation.operationID) {
                    guard receipt.mutation == mutation else { throw OperatorDraftError.operationReused }
                    try execute("COMMIT;")
                    return receipt
                }
                guard let current = try readOperatorDraft() else { throw OperatorDraftError.notInitialized }
                guard current.qso.id == mutation.draftID, current.revision == mutation.expectedRevision else {
                    throw OperatorDraftError.conflict(current)
                }
                var updated: QSO
                var power = current.power
                if power == nil, let intent = mutation.powerIntent {
                    guard mutation.action == .replace, intent.action == .manual,
                          let configuration = powerConfiguration else { throw OperatorDraftError.notInitialized }
                    var initial = try OperatorDraftPowerState(qso: current.qso, workspaceID: configuration.workspaceID)
                    try initial.configure(enabled: configuration.enabled, fallback: configuration.fallback)
                    power = initial
                }
                var saved: QSO?
                switch mutation.action {
                case .replace:
                    guard let replacement = mutation.qso, replacement.id == current.qso.id else { throw OperatorDraftError.invalid }
                    try replacement.validateOperatorDraft(forSave: false)
                    if var currentPower = power {
                        updated = try currentPower.reconcileReplacement(current: current.qso, replacement: replacement,
                                                                         workspaceID: currentPower.workspaceID)
                        if let intent = mutation.powerIntent {
                            switch intent.action {
                            case .manual:
                                guard let value = intent.value else { throw OperatorDraftError.invalid }
                                try currentPower.manual(value: value)
                            case .automatic:
                                guard intent.value == nil else { throw OperatorDraftError.invalid }
                                try currentPower.resumeAutomatic()
                            }
                        }
                        updated = currentPower.applying(to: updated)
                        power = currentPower
                    } else {
                        guard mutation.powerIntent == nil else { throw OperatorDraftError.notInitialized }
                        updated = replacement
                    }
                case .clear, .save:
                    guard mutation.qso == nil, mutation.powerIntent == nil,
                          nextDraft.id != current.qso.id, nextDraft.call.isEmpty else { throw OperatorDraftError.invalid }
                    try nextDraft.validateOperatorDraft(forSave: false)
                    guard try lookup(localID: nextDraft.id) == nil else { throw OperatorDraftError.existingContact }
                    updated = nextDraft
                    if mutation.action == .save {
                        let resolved = power?.applying(to: current.qso, includeProvenance: true) ?? current.qso
                        try resolved.validateOperatorDraft(forSave: true)
                        guard try lookup(localID: current.qso.id) == nil else { throw OperatorDraftError.existingContact }
                        try save(resolved, markDirty: true, onlineLogCandidate: true)
                        guard let value = try lookup(localID: current.qso.id) else { throw LogbookDatabaseError.corruptRecord }
                        saved = value
                    }
                    if var nextPower = power {
                        try nextPower.reset(qso: nextDraft, workspaceID: nextPower.workspaceID)
                        updated = nextPower.applying(to: nextDraft)
                        power = nextPower
                    }
                }
                try updated.validateOperatorDraft(forSave: false)
                try power?.validate()
                let draft = OperatorDraftSnapshot(revision: current.revision + 1, qso: updated, power: power)
                try writeOperatorDraft(draft)
                let receipt = OperatorDraftReceipt(mutation: mutation, draft: draft, savedQSO: saved)
                let payload = try encoder.encode(receipt)
                try withStatement("INSERT INTO xlog_operator_receipts(operation_id, action, revision, payload) VALUES(?,?,?,?);") { statement in
                    bind(mutation.operationID.uuidString, to: 1, in: statement)
                    bind(mutation.action.rawValue, to: 2, in: statement)
                    sqlite3_bind_int64(statement, 3, draft.revision)
                    _ = payload.withUnsafeBytes { sqlite3_bind_blob(statement, 4, $0.baseAddress, Int32($0.count), Self.transient) }
                    try stepDone(statement)
                }
                // Keystroke/autofill receipts are bounded. Older retries still
                // fail the revision fence; contact-save receipts never expire.
                try withStatement("DELETE FROM xlog_operator_receipts WHERE action <> 'save' AND revision <= ?;") { statement in
                    sqlite3_bind_int64(statement, 1, draft.revision - 256)
                    try stepDone(statement)
                }
                try execute("COMMIT;")
                if draft.power?.activeScope?.id != operatorPowerScopeID { operatorPowerScopeID = nil }
                return receipt
            } catch {
                try? execute("ROLLBACK;")
                throw error
            }
        }
    }

    public var spotDraftActivationActive: Bool { withDatabaseLock { spotDraftLeaseID != nil } }

    /// Called once by the authoritative worker service, not by every connection
    /// opened for backup/diagnostics. A new worker may inspect an old receipt but
    /// can never acquire its effect lease or resume an uncertain radio action.
    public func recoverSpotDraftActivations() throws {
        try withDatabaseLock {
            try execute("BEGIN IMMEDIATE;")
            do {
                let records: [SpotDraftRecord] = try withStatement("SELECT payload FROM xlog_spot_draft_receipts WHERE phase NOT IN ('confirmed','failed','uncertain');") { statement in
                    var values: [SpotDraftRecord] = []
                    while true {
                        let step = sqlite3_step(statement)
                        if step == SQLITE_DONE { return values }
                        guard step == SQLITE_ROW, let bytes = sqlite3_column_blob(statement, 0) else { throw error() }
                        values.append(try decoder.decode(SpotDraftRecord.self, from: Data(bytes: bytes, count: Int(sqlite3_column_bytes(statement, 0)))))
                    }
                }
                for var record in records where !record.phase.terminal {
                    record.phase = .uncertain
                    try writeSpotDraftRecord(record)
                }
                try execute("COMMIT;")
                spotDraftLeaseID = nil
            } catch { try? execute("ROLLBACK;"); throw error }
        }
    }

    public func spotDraftRecord(operationID: UUID) throws -> SpotDraftRecord? {
        try withDatabaseLock {
            try withStatement("SELECT payload FROM xlog_spot_draft_receipts WHERE operation_id = ?;") { statement in
                bind(operationID.uuidString, to: 1, in: statement)
                let step = sqlite3_step(statement)
                if step == SQLITE_DONE { return nil }
                guard step == SQLITE_ROW, let bytes = sqlite3_column_blob(statement, 0) else { throw error() }
                return try decoder.decode(SpotDraftRecord.self, from: Data(bytes: bytes, count: Int(sqlite3_column_bytes(statement, 0))))
            }
        }
    }

    public func spotDraftLiveLease(for record: SpotDraftRecord) -> UUID? {
        withDatabaseLock { !record.phase.terminal && spotDraftLeaseID == record.leaseID ? record.leaseID : nil }
    }

    public func spotDraftAbandonedGeneration(operationID: UUID) throws -> UUID? {
        try withDatabaseLock {
            try withStatement("SELECT generation FROM xlog_spot_draft_abandoned WHERE operation_id = ?;") { statement in
                bind(operationID.uuidString, to: 1, in: statement)
                let step = sqlite3_step(statement)
                if step == SQLITE_DONE { return nil }
                guard step == SQLITE_ROW, let bytes = sqlite3_column_text(statement, 0),
                      let value = UUID(uuidString: String(cString: bytes)) else { throw LogbookDatabaseError.corruptRecord }
                return value
            }
        }
    }

    /// Close the status-before-late-apply race. Finding no receipt alone cannot
    /// release editors: request tasks need not enter the service in stdin order.
    /// The tombstone and apply share one write transaction admission boundary.
    /// An existing receipt/lease is returned unchanged, never retired here.
    public func abandonSpotDraft(operationID: UUID, generation: UUID) throws -> SpotDraftRecord? {
        try withDatabaseLock {
            try execute("BEGIN IMMEDIATE;")
            do {
                if let record = try spotDraftRecord(operationID: operationID) {
                    guard record.command.generation == generation else { throw SpotDraftError.operationReused }
                    try execute("COMMIT;"); return record
                }
                if let prior = try spotDraftAbandonedGeneration(operationID: operationID) {
                    guard prior == generation else { throw SpotDraftError.operationReused }
                } else {
                    try withStatement("INSERT INTO xlog_spot_draft_abandoned(operation_id,generation) VALUES(?,?);") { statement in
                        bind(operationID.uuidString, to: 1, in: statement); bind(generation.uuidString, to: 2, in: statement)
                        try stepDone(statement)
                    }
                }
                try execute("COMMIT;"); return nil
            } catch { try? execute("ROLLBACK;"); throw error }
        }
    }

    public func applySpotDraft(_ command: SpotDraftCommand) throws -> SpotDraftApplyResult {
        try withDatabaseLock {
            try command.validate()
            try execute("BEGIN IMMEDIATE;")
            do {
                if let record = try spotDraftRecord(operationID: command.operationID) {
                    guard record.command == command else { throw SpotDraftError.operationReused }
                    try execute("COMMIT;")
                    return SpotDraftApplyResult(record: record, replay: true, leaseID: spotDraftLiveLease(for: record))
                }
                if let generation = try spotDraftAbandonedGeneration(operationID: command.operationID) {
                    guard generation == command.generation else { throw SpotDraftError.operationReused }
                    throw SpotDraftError.abandoned
                }
                guard spotDraftLeaseID == nil else { throw SpotDraftError.busy }
                guard let current = try readOperatorDraft() else { throw OperatorDraftError.notInitialized }
                guard current.qso.id == command.draftID, current.revision == command.expectedRevision else {
                    throw OperatorDraftError.conflict(current)
                }
                guard try lookup(localID: current.qso.id) == nil else { throw OperatorDraftError.existingContact }
                var qso = command.spot.applying(to: current.qso)
                var power = current.power
                if var value = power {
                    qso = try value.reconcileReplacement(current: current.qso, replacement: qso, workspaceID: value.workspaceID)
                    qso = value.applying(to: qso); power = value
                }
                let draft = OperatorDraftSnapshot(revision: current.revision + 1, qso: qso, power: power)
                try draft.validate()
                let leaseID = UUID()
                let record = SpotDraftRecord(command: command,
                    receipt: SpotDraftReceipt(operationID: command.operationID, generation: command.generation,
                                              draft: draft, phase: .draft_applied),
                    leaseID: leaseID, phase: .draft_applied)
                try writeOperatorDraft(draft)
                try writeSpotDraftRecord(record)
                try execute("COMMIT;")
                spotDraftLeaseID = leaseID
                if draft.power?.activeScope?.id != operatorPowerScopeID { operatorPowerScopeID = nil }
                return SpotDraftApplyResult(record: record, replay: false, leaseID: leaseID)
            } catch { try? execute("ROLLBACK;"); throw error }
        }
    }

    /// True is the *only* send permit. It is returned after the first durable
    /// transition. A repeated/lost-ack stage is status-only, never a retry permit.
    public func stageSpotDraft(operationID: UUID, generation: UUID, leaseID: UUID,
                               stage: SpotDraftPhase) throws -> Bool {
        try withDatabaseLock {
            try execute("BEGIN IMMEDIATE;")
            do {
                var record = try requireSpotDraftLease(operationID: operationID, generation: generation, leaseID: leaseID)
                guard record.command.spot.opportunity == nil else { throw SpotDraftError.invalidTransition }
                guard !stage.terminal, stage != .draft_applied else { throw SpotDraftError.invalidTransition }
                if record.phase == stage {
                    try execute("COMMIT;"); return false
                }
                guard record.phase.permits(stage) else { throw SpotDraftError.invalidTransition }
                record.phase = stage
                try writeSpotDraftRecord(record)
                try execute("COMMIT;")
                return true
            } catch { try? execute("ROLLBACK;"); throw error }
        }
    }

    @discardableResult
    public func finishSpotDraft(operationID: UUID, generation: UUID, leaseID: UUID,
                                outcome: SpotDraftPhase) throws -> SpotDraftRecord {
        try withDatabaseLock {
            guard outcome.terminal else { throw SpotDraftError.invalidTransition }
            try execute("BEGIN IMMEDIATE;")
            do {
                guard var record = try spotDraftRecord(operationID: operationID), record.command.generation == generation,
                      record.leaseID == leaseID else { throw SpotDraftError.staleLease }
                if record.phase.terminal {
                    guard record.phase == outcome else { throw SpotDraftError.invalidTransition }
                    try execute("COMMIT;"); return record
                }
                _ = try requireSpotDraftLease(operationID: operationID, generation: generation, leaseID: leaseID)
                guard outcome != .confirmed || [.tune_confirmed, .rotor_started].contains(record.phase)
                    || record.command.spot.opportunity != nil && record.phase == .draft_applied else {
                    throw SpotDraftError.invalidTransition
                }
                record.phase = outcome
                try writeSpotDraftRecord(record)
                try execute("COMMIT;")
                if spotDraftLeaseID == leaseID { spotDraftLeaseID = nil }
                return record
            } catch { try? execute("ROLLBACK;"); throw error }
        }
    }

    private func requireSpotDraftLease(operationID: UUID, generation: UUID, leaseID: UUID) throws -> SpotDraftRecord {
        guard spotDraftLeaseID == leaseID,
              let record = try spotDraftRecord(operationID: operationID), record.leaseID == leaseID,
              record.command.generation == generation, !record.phase.terminal,
              let draft = try readOperatorDraft(), draft.qso.id == record.command.draftID,
              draft.revision == record.receipt.draft.revision else { throw SpotDraftError.staleLease }
        return record
    }

    private func writeSpotDraftRecord(_ record: SpotDraftRecord) throws {
        let payload = try encoder.encode(record)
        try withStatement("INSERT INTO xlog_spot_draft_receipts(operation_id,payload,phase) VALUES(?,?,?) ON CONFLICT(operation_id) DO UPDATE SET payload=excluded.payload,phase=excluded.phase;") { statement in
            bind(record.command.operationID.uuidString, to: 1, in: statement)
            _ = payload.withUnsafeBytes { sqlite3_bind_blob(statement, 2, $0.baseAddress, Int32($0.count), Self.transient) }
            bind(record.phase.rawValue, to: 3, in: statement)
            try stepDone(statement)
        }
    }

    private func readOperatorDraft() throws -> OperatorDraftSnapshot? {
        try withStatement("SELECT payload FROM xlog_operator_draft WHERE singleton = 1;") { statement in
            let step = sqlite3_step(statement)
            if step == SQLITE_DONE { return nil }
            guard step == SQLITE_ROW, let bytes = sqlite3_column_blob(statement, 0) else { throw error() }
            return try decoder.decode(OperatorDraftSnapshot.self, from: Data(bytes: bytes, count: Int(sqlite3_column_bytes(statement, 0))))
        }
    }

    private func writeOperatorDraft(_ draft: OperatorDraftSnapshot) throws {
        try draft.validate()
        let payload = try encoder.encode(draft)
        try withStatement("INSERT INTO xlog_operator_draft(singleton, payload) VALUES(1,?) ON CONFLICT(singleton) DO UPDATE SET payload=excluded.payload;") { statement in
            _ = payload.withUnsafeBytes { sqlite3_bind_blob(statement, 1, $0.baseAddress, Int32($0.count), Self.transient) }
            try stepDone(statement)
        }
    }

    public func fetch(limit: Int = 500, search: String = "", offset: Int = 0) throws -> [QSO] {
        try withDatabaseLock {
            let needle = search.trimmingCharacters(in: .whitespacesAndNewlines)
            let filtered = !needle.isEmpty
            let sql = filtered
                ? "SELECT record_json FROM qsos WHERE deleted_at IS NULL AND (call LIKE ? OR record_json LIKE ?) ORDER BY qso_start DESC LIMIT ? OFFSET ?;"
                : "SELECT record_json FROM qsos WHERE deleted_at IS NULL ORDER BY qso_start DESC LIMIT ? OFFSET ?;"
            return try withStatement(sql) { statement in
                if filtered {
                    let pattern = "%\(needle)%"
                    bind(pattern, to: 1, in: statement); bind(pattern, to: 2, in: statement)
                    sqlite3_bind_int(statement, 3, Int32(limit))
                    sqlite3_bind_int(statement, 4, Int32(offset))
                } else {
                    sqlite3_bind_int(statement, 1, Int32(limit))
                    sqlite3_bind_int(statement, 2, Int32(offset))
                }
                return try decodeRows(statement)
            }
        }
    }

    /// One SQLite read statement gives consumers a consistent contact view even
    /// while another connection appends to the logbook.
    public func fetchAll() throws -> [QSO] {
        try withDatabaseLock {
            try withStatement("SELECT record_json FROM qsos WHERE deleted_at IS NULL ORDER BY qso_start DESC;") {
                try decodeRows($0)
            }
        }
    }

    /// A single consistent, nondeleted read for the cluster's contact index.
    /// Project from JSON so even an imported row with divergent scalar index
    /// columns has the same values as the former full-QSO decode.
    public func clusterContactRows() throws -> [ClusterContactRow] {
        try withDatabaseLock {
            try refreshAggregateCacheVersion()
            if let cachedClusterContactRows { return cachedClusterContactRows }
            let cacheKey = "cluster-contacts-v1"
            if let value: [ClusterContactRow] = try persistedAggregate(cacheKey) {
                cachedClusterContactRows = value
                return value
            }
            let revision = try qsoRevision()
            let rows = try withStatement("""
                SELECT json_extract(record_json,'$.call'),
                    json_extract(record_json,'$.band'),
                    json_extract(record_json,'$.mode'),
                    json_extract(record_json,'$.start'),
                    json_extract(record_json,'$.submode'),
                    json_extract(record_json,'$.dxcc'),
                    json_extract(record_json,'$.qslReceived'),
                    json_extract(record_json,'$.lotwReceived')
                FROM qsos WHERE deleted_at IS NULL ORDER BY qso_start DESC;
                """) { statement -> [ClusterContactRow] in
                func requiredString(_ column: Int32) throws -> String {
                    guard sqlite3_column_type(statement, column) == SQLITE_TEXT,
                          let value = sqlite3_column_text(statement, column) else {
                        throw LogbookDatabaseError.corruptRecord
                    }
                    return String(cString: value)
                }
                var values: [ClusterContactRow] = []
                var step = sqlite3_step(statement)
                while step == SQLITE_ROW {
                    let call = try requiredString(0)
                    let band = try requiredString(1)
                    let mode = try requiredString(2)
                    guard [SQLITE_INTEGER, SQLITE_FLOAT].contains(sqlite3_column_type(statement, 3)) else {
                        throw LogbookDatabaseError.corruptRecord
                    }
                    let submode = try requiredString(4)
                    let dxcc: Int?
                    switch sqlite3_column_type(statement, 5) {
                    case SQLITE_NULL: dxcc = nil
                    case SQLITE_INTEGER: dxcc = Int(sqlite3_column_int64(statement, 5))
                    default: throw LogbookDatabaseError.corruptRecord
                    }
                    values.append(ClusterContactRow(
                        call: call, band: band, mode: submode.isEmpty ? mode : submode,
                        dxcc: dxcc,
                        start: Date(timeIntervalSinceReferenceDate: sqlite3_column_double(statement, 3)),
                        qslReceived: try requiredString(6), lotwReceived: try requiredString(7)
                    ))
                    step = sqlite3_step(statement)
                }
                guard step == SQLITE_DONE else { throw error() }
                return values
            }
            cachedClusterContactRows = rows
            persistAggregate(rows, key: cacheKey, revision: revision)
            return rows
        }
    }

    /// Returns only rows that can affect a callsign/DXCC history. SQL filters
    /// before JSON decoding; nil-DXCC rows remain candidates because their
    /// historical entity may be resolved from CTY at the QSO date.
    public func historyCandidates(call: String, adif: Int?) throws -> [QSO] {
        try historyCandidates(call: call, adif: adif, as: QSO.self)
    }

    public func historyRows(call: String, adif: Int?) throws -> [ContactHistoryRow] {
        try historyCandidates(call: call, adif: adif, as: ContactHistoryRow.self)
    }

    private func historyCandidates<T: Decodable>(call: String, adif: Int?, as type: T.Type) throws -> [T] {
        try withDatabaseLock {
            if let adif {
                return try withStatement("""
                    WITH candidates AS (
                        SELECT local_id FROM qsos INDEXED BY idx_qsos_call_live_nocase
                        WHERE deleted_at IS NULL AND call = ? COLLATE NOCASE
                        UNION
                        SELECT local_id FROM qsos INDEXED BY idx_qsos_dxcc_live
                        WHERE deleted_at IS NULL AND CAST(json_extract(record_json,'$.dxcc') AS INTEGER) = ?
                        UNION
                        SELECT local_id FROM qsos INDEXED BY idx_qsos_dxcc_live
                        WHERE deleted_at IS NULL AND CAST(json_extract(record_json,'$.dxcc') AS INTEGER) IS NULL
                    )
                    SELECT qsos.record_json FROM candidates JOIN qsos USING(local_id)
                    ORDER BY qsos.qso_start DESC;
                    """) { statement in
                        bind(call.uppercased(), to: 1, in: statement)
                        sqlite3_bind_int(statement, 2, Int32(adif))
                        return try decodeRows(statement, as: type)
                    }
            }
            return try withStatement("""
                SELECT record_json FROM qsos WHERE deleted_at IS NULL AND call = ? COLLATE NOCASE
                ORDER BY qso_start DESC;
                """) { statement in
                    bind(call.uppercased(), to: 1, in: statement)
                    return try decodeRows(statement, as: type)
                }
        }
    }

    public func count(search: String = "") throws -> Int {
        try withDatabaseLock {
            let needle = search.trimmingCharacters(in: .whitespacesAndNewlines)
            let filtered = !needle.isEmpty
            let sql = filtered
                ? "SELECT COUNT(*) FROM qsos WHERE deleted_at IS NULL AND (call LIKE ? OR record_json LIKE ?);"
                : "SELECT COUNT(*) FROM qsos WHERE deleted_at IS NULL;"
            return try withStatement(sql) { statement in
                if filtered {
                    let pattern = "%\(needle)%"
                    bind(pattern, to: 1, in: statement)
                    bind(pattern, to: 2, in: statement)
                }
                guard sqlite3_step(statement) == SQLITE_ROW else {
                    throw LogbookDatabaseError.sqlite(String(cString: sqlite3_errmsg(handle)))
                }
                return Int(sqlite3_column_int64(statement, 0))
            }
        }
    }

    public func pendingSyncCount() throws -> Int {
        try scalarCount("SELECT COUNT(*) FROM qsos WHERE is_dirty = 1;")
    }

    public func outboxCount() throws -> Int {
        try scalarCount("SELECT COUNT(*) FROM sync_outbox;")
    }

    public func linkedRemoteCount() throws -> Int {
        try scalarCount("SELECT COUNT(*) FROM qsos WHERE wavelog_id IS NOT NULL;")
    }

    private func scalarCount(_ sql: String) throws -> Int {
        try withDatabaseLock {
            try withStatement(sql) { statement in
                guard sqlite3_step(statement) == SQLITE_ROW else {
                    throw LogbookDatabaseError.sqlite(String(cString: sqlite3_errmsg(handle)))
                }
                return Int(sqlite3_column_int64(statement, 0))
            }
        }
    }

    /// Imports a bounded batch as one transaction, skipping identities already present.
    /// Generic file and remote imports never join prospective online-log enrollment.
    /// The original QSO and pending outbox state remain intact on any failure.
    public func importBatch(_ values: [QSO]) throws -> Int {
        try importBatch(values, onlineLogCandidates: false)
    }

    /// A receive-only logging integration may explicitly identify its accepted
    /// record as a new operator contact. Duplicate detection and prospective
    /// enrollment share the same SQLite write transaction.
    public func importNewContactsForOnlineLogs(_ values: [QSO]) throws -> Int {
        try importBatch(values, onlineLogCandidates: true)
    }

    private func importBatch(_ values: [QSO], onlineLogCandidates: Bool) throws -> Int {
        try withDatabaseLock {
            var seen = Set<SemanticQSOIdentity>()
            var imported = 0
            try execute("BEGIN IMMEDIATE;")
            do {
                for value in values {
                    let identity = SemanticQSOIdentity(
                        call: value.call,
                        timestamp: ISO8601DateFormatter().string(from: value.start),
                        band: value.band,
                        mode: value.submode.isEmpty ? value.mode : value.submode
                    )
                    guard seen.insert(identity).inserted,
                          try lookupSemantic(value) == nil else { continue }
                    try save(value, markDirty: true, onlineLogCandidate: onlineLogCandidates)
                    imported += 1
                }
                try execute("COMMIT;")
                return imported
            } catch {
                try? execute("ROLLBACK;")
                throw error
            }
        }
    }

    public func previous(call: String, limit: Int = 20) throws -> [QSO] {
        try withDatabaseLock {
            try withStatement("SELECT record_json FROM qsos WHERE deleted_at IS NULL AND call = ? COLLATE NOCASE ORDER BY qso_start DESC LIMIT ?;") { statement in
                bind(call, to: 1, in: statement)
                sqlite3_bind_int(statement, 2, Int32(limit))
                return try decodeRows(statement)
            }
        }
    }

    /// Latest exact callsign/band/contact-mode match across the complete log.
    /// SUBMODE takes precedence; CAT sideband/reverse aliases share logging modes.
    public func latestWorkedContact(call: String, band: String, mode: String, excludingID: UUID? = nil) throws -> QSO? {
        try withDatabaseLock {
            try withStatement("""
                SELECT record_json FROM qsos INDEXED BY idx_qsos_call_live_nocase
                WHERE deleted_at IS NULL AND call = ? COLLATE NOCASE AND band = ? COLLATE NOCASE
                  AND CASE UPPER(TRIM(COALESCE(NULLIF(TRIM(json_extract(record_json,'$.submode')),''), mode)))
                    WHEN 'USB' THEN 'SSB' WHEN 'LSB' THEN 'SSB' WHEN 'CWR' THEN 'CW' WHEN 'RTTYR' THEN 'RTTY'
                    ELSE UPPER(TRIM(COALESCE(NULLIF(TRIM(json_extract(record_json,'$.submode')),''), mode))) END = ?
                  AND (? IS NULL OR local_id <> ? COLLATE NOCASE)
                ORDER BY qso_start DESC, local_id ASC LIMIT 1;
                """) { statement in
                bind(call, to: 1, in: statement); bind(band, to: 2, in: statement); bind(mode, to: 3, in: statement)
                bind(excludingID?.uuidString, to: 4, in: statement); bind(excludingID?.uuidString, to: 5, in: statement)
                return try decodeRows(statement).first
            }
        }
    }

    public func stats() throws -> LogbookStats {
        try withDatabaseLock {
            try refreshAggregateCacheVersion()
            let yearStart = Calendar(identifier: .gregorian).date(from: Calendar.current.dateComponents([.year], from: Date()))?.timeIntervalSince1970 ?? 0
            if let cachedStats, cachedStatsYearStart == yearStart { return cachedStats }
            let cacheKey = "stats-v1-\(yearStart)"
            if let value: LogbookStats = try persistedAggregate(cacheKey) {
                cachedStats = value
                cachedStatsYearStart = yearStart
                return value
            }
            let revision = try qsoRevision()
            let value: LogbookStats = try withStatement("""
                SELECT COUNT(*), COUNT(DISTINCT CASE WHEN json_extract(record_json,'$.dxcc') IS NOT NULL THEN json_extract(record_json,'$.dxcc') END),
                SUM(CASE WHEN json_extract(record_json,'$.qslReceived') IN ('Y','V') OR json_extract(record_json,'$.lotwReceived') IN ('Y','V') THEN 1 ELSE 0 END),
                SUM(CASE WHEN qso_start >= ? THEN 1 ELSE 0 END)
                FROM qsos INDEXED BY idx_qsos_metrics_live WHERE deleted_at IS NULL;
                """) { statement in
                    sqlite3_bind_double(statement, 1, yearStart)
                    guard sqlite3_step(statement) == SQLITE_ROW else { return .empty }
                    return LogbookStats(
                        qsoCount: Int(sqlite3_column_int(statement, 0)),
                        dxccCount: Int(sqlite3_column_int(statement, 1)),
                        confirmedCount: Int(sqlite3_column_int(statement, 2)),
                        thisYearCount: Int(sqlite3_column_int(statement, 3))
                    )
                }
            cachedStats = value
            cachedStatsYearStart = yearStart
            persistAggregate(value, key: cacheKey, revision: revision)
            return value
        }
    }

    /// Monotonic durable invalidation token. It exposes no contact data and is
    /// used by native observers to wake logbook views after background imports.
    public func currentRevision() throws -> Int64 {
        try withDatabaseLock { try qsoRevision() }
    }

    public func awardProgress() throws -> AwardProgressSnapshot {
        try withDatabaseLock {
            try refreshAggregateCacheVersion()
            if let cachedAwards { return cachedAwards }
            // Bump this key if progress calculation semantics change.
            let cacheKey = "award-progress-v1"
            if let value: AwardProgressSnapshot = try persistedAggregate(cacheKey) {
                cachedAwards = value
                return value
            }
            let revision = try qsoRevision()
            let confirmed = "(UPPER(COALESCE(json_extract(record_json,'$.qslReceived'),'')) IN ('Y','V') OR UPPER(COALESCE(json_extract(record_json,'$.lotwReceived'),'')) IN ('Y','V'))"
            let effectiveMode = "UPPER(COALESCE(NULLIF(json_extract(record_json,'$.submode'),''), mode))"
            let modeGroup = "CASE WHEN \(effectiveMode) = 'CW' THEN 'CW' WHEN \(effectiveMode) IN ('SSB','USB','LSB','AM','FM') THEN 'Phone' ELSE 'Digital' END"
            let validStates = Set("AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(separator: " ").map(String.init))
            // One row projection replaces ten distinct aggregates plus four
            // independent scans. It never materializes or decodes QSO JSON.
            let value = try withStatement("""
                SELECT \(confirmed), CAST(json_extract(record_json,'$.dxcc') AS INTEGER),
                    CAST(json_extract(record_json,'$.cqZone') AS INTEGER),
                    UPPER(TRIM(COALESCE(json_extract(record_json,'$.state'),''))),
                    CASE WHEN LENGTH(TRIM(COALESCE(json_extract(record_json,'$.gridSquare'),''))) >= 4
                        THEN UPPER(SUBSTR(TRIM(json_extract(record_json,'$.gridSquare')),1,4)) END,
                    \(modeGroup), COALESCE(NULLIF(LOWER(band),''),'Unknown'),
                    COALESCE(NULLIF(UPPER(TRIM(json_extract(record_json,'$.continent'))),''),'Unknown'),
                    STRFTIME('%Y', qso_start, 'unixepoch')
                FROM qsos INDEXED BY idx_qsos_metrics_live WHERE deleted_at IS NULL;
                """) { statement -> AwardProgressSnapshot in
                func string(_ column: Int32) -> String? {
                    sqlite3_column_text(statement, column).map { String(cString: $0) }
                }
                func count(_ dictionary: inout [String: Int], _ key: String?) {
                    dictionary[(key?.isEmpty == false ? key : nil) ?? "Unknown", default: 0] += 1
                }
                var result = AwardProgressSnapshot()
                var workedDXCC = Set<Int>(), confirmedDXCC = Set<Int>()
                var workedZones = Set<Int>(), confirmedZones = Set<Int>()
                var workedStates = Set<String>(), confirmedStates = Set<String>()
                var workedGrids = Set<String>(), confirmedGrids = Set<String>()
                var step = sqlite3_step(statement)
                while step == SQLITE_ROW {
                    result.qsoCount += 1
                    let isConfirmed = sqlite3_column_int(statement, 0) != 0
                    if isConfirmed { result.confirmedQSOs += 1 }
                    let dxcc = Int(sqlite3_column_int(statement, 1))
                    if dxcc > 0 {
                        workedDXCC.insert(dxcc)
                        if isConfirmed { confirmedDXCC.insert(dxcc) }
                    }
                    let zone = Int(sqlite3_column_int(statement, 2))
                    if (1...40).contains(zone) {
                        workedZones.insert(zone)
                        if isConfirmed { confirmedZones.insert(zone) }
                    }
                    if [291, 6, 110].contains(dxcc), let state = string(3), validStates.contains(state) {
                        workedStates.insert(state)
                        if isConfirmed { confirmedStates.insert(state) }
                    }
                    if let field = string(4) {
                        workedGrids.insert(field)
                        if isConfirmed { confirmedGrids.insert(field) }
                    }
                    count(&result.modeCounts, string(5))
                    count(&result.bandCounts, string(6))
                    count(&result.continentCounts, string(7))
                    count(&result.yearCounts, string(8))
                    step = sqlite3_step(statement)
                }
                guard step == SQLITE_DONE else { throw error() }
                result.dxccWorked = workedDXCC.count
                result.dxccConfirmed = confirmedDXCC.count
                result.cqZonesWorked = workedZones.count
                result.cqZonesConfirmed = confirmedZones.count
                result.statesWorked = workedStates.count
                result.statesConfirmed = confirmedStates.count
                result.gridsWorked = workedGrids.count
                result.gridsConfirmed = confirmedGrids.count
                return result
            }
            cachedAwards = value
            persistAggregate(value, key: cacheKey, revision: revision)
            return value
        }
    }

    /// One aggregate query for the map; never decode every QSO on every radio poll.
    public func dxccMapStatuses() throws -> [Int: String] {
        try withDatabaseLock {
            try refreshAggregateCacheVersion()
            if let cachedDXCCStatuses { return cachedDXCCStatuses }
            let cacheKey = "dxcc-map-v1"
            if let value: [Int: String] = try persistedAggregate(cacheKey) {
                cachedDXCCStatuses = value
                return value
            }
            let revision = try qsoRevision()
            let value = try withStatement("""
                SELECT CAST(json_extract(record_json,'$.dxcc') AS INTEGER),
                    MAX(CASE WHEN UPPER(COALESCE(json_extract(record_json,'$.qslReceived'),'')) IN ('Y','V')
                        OR UPPER(COALESCE(json_extract(record_json,'$.lotwReceived'),'')) IN ('Y','V') THEN 1 ELSE 0 END)
                FROM qsos INDEXED BY idx_qsos_metrics_live
                WHERE deleted_at IS NULL AND CAST(json_extract(record_json,'$.dxcc') AS INTEGER) > 0
                GROUP BY CAST(json_extract(record_json,'$.dxcc') AS INTEGER);
                """) { statement in
                    var result: [Int: String] = [:]
                    while sqlite3_step(statement) == SQLITE_ROW {
                        result[Int(sqlite3_column_int(statement, 0))] = sqlite3_column_int(statement, 1) == 1 ? "confirmed" : "worked"
                    }
                    return result
                }
            cachedDXCCStatuses = value
            persistAggregate(value, key: cacheKey, revision: revision)
            return value
        }
    }

    public func awardCatalog() throws -> AwardCatalogSnapshot {
        try withDatabaseLock {
            try refreshAggregateCacheVersion()
            if let cachedAwardCatalog { return cachedAwardCatalog }
            let cacheKey = try AwardCatalogEngine.persistedCacheKey.get()
            if let value: AwardCatalogSnapshot = try persistedAggregate(cacheKey) {
                cachedAwardCatalog = value
                return value
            }
            let revision = try qsoRevision()
            // All current calculators are limited to Japan, WAPC entities,
            // or WCSA school calls. The slash arm is a portable-call superset.
            // `save` maintains the indexed call column alongside record_json;
            // use it to avoid parsing every full JSON blob on a cold open.
            let schools = try AwardCatalogEngine.candidateSchoolCalls()
            let placeholders = Array(repeating: "?", count: schools.count).joined(separator: ",")
            let entities = AwardCatalogEngine.candidateDXCCs.map(String.init).joined(separator: ",")
            let sql = """
                WITH candidates AS (
                    SELECT local_id FROM qsos
                    WHERE deleted_at IS NULL AND CAST(json_extract(record_json,'$.dxcc') AS INTEGER) IN (\(entities))
                    UNION
                    SELECT local_id FROM qsos INDEXED BY idx_qsos_call
                    WHERE INSTR(call,'/') > 0 OR UPPER(TRIM(call)) IN (\(placeholders))
                )
                SELECT qsos.record_json FROM candidates JOIN qsos USING (local_id)
                WHERE qsos.deleted_at IS NULL ORDER BY qsos.qso_start ASC;
                """
            let values = try withStatement(sql) { statement in
                for (index, call) in schools.enumerated() {
                    bind(call, to: Int32(index + 1), in: statement)
                }
                return try decodeRows(statement, as: AwardCatalogContact.self)
            }
            let catalog = try AwardCatalogEngine.compute(contacts: values)
            cachedAwardCatalog = catalog
            persistAggregate(catalog, key: cacheKey, revision: revision)
            return catalog
        }
    }

    /// Single narrow projection for worked/confirmed reference history. It
    /// does not decode QSO records or classify a missing/failed DB as "new".
    public func opportunityReferenceHistory() throws -> [OpportunityReferenceHistory] {
        try withDatabaseLock {
            try refreshAggregateCacheVersion()
            if let cachedOpportunityReferences { return cachedOpportunityReferences }
            struct Key: Hashable { let kind: String; let reference: String }
            struct BandModeKey: Hashable { let band: String; let mode: String }
            struct Tally { var worked = 0; var confirmed = 0; var cells: [BandModeKey: (Int, Int)] = [:] }
            let values = try withStatement("""
                SELECT json_extract(record_json,'$.potaReference'),
                    json_extract(record_json,'$.sotaReference'),
                    json_extract(record_json,'$.iota'),
                    json_extract(record_json,'$.wwffReference'),
                    json_extract(record_json,'$.sig'),
                    json_extract(record_json,'$.sigInfo'),
                    json_extract(record_json,'$.band'),
                    COALESCE(NULLIF(json_extract(record_json,'$.submode'),''),
                             json_extract(record_json,'$.mode')),
                    (UPPER(COALESCE(json_extract(record_json,'$.qslReceived'),'')) IN ('Y','V')
                     OR UPPER(COALESCE(json_extract(record_json,'$.lotwReceived'),'')) IN ('Y','V'))
                FROM qsos WHERE deleted_at IS NULL;
                """) { statement -> [OpportunityReferenceHistory] in
                func value(_ column: Int32) -> String {
                    sqlite3_column_text(statement, column).map { String(cString: $0) } ?? ""
                }
                func references(_ raw: String) -> Set<String> {
                    Set(raw.split(whereSeparator: { $0 == "," || $0 == ";" || $0.isNewline })
                        .map { $0.trimmingCharacters(in: .whitespacesAndNewlines).uppercased() }
                        .filter { !$0.isEmpty })
                }
                var tallies: [Key: Tally] = [:]
                var step = sqlite3_step(statement)
                while step == SQLITE_ROW {
                    let band = value(6).trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
                    let mode = value(7).trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
                    let confirmed = sqlite3_column_int(statement, 8) != 0
                    var entries = [("pota", value(0)), ("sota", value(1)),
                                   ("iota", value(2)), ("wwff", value(3))]
                    let sig = value(4).trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
                    if ["WCA", "COTA", "CASTLE"].contains(sig) { entries.append(("castle", value(5))) }
                    for (kind, raw) in entries {
                        for reference in references(raw) {
                            let key = Key(kind: kind, reference: reference)
                            var tally = tallies[key] ?? Tally()
                            tally.worked += 1
                            if confirmed { tally.confirmed += 1 }
                            let cell = BandModeKey(band: band, mode: mode)
                            var counts = tally.cells[cell] ?? (0, 0)
                            counts.0 += 1
                            if confirmed { counts.1 += 1 }
                            tally.cells[cell] = counts
                            tallies[key] = tally
                        }
                    }
                    step = sqlite3_step(statement)
                }
                guard step == SQLITE_DONE else { throw error() }
                return tallies.map { key, tally in
                    OpportunityReferenceHistory(
                        kind: key.kind, reference: key.reference,
                        workedCount: tally.worked, confirmedCount: tally.confirmed,
                        bandModes: tally.cells.map { cell, counts in
                            .init(band: cell.band, mode: cell.mode,
                                  workedCount: counts.0, confirmedCount: counts.1)
                        }.sorted { ($0.band, $0.mode) < ($1.band, $1.mode) }
                    )
                }.sorted { ($0.kind, $0.reference) < ($1.kind, $1.reference) }
            }
            cachedOpportunityReferences = values
            return values
        }
    }

    private func qsoRevision() throws -> Int64 {
        try withStatement("SELECT revision FROM xlog_qso_revision WHERE singleton = 1;") { statement in
            guard sqlite3_step(statement) == SQLITE_ROW else { throw error() }
            return sqlite3_column_int64(statement, 0)
        }
    }

    private func persistedAggregate<T: Decodable>(_ key: String) throws -> T? {
        try withStatement("""
            SELECT payload FROM xlog_aggregate_cache c JOIN xlog_qso_revision r
                ON r.singleton = 1 AND c.revision = r.revision WHERE c.cache_key = ?;
            """) { statement in
            bind(key, to: 1, in: statement)
            let step = sqlite3_step(statement)
            if step == SQLITE_DONE { return nil }
            guard step == SQLITE_ROW else { throw error() }
            guard let bytes = sqlite3_column_blob(statement, 0) else { return nil }
            let data = Data(bytes: bytes, count: Int(sqlite3_column_bytes(statement, 0)))
            // A damaged or obsolete derived payload is recomputed, never treated
            // as an empty logbook. Authoritative QSO data is not modified.
            return try? decoder.decode(T.self, from: data)
        }
    }

    private func persistAggregate<T: Encodable>(_ value: T, key: String, revision: Int64) {
        // An external writer may commit during calculation. Publish only if its
        // revision is still current in this atomic statement; otherwise a later
        // call recomputes. Cache write failure must not hide a valid calculation.
        try? withStatement("""
            INSERT OR REPLACE INTO xlog_aggregate_cache(cache_key, revision, payload)
                SELECT ?, ?, ? WHERE (SELECT revision FROM xlog_qso_revision WHERE singleton = 1) = ?;
            """) { statement in
            let data = try encoder.encode(value)
            bind(key, to: 1, in: statement)
            sqlite3_bind_int64(statement, 2, revision)
            _ = data.withUnsafeBytes { sqlite3_bind_blob(statement, 3, $0.baseAddress, Int32($0.count), Self.transient) }
            sqlite3_bind_int64(statement, 4, revision)
            try stepDone(statement)
        }
    }

    /// SQLite's data_version changes for commits made by other connections;
    /// this connection invalidates directly in save(), including sync merges.
    private func refreshAggregateCacheVersion() throws {
        let version = try withStatement("PRAGMA data_version;") { statement in
            guard sqlite3_step(statement) == SQLITE_ROW else {
                throw LogbookDatabaseError.sqlite(String(cString: sqlite3_errmsg(handle)))
            }
            return Int(sqlite3_column_int64(statement, 0))
        }
        if let cachedDataVersion, cachedDataVersion != version { invalidateQSOAggregates() }
        cachedDataVersion = version
    }

    private func invalidateQSOAggregates() {
        cachedStats = nil
        cachedStatsYearStart = nil
        cachedAwards = nil
        cachedDXCCStatuses = nil
        cachedAwardCatalog = nil
        cachedOpportunityReferences = nil
        cachedClusterContactRows = nil
    }

    public func bandModeMatrix(call: String) throws -> Set<BandModeCell> {
        try withDatabaseLock {
            // A history page is not an award matrix: an older confirmation
            // must remain visible even after thousands of recent contacts.
            try withStatement("""
                SELECT band, COALESCE(NULLIF(json_extract(record_json,'$.submode'),''), mode),
                    MAX(CASE WHEN json_extract(record_json,'$.qslReceived') IN ('Y','V')
                        OR json_extract(record_json,'$.lotwReceived') IN ('Y','V') THEN 1 ELSE 0 END)
                FROM qsos WHERE deleted_at IS NULL AND call = ? COLLATE NOCASE
                GROUP BY band, COALESCE(NULLIF(json_extract(record_json,'$.submode'),''), mode);
                """) { statement in
                bind(call, to: 1, in: statement)
                var cells: Set<BandModeCell> = []
                while sqlite3_step(statement) == SQLITE_ROW {
                    let band = sqlite3_column_text(statement, 0).map { String(cString: $0) } ?? ""
                    let mode = sqlite3_column_text(statement, 1).map { String(cString: $0) } ?? ""
                    cells.insert(BandModeCell(band: band, mode: mode, worked: true,
                                             confirmed: sqlite3_column_int(statement, 2) == 1))
                }
                return cells
            }
        }
    }

    public func dxccSummary(dxcc: Int) throws -> DXCCSummary {
        try withDatabaseLock {
            let predicate = "deleted_at IS NULL AND CAST(json_extract(record_json,'$.dxcc') AS INTEGER) = ?"
            let counts = try withStatement("""
                SELECT COUNT(*),
                SUM(CASE WHEN json_extract(record_json,'$.qslReceived') IN ('Y','V')
                    OR json_extract(record_json,'$.lotwReceived') IN ('Y','V') THEN 1 ELSE 0 END)
                FROM qsos WHERE \(predicate);
                """) { statement -> (Int, Int) in
                    sqlite3_bind_int(statement, 1, Int32(dxcc))
                    guard sqlite3_step(statement) == SQLITE_ROW else { return (0, 0) }
                    return (Int(sqlite3_column_int(statement, 0)), Int(sqlite3_column_int(statement, 1)))
                }

            let matrix = try withStatement("""
                SELECT band,
                    COALESCE(NULLIF(json_extract(record_json,'$.submode'),''), mode),
                    MAX(CASE WHEN json_extract(record_json,'$.qslReceived') IN ('Y','V')
                        OR json_extract(record_json,'$.lotwReceived') IN ('Y','V') THEN 1 ELSE 0 END)
                FROM qsos WHERE \(predicate)
                GROUP BY band, COALESCE(NULLIF(json_extract(record_json,'$.submode'),''), mode);
                """) { statement -> Set<BandModeCell> in
                    sqlite3_bind_int(statement, 1, Int32(dxcc))
                    var cells: Set<BandModeCell> = []
                    while sqlite3_step(statement) == SQLITE_ROW {
                        let band = sqlite3_column_text(statement, 0).map { String(cString: $0) } ?? ""
                        let mode = sqlite3_column_text(statement, 1).map { String(cString: $0) } ?? ""
                        cells.insert(BandModeCell(band: band, mode: mode, worked: true, confirmed: sqlite3_column_int(statement, 2) == 1))
                    }
                    return cells
                }

            let latest = try withStatement("SELECT record_json FROM qsos WHERE \(predicate) ORDER BY qso_start DESC LIMIT 1;") { statement -> QSO? in
                sqlite3_bind_int(statement, 1, Int32(dxcc))
                return try decodeRows(statement).first
            }
            return DXCCSummary(qsoCount: counts.0, confirmedCount: counts.1, matrix: matrix, latest: latest)
        }
    }

    public func pending(limit: Int = 100, includingDeferred: Bool = false, excluding: (QSO) -> Bool = { _ in false }) throws -> [QSO] {
        try withDatabaseLock {
            guard limit > 0 else { return [] }
            let dueClause = includingDeferred ? "" : "AND (o.next_attempt_at IS NULL OR o.next_attempt_at <= ?)"
            let sql = """
                SELECT q.record_json FROM qsos q
                LEFT JOIN sync_outbox o ON o.local_id = q.local_id
                WHERE q.is_dirty = 1 \(dueClause)
                ORDER BY q.updated_at ASC, q.local_id ASC;
                """
            return try withStatement(sql) { statement in
                var index: Int32 = 1
                if !includingDeferred {
                    sqlite3_bind_double(statement, index, Date().timeIntervalSince1970)
                    index += 1
                }
                // Apply holds before the accepted-row cap, so held contacts
                // cannot permanently starve later unrelated uploads.
                var values: [QSO] = []
                var step = sqlite3_step(statement)
                while step == SQLITE_ROW {
                    guard let bytes = sqlite3_column_blob(statement, 0) else { throw LogbookDatabaseError.corruptRecord }
                    let value = try decoder.decode(QSO.self, from: Data(bytes: bytes, count: Int(sqlite3_column_bytes(statement, 0))))
                    if !excluding(value) { values.append(value) }
                    if values.count == limit { return values }
                    step = sqlite3_step(statement)
                }
                guard step == SQLITE_DONE else { throw error() }
                return values
            }
        }
    }

    public func outboxEntries(limit: Int = 500) throws -> [SyncOutboxEntry] {
        try withDatabaseLock {
            try withStatement("""
                SELECT q.record_json, COALESCE(o.attempt_count, 0), o.last_attempt_at, o.next_attempt_at, o.last_error
                FROM qsos q LEFT JOIN sync_outbox o ON o.local_id = q.local_id
                WHERE q.is_dirty = 1
                ORDER BY COALESCE(o.next_attempt_at, q.updated_at) ASC LIMIT ?;
                """) { statement in
                sqlite3_bind_int(statement, 1, Int32(limit))
                var values: [SyncOutboxEntry] = []
                while sqlite3_step(statement) == SQLITE_ROW {
                    guard let bytes = sqlite3_column_blob(statement, 0) else { throw LogbookDatabaseError.corruptRecord }
                    let qso = try decoder.decode(QSO.self, from: Data(bytes: bytes, count: Int(sqlite3_column_bytes(statement, 0))))
                    let attempts = Int(sqlite3_column_int(statement, 1))
                    let lastAttempt = sqlite3_column_type(statement, 2) == SQLITE_NULL ? nil : Date(timeIntervalSince1970: sqlite3_column_double(statement, 2))
                    let nextAttempt = sqlite3_column_type(statement, 3) == SQLITE_NULL ? nil : Date(timeIntervalSince1970: sqlite3_column_double(statement, 3))
                    let error = sqlite3_column_text(statement, 4).map { String(cString: $0) }
                    values.append(.init(qso: qso, attemptCount: attempts, lastAttemptAt: lastAttempt, nextAttemptAt: nextAttempt, lastError: error))
                }
                return values
            }
        }
    }

    public func recordSyncFailure(localID: UUID, message: String, at date: Date = Date()) throws {
        try withDatabaseLock {
            let previousAttempts = try withStatement("SELECT attempt_count FROM sync_outbox WHERE local_id = ? LIMIT 1;") { statement -> Int in
                bind(localID.uuidString, to: 1, in: statement)
                return sqlite3_step(statement) == SQLITE_ROW ? Int(sqlite3_column_int(statement, 0)) : 0
            }
            let attemptCount = previousAttempts + 1
            let delay = min(3_600.0, 30.0 * pow(2.0, Double(min(previousAttempts, 7))))
            try withStatement("""
                INSERT INTO sync_outbox(local_id, attempt_count, last_attempt_at, next_attempt_at, last_error)
                VALUES(?,?,?,?,?)
                ON CONFLICT(local_id) DO UPDATE SET
                  attempt_count=excluded.attempt_count,
                  last_attempt_at=excluded.last_attempt_at,
                  next_attempt_at=excluded.next_attempt_at,
                  last_error=excluded.last_error;
                """) { statement in
                bind(localID.uuidString, to: 1, in: statement)
                sqlite3_bind_int(statement, 2, Int32(attemptCount))
                sqlite3_bind_double(statement, 3, date.timeIntervalSince1970)
                sqlite3_bind_double(statement, 4, date.addingTimeInterval(delay).timeIntervalSince1970)
                bind(message, to: 5, in: statement)
                try stepDone(statement)
            }
        }
    }

    public func retrySync(localID: UUID) throws {
        try withDatabaseLock {
            try withStatement("UPDATE sync_outbox SET next_attempt_at = NULL WHERE local_id = ?;") { statement in
                bind(localID.uuidString, to: 1, in: statement)
                try stepDone(statement)
            }
        }
    }

    public func clearSyncFailure(localID: UUID) throws {
        try withDatabaseLock {
            try withStatement("DELETE FROM sync_outbox WHERE local_id = ?;") { statement in
                bind(localID.uuidString, to: 1, in: statement)
                try stepDone(statement)
            }
        }
    }

    public func markSynced(localID: UUID, wavelogID: Int? = nil) throws {
        try withDatabaseLock {
            guard var qso = try lookup(localID: localID) else { return }
            if let wavelogID { qso.wavelogID = wavelogID }
            qso.isDirty = false
            try save(qso, markDirty: false)
            try clearSyncFailure(localID: localID)
        }
    }

    /// A remote acknowledgement covers only the submitted snapshot. Logging
    /// remains available during a request; newer edits/deletes stay queued.
    public func acknowledgeSynced(_ submitted: QSO, wavelogID: Int? = nil) throws {
        try withDatabaseLock {
            try execute("BEGIN IMMEDIATE;")
            do {
                if var current = try lookup(localID: submitted.id) {
                    let changed = current != submitted
                    var baseline = submitted
                    if let wavelogID { baseline.wavelogID = wavelogID; current.wavelogID = wavelogID }
                    // An undo that raced a successful remote delete must create
                    // a new remote record, rather than update the deleted ID.
                    if changed, submitted.deletedAt != nil { current.wavelogID = nil }
                    try save(current, markDirty: changed)
                    let fingerprint = try syncFingerprint(baseline)
                    try withStatement("UPDATE qsos SET baseline_json = ? WHERE local_id = ?;") { statement in
                        _ = fingerprint.withUnsafeBytes { bytes in
                            sqlite3_bind_blob(statement, 1, bytes.baseAddress, Int32(bytes.count), Self.transient)
                        }
                        bind(submitted.id.uuidString, to: 2, in: statement)
                        try stepDone(statement)
                    }
                    try clearSyncFailure(localID: submitted.id)
                }
                try execute("COMMIT;")
            } catch {
                try? execute("ROLLBACK;")
                throw error
            }
        }
    }

    public func possibleDuplicate(call: String, band: String, mode: String, around date: Date, within seconds: TimeInterval = 600) throws -> QSO? {
        try withDatabaseLock {
            try withStatement("""
                SELECT record_json FROM qsos
                WHERE deleted_at IS NULL AND call = ? COLLATE NOCASE AND band = ? COLLATE NOCASE
                  AND mode = ? COLLATE NOCASE AND ABS(qso_start - ?) <= ?
                ORDER BY ABS(qso_start - ?) ASC LIMIT 1;
                """) { statement in
                bind(call, to: 1, in: statement)
                bind(band, to: 2, in: statement)
                bind(mode, to: 3, in: statement)
                sqlite3_bind_double(statement, 4, date.timeIntervalSince1970)
                sqlite3_bind_double(statement, 5, seconds)
                sqlite3_bind_double(statement, 6, date.timeIntervalSince1970)
                return try decodeRows(statement).first
            }
        }
    }

    @discardableResult
    public func mergeRemote(_ remote: QSO, preservingLocal: (QSO) -> Bool = { _ in false }) throws -> Bool {
        try withDatabaseLock {
            let linked = try remote.wavelogID.flatMap { try lookup(wavelogID: $0) }
            if let linked, preservingLocal(linked) { return false }
            if let existing = linked, existing.isDirty {
                if try remoteMatchesBaseline(remote, localID: existing.id) { return false }
                try recordConflict(local: existing, remote: mergeRemoteFields(remote, preserving: existing))
                return true
            }
            var value = remote
            var matched: QSO?
            if let existing = linked {
                matched = existing
                value = mergeRemoteFields(value, preserving: existing)
            }
            // Similar contact fields are only a fallback for a local/imported
            // record that has never acquired a remote identity. Wavelog may
            // legitimately contain distinct IDs with identical QSO fields;
            // adopting an already-linked row would erase one of those IDs.
            else if let existing = try lookupSemantic(value, unlinkedOnly: true, excluding: preservingLocal) {
                if existing.isDirty {
                    if try remoteMatchesBaseline(remote, localID: existing.id) { return false }
                    try recordConflict(local: existing, remote: mergeRemoteFields(remote, preserving: existing))
                    return true
                }
                matched = existing
                value = mergeRemoteFields(value, preserving: existing)
            }
            // Compare everything save() would persist, including confirmations,
            // enrichment, unknown ADIF fields and tombstones. The conflict
            // fingerprint intentionally covers fewer fields. Retain the stored
            // timestamp only for comparison; a real change still gets a new one.
            // Missing, stale or damaged clean baselines still need save() to repair them.
            if let existing = matched {
                let candidate = normalizedForSave(value, markDirty: false, updatedAt: existing.updatedAt)
                if candidate == existing,
                   try remoteMatchesBaseline(candidate, localID: existing.id, invalidBaselineIsMismatch: true) {
                    return false
                }
            }
            try save(value, markDirty: false)
            return false
        }
    }

    /// Reconciles one Wavelog page in a single SQLite transaction. Initial
    /// station imports can contain tens of thousands of QSOs, so committing
    /// every row individually would make automatic sync effectively
    /// continuous on a large logbook.
    public func mergeRemoteBatch(_ remotes: [QSO], preservingLocal: (QSO) -> Bool = { _ in false }) throws -> Int {
        try withDatabaseLock {
            guard !remotes.isEmpty else { return 0 }
            try execute("BEGIN IMMEDIATE;")
            do {
                var conflicts = 0
                for remote in remotes where try mergeRemote(remote, preservingLocal: preservingLocal) {
                    conflicts += 1
                }
                try execute("COMMIT;")
                return conflicts
            } catch {
                try? execute("ROLLBACK;")
                throw error
            }
        }
    }

    // One owner spans all awaits, including the remote read and upload phase.
    // Closing this particular connection invalidates its ephemeral run token.
    func beginSyncReconciliation() throws -> SyncDatabaseRun {
        try withDatabaseLock {
            guard handle != nil else { throw LogbookDatabaseError.closed }
            guard syncRunID == nil else { throw LogbookDatabaseError.syncBusy }
            let run = SyncDatabaseRun(id: UUID()); syncRunID = run.id; return run
        }
    }

    func endSyncReconciliation(_ run: SyncDatabaseRun) {
        withDatabaseLock { if syncRunID == run.id { syncRunID = nil } }
    }

    /// Never call back into the service/workspace owner from this closure.
    /// The service lease is checked BEFORE entering here (service -> DB order).
    func withSyncDatabaseLock<T>(_ run: SyncDatabaseRun, _ body: () throws -> T) throws -> T {
        try Task.checkCancellation()
        try syncAdmission.beginBackground()
        defer { syncAdmission.endBackground() }
        return try lock.withLock {
            try Task.checkCancellation()
            guard handle != nil, syncRunID == run.id else { throw LogbookDatabaseError.syncRunChanged }
            return try body()
        }
    }

    func mergeRemoteSyncStep(_ remotes: ArraySlice<QSO>, run: SyncDatabaseRun,
                             preservingLocal: (QSO) -> Bool) throws -> Int {
        guard remotes.count <= 128 else { throw LogbookDatabaseError.syncRunChanged }
        return try withSyncDatabaseLock(run) {
            try execute("BEGIN IMMEDIATE;")
            do {
                var conflicts = 0
                for remote in remotes {
                    try Task.checkCancellation()
                    if try mergeRemote(remote, preservingLocal: preservingLocal) { conflicts += 1 }
                }
                try Task.checkCancellation()
                try execute("COMMIT;")
                return conflicts
            } catch { try? execute("ROLLBACK;"); throw error }
        }
    }

    func syncUpperRowID(run: SyncDatabaseRun) throws -> Int64 {
        try withSyncDatabaseLock(run) {
            try withStatement("SELECT COALESCE(MAX(rowid),0) FROM qsos;") {
                guard sqlite3_step($0) == SQLITE_ROW else { throw error() }
                return sqlite3_column_int64($0, 0)
            }
        }
    }

    /// A bounded keyset traversal, not OFFSET or a decoded all-contact snapshot.
    /// The high-water mark bounds traversal; current dirty state decides writes.
    func reconcileRemoteDeletionStep(notIn remoteIDs: Set<Int>, after: Int64, through: Int64,
                                     run: SyncDatabaseRun) throws -> SyncDeletionStep {
        try withSyncDatabaseLock(run) {
            try execute("BEGIN IMMEDIATE;")
            do {
                let rows: [(Int64, QSO?)] = try withStatement("""
                    SELECT rowid,wavelog_id,deleted_at,record_json FROM qsos
                    WHERE rowid > ? AND rowid <= ?
                    ORDER BY rowid LIMIT 128;
                    """) { statement in
                    sqlite3_bind_int64(statement, 1, after); sqlite3_bind_int64(statement, 2, through)
                    var rows: [(Int64, QSO?)] = []
                    var step = sqlite3_step(statement)
                    while step == SQLITE_ROW {
                        try Task.checkCancellation()
                        let rowID = sqlite3_column_int64(statement, 0)
                        let remoteID = Int(sqlite3_column_int64(statement, 1))
                        var value: QSO?
                        if sqlite3_column_type(statement, 1) != SQLITE_NULL,
                           sqlite3_column_type(statement, 2) == SQLITE_NULL, !remoteIDs.contains(remoteID) {
                            guard let bytes = sqlite3_column_blob(statement, 3) else { throw LogbookDatabaseError.corruptRecord }
                            value = try decoder.decode(QSO.self, from: Data(bytes: bytes, count: Int(sqlite3_column_bytes(statement, 3))))
                        }
                        rows.append((rowID, value)); step = sqlite3_step(statement)
                    }
                    guard step == SQLITE_DONE else { throw error() }
                    return rows
                }
                var conflicts = 0, deleted = 0
                for (_, candidate) in rows {
                    try Task.checkCancellation()
                    guard var current = candidate else { continue }
                    if current.isDirty {
                        if try !hasConflict(localID: current.id) {
                            var removed = current; removed.isDirty = false; removed.deletedAt = Date()
                            try recordConflict(local: current, remote: removed); conflicts += 1
                        }
                    } else {
                        current.deletedAt = Date(); try save(current, markDirty: false); deleted += 1
                    }
                }
                try Task.checkCancellation()
                try execute("COMMIT;")
                return SyncDeletionStep(cursor: rows.last?.0 ?? through, done: rows.count < 128,
                                        conflicts: conflicts, deleted: deleted)
            } catch { try? execute("ROLLBACK;"); throw error }
        }
    }

    func pendingSyncStep(after cursor: Int64, through: Int64, due: Date,
                         run: SyncDatabaseRun) throws -> SyncPendingStep {
        try withSyncDatabaseLock(run) {
            try withStatement("""
                SELECT q.rowid,q.is_dirty,CASE WHEN q.is_dirty=1 THEN q.record_json ELSE NULL END,o.next_attempt_at
                FROM qsos q
                LEFT JOIN sync_outbox o ON o.local_id=q.local_id
                WHERE q.rowid > ? AND q.rowid <= ?
                  AND NOT EXISTS (SELECT 1 FROM sync_conflicts c WHERE c.local_id = q.local_id)
                ORDER BY q.rowid LIMIT 128;
                """) { statement in
                sqlite3_bind_int64(statement, 1, cursor)
                sqlite3_bind_int64(statement, 2, through)
                var rows: [QSO] = [], next = cursor, scanned = 0
                var step = sqlite3_step(statement)
                while step == SQLITE_ROW {
                    try Task.checkCancellation()
                    next = sqlite3_column_int64(statement, 0)
                    scanned += 1
                    if sqlite3_column_int(statement, 1) == 1,
                       sqlite3_column_type(statement, 3) == SQLITE_NULL || sqlite3_column_double(statement, 3) <= due.timeIntervalSince1970 {
                        guard let bytes = sqlite3_column_blob(statement, 2) else { throw LogbookDatabaseError.corruptRecord }
                        rows.append(try decoder.decode(QSO.self, from: Data(bytes: bytes, count: Int(sqlite3_column_bytes(statement, 2)))))
                    }
                    step = sqlite3_step(statement)
                }
                guard step == SQLITE_DONE else { throw error() }
                return SyncPendingStep(cursor: next, done: scanned < 128, rows: rows)
            }
        }
    }

    func withDatabaseLock<T>(_ body: () throws -> T) rethrows -> T {
        syncAdmission.beginForeground()
        defer { syncAdmission.endForeground() }
        return try lock.withLock(body)
    }

    public func conflicts() throws -> [SyncConflict] {
        try withDatabaseLock {
            try withStatement("SELECT conflict_json FROM sync_conflicts ORDER BY detected_at DESC;") { statement in
                var values: [SyncConflict] = []
                while sqlite3_step(statement) == SQLITE_ROW {
                    guard let bytes = sqlite3_column_blob(statement, 0) else { throw LogbookDatabaseError.corruptRecord }
                    values.append(try decoder.decode(SyncConflict.self, from: Data(bytes: bytes, count: Int(sqlite3_column_bytes(statement, 0)))))
                }
                return values
            }
        }
    }

    public func resolveConflict(_ conflict: SyncConflict, useRemote: Bool) throws {
        try withDatabaseLock {
            try execute("BEGIN IMMEDIATE;")
            do {
                var remote = conflict.remoteQSO
                remote.id = conflict.localQSO.id
                if useRemote {
                    try save(remote, markDirty: false)
                } else {
                    try save(conflict.localQSO, markDirty: true)
                    try updateSyncBaseline(remote, localID: conflict.localQSO.id)
                }
                try deleteConflict(conflict.id)
                try execute("COMMIT;")
            } catch {
                try? execute("ROLLBACK;")
                throw error
            }
        }
    }

    public func resolveConflict(_ conflict: SyncConflict, merged: QSO) throws {
        try withDatabaseLock {
            try execute("BEGIN IMMEDIATE;")
            do {
                var value = merged
                value.id = conflict.localQSO.id
                value.wavelogID = conflict.remoteQSO.wavelogID ?? conflict.localQSO.wavelogID
                try save(value, markDirty: true)
                var remote = conflict.remoteQSO
                remote.id = conflict.localQSO.id
                try updateSyncBaseline(remote, localID: conflict.localQSO.id)
                try deleteConflict(conflict.id)
                try execute("COMMIT;")
            } catch {
                try? execute("ROLLBACK;")
                throw error
            }
        }
    }

    private func updateSyncBaseline(_ remote: QSO, localID: UUID) throws {
        let fingerprint = try syncFingerprint(remote)
        try withStatement("UPDATE qsos SET baseline_json = ? WHERE local_id = ?;") { statement in
            _ = fingerprint.withUnsafeBytes { bytes in
                sqlite3_bind_blob(statement, 1, bytes.baseAddress, Int32(bytes.count), Self.transient)
            }
            bind(localID.uuidString, to: 2, in: statement)
            try stepDone(statement)
        }
    }

    private func deleteConflict(_ id: UUID) throws {
        try withStatement("DELETE FROM sync_conflicts WHERE conflict_id = ?;") { statement in
            bind(id.uuidString, to: 1, in: statement)
            try stepDone(statement)
        }
    }

    public func hasConflict(localID: UUID) throws -> Bool {
        try withDatabaseLock {
            try withStatement("SELECT 1 FROM sync_conflicts WHERE local_id = ? LIMIT 1;") { statement in
                bind(localID.uuidString, to: 1, in: statement)
                return sqlite3_step(statement) == SQLITE_ROW
            }
        }
    }

    @discardableResult
    public func recordRemoteDeletionConflicts(notIn remoteIDs: Set<Int>) throws -> Int {
        try withDatabaseLock {
            let dirtyRemote = try withStatement("SELECT record_json FROM qsos WHERE wavelog_id IS NOT NULL AND is_dirty = 1 AND deleted_at IS NULL;") {
                try decodeRows($0)
            }
            var count = 0
            for local in dirtyRemote {
                guard let remoteID = local.wavelogID, !remoteIDs.contains(remoteID), try !hasConflict(localID: local.id) else { continue }
                var deletedRemote = local
                deletedRemote.isDirty = false
                deletedRemote.deletedAt = Date()
                try recordConflict(local: local, remote: deletedRemote)
                count += 1
            }
            return count
        }
    }

    public func softDelete(_ qso: QSO) throws {
        var deleted = qso
        deleted.deletedAt = Date()
        try save(deleted)
    }

    public func removeCleanRemoteRecords(notIn remoteIDs: Set<Int>) throws -> Int {
        try withDatabaseLock {
            let candidates = try withStatement("SELECT record_json FROM qsos WHERE wavelog_id IS NOT NULL AND is_dirty = 0 AND deleted_at IS NULL;") {
                try decodeRows($0)
            }
            var removed = 0
            for var qso in candidates {
                guard let remoteID = qso.wavelogID, !remoteIDs.contains(remoteID) else { continue }
                qso.deletedAt = Date()
                try save(qso, markDirty: false)
                removed += 1
            }
            return removed
        }
    }

    public func lookup(localID: UUID) throws -> QSO? {
        try withDatabaseLock {
            try lookup(sql: "SELECT record_json FROM qsos WHERE local_id = ? LIMIT 1;", value: localID.uuidString)
        }
    }

    func lookupSyncRemoteID(_ wavelogID: Int) throws -> QSO? {
        try lookup(wavelogID: wavelogID)
    }

    private func lookup(wavelogID: Int) throws -> QSO? {
        try withStatement("SELECT record_json FROM qsos WHERE wavelog_id = ? LIMIT 1;") { statement in
            sqlite3_bind_int64(statement, 1, Int64(wavelogID))
            return try decodeRows(statement).first
        }
    }

    private func lookupSemantic(_ qso: QSO, unlinkedOnly: Bool = false, excluding: (QSO) -> Bool = { _ in false }) throws -> QSO? {
        try withStatement("""
            SELECT record_json FROM qsos
            WHERE call = ? COLLATE NOCASE AND ABS(qso_start - ?) < 1
              AND band = ? COLLATE NOCASE
              AND UPPER(COALESCE(NULLIF(TRIM(json_extract(record_json, '$.submode')), ''), mode)) = ? COLLATE NOCASE
              AND (? = 0 OR wavelog_id IS NULL)
            ORDER BY rowid ASC;
            """) { statement in
                bind(qso.call, to: 1, in: statement)
                sqlite3_bind_double(statement, 2, qso.start.timeIntervalSince1970)
                bind(qso.band, to: 3, in: statement)
                bind((qso.submode.isEmpty ? qso.mode : qso.submode).uppercased(), to: 4, in: statement)
                sqlite3_bind_int(statement, 5, unlinkedOnly ? 1 : 0)
                var step = sqlite3_step(statement)
                while step == SQLITE_ROW {
                    guard let bytes = sqlite3_column_blob(statement, 0) else { throw LogbookDatabaseError.corruptRecord }
                    let value = try decoder.decode(QSO.self, from: Data(bytes: bytes, count: Int(sqlite3_column_bytes(statement, 0))))
                    if !excluding(value) { return value }
                    step = sqlite3_step(statement)
                }
                guard step == SQLITE_DONE else { throw error() }
                return nil
            }
    }

    private func lookup(sql: String, value: String) throws -> QSO? {
        try withStatement(sql) { statement in
            bind(value, to: 1, in: statement)
            return try decodeRows(statement).first
        }
    }

    private func migrate() throws {
        try execute("""
        CREATE TABLE IF NOT EXISTS qsos(
          local_id TEXT PRIMARY KEY,
          wavelog_id INTEGER UNIQUE,
          call TEXT NOT NULL,
          qso_start REAL NOT NULL,
          band TEXT NOT NULL,
          mode TEXT NOT NULL,
          frequency_hz INTEGER,
          is_dirty INTEGER NOT NULL DEFAULT 1,
          deleted_at REAL,
          updated_at REAL NOT NULL,
          record_json BLOB NOT NULL,
          baseline_json BLOB
        );
        CREATE INDEX IF NOT EXISTS idx_qsos_call ON qsos(call);
        CREATE INDEX IF NOT EXISTS idx_qsos_call_live_nocase
          ON qsos(call COLLATE NOCASE, qso_start DESC) WHERE deleted_at IS NULL;
        CREATE INDEX IF NOT EXISTS idx_qsos_semantic
          ON qsos(call COLLATE NOCASE, band COLLATE NOCASE, mode COLLATE NOCASE, qso_start);
        -- Keep the exact source JSON values in a covering read index. SQLite
        -- maintains these derived values for all writers; no QSO is rewritten.
        CREATE INDEX IF NOT EXISTS idx_qsos_metrics_live ON qsos(
          CAST(json_extract(record_json,'$.dxcc') AS INTEGER),
          json_extract(record_json,'$.dxcc'), json_extract(record_json,'$.cqZone'),
          json_extract(record_json,'$.state'), json_extract(record_json,'$.gridSquare'),
          json_extract(record_json,'$.submode'), json_extract(record_json,'$.qslReceived'),
          json_extract(record_json,'$.lotwReceived'), json_extract(record_json,'$.continent'),
          band, mode, qso_start
        ) WHERE deleted_at IS NULL;
        CREATE INDEX IF NOT EXISTS idx_qsos_start ON qsos(qso_start DESC);
        CREATE INDEX IF NOT EXISTS idx_qsos_dxcc_live
          ON qsos(CAST(json_extract(record_json,'$.dxcc') AS INTEGER), qso_start DESC)
          WHERE deleted_at IS NULL;
        CREATE INDEX IF NOT EXISTS idx_qsos_dirty ON qsos(is_dirty, updated_at);
        CREATE TABLE IF NOT EXISTS xlog_qso_revision(
          singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
          revision INTEGER NOT NULL
        );
        INSERT OR IGNORE INTO xlog_qso_revision(singleton, revision) VALUES(1, 0);
        CREATE TABLE IF NOT EXISTS xlog_aggregate_cache(
          cache_key TEXT PRIMARY KEY,
          revision INTEGER NOT NULL,
          payload BLOB NOT NULL
        );
        CREATE TRIGGER IF NOT EXISTS xlog_qso_revision_insert AFTER INSERT ON qsos BEGIN
          UPDATE xlog_qso_revision SET revision = revision + 1 WHERE singleton = 1;
        END;
        CREATE TRIGGER IF NOT EXISTS xlog_qso_revision_update AFTER UPDATE ON qsos BEGIN
          UPDATE xlog_qso_revision SET revision = revision + 1 WHERE singleton = 1;
        END;
        CREATE TRIGGER IF NOT EXISTS xlog_qso_revision_delete AFTER DELETE ON qsos BEGIN
          UPDATE xlog_qso_revision SET revision = revision + 1 WHERE singleton = 1;
        END;
        CREATE TABLE IF NOT EXISTS sync_conflicts(
          conflict_id TEXT PRIMARY KEY,
          local_id TEXT NOT NULL,
          detected_at REAL NOT NULL,
          conflict_json BLOB NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_conflicts_detected ON sync_conflicts(detected_at DESC);
        CREATE TABLE IF NOT EXISTS xlog_workspace_layout(
          singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
          payload BLOB NOT NULL
        );
        CREATE TABLE IF NOT EXISTS xlog_integration_settings(
          singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
          payload BLOB NOT NULL
        );
        CREATE TABLE IF NOT EXISTS xlog_settings_receipts(
          operation_id TEXT PRIMARY KEY,
          payload BLOB NOT NULL
        );
        CREATE TABLE IF NOT EXISTS xlog_sync_mutation_owner(
          singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
          payload BLOB NOT NULL
        );
        CREATE TABLE IF NOT EXISTS xlog_remote_backup_commands(
          singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
          payload BLOB NOT NULL
        );
        CREATE TABLE IF NOT EXISTS xlog_rotor_configuration(
          singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
          payload BLOB NOT NULL
        );
        CREATE TABLE IF NOT EXISTS xlog_rotor_configuration_receipts(
          operation_id TEXT PRIMARY KEY,
          payload BLOB NOT NULL
        );
        CREATE TABLE IF NOT EXISTS xlog_operator_draft(
          singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
          payload BLOB NOT NULL
        );
        CREATE TABLE IF NOT EXISTS xlog_operator_receipts(
          operation_id TEXT PRIMARY KEY,
          action TEXT NOT NULL CHECK(action IN ('replace','clear','save')),
          revision INTEGER NOT NULL,
          payload BLOB NOT NULL
        );
        CREATE TABLE IF NOT EXISTS xlog_spot_draft_receipts(
          operation_id TEXT PRIMARY KEY,
          payload BLOB NOT NULL,
          phase TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS xlog_spot_draft_abandoned(
          operation_id TEXT PRIMARY KEY,
          generation TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_operator_transient_receipts
          ON xlog_operator_receipts(revision) WHERE action <> 'save';
        CREATE TABLE IF NOT EXISTS xlog_contact_revisions(
          local_id TEXT PRIMARY KEY,
          revision INTEGER NOT NULL CHECK(revision >= 0 AND revision <= 9007199254740991)
        );
        CREATE TRIGGER IF NOT EXISTS xlog_contact_revision_insert AFTER INSERT ON qsos BEGIN
          INSERT INTO xlog_contact_revisions(local_id,revision) VALUES(NEW.local_id,1)
          ON CONFLICT(local_id) DO UPDATE SET revision=revision+1;
        END;
        CREATE TRIGGER IF NOT EXISTS xlog_contact_revision_update AFTER UPDATE ON qsos BEGIN
          INSERT INTO xlog_contact_revisions(local_id,revision) VALUES(NEW.local_id,1)
          ON CONFLICT(local_id) DO UPDATE SET revision=revision+1;
        END;
        CREATE TRIGGER IF NOT EXISTS xlog_contact_revision_delete AFTER DELETE ON qsos BEGIN
          INSERT INTO xlog_contact_revisions(local_id,revision) VALUES(OLD.local_id,1)
          ON CONFLICT(local_id) DO UPDATE SET revision=revision+1;
        END;
        CREATE TABLE IF NOT EXISTS xlog_contact_receipts(
          operation_id TEXT PRIMARY KEY,
          payload BLOB NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sync_outbox(
          local_id TEXT PRIMARY KEY,
          attempt_count INTEGER NOT NULL DEFAULT 0,
          last_attempt_at REAL,
          next_attempt_at REAL,
          last_error TEXT
        );
        CREATE TABLE IF NOT EXISTS xlog_online_log_deliveries(
          service TEXT NOT NULL,
          local_id TEXT NOT NULL,
          contact_revision INTEGER NOT NULL CHECK(contact_revision >= 0 AND contact_revision <= 9007199254740991),
          payload_sha256 TEXT NOT NULL,
          state TEXT NOT NULL CHECK(state IN ('dispatching','deferred','delivered','rejected','uncertain')),
          attempt_id TEXT NOT NULL,
          attempt_count INTEGER NOT NULL CHECK(attempt_count >= 1 AND attempt_count <= 3),
          last_attempt_at REAL NOT NULL,
          next_attempt_at REAL,
          remote_id TEXT,
          last_error_code TEXT,
          PRIMARY KEY(service,local_id,contact_revision)
        );
        CREATE INDEX IF NOT EXISTS idx_online_log_delivery_due
          ON xlog_online_log_deliveries(service,state,next_attempt_at);
        CREATE TABLE IF NOT EXISTS xlog_online_log_enrollments(
          service TEXT PRIMARY KEY,
          active INTEGER NOT NULL CHECK(active IN (0,1)),
          enabled_at REAL
        );
        CREATE TABLE IF NOT EXISTS xlog_online_log_candidates(
          service TEXT NOT NULL,
          local_id TEXT NOT NULL,
          enrolled_at REAL NOT NULL,
          PRIMARY KEY(service,local_id)
        );
        CREATE INDEX IF NOT EXISTS idx_online_log_candidates_due
          ON xlog_online_log_candidates(service,enrolled_at,local_id);
        """)
        try? execute("ALTER TABLE qsos ADD COLUMN baseline_json BLOB;")
    }

    private func recordConflict(local: QSO, remote: QSO) throws {
        if try hasConflict(localID: local.id) { return }
        let conflict = SyncConflict(localQSO: local, remoteQSO: remote)
        let data = try encoder.encode(conflict)
        try withStatement("INSERT OR REPLACE INTO sync_conflicts(conflict_id,local_id,detected_at,conflict_json) VALUES(?,?,?,?);") { statement in
            bind(conflict.id.uuidString, to: 1, in: statement)
            bind(local.id.uuidString, to: 2, in: statement)
            sqlite3_bind_double(statement, 3, conflict.detectedAt.timeIntervalSince1970)
            _ = data.withUnsafeBytes { bytes in sqlite3_bind_blob(statement, 4, bytes.baseAddress, Int32(bytes.count), Self.transient) }
            try stepDone(statement)
        }
    }

    private func remoteMatchesBaseline(_ remote: QSO, localID: UUID, invalidBaselineIsMismatch: Bool = false) throws -> Bool {
        try withStatement("SELECT baseline_json FROM qsos WHERE local_id = ? LIMIT 1;") { statement in
            bind(localID.uuidString, to: 1, in: statement)
            guard sqlite3_step(statement) == SQLITE_ROW, let bytes = sqlite3_column_blob(statement, 0) else { return false }
            let baseline = Data(bytes: bytes, count: Int(sqlite3_column_bytes(statement, 0)))
            if invalidBaselineIsMismatch {
                return (try? decoder.decode(SyncedQSOState.self, from: baseline)) == SyncedQSOState(remote)
            }
            return try decoder.decode(SyncedQSOState.self, from: baseline) == SyncedQSOState(remote)
        }
    }

    private func syncFingerprint(_ value: QSO) throws -> Data {
        try encoder.encode(SyncedQSOState(value))
    }

    private func normalizedForSave(_ value: QSO, markDirty: Bool, updatedAt: Date) -> QSO {
        var qso = value
        qso.call = qso.call.uppercased().trimmingCharacters(in: .whitespacesAndNewlines)
        qso.band = qso.band.lowercased()
        qso.mode = qso.mode.uppercased()
        qso.isDirty = markDirty
        qso.updatedAt = updatedAt
        return qso
    }

    private func mergeRemoteFields(_ remote: QSO, preserving local: QSO) -> QSO {
        var value = remote
        value.id = local.id
        value.end = local.end
        if value.country.isEmpty { value.country = local.country }
        if value.dxcc == nil { value.dxcc = local.dxcc }
        if value.continent.isEmpty { value.continent = local.continent }
        value.sig = local.sig
        value.sigInfo = local.sigInfo
        value.dok = local.dok
        value.stationLocation = local.stationLocation
        value.radio = local.radio
        value.operatorCall = local.operatorCall
        value.myCall = local.myCall
        value.myGrid = local.myGrid
        value.antennaPath = local.antennaPath
        value.email = local.email
        if value.qslSent.isEmpty { value.qslSent = local.qslSent }
        if value.qslReceived.isEmpty { value.qslReceived = local.qslReceived }
        if value.qslMethod.isEmpty { value.qslMethod = local.qslMethod }
        value.qslMessage = local.qslMessage
        if value.lotwSent.isEmpty { value.lotwSent = local.lotwSent }
        if value.lotwReceived.isEmpty { value.lotwReceived = local.lotwReceived }
        value.extraFields = local.extraFields.merging(remote.extraFields) { _, remoteValue in remoteValue }
        value.adifFieldMetadata = local.adifFieldMetadata ?? remote.adifFieldMetadata
        return value
    }

    private func decodeRows(_ statement: OpaquePointer?) throws -> [QSO] {
        try decodeRows(statement, as: QSO.self)
    }

    private func decodeRows<T: Decodable>(_ statement: OpaquePointer?, as type: T.Type) throws -> [T] {
        var values: [T] = []
        var step = sqlite3_step(statement)
        while step == SQLITE_ROW {
            guard let bytes = sqlite3_column_blob(statement, 0) else { throw LogbookDatabaseError.corruptRecord }
            let count = Int(sqlite3_column_bytes(statement, 0))
            values.append(try decoder.decode(type, from: Data(bytes: bytes, count: count)))
            step = sqlite3_step(statement)
        }
        guard step == SQLITE_DONE else { throw error() }
        return values
    }

    private func execute(_ sql: String) throws {
        guard sqlite3_exec(handle, sql, nil, nil, nil) == SQLITE_OK else { throw error() }
    }

    private func withStatement<T>(_ sql: String, _ body: (OpaquePointer?) throws -> T) throws -> T {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(handle, sql, -1, &statement, nil) == SQLITE_OK else { throw error() }
        defer { sqlite3_finalize(statement) }
        return try body(statement)
    }

    private func stepDone(_ statement: OpaquePointer?) throws {
        guard sqlite3_step(statement) == SQLITE_DONE else { throw error() }
    }

    private func bind(_ value: String?, to index: Int32, in statement: OpaquePointer?) {
        guard let value else { sqlite3_bind_null(statement, index); return }
        sqlite3_bind_text(statement, index, value, -1, Self.transient)
    }

    private func bind(_ value: Int?, to index: Int32, in statement: OpaquePointer?) {
        guard let value else { sqlite3_bind_null(statement, index); return }
        sqlite3_bind_int64(statement, index, Int64(value))
    }

    private func bind(_ value: Int64?, to index: Int32, in statement: OpaquePointer?) {
        guard let value else { sqlite3_bind_null(statement, index); return }
        sqlite3_bind_int64(statement, index, value)
    }

    private func error() -> LogbookDatabaseError {
        .sqlite(handle.map { String(cString: sqlite3_errmsg($0)) } ?? "unknown error")
    }
}

private struct SyncedQSOState: Codable, Equatable {
    let wavelogID: Int?
    let call: String
    let start: Date
    let band: String
    let mode: String
    let submode: String
    let frequencyHz: Int64?
    let receiveFrequencyHz: Int64?
    let receiveBand: String
    let rstSent: String
    let rstReceived: String
    let name: String
    let gridSquare: String
    let cqZone: String
    let ituZone: String
    let state: String
    let county: String
    let qth: String
    let iota: String
    let sotaReference: String
    let potaReference: String
    let wwffReference: String
    let comment: String
    let notes: String
    let stationProfileID: Int?
    let txPower: String
    let propagationMode: String
    let qslVia: String

    init(_ value: QSO) {
        wavelogID = value.wavelogID
        call = value.call
        start = value.start
        band = value.band
        mode = value.mode
        submode = value.submode
        frequencyHz = value.frequencyHz
        receiveFrequencyHz = value.receiveFrequencyHz
        receiveBand = value.receiveBand
        rstSent = value.rstSent
        rstReceived = value.rstReceived
        name = value.name
        gridSquare = value.gridSquare
        cqZone = value.cqZone
        ituZone = value.ituZone
        state = value.state
        county = value.county
        qth = value.qth
        iota = value.iota
        sotaReference = value.sotaReference
        potaReference = value.potaReference
        wwffReference = value.wwffReference
        comment = value.comment
        notes = value.notes
        stationProfileID = value.stationProfileID
        txPower = value.txPower
        propagationMode = value.propagationMode
        qslVia = value.qslVia
    }
}

struct SyncDatabaseRun: Equatable, Sendable { let id: UUID }
struct SyncDeletionStep: Sendable { let cursor: Int64; let done: Bool; let conflicts: Int; let deleted: Int }
struct SyncPendingStep: Sendable { let cursor: Int64; let done: Bool; let rows: [QSO] }

/// Only admission state lives here; the existing NSRecursiveLock still owns
/// every database operation. Never hold this condition while waiting for it.
final class SyncDatabaseAdmission: @unchecked Sendable {
    private let condition = NSCondition()
    private let waitObserver: (@Sendable () -> Void)?
    private var foreground = 0
    private var background = false
    init(waitObserver: (@Sendable () -> Void)? = nil) { self.waitObserver = waitObserver }
    func beginForeground() { condition.lock(); foreground += 1; condition.broadcast(); condition.unlock() }
    // Internal deterministic test rendezvous; no IPC/public API or production
    // caller. A background step may observe a registered mutex waiter here.
    func waitForForegroundRegistrations(_ count: Int, until deadline: Date) -> Bool {
        condition.lock(); defer { condition.unlock() }
        while foreground < count {
            if !condition.wait(until: deadline) { return foreground >= count }
        }
        return true
    }
    func endForeground() {
        condition.lock(); foreground -= 1; condition.broadcast(); condition.unlock()
    }
    func beginBackground() throws {
        condition.lock(); defer { condition.unlock() }
        while foreground > 0 || background {
            try Task.checkCancellation()
            waitObserver?() // Nonblocking test rendezvous; absent in production.
            // Cancellable wait, not a CPU spin or a scheduling-speed assertion.
            _ = condition.wait(until: Date().addingTimeInterval(0.05))
        }
        try Task.checkCancellation(); background = true
    }
    func endBackground() {
        condition.lock(); background = false; condition.broadcast(); condition.unlock()
    }
}

private extension NSRecursiveLock {
    func withLock<T>(_ body: () throws -> T) rethrows -> T {
        lock(); defer { unlock() }
        return try body()
    }
}

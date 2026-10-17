import Foundation
import Dispatch
import CSQLitePrototype
#if canImport(Darwin)
import Darwin
#elseif canImport(Glibc)
import Glibc
#elseif canImport(WinSDK)
import WinSDK
#endif

public enum ContestDatabaseSnapshotError: Error, Equatable, Sendable {
    case invalidURL
    case invalidConfiguration(String)
    case unsafePath(String)
    case sourceUnavailable
    case destinationExists
    case deadlineExceeded
    case cancelled
    case busyRetryLimit
    case unsupportedSchema(Int)
    case invalidSchema(String)
    case integrityFailure(String)
    case sqlite(String)
    case atomicPublicationUnsupported
    case publicationFailed(String)
}

public struct ContestDatabaseSessionInventory: Codable, Hashable, Sendable {
    public let sessionID: UUID
    public let workspaceGeneration: UUID
    public let revision: UInt64
    public let draftCount: Int
    public let operationCount: Int
    public let serialCounterCount: Int
    public let reservationCount: Int
    public let activeReservationCount: Int
    public let qsoCount: Int
    public let liveQSOCount: Int
    public let deletedQSOCount: Int
    public let auditCount: Int

    public init(sessionID: UUID, workspaceGeneration: UUID, revision: UInt64,
                draftCount: Int, operationCount: Int, serialCounterCount: Int,
                reservationCount: Int, activeReservationCount: Int,
                qsoCount: Int, liveQSOCount: Int, deletedQSOCount: Int, auditCount: Int) {
        self.sessionID = sessionID
        self.workspaceGeneration = workspaceGeneration
        self.revision = revision
        self.draftCount = draftCount
        self.operationCount = operationCount
        self.serialCounterCount = serialCounterCount
        self.reservationCount = reservationCount
        self.activeReservationCount = activeReservationCount
        self.qsoCount = qsoCount
        self.liveQSOCount = liveQSOCount
        self.deletedQSOCount = deletedQSOCount
        self.auditCount = auditCount
    }
}

public struct ContestDatabaseSnapshotMetadata: Codable, Hashable, Sendable {
    public let schemaVersion: Int
    public let databaseFileName: String
    public let sessions: [ContestDatabaseSessionInventory]
    public let tableCounts: [String: Int]

    public init(schemaVersion: Int, databaseFileName: String,
                sessions: [ContestDatabaseSessionInventory], tableCounts: [String: Int]) {
        self.schemaVersion = schemaVersion
        self.databaseFileName = databaseFileName
        self.sessions = sessions
        self.tableCounts = tableCounts
    }
}

public final class ContestDatabaseSnapshotter: @unchecked Sendable {
    public static let databaseFileName = "contest.sqlite"

    private let timeout: TimeInterval
    private let pagesPerStep: Int32
    private let busyRetryLimit: Int
    private let busySleepMilliseconds: Int32
    private let hooks: Hooks

    struct Hooks: Sendable {
        var afterSourcePinned: @Sendable () throws -> Void = {}
        var backupStepResult: @Sendable (Int) -> Int32? = { _ in nil }
        var afterBackupStep: @Sendable (Int32) throws -> Void = { _ in }
        var beforeVerification: @Sendable () throws -> Void = {}
        var afterInspectionPinned: @Sendable () throws -> Void = {}
        var verificationProbeSQL: String?
        var beforePublication: @Sendable () throws -> Void = {}
        var afterPublication: @Sendable () throws -> Void = {}
    }

    public init(timeout: TimeInterval = 15, pagesPerStep: Int32 = 128,
                busyRetryLimit: Int = 32, busySleepMilliseconds: Int32 = 10) {
        self.timeout = timeout
        self.pagesPerStep = pagesPerStep
        self.busyRetryLimit = busyRetryLimit
        self.busySleepMilliseconds = busySleepMilliseconds
        self.hooks = Hooks()
    }

    init(timeout: TimeInterval = 15, pagesPerStep: Int32 = 128,
         busyRetryLimit: Int = 32, busySleepMilliseconds: Int32 = 10,
         hooks: Hooks) {
        self.timeout = timeout
        self.pagesPerStep = pagesPerStep
        self.busyRetryLimit = busyRetryLimit
        self.busySleepMilliseconds = busySleepMilliseconds
        self.hooks = hooks
    }

    public func createSnapshot(sourceDatabaseURL: URL,
                               destinationDirectoryURL: URL) async throws -> ContestDatabaseSnapshotMetadata {
        try validateConfiguration()
        let operation = try OperationState(timeout: timeout)
        if Task.isCancelled { operation.cancel() }
        return try await withTaskCancellationHandler(operation: {
            try createSnapshotSync(sourceDatabaseURL: sourceDatabaseURL,
                                   destinationDirectoryURL: destinationDirectoryURL,
                                   operation: operation)
        }, onCancel: { operation.cancel() })
    }

    public func inspectSnapshot(at destinationDirectoryURL: URL) async throws -> ContestDatabaseSnapshotMetadata {
        try validateConfiguration()
        let operation = try OperationState(timeout: timeout)
        if Task.isCancelled { operation.cancel() }
        return try await withTaskCancellationHandler(operation: {
            try operation.check()
            let directory = try Self.validatedAbsentOrExistingDirectoryURL(destinationDirectoryURL, mustBeAbsent: false)
            let database = try Self.validatedSource(directory.appendingPathComponent(Self.databaseFileName, isDirectory: false))
            let handle = try Self.openValidatedReadOnly(database)
            defer { sqlite3_close_v2(handle) }
            return try Self.inspect(handle, operation: operation, beforeVerification: hooks.beforeVerification,
                                    afterPinned: hooks.afterInspectionPinned, verificationProbeSQL: hooks.verificationProbeSQL)
        }, onCancel: { operation.cancel() })
    }

    private func createSnapshotSync(sourceDatabaseURL: URL, destinationDirectoryURL: URL,
                                    operation: OperationState) throws -> ContestDatabaseSnapshotMetadata {
        try operation.check()
        let source = try Self.validatedSource(sourceDatabaseURL)
        let destination = try Self.validatedAbsentOrExistingDirectoryURL(destinationDirectoryURL, mustBeAbsent: true)
        guard source.path != destination.path else { throw ContestDatabaseSnapshotError.unsafePath(destination.path) }

        let parent = destination.deletingLastPathComponent()
        let stagingName = ".contest-snapshot-\(UUID().uuidString.lowercased())"
        let pinnedParent = try PinnedSnapshotParent(parent: parent, stagingName: stagingName,
                                                    destinationName: destination.lastPathComponent)
        let staging = pinnedParent.stagingURL
        var published = false
        defer { if !published { pinnedParent.removeOwnedStaging(databaseFileName: Self.databaseFileName) } }
        let stagedDatabase = staging.appendingPathComponent(Self.databaseFileName, isDirectory: false)

        var destinationHandle: OpaquePointer? = try Self.open(stagedDatabase,
            flags: SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX)
        defer { if let destinationHandle { sqlite3_close_v2(destinationHandle) } }
        try pinnedParent.pinDatabase(databaseFileName: Self.databaseFileName)
        try copyDatabase(from: source, to: destinationHandle!, operation: operation)
        let metadata = try Self.inspect(destinationHandle!, operation: operation,
                                        beforeVerification: hooks.beforeVerification,
                                        afterPinned: hooks.afterInspectionPinned,
                                        verificationProbeSQL: hooks.verificationProbeSQL)
        guard sqlite3_close_v2(destinationHandle!) == SQLITE_OK else {
            throw Self.sqliteError(destinationHandle!)
        }
        destinationHandle = nil
        try operation.check()
        try hooks.beforePublication()
        try operation.check()
        try pinnedParent.publishNoReplace()
        published = true
        try hooks.afterPublication()
        try pinnedParent.verifyPublishedLocation()
        return metadata
    }

    private func validateConfiguration() throws {
        guard pagesPerStep > 0, pagesPerStep <= 4_096 else {
            throw ContestDatabaseSnapshotError.invalidConfiguration("pagesPerStep must be in 1...4096")
        }
        guard busyRetryLimit >= 0, busyRetryLimit <= 100_000 else {
            throw ContestDatabaseSnapshotError.invalidConfiguration("busyRetryLimit must be in 0...100000")
        }
        guard busySleepMilliseconds >= 0, busySleepMilliseconds <= 1_000 else {
            throw ContestDatabaseSnapshotError.invalidConfiguration("busySleepMilliseconds must be in 0...1000")
        }
    }

    private func copyDatabase(from sourceURL: URL, to destination: OpaquePointer,
                              operation: OperationState) throws {
        guard try Self.scalarText("PRAGMA journal_mode=MEMORY", on: destination, operation: operation).lowercased() == "memory" else {
            throw ContestDatabaseSnapshotError.invalidSchema("staging journal mode is not MEMORY")
        }
        let source = try Self.openValidatedReadOnly(sourceURL)
        defer { sqlite3_close_v2(source) }
        Self.installProgressHandler(on: source, operation: operation)
        defer { Self.removeProgressHandler(from: source, operation: operation) }
        try Self.execute("PRAGMA query_only=ON", on: source, operation: operation)
        try Self.execute("BEGIN", on: source, operation: operation)
        var sourceTransaction = true
        defer { if sourceTransaction { _ = sqlite3_exec(source, "ROLLBACK", nil, nil, nil) } }
        _ = try Self.scalarInt("PRAGMA user_version", on: source, operation: operation)
        try hooks.afterSourcePinned()
        try operation.check()
        Self.installProgressHandler(on: destination, operation: operation)
        defer { Self.removeProgressHandler(from: destination, operation: operation) }
        guard let backup = sqlite3_backup_init(destination, "main", source, "main") else {
            throw Self.sqliteError(destination)
        }
        var backupFinished = false
        defer { if !backupFinished { _ = sqlite3_backup_finish(backup) } }
        var busyRetries = 0
        var backupAttempts = 0
        while true {
            try operation.check()
            backupAttempts += 1
            let result = hooks.backupStepResult(backupAttempts) ?? sqlite3_backup_step(backup, pagesPerStep)
            try hooks.afterBackupStep(result)
            try operation.check()
            switch result {
            case SQLITE_DONE:
                let finish = sqlite3_backup_finish(backup)
                backupFinished = true
                guard finish == SQLITE_OK else { throw Self.sqliteError(destination) }
                try Self.execute("COMMIT", on: source, operation: operation)
                sourceTransaction = false
                try Self.execute("PRAGMA journal_mode=DELETE", on: destination, operation: operation)
                guard try Self.scalarText("PRAGMA journal_mode", on: destination, operation: operation).lowercased() == "delete" else {
                    throw ContestDatabaseSnapshotError.invalidSchema("snapshot journal mode is not DELETE")
                }
                return
            case SQLITE_OK:
                busyRetries = 0
            case SQLITE_BUSY, SQLITE_LOCKED:
                busyRetries += 1
                guard busyRetries <= busyRetryLimit else { throw ContestDatabaseSnapshotError.busyRetryLimit }
                try operation.interruptibleSleep(milliseconds: busySleepMilliseconds)
            default:
                try operation.check()
                throw Self.sqliteError(destination)
            }
        }
    }

    private static func inspect(_ database: OpaquePointer, operation: OperationState,
                                beforeVerification: @Sendable () throws -> Void,
                                afterPinned: @Sendable () throws -> Void,
                                verificationProbeSQL: String?) throws -> ContestDatabaseSnapshotMetadata {
        try operation.check()
        try beforeVerification()
        try operation.check()
        installProgressHandler(on: database, operation: operation)
        defer { removeProgressHandler(from: database, operation: operation) }
        try execute("PRAGMA query_only=ON", on: database, operation: operation)
        try execute("BEGIN", on: database, operation: operation)
        var transactionOpen = true
        defer { if transactionOpen { _ = sqlite3_exec(database, "ROLLBACK", nil, nil, nil) } }
        _ = try scalarInt("PRAGMA schema_version", on: database, operation: operation)
        try afterPinned()
        try operation.check()
        if let probe = verificationProbeSQL {
            _ = try Self.scalarInt(probe, on: database, operation: operation)
        }
        guard try scalarText("PRAGMA integrity_check", on: database, operation: operation) == "ok" else {
            throw ContestDatabaseSnapshotError.integrityFailure("SQLite integrity_check did not return ok")
        }
        guard try queryHasNoRows("PRAGMA foreign_key_check", on: database, operation: operation) else {
            throw ContestDatabaseSnapshotError.integrityFailure("SQLite foreign_key_check reported violations")
        }
        let version = try scalarInt("PRAGMA user_version", on: database, operation: operation)
        guard version == 2 else { throw ContestDatabaseSnapshotError.unsupportedSchema(version) }
        try validateSchema(on: database, operation: operation)

        let tables = expectedSchema.keys.sorted()
        var counts: [String: Int] = [:]
        for table in tables { counts[table] = try scalarInt("SELECT COUNT(*) FROM \(table)", on: database, operation: operation) }
        var sessions: [ContestDatabaseSessionInventory] = []
        try rows("""
            SELECT s.id, s.generation, s.revision,
              (SELECT COUNT(*) FROM drafts d WHERE d.session_id=s.id),
              (SELECT COUNT(*) FROM operations o WHERE o.session_id=s.id),
              (SELECT COUNT(*) FROM serial_counters c WHERE c.session_id=s.id),
              (SELECT COUNT(*) FROM serial_reservations r WHERE r.session_id=s.id),
              (SELECT COUNT(*) FROM serial_reservations r WHERE r.session_id=s.id AND r.state IN ('reserved','transmitted','uncertain')),
              (SELECT COUNT(*) FROM qsos q WHERE q.session_id=s.id),
              (SELECT COUNT(*) FROM qsos q WHERE q.session_id=s.id AND q.is_deleted=0),
              (SELECT COUNT(*) FROM qsos q WHERE q.session_id=s.id AND q.is_deleted=1),
              (SELECT COUNT(*) FROM qso_audit a WHERE a.session_id=s.id)
            FROM sessions s ORDER BY s.id
            """, on: database, operation: operation) { statement in
                guard let sessionText = textColumn(statement, 0), let sessionID = UUID(uuidString: sessionText),
                      let generationText = textColumn(statement, 1), let generation = UUID(uuidString: generationText) else {
                    throw ContestDatabaseSnapshotError.invalidSchema("invalid session identity")
                }
                let rawRevision = sqlite3_column_int64(statement, 2)
                guard rawRevision >= 0 else { throw ContestDatabaseSnapshotError.invalidSchema("negative session revision") }
                sessions.append(ContestDatabaseSessionInventory(
                    sessionID: sessionID, workspaceGeneration: generation, revision: UInt64(rawRevision),
                    draftCount: Int(sqlite3_column_int64(statement, 3)),
                    operationCount: Int(sqlite3_column_int64(statement, 4)),
                    serialCounterCount: Int(sqlite3_column_int64(statement, 5)),
                    reservationCount: Int(sqlite3_column_int64(statement, 6)),
                    activeReservationCount: Int(sqlite3_column_int64(statement, 7)),
                    qsoCount: Int(sqlite3_column_int64(statement, 8)),
                    liveQSOCount: Int(sqlite3_column_int64(statement, 9)),
                    deletedQSOCount: Int(sqlite3_column_int64(statement, 10)),
                    auditCount: Int(sqlite3_column_int64(statement, 11))))
            }
        let metadata = ContestDatabaseSnapshotMetadata(schemaVersion: version, databaseFileName: databaseFileName,
                                                       sessions: sessions, tableCounts: counts)
        try execute("COMMIT", on: database, operation: operation)
        transactionOpen = false
        return metadata
    }

    private struct ExpectedColumn: Equatable {
        let name: String, type: String
        let notNull: Int32, primaryKey: Int32
        let defaultValue: String?
    }

    private struct ForeignKeyShape: Hashable {
        let id: Int32, sequence: Int32
        let table: String, from: String, to: String
        let onUpdate: String, onDelete: String, match: String
    }

    private struct IndexColumnShape: Hashable {
        let name: String
        let descending: Bool
        let collation: String
    }

    private struct IndexShape: Hashable {
        let origin: String
        let unique: Bool
        let partial: Bool
        let columns: [IndexColumnShape]
    }

    private static let expectedSchema: [String: [ExpectedColumn]] = [
        "sessions": [col("id","TEXT",0,1), col("generation","TEXT",1,0), col("revision","INTEGER",1,0), col("snapshot","BLOB",1,0), col("metadata","BLOB",1,0), col("created_at","REAL",1,0)],
        "drafts": [col("id","TEXT",0,1), col("session_id","TEXT",1,0), col("revision","INTEGER",1,0), col("snapshot","BLOB",1,0), col("updated_at","REAL",1,0)],
        "operations": [col("session_id","TEXT",1,1), col("request_id","TEXT",1,2), col("payload_digest","TEXT",1,0), col("canonical_payload","BLOB",1,0), col("receipt","BLOB",1,0), col("result","BLOB",1,0), col("committed_revision","INTEGER",1,0)],
        "serial_counters": [col("session_id","TEXT",1,1), col("scope","TEXT",1,2), col("scope_value","TEXT",1,3), col("next_number","INTEGER",1,0)],
        "serial_reservations": [col("id","TEXT",0,1), col("session_id","TEXT",1,0), col("draft_id","TEXT",1,0), col("scope","TEXT",1,0), col("scope_value","TEXT",1,0), col("number","INTEGER",1,0), col("state","TEXT",1,0), col("snapshot","BLOB",1,0)],
        "qsos": [col("id","TEXT",0,1), col("session_id","TEXT",1,0), col("timestamp","REAL",1,0), col("snapshot","BLOB",1,0), col("is_deleted","INTEGER",1,0,"0"), col("deleted_at","REAL",0,0)],
        "qso_audit": [col("session_id","TEXT",1,1), col("qso_id","TEXT",1,0), col("operation","TEXT",1,0), col("before_snapshot","BLOB",1,0), col("after_snapshot","BLOB",1,0), col("reason","TEXT",1,0), col("request_id","TEXT",1,2), col("operation_timestamp","REAL",1,0), col("committed_at","REAL",1,0), col("committed_revision","INTEGER",1,0), col("record","BLOB",1,0)],
    ]

    private static let expectedForeignKeys: [String: Set<ForeignKeyShape>] = [
        "sessions": [],
        "drafts": [fk(0, "sessions", "session_id", "id", onDelete: "CASCADE")],
        "operations": [fk(0, "sessions", "session_id", "id", onDelete: "CASCADE")],
        "serial_counters": [fk(0, "sessions", "session_id", "id", onDelete: "CASCADE")],
        "serial_reservations": [
            fk(0, "drafts", "draft_id", "id"),
            fk(1, "sessions", "session_id", "id", onDelete: "CASCADE"),
        ],
        "qsos": [fk(0, "sessions", "session_id", "id", onDelete: "CASCADE")],
        "qso_audit": [
            fk(0, "qsos", "qso_id", "id"),
            fk(1, "sessions", "session_id", "id", onDelete: "CASCADE"),
        ],
    ]

    private static let expectedIndexes: [String: Set<IndexShape>] = [
        "sessions": [index("pk", true, ["id"])],
        "drafts": [index("pk", true, ["id"]), index("u", true, ["session_id", "id"])],
        "operations": [index("pk", true, ["session_id", "request_id"])],
        "serial_counters": [index("pk", true, ["session_id", "scope", "scope_value"])],
        "serial_reservations": [index("pk", true, ["id"]),
                                 index("u", true, ["session_id", "scope", "scope_value", "number"])],
        "qsos": [index("pk", true, ["id"]),
                  index("c", false, ["session_id", "is_deleted", "timestamp", "id"])],
        "qso_audit": [index("pk", true, ["session_id", "request_id"]),
                       index("c", false, ["session_id", "qso_id", "committed_revision", "request_id"])],
    ]

    private static let expectedExplicitSchemaObjects: Set<String> = [
        "index|qso_audit_target_order|qso_audit",
        "index|qsos_session_order|qsos",
    ]

    private static func col(_ name: String, _ type: String, _ notNull: Int32, _ primaryKey: Int32,
                            _ defaultValue: String? = nil) -> ExpectedColumn {
        ExpectedColumn(name: name, type: type, notNull: notNull, primaryKey: primaryKey,
                       defaultValue: defaultValue)
    }

    private static func fk(_ id: Int32, _ table: String, _ from: String, _ to: String,
                           onUpdate: String = "NO ACTION", onDelete: String = "NO ACTION",
                           match: String = "NONE") -> ForeignKeyShape {
        ForeignKeyShape(id: id, sequence: 0, table: table, from: from, to: to,
                        onUpdate: onUpdate, onDelete: onDelete, match: match)
    }

    private static func index(_ origin: String, _ unique: Bool, _ names: [String]) -> IndexShape {
        IndexShape(origin: origin, unique: unique, partial: false,
                   columns: names.map { IndexColumnShape(name: $0, descending: false, collation: "BINARY") })
    }

    private static func validateSchema(on database: OpaquePointer, operation: OperationState) throws {
        var explicitObjects = Set<String>()
        try rows("""
            SELECT type, name, tbl_name FROM sqlite_schema
            WHERE name NOT LIKE 'sqlite_%'
              AND (type IN ('trigger','view') OR (type='index' AND sql IS NOT NULL))
            """, on: database, operation: operation) { statement in
                guard let type = textColumn(statement, 0), let name = textColumn(statement, 1),
                      let table = textColumn(statement, 2) else {
                    throw ContestDatabaseSnapshotError.invalidSchema("invalid schema object metadata")
                }
                explicitObjects.insert("\(type)|\(name)|\(table)")
            }
        guard explicitObjects == expectedExplicitSchemaObjects else {
            throw ContestDatabaseSnapshotError.invalidSchema("executable schema object set mismatch")
        }
        var tableNames: [String] = []
        try rows("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
                 on: database, operation: operation) { statement in
            guard let name = textColumn(statement, 0) else { throw ContestDatabaseSnapshotError.invalidSchema("invalid table name") }
            tableNames.append(name)
        }
        guard tableNames == expectedSchema.keys.sorted() else {
            throw ContestDatabaseSnapshotError.invalidSchema("contest table set mismatch")
        }
        for table in tableNames {
            var columns: [ExpectedColumn] = []
            try rows("PRAGMA table_info(\(table))", on: database, operation: operation) { statement in
                guard let name = textColumn(statement, 1), let type = textColumn(statement, 2) else {
                    throw ContestDatabaseSnapshotError.invalidSchema("invalid column metadata")
                }
                columns.append(ExpectedColumn(name: name, type: type.uppercased(),
                                              notNull: sqlite3_column_int(statement, 3),
                                               primaryKey: sqlite3_column_int(statement, 5),
                                               defaultValue: textColumn(statement, 4)))
            }
            guard columns == expectedSchema[table] else {
                throw ContestDatabaseSnapshotError.invalidSchema("table shape mismatch: \(table)")
            }
            var foreignKeys = Set<ForeignKeyShape>()
            try rows("PRAGMA foreign_key_list(\(table))", on: database, operation: operation) { statement in
                guard let target = textColumn(statement, 2), let from = textColumn(statement, 3),
                      let to = textColumn(statement, 4), let onUpdate = textColumn(statement, 5),
                      let onDelete = textColumn(statement, 6), let match = textColumn(statement, 7) else {
                    throw ContestDatabaseSnapshotError.invalidSchema("invalid foreign key metadata: \(table)")
                }
                foreignKeys.insert(ForeignKeyShape(id: sqlite3_column_int(statement, 0),
                                                   sequence: sqlite3_column_int(statement, 1),
                                                   table: target, from: from, to: to,
                                                   onUpdate: onUpdate.uppercased(), onDelete: onDelete.uppercased(),
                                                   match: match.uppercased()))
            }
            guard foreignKeys == expectedForeignKeys[table] else {
                throw ContestDatabaseSnapshotError.invalidSchema("foreign key shape mismatch: \(table)")
            }
            var indexes = Set<IndexShape>()
            try rows("PRAGMA index_list(\(table))", on: database, operation: operation) { statement in
                guard let name = textColumn(statement, 1), let origin = textColumn(statement, 3) else {
                    throw ContestDatabaseSnapshotError.invalidSchema("invalid index metadata: \(table)")
                }
                var indexColumns: [IndexColumnShape] = []
                try rows("PRAGMA index_xinfo('\(name)')", on: database, operation: operation) { indexStatement in
                    guard sqlite3_column_int(indexStatement, 5) == 0 || textColumn(indexStatement, 2) != nil else {
                        throw ContestDatabaseSnapshotError.invalidSchema("invalid index column: \(table)")
                    }
                    guard sqlite3_column_int(indexStatement, 5) != 0 else { return }
                    guard let column = textColumn(indexStatement, 2), let collation = textColumn(indexStatement, 4) else {
                        throw ContestDatabaseSnapshotError.invalidSchema("invalid index key column: \(table)")
                    }
                    indexColumns.append(IndexColumnShape(name: column,
                                                         descending: sqlite3_column_int(indexStatement, 3) != 0,
                                                         collation: collation.uppercased()))
                }
                indexes.insert(IndexShape(origin: origin, unique: sqlite3_column_int(statement, 2) != 0,
                                          partial: sqlite3_column_int(statement, 4) != 0,
                                          columns: indexColumns))
            }
            guard indexes == expectedIndexes[table] else {
                throw ContestDatabaseSnapshotError.invalidSchema("index shape mismatch: \(table)")
            }
        }
    }

    private static func validatedSource(_ url: URL) throws -> URL {
        let value = try validatedFileURL(url)
        try validateNoSymlinkAncestors(value, finalType: .typeRegular)
        guard FileManager.default.isReadableFile(atPath: value.path) else { throw ContestDatabaseSnapshotError.sourceUnavailable }
        if let links = try FileManager.default.attributesOfItem(atPath: value.path)[.referenceCount] as? NSNumber,
           links.intValue != 1 {
            throw ContestDatabaseSnapshotError.unsafePath(value.path)
        }
        return value
    }

    private static func validatedAbsentOrExistingDirectoryURL(_ url: URL, mustBeAbsent: Bool) throws -> URL {
        let value = try validatedFileURL(url)
        let fileManager = FileManager.default
        if fileManager.fileExists(atPath: value.path) {
            if mustBeAbsent { throw ContestDatabaseSnapshotError.destinationExists }
            try validateNoSymlinkAncestors(value, finalType: .typeDirectory)
        } else {
            let parent = value.deletingLastPathComponent()
            try validateNoSymlinkAncestors(parent, finalType: .typeDirectory)
            guard parent.path != value.path else { throw ContestDatabaseSnapshotError.invalidURL }
        }
        return value
    }

    private static func validatedFileURL(_ url: URL) throws -> URL {
        guard url.isFileURL, !url.path.isEmpty, url.lastPathComponent != ".", url.lastPathComponent != ".." else {
            throw ContestDatabaseSnapshotError.invalidURL
        }
        let standardized = canonicalSystemPath(url.standardizedFileURL)
        return standardized
    }

    private static func canonicalSystemPath(_ url: URL) -> URL {
        #if os(macOS)
        // `/var` and `/tmp` are fixed operating-system aliases. Canonicalize only
        // these roots; arbitrary symlink ancestors remain forbidden below.
        for alias in ["/var/", "/tmp/"] where url.path.hasPrefix(alias) {
            return URL(fileURLWithPath: "/private" + url.path)
        }
        #endif
        return url
    }

    private static func validateNoSymlinkAncestors(_ url: URL, finalType: FileAttributeType) throws {
        let fileManager = FileManager.default
        var component = URL(fileURLWithPath: url.pathComponents.first ?? "/", isDirectory: true)
        for part in url.pathComponents.dropFirst() {
            component.appendPathComponent(part)
            let attributes: [FileAttributeKey: Any]
            do { attributes = try fileManager.attributesOfItem(atPath: component.path) }
            catch { throw ContestDatabaseSnapshotError.unsafePath(component.path) }
            let type = attributes[.type] as? FileAttributeType
            guard type != .typeSymbolicLink else { throw ContestDatabaseSnapshotError.unsafePath(component.path) }
            guard component.path == url.path ? type == finalType : type == .typeDirectory else {
                throw ContestDatabaseSnapshotError.unsafePath(component.path)
            }
        }
    }

    private static func open(_ url: URL, flags: Int32) throws -> OpaquePointer {
        var database: OpaquePointer?
        let result = sqlite3_open_v2(url.path, &database, flags | SQLITE_OPEN_NOFOLLOW, nil)
        guard result == SQLITE_OK, let database else {
            let message = database.map { String(cString: sqlite3_errmsg($0)) } ?? "SQLite open failed"
            sqlite3_close(database)
            throw ContestDatabaseSnapshotError.sqlite(message)
        }
        return database
    }

    private static func openValidatedReadOnly(_ url: URL) throws -> OpaquePointer {
        let validated = try validatedSource(url)
        #if canImport(Darwin) || canImport(Glibc)
        let identity = try pathIdentity(validated)
        #endif
        let database = try open(validated, flags: SQLITE_OPEN_READONLY | SQLITE_OPEN_FULLMUTEX)
        do {
            let afterOpen = try validatedSource(validated)
            #if canImport(Darwin) || canImport(Glibc)
            guard try pathIdentity(afterOpen) == identity else {
                throw ContestDatabaseSnapshotError.unsafePath(validated.path)
            }
            #endif
            return database
        } catch {
            sqlite3_close_v2(database)
            throw error
        }
    }

    #if canImport(Darwin) || canImport(Glibc)
    private struct PathIdentity: Equatable {
        let device: dev_t
        let inode: ino_t
    }

    private static func pathIdentity(_ url: URL) throws -> PathIdentity {
        var value = stat()
        guard url.path.withCString({ lstat($0, &value) }) == 0,
              (value.st_mode & S_IFMT) == S_IFREG,
              value.st_nlink == 1 else {
            throw ContestDatabaseSnapshotError.unsafePath(url.path)
        }
        return PathIdentity(device: value.st_dev, inode: value.st_ino)
    }
    #endif

    private static func installProgressHandler(on database: OpaquePointer, operation: OperationState) {
        sqlite3_progress_handler(database, 256, { pointer in
            guard let pointer else { return 1 }
            return Unmanaged<OperationState>.fromOpaque(pointer).takeUnretainedValue().shouldAbort ? 1 : 0
        }, Unmanaged.passUnretained(operation).toOpaque())
    }

    private static func removeProgressHandler(from database: OpaquePointer, operation: OperationState) {
        sqlite3_progress_handler(database, 0, nil, nil)
        withExtendedLifetime(operation) {}
    }

    private static func execute(_ sql: String, on database: OpaquePointer, operation: OperationState) throws {
        try operation.check()
        let result = sqlite3_exec(database, sql, nil, nil, nil)
        if result == SQLITE_INTERRUPT { try operation.check() }
        guard result == SQLITE_OK else { throw sqliteError(database) }
    }

    private static func scalarInt(_ sql: String, on database: OpaquePointer, operation: OperationState) throws -> Int {
        var value: Int?
        try rows(sql, on: database, operation: operation) { value = Int(sqlite3_column_int64($0, 0)) }
        guard let value else { throw ContestDatabaseSnapshotError.invalidSchema("missing integer result") }
        return value
    }

    private static func scalarText(_ sql: String, on database: OpaquePointer, operation: OperationState) throws -> String {
        var value: String?
        try rows(sql, on: database, operation: operation) { value = textColumn($0, 0) }
        guard let value else { throw ContestDatabaseSnapshotError.invalidSchema("missing text result") }
        return value
    }

    private static func queryHasNoRows(_ sql: String, on database: OpaquePointer, operation: OperationState) throws -> Bool {
        var found = false
        try rows(sql, on: database, operation: operation) { _ in found = true }
        return !found
    }

    private static func rows(_ sql: String, on database: OpaquePointer, operation: OperationState,
                             body: (OpaquePointer) throws -> Void) throws {
        try operation.check()
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK, let statement else {
            throw ContestDatabaseSnapshotError.sqlite("\(sql): \(String(cString: sqlite3_errmsg(database)))")
        }
        defer { sqlite3_finalize(statement) }
        while true {
            try operation.check()
            switch sqlite3_step(statement) {
            case SQLITE_ROW: try body(statement)
            case SQLITE_DONE: return
            case SQLITE_INTERRUPT: try operation.check(); throw sqliteError(database)
            default: throw ContestDatabaseSnapshotError.sqlite("\(sql): \(String(cString: sqlite3_errmsg(database)))")
            }
        }
    }

    private static func textColumn(_ statement: OpaquePointer, _ index: Int32) -> String? {
        guard let value = sqlite3_column_text(statement, index) else { return nil }
        return String(cString: value)
    }

    private static func sqliteError(_ database: OpaquePointer) -> ContestDatabaseSnapshotError {
        .sqlite(String(cString: sqlite3_errmsg(database)))
    }
}

#if canImport(Darwin) || canImport(Glibc)
private final class PinnedSnapshotParent {
    private struct Identity: Equatable {
        let device: dev_t
        let inode: ino_t

        init(_ value: stat) {
            device = value.st_dev
            inode = value.st_ino
        }
    }

    let stagingURL: URL
    private let parentURL: URL
    private let stagingName: String
    private let destinationName: String
    private let parentDescriptor: Int32
    private let stagingDescriptor: Int32
    private let parentIdentity: Identity
    private let stagingIdentity: Identity
    private var databaseDescriptor: Int32?
    private var databaseIdentity: Identity?

    init(parent: URL, stagingName: String, destinationName: String) throws {
        self.parentURL = parent
        self.stagingName = stagingName
        self.destinationName = destinationName
        self.stagingURL = parent.appendingPathComponent(stagingName, isDirectory: true)

        let parentDescriptor = parent.path.withCString {
            open($0, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        }
        guard parentDescriptor >= 0 else {
            throw ContestDatabaseSnapshotError.unsafePath(parent.path)
        }
        var parentStatus = stat()
        guard fstat(parentDescriptor, &parentStatus) == 0, (parentStatus.st_mode & S_IFMT) == S_IFDIR else {
            close(parentDescriptor)
            throw ContestDatabaseSnapshotError.unsafePath(parent.path)
        }
        self.parentDescriptor = parentDescriptor
        self.parentIdentity = Identity(parentStatus)

        let created = stagingName.withCString { mkdirat(parentDescriptor, $0, mode_t(0o700)) }
        guard created == 0 else {
            let code = errno
            close(parentDescriptor)
            if code == EEXIST { throw ContestDatabaseSnapshotError.destinationExists }
            throw ContestDatabaseSnapshotError.publicationFailed(String(cString: strerror(code)))
        }
        let stagingDescriptor = stagingName.withCString {
            openat(parentDescriptor, $0, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        }
        guard stagingDescriptor >= 0 else {
            _ = stagingName.withCString { unlinkat(parentDescriptor, $0, AT_REMOVEDIR) }
            let code = errno
            close(parentDescriptor)
            throw ContestDatabaseSnapshotError.publicationFailed(String(cString: strerror(code)))
        }
        var stagingStatus = stat()
        guard fstat(stagingDescriptor, &stagingStatus) == 0, (stagingStatus.st_mode & S_IFMT) == S_IFDIR else {
            close(stagingDescriptor)
            _ = stagingName.withCString { unlinkat(parentDescriptor, $0, AT_REMOVEDIR) }
            close(parentDescriptor)
            throw ContestDatabaseSnapshotError.publicationFailed("could not pin staging directory")
        }
        self.stagingDescriptor = stagingDescriptor
        self.stagingIdentity = Identity(stagingStatus)
    }

    deinit {
        if let databaseDescriptor { close(databaseDescriptor) }
        close(stagingDescriptor)
        close(parentDescriptor)
    }

    func pinDatabase(databaseFileName: String) throws {
        guard databaseDescriptor == nil else {
            throw ContestDatabaseSnapshotError.publicationFailed("database already pinned")
        }
        let descriptor = databaseFileName.withCString {
            openat(stagingDescriptor, $0, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
        }
        guard descriptor >= 0 else {
            throw ContestDatabaseSnapshotError.unsafePath(stagingURL.appendingPathComponent(databaseFileName).path)
        }
        var value = stat()
        guard fstat(descriptor, &value) == 0,
              (value.st_mode & S_IFMT) == S_IFREG,
              value.st_nlink == 1 else {
            close(descriptor)
            throw ContestDatabaseSnapshotError.unsafePath(stagingURL.appendingPathComponent(databaseFileName).path)
        }
        let identity = Identity(value)
        guard entryIdentity(named: databaseFileName, relativeTo: stagingDescriptor, type: S_IFREG) == identity else {
            close(descriptor)
            throw ContestDatabaseSnapshotError.unsafePath(stagingURL.appendingPathComponent(databaseFileName).path)
        }
        databaseDescriptor = descriptor
        databaseIdentity = identity
    }

    func publishNoReplace() throws {
        guard parentPathStillPinned(), stagingEntryStillOwned() else {
            throw ContestDatabaseSnapshotError.unsafePath(parentURL.path)
        }
        #if canImport(Darwin)
        let result = stagingName.withCString { sourceName in
            destinationName.withCString { destinationName in
                renameatx_np(parentDescriptor, sourceName, parentDescriptor, destinationName, UInt32(RENAME_EXCL))
            }
        }
        #else
        let result = stagingName.withCString { sourceName in
            destinationName.withCString { destinationName in
                renameat2(parentDescriptor, sourceName, parentDescriptor, destinationName, UInt32(1))
            }
        }
        #endif
        guard result == 0 else {
            if errno == EEXIST { throw ContestDatabaseSnapshotError.destinationExists }
            #if canImport(Glibc)
            if errno == ENOSYS || errno == EINVAL { throw ContestDatabaseSnapshotError.atomicPublicationUnsupported }
            #endif
            throw ContestDatabaseSnapshotError.publicationFailed(String(cString: strerror(errno)))
        }
    }

    func verifyPublishedLocation() throws {
        guard parentPathStillPinned(), destinationEntryIsOwnedStaging() else {
            throw ContestDatabaseSnapshotError.unsafePath(parentURL.path)
        }
    }

    func removeOwnedStaging(databaseFileName: String) {
        if databaseEntryStillOwned(databaseFileName) {
            _ = databaseFileName.withCString { unlinkat(stagingDescriptor, $0, 0) }
        }
        guard stagingEntryStillOwned() else { return }
        _ = stagingName.withCString { unlinkat(parentDescriptor, $0, AT_REMOVEDIR) }
    }

    private func parentPathStillPinned() -> Bool {
        var value = stat()
        return parentURL.path.withCString { lstat($0, &value) } == 0
            && (value.st_mode & S_IFMT) == S_IFDIR
            && Identity(value) == parentIdentity
    }

    private func stagingEntryStillOwned() -> Bool {
        entryIdentity(named: stagingName) == stagingIdentity
    }

    private func destinationEntryIsOwnedStaging() -> Bool {
        entryIdentity(named: destinationName) == stagingIdentity
    }

    private func databaseEntryStillOwned(_ name: String) -> Bool {
        guard let databaseIdentity else { return false }
        return entryIdentity(named: name, relativeTo: stagingDescriptor, type: S_IFREG) == databaseIdentity
    }

    private func entryIdentity(named name: String) -> Identity? {
        entryIdentity(named: name, relativeTo: parentDescriptor, type: S_IFDIR)
    }

    private func entryIdentity(named name: String, relativeTo descriptor: Int32, type: mode_t) -> Identity? {
        var value = stat()
        let result = name.withCString { fstatat(descriptor, $0, &value, AT_SYMLINK_NOFOLLOW) }
        guard result == 0, (value.st_mode & S_IFMT) == type else { return nil }
        return Identity(value)
    }
}
#elseif canImport(WinSDK)
private final class PinnedSnapshotParent {
    let stagingURL: URL

    init(parent: URL, stagingName: String, destinationName: String) throws {
        stagingURL = parent.appendingPathComponent(stagingName, isDirectory: true)
        // MoveFileExW is atomically no-replace, but its path traversal cannot be
        // anchored to a retained parent handle. Fail before staging until the
        // Windows implementation can preserve the same replacement guarantees.
        throw ContestDatabaseSnapshotError.atomicPublicationUnsupported
    }

    func publishNoReplace() throws { throw ContestDatabaseSnapshotError.atomicPublicationUnsupported }
    func verifyPublishedLocation() throws { throw ContestDatabaseSnapshotError.atomicPublicationUnsupported }
    func pinDatabase(databaseFileName: String) throws { throw ContestDatabaseSnapshotError.atomicPublicationUnsupported }
    func removeOwnedStaging(databaseFileName: String) {}
}
#else
private final class PinnedSnapshotParent {
    let stagingURL: URL
    init(parent: URL, stagingName: String, destinationName: String) throws {
        throw ContestDatabaseSnapshotError.atomicPublicationUnsupported
    }
    func publishNoReplace() throws { throw ContestDatabaseSnapshotError.atomicPublicationUnsupported }
    func verifyPublishedLocation() throws { throw ContestDatabaseSnapshotError.atomicPublicationUnsupported }
    func pinDatabase(databaseFileName: String) throws { throw ContestDatabaseSnapshotError.atomicPublicationUnsupported }
    func removeOwnedStaging(databaseFileName: String) {}
}
#endif

private final class OperationState: @unchecked Sendable {
    private let lock = NSLock()
    private var cancellationRequested = false
    private let deadline: UInt64

    init(timeout: TimeInterval) throws {
        guard timeout.isFinite, timeout > 0, timeout <= 3_600 else {
            throw ContestDatabaseSnapshotError.invalidURL
        }
        let interval = UInt64(timeout * 1_000_000_000)
        let now = DispatchTime.now().uptimeNanoseconds
        guard interval <= UInt64.max - now else { throw ContestDatabaseSnapshotError.invalidURL }
        deadline = now + interval
    }

    func cancel() { lock.withLock { cancellationRequested = true } }

    var shouldAbort: Bool {
        lock.withLock { cancellationRequested } || DispatchTime.now().uptimeNanoseconds >= deadline
    }

    func check() throws {
        if lock.withLock({ cancellationRequested }) { throw ContestDatabaseSnapshotError.cancelled }
        if DispatchTime.now().uptimeNanoseconds >= deadline { throw ContestDatabaseSnapshotError.deadlineExceeded }
    }

    func interruptibleSleep(milliseconds: Int32) throws {
        var remaining = milliseconds
        while remaining > 0 {
            try check()
            let slice = min(remaining, 10)
            sqlite3_sleep(slice)
            remaining -= slice
        }
        try check()
    }
}

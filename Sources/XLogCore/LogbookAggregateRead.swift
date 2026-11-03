import Foundation
#if canImport(SQLite3)
import SQLite3
#else
import CSQLitePrototype
#endif
#if os(Windows)
import WinSDK
#elseif os(Linux)
import Glibc
#else
import Darwin
#endif

public enum LogbookAggregateKind: Hashable, Sendable { case statistics, catalogue, contacts, localAwards, exportContacts }

public struct LogbookAggregateRequest: Hashable, Sendable {
    public let kind: LogbookAggregateKind
    public let semanticKey: String
    let yearStart: TimeInterval
    public var query: LogbookQuery? = nil
    public var search = ""
    public var offset = 0
    public var limit = 20
    public var referenceTime: Double = 0
    public var programme = "dxcc"
    public var referenceDirectory = ""
    public var referenceVersion = ""

    public static func current(_ kind: LogbookAggregateKind, at date: Date = Date()) throws -> Self {
        let yearStart: TimeInterval
        let key: String
        switch kind {
        case .statistics:
            yearStart = Calendar(identifier: .gregorian)
                .date(from: Calendar.current.dateComponents([.year], from: date))?.timeIntervalSince1970 ?? 0
            key = "stats-v1-\(yearStart)"
        case .catalogue:
            yearStart = 0
            key = try AwardCatalogEngine.persistedCacheKey.get()
        case .contacts:
            yearStart = 0
            key = "contact-query-v1"
        case .exportContacts:
            yearStart = 0
            key = "export-contact-query-v1"
        case .localAwards:
            yearStart = 0
            key = LocalAwardEngine.rulesVersion
        }
        var request=Self(kind: kind, semanticKey: key, yearStart: yearStart)
        if kind == .localAwards { request.referenceTime=date.timeIntervalSince1970 }
        return request
    }
}

/// Physical identity only; no user path or opaque Foundation object crosses lanes.
public struct LogbookAggregateFileIdentity: Hashable, Sendable {
    private let device: UInt64
    private let file: UInt64

    static func canonicalReaderURL(_ url: URL) -> URL {
        #if os(macOS)
        // Match the existing spot-history boundary. Foundation can rewrite a
        // resolved /private/var back to /var; only these fixed OS aliases are
        // accepted, never arbitrary ancestor or final-component links.
        for alias in ["/var/", "/tmp/"] where url.path.hasPrefix(alias) {
            return URL(fileURLWithPath: "/private" + url.path)
        }
        #endif
        return url
    }

    static func capture(at url: URL) throws -> Self {
        guard url.isFileURL, let path = LocalFilePath.nativeFileSystemPath(for: url) else {
            throw LogbookDatabaseError.open("Invalid aggregate database path")
        }
        #if os(Windows)
        let handle = path.withCString(encodedAs: UTF16.self) {
            CreateFileW($0, DWORD(FILE_READ_ATTRIBUTES),
                        DWORD(FILE_SHARE_READ) | DWORD(FILE_SHARE_WRITE) | DWORD(FILE_SHARE_DELETE),
                        nil, DWORD(OPEN_EXISTING), DWORD(FILE_FLAG_OPEN_REPARSE_POINT), nil)
        }
        guard let handle, handle != HANDLE(bitPattern: -1) else {
            throw LogbookDatabaseError.open("Could not identify aggregate database")
        }
        defer { CloseHandle(handle) }
        return try capture(handle: handle)
        #else
        guard LocalFilePath.isAbsoluteWithoutTraversal(path) else {
            throw LogbookDatabaseError.open("Invalid aggregate database path")
        }
        let descriptor = open(path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
        guard descriptor >= 0 else { throw LogbookDatabaseError.open("Could not identify aggregate database") }
        defer { close(descriptor) }
        var info = stat()
        guard fstat(descriptor, &info) == 0, info.st_mode & S_IFMT == S_IFREG else {
            throw LogbookDatabaseError.open("Aggregate database identity is unsafe")
        }
        return Self(device: UInt64(truncatingIfNeeded: info.st_dev), file: UInt64(truncatingIfNeeded: info.st_ino))
        #endif
    }

    static func capture(connection: OpaquePointer, at url: URL) throws -> Self {
        #if os(Windows)
        var borrowed: HANDLE?
        guard sqlite3_file_control(connection, "main", SQLITE_FCNTL_WIN32_GET_HANDLE, &borrowed) == SQLITE_OK,
              let borrowed, borrowed != HANDLE(bitPattern: -1) else {
            throw LogbookDatabaseError.open("Could not identify opened aggregate database")
        }
        // This handle belongs to SQLite. Never close it here.
        return try capture(handle: borrowed)
        #else
        func requireUnmoved() throws {
            var moved: Int32 = 0
            guard sqlite3_file_control(connection, "main", SQLITE_FCNTL_HAS_MOVED, &moved) == SQLITE_OK else {
                throw LogbookDatabaseError.open("Could not verify opened aggregate database")
            }
            guard moved == 0 else { throw LogbookAggregateReadError.retired }
        }
        try requireUnmoved()
        let identity = try capture(at: url)
        try requireUnmoved()
        return identity
        #endif
    }

    #if os(Windows)
    private static func capture(handle: HANDLE) throws -> Self {
        var info = BY_HANDLE_FILE_INFORMATION()
        guard GetFileType(handle) == DWORD(FILE_TYPE_DISK), GetFileInformationByHandle(handle, &info),
              info.dwFileAttributes & (DWORD(FILE_ATTRIBUTE_DIRECTORY) | DWORD(FILE_ATTRIBUTE_REPARSE_POINT)) == 0 else {
            throw LogbookDatabaseError.open("Aggregate database identity is unsafe")
        }
        return Self(device: UInt64(info.dwVolumeSerialNumber),
                    file: UInt64(info.nFileIndexHigh) << 32 | UInt64(info.nFileIndexLow))
    }
    #endif
}

public struct LogbookAggregateAuthority: Hashable, Sendable {
    public let revision: Int64
    public let fileIdentity: LogbookAggregateFileIdentity
}

public enum LogbookAggregateReadError: Error, Equatable, Sendable { case superseded, retired }

/// One request owns at most one reader. Interrupt borrowers are drained before
/// its handle closes: SQLite forbids closing while sqlite3_interrupt is in flight.
public final class LogbookAggregateCancellation: @unchecked Sendable {
    private let condition = NSCondition()
    private var cancelled = false
    private var handle: OpaquePointer?
    private var interruptBorrowers = 0
    // Deterministic fixture seams, left nil by shipping callers.
    var afterSnapshotPinned: (() throws -> Void)?
    var onSQLiteProgress: (() -> Void)?
    var onEvaluationCheck: (() -> Void)?
    var beforeInterrupt: (() -> Void)?
    var onReaderDetached: (() -> Void)?

    public init() {}
    public var isCancelled: Bool { condition.withLock { cancelled } }
    public func check() throws { if isCancelled { throw CancellationError() } }

    public func cancel() {
        condition.lock()
        cancelled = true
        let borrowed = handle
        if borrowed != nil { interruptBorrowers += 1 }
        condition.unlock()
        if let borrowed {
            beforeInterrupt?()
            sqlite3_interrupt(borrowed)
            condition.lock()
            interruptBorrowers -= 1
            condition.broadcast()
            condition.unlock()
        }
    }

    func register(_ handle: OpaquePointer) throws {
        try condition.withLock {
            guard !cancelled else { throw CancellationError() }
            guard self.handle == nil else { throw LogbookDatabaseError.sqlite("Aggregate cancellation already owns a reader") }
            self.handle = handle
        }
    }

    func unregister(_ handle: OpaquePointer) {
        condition.lock()
        if self.handle == handle {
            self.handle = nil
            // Fixture callbacks must not re-enter this condition-protected token.
            onReaderDetached?()
        }
        while interruptBorrowers > 0 { condition.wait() }
        condition.unlock()
    }

    var hasRegisteredReader: Bool { condition.withLock { handle != nil } }
    func evaluationCheck() throws { onEvaluationCheck?(); try check() }
}

public struct LogbookStatisticsAggregate: Equatable, Sendable {
    public let stats: LogbookStats
    public let awards: AwardProgressSnapshot
    public let dxccStatuses: [Int: String]
}

public enum LogbookAggregateValue: Equatable, Sendable {
    case statistics(LogbookStatisticsAggregate)
    case catalogue(AwardCatalogSnapshot)
    case contacts(LogbookQueryPage)
    case localAwards(LocalAwardSnapshot)
}

public struct LogbookQueryPage: Equatable, Sendable {
    public var contacts: [QSO]
    public var total: Int
}

public struct LogbookAggregateResult: Sendable {
    public let authority: LogbookAggregateAuthority
    public let request: LogbookAggregateRequest
    public let value: LogbookAggregateValue
}

/// Contains copied values only. The WAL transaction, statements and reader
/// handle are already closed before this snapshot reaches a CPU evaluator.
public struct LogbookAggregateSnapshot: Sendable {
    enum Payload: Sendable {
        case value(LogbookAggregateValue), contacts([AwardCatalogContact])
        case awardEvidence([AwardEvidenceContact], ActivationReferenceDirectory)
    }
    public let authority: LogbookAggregateAuthority
    public let request: LogbookAggregateRequest
    let payload: Payload

    public func evaluate(cancellation: LogbookAggregateCancellation) throws -> LogbookAggregateResult {
        try cancellation.evaluationCheck()
        let value: LogbookAggregateValue
        switch payload {
        case .value(let cached): value = cached
        case .contacts(let contacts):
            value = .catalogue(try AwardCatalogEngine.compute(contacts: contacts, cancellation: cancellation))
        case .awardEvidence(let contacts, let directory):
            value = .localAwards(try LocalAwardEngine.compute(contacts: contacts, programme: request.programme,
                directory: directory, referenceVersion: request.referenceVersion,
                wacMembership: LocalAwardEngine.wacMembership(), at:Date(timeIntervalSince1970:request.referenceTime), cancellation: cancellation))
        }
        try cancellation.check()
        return LogbookAggregateResult(authority: authority, request: request, value: value)
    }
}

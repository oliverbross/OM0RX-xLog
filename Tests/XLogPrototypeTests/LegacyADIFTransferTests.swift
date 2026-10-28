import Foundation
import Testing
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif
import CSQLitePrototype

@Suite("Retained SwiftUI uses shared atomic ADIF transfers")
struct LegacyADIFTransferTests {
    private let valid = "<CALL:5>K1ABC<QSO_DATE:8>20261020<TIME_ON:6>101530<BAND:3>20m<MODE:2>CW<APP_TEST:4>keep<EOR>"
    private func root() throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("legacy-adif-\(UUID())")
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    @Test func mixedInvalidInputAndRepeatImportHaveTruthfulAtomicCounts() throws {
        let root = try root(); defer { try? FileManager.default.removeItem(at: root) }
        let db = try LogbookDatabase(url: root.appendingPathComponent("log.sqlite")); defer { db.close() }
        let invalid = valid.replacingOccurrences(of: "<TIME_ON:6>101530", with: "<TIME_ON:5>10153")
        #expect(throws: ADIFDocumentImportError.self) { try db.importADIFDocument(valid + invalid) }
        #expect(try db.count() == 0)
        let first = try db.importADIFDocument(valid + valid)
        #expect(first.recordCount == 2 && first.importedCount == 1 && first.skippedCount == 1)
        let contact = try #require(db.fetchAll().first)
        #expect(contact.extraFields["APP_TEST"] == "keep")
        let repeated = try db.importADIFDocument(valid)
        #expect(repeated.importedCount == 0 && repeated.skippedCount == 1)
        #expect(try db.fetchAll().first?.id == contact.id)
        #expect(throws: ADIFDocumentImportError.self) { try db.importADIFDocument(valid + "<CALL:6>cut") }
        #expect(try db.count() == 1)
        db.close()
        #expect(throws: (any Error).self) { try db.importADIFDocument(valid) }
    }

    @Test func laterSQLiteFailureRollsBackEarlierRowsAndRetryIsSafe() throws {
        let root = try root(); defer { try? FileManager.default.removeItem(at: root) }
        let url = root.appendingPathComponent("log.sqlite"), db = try LogbookDatabase(url: root.appendingPathComponent("log.sqlite"))
        defer { db.close() }
        var handle: OpaquePointer?
        #expect(sqlite3_open(url.path, &handle) == SQLITE_OK)
        defer { sqlite3_close(handle) }
        #expect(sqlite3_exec(handle, "CREATE TRIGGER reject_second BEFORE INSERT ON qsos WHEN NEW.call='K2ABC' BEGIN SELECT RAISE(ABORT,'fixture failure'); END;", nil, nil, nil) == SQLITE_OK)
        let second = valid.replacingOccurrences(of: "K1ABC", with: "K2ABC")
        #expect(throws: (any Error).self) { try db.importADIFDocument(valid + second) }
        #expect(try db.count() == 0)
        #expect(sqlite3_exec(handle, "DROP TRIGGER reject_second;", nil, nil, nil) == SQLITE_OK)
        #expect(try db.importADIFDocument(valid + second).importedCount == 2)
        #expect(try db.importADIFDocument(valid + second).skippedCount == 2)
    }

    @Test func fileReaderRejectsInvalidUTF8AndLimitsBeforeImport() throws {
        let root = try root(); defer { try? FileManager.default.removeItem(at: root) }
        let input = root.appendingPathComponent("input.adi")
        try Data([0xff, 0xfe]).write(to: input)
        #expect(throws: ADIFDocumentImportError.self) { try ADIFImportPreview.fileText(at: input) }
        try Data(repeating: 65, count: 65).write(to: input)
        #expect(throws: ADIFDocumentImportError.self) { try ADIFImportPreview.fileText(at: input, maximumBytes: 64) }
        try valid.write(to: input, atomically: true, encoding: .utf8)
        #expect(try ADIFImportPreview.fileText(at: input) == valid)
    }

    @Test func entireLogExportExceedsDisplayCapAndRetainsFrozenScope() throws {
        let root = try root(); defer { try? FileManager.default.removeItem(at: root) }
        let db = try LogbookDatabase(url: root.appendingPathComponent("log.sqlite")); defer { db.close() }
        let rows = (0..<2_003).map { index in QSO(call: "K\(index)AA", start: Date(timeIntervalSince1970: 1_700_000_000 + Double(index)), band: "20m", mode: "CW") }
        #expect(try db.importBatch(rows) == 2_003)
        #expect(try db.fetch(limit: 2_000).count == 2_000)
        let snapshot = try db.adifExportSnapshot(scope: .all)
        #expect(snapshot.records.count == 2_003)
        #expect(Set(snapshot.contactIDs) == Set(rows.map(\.id)))
        try db.save(QSO(call: "W1NEW", band: "20m", mode: "CW"))
        let exported = ADIFImportPreview(text: snapshot.document, maximumBytes: ADIFImportPreview.maximumFileBytes, maximumRecords: 10_000)
        #expect(exported.issues.isEmpty && exported.records.count == 2_003)
        #expect(!snapshot.document.contains("W1NEW"))
        #expect(try db.count() == 2_004)
    }
}

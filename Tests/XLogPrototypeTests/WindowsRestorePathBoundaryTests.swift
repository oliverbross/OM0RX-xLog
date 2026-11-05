import Foundation
import XCTest
@testable import XLogPrototypeSupport
#if os(macOS)
@testable import XLogCore
#else
@testable import XLogPortableCore
#endif

private func restoreNativeUTF16Units(_ url: URL) -> Int {
    url.withUnsafeFileSystemRepresentation { $0.map { String(cString: $0).utf16.count } ?? 0 }
}

/// Real filesystem/SQLite coverage, with the measured Windows acceptance path
/// dimensions. No expected-failure assertions, native settings, services or GUI.
final class WindowsRestorePathBoundaryTests: XCTestCase {
    private struct SanitizedFailure: Error, CustomStringConvertible {
        let description: String
    }

    private final class ObservedFileManager: FileManager, @unchecked Sendable {
        var observations: [[String: Any]] = []

        private func observe(_ operation: String, _ urls: [URL], _ body: () throws -> Void) throws {
            var entry: [String: Any] = ["operation": operation, "pathUTF16Lengths": urls.map(restoreNativeUTF16Units)]
            do { try body(); entry["status"] = "passed" }
            catch {
                entry["status"] = "failed"
                entry["errorCodes"] = WindowsRestorePathBoundaryTests.errorCodes(error)
                observations.append(entry)
                throw error
            }
            observations.append(entry)
        }

        override func moveItem(at srcURL: URL, to dstURL: URL) throws {
            try observe("Foundation.moveItem", [srcURL, dstURL]) { try super.moveItem(at: srcURL, to: dstURL) }
        }

        override func copyItem(at srcURL: URL, to dstURL: URL) throws {
            try observe("Foundation.copyItem", [srcURL, dstURL]) { try super.copyItem(at: srcURL, to: dstURL) }
        }

        override func createDirectory(at url: URL, withIntermediateDirectories createIntermediates: Bool,
                                      attributes: [FileAttributeKey: Any]? = nil) throws {
            try observe("Foundation.createDirectory", [url]) {
                try super.createDirectory(at: url, withIntermediateDirectories: createIntermediates, attributes: attributes)
            }
        }
    }

    private struct Fixture {
        let owner: URL
        let temp: URL
        let support: URL
        let workspace: URL
        let label: String
        let fileManager: ObservedFileManager

        var lengths: [String: Int] {
            ["temp": restoreNativeUTF16Units(temp), "support": restoreNativeUTF16Units(support),
             "workspace": restoreNativeUTF16Units(workspace),
             "liveDatabase": restoreNativeUTF16Units(workspace.appendingPathComponent("OM0RX-xLog.sqlite")),
             "databaseRollback": restoreNativeUTF16Units(databaseRollback),
             "referenceLive": restoreNativeUTF16Units(workspace.appendingPathComponent("Reference Data")),
             "referenceRollback": restoreNativeUTF16Units(referenceRollback),
             "recoveryPackage": restoreNativeUTF16Units(recoveryPackage),
             "recoveryReference": restoreNativeUTF16Units(recoveryPackage.appendingPathComponent("Reference Data")),
             "recoveryStagedReference": restoreNativeUTF16Units(workspace.appendingPathComponent("Recovery/.xlogbackup-00000000-0000-0000-0000-000000000000/Reference Data"))]
        }

        // Exact shipping rollback basename format, including20-character UTC
        // timestamp and36-character UUID; fixed values keep the test reproducible.
        var databaseRollback: URL {
            workspace.appendingPathComponent("OM0RX-xLog-before-restore-2026-11-06T00-00-00Z-00000000-0000-0000-0000-000000000000.sqlite")
        }

        var referenceRollback: URL {
            workspace.appendingPathComponent("Reference Data-before-restore-2026-11-06T00-00-00Z-00000000-0000-0000-0000-000000000000", isDirectory: true)
        }

        var recoveryPackage: URL {
            workspace.appendingPathComponent("Recovery/pre-restore-00000000-0000-0000-0000-000000000000.xlogbackup", isDirectory: true)
        }
    }

    private static func errorCodes(_ error: Error) -> [[String: Any]] {
        var result: [[String: Any]] = []
        var current: NSError? = error as NSError
        for _ in 0..<4 {
            guard let value = current else { break }
            // Never emit descriptions/userInfo: either can contain full paths.
            result.append(["domain": value.domain, "code": value.code])
            current = value.userInfo[NSUnderlyingErrorKey] as? NSError
        }
        return result
    }

    private func stage<T>(_ name: String, _ fixture: Fixture, _ body: () throws -> T) throws -> T {
        let start = fixture.fileManager.observations.count
        var receipt: [String: Any] = ["stage": name, "case": fixture.label, "pathUTF16Lengths": fixture.lengths]
        do {
            let result = try body()
            receipt["status"] = "passed"
            receipt["filesystem"] = Array(fixture.fileManager.observations.dropFirst(start))
            emit(receipt)
            return result
        } catch {
            receipt["status"] = "failed"
            receipt["errorCodes"] = Self.errorCodes(error)
            if let failure = error as? SanitizedFailure { receipt["invariant"] = failure.description }
            receipt["filesystem"] = Array(fixture.fileManager.observations.dropFirst(start))
            let text = emit(receipt)
            throw SanitizedFailure(description: text)
        }
    }

    private func require(_ condition: Bool, _ invariant: String) throws {
        guard condition else { throw SanitizedFailure(description: invariant) }
    }

    @discardableResult
    private func emit(_ receipt: [String: Any]) -> String {
        let bytes = (try? JSONSerialization.data(withJSONObject: receipt, options: [.sortedKeys])) ?? Data("{}".utf8)
        let text = "RESTORE_PATH_DIAGNOSTIC " + String(decoding: bytes, as: UTF8.self)
        print(text)
        return text
    }

    private func withFixture(tempLength: Int, prefix: String, _ body: (Fixture) throws -> Void) throws {
        let fm = ObservedFileManager()
        #if os(Windows)
        let parent = ProcessInfo.processInfo.environment["RUNNER_TEMP"].map { URL(fileURLWithPath: $0, isDirectory: true) }
            ?? fm.temporaryDirectory
        #else
        // A short disposable ancestor permits the exact same UTF16 dimensions
        // on macOS, whose conventional per-user temp ancestor can itself be>91.
        let parent = URL(fileURLWithPath: "/tmp", isDirectory: true)
        #endif
        let owner = parent.appendingPathComponent("xr-\(UUID().uuidString)", isDirectory: true)
        let padding = tempLength - restoreNativeUTF16Units(owner) - 1
        guard padding > 0, padding < 200 else {
            throw SanitizedFailure(description: emit(["stage": "fixture-dimensions", "status": "failed",
                "ancestorUTF16Length": restoreNativeUTF16Units(parent), "ownerUTF16Length": restoreNativeUTF16Units(owner),
                "requestedTempUTF16Length": tempLength]))
        }
        let temp = owner.appendingPathComponent(String(repeating: "t", count: padding), isDirectory: true)
        let support = temp.appendingPathComponent(prefix + UUID().uuidString, isDirectory: true)
        let workspace = support.appendingPathComponent("OM0RX-xLog-Integrated Preview", isDirectory: true)
        let fixture = Fixture(owner: owner, temp: temp, support: support, workspace: workspace,
            label: "temp\(tempLength)-" + (prefix == "xlog-local-test-" ? "direct" : "rpc"), fileManager: fm)
        defer { try? fm.removeItem(at: owner) }
        try stage("fixture-create", fixture) {
            try fm.createDirectory(at: workspace, withIntermediateDirectories: true,
                attributes: LocalFilePermissions.directoryAttributes)
        }
        try stage("fixture-dimension-verify", fixture) {
            try require(restoreNativeUTF16Units(temp) == tempLength, "native TEMP length equals requested length")
            try require(restoreNativeUTF16Units(workspace) ==
                tempLength + 1 + prefix.utf16.count + UUID().uuidString.utf16.count + 1 + "OM0RX-xLog-Integrated Preview".utf16.count,
                "native workspace length equals literal-derived length")
        }
        try body(fixture)
    }

    private func roundTrip(tempLength: Int, prefix: String) throws {
        try withFixture(tempLength: tempLength, prefix: prefix) { fixture in
            let fm = fixture.fileManager
            let liveURL = fixture.workspace.appendingPathComponent("OM0RX-xLog.sqlite")
            let reference = fixture.workspace.appendingPathComponent("Reference Data", isDirectory: true)
            let referenceFile = reference.appendingPathComponent("fixture.json")
            let selectedReference = Data("{\"synthetic\":\"selected Ω\"}".utf8)
            var settings = XLogSettings.defaults
            settings.logbookMode = .local
            settings.automaticSync = false
            settings.stationLocation = "Synthetic path boundary"
            settings.gridSquare = "FN31PR"
            let database = try stage("database-open", fixture) { try LogbookDatabase(url: liveURL) }
            defer { database.close() }
            let record = ADIFRecord(fields: ["CALL": "K1ABC", "QSO_DATE": "20261001", "TIME_ON": "120000",
                "BAND": "20m", "MODE": "CW", "APP_FIXTURE": "KEPT", "COMMENT": "Synthetic restored Ω"])
            let qso = try XCTUnwrap(QSO(adif: record))
            try stage("seed-contact-settings-reference", fixture) {
                try database.save(qso)
                _ = try database.integrationSettings(seed: settings)
                try fm.createDirectory(at: reference, withIntermediateDirectories: true)
                try selectedReference.write(to: referenceFile)
            }
            let referenceLease = try stage("reference-lease", fixture) { try ReferenceRefreshLease(directory: reference) }
            defer { referenceLease.release() }
            let preferences = XLogBackupPreferences(deskBandMapBands: ["20m"], detachedBandMapBands: ["20m"],
                deskBandMapFollowsRadio: true, detachedBandMapLayout: "grid", bandMapFontScale: 1,
                intelligenceBands: ["20m"], clusterSpotOpensFullEditor: false)
            let manager = XLogBackupManager(fileManager: fm)
            let package = fixture.workspace.appendingPathComponent("Backups/round-trip.xlogbackup", isDirectory: true)
            let preview = try stage("backup-create", fixture) {
                try manager.create(database: database, at: package, settings: settings,
                    preferences: preferences, referenceDataURL: reference)
            }
            try stage("selected-backup-verify", fixture) { try require(preview.manifest.qsoCount == 1, "selected backup has one contact") }
            let selectedBackupBytes = try stage("capture-selected-backup-bytes", fixture) {
                try BackupPackageSeal.capture(package, fileManager: fm)
            }
            let envelope = try stage("prepare-restore-envelope", fixture) { try manager.prepareRestoreEnvelope(at: package) }
            try stage("envelope-settings-verify", fixture) { try require(envelope.preview.settings == settings, "selected envelope settings preserved") }
            try stage("reference-preflight", fixture) { try manager.preflightReferenceDataInstallation(from: envelope) }
            try stage("change-live-before-restore", fixture) {
                var changed = qso
                changed.comment = "Changed after backup"
                try database.save(changed)
                try Data("changed-reference".utf8).write(to: referenceFile)
            }
            // LiveLogbookMethods.backup_restore2092–2099 creates this recovery
            // snapshot with the current reference data before closing/installing.
            try stage("recovery-snapshot-create", fixture) {
                _ = try manager.create(database: database, at: fixture.recoveryPackage, settings: settings,
                    preferences: preferences, referenceDataURL: reference)
            }
            try stage("recovery-snapshot-verify", fixture) {
                let recovery = try manager.inspect(at: fixture.recoveryPackage)
                try require(recovery.manifest.qsoCount == 1 && recovery.settings == settings, "recovery snapshot contact count and settings preserved")
            }
            database.close()
            let rollback = try stage("install-database", fixture) {
                try manager.installDatabase(from: envelope, to: liveURL, restoredSettings: settings)
            }
            let referenceRollback = try stage("install-reference", fixture) {
                try manager.installReferenceData(from: envelope, to: reference)
            }
            try stage("reopen-verify-selected-data", fixture) {
                let restored = try LogbookDatabase(url: liveURL)
                defer { restored.close() }
                let contacts = try restored.fetchAll()
                try require(contacts.count == 1, "restored contact count is one")
                let saved = try XCTUnwrap(contacts.first)
                try require(saved.id == qso.id && saved.call == "K1ABC", "selected contact identity preserved")
                try require(saved.comment == "Synthetic restored Ω", "selected contact comment preserved")
                try require(saved.adifRecord["APP_FIXTURE"] == "KEPT", "unknown ADIF field preserved")
                try require(try restored.integrationSettings(seed: .defaults).settings == settings, "selected durable settings preserved")
                try require(try Data(contentsOf: referenceFile) == selectedReference, "selected reference bytes preserved")
                try require(try Data(contentsOf: try XCTUnwrap(referenceRollback).appendingPathComponent("fixture.json")) == Data("changed-reference".utf8), "previous reference bytes retained in rollback")
                try require(try BackupPackageSeal.capture(package, fileManager: fm) == selectedBackupBytes, "selected backup bytes unchanged")
                let previous = try LogbookDatabase(url: XCTUnwrap(rollback))
                defer { previous.close() }
                try require(try previous.lookup(localID: qso.id)?.comment == "Changed after backup", "previous database contact retained in rollback")
            }
        }
    }

    func testDirectRestoreAtTemp91() throws { try roundTrip(tempLength: 91, prefix: "xlog-local-test-") }
    func testDirectRestoreAtTemp92() throws { try roundTrip(tempLength: 92, prefix: "xlog-local-test-") }
    func testRPCRestoreAtTemp91() throws { try roundTrip(tempLength: 91, prefix: "xlog-ui-acceptance-") }
    func testRPCRestoreAtTemp92() throws { try roundTrip(tempLength: 92, prefix: "xlog-ui-acceptance-") }

}

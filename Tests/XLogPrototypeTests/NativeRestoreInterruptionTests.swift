import Foundation
import XCTest
#if canImport(CryptoKit)
import CryptoKit
#else
import Crypto
#endif
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
#if canImport(Darwin)
import Darwin
#elseif canImport(Glibc)
import Glibc
#endif
#if os(macOS)
import MachO
@testable import XLogCore
#else
@testable import XLogPortableCore
#endif

private final class RestoreHistoryProtocol: URLProtocol {
    private static let lock = NSLock()
    private static var count = 0
    private static var remoteID = 42
    static func reset(remoteID: Int = 42) { lock.withLock { count = 0; self.remoteID = remoteID } }
    static var requests: Int { lock.withLock { count } }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let id = Self.lock.withLock { Self.count += 1; return Self.remoteID }
        guard request.httpMethod == "GET", let url = request.url else {
            client?.urlProtocol(self, didFailWithError: URLError(.unsupportedURL)); return
        }
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let station = items.first(where: { $0.name == "station_id" })?.value == "2" ? 2 : 1
        let call = station == 2 ? "K2RESTORED" : "K1AUTHORITY"
        let body: Data
        if items.contains(where: { $0.name == "format" && $0.value == "adif" }) {
            let record = ADIFRecord(fields: ["CALL": call, "QSO_DATE": "20231114",
                "TIME_ON": "221320", "BAND": "20m", "MODE": "CW"])
            body = try! JSONEncoder().encode(WavelogADIFPage(
                data: WavelogADIFData(exported: 1, lastFetchedID: id, adif: record.adifDocument),
                meta: WavelogListMeta(page: 1, perPage: 1000, count: 1, total: 1, totalPages: 1, hasMore: false)))
        } else {
            body = Data("""
            {"data":[{"id":\(id),"station_id":\(station),"call":"\(call)","band":"20m","mode":"CW","qso_date":"2023-11-14 22:13:20"}],"meta":{"page":1,"per_page":1000,"count":1,"total":1,"total_pages":1,"has_more":false}}
            """.utf8)
        }
        let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil,
                                       headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

final class NativeRestoreInterruptionTests: XCTestCase {
    private struct Checkpoint: Codable {
        let pid: Int32
        let executable: String
        let root: String
    }
    private enum Interruption: Error { case afterDatabase }

    func testNativeOwnerUsesSelectedReferenceBytesWhenPackageIsReplacedAfterDatabasePublication() throws {
        let fm = FileManager.default
        let root = fm.temporaryDirectory.appendingPathComponent("xlog-native-swap-\(UUID())")
        let suite = "xlog-native-swap-\(UUID())"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite); try? fm.removeItem(at: root) }
        let selectedReference = root.appendingPathComponent("selected-reference")
        let replacementReference = root.appendingPathComponent("replacement-reference")
        for directory in [selectedReference, replacementReference] {
            try fm.createDirectory(at: directory, withIntermediateDirectories: true)
        }
        try Data("selected-reference-A".utf8).write(to: selectedReference.appendingPathComponent("identity.txt"))
        try Data("replacement-reference-B".utf8).write(to: replacementReference.appendingPathComponent("identity.txt"))
        let fixture = try makeFixture(root: root, defaults: defaults, referenceDataURL: selectedReference)
        let manager = XLogBackupManager()
        let replacementDB = try LogbookDatabase(url: root.appendingPathComponent("replacement.sqlite"))
        try replacementDB.save(QSO(wavelogID: 42, call: "K3REPLACEMENT", band: "40m", mode: "CW"), markDirty: false)
        var replacementSettings = fixture.selected
        replacementSettings.wavelogStationID = 3
        let replacement = try manager.create(database: replacementDB, at: root.appendingPathComponent("replacement.xlogbackup"),
            settings: replacementSettings, preferences: preferences(), referenceDataURL: replacementReference)
        replacementDB.close()
        let selectedURL = fixture.preview.packageURL
        let retainedURL = root.appendingPathComponent("selected-retained.xlogbackup")
        let replacementURL = replacement.packageURL
        let owner = NativeBackupRestoreOwner(settingsStore: fixture.store, manager: manager)
        owner.afterDatabasePublication = {
            try FileManager.default.moveItem(at: selectedURL, to: retainedURL)
            try FileManager.default.moveItem(at: replacementURL, to: selectedURL)
        }
        let liveReference = root.appendingPathComponent("live-reference")
        let restored = try owner.restore(preview: fixture.preview, to: fixture.live,
            keeping: fixture.old, settingsAfterRestore: fixture.selected,
            recoveryPackageURL: fixture.recovery, referenceDataURL: liveReference)
        defer { restored.close() }
        XCTAssertEqual(try restored.fetchAll().first?.call, "K2RESTORED")
        XCTAssertEqual(fixture.store.load().wavelogStationID, 2)
        XCTAssertEqual(try String(contentsOf: liveReference.appendingPathComponent("identity.txt"), encoding: .utf8),
                       "selected-reference-A")
        XCTAssertTrue(fm.fileExists(atPath: retainedURL.path))
        XCTAssertTrue(fm.fileExists(atPath: fixture.recovery.path))
        XCTAssertEqual(try manager.inspect(at: retainedURL).settings?.wavelogStationID, 2)
        XCTAssertEqual(try manager.inspect(at: selectedURL).settings?.wavelogStationID, 3)
    }

    func testInterruptedOwnerRejectsOverlappingAndAbsentRemoteIDsBeforeAnyRequest() async throws {
        for remoteID in [42, 84] {
            let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-native-restore-\(UUID())")
            let suite = "xlog-native-restore-\(UUID())"
            let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
            defer { defaults.removePersistentDomain(forName: suite); try? FileManager.default.removeItem(at: root) }
            let fixture = try makeFixture(root: root, defaults: defaults)
            let owner = NativeBackupRestoreOwner(settingsStore: fixture.store)
            owner.afterDatabasePublication = { throw Interruption.afterDatabase }
            XCTAssertThrowsError(try owner.restore(preview: fixture.preview, to: fixture.live,
                keeping: fixture.old, settingsAfterRestore: fixture.selected,
                recoveryPackageURL: fixture.recovery, referenceDataURL: nil))
            XCTAssertTrue(fixture.store.load().hasSameWavelogDestination(as: fixture.old))
            try await assertInterruptedAdmission(root: root, fixture: fixture, remoteID: remoteID)
        }
    }

    func testControlledProcessInterruptionAtDatabasePublicationBlocksFreshOwner() async throws {
        #if os(Windows)
        throw XCTSkip("The controlled native process interruption runs on macOS/Linux")
        #else
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-native-process-\(UUID())").resolvingSymlinksInPath()
        let suite = "xlog-native-process-\(UUID())"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer {
            exportEvidenceIfRequested(root: root)
            defaults.removePersistentDomain(forName: suite)
            try? FileManager.default.removeItem(at: root)
        }
        let fixture = try makeFixture(root: root, defaults: defaults)
        XCTAssertTrue(defaults.synchronize())
        let executable = URL(fileURLWithPath: CommandLine.arguments[0]).resolvingSymlinksInPath()
        let process = Process()
        process.executableURL = executable
        let selector = "\(String(reflecting: Self.self))/testInterruptionChild"
        #if os(macOS)
        process.arguments = executable.lastPathComponent == "xctest"
            ? ["-XCTest", selector, Bundle(for: Self.self).bundleURL.path] : [selector]
        #else
        process.arguments = [selector]
        #endif
        var environment = ProcessInfo.processInfo.environment
        #if os(macOS)
        // xctest loads the instrumented bundle dynamically; its child needs the
        // same loaded TSAN runtime at startup so interceptors are installed.
        for index in 0..<_dyld_image_count() {
            guard let name = _dyld_get_image_name(index) else { continue }
            let runtime = String(cString: name)
            guard URL(fileURLWithPath: runtime).lastPathComponent == "libclang_rt.tsan_osx_dynamic.dylib" else { continue }
            let inserted = environment["DYLD_INSERT_LIBRARIES"] ?? ""
            if !inserted.split(separator: ":").contains(Substring(runtime)) {
                environment["DYLD_INSERT_LIBRARIES"] = inserted.isEmpty ? runtime : "\(runtime):\(inserted)"
            }
            break
        }
        #endif
        environment["XLOG_RESTORE_CHILD_ROOT"] = root.path
        environment["XLOG_RESTORE_CHILD_SUITE"] = suite
        process.environment = environment
        let output = Pipe()
        process.standardOutput = output
        process.standardError = output
        try process.run()
        defer { if process.isRunning { process.terminate(); process.waitUntilExit() } }
        let receiptURL = root.appendingPathComponent("database-published.json")
        let deadline = Date().addingTimeInterval(12)
        while !FileManager.default.fileExists(atPath: receiptURL.path), process.isRunning, Date() < deadline {
            try await Task.sleep(nanoseconds: 20_000_000)
        }
        guard FileManager.default.fileExists(atPath: receiptURL.path) else {
            if process.isRunning { process.terminate() }
            process.waitUntilExit()
            let text = String(decoding: output.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
            return XCTFail("Disposable child did not reach its publication checkpoint: \(text)")
        }
        let receipt = try JSONDecoder().decode(Checkpoint.self, from: Data(contentsOf: receiptURL))
        XCTAssertTrue(process.isRunning)
        XCTAssertEqual(receipt.pid, process.processIdentifier)
        XCTAssertEqual(receipt.executable, executable.path)
        XCTAssertEqual(receipt.root, root.path)
        XCTAssertEqual(kill(process.processIdentifier, 0), 0)
        // Only this positively identified owned child is terminated. There is no GUI binding.
        guard process.isRunning, receipt.pid == process.processIdentifier,
              receipt.executable == executable.path, receipt.root == root.path,
              kill(process.processIdentifier, 0) == 0 else { return XCTFail("Child isolation identity failed") }
        process.terminate()
        process.waitUntilExit()
        XCTAssertNotEqual(process.terminationStatus, 0)
        XCTAssertTrue(fixture.store.load().hasSameWavelogDestination(as: fixture.old))
        try await assertInterruptedAdmission(root: root, fixture: fixture, remoteID: 42)
        #endif
    }

    func testCompletedRestoreRejectsOldSavedAuthorityAndMatchingAuthorityActuallySynchronizes() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-native-bound-\(UUID())")
        let suite = "xlog-native-bound-\(UUID())"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite); try? FileManager.default.removeItem(at: root) }
        let fixture = try makeFixture(root: root, defaults: defaults)
        let owner = NativeBackupRestoreOwner(settingsStore: fixture.store)
        let restored = try owner.restore(preview: fixture.preview, to: fixture.live, keeping: fixture.old,
            settingsAfterRestore: fixture.selected, recoveryPackageURL: fixture.recovery, referenceDataURL: nil)
        restored.close()
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent(".restore-incomplete").path))
        XCTAssertFalse(fixture.store.load().automaticSync)
        // A completed marker removal cannot make an old persisted defaults domain authoritative.
        var oldSaved = fixture.old
        oldSaved.automaticSync = false
        fixture.store.save(oldSaved)
        XCTAssertThrowsError(try NativeBackupRestoreOwner.openDatabase(at: fixture.live, settings: oldSaved))
        let database = try LogbookDatabase(url: fixture.live)
        defer { database.close() }
        let original = try XCTUnwrap(try database.fetchAll().first)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [RestoreHistoryProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        for remoteID in [42, 84] {
            RestoreHistoryProtocol.reset(remoteID: remoteID)
            let oldConfig = try fixture.store.wavelogConfiguration(for: oldSaved, token: "wl2_fixture")
            do {
                _ = try await SyncEngine(database: database, configuration: oldConfig, session: session).synchronize()
                XCTFail("Raw SyncEngine accepted the old authority for restored linked rows")
            } catch XLogBackupError.syncDestinationChange { }
            XCTAssertEqual(RestoreHistoryProtocol.requests, 0)
            XCTAssertEqual(try database.lookup(localID: original.id)?.call, "K2RESTORED")
            XCTAssertNil(try database.lookup(localID: original.id)?.deletedAt)
        }
        fixture.store.save(fixture.selected)
        let accepted = try NativeBackupRestoreOwner.openDatabase(at: fixture.live, settings: fixture.selected)
        accepted.close()
        RestoreHistoryProtocol.reset()
        let matching = try fixture.store.wavelogConfiguration(for: fixture.selected, token: "wl2_fixture")
        let report = try await SyncEngine(database: database, configuration: matching, session: session).synchronize()
        XCTAssertEqual(report.deleted, 0)
        XCTAssertGreaterThanOrEqual(RestoreHistoryProtocol.requests, 3)
        XCTAssertEqual(try database.lookup(localID: original.id)?.call, "K2RESTORED")
        XCTAssertEqual(try database.lookup(localID: original.id)?.wavelogID, 42)
        XCTAssertFalse(try XCTUnwrap(database.lookup(localID: original.id)).isDirty)
    }

    func testExplicitGuardedDestinationSaveRebindsAnEntirelyUnlinkedRestoredDatabase() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-native-empty-\(UUID())")
        let suite = "xlog-native-empty-\(UUID())"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite); try? FileManager.default.removeItem(at: root) }
        let fixture = try makeFixture(root: root, defaults: defaults)
        let manager = XLogBackupManager()
        let empty = try LogbookDatabase(url: root.appendingPathComponent("empty.sqlite"))
        let preview = try manager.create(database: empty, at: root.appendingPathComponent("empty.xlogbackup"),
                                         settings: fixture.old, preferences: preferences())
        empty.close()
        let safe = try preview.settingsForRestore(keeping: fixture.old, restoreSettings: false)
        let database = try NativeBackupRestoreOwner(settingsStore: fixture.store).restore(preview: preview,
            to: fixture.live, keeping: fixture.old, settingsAfterRestore: safe,
            recoveryPackageURL: fixture.recovery, referenceDataURL: nil)
        defer { database.close() }
        XCTAssertEqual(try database.linkedRemoteCount(), 0)
        var changed = safe
        changed.wavelogStationID = 2
        try fixture.store.save(changed, protecting: database)
        let reopened = try NativeBackupRestoreOwner.openDatabase(at: fixture.live, settings: changed)
        reopened.close()
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [RestoreHistoryProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        RestoreHistoryProtocol.reset()
        let destination = try fixture.store.wavelogConfiguration(for: changed, token: "wl2_fixture")
        _ = try await SyncEngine(database: database, configuration: destination, session: session).synchronize()
        XCTAssertGreaterThanOrEqual(RestoreHistoryProtocol.requests, 3)
        XCTAssertEqual(try database.fetchAll().first?.call, "K2RESTORED")
        XCTAssertEqual(try database.fetchAll().first?.wavelogID, 42)
    }

    func testIntegrationSettingsRebindsOnlyAnUnlinkedRestoredDatabaseAndMatchingSyncActuallyRuns() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-integration-restore-authority-\(UUID())")
        let suite = "xlog-integration-restore-authority-\(UUID())"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite); try? FileManager.default.removeItem(at: root) }
        let fixture = try makeFixture(root: root, defaults: defaults)
        let manager = XLogBackupManager()
        let empty = try LogbookDatabase(url: root.appendingPathComponent("empty.sqlite"))
        let preview = try manager.create(database: empty, at: root.appendingPathComponent("empty.xlogbackup"),
                                         settings: fixture.old, preferences: preferences())
        empty.close()
        let safe = try preview.settingsForRestore(keeping: fixture.old, restoreSettings: false)
        let database = try NativeBackupRestoreOwner(settingsStore: fixture.store).restore(preview: preview,
            to: fixture.live, keeping: fixture.old, settingsAfterRestore: safe,
            recoveryPackageURL: fixture.recovery, referenceDataURL: nil)
        defer { database.close() }
        let original = try database.integrationSettings(seed: safe)
        var changed = original.settings
        changed.logbookMode = .wavelog
        changed.wavelogStationID = 2
        let mutation = IntegrationSettingsMutation(operationID: UUID(), expectedRevision: original.revision, settings: changed)
        let receipt = try database.applyIntegrationSettings(mutation)
        XCTAssertEqual(receipt.snapshot.settings, changed)
        XCTAssertEqual(try database.linkedRemoteCount(), 0)
        let reopened = try NativeBackupRestoreOwner.openDatabase(at: fixture.live, settings: receipt.snapshot.settings)
        reopened.close()
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [RestoreHistoryProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        RestoreHistoryProtocol.reset()
        let destination = try WavelogConfiguration(baseURL: XCTUnwrap(URL(string: receipt.snapshot.settings.wavelogURL)),
            token: "wl2_fixture", stationID: receipt.snapshot.settings.wavelogStationID)
        _ = try await SyncEngine(database: database, configuration: destination, session: session).synchronize()
        XCTAssertGreaterThanOrEqual(RestoreHistoryProtocol.requests, 3)
        let linked = try XCTUnwrap(database.fetchAll().first)
        XCTAssertEqual(linked.call, "K2RESTORED")
        XCTAssertEqual(linked.wavelogID, 42)
        XCTAssertFalse(linked.isDirty)
        var forbidden = changed
        forbidden.wavelogStationID = 3
        XCTAssertThrowsError(try database.applyIntegrationSettings(IntegrationSettingsMutation(
            operationID: UUID(), expectedRevision: receipt.snapshot.revision, settings: forbidden))) {
            guard case WavelogDestinationError.linkedContacts = $0 else { return XCTFail("Expected linked authority rejection, got \($0)") }
        }
        XCTAssertEqual(try database.integrationSettings(seed: safe), receipt.snapshot)
        XCTAssertEqual(try database.lookup(localID: linked.id), linked)
        XCTAssertEqual(try database.applyIntegrationSettings(mutation), receipt)
        XCTAssertNoThrow(try database.validateRestoredWavelogAuthority(settings: changed))
    }

    func testLegacyLocalDatabaseCaptureRetainsItsExistingIntegrityLimits() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-native-legacy-\(UUID())")
        let suite = "xlog-native-legacy-\(UUID())"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite); try? FileManager.default.removeItem(at: root) }
        let fixture = try makeFixture(root: root, defaults: defaults)
        let manager = XLogBackupManager()
        let manifestURL = fixture.preview.packageURL.appendingPathComponent("manifest.json")
        var manifest = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: manifestURL)) as? [String: Any])
        manifest["formatVersion"] = 1
        try JSONSerialization.data(withJSONObject: manifest).write(to: manifestURL)
        try FileManager.default.removeItem(at: fixture.preview.packageURL.appendingPathComponent(BackupPackageSeal.filename))
        let envelope = try manager.prepareRestoreEnvelope(at: fixture.preview.packageURL)
        XCTAssertEqual(envelope.preview.manifest.formatVersion, 1)
        XCTAssertFalse(envelope.hasPackageSeal)
        XCTAssertThrowsError(try manager.prepareEnvelope(at: fixture.preview.packageURL))
        _ = try manager.installDatabase(from: envelope, to: root.appendingPathComponent("legacy-live.sqlite"))
        let restored = try LogbookDatabase(url: root.appendingPathComponent("legacy-live.sqlite"))
        defer { restored.close() }
        XCTAssertEqual(try restored.fetchAll().first?.call, "K2RESTORED")
        XCTAssertEqual(try restored.fetchAll().first?.wavelogID, 42)
    }

    func testLegacyDatabaseOnlyNativeRestoreKeepsANonNilReferenceDestinationUntouched() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-legacy-native-reference-control-\(UUID())")
        let suite = "xlog-legacy-native-reference-control-\(UUID())"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite); try? FileManager.default.removeItem(at: root) }
        let fixture = try makeFixture(root: root, defaults: defaults)
        let manager = XLogBackupManager()
        let manifestURL = fixture.preview.packageURL.appendingPathComponent("manifest.json")
        var manifest = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: manifestURL)) as? [String: Any])
        manifest["formatVersion"] = 1
        try JSONSerialization.data(withJSONObject: manifest).write(to: manifestURL)
        try FileManager.default.removeItem(at: fixture.preview.packageURL.appendingPathComponent(BackupPackageSeal.filename))
        let preview = try manager.inspect(at: fixture.preview.packageURL)
        XCTAssertFalse(preview.manifest.includesReferenceData)
        let reference = root.appendingPathComponent("native-default-reference")
        try FileManager.default.createDirectory(at: reference, withIntermediateDirectories: true)
        let sentinel = reference.appendingPathComponent("preserve.txt")
        try Data("existing-native-reference".utf8).write(to: sentinel)
        let database = try NativeBackupRestoreOwner(settingsStore: fixture.store).restore(preview: preview,
            to: fixture.live, keeping: fixture.old, settingsAfterRestore: fixture.selected,
            recoveryPackageURL: fixture.recovery, referenceDataURL: reference)
        defer { database.close() }
        XCTAssertEqual(try database.fetchAll().first?.call, "K2RESTORED")
        XCTAssertEqual(try database.fetchAll().first?.wavelogID, 42)
        XCTAssertEqual(try String(contentsOf: sentinel, encoding: .utf8), "existing-native-reference")
        XCTAssertEqual(fixture.store.load(), fixture.selected)
        XCTAssertTrue(FileManager.default.fileExists(atPath: fixture.recovery.path))
    }

    func testLegacyDatabaseAboveMemoryEnvelopeLimitUsesOneImmutableFileSnapshot() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-large-legacy-restore-\(UUID())")
        let suite = "xlog-large-legacy-restore-\(UUID())"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite); try? FileManager.default.removeItem(at: root) }
        let fixture = try makeFixture(root: root, defaults: defaults)
        let manager = XLogBackupManager()
        let source = fixture.preview.packageURL.appendingPathComponent("OM0RX-xLog.sqlite")
        let sparseBytes = UInt64(BackupPackageSeal.maximumBytes) + 4_096
        let writer = try FileHandle(forWritingTo: source)
        try writer.truncate(atOffset: sparseBytes)
        try writer.close()
        let manifestURL = fixture.preview.packageURL.appendingPathComponent("manifest.json")
        var manifest = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: manifestURL)) as? [String: Any])
        manifest["formatVersion"] = 1
        manifest["databaseBytes"] = sparseBytes
        manifest["databaseSHA256"] = try streamedSHA256(source)
        try JSONSerialization.data(withJSONObject: manifest).write(to: manifestURL)
        try FileManager.default.removeItem(at: fixture.preview.packageURL.appendingPathComponent(BackupPackageSeal.filename))
        let selected = try manager.inspect(at: fixture.preview.packageURL)
        XCTAssertGreaterThan(selected.manifest.databaseBytes, Int64(BackupPackageSeal.maximumBytes))
        // Existing public legacy behavior is the executed control; it hashes and
        // copies the sparse file without loading a database-sized Data value.
        let oldControlURL = root.appendingPathComponent("legacy-url-control.sqlite")
        _ = try manager.installDatabase(from: fixture.preview.packageURL, to: oldControlURL, expectedPreview: selected)
        let oldControl = try LogbookDatabase(url: oldControlURL)
        XCTAssertEqual(try oldControl.fetchAll().first?.call, "K2RESTORED")
        XCTAssertEqual(try oldControl.fetchAll().first?.wavelogID, 42)
        oldControl.close()
        XCTAssertEqual((try FileManager.default.attributesOfItem(atPath: source.path)[.size] as? NSNumber)?.uint64Value, sparseBytes)
        // The desired local envelope path must retain that legitimate legacy
        // compatibility while the sealed remote-memory contract stays bounded.
        let envelope = try manager.prepareRestoreEnvelope(at: fixture.preview.packageURL, expectedPreview: selected)
        XCTAssertFalse(envelope.hasPackageSeal)
        XCTAssertThrowsError(try manager.prepareEnvelope(at: fixture.preview.packageURL))
        let retained = root.appendingPathComponent("retained-original.xlogbackup")
        try FileManager.default.moveItem(at: fixture.preview.packageURL, to: retained)
        _ = try manager.installDatabase(from: envelope, to: root.appendingPathComponent("immutable-legacy.sqlite"))
        let restored = try LogbookDatabase(url: root.appendingPathComponent("immutable-legacy.sqlite"))
        defer { restored.close() }
        XCTAssertEqual(try restored.fetchAll().first?.call, "K2RESTORED")
        XCTAssertEqual(try restored.fetchAll().first?.wavelogID, 42)
        XCTAssertTrue(FileManager.default.fileExists(atPath: retained.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: fixture.recovery.path))
    }

    func testLegacyFileSnapshotSurvivesEnvelopeCopiesAndCleansUpAfterItsLastOwner() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-legacy-snapshot-lifetime-\(UUID())")
        let suite = "xlog-legacy-snapshot-lifetime-\(UUID())"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite); try? FileManager.default.removeItem(at: root) }
        let fixture = try makeFixture(root: root, defaults: defaults)
        let manager = XLogBackupManager()
        let manifestURL = fixture.preview.packageURL.appendingPathComponent("manifest.json")
        var manifest = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: manifestURL)) as? [String: Any])
        manifest["formatVersion"] = 1
        try JSONSerialization.data(withJSONObject: manifest).write(to: manifestURL)
        try FileManager.default.removeItem(at: fixture.preview.packageURL.appendingPathComponent(BackupPackageSeal.filename))
        var first: XLogBackupRestoreEnvelope? = try manager.prepareRestoreEnvelope(at: fixture.preview.packageURL)
        weak var owner = first?.legacyDatabaseSnapshot
        let directory = try XCTUnwrap(first?.legacyDatabaseSnapshot?.directory)
        XCTAssertTrue(FileManager.default.fileExists(atPath: directory.path))
        #if !os(Windows)
        let databaseURL = try XCTUnwrap(first?.legacyDatabaseSnapshot?.databaseURL)
        XCTAssertEqual((try FileManager.default.attributesOfItem(atPath: databaseURL.path)[.posixPermissions] as? NSNumber)?.intValue, 0o400)
        #endif
        var second = first
        first = nil
        XCTAssertNotNil(owner)
        try FileManager.default.moveItem(at: fixture.preview.packageURL, to: root.appendingPathComponent("retained-original.xlogbackup"))
        _ = try manager.installDatabase(from: XCTUnwrap(second), to: root.appendingPathComponent("copy-owned.sqlite"))
        let installed = try LogbookDatabase(url: root.appendingPathComponent("copy-owned.sqlite"))
        XCTAssertEqual(try installed.fetchAll().first?.call, "K2RESTORED")
        installed.close()
        second = nil
        XCTAssertNil(owner)
        XCTAssertFalse(FileManager.default.fileExists(atPath: directory.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: fixture.recovery.path))
    }

    func testNonDestinationSaveRemainsAvailableWithAClosedRestoredDatabase() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-native-closed-settings-\(UUID())")
        let suite = "xlog-native-closed-settings-\(UUID())"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite); try? FileManager.default.removeItem(at: root) }
        let fixture = try makeFixture(root: root, defaults: defaults)
        let database = try NativeBackupRestoreOwner(settingsStore: fixture.store).restore(preview: fixture.preview,
            to: fixture.live, keeping: fixture.old, settingsAfterRestore: fixture.selected,
            recoveryPackageURL: fixture.recovery, referenceDataURL: nil)
        database.close()
        var changed = fixture.selected
        changed.operatorCall = "VK8KEEP"
        try fixture.store.save(changed, protecting: database)
        XCTAssertEqual(fixture.store.load(), changed)
        var wrongDestination = changed
        wrongDestination.wavelogStationID = 3
        XCTAssertThrowsError(try fixture.store.save(wrongDestination, protecting: database))
        XCTAssertEqual(fixture.store.load(), changed)
        let reopened = try NativeBackupRestoreOwner.openDatabase(at: fixture.live, settings: changed)
        defer { reopened.close() }
        XCTAssertEqual(try reopened.fetchAll().first?.call, "K2RESTORED")
        XCTAssertEqual(try reopened.fetchAll().first?.wavelogID, 42)
    }

    func testLegacyUnsealedReferencesFailBeforeAnyNativePublication() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-native-legacy-reference-\(UUID())")
        let suite = "xlog-native-legacy-reference-\(UUID())"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite); try? FileManager.default.removeItem(at: root) }
        let reference = root.appendingPathComponent("source-reference")
        try FileManager.default.createDirectory(at: reference, withIntermediateDirectories: true)
        try Data("legacy-reference".utf8).write(to: reference.appendingPathComponent("identity.txt"))
        let fixture = try makeFixture(root: root, defaults: defaults, referenceDataURL: reference)
        let manifestURL = fixture.preview.packageURL.appendingPathComponent("manifest.json")
        var manifest = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: manifestURL)) as? [String: Any])
        manifest["formatVersion"] = 1
        try JSONSerialization.data(withJSONObject: manifest).write(to: manifestURL)
        try FileManager.default.removeItem(at: fixture.preview.packageURL.appendingPathComponent(BackupPackageSeal.filename))
        let manager = XLogBackupManager()
        let preview = try manager.inspect(at: fixture.preview.packageURL)
        XCTAssertThrowsError(try NativeBackupRestoreOwner(settingsStore: fixture.store).restore(preview: preview,
            to: fixture.live, keeping: fixture.old, settingsAfterRestore: fixture.selected,
            recoveryPackageURL: fixture.recovery, referenceDataURL: root.appendingPathComponent("live-reference")))
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent(".restore-incomplete").path))
        XCTAssertEqual(fixture.store.load(), fixture.old)
        let original = try LogbookDatabase(url: fixture.live)
        defer { original.close() }
        XCTAssertEqual(try original.fetchAll().first?.call, "K1AUTHORITY")
        XCTAssertTrue(FileManager.default.fileExists(atPath: fixture.recovery.path))
    }

    func testInterruptionChild() throws {
        guard let rootPath = ProcessInfo.processInfo.environment["XLOG_RESTORE_CHILD_ROOT"],
              let suite = ProcessInfo.processInfo.environment["XLOG_RESTORE_CHILD_SUITE"] else {
            throw XCTSkip("Only the disposable interruption parent starts this helper")
        }
        let root = URL(fileURLWithPath: rootPath).resolvingSymlinksInPath()
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        let store = SettingsStore(defaults: defaults)
        let old = store.load()
        let manager = XLogBackupManager()
        let preview = try manager.inspect(at: root.appendingPathComponent("selected.xlogbackup"))
        let selected = try preview.settingsForRestore(keeping: old, restoreSettings: true)
        let owner = NativeBackupRestoreOwner(settingsStore: store, manager: manager)
        owner.afterDatabasePublication = {
            let receipt = Checkpoint(pid: ProcessInfo.processInfo.processIdentifier,
                executable: URL(fileURLWithPath: CommandLine.arguments[0]).resolvingSymlinksInPath().path,
                root: root.path)
            try JSONEncoder().encode(receipt).write(to: root.appendingPathComponent("database-published.json"), options: .atomic)
            Thread.sleep(forTimeInterval: 25)
            throw Interruption.afterDatabase
        }
        _ = try owner.restore(preview: preview, to: root.appendingPathComponent("live.sqlite"),
            keeping: old, settingsAfterRestore: selected,
            recoveryPackageURL: root.appendingPathComponent("recovery.xlogbackup"), referenceDataURL: nil)
        XCTFail("Child must be terminated at the publication checkpoint")
    }

    private typealias Fixture = (store: SettingsStore, old: XLogSettings, selected: XLogSettings,
                                preview: XLogBackupPreview, live: URL, recovery: URL)

    private func makeFixture(root: URL, defaults: UserDefaults, referenceDataURL: URL? = nil) throws -> Fixture {
        let manager = XLogBackupManager()
        var old = XLogSettings.defaults
        old.wavelogURL = "https://restore.invalid"
        old.wavelogStationID = 1
        old.automaticSync = true
        let store = SettingsStore(defaults: defaults)
        store.save(old)
        let live = root.appendingPathComponent("live.sqlite")
        let database = try LogbookDatabase(url: live)
        try JSONEncoder().encode(old).write(to: root.appendingPathComponent("saved-settings-before-restore.json"), options: .atomic)
        try database.save(QSO(wavelogID: 42, call: "K1AUTHORITY", start: Date(timeIntervalSince1970: 1_700_000_000),
                              band: "20m", mode: "CW"), markDirty: false)
        let recovery = root.appendingPathComponent("recovery.xlogbackup")
        _ = try manager.create(database: database, at: recovery, settings: old, preferences: preferences())
        database.close()
        let backup = try LogbookDatabase(url: root.appendingPathComponent("source.sqlite"))
        defer { backup.close() }
        try backup.save(QSO(wavelogID: 42, call: "K2RESTORED", start: Date(timeIntervalSince1970: 1_700_000_000),
                            band: "20m", mode: "CW"), markDirty: false)
        var selected = old
        selected.wavelogStationID = 2
        let preview = try manager.create(database: backup, at: root.appendingPathComponent("selected.xlogbackup"),
                                        settings: selected, preferences: preferences(), referenceDataURL: referenceDataURL)
        selected.automaticSync = false
        return (store, old, selected, preview, live, recovery)
    }

    private func assertInterruptedAdmission(root: URL, fixture: Fixture, remoteID: Int) async throws {
        XCTAssertThrowsError(try NativeBackupRestoreOwner.openDatabase(at: fixture.live, settings: fixture.old))
        let database = try LogbookDatabase(url: fixture.live)
        defer { database.close() }
        let original = try XCTUnwrap(try database.fetchAll().first)
        XCTAssertEqual(original.call, "K2RESTORED")
        XCTAssertEqual(original.wavelogID, 42)
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [RestoreHistoryProtocol.self]
        let session = URLSession(configuration: config)
        defer { session.invalidateAndCancel() }
        // AppModel's timer and explicit Sync share this same actual engine admission.
        for intent in ["automatic", "manual"] {
            RestoreHistoryProtocol.reset(remoteID: remoteID)
            let saved = try fixture.store.wavelogConfiguration(for: fixture.store.load(), token: "wl2_fixture")
            do {
                _ = try await SyncEngine(database: database, configuration: saved, session: session).synchronize()
                XCTFail("\(intent) sync admitted an incomplete restore")
            } catch { }
            XCTAssertEqual(RestoreHistoryProtocol.requests, 0, "\(intent) must reject before provider requests")
            XCTAssertEqual(try database.lookup(localID: original.id)?.call, "K2RESTORED")
            XCTAssertNil(try database.lookup(localID: original.id)?.deletedAt)
        }
        XCTAssertTrue(FileManager.default.fileExists(atPath: fixture.recovery.path))
        let recovery = try LogbookDatabase(url: fixture.recovery.appendingPathComponent("OM0RX-xLog.sqlite"))
        defer { recovery.close() }
        XCTAssertEqual(try recovery.fetchAll().first?.call, "K1AUTHORITY")
    }

    private func preferences() -> XLogBackupPreferences {
        .init(deskBandMapBands: [], detachedBandMapBands: [], deskBandMapFollowsRadio: false,
              detachedBandMapLayout: "Adaptive grid", bandMapFontScale: 1,
              intelligenceBands: [], clusterSpotOpensFullEditor: false)
    }

    private func exportEvidenceIfRequested(root: URL) {
        guard let path = ProcessInfo.processInfo.environment["XLOG_RESTORE_EVIDENCE_ROOT"], !path.isEmpty else { return }
        do {
            let destination = URL(fileURLWithPath: path).appendingPathComponent(root.lastPathComponent)
            try FileManager.default.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
            try FileManager.default.copyItem(at: root, to: destination)
        } catch { XCTFail("Could not preserve explicitly requested private restore evidence: \(error)") }
    }

    private func streamedSHA256(_ url: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var hash = SHA256()
        while let chunk = try handle.read(upToCount: 1_048_576), !chunk.isEmpty { hash.update(data: chunk) }
        return hash.finalize().map { String(format: "%02x", $0) }.joined()
    }
}

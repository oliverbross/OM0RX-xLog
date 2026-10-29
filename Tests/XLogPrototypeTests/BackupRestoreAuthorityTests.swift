import Foundation
import XCTest
#if os(macOS)
@testable import XLogCore
#else
@testable import XLogPortableCore
#endif

final class BackupRestoreAuthorityTests: XCTestCase {
    func testKeepSettingsRejectsEitherDestinationCoordinateBeforeReplacingLinkedHistory() throws {
        try withBackup { preview, manager, root, saved in
            let live = try LogbookDatabase(url: root.appendingPathComponent("live.sqlite"))
            defer { live.close() }
            let existing = QSO(wavelogID: 42, call: "W9BEFORE", band: "20m", mode: "CW")
            try live.save(existing, markDirty: false)
            for changeURL in [true, false] {
                var current = saved
                if changeURL { current.wavelogURL = "https://destination-b.invalid" }
                else { current.wavelogStationID += 1 }
                XCTAssertThrowsError(try preview.settingsForRestore(keeping: current, restoreSettings: false)) {
                    guard case XLogBackupError.syncDestinationChange = $0 else {
                        return XCTFail("Expected destination rejection, got \($0)")
                    }
                }
                XCTAssertEqual(try live.lookup(localID: existing.id)?.call, "W9BEFORE")
                XCTAssertEqual(try live.linkedRemoteCount(), 1)
                XCTAssertFalse(try XCTUnwrap(live.lookup(localID: existing.id)).isDirty)
            }
            XCTAssertEqual(try manager.inspect(at: preview.packageURL), preview)
        }
    }

    func testMissingBackupSettingsCannotSilentlyRetainUnknownDestination() throws {
        try withBackup { preview, _, _, saved in
            var missing = preview
            missing.settings = nil
            for restoreSettings in [true, false] {
                XCTAssertThrowsError(try missing.settingsForRestore(keeping: saved, restoreSettings: restoreSettings)) {
                    guard case XLogBackupError.settingsMissing = $0 else {
                        return XCTFail("Expected missing-settings rejection, got \($0)")
                    }
                }
            }
        }
    }

    func testMatchingDestinationRetainsStationConfigurationButRequiresFreshSyncConsent() throws {
        try withBackup { preview, _, _, saved in
            var current = saved
            current.operatorCall = "VK8KEEP"
            current.gridSquare = "PH57"
            current.syncIntervalMinutes = 17
            current.automaticSync = true
            var expected = current
            expected.automaticSync = false
            XCTAssertEqual(try preview.settingsForRestore(keeping: current, restoreSettings: false), expected)
            XCTAssertTrue(current.automaticSync)
            XCTAssertEqual(preview.settings, saved)
        }
    }

    func testExplicitSettingsRestoreSelectsBackupAuthorityWithoutInheritingConsent() throws {
        try withBackup { preview, _, _, saved in
            var current = saved
            current.wavelogURL = "https://destination-b.invalid"
            current.wavelogStationID += 1
            current.operatorCall = "VK8CURRENT"
            var expected = saved
            expected.automaticSync = false
            XCTAssertEqual(try preview.settingsForRestore(keeping: current, restoreSettings: true), expected)
            XCTAssertTrue(try XCTUnwrap(preview.settings).automaticSync)
        }
    }

    func testAcceptedRestorePreservesLinkedIDsAndRecoveryHistoryWithoutDetachingOrUploading() throws {
        try withBackup { preview, manager, root, saved in
            let liveURL = root.appendingPathComponent("live.sqlite")
            let live = try LogbookDatabase(url: liveURL)
            let previous = QSO(wavelogID: 42, call: "W9BEFORE", band: "40m", mode: "SSB")
            try live.save(previous, markDirty: false)
            let recovery = try manager.create(database: live, at: root.appendingPathComponent("recovery.xlogbackup"),
                                              settings: saved, preferences: preferences())
            let selected = try preview.settingsForRestore(keeping: saved, restoreSettings: false)
            XCTAssertFalse(selected.automaticSync)
            live.close()
            _ = try manager.installDatabase(from: preview.packageURL, to: liveURL, expectedPreview: preview)
            let restored = try LogbookDatabase(url: liveURL)
            defer { restored.close() }
            let rows = try restored.fetchAll()
            XCTAssertEqual(Set(rows.map(\.call)), ["K1BACKUP", "K2BACKUP"])
            XCTAssertEqual(Set(rows.compactMap(\.wavelogID)), [42, 43])
            XCTAssertTrue(rows.allSatisfy { !$0.isDirty })
            let recoveryDB = try LogbookDatabase(url: recovery.packageURL.appendingPathComponent("OM0RX-xLog.sqlite"))
            defer { recoveryDB.close() }
            XCTAssertEqual(try recoveryDB.lookup(localID: previous.id)?.call, "W9BEFORE")
        }
    }

    func testReplacementOfAnInspectedPackageCannotInstallAnotherDestination() throws {
        try withBackup { preview, manager, root, saved in
            _ = try preview.settingsForRestore(keeping: saved, restoreSettings: false)
            let replacementDB = try LogbookDatabase(url: root.appendingPathComponent("replacement.sqlite"))
            defer { replacementDB.close() }
            try replacementDB.save(QSO(wavelogID: 42, call: "W8REPLACED", band: "20m", mode: "CW"), markDirty: false)
            var other = saved
            other.wavelogURL = "https://destination-b.invalid"
            other.wavelogStationID = 2
            let replacement = try manager.create(database: replacementDB, at: root.appendingPathComponent("replacement.xlogbackup"),
                                                  settings: other, preferences: preferences())
            try FileManager.default.moveItem(at: preview.packageURL, to: root.appendingPathComponent("original.xlogbackup"))
            try FileManager.default.moveItem(at: replacement.packageURL, to: preview.packageURL)
            let liveURL = root.appendingPathComponent("live.sqlite")
            let live = try LogbookDatabase(url: liveURL)
            let previous = QSO(wavelogID: 42, call: "W9BEFORE", band: "40m", mode: "SSB")
            try live.save(previous, markDirty: false)
            live.close()
            XCTAssertThrowsError(try manager.installDatabase(from: preview.packageURL, to: liveURL, expectedPreview: preview)) {
                guard case XLogBackupError.packageChanged = $0 else {
                    return XCTFail("Expected changed-package rejection, got \($0)")
                }
            }
            let reopened = try LogbookDatabase(url: liveURL)
            defer { reopened.close() }
            XCTAssertEqual(try reopened.lookup(localID: previous.id)?.call, "W9BEFORE")
            XCTAssertEqual(try reopened.count(), 1)
        }
    }

    private func preferences() -> XLogBackupPreferences {
        .init(deskBandMapBands: [], detachedBandMapBands: [], deskBandMapFollowsRadio: false,
              detachedBandMapLayout: "Adaptive grid", bandMapFontScale: 1,
              intelligenceBands: [], clusterSpotOpensFullEditor: false)
    }

    private func withBackup(_ body: (XLogBackupPreview, XLogBackupManager, URL, XLogSettings) throws -> Void) throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-restore-authority-\(UUID())")
        defer { try? FileManager.default.removeItem(at: root) }
        let source = try LogbookDatabase(url: root.appendingPathComponent("source.sqlite"))
        defer { source.close() }
        try source.save(QSO(wavelogID: 42, call: "K1BACKUP", band: "20m", mode: "CW"), markDirty: false)
        try source.save(QSO(wavelogID: 43, call: "K2BACKUP", band: "40m", mode: "CW"), markDirty: false)
        var settings = XLogSettings.defaults
        settings.wavelogURL = "https://destination-a.invalid"
        settings.wavelogStationID = 1
        settings.automaticSync = true
        let manager = XLogBackupManager()
        let preview = try manager.create(database: source, at: root.appendingPathComponent("source.xlogbackup"),
                                         settings: settings, preferences: preferences())
        try body(preview, manager, root, settings)
    }
}

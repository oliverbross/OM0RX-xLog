import Foundation
import XCTest
@testable import XLogPrototypeSupport
#if canImport(XLogCore)
@testable import XLogCore
#else
@testable import XLogPortableCore
#endif

final class AppRuntimeProfileTests: XCTestCase {
    private func bundledExecutable(identifier: String) throws -> (URL, URL) {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-bundle-\(UUID().uuidString)")
        let contents = root.appendingPathComponent("Test.app/Contents", isDirectory: true)
        let executable = contents.appendingPathComponent("MacOS/xlog-prototype-worker")
        try FileManager.default.createDirectory(at: executable.deletingLastPathComponent(), withIntermediateDirectories: true)
        let plist = try PropertyListSerialization.data(fromPropertyList: ["CFBundleIdentifier": identifier], format: .xml, options: 0)
        try plist.write(to: contents.appendingPathComponent("Info.plist"))
        return (root, executable)
    }

    func testProductionProfileRemainsDefaultAndRejectsUnknownProfile() throws {
        let executable = URL(fileURLWithPath: "/tmp/xlog-prototype-worker")
        XCTAssertEqual(try AppRuntimeProfile.resolve(arguments: [], executableURL: executable), .production)
        XCTAssertThrowsError(try AppRuntimeProfile.resolve(
            arguments: ["--runtime-profile=unknown"], executableURL: executable))
        XCTAssertThrowsError(try AppRuntimeProfile.resolve(
            arguments: [AppRuntimeProfile.contestingArgument], executableURL: executable))
    }

    func testContestingBundleRequiresExplicitBoundProfile() throws {
        let (root, executable) = try bundledExecutable(identifier: AppRuntimeProfile.contestingBundleIdentifier)
        defer { try? FileManager.default.removeItem(at: root) }
        XCTAssertThrowsError(try AppRuntimeProfile.resolve(arguments: [], executableURL: executable))
        guard case .contestingTest = try AppRuntimeProfile.resolve(
            arguments: [AppRuntimeProfile.contestingArgument], executableURL: executable) else {
            return XCTFail("Expected bound test profile")
        }
        guard case .contestingTest = try AppRuntimeProfile.resolve(
            arguments: [AppRuntimeProfile.contestingArgument, AppRuntimeProfile.localAcceptanceArgument],
            executableURL: executable) else {
            return XCTFail("Expected bound test profile during local acceptance")
        }
    }

    func testWorkerServiceArgumentsComposeExactlyAndFailClosed() {
        XCTAssertEqual(AppRuntimeProfile.workerServiceLocalAcceptance(arguments: []), false)
        XCTAssertEqual(AppRuntimeProfile.workerServiceLocalAcceptance(
            arguments: [AppRuntimeProfile.contestingArgument]), false)
        XCTAssertEqual(AppRuntimeProfile.workerServiceLocalAcceptance(
            arguments: [AppRuntimeProfile.localAcceptanceArgument]), true)
        XCTAssertEqual(AppRuntimeProfile.workerServiceLocalAcceptance(arguments: [
            AppRuntimeProfile.contestingArgument, AppRuntimeProfile.localAcceptanceArgument,
        ]), true)
        for arguments in [
            [AppRuntimeProfile.localAcceptanceArgument, AppRuntimeProfile.contestingArgument],
            [AppRuntimeProfile.localAcceptanceArgument, AppRuntimeProfile.localAcceptanceArgument],
            [AppRuntimeProfile.contestingArgument, AppRuntimeProfile.contestingArgument],
            ["--runtime-profile=unknown"],
        ] {
            XCTAssertNil(AppRuntimeProfile.workerServiceLocalAcceptance(arguments: arguments))
        }
    }

    func testContestingProfileRejectsProductionPathAliasThroughSymlink() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-profile-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let production = root.appendingPathComponent("OM0RX-xLog", isDirectory: true)
        try FileManager.default.createDirectory(at: production, withIntermediateDirectories: false)
        try FileManager.default.createSymbolicLink(
            at: root.appendingPathComponent("OM0RX-xLog Contesting Test"),
            withDestinationURL: production)
        XCTAssertThrowsError(try AppRuntimeProfile.contestingTestProfile(applicationSupport: root))
    }

    func testContestingWorkspaceIsEmptyOnlyAndUsesExclusiveIdentity() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-contest-test-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let profile = try AppRuntimeProfile.contestingTestProfile(applicationSupport: root)
        guard case .contestingTest(let supportRoot) = profile else { return XCTFail("Expected test profile") }
        let service = LiveLogbookMethods(supportDirectory: supportRoot,
            inheritNativePreferences: false, runtimeProfile: profile)

        XCTAssertThrowsError(try service.handle(method: "workspace_create", params: ["mode": "copy_native"]))
        let created = try service.handle(method: "workspace_create", params: ["mode": "empty"])
        XCTAssertEqual(created["qso_count"] as? Int, 0)
        let workspace = try IntegrationWorkspaceBootstrap.open(at: service.workspaceDirectoryURL,
            expectedIdentityPrefix: AppRuntimeProfile.contestingIdentityPrefix)
        XCTAssertTrue(workspace.defaultsSuiteName.hasPrefix(AppRuntimeProfile.contestingIdentityPrefix))
        XCTAssertTrue(workspace.keychainService.hasPrefix(AppRuntimeProfile.contestingIdentityPrefix))
        XCTAssertFalse(workspace.defaultsSuiteName.hasPrefix("com.oliverbross.OM0RXXLog.Integration."))
    }

    func testContestingWorkspaceRejectsProductionNamespaceOnReopen() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-contest-namespace-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let profile = try AppRuntimeProfile.contestingTestProfile(applicationSupport: root)
        guard case .contestingTest(let supportRoot) = profile else { return XCTFail("Expected test profile") }
        let service = LiveLogbookMethods(supportDirectory: supportRoot,
            inheritNativePreferences: false, runtimeProfile: profile)
        _ = try service.handle(method: "workspace_create", params: ["mode": "empty"])
        let metadataURL = service.workspaceDirectoryURL.appendingPathComponent("workspace.json")
        let metadata = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: metadataURL)) as? [String: Any])
        let identifier = UUID().uuidString.lowercased()
        var replaced = metadata
        replaced["defaultsSuiteName"] = "com.oliverbross.OM0RXXLog.Integration.\(identifier)"
        replaced["keychainService"] = "com.oliverbross.OM0RXXLog.Integration.\(identifier)"
        try JSONSerialization.data(withJSONObject: replaced).write(to: metadataURL, options: .atomic)
        let reopened = LiveLogbookMethods(supportDirectory: supportRoot,
            inheritNativePreferences: false, runtimeProfile: profile)
        XCTAssertThrowsError(try reopened.handle(method: "workspace_status", params: [:]))
    }

    func testContestingWorkspaceRejectsHardLinkToRealProductionDatabase() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-contest-hardlink-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let productionURL = root.appendingPathComponent("OM0RX-xLog/OM0RX-xLog.sqlite")
        let production = try LogbookDatabase(url: productionURL)
        production.close()
        let profile = try AppRuntimeProfile.contestingTestProfile(applicationSupport: root)
        guard case .contestingTest(let supportRoot) = profile else { return XCTFail("Expected test profile") }
        let service = LiveLogbookMethods(supportDirectory: supportRoot,
            inheritNativePreferences: false, runtimeProfile: profile)
        _ = try service.handle(method: "workspace_create", params: ["mode": "empty"])
        let isolatedURL = service.workspaceDirectoryURL.appendingPathComponent("OM0RX-xLog.sqlite")
        try FileManager.default.removeItem(at: isolatedURL)
        try FileManager.default.linkItem(at: productionURL, to: isolatedURL)
        let reopened = LiveLogbookMethods(supportDirectory: supportRoot,
            inheritNativePreferences: false, runtimeProfile: profile)
        XCTAssertThrowsError(try reopened.handle(method: "workspace_status", params: [:]))
    }

    func testContestingWorkspaceRejectsIntegratedPreviewHardLinkBeforeOpen() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-contest-preview-hardlink-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let productionURL = root.appendingPathComponent("OM0RX-xLog-Integrated Preview/OM0RX-xLog.sqlite")
        let production = try LogbookDatabase(url: productionURL)
        production.close()
        let profile = try AppRuntimeProfile.contestingTestProfile(applicationSupport: root)
        guard case .contestingTest(let supportRoot) = profile else { return XCTFail("Expected test profile") }
        let service = LiveLogbookMethods(supportDirectory: supportRoot,
            inheritNativePreferences: false, runtimeProfile: profile)
        _ = try service.handle(method: "workspace_create", params: ["mode": "empty"])
        let isolatedURL = service.workspaceDirectoryURL.appendingPathComponent("OM0RX-xLog.sqlite")
        try FileManager.default.removeItem(at: isolatedURL)
        try FileManager.default.linkItem(at: productionURL, to: isolatedURL)
        let reopened = LiveLogbookMethods(supportDirectory: supportRoot,
            inheritNativePreferences: false, runtimeProfile: profile)
        XCTAssertThrowsError(try reopened.handle(method: "workspace_status", params: [:]))
    }

    func testContestingWorkspaceRejectsSymlinkAncestorBeforeOpen() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-contest-ancestor-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let profile = try AppRuntimeProfile.contestingTestProfile(applicationSupport: root)
        guard case .contestingTest(let supportRoot) = profile else { return XCTFail("Expected test profile") }
        let service = LiveLogbookMethods(supportDirectory: supportRoot,
            inheritNativePreferences: false, runtimeProfile: profile)
        _ = try service.handle(method: "workspace_create", params: ["mode": "empty"])
        let relocated = root.appendingPathComponent("relocated-test-data")
        try FileManager.default.moveItem(at: supportRoot, to: relocated)
        try FileManager.default.createSymbolicLink(at: supportRoot, withDestinationURL: relocated)
        let reopened = LiveLogbookMethods(supportDirectory: supportRoot,
            inheritNativePreferences: false, runtimeProfile: profile)
        XCTAssertThrowsError(try reopened.handle(method: "workspace_status", params: [:]))
    }

    #if os(macOS)
    func testDisabledWSJTXOwnerDoesNotStartPersistedEnabledReceiver() async throws {
        final class Receiver: WSJTXDatagramReceiving, @unchecked Sendable {
            var starts = 0
            func start(address: String, port: UInt16) throws { starts += 1 }
            func stop() {}
        }
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-contest-wsjtx-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let configurationURL = root.appendingPathComponent("wsjtx.json")
        try JSONSerialization.data(withJSONObject: ["enabled": true, "address": "127.0.0.1", "port": 2_237])
            .write(to: configurationURL)
        let receiver = Receiver()
        let bridge = LiveWSJTXBridge(configurationURL: configurationURL,
            workspaceAvailable: { true }, importer: { _ in (0, 0) }, externalIOAllowed: { false },
            receiverFactory: { _, _ in receiver })
        await bridge.startIfEnabled()
        XCTAssertEqual(receiver.starts, 0)
    }
    #endif

    func testContestingMutationsCannotScheduleOnlineDelivery() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-contest-hooks-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let profile = try AppRuntimeProfile.contestingTestProfile(applicationSupport: root)
        guard case .contestingTest(let supportRoot) = profile else { return XCTFail("Expected test profile") }
        let logbook = LiveLogbookMethods(supportDirectory: supportRoot,
            inheritNativePreferences: false, runtimeProfile: profile)
        _ = try logbook.handle(method: "workspace_create", params: ["mode": "empty"])
        var qso = try XCTUnwrap(logbook.handle(method: "logbook_draft", params: [:])["qso"] as? [String: Any])
        qso["call"] = "OM0RX"
        let backup = try logbook.handle(method: "backup_create", params: ["name": "isolated-hooks"])
        let backupName = try XCTUnwrap(backup["name"] as? String)
        let online = LiveOnlineLogDeliveryService(logbook: logbook, externalIOAllowed: { false },
            credential: { XCTFail("Credential vault must remain unopened"); return nil },
            delivery: { _, _, _, _ in XCTFail("Network delivery must remain unused"); throw CancellationError() })
        let worker = LiveWorker(logbook: logbook, onlineLogs: online, runtimeProfile: profile)

        for (id, method, params): (String, String, [String: Any]) in [
            ("save", "logbook_save", ["qso": qso]),
            ("restore", "backup_restore", ["name": backupName, "confirm_restore": true]),
        ] {
            let request = try JSONSerialization.data(withJSONObject: ["id": id, "method": method, "params": params])
            let response = await worker.response(to: request)
            let object = try XCTUnwrap(JSONSerialization.jsonObject(with: response) as? [String: Any])
            XCTAssertEqual(object["ok"] as? Bool, true)
            let scheduled = await online.hasScheduledWorkForTesting()
            XCTAssertFalse(scheduled)
        }
    }

    func testContestingWorkerRejectsExternalServices() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-contest-worker-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let profile = try AppRuntimeProfile.contestingTestProfile(applicationSupport: root)
        guard case .contestingTest(let supportRoot) = profile else { return XCTFail("Expected test profile") }
        let logbook = LiveLogbookMethods(supportDirectory: supportRoot,
            inheritNativePreferences: false, runtimeProfile: profile)
        let worker = LiveWorker(logbook: logbook, runtimeProfile: profile)
        let request = try JSONSerialization.data(withJSONObject: [
            "id": "blocked", "method": "cluster_connect", "params": [:],
        ])
        let response = await worker.response(to: request)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: response) as? [String: Any])
        XCTAssertEqual(object["ok"] as? Bool, false)
        XCTAssertEqual((object["error"] as? [String: Any])?["code"] as? String, "external_io_disabled")
    }
}

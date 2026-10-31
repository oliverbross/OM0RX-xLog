import Foundation
import XCTest
@testable import XLogPrototypeSupport
#if canImport(XLogCore)
@testable import XLogCore
#else
@testable import XLogPortableCore
#endif

final class AppRuntimeProfileTests: XCTestCase {
    func testOfflineCandidateAllowsHMControlProjectionButKeepsExternalServicesDisabled() async throws {
        let (bundleRoot, executable) = try bundledExecutable(identifier: "com.oliverbross.xlog.integration")
        let root = URL(fileURLWithPath: try AppRuntimeProfile.canonicalFilesystemPath(FileManager.default.temporaryDirectory), isDirectory: true)
            .appendingPathComponent("xlog-wave1-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: bundleRoot) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        try JSONSerialization.data(withJSONObject: ["schema": 1, "id": UUID().uuidString])
            .write(to: root.appendingPathComponent(".xlog-offline-acceptance.json"))
        let profile = try AppRuntimeProfile.resolve(arguments: [AppRuntimeProfile.offlineAcceptancePrefix + root.path], executableURL: executable)
        XCTAssertFalse(profile.externalIOAllowed)
        let logbook = LiveLogbookMethods(supportDirectory: try XCTUnwrap(profile.supportDirectory),
            inheritNativePreferences: false, runtimeProfile: profile)
        _ = try logbook.handle(method: "workspace_create", params: ["mode": "empty"])
        let context = try logbook.handle(method: "workspace_map_context", params: [:])
        let worker = LiveWorker(logbook: logbook, runtimeProfile: profile)
        let request = try JSONSerialization.data(withJSONObject: ["id": "hm-offline", "method": "hm_control_logbook", "params": [:]])
        let response = await worker.response(to: request)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: response) as? [String: Any])
        XCTAssertEqual(object["ok"] as? Bool, true)
        let result = try XCTUnwrap(object["result"] as? [String: Any])
        XCTAssertEqual(result["generation"] as? String, context["generation"] as? String)
        XCTAssertEqual((result["logbook"] as? [String: Any])?["total"] as? Int, 0)
        // Exercise the production dispatch branch against the same disposable
        // log, with local acceptance fencing all external service effects.
        let normal = LiveWorker(logbook: logbook, localAcceptance: true, runtimeProfile: .production)
        let normalResponse = await normal.response(to: request)
        let normalObject = try XCTUnwrap(JSONSerialization.jsonObject(with: normalResponse) as? [String: Any])
        XCTAssertEqual(normalObject["ok"] as? Bool, true)
        XCTAssertEqual((normalObject["result"] as? [String: Any])?["generation"] as? String, context["generation"] as? String)
        for method in ["station_connect", "cluster_connect", "wsjtx_start"] {
            let blocked = try JSONSerialization.data(withJSONObject: ["id": method, "method": method, "params": [:]])
            let reply = await worker.response(to: blocked)
            let failure = try XCTUnwrap(JSONSerialization.jsonObject(with: reply) as? [String: Any])
            XCTAssertEqual((failure["error"] as? [String: Any])?["code"] as? String, "external_io_disabled", method)
        }
    }

    func testOfflineCandidateRequiresPrivateMarkedTemporaryRootAndDisablesExternalIO() throws {
        let (bundleRoot, executable) = try bundledExecutable(identifier: "com.oliverbross.xlog.integration")
        let root = URL(fileURLWithPath: try AppRuntimeProfile.canonicalFilesystemPath(FileManager.default.temporaryDirectory), isDirectory: true)
            .appendingPathComponent("xlog-wave1-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: bundleRoot) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        let argument = AppRuntimeProfile.offlineAcceptancePrefix + root.path
        XCTAssertThrowsError(try AppRuntimeProfile.resolve(arguments: [argument], executableURL: executable))
        let marker = root.appendingPathComponent(".xlog-offline-acceptance.json")
        try JSONSerialization.data(withJSONObject: ["schema":1,"id":UUID().uuidString]).write(to: marker)
        let profile = try AppRuntimeProfile.resolve(arguments: [argument], executableURL: executable)
        XCTAssertEqual(profile.supportDirectory, root.appendingPathComponent("worker", isDirectory: true))
        XCTAssertFalse(profile.externalIOAllowed)
        XCTAssertFalse(profile.contestN1MMUDPAllowed)
        XCTAssertFalse(profile.connectedLoopbackAcceptance)
        try JSONSerialization.data(withJSONObject:["schema":1,"id":UUID().uuidString,"connectedLoopback":true]).write(to:marker)
        XCTAssertTrue(profile.connectedLoopbackAcceptance)
        XCTAssertTrue(profile.contestN1MMUDPAllowed)
        XCTAssertFalse(profile.externalIOAllowed,"Loopback fixtures cannot grant station/output admission")
        XCTAssertEqual(AppRuntimeProfile.workerServiceLocalAcceptance(arguments: [argument]), false)
        XCTAssertThrowsError(try AppRuntimeProfile.resolve(arguments: [argument, argument], executableURL: executable))
        try FileManager.default.setAttributes([.posixPermissions:0o755], ofItemAtPath:root.path)
        XCTAssertThrowsError(try AppRuntimeProfile.resolve(arguments: [argument], executableURL: executable))
    }
    #if os(macOS)
    func testOfflineCandidateAcceptsRustCanonicalPrivateTemporaryPath() throws {
        let (bundleRoot, executable) = try bundledExecutable(identifier: "com.oliverbross.xlog.integration")
        let root = URL(fileURLWithPath: "/private/tmp/xlog-wave1-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: bundleRoot) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false, attributes: [.posixPermissions:0o700])
        try JSONSerialization.data(withJSONObject:["schema":1,"id":UUID().uuidString])
            .write(to:root.appendingPathComponent(".xlog-offline-acceptance.json"))
        let prefix = AppRuntimeProfile.offlineAcceptancePrefix
        XCTAssertEqual(try AppRuntimeProfile.canonicalFilesystemPath(root), root.path)
        let profile = try AppRuntimeProfile.resolve(arguments:[prefix + root.path], executableURL:executable)
        XCTAssertEqual(profile.supportDirectory, root.appendingPathComponent("worker", isDirectory:true))
        XCTAssertThrowsError(try AppRuntimeProfile.resolve(arguments:[prefix + root.path.replacingOccurrences(of:"/private/tmp/",with:"/tmp/")], executableURL:executable))
    }
    #endif
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

    func testContestHostN1MMUDPCapabilityIsProductionOnly() {
        let production = PythonContestLane.childEnvironment(
            n1mmUDPAllowed: AppRuntimeProfile.production.contestN1MMUDPAllowed)
        let contestingTest = PythonContestLane.childEnvironment(n1mmUDPAllowed:
            AppRuntimeProfile.contestingTest(supportRoot: URL(fileURLWithPath: "/tmp/contesting-test"))
                .contestN1MMUDPAllowed)

        XCTAssertEqual(production["XLOG_CONTEST_N1MM_UDP_ALLOWED"], "1")
        XCTAssertNil(contestingTest["XLOG_CONTEST_N1MM_UDP_ALLOWED"])
        XCTAssertEqual(Set(production.keys).subtracting(contestingTest.keys),
                       ["XLOG_CONTEST_N1MM_UDP_ALLOWED"])
        XCTAssertEqual(Set(contestingTest.keys).subtracting(production.keys), [])
    }

    func testContestHostEnvironmentUsesOnlyExplicitBundledCertificate() {
        let certificate = URL(fileURLWithPath:
            "/Applications/OM0RX-xLog.app/Contents/Frameworks/Python.framework/Versions/3.12/etc/openssl/cert.pem")
        let bound = PythonContestLane.childEnvironment(
            n1mmUDPAllowed: false, sslCertificateFileURL: certificate)
        let unbound = PythonContestLane.childEnvironment(n1mmUDPAllowed: false)

        XCTAssertEqual(bound["SSL_CERT_FILE"], certificate.path)
        XCTAssertNil(unbound["SSL_CERT_FILE"])
        XCTAssertNil(bound["SSL_CERT_DIR"])
        XCTAssertNil(bound["REQUESTS_CA_BUNDLE"])
        XCTAssertNil(bound["PATH"])
        XCTAssertEqual(Set(bound.keys).subtracting(unbound.keys), ["SSL_CERT_FILE"])
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
        for method in ["cluster_connect", "contest_scp_download", "wsjtx_start"] {
            let request = try JSONSerialization.data(withJSONObject: [
                "id": "blocked-\(method)", "method": method, "params": [:],
            ])
            let response = await worker.response(to: request)
            let object = try XCTUnwrap(JSONSerialization.jsonObject(with: response) as? [String: Any])
            XCTAssertEqual(object["ok"] as? Bool, false, method)
            XCTAssertEqual((object["error"] as? [String: Any])?["code"] as? String,
                           "external_io_disabled", method)
        }
    }
}

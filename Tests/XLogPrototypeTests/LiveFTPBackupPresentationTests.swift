#if os(macOS)
import Foundation
import Testing
@testable import XLogCore
@testable import XLogPrototypeSupport

@Suite("Native FTP backup presentation")
struct LiveFTPBackupPresentationTests {
    private final class Passwords: LiveFTPBackupPasswordSource, @unchecked Sendable {
        private let lock = NSLock()
        private var reads = 0
        let value: String?
        init(_ value: String? = "fixture-password") { self.value = value }
        func password(service: String) throws -> String? { lock.withLock { reads += 1 }; return value }
        var count: Int { lock.withLock { reads } }
    }

    private actor Client: FTPBackupClient {
        var uploads = 0, downloads = 0
        var stored = Data()
        var requiredTLS: [Bool] = []
        func createDirectoryAndUpload(url: URL, directory: String,
            credential: FTPBackupCredential, bytes: Data, requireTLS: Bool) async throws -> FTPBackupCreateResult {
            uploads += 1; stored = bytes; requiredTLS.append(requireTLS); return .created
        }
        func download(url: URL, credential: FTPBackupCredential,
            maximumBytes: Int, requireTLS: Bool) async throws -> Data {
            downloads += 1; requiredTLS.append(requireTLS); return stored
        }
    }

    private final class Clock: RemoteBackupClock, @unchecked Sendable {
        private let lock = NSLock()
        private var value = Date(timeIntervalSince1970: 10_000)
        func now() -> Date { lock.withLock { value } }
        func due() { lock.withLock { value = value.addingTimeInterval(3_600) } }
    }

    private final class Ticks: RemoteBackupTickSource, @unchecked Sendable {
        let stream: AsyncStream<Void>
        let continuation: AsyncStream<Void>.Continuation
        init() { (stream, continuation) = AsyncStream<Void>.makeStream() }
        func nextTick() async throws -> Bool {
            for await _ in stream { try Task.checkCancellation(); return true }
            try Task.checkCancellation(); return false
        }
        func emit() { continuation.yield(()) }
    }

    private struct Fixture {
        let root: URL
        let logbook: LiveLogbookMethods
        let service: LiveRemoteBackupService
        let presentation: LiveFTPBackupPresentation
        let passwords: Passwords
        let client: Client
        let ticks: Ticks
        let clock: Clock

        init(password: String? = "fixture-password") throws {
            let createdRoot = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-ftp-presentation-" + UUID().uuidString)
            let createdLogbook = LiveLogbookMethods(supportDirectory: createdRoot, inheritNativePreferences: false)
            _ = try createdLogbook.handle(method: "workspace_create", params: ["mode": "empty"])
            let createdPasswords = Passwords(password), createdClient = Client()
            let createdTicks = Ticks(), createdClock = Clock()
            let createdService = LiveRemoteBackupService(logbook: createdLogbook,
                clock: createdClock, ticks: { createdTicks })
            root = createdRoot; logbook = createdLogbook; passwords = createdPasswords
            client = createdClient; ticks = createdTicks; clock = createdClock; service = createdService
            presentation = LiveFTPBackupPresentation(logbook: createdLogbook, service: createdService,
                passwords: createdPasswords, client: createdClient)
        }

        func configure(protocol value: String = "ftps", consent: Bool = false) throws {
            let loaded = try logbook.handle(method: "settings_load", params: [:])
            var settings = loaded["settings"] as! [String: Any]
            settings["ftpBackup"] = ["protocol": value,
                "endpoint": value == "ftp" ? "ftp://backup.example.test:21" : "ftps://backup.example.test:990",
                "directory": "/xlog-fixture", "username": "fixture-user",
                "plainFTPConfirmed": consent]
            let result = try logbook.handle(method: "settings_save", params: [
                "operationID": UUID().uuidString,
                "expectedRevision": loaded["revision"]!,
                "generation": loaded["generation"]!,
                "settings": settings,
            ])
            #expect(result["status"] as? String == "applied")
        }

        func cleanup() {
            if let workspace = try? IntegrationWorkspaceBootstrap.open(at: logbook.workspaceDirectoryURL) {
                workspace.makeDefaults()?.removePersistentDomain(forName: workspace.defaultsSuiteName)
            }
            try? logbook.openedDatabase().close()
            try? FileManager.default.removeItem(at: root)
        }
    }

    private func command(_ presentation: LiveFTPBackupPresentation, _ action: String,
                         id: UUID = UUID()) async throws -> [String: Any] {
        let snapshot = try await presentation.handle(["action": "snapshot"])
        return ["action": action, "operation_id": id.uuidString, "owner": snapshot["owner"]!]
    }

    @Test("Native account identity is bound to the server, protocol and username")
    func accountIdentityBinding() throws {
        let generation = UUID()
        var settings = FTPBackupSettings()
        settings.protocol = .ftps
        settings.endpoint = "ftps://backup.example.test:990"
        settings.directory = "/xlog"
        settings.username = "operator-one"
        let first = try LiveFTPBackupConfigurationContext(workspaceGeneration: generation,
            settingsRevision: 1, settings: settings, keychainService: "fixture.keychain")
        settings.username = "operator-two"
        let changedUser = try LiveFTPBackupConfigurationContext(workspaceGeneration: generation,
            settingsRevision: 1, settings: settings, keychainService: "fixture.keychain")
        settings.username = "operator-one"
        settings.endpoint = "ftps://other.example.test:990"
        let changedServer = try LiveFTPBackupConfigurationContext(workspaceGeneration: generation,
            settingsRevision: 1, settings: settings, keychainService: "fixture.keychain")
        #expect(first.destination.accountID != changedUser.destination.accountID)
        #expect(first.destination.accountID != changedServer.destination.accountID)
        #expect(first.providerAccountID != changedUser.providerAccountID)
    }

    @Test("Passive reads stay credential-free and explicit FTPS flow verifies exact bytes without replay")
    func explicitFTPSFlow() async throws {
        let fixture = try Fixture(); defer { fixture.cleanup() }
        var state = try await fixture.presentation.handle(["action": "snapshot"])
        #expect(state["available"] as? Bool == true)
        #expect(state["configured"] as? Bool == false)
        #expect(fixture.passwords.count == 0)
        #expect(await fixture.client.uploads == 0)
        #expect(!FileManager.default.fileExists(atPath: fixture.logbook.workspaceDirectoryURL
            .appendingPathComponent("Remote Backup").path))

        try fixture.configure()
        state = try await fixture.presentation.handle(["action": "snapshot"])
        #expect(state["configured"] as? Bool == true)
        #expect(state["provider"] as? String == "ftps")
        #expect(fixture.passwords.count == 0)

        for action in ["prepare", "verify_account", "approve"] {
            let receipt = try await fixture.presentation.handle(command(fixture.presentation, action))
            #expect(receipt["status"] as? String == "acknowledged")
        }
        #expect(fixture.passwords.count == 1)
        #expect(await fixture.client.uploads == 0)

        let start = try await command(fixture.presentation, "start")
        let first = try await fixture.presentation.handle(start)
        let repeated = try await fixture.presentation.handle(start)
        #expect(first["status"] as? String == "acknowledged")
        let afterStart = try await fixture.presentation.handle(["action": "snapshot"])
        #expect(afterStart["last_error_code"] == nil)
        #expect(NSDictionary(dictionary: first).isEqual(to: repeated))
        #expect(await fixture.client.uploads == 0)
        let task = try #require(await fixture.service.currentTask)
        fixture.clock.due(); fixture.ticks.emit(); await task.value
        #expect(await fixture.client.uploads == 1)
        #expect(await fixture.client.downloads == 1)
        #expect(await fixture.client.requiredTLS == [true, true])

        state = try await fixture.presentation.handle(["action": "snapshot"])
        #expect(state["upload_outcome"] as? String == "verified")
        #expect(state["remote_identity_recorded"] as? Bool == true)
        let restore = try await fixture.presentation.handle(command(fixture.presentation, "stage_restore"))
        #expect(restore["status"] as? String == "acknowledged")
        state = try await fixture.presentation.handle(["action": "snapshot"])
        #expect((state["staged_restore"] as? [String: Any])?["qso_count"] as? Int == 0)
        #expect(await fixture.client.uploads == 1)
        #expect(await fixture.client.downloads == 2)
    }

    @Test("Plain FTP requires explicit insecure consent and a missing password never contacts the server")
    func plainFTPConsentAndMissingPassword() async throws {
        let invalid = try Fixture(password: nil); defer { invalid.cleanup() }
        #expect(throws: WorkerFailure.self) { try invalid.configure(protocol: "ftp", consent: false) }
        try invalid.configure(protocol: "ftp", consent: true)
        _ = try await invalid.presentation.handle(command(invalid.presentation, "prepare"))
        let receipt = try await invalid.presentation.handle(command(invalid.presentation, "verify_account"))
        #expect(receipt["status"] as? String == "unknown")
        let state = try await invalid.presentation.handle(["action": "snapshot"])
        #expect(state["last_error_code"] as? String == "credential_unavailable")
        #expect(invalid.passwords.count == 1)
        #expect(await invalid.client.uploads == 0)
        #expect(await invalid.client.downloads == 0)
    }

    @Test("Settings retirement stops work and revokes the in-memory prepared authority")
    func settingsRetirement() async throws {
        let fixture = try Fixture(); defer { fixture.cleanup() }
        try fixture.configure()
        for action in ["prepare", "verify_account", "approve"] {
            _ = try await fixture.presentation.handle(command(fixture.presentation, action))
        }
        await fixture.presentation.retireConfiguration()
        let state = try await fixture.presentation.handle(["action": "snapshot"])
        #expect(state["prepared"] as? Bool == false)
        #expect(state["approved"] as? Bool == false)
        #expect(await fixture.service.isRunning == false)
    }

    @Test("The production worker routes passive FTP status without reading credentials or contacting a server")
    func productionWorkerWiringIsPassive() async throws {
        let fixture = try Fixture(); defer { fixture.cleanup() }
        try fixture.configure()
        let worker = LiveWorker(logbook: fixture.logbook,
            remoteBackup: fixture.service, ownsProcessSessions: true)
        let input = try JSONSerialization.data(withJSONObject: [
            "id": "ftp-snapshot", "method": "remote_backup_request",
            "params": ["action": "snapshot"],
        ])
        let output = await worker.response(to: input)
        let response = try #require(try JSONSerialization.jsonObject(with: output) as? [String: Any])
        #expect(response["error"] == nil)
        let result = try #require(response["result"] as? [String: Any])
        #expect(result["available"] as? Bool == true)
        #expect(result["configured"] as? Bool == true)
        #expect(result["provider"] as? String == "ftps")
        #expect(await fixture.client.uploads == 0)
        #expect(await fixture.client.downloads == 0)
        #expect(!FileManager.default.fileExists(atPath: fixture.logbook.workspaceDirectoryURL
            .appendingPathComponent("Remote Backup").path))
        await worker.shutdown()
    }
}
#endif

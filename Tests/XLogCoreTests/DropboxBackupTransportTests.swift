import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import Testing
#if os(macOS)
@testable import XLogCore
#else
@testable import XLogPortableCore
#endif

@Suite struct DropboxBackupTransportTests {
    private struct Credentials: DropboxBackupCredentialSource {
        let value: DropboxBackupCredential
        func credential(for accountID: UUID) async throws -> DropboxBackupCredential { value }
    }

    private struct Step: Sendable {
        let status: Int
        let body: Data
        var headers: [String: String] = [:]
        var url: URL?
        var fail = false
    }

    private actor HTTP: DropboxBackupHTTPClient {
        var steps: [Step]
        var requests: [URLRequest] = []
        init(_ steps: [Step]) { self.steps = steps }
        func send(_ request: URLRequest, maximumResponseBytes: Int) async throws -> DropboxBackupHTTPResponse {
            requests.append(request)
            guard !steps.isEmpty else { throw DropboxBackupError.requestFailed }
            let step = steps.removeFirst()
            if step.fail { throw URLError(.timedOut, userInfo: [NSLocalizedDescriptionKey: "untrusted-provider-detail"]) }
            return DropboxBackupHTTPResponse(url: step.url ?? request.url!, statusCode: step.status,
                headers: step.headers, body: step.body)
        }
    }

    private func fixture() throws -> (RemoteBackupUploadPlan, Data, Credentials) {
        let data = Data("isolated frozen backup bytes".utf8)
        let destination = try RemoteBackupDestination(id: UUID(), revision: 1, provider: .dropbox,
            accountID: UUID(), location: .cloudFolder(id: "id:Fixture_Folder"))
        let plan = try RemoteBackupUploadPlan(workspaceGeneration: UUID(), destination: destination,
            backupID: UUID(), package: RemoteBackupPackageIdentity(sha256: BackupPackageSeal.hash(data), byteCount: Int64(data.count)))
        let credential = try DropboxBackupCredential(accountID: destination.accountID,
            providerAccountID: "dbid:fixture-account", accessToken: "fixture-only-not-a-real-token")
        return (plan, data, Credentials(value: credential))
    }

    private func account(_ id: String = "dbid:fixture-account") throws -> Step {
        Step(status: 200, body: try JSONSerialization.data(withJSONObject: ["account_id": id]))
    }

    private func metadata(_ plan: RemoteBackupUploadPlan, id: String = "id:created-object", rev: String = "abcdef123456") throws -> Data {
        try JSONSerialization.data(withJSONObject: ["id": id, "name": plan.objectName, "rev": rev,
            "size": plan.package.byteCount, "content_hash": String(repeating: "0", count: 64)])
    }

    private func deletionCandidate(_ plan: RemoteBackupUploadPlan) throws -> RemoteBackupUploadReceipt {
        try RemoteBackupUploadReceipt(plan: plan,
            outcome: .verified(package: plan.package, at: Date(timeIntervalSince1970: 1)),
            remoteObject: RemoteBackupVerifiedObject(provider: .dropbox,
                providerAccountID: "dbid:fixture-account", objectID: "id:created-object",
                revision: "abcdef123456"))
    }

    @Test func revisionConditionalDeletionIsDurablyClaimedAndNeverReplayed() async throws {
        let (plan, _, credentials) = try fixture()
        let candidate = try deletionCandidate(plan)
        let deleted = try JSONSerialization.data(withJSONObject: ["metadata": [
            "id": "id:created-object", "name": plan.objectName, "rev": "abcdef123456",
            "size": plan.package.byteCount, "content_hash": String(repeating: "0", count: 64)]])
        let http = HTTP([try account(), Step(status: 200, body: deleted)])
        let transport = try DropboxBackupTransport(destination: plan.destination,
            credentials: credentials, http: http)
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("xlog-dropbox-deletion-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let coordinator = try RemoteBackupDeletionCoordinator(stateDirectory: root)
        let receipt = try await coordinator.delete(candidate: candidate,
            workspaceGeneration: plan.workspaceGeneration, destination: plan.destination,
            transport: transport, at: Date(timeIntervalSince1970: 2))
        #expect(receipt.candidate == candidate)
        #expect(receipt.deletedAt == Date(timeIntervalSince1970: 2))
        #expect(try RemoteBackupDeletionCoordinator.claimedBackupIDs(stateDirectory: root) == [plan.backupID])
        let requests = await http.requests
        #expect(requests.map(\.url) == [DropboxBackupTransport.accountURL, DropboxBackupTransport.deleteURL])
        let body = try #require(requests[1].httpBody)
        let arguments = try #require(JSONSerialization.jsonObject(with: body) as? [String: String])
        #expect(arguments == ["path": "id:created-object", "parent_rev": "abcdef123456"])
        let unused = HTTP([])
        let restarted = try RemoteBackupDeletionCoordinator(stateDirectory: root)
        let replay = try DropboxBackupTransport(destination: plan.destination, credentials: credentials, http: unused)
        await #expect(throws: RemoteBackupExecutionError.operationInProgress) {
            try await restarted.delete(candidate: candidate, workspaceGeneration: plan.workspaceGeneration,
                destination: plan.destination, transport: replay)
        }
        #expect(await unused.requests.isEmpty)
    }

    @Test func ambiguousDeletionRemainsClaimedWithoutRetry() async throws {
        let (plan, _, credentials) = try fixture()
        let candidate = try deletionCandidate(plan)
        let http = HTTP([try account(), Step(status: 200, body: Data(), fail: true)])
        let transport = try DropboxBackupTransport(destination: plan.destination,
            credentials: credentials, http: http)
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("xlog-dropbox-deletion-uncertain-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let coordinator = try RemoteBackupDeletionCoordinator(stateDirectory: root)
        await #expect(throws: RemoteBackupDeletionError.executionUncertain) {
            try await coordinator.delete(candidate: candidate, workspaceGeneration: plan.workspaceGeneration,
                destination: plan.destination, transport: transport)
        }
        #expect(try RemoteBackupDeletionCoordinator.claimedBackupIDs(stateDirectory: root) == [plan.backupID])
        await #expect(throws: RemoteBackupExecutionError.operationInProgress) {
            try await coordinator.delete(candidate: candidate, workspaceGeneration: plan.workspaceGeneration,
                destination: plan.destination, transport: transport)
        }
        #expect(await http.requests.count == 2)
    }

    @Test func strictExclusiveCreateAndRevisionDownloadHashExactBytes() async throws {
        let (plan, bytes, credentials) = try fixture()
        let metadata = try metadata(plan)
        let http = HTTP([try account(), Step(status: 200, body: metadata), try account(),
            Step(status: 200, body: bytes, headers: ["Dropbox-API-Result": String(decoding: metadata, as: UTF8.self)])])
        let transport = try DropboxBackupTransport(destination: plan.destination, credentials: credentials, http: http)
        #expect(try await transport.createExclusively(plan: plan, bytes: bytes) == .created)
        await #expect(throws: DropboxBackupError.operationInProgress) { try await transport.verifiedRemoteObject(plan: plan) }
        #expect(try await transport.verifiedRemoteIdentity(plan: plan) == plan.package)
        #expect(try await transport.verifiedRemoteObject(plan: plan) == RemoteBackupVerifiedObject(provider: .dropbox,
            providerAccountID: "dbid:fixture-account", objectID: "id:created-object", revision: "abcdef123456"))
        let requests = await http.requests
        #expect(requests.count == 4)
        #expect(requests[0].url == DropboxBackupTransport.accountURL)
        #expect(requests[1].url == DropboxBackupTransport.uploadURL)
        #expect(requests[3].url == DropboxBackupTransport.downloadURL)
        #expect(requests.allSatisfy { $0.url?.scheme == "https" && $0.timeoutInterval == 30 })
        #expect(requests[1].httpBody == bytes)
        let upload = try #require(requests[1].value(forHTTPHeaderField: "Dropbox-API-Arg"))
        let arguments = try #require(JSONSerialization.jsonObject(with: Data(upload.utf8)) as? [String: Any])
        #expect(arguments["mode"] as? String == "add")
        #expect(arguments["autorename"] as? Bool == false)
        #expect(arguments["strict_conflict"] as? Bool == true)
        #expect(arguments["path"] as? String == "id:Fixture_Folder/" + plan.objectName)
        let download = try #require(requests[3].value(forHTTPHeaderField: "Dropbox-API-Arg"))
        #expect(download.contains("rev:abcdef123456"))
        #expect(!download.contains(plan.objectName))
        #expect(credentials.value.description == "DropboxBackupCredential(redacted)")
    }

    @Test func restoreDownloadsOnlyPinnedVerifiedRevisionAndRechecksExactBytes() async throws {
        let (plan, bytes, credentials) = try fixture()
        let receipt = try deletionCandidate(plan), metadata = try metadata(plan)
        let http = HTTP([try account(), Step(status: 200, body: bytes,
            headers: ["Dropbox-API-Result": String(decoding: metadata, as: UTF8.self)])])
        let transport = try DropboxBackupTransport(destination: plan.destination,
            credentials: credentials, http: http)
        #expect(try await transport.downloadVerified(receipt: receipt) == bytes)
        let requests = await http.requests
        #expect(requests.map(\.url) == [DropboxBackupTransport.accountURL, DropboxBackupTransport.downloadURL])
        let header = try #require(requests.last?.value(forHTTPHeaderField: "Dropbox-API-Arg"))
        #expect(header.contains("rev:abcdef123456"))
        #expect(!header.contains(plan.objectName))

        let changed = Data("different frozen backup".utf8)
        let corrupt = HTTP([try account(), Step(status: 200, body: changed,
            headers: ["Dropbox-API-Result": String(decoding: metadata, as: UTF8.self)])])
        let rejected = try DropboxBackupTransport(destination: plan.destination,
            credentials: credentials, http: corrupt)
        await #expect(throws: DropboxBackupError.invalidResponse) {
            try await rejected.downloadVerified(receipt: receipt)
        }
    }

    @Test func executorVerifiesFrozenEnvelopeAndRestartsWithoutProviderReplay() async throws {
        let (initial, _, credentials) = try fixture()
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-dropbox-executor-\(UUID().uuidString)")
        let database = try LogbookDatabase(url: root.appendingPathComponent("isolated.sqlite"))
        defer { database.close(); try? FileManager.default.removeItem(at: root) }
        let manager = XLogBackupManager(), package = root.appendingPathComponent("fixture.xlogbackup")
        try manager.create(database: database, at: package, settings: .defaults,
            preferences: XLogBackupPreferences(deskBandMapBands: ["20m"], detachedBandMapBands: ["20m"],
                deskBandMapFollowsRadio: true, detachedBandMapLayout: "grid", bandMapFontScale: 1,
                intelligenceBands: ["20m"], clusterSpotOpensFullEditor: false))
        let envelope = try manager.prepareEnvelope(at: package)
        let plan = try RemoteBackupUploadPlan(workspaceGeneration: initial.workspaceGeneration,
            destination: initial.destination, backupID: initial.backupID, package: envelope.identity)
        let value = try metadata(plan)
        let http = HTTP([try account(), Step(status: 200, body: value), try account(),
            Step(status: 200, body: envelope.data, headers: ["Dropbox-API-Result": String(decoding: value, as: UTF8.self)])])
        let directory = root.appendingPathComponent("operations")
        let executor = try DropboxBackupExecutor(destination: plan.destination, stateDirectory: directory,
            credentials: credentials, http: http)
        let claim = RemoteBackupDueClaim(plan: plan, envelope: envelope,
            dueAt: Date(timeIntervalSince1970: 10_000), claimedAt: Date(timeIntervalSince1970: 10_000))
        let receipt = try await executor.execute(claim)
        guard case .verified(let identity, _) = receipt.outcome else { Issue.record("Expected independently verified bytes"); return }
        #expect(identity == envelope.identity)
        #expect(receipt.remoteObject?.objectID == "id:created-object")
        #expect(receipt.remoteObject?.revision == "abcdef123456")
        #expect(try RemoteBackupUploadCoordinator.persistedReceipts(stateDirectory: directory) == [receipt])
        let unused = HTTP([])
        let restarted = try DropboxBackupExecutor(destination: plan.destination, stateDirectory: directory,
            credentials: credentials, http: unused)
        #expect(try await restarted.execute(claim) == receipt)
        #expect(await unused.requests.isEmpty)
    }

    @Test func knownConflictCannotBeClaimedOrRetried() async throws {
        let (plan, bytes, credentials) = try fixture()
        let conflict = Data(#"{"error":{".tag":"path","path":{"reason":{".tag":"conflict","conflict":{".tag":"file"}}}}}"#.utf8)
        let http = HTTP([try account(), Step(status: 409, body: conflict)])
        let transport = try DropboxBackupTransport(destination: plan.destination, credentials: credentials, http: http)
        #expect(try await transport.createExclusively(plan: plan, bytes: bytes) == .conflict)
        await #expect(throws: DropboxBackupError.operationInProgress) {
            try await transport.verifiedRemoteIdentity(plan: plan)
        }
        await #expect(throws: DropboxBackupError.operationInProgress) {
            try await transport.createExclusively(plan: plan, bytes: bytes)
        }
        #expect(await http.requests.count == 2)
    }

    @Test func applicationAndProviderAccountsMustBothMatch() async throws {
        let (plan, bytes, credentials) = try fixture()
        let wrongApp = Credentials(value: try DropboxBackupCredential(accountID: UUID(),
            providerAccountID: credentials.value.providerAccountID, accessToken: "fixture"))
        let unused = HTTP([])
        let first = try DropboxBackupTransport(destination: plan.destination, credentials: wrongApp, http: unused)
        await #expect(throws: DropboxBackupError.accountMismatch) { try await first.createExclusively(plan: plan, bytes: bytes) }
        #expect(await unused.requests.isEmpty)
        let http = HTTP([try account("dbid:another-account")])
        let second = try DropboxBackupTransport(destination: plan.destination, credentials: credentials, http: http)
        await #expect(throws: DropboxBackupError.accountMismatch) { try await second.createExclusively(plan: plan, bytes: bytes) }
        #expect(await http.requests.count == 1)
    }

    @Test func swappedAccountOrRevisionCannotVerifyPreviouslyCreatedObject() async throws {
        let (plan, bytes, credentials) = try fixture()
        let metadata = try metadata(plan)
        let http = HTTP([try account(), Step(status: 200, body: metadata), try account("dbid:another-account")])
        let transport = try DropboxBackupTransport(destination: plan.destination, credentials: credentials, http: http)
        _ = try await transport.createExclusively(plan: plan, bytes: bytes)
        await #expect(throws: DropboxBackupError.accountMismatch) { try await transport.verifiedRemoteIdentity(plan: plan) }
        #expect(await http.requests.count == 3)
        let changed = try RemoteBackupDestination(id: plan.destination.id, revision: 2, provider: .dropbox,
            accountID: plan.destination.accountID, location: plan.destination.location)
        let rebound = try RemoteBackupUploadPlan(workspaceGeneration: plan.workspaceGeneration,
            destination: changed, backupID: plan.backupID, package: plan.package)
        await #expect(throws: RemoteBackupPlanningError.staleContext) {
            try await transport.createExclusively(plan: rebound, bytes: bytes)
        }
        #expect(await http.requests.count == 3)
    }

    @Test func independentHashIgnoresProviderContentHashAndRejectsWrongMetadata() async throws {
        let (plan, bytes, credentials) = try fixture()
        let uploaded = try metadata(plan)
        var altered = bytes
        altered[0] ^= 1
        let http = HTTP([try account(), Step(status: 200, body: uploaded), try account(),
            Step(status: 200, body: altered, headers: ["Dropbox-API-Result": String(decoding: uploaded, as: UTF8.self)])])
        let transport = try DropboxBackupTransport(destination: plan.destination, credentials: credentials, http: http)
        _ = try await transport.createExclusively(plan: plan, bytes: bytes)
        let observed = try await transport.verifiedRemoteIdentity(plan: plan)
        #expect(observed.sha256 == BackupPackageSeal.hash(altered))
        #expect(observed != plan.package)
        await #expect(throws: DropboxBackupError.operationInProgress) { try await transport.verifiedRemoteObject(plan: plan) }
        let wrong = try metadata(plan, id: "id:foreign-object")
        let other = HTTP([try account(), Step(status: 200, body: uploaded), try account(),
            Step(status: 200, body: bytes, headers: ["Dropbox-API-Result": String(decoding: wrong, as: UTF8.self)])])
        let rejected = try DropboxBackupTransport(destination: plan.destination, credentials: credentials, http: other)
        _ = try await rejected.createExclusively(plan: plan, bytes: bytes)
        await #expect(throws: DropboxBackupError.invalidResponse) { try await rejected.verifiedRemoteIdentity(plan: plan) }
    }

    @Test func invalidBytesOversizedResponsesRedirectsAndErrorsFailClosed() async throws {
        let (plan, bytes, credentials) = try fixture()
        let http = HTTP([])
        let transport = try DropboxBackupTransport(destination: plan.destination, credentials: credentials, http: http)
        await #expect(throws: DropboxBackupError.invalidPackage) {
            try await transport.createExclusively(plan: plan, bytes: Data("wrong".utf8))
        }
        #expect(await http.requests.isEmpty)
        let oversized = HTTP([Step(status: 200, body: Data(repeating: 1, count: 32 * 1_024 + 1))])
        let bounded = try DropboxBackupTransport(destination: plan.destination, credentials: credentials, http: oversized)
        await #expect(throws: DropboxBackupError.responseTooLarge) { try await bounded.createExclusively(plan: plan, bytes: bytes) }
        let redirect = HTTP([Step(status: 200, body: Data(), url: URL(string: "https://example.invalid/"))])
        let redirected = try DropboxBackupTransport(destination: plan.destination, credentials: credentials, http: redirect)
        await #expect(throws: DropboxBackupError.redirectRejected) { try await redirected.createExclusively(plan: plan, bytes: bytes) }
        let failed = HTTP([Step(status: 200, body: Data(), fail: true)])
        let sanitized = try DropboxBackupTransport(destination: plan.destination, credentials: credentials, http: failed)
        await #expect(throws: DropboxBackupError.requestFailed) { try await sanitized.createExclusively(plan: plan, bytes: bytes) }
        await #expect(throws: DropboxBackupError.operationInProgress) { try await sanitized.createExclusively(plan: plan, bytes: bytes) }
    }

    private enum Mode: Sendable, Equatable { case chunks, oversizedLength, failure, stall, redirect }
    private final class Registry: @unchecked Sendable {
        private let lock = NSLock()
        private var modes: [String: Mode] = [:]
        private var entered = Set<String>()
        private var waiters: [String: CheckedContinuation<Void, Never>] = [:]
        func insert(_ mode: Mode) -> String { lock.withLock { let id = UUID().uuidString; modes[id] = mode; return id } }
        func begin(_ id: String) -> Mode {
            lock.withLock {
                entered.insert(id)
                waiters.removeValue(forKey: id)?.resume()
                return modes[id] ?? .failure
            }
        }
        func wait(_ id: String) async {
            await withCheckedContinuation { continuation in
                lock.withLock {
                    if entered.contains(id) { continuation.resume() }
                    else { waiters[id] = continuation }
                }
            }
        }
    }

    private final class ProtocolStub: URLProtocol {
        static let registry = Registry()
        override class func canInit(with request: URLRequest) -> Bool { true }
        override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
        override func startLoading() {
            let mode = Self.registry.begin(request.value(forHTTPHeaderField: "X-XLog-Test-ID") ?? "")
            switch mode {
            case .stall: return
            case .failure:
                client?.urlProtocol(self, didFailWithError: URLError(.timedOut,
                    userInfo: [NSLocalizedDescriptionKey: "untrusted-provider-detail"]))
            case .redirect:
                #if canImport(Darwin)
                let response = HTTPURLResponse(url: request.url!, statusCode: 302, httpVersion: "HTTP/1.1",
                    headerFields: ["Location": "https://example.invalid/"])!
                client?.urlProtocol(self, wasRedirectedTo: URLRequest(url: URL(string: "https://example.invalid/")!),
                    redirectResponse: response)
                #endif
            case .chunks, .oversizedLength:
                let headers = mode == .oversizedLength ? ["Content-Length": "50000"] : [:]
                let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!
                client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
                client?.urlProtocol(self, didLoad: Data([1, 2, 3]))
                client?.urlProtocol(self, didLoad: Data([4, 5, 6]))
                client?.urlProtocolDidFinishLoading(self)
            }
        }
        override func stopLoading() {}
    }

    private func request(_ mode: Mode) -> (URLRequest, String) {
        let id = ProtocolStub.registry.insert(mode)
        var request = URLRequest(url: DropboxBackupTransport.accountURL)
        request.httpMethod = "POST"
        request.setValue(id, forHTTPHeaderField: "X-XLog-Test-ID")
        return (request, id)
    }

    @Test func URLSessionBoundsStreamingAndDeclaredSizesWithoutNetwork() async throws {
        let client = DropboxBackupURLSessionClient(protocolClasses: [ProtocolStub.self])
        let (chunks, _) = request(.chunks)
        #expect(try await client.send(chunks, maximumResponseBytes: 6).body == Data([1, 2, 3, 4, 5, 6]))
        await #expect(throws: DropboxBackupError.responseTooLarge) { try await client.send(chunks, maximumResponseBytes: 4) }
        let (length, _) = request(.oversizedLength)
        await #expect(throws: DropboxBackupError.responseTooLarge) { try await client.send(length, maximumResponseBytes: 4) }
        var unsafe = chunks
        unsafe.url = URL(string: "http://api.dropboxapi.com/2/users/get_current_account")
        await #expect(throws: DropboxBackupError.invalidDestination) { try await client.send(unsafe, maximumResponseBytes: 4) }
        let (failure, _) = request(.failure)
        await #expect(throws: DropboxBackupError.requestFailed) { try await client.send(failure, maximumResponseBytes: 4) }
    }

    @Test func URLSessionTaskCancellationInterruptsPendingRequestWithoutNetwork() async throws {
        let client = DropboxBackupURLSessionClient(protocolClasses: [ProtocolStub.self])
        let (request, id) = request(.stall)
        let task = Task { try await client.send(request, maximumResponseBytes: 4) }
        await ProtocolStub.registry.wait(id)
        task.cancel()
        await #expect(throws: CancellationError.self) { try await task.value }
    }

    #if canImport(Darwin)
    @Test func URLSessionRejectsRedirectBeforeCredentialsCanFollow() async throws {
        let client = DropboxBackupURLSessionClient(protocolClasses: [ProtocolStub.self])
        let (request, _) = request(.redirect)
        await #expect(throws: DropboxBackupError.redirectRejected) { try await client.send(request, maximumResponseBytes: 4) }
    }
    #endif
}

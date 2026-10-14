import Foundation
import Testing
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif
#if canImport(SQLite3)
import SQLite3
#else
import CSQLitePrototype
#endif
@testable import XLogPrototypeSupport

private final class NativeAdmissionBox<Value>: @unchecked Sendable {
    private let lock = NSLock()
    private var storage: Value
    init(_ value: Value) { storage = value }
    var value: Value { lock.withLock { storage } }
    func set(_ value: Value) { lock.withLock { storage = value } }
    func update(_ operation: (inout Value) -> Void) { lock.withLock { operation(&storage) } }
}

private final class HeldPowerFileManager: FileManager, @unchecked Sendable {
    private let lock = NSLock()
    private var holdNext = false
    let entered = DispatchSemaphore(value: 0)
    let release = DispatchSemaphore(value: 0)
    func armHold() { lock.withLock { holdNext = true } }
    override func fileExists(atPath path: String) -> Bool {
        let hold = lock.withLock { () -> Bool in
            guard holdNext, path.hasSuffix("edit-generation.json") else { return false }
            holdNext = false; return true
        }
        if hold { entered.signal(); _ = release.wait(timeout: .now() + 5) }
        return super.fileExists(atPath: path)
    }
}

@Suite("Nonblocking native power admission and durable peak watermark")
struct NativeDraftPowerAdmissionTests {
    private struct Fixture {
        let service: LiveLogbookMethods
        let gate: NativeDraftPowerGate
        let source: UUID
        let owner: OperatorDraftPowerOwnerSnapshot
        let readings: NativeAdmissionBox<[NativeDraftPowerGate.Reading]>
    }

    private func fixture(fileManager: FileManager = .default,
                         _ operation: (Fixture) async throws -> Void) async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("power-admission-\(UUID())")
        let service = LiveLogbookMethods(fileManager: fileManager, supportDirectory: root, inheritNativePreferences: false)
        defer { try? service.openedDatabase().close(); try? FileManager.default.removeItem(at: root) }
        _ = try service.handle(method: "workspace_create", params: ["mode": "empty"])
        let workspace = try IntegrationWorkspaceBootstrap.open(at: service.workspaceDirectoryURL)
        defer { workspace.makeDefaults()?.removePersistentDomain(forName: workspace.defaultsSuiteName) }
        var settings = try service.currentSettings(); settings.automaticTransmitPower = true
        _ = try service.saveSettingsForTest(try json(settings))
        let initial = try service.powerOwnerSnapshot()
        let configured = try service.configureDraftPower(expectedWorkspaceID: initial.workspaceID)
        var qso = configured.draft.qso; qso.call = "K1ABC"; qso.mode = "CW"; qso.frequencyHz = 14_025_000
        let db = try service.openedDatabase()
        _ = try db.applyOperatorDraft(.init(operationID: UUID(), draftID: qso.id,
            expectedRevision: configured.draft.revision, action: .replace, qso: qso), nextDraft: QSO(call: "", band: "20m", mode: "CW"))
        let gate = NativeDraftPowerGate(), source = UUID()
        let readings = NativeAdmissionBox<[NativeDraftPowerGate.Reading]>([])
        gate.install(changed: {}, received: { reading in readings.update { $0.append(reading) } })
        gate.select(provider: "direct_agent", selectionID: UUID().uuidString)
        gate.attach(sourceID: source, endpointID: "fixture")
        gate.connection(sourceID: source, sequence: 1, sessionID: UUID(), startedAt: Date().addingTimeInterval(-1), ready: true)
        let state = gate.state(), owner = try service.powerOwnerSnapshot()
        let context = try #require(state.context)
        let armed = try service.armDraftPower(context: context, expectedWorkspaceID: owner.workspaceID,
            draftID: owner.draft.qso.id, expectedRevision: owner.draft.revision, now: Date())
        gate.arm(armed.draft, workspaceID: owner.workspaceID, state: state)
        try await operation(Fixture(service: service, gate: gate, source: source, owner: armed, readings: readings))
        gate.terminate()
    }

    private func json<T: Encodable>(_ value: T) throws -> [String: Any] {
        let encoder = JSONEncoder(); encoder.dateEncodingStrategy = .iso8601
        return try #require(JSONSerialization.jsonObject(with: encoder.encode(value)) as? [String: Any])
    }

    private func sample(_ fixture: Fixture, watts: Double, observedAt: Date? = nil) throws -> OperatorDraftPowerSample {
        let scope = try #require(fixture.owner.draft.power?.activeScope)
        let time = observedAt ?? Date()
        return try #require(OperatorDraftPowerSample(watts: watts, observedAt: time, radioObservedAt: time,
            amplifierObservedAt: time, receivedAt: Date(), sessionID: scope.context.sessionID))
    }

    private func emit(_ fixture: Fixture, watts: Double, observedAt: Date? = nil) throws {
        fixture.gate.observe(sourceID: fixture.source, sample: try sample(fixture, watts: watts, observedAt: observedAt),
            frequencyHz: 14_025_000, mode: "CW")
    }

    private func capture(_ fixture: Fixture, _ reading: NativeDraftPowerGate.Reading,
                         evaluateFreshnessAfterWait: Bool = false,
                         authorize: (() -> Bool)? = nil) throws -> OperatorDraftPowerOwnerSnapshot {
        try fixture.service.captureDraftPower(sample: reading.sample, expectedWorkspaceID: reading.lease.workspaceID,
            scopeID: reading.lease.scope.id,
            now: evaluateFreshnessAfterWait ? nil : reading.sample.receivedAt,
            authorize: authorize ?? { fixture.gate.permits(reading) })
    }

    private func sqlite(_ path: URL, operation: (OpaquePointer) async throws -> Void) async throws {
        var handle: OpaquePointer?
        guard sqlite3_open(path.path, &handle) == SQLITE_OK, let handle else { throw LogbookDatabaseError.open("fixture") }
        defer { sqlite3_close(handle) }
        try await operation(handle)
    }

    private func execute(_ handle: OpaquePointer, _ sql: String) throws {
        guard sqlite3_exec(handle, sql, nil, nil, nil) == SQLITE_OK else { throw LogbookDatabaseError.sqlite("fixture") }
    }

    // Only a GCD thread blocks on the fixture latch. The cooperative executor
    // remains free to run other tests and resume this continuation.
    private func completed(_ signal: DispatchSemaphore, within seconds: TimeInterval) async -> Bool {
        await withCheckedContinuation { continuation in
            DispatchQueue.global().async {
                continuation.resume(returning: signal.wait(timeout: .now() + seconds) == .success)
            }
        }
    }

    @Test("SQLite writer contention cannot delay source detach or terminal revocation", arguments: [false, true])
    func sqliteContention(terminal: Bool) async throws {
        try await fixture { fixture in
            try emit(fixture, watts: 500)
            let reading = try #require(fixture.readings.value.first)
            let result = NativeAdmissionBox<Result<OperatorDraftPowerOwnerSnapshot, Error>?>(nil)
            let started = DispatchSemaphore(value: 0), done = DispatchSemaphore(value: 0)
            let path = try fixture.service.openedDatabase().url
            try await sqlite(path) { handle in
                try execute(handle, "BEGIN IMMEDIATE;")
                DispatchQueue.global().async {
                    started.signal()
                    result.set(Result { try capture(fixture, reading) }); done.signal()
                }
                #expect(await completed(started, within: 1))
                try await Task.sleep(nanoseconds: 30_000_000)
                let revoked = DispatchSemaphore(value: 0)
                DispatchQueue.global().async {
                    if terminal { fixture.gate.terminate() } else { fixture.gate.detach() }
                    revoked.signal()
                }
                #expect(await completed(revoked, within: 0.2))
                try execute(handle, "ROLLBACK;")
            }
            #expect(await completed(done, within: 2))
            let captured = try #require(result.value).get()
            #expect(captured.draft == fixture.owner.draft)
        }
    }

    @Test("A held service lock cannot delay source detach")
    func serviceContention() async throws {
        let files = HeldPowerFileManager()
        try await fixture(fileManager: files) { fixture in
            try emit(fixture, watts: 500)
            let reading = try #require(fixture.readings.value.first)
            files.armHold()
            let readerDone = DispatchSemaphore(value: 0), captureDone = DispatchSemaphore(value: 0)
            DispatchQueue.global().async { _ = try? fixture.service.powerOwnerSnapshot(); readerDone.signal() }
            #expect(await completed(files.entered, within: 1))
            let result = NativeAdmissionBox<Result<OperatorDraftPowerOwnerSnapshot, Error>?>(nil)
            DispatchQueue.global().async { result.set(Result { try capture(fixture, reading) }); captureDone.signal() }
            let revoked = DispatchSemaphore(value: 0)
            DispatchQueue.global().async { fixture.gate.detach(); revoked.signal() }
            #expect(await completed(revoked, within: 0.2))
            files.release.signal()
            #expect(await completed(readerDone, within: 2))
            #expect(await completed(captureDone, within: 2))
            #expect(try #require(result.value).get().draft == fixture.owner.draft)
        }
    }

    @Test("An admitted reading may commit after revoke; later old readings are no-ops")
    func admittedBeforeRevoke() async throws {
        try await fixture { fixture in
            try emit(fixture, watts: 500)
            let reading = try #require(fixture.readings.value.first)
            let admitted = DispatchSemaphore(value: 0), release = DispatchSemaphore(value: 0), done = DispatchSemaphore(value: 0)
            let result = NativeAdmissionBox<Result<OperatorDraftPowerOwnerSnapshot, Error>?>(nil)
            DispatchQueue.global().async {
                result.set(Result {
                    try capture(fixture, reading, authorize: {
                        let permission = fixture.gate.permits(reading)
                        admitted.signal(); _ = release.wait(timeout: .now() + 2)
                        return permission
                    })
                }); done.signal()
            }
            #expect(await completed(admitted, within: 1))
            let revoked = DispatchSemaphore(value: 0)
            DispatchQueue.global().async { fixture.gate.detach(); revoked.signal() }
            #expect(await completed(revoked, within: 0.2))
            release.signal()
            #expect(await completed(done, within: 2))
            let committed = try #require(result.value).get()
            #expect(committed.draft.qso.txPower == "500")
            fixture.gate.recordCaptured(reading, draft: committed.draft)
            let late = NativeDraftPowerGate.Reading(lease: reading.lease, sample: try sample(fixture, watts: 900))
            #expect(try capture(fixture, late).draft == committed.draft)
            let receipt = try fixture.service.openedDatabase().applyOperatorDraft(.init(operationID: UUID(),
                draftID: committed.draft.qso.id, expectedRevision: committed.draft.revision, action: .save),
                nextDraft: QSO(call: "", band: "20m", mode: "CW"))
            #expect(receipt.savedQSO?.txPower == "500")
        }
    }

    @Test("Freshness is evaluated after waiting for the SQLite write transaction")
    func delayedFreshness() async throws {
        try await fixture { fixture in
            try emit(fixture, watts: 500)
            let reading = try #require(fixture.readings.value.first)
            let result = NativeAdmissionBox<Result<OperatorDraftPowerOwnerSnapshot, Error>?>(nil)
            let done = DispatchSemaphore(value: 0), started = DispatchSemaphore(value: 0)
            let authorizations = NativeAdmissionBox(0)
            try await sqlite(try fixture.service.openedDatabase().url) { handle in
                try execute(handle, "BEGIN IMMEDIATE;")
                DispatchQueue.global().async {
                    started.signal()
                    result.set(Result { try capture(fixture, reading, evaluateFreshnessAfterWait: true, authorize: {
                        authorizations.update { $0 += 1 }; return fixture.gate.permits(reading)
                    }) }); done.signal()
                }
                #expect(await completed(started, within: 1))
                try await Task.sleep(nanoseconds: 2_100_000_000)
                try execute(handle, "ROLLBACK;")
            }
            #expect(await completed(done, within: 2))
            #expect(try #require(result.value).get().draft == fixture.owner.draft)
            #expect(authorizations.value == 0)
        }
    }

    @Test("Durable peak discards duplicate/lower work, preserves queued peaks, and rejects newly reordered readings")
    func durableWatermark() async throws {
        try await fixture { fixture in
            try emit(fixture, watts: 500)
            let first = try #require(fixture.readings.value.first)
            let committed = try capture(fixture, first)
            fixture.gate.recordCaptured(first, draft: committed.draft)
            try emit(fixture, watts: 500); try emit(fixture, watts: 125)
            #expect(fixture.readings.value.count == 1)
            try emit(fixture, watts: 650)
            let queuedPeak = try #require(fixture.readings.value.last)
            #expect(fixture.readings.value.count == 2)
            let lowTime = Date()
            try emit(fixture, watts: 100, observedAt: lowTime)
            let earlier = first.sample.observedAt.addingTimeInterval(lowTime.timeIntervalSince(first.sample.observedAt) / 2)
            try emit(fixture, watts: 900, observedAt: earlier)
            #expect(fixture.readings.value.count == 2)
            let higher = try capture(fixture, queuedPeak)
            #expect(higher.draft.qso.txPower == "650")
            fixture.gate.recordCaptured(queuedPeak, draft: higher.draft)
            try emit(fixture, watts: 600)
            #expect(fixture.readings.value.count == 2)
        }
    }

    @Test("Failed writes never establish a peak watermark or suppress the next lower valid reading")
    func failedCapture() async throws {
        try await fixture { fixture in
            try emit(fixture, watts: 700)
            let first = try #require(fixture.readings.value.first)
            try await sqlite(try fixture.service.openedDatabase().url) { handle in
                try execute(handle, "CREATE TRIGGER fail_native_power BEFORE UPDATE ON xlog_operator_draft BEGIN SELECT RAISE(ABORT, 'fixture'); END;")
                #expect(throws: LogbookDatabaseError.self) { try capture(fixture, first) }
                try execute(handle, "DROP TRIGGER fail_native_power;")
            }
            #expect(try fixture.service.powerOwnerSnapshot().draft == fixture.owner.draft)
            try emit(fixture, watts: 300)
            #expect(fixture.readings.value.count == 2)
            let lower = try #require(fixture.readings.value.last)
            let committed = try capture(fixture, lower)
            fixture.gate.recordCaptured(lower, draft: committed.draft)
            #expect(committed.draft.qso.txPower == "300")
        }
    }

    @Test("Invalid evidence and unchanged durable acknowledgments cannot poison observation chronology")
    func invalidEvidenceWatermark() async throws {
        try await fixture { fixture in
            try emit(fixture, watts: 500)
            let first = try #require(fixture.readings.value.first)
            let committed = try capture(fixture, first)
            fixture.gate.recordCaptured(first, draft: committed.draft)
            let scope = first.lease.scope
            for time in [Date().addingTimeInterval(10), Date().addingTimeInterval(-3),
                         scope.armedAt.addingTimeInterval(-0.001)] {
                let invalid = try #require(OperatorDraftPowerSample(watts: 900, observedAt: time,
                    radioObservedAt: time, amplifierObservedAt: time, receivedAt: time,
                    sessionID: scope.context.sessionID))
                fixture.gate.observe(sourceID: fixture.source, sample: invalid,
                    frequencyHz: 14_025_000, mode: "CW")
                // Even a successful no-op DB result must acknowledge only its
                // durable chronology, not the rejected reading's timestamp.
                fixture.gate.recordCaptured(.init(lease: first.lease, sample: invalid), draft: committed.draft)
            }
            #expect(fixture.readings.value.count == 1)
            try emit(fixture, watts: 600)
            #expect(fixture.readings.value.count == 2)
            let valid = try #require(fixture.readings.value.last)
            #expect(try capture(fixture, valid).draft.qso.txPower == "600")
        }
    }
}

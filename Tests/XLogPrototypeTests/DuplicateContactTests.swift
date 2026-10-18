import Foundation
import Testing
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif
@testable import XLogPrototypeSupport

@Suite("Normal-log base callsign duplicate warning")
struct DuplicateContactTests {
    @Test("Portable suffixes share history while stored calls and location variants remain exact")
    func completeHistoryMatch() throws {
        let fixture = try duplicateFixture()
        defer { fixture.clean() }
        let oldest = QSO(call: "W1AW/P", start: Date(timeIntervalSince1970: 1_700_000_000), band: "20m", mode: "MFSK", submode: "FT8")
        try fixture.database.save(oldest)
        for index in 1...30 {
            try fixture.database.save(QSO(call: "W1AW/P", start: oldest.start.addingTimeInterval(Double(index)), band: "40m", mode: "FT8"))
        }
        try fixture.database.save(QSO(call: "W1AW", start: oldest.start.addingTimeInterval(100), band: "20m", mode: "FT8"))
        try fixture.database.save(QSO(call: "W1AW/P", start: oldest.start.addingTimeInterval(101), band: "20m", mode: "MFSK", submode: "FT4"))
        let params: [String: Any] = ["call": " w1aw/p ", "band": "20M", "mode": "ft8"]
        let result = try fixture.service.handle(method: "logbook_duplicate", params: params)
        #expect(result["call"] as? String == "W1AW/P")
        #expect(result["band"] as? String == "20m")
        #expect(result["mode"] as? String == "FT8")
        #expect(result["last_worked_at"] as? String == ISO8601DateFormatter().string(from: oldest.start.addingTimeInterval(100)))
        #expect(try fixture.database.previous(call: "W1AW/P", limit: 25).allSatisfy { $0.id != oldest.id })
        let complete = try fixture.database.previous(call: "W1AW/P", limit: 40)
        #expect(complete.contains { $0.call == "W1AW" })
        #expect(complete.contains { $0.call == "W1AW/P" })
        let latest = QSO(call: "W1AW/P", start: oldest.start.addingTimeInterval(200), band: "20m", mode: "FT8")
        try fixture.database.save(latest)
        try fixture.database.save(QSO(call: "DL/W1AW/P", start: oldest.start.addingTimeInterval(300), band: "20m", mode: "FT8"))
        try fixture.database.save(QSO(call: "W1AW/4", start: oldest.start.addingTimeInterval(400), band: "20m", mode: "FT8"))
        #expect(try fixture.database.latestWorkedContact(call: "W1AW/P", band: "20m", mode: "FT8")?.id == latest.id)
        try fixture.database.softDelete(latest)
        #expect(try fixture.database.latestWorkedContact(call: "W1AW/P", band: "20m", mode: "FT8")?.call == "W1AW")
    }

    @Test("The current logged edit is excluded and CAT aliases retain exact logging-mode intent")
    func excludeEditedContactAndNormalizeMode() throws {
        let fixture = try duplicateFixture()
        defer { fixture.clean() }
        let earlier = QSO(call: "W1AW", start: Date(timeIntervalSince1970: 1_700_000_000), band: "20m", mode: "LSB")
        let current = QSO(call: "W1AW", start: earlier.start.addingTimeInterval(100), band: "20m", mode: "USB")
        try fixture.database.save(earlier); try fixture.database.save(current)
        let params: [String: Any] = ["call": "W1AW", "band": "20m", "mode": "USB", "exclude_id": current.id.uuidString.lowercased()]
        let result = try fixture.service.handle(method: "logbook_duplicate", params: params)
        #expect(result["mode"] as? String == "SSB")
        #expect(result["last_worked_at"] as? String == ISO8601DateFormatter().string(from: earlier.start))
        try fixture.database.softDelete(earlier)
        #expect(try fixture.service.handle(method: "logbook_duplicate", params: params)["last_worked_at"] is NSNull)
    }

    @Test("The bounded read-only method rejects malformed fields without altering contacts or outbox")
    func boundedReadOnlyHandler() throws {
        let fixture = try duplicateFixture()
        defer { fixture.clean() }
        let contact = QSO(call: "W1AW", band: "20m", mode: "CW")
        try fixture.database.save(contact)
        let original = try fixture.database.fetchAll()
        let outbox = try fixture.database.outboxEntries()
        let valid: [String: Any] = ["call": "W1AW", "band": "20m", "mode": "CW"]
        let patches: [[String: Any]] = [["call": ""], ["call": "x' OR 1=1"], ["call": String(repeating: "A", count: 33)],
                                        ["band": "20m;"], ["mode": "CW;"], ["exclude_id": "bad-id"], ["write": true]]
        for patch in patches {
            let params = valid.merging(patch) { _, value in value }
            #expect(throws: WorkerFailure.self) { try fixture.service.handle(method: "logbook_duplicate", params: params) }
        }
        try LocalAcceptanceSession.validate(method: "logbook_duplicate", params: valid)
        _ = try fixture.service.handle(method: "logbook_duplicate", params: valid)
        #expect(try fixture.database.fetchAll() == original)
        #expect(try fixture.database.outboxEntries() == outbox)
    }
}

private struct DuplicateFixture {
    let root: URL
    let service: LiveLogbookMethods
    let database: LogbookDatabase
    func clean() {
        if let workspace = try? IntegrationWorkspaceBootstrap.open(at: service.workspaceDirectoryURL) {
            workspace.makeDefaults()?.removePersistentDomain(forName: workspace.defaultsSuiteName)
        }
        database.close()
        try? FileManager.default.removeItem(at: root)
    }
}
private func duplicateFixture() throws -> DuplicateFixture {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-dupe-fixture-" + UUID().uuidString)
    let service = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
    _ = try service.handle(method: "workspace_create", params: ["mode": "empty"])
    return DuplicateFixture(root: root, service: service, database: try service.openedDatabase())
}

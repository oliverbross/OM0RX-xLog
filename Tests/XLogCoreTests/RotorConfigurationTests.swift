import Foundation
import Testing
@testable import XLogCore

@Suite("Revisioned rotor configuration")
struct RotorConfigurationTests {
    private func database() throws -> (LogbookDatabase, URL) {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        return (try LogbookDatabase(url: root.appendingPathComponent("rotor.sqlite")), root)
    }

    @Test("Legacy seed is one-time and stale editors conflict")
    func seedAndConflict() throws {
        let (database, root) = try database()
        defer { database.close(); try? FileManager.default.removeItem(at: root) }
        var seed = RotorConfiguration.defaults
        seed.nativeDCU1.host = "rotor.example.invalid"
        let initial = try database.rotorConfiguration(seed: seed)
        #expect(initial.revision == 0)
        var ignored = seed; ignored.nativeDCU1.host = "ignored.invalid"
        #expect(try database.rotorConfiguration(seed: ignored) == initial)

        var changed = seed; changed.nativeDCU1.name = "Tower"
        let receipt = try database.applyRotorConfiguration(.init(
            operationID: UUID(), expectedRevision: 0, configuration: changed
        ))
        #expect(receipt.snapshot.revision == 1)
        #expect(receipt.snapshot.configuration.nativeDCU1.name == "Tower")
        #expect(throws: RotorConfigurationError.self) {
            try database.applyRotorConfiguration(.init(
                operationID: UUID(), expectedRevision: 0, configuration: ignored
            ))
        }
    }

    @Test("Replay, no-op and operation reuse are deterministic")
    func receipts() throws {
        let (database, root) = try database()
        defer { database.close(); try? FileManager.default.removeItem(at: root) }
        let initial = try database.rotorConfiguration(seed: .defaults)
        let operationID = UUID()
        let mutation = RotorConfigurationMutation(operationID: operationID,
            expectedRevision: initial.revision, configuration: initial.configuration)
        let first = try database.applyRotorConfiguration(mutation)
        #expect(first.snapshot.revision == 0)
        #expect(try database.applyRotorConfiguration(mutation) == first)
        #expect(try database.rotorConfigurationReceipt(operationID: operationID) == first)
        var different = initial.configuration; different.owner = .hamlib
        #expect(throws: RotorConfigurationError.self) {
            try database.applyRotorConfiguration(.init(operationID: operationID,
                expectedRevision: initial.revision, configuration: different))
        }
    }

    @Test("Restore replacement retires old receipts")
    func restore() throws {
        let (database, root) = try database()
        defer { database.close(); try? FileManager.default.removeItem(at: root) }
        let initial = try database.rotorConfiguration(seed: .defaults), operationID = UUID()
        _ = try database.applyRotorConfiguration(.init(operationID: operationID,
            expectedRevision: initial.revision, configuration: initial.configuration))
        var restored = initial.configuration; restored.owner = .hamlib
        let snapshot = RotorConfigurationSnapshot(revision: 7, configuration: restored)
        try database.installRotorConfigurationAfterRestore(snapshot)
        #expect(try database.rotorConfiguration(seed: .defaults) == snapshot)
        #expect(try database.rotorConfigurationReceipt(operationID: operationID) == nil)
    }

    @Test("Invalid connection values never enter the database")
    func invalid() throws {
        let (database, root) = try database()
        defer { database.close(); try? FileManager.default.removeItem(at: root) }
        var invalid = RotorConfiguration.defaults; invalid.nativeDCU1.port = 0
        #expect(throws: RotorConfigurationError.self) { try database.rotorConfiguration(seed: invalid) }
    }
}

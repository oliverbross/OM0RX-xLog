import Foundation
import Testing
@testable import XLogCore

@Suite("Operating support")
struct OperatingSupportTests {
    @Test("Automatic rotor planning accepts CTY or spot bearings and normalizes the command")
    func automaticRotorPlanning() throws {
        let request = try #require(AutomaticRotorTurnPlanner.request(
            enabled: true,
            call: " jl1ioc/p ",
            bearing: 404.6,
            band: "17m",
            path: "sp"
        ))
        #expect(request.signature == "JL1IOC/P|SP|45|17m")
        #expect(request.command == "rotor_goto 44.6 17m")
        #expect(request.bearing == 44.60000000000002)
        #expect(AutomaticRotorTurnPlanner.request(enabled: false, call: "JL1IOC/P", bearing: 45, band: "17m", path: "SP") == nil)
        #expect(AutomaticRotorTurnPlanner.request(enabled: true, call: "", bearing: 45, band: "17m", path: "SP") == nil)
        #expect(AutomaticRotorTurnPlanner.request(enabled: true, call: "JL1IOC/P", bearing: nil, band: "17m", path: "SP") == nil)
        #expect(AutomaticRotorTurnPlanner.request(enabled: true, call: "JL1IOC/P", bearing: 45, band: "17m;operate", path: "SP") == nil)
    }

    @Test("Spot confirmation requires observed coherent simplex ownership")
    func observedSimplexConfirmation() throws {
        let base: [String: Any] = [
            "observed": true, "connected": true, "frequencyHz": 7_195_000,
            "receiveFrequencyHz": 7_195_000, "transmitFrequencyHz": 7_195_000,
            "mode": "LSB", "receiveVFO": "A", "transmitVFO": "A", "split": false,
        ]
        func confirms(_ values: [String: Any]) throws -> Bool {
            let radio = try JSONDecoder().decode(XCatStationSnapshot.Radio.self,
                from: JSONSerialization.data(withJSONObject: values))
            return radio.confirmsSimplex(frequencyHz: 7_195_000, radioMode: "LSB")
        }
        #expect(try confirms(base))
        for (key, value) in ["observed": false, "connected": false, "split": true,
                             "transmitVFO": "B", "receiveVFO": "B", "mode": "USB",
                             "transmitFrequencyHz": 7_185_000, "frequencyHz": 7_185_000] as [String: Any] {
            var changed = base
            changed[key] = value
            #expect(try !confirms(changed))
        }
        var legacy = base
        legacy.removeValue(forKey: "observed")
        #expect(try !confirms(legacy))
    }
    @Test("xCat split snapshot preserves separate transmit and receive VFOs")
    func splitSnapshot() throws {
        let data = #"""
        {
          "available": true,
          "generatedAt": 1,
          "radio": {
            "connected": true,
            "frequencyHz": 5357000,
            "mode": "USB",
            "receiveFrequencyHz": 5357000,
            "transmitFrequencyHz": 5358500,
            "receiveVFO": "A",
            "transmitVFO": "B",
            "split": true,
            "isTransmitting": false
          },
          "station": {
            "available": true, "commissioned": true, "coordinatorState": "ready", "allowedActions": [],
            "kpaOperate": false, "band": "60m", "routeAlignment": "confirmed", "interlockState": "READY",
            "txPowerWatts": 0, "swr": 1.1, "swrIsLive": false, "rfDriveWatts": 30,
            "kpaDetailPrimary": "KPA500 STBY", "kpaDetailSecondary": "", "katDetailPrimary": "KAT500 AUTO",
            "katDetailSecondary": "", "routeDetail": "ANT1", "alarmSummary": "clear"
          },
          "rotor": {"connected": false, "name": "", "homeGrid": "JN88TQ", "azimuth": null, "targetBearing": null, "targetLabel": "", "status": "", "isMoving": false, "motionDirection": ""},
          "propagation": {"status": "ready", "updatedAt": null, "solarFlux": null, "aIndex": null, "kIndex": null, "xRay": "--", "bands": []}
        }
        """#.data(using: .utf8)!
        let decoded = try JSONDecoder().decode(XCatStationSnapshot.self, from: data)
        let radio = try #require(decoded.radio?.snapshot)
        #expect(radio.isSplit)
        #expect(radio.receiveFrequencyHz == 5_357_000)
        #expect(radio.transmitFrequencyHz == 5_358_500)
        #expect(radio.receiveVFO == "A")
        #expect(radio.transmitVFO == "B")
    }

    @Test("Validation detects inconsistent band and a recent duplicate")
    func validation() {
        let prior = QSO(call: "W1AW", start: Date(), band: "40m", mode: "SSB", frequencyHz: 7_175_000)
        let candidate = QSO(call: "W1AW", start: Date(), band: "20m", mode: "SSB", frequencyHz: 7_175_000, gridSquare: "BAD", country: "United States")
        let issues = QSOValidator.validate(candidate, possibleDuplicate: prior)
        #expect(issues.contains { $0.field == "Band" && $0.severity == .error })
        #expect(issues.contains { $0.field == "Grid" && $0.severity == .warning })
        #expect(issues.contains { $0.field == "Duplicate" && $0.severity == .warning })
    }

    @Test("Conflict merge selects individual remote fields while preserving local identity")
    func fieldMerge() throws {
        let id = UUID()
        var local = QSO(id: id, wavelogID: 42, call: "W1AW", band: "40m", mode: "SSB", frequencyHz: 7_175_000, name: "Local", comment: "local")
        local.extraFields["APP_LOCAL"] = "keep"
        var remote = local
        remote.id = UUID()
        remote.name = "Remote"
        remote.comment = "remote"
        let conflict = SyncConflict(localQSO: local, remoteQSO: remote)

        let fields = QSOConflictMerge.differingFields(in: conflict)
        #expect(fields.contains { $0.key == "name" })
        #expect(fields.contains { $0.key == "comment" })
        let merged = try QSOConflictMerge.merge(conflict, remoteFields: ["name"])
        #expect(merged.id == id)
        #expect(merged.name == "Remote")
        #expect(merged.comment == "local")
        #expect(merged.extraFields["APP_LOCAL"] == "keep")
        #expect(merged.isDirty)
    }

    @Test("Failed sync entries persist their error and respect retry backoff")
    func outboxRetry() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let database = try LogbookDatabase(url: directory.appendingPathComponent("outbox.sqlite"))
        let qso = QSO(call: "VK8NSB", band: "20m", mode: "SSB", frequencyHz: 14_200_000)
        try database.save(qso)
        try database.recordSyncFailure(localID: qso.id, message: "HTTP 503")

        let entries = try database.outboxEntries()
        #expect(entries.count == 1)
        #expect(entries[0].attemptCount == 1)
        #expect(entries[0].lastError == "HTTP 503")
        #expect(try database.pending().isEmpty)
        #expect(try database.pending(includingDeferred: true).count == 1)

        try database.retrySync(localID: qso.id)
        #expect(try database.pending().count == 1)
        try database.markSynced(localID: qso.id, wavelogID: 99)
        #expect(try database.outboxEntries().isEmpty)
    }
}

import Foundation
import Testing
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif
@testable import XLogPrototypeSupport

@Suite("Operating goal worker projection")
struct LiveOperatingGoalMethodsTests {
    private struct Feed: Encodable {
        let items: [PublicOpportunity]
        let lastSuccess: Date?
        let lastAttempt: Date?
        let safeError: String?
    }

    private func request(_ worker: LiveWorker, params: [String: Any]) async throws -> [String: Any] {
        let body = try JSONSerialization.data(withJSONObject: [
            "id": "goal-test", "method": "operating_goals_evaluate", "params": params,
        ])
        let response = try #require(JSONSerialization.jsonObject(with: await worker.response(to: body)) as? [String: Any])
        #expect(response["id"] as? String == "goal-test")
        return response
    }

    private func fixture() throws -> (URL, LiveLogbookMethods, Date) {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let logbook = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        _ = try logbook.handle(method: "workspace_create", params: ["mode": "empty"])
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        var matching = QSO(call: "K1ABC", start: now.addingTimeInterval(-120), band: "20m", mode: "SSB",
            dxcc: 291, stationProfileID: 7, myCall: "OM0RX", lotwReceived: "Y")
        matching.potaReference = "K-0001"
        try logbook.openedDatabase().save(matching)
        var otherStation = matching
        otherStation.id = UUID(); otherStation.stationProfileID = 8
        try logbook.openedDatabase().save(otherStation)
        let item = PublicOpportunity(id: "retained", kind: "pota", callsign: "K1ABC", reference: "K-0001",
            name: "Retained activity", frequencyHz: 14_200_000, mode: "USB",
            observedAt: now.addingTimeInterval(-30), expiresAt: now.addingTimeInterval(90),
            source: "Official retained feed", sourceURL: "https://example.test/feed", comment: "")
        let directory = logbook.workspaceDirectoryURL.appendingPathComponent("Opportunities", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
        try JSONEncoder().encode(["pota": Feed(items: [item], lastSuccess: now.addingTimeInterval(-20),
            lastAttempt: now.addingTimeInterval(-20), safeError: nil)])
            .write(to: directory.appendingPathComponent("public-feed-cache.json"))
        return (root, logbook, now)
    }

    @Test("Worker reuses retained owners and keeps completion states distinct")
    func retainedProjection() async throws {
        let (root, logbook, now) = try fixture()
        defer { try? FileManager.default.removeItem(at: root) }
        let worker = LiveWorker(logbook: logbook)
        let params: [String: Any] = [
            "now": now.timeIntervalSince1970,
            "station_profile_id": 7,
            "station_call": "om0rx",
            "goals": [
                ["type": "reference", "programme": "POTA", "reference": "k-0001"],
                ["type": "callsign", "callsign": "k1abc"],
                ["type": "entity_slot", "dxcc": 291, "band": "20M", "mode": "USB"],
            ],
        ]
        let response = try await request(worker, params: params)
        #expect(response["ok"] as? Bool == true)
        let result = try #require(response["result"] as? [String: Any])
        #expect(result["read_only"] as? Bool == true)
        #expect(result["tunes"] as? Bool == false)
        #expect(result["transmits"] as? Bool == false)
        let scope = try #require(result["station_scope"] as? [String: Any])
        #expect(scope["profile_id"] as? Int == 7)
        #expect(scope["callsign"] as? String == "OM0RX")
        #expect(scope["all_stations"] as? Bool == false)
        let rows = try #require(result["evaluations"] as? [[String: Any]])
        #expect(rows.count == 3)
        for row in rows {
            #expect(row["worked_count"] as? Int == 1)
            #expect(row["confirmed_count"] as? Int == 1)
            #expect(row["evidence_eligible"] is NSNull)
            #expect(row["credited"] is NSNull)
            #expect((row["reasons"] as? [String])?.last?.contains("not been assessed") == true)
            let evidence = try #require(row["evidence"] as? [[String: Any]])
            #expect(evidence.count == 1)
            #expect(evidence[0]["age_seconds"] as? Double == 30)
            #expect(evidence[0]["source"] as? String == "Official retained feed")
        }
        var reversed = params
        reversed["goals"] = Array((params["goals"] as! [[String: Any]]).reversed())
        let second = try await request(worker, params: reversed)
        let secondRows = try #require((second["result"] as? [String: Any])?["evaluations"] as? [[String: Any]])
        #expect(try JSONSerialization.data(withJSONObject: rows, options: .sortedKeys)
            == JSONSerialization.data(withJSONObject: secondRows, options: .sortedKeys))
        await worker.shutdown()
    }

    @Test("Malformed and post-shutdown requests fail without starting work")
    func boundsAndShutdown() async throws {
        let (root, logbook, now) = try fixture()
        defer { try? FileManager.default.removeItem(at: root) }
        let worker = LiveWorker(logbook: logbook)
        for params: [String: Any] in [
            ["now": true, "goals": [["type": "callsign", "callsign": "K1ABC"]]],
            ["now": now.timeIntervalSince1970, "goals": [["type": "callsign", "callsign": "K1ABC", "extra": true]]],
            ["now": now.timeIntervalSince1970, "goals": []],
        ] {
            let response = try await request(worker, params: params)
            #expect(response["ok"] as? Bool == false)
            #expect((response["error"] as? [String: Any])?["code"] as? String == "invalid_params")
        }
        await worker.shutdown()
        let stopped = try await request(worker, params: ["now": now.timeIntervalSince1970,
            "goals": [["type": "callsign", "callsign": "K1ABC"]]])
        #expect(stopped["ok"] as? Bool == false)
        #expect((stopped["error"] as? [String: Any])?["code"] as? String == "worker_stopping")
    }

    @Test("A retained evaluation does not create opportunity cache state")
    func noCacheMutation() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let logbook = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        _ = try logbook.handle(method: "workspace_create", params: ["mode": "empty"])
        let cacheDirectory = logbook.workspaceDirectoryURL.appendingPathComponent("Opportunities", isDirectory: true)
        #expect(!FileManager.default.fileExists(atPath: cacheDirectory.path))
        let worker = LiveWorker(logbook: logbook)
        let response = try await request(worker, params: ["now": 1_800_000_000.0,
            "goals": [["type": "callsign", "callsign": "K1ABC"]]])
        #expect(response["ok"] as? Bool == true)
        #expect(!FileManager.default.fileExists(atPath: cacheDirectory.path))
        await worker.shutdown()
    }
}

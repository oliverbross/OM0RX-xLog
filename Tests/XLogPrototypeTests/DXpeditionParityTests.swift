import Foundation
import Testing
import XClusterIntegrationCore
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif
@testable import XLogPrototypeSupport

@Suite("DXpedition live-parity regressions")
struct DXpeditionParityTests {
    private let now = ISO8601DateFormatter().date(from: "2026-10-27T23:00:00Z")!

    @Test("Prefix announcements use explicitly published operating aliases, never the operators or QSL manager")
    func publishedAliases() throws {
        let html = """
        Oct 28-Nov 9, 2026<br>DXCC: Senegal<br>Callsign: 6W<br>Info: By IV3FSG I2YSB as 6W/I2YSB and 6W/IK2HKT; QSL via I2YSB
        Nov 23-30, 2026<br>DXCC: Honduras<br>Callsign: HR5<br>Info: By F2JD as HR5/F2JD; QSL via F6AJA
        Nov 25-Dec 5, 2026<br>DXCC: Honduras<br>Callsign: HR9<br>Info: By K6VHF as K6VHF/HR9 fm Roatan I (IOTA NA-057); all modes
        """
        let rows = try OpportunityFeedParser.parse(Data(html.utf8), source: "adxo", observedAt: now)
        #expect(rows.count == 3)
        #expect(rows[0].callsign == "6W/I2YSB")
        #expect(rows[0].callsigns == ["6W/I2YSB", "6W/IK2HKT"])
        #expect(rows[1].callsigns == ["HR5/F2JD"])
        #expect(rows[2].callsign == "K6VHF/HR9")
        #expect(rows[2].reference == "NA-057")
        #expect(!OpportunityFeedParser.isOperatingCall("HR5"))
        #expect(OpportunityFeedParser.isOperatingCall("HR5/F2JD"))
    }

    @Test("Catalogue reconciliation merges overlapping sources while preserving separate visits")
    func occurrences() {
        let original = operation("adxo:first", call: "S9R", source: "NG3K ADXO", start: -86_400, end: 86_400)
        let duplicate = operation("425dxn:first", call: "S9R", source: "425DXN", start: -43_200, end: 43_200)
        let next = operation("adxo:return", call: "S9R", source: "NG3K ADXO", start: 172_800, end: 259_200)
        let result = OpportunityFeedParser.mergedDXpeditions([duplicate, next, original])
        #expect(result.count == 2)
        #expect(result.first { $0.id == original.id }?.sourceNames == ["425DXN", "NG3K ADXO"])
        #expect(result.contains { $0.id == next.id })
    }

    @Test("Primary Club Log tuple API retains exact totals and UTC times and rejects malformed data")
    func enrichment() throws {
        let rows = try OpportunityFeedParser.parse(Data(#"[["S9R","2026-10-27 22:58:00","45535"]]"#.utf8), source: "clublog", observedAt: now)
        #expect(rows.first?.qsoTotal == 45_535)
        #expect(rows.first?.lastQSO == now.addingTimeInterval(-120))
        #expect(throws: OpportunityFeedError.self) {
            try OpportunityFeedParser.parse(Data(#"[["S9R","2099-01-01 00:00:00","-1"]]"#.utf8), source: "clublog", observedAt: now)
        }
    }

    @Test("Snapshots merge catalogues, locate future special calls by declared entity, retain ended activity and enrichment")
    func snapshot() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let logbook = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        _ = try logbook.handle(method: "workspace_create", params: ["mode": "empty"])
        let clock = Date()
        func current(_ id: String, _ call: String, _ entity: String, _ start: Double, _ end: Double) -> PublicOpportunity {
            .init(id: id, kind: "dxpedition", callsign: call, reference: "", name: entity, frequencyHz: nil, mode: "",
                  observedAt: clock, expiresAt: clock.addingTimeInterval(end), source: id.hasPrefix("adxo") ? "NG3K ADXO" : "425DXN",
                  sourceURL: "https://www.ng3k.com/Misc/adxoplain.html", comment: "", startsAt: clock.addingTimeInterval(start), endsAt: clock.addingTimeInterval(end))
        }
        let future = current("adxo:future", "HF0PAS", "South Shetland Islands", 3_600, 86_400)
        let ended = current("adxo:ended", "S9R", "Sao Tome & Principe I", -86_400, -3_600)
        let duplicate = current("425:future", "HF0PAS", "HF0PAS: South Shetland Islands", 3_600, 86_400)
        var total = current("clublog:S9R", "S9R", "", -86_400, 86_400)
        total.kind = "enrichment"; total.qsoTotal = 45_535; total.lastQSO = clock.addingTimeInterval(-7_200)
        struct Feed: Encodable { var items: [PublicOpportunity]; var lastSuccess: Date; var lastAttempt: Date }
        let cache = logbook.workspaceDirectoryURL.appendingPathComponent("Opportunities")
        try FileManager.default.createDirectory(at: cache, withIntermediateDirectories: false)
        try JSONEncoder().encode(["adxo": Feed(items: [future, ended], lastSuccess: clock, lastAttempt: clock),
                                  "425dxn": Feed(items: [duplicate], lastSuccess: clock, lastAttempt: clock),
                                  "clublog": Feed(items: [total], lastSuccess: clock, lastAttempt: clock)])
            .write(to: cache.appendingPathComponent("public-feed-cache.json"))
        let actor = LiveOpportunitiesMethods(logbook: logbook, dxpeditionHistory: { _ in
            [["id": "history:one", "callsign": "S9R", "frequencyKHz": 14074.5, "band": "20m", "mode": "FT8", "receivedAt": clock.addingTimeInterval(-7_200).timeIntervalSinceReferenceDate]]
        }, clusterSpots: { [] })
        let response = try await actor.handle(method: "opportunities_dxpedition_snapshot", params: [:])
        let items = try #require(response["items"] as? [[String: Any]])
        #expect(items.count == 2)
        let mapped = try #require(items.first { $0["callsign"] as? String == "HF0PAS" })
        #expect((mapped["latitude"] as? Double ?? 0) < -60)
        #expect(mapped["location_accuracy"] as? String == "reference_area")
        let recent = try #require(items.first { $0["callsign"] as? String == "S9R" })
        #expect(recent["qso_total"] as? Int64 == 45_535)
        #expect(recent["draft_load_allowed"] as? Bool == false)
        #expect((response["observations"] as? [[String: Any]])?.count == 1)
        #expect(response["history_state"] as? String == "ready")
    }

    private func operation(_ id: String, call: String, source: String, start: Double, end: Double) -> PublicOpportunity {
        .init(id: id, kind: "dxpedition", callsign: call, reference: "", name: "Sao Tome & Principe", frequencyHz: nil,
              mode: "", observedAt: now, expiresAt: now.addingTimeInterval(end), source: source, sourceURL: "", comment: "",
              startsAt: now.addingTimeInterval(start), endsAt: now.addingTimeInterval(end))
    }

    @Test("Durable expedition history survives reopening and never returns activation authority")
    func durableHistory() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let url = root.appendingPathComponent("history.sqlite")
        let db = try SpotHistoryDatabase(url: url)
        let clock = Date()
        let session = UUID(), cluster = UUID()
        var rows: [SpotHistoryObservation] = []
        for index in 0..<600 {
            let arrived = clock.addingTimeInterval(Double(index - 600))
            let call: String = index == 0 ? "S9R" : "W1AAA"
            let observation = SpotHistoryObservation(sessionID: session, sequence: Int64(index + 1), clusterID: cluster,
                arrivedAt: arrived, rawLine: "fixture", callsign: call, spotter: "OM0RX", frequencyKHz: 14074.5, band: "20m", mode: "FT8")
            rows.append(observation)
        }
        for start in stride(from: 0, to: rows.count, by: 100) {
            try db.append(Array(rows[start..<min(start + 100, rows.count)]))
        }
        let reopened = LiveSpotHistoryMethods(url: url)
        let history = try await reopened.dxpeditionRows(callsigns: ["S9R"], now: clock)
        #expect(history.count == 1)
        #expect(history.first?["callsign"] as? String == "S9R")
        #expect(history.first?["activation"] == nil)
        #expect(history.first?["frequencyKHz"] as? Double == 14074.5)
    }

    @Test("Opt-in primary-provider comparison exports a disposable browser snapshot",
          .enabled(if: ProcessInfo.processInfo.environment["XLOG_DXMAP_LIVE_AUDIT_FILE"] != nil))
    func liveProviders() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let logbook = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        _ = try logbook.handle(method: "workspace_create", params: ["mode": "empty"])
        let actor = LiveOpportunitiesMethods(logbook: logbook, clusterSpots: { [] })
        let result = try await actor.handle(method: "opportunities_dxpedition_refresh", params: ["source": "all"])
        let sources = try #require(result["sources"] as? [[String: Any]])
        #expect(sources.allSatisfy { $0["state"] as? String == "current" })
        let items = try #require(result["items"] as? [[String: Any]])
        #expect(items.count > 20)
        #expect(items.allSatisfy { $0["latitude"] is Double && $0["longitude"] is Double })
        #expect(items.filter { $0["callsign"] as? String == "S9R" }.count == 1)
        #expect(items.contains { $0["callsign"] as? String == "HR5/F2JD" })
        #expect(items.contains { $0["callsign"] as? String == "6W/I2YSB" })
        let s9r = try #require(items.first { $0["callsign"] as? String == "S9R" })
        #expect((s9r["qso_total"] as? Int64 ?? 0) > 40_000)
        let path = try #require(ProcessInfo.processInfo.environment["XLOG_DXMAP_LIVE_AUDIT_FILE"])
        try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys]).write(to: URL(fileURLWithPath: path), options: .atomic)
    }
}

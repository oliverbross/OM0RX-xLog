#if os(macOS)
import Foundation
import Testing
import XLogCore
@testable import XLogPrototypeSupport

@Suite("Isolated opportunities projection")
struct LiveOpportunitiesMethodsTests {
    private struct FixtureFeed: Encodable {
        var items: [PublicOpportunity]
        var lastSuccess: Date
        var lastAttempt: Date
        var safeError: String?
    }

    @Test("Cached public evidence joins complete local reference history without polling a cluster or feed")
    func cachedEvidenceAndHistory() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let logbook = LiveLogbookMethods(supportDirectory: root)
        _ = try logbook.handle(method: "workspace_create", params: ["mode": "empty"])
        let directory = try logbook.referenceDirectoryURL()
        try Data("reference,name,active,locationDesc\nOM-0001,Fixture Park,1,OM\n".utf8)
            .write(to: directory.appendingPathComponent("pota-parks.csv"))

        var qso = try #require(logbook.handle(method: "logbook_draft", params: [:])["qso"] as? [String: Any])
        qso["call"] = "OM0RX/P"
        qso["potaReference"] = "OM-0001"
        qso["lotwReceived"] = "Y"
        _ = try logbook.handle(method: "logbook_save", params: ["qso": qso])

        let now = Date()
        let item = PublicOpportunity(id: "fixture:pota:OM-0001", kind: "pota",
            callsign: "OM0RX/P", reference: "OM-0001", name: "", frequencyHz: 14_074_000,
            mode: "FT8", observedAt: now, expiresAt: now.addingTimeInterval(3_600),
            source: "POTA official spots", sourceURL: OpportunityFeedParser.sourceURL("pota"), comment: "")
        let cache = logbook.workspaceDirectoryURL.appendingPathComponent("Opportunities", isDirectory: true)
        try FileManager.default.createDirectory(at: cache, withIntermediateDirectories: false)
        try JSONEncoder().encode(["pota": FixtureFeed(items: [item], lastSuccess: now,
            lastAttempt: now, safeError: nil)])
            .write(to: cache.appendingPathComponent("public-feed-cache.json"))

        let actor = LiveOpportunitiesMethods(logbook: logbook, clusterSpots: { [] })
        let result = try await actor.handle(method: "opportunities_snapshot", params: [:])
        let rows = try #require(result["items"] as? [[String: Any]])
        let row = try #require(rows.first)
        #expect(row["reference"] as? String == "OM-0001")
        #expect(row["name"] as? String == "Fixture Park")
        #expect(row["reference_status"] as? String == "verified")
        #expect(row["worked_count"] as? Int == 1)
        #expect(row["confirmed_count"] as? Int == 1)
        let cells = try #require(row["band_modes"] as? [[String: Any]])
        #expect(cells.first?["worked_count"] as? Int == 1)
        #expect(result["selection_tunes"] as? Bool == false)
        #expect(result["transmit"] as? Bool == false)

        try JSONEncoder().encode(["pota": FixtureFeed(items: [item], lastSuccess: now,
            lastAttempt: now, safeError: "SOURCE_UNAVAILABLE_OR_INVALID")])
            .write(to: cache.appendingPathComponent("public-feed-cache.json"), options: .atomic)
        let reopened = LiveOpportunitiesMethods(logbook: logbook, clusterSpots: { [] })
        let after = try await reopened.handle(method: "opportunities_snapshot", params: [:])
        #expect((after["items"] as? [[String: Any]])?.count == 1)
        let sources = try #require(after["sources"] as? [[String: Any]])
        #expect(sources.first { $0["source"] as? String == "pota" }?["state"] as? String == "stale")
    }

    @Test("No cache and no configured cluster make no unworked claims about missing evidence")
    func emptySources() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let logbook = LiveLogbookMethods(supportDirectory: root)
        _ = try logbook.handle(method: "workspace_create", params: ["mode": "empty"])
        let actor = LiveOpportunitiesMethods(logbook: logbook, clusterSpots: { [] })
        let result = try await actor.handle(method: "opportunities_snapshot", params: [:])
        #expect((result["items"] as? [[String: Any]])?.isEmpty == true)
        #expect((result["sources"] as? [[String: Any]])?.allSatisfy { $0["state"] as? String == "unavailable" } == true)
        await #expect(throws: WorkerFailure.self) {
            try await actor.handle(method: "opportunities_refresh", params: ["source": "arbitrary"])
        }
    }
}
#endif

import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import Testing
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif
@testable import XLogPrototypeSupport

@Suite("Isolated opportunities projection")
struct LiveOpportunitiesMethodsTests {
    @Test("Default cluster projection is constructible without starting a transport")
    func defaultClusterProjection() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let logbook = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        _ = try logbook.handle(method: "workspace_create", params: ["mode": "empty"])
        let service = LiveOpportunitiesMethods(logbook: logbook)
        let result = try await service.handle(method: "opportunities_snapshot", params: [:])
        #expect(result["selection_tunes"] as? Bool == false)
        #expect(result["transmit"] as? Bool == false)
        await service.terminate()
        await #expect(throws: WorkerFailure.self) {
            try await service.handle(method: "opportunities_snapshot", params: [:])
        }
    }

    @Test("Programme tags do not turn WWFF, SOTA or castle references into POTA")
    func distinctProgrammeReferences() {
        for comment in ["KFF-3017", "KFF-2099 FFF-0001", "WCA F-01234", "SOTA W1/AB-1234"] {
            #expect(AwardReferenceParser.extract(comment: comment, specialTags: ["POTA"]).pota.isEmpty)
        }
        for comment in ["KFF-3017 POTA US-3051", "WCA F-01234 POTA US-3051",
                        "POTA SOTA W1/AB-1234 US-3051", "POTA US-3051 KFF-3017"] {
            #expect(AwardReferenceParser.extract(comment: comment).pota == "US-3051")
        }
        #expect(AwardReferenceParser.extract(comment: "KFF-3017 POTA US-3051").wwff == "KFF-3017")
    }

    @Test("Cluster WWFF observations appear once under WWFF, not also under POTA")
    func clusterProgrammeIdentity() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let logbook = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        _ = try logbook.handle(method: "workspace_create", params: ["mode": "empty"])
        let database = try logbook.openedDatabase()
        try database.save(QSO(call: "W1PHONE", band: "20m", mode: "SSB", dxcc: 291, qslReceived: "Y"))
        try database.save(QSO(call: "W1DIGI", band: "20m", mode: "DATA", submode: "FT8", dxcc: 291))
        let actor = LiveOpportunitiesMethods(logbook: logbook, clusterSpots: {
            [["id": "wwff", "callsign": "K5G", "comment": "KFF-3017", "specialTags": ["POTA", "WWFF"], "frequencyKHz": 18088.0],
             ["id": "both", "callsign": "W5MEF", "comment": "KFF-2099 POTA US-3051", "specialTags": ["POTA", "WWFF"], "frequencyKHz": 14250.0]]
        })
        let result = try await actor.handle(method: "opportunities_snapshot", params: [:])
        let rows = try #require(result["items"] as? [[String: Any]])
        #expect(rows.count == 3)
        #expect(rows.filter { $0["callsign"] as? String == "K5G" }.count == 1)
        let k5g = try #require(rows.first { $0["callsign"] as? String == "K5G" })
        let dxcc = try #require(k5g["dxcc_history"] as? [String: Any])
        #expect(dxcc["adif"] as? Int == 291)
        #expect(dxcc["confirmed_modes"] as? [String] == ["SSB"])
        #expect(dxcc["worked_modes"] as? [String] == ["FT8"])
        let callsign = try #require(k5g["callsign_history"] as? [String: Any])
        #expect(callsign["worked_count"] as? Int == 0)
        #expect(callsign["confirmed_count"] as? Int == 0)
        #expect(rows.filter { $0["kind"] as? String == "pota" }.map { $0["reference"] as? String } == ["US-3051"])
        #expect(Set(rows.filter { $0["kind"] as? String == "wwff" }.compactMap { $0["reference"] as? String }) == ["KFF-3017", "KFF-2099"])
        #expect(result["selection_tunes"] as? Bool == false)
        #expect(result["transmit"] as? Bool == false)
    }

    private struct FixtureFeed: Encodable {
        var items: [PublicOpportunity]
        var lastSuccess: Date
        var lastAttempt: Date
        var safeError: String?
    }

    @Test("Public feed coordinates and zone-less UTC timestamps remain authoritative")
    func publicCoordinatesAndDates() throws {
        let now = Date(timeIntervalSince1970: 1_791_763_200)
        let body = Data(#"[{"activator":"OM0RX/P","reference":"OM-0001","frequency":"14074","spotTime":"2026-10-12T10:00:00","latitude":48.2,"longitude":18.4}]"#.utf8)
        let row = try #require(OpportunityFeedParser.parse(body, source: "pota", observedAt: now).first)
        #expect(row.latitude == 48.2)
        #expect(row.longitude == 18.4)
        #expect(row.observedAt == ISO8601DateFormatter().date(from: "2026-10-12T10:00:00Z"))
        for source in ["pota", "sota", "wwff", "wwbota", "425dxn"] {
            #expect(try OpportunityFeedParser.parse(Data("[]".utf8), source: source, observedAt: now).isEmpty)
        }
        #expect(throws: OpportunityFeedError.self) {
            try OpportunityFeedParser.parse(Data("[]".utf8), source: "unknown", observedAt: now)
        }
        let invalid = Data(#"[{"activator":"OM0RX/P","reference":"OM-0001","frequency":"14074","latitude":91,"longitude":181}]"#.utf8)
        let bounded = try #require(OpportunityFeedParser.parse(invalid, source: "pota", observedAt: now).first)
        #expect(bounded.latitude == nil && bounded.longitude == nil)
        let wwff = Data(#"[{"activator":"W4Y","reference":"KFF-1260","frequency_khz":14253,"spot_time":1791839870,"spot_time_formatted":"2026-10-12 21:17:50"}]"#.utf8)
        let timestamped = try #require(OpportunityFeedParser.parse(wwff, source: "wwff", observedAt: now).first)
        #expect(timestamped.observedAt.timeIntervalSince1970 == 1_791_839_870)
    }

    @Test("Automatic batches refresh every feed, coalesce concurrent windows and observe cooldowns")
    func automaticBatches() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let logbook = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        _ = try logbook.handle(method: "workspace_create", params: ["mode": "empty"])
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [EmptyOpportunityProjectionFeed.self]
        let session = URLSession(configuration: config)
        defer { session.invalidateAndCancel() }
        let actor = LiveOpportunitiesMethods(logbook: logbook, session: session, clusterSpots: { [] })
        async let first = actor.handle(method: "opportunities_refresh", params: ["source": "all"])
        async let second = actor.handle(method: "opportunities_refresh", params: ["source": "all"])
        let results = try await [first, second]
        let sources = try #require(results[0]["sources"] as? [[String: Any]])
        #expect(sources.count == 6)
        #expect(sources.allSatisfy { $0["state"] as? String == "current" })
        #expect(sources.reduce(0) { $0 + ($1["count"] as? Int ?? 0) } == 1)
        let attempts = sources.compactMap { $0["last_attempt"] as? String }
        #expect(attempts.count == 6)
        let later = try await actor.handle(method: "opportunities_refresh", params: ["source": "all"])
        #expect((later["sources"] as? [[String: Any]])?.compactMap { $0["last_attempt"] as? String } == attempts)
        await actor.terminate()
        await #expect(throws: WorkerFailure.self) {
            try await actor.handle(method: "opportunities_refresh", params: ["source": "all"])
        }
    }

    @Test("DXpedition refresh is narrow to its catalogues and primary Club Log enrichment")
    func dxpeditionRefreshBoundary() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let logbook = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        _ = try logbook.handle(method: "workspace_create", params: ["mode": "empty"])
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [EmptyOpportunityProjectionFeed.self]
        let session = URLSession(configuration: config)
        defer { session.invalidateAndCancel() }
        let actor = LiveOpportunitiesMethods(logbook: logbook, session: session, clusterSpots: { [] })
        let result = try await actor.handle(method: "opportunities_dxpedition_refresh", params: ["source": "all"])
        let sources = try #require(result["sources"] as? [[String: Any]])
        #expect(Set(sources.compactMap { $0["source"] as? String }) == Set(["adxo", "425dxn", "clublog"]))
        #expect(sources.allSatisfy { $0["last_attempt"] is String })
        let shared = try await actor.handle(method: "opportunities_snapshot", params: [:])
        let sharedSources = try #require(shared["sources"] as? [[String: Any]])
        #expect(sharedSources.filter { !["adxo", "425dxn"].contains($0["source"] as? String ?? "") }
            .allSatisfy { $0["last_attempt"] is NSNull })
        await #expect(throws: WorkerFailure.self) {
            try await actor.handle(method: "opportunities_dxpedition_refresh", params: ["source": "pota"])
        }
    }

    @Test("A pre-repair catalogue cache refreshes immediately despite its six-hour success cooldown")
    func upgradesOldCatalogue() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let logbook = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        _ = try logbook.handle(method: "workspace_create", params: ["mode": "empty"])
        let now = Date()
        let old = PublicOpportunity(id: "old-prefix", kind: "dxpedition", callsign: "HR5", reference: "", name: "Honduras", frequencyHz: nil,
            mode: "", observedAt: now, expiresAt: now.addingTimeInterval(86_400), source: "NG3K ADXO", sourceURL: "", comment: "")
        let cache = logbook.workspaceDirectoryURL.appendingPathComponent("Opportunities")
        try FileManager.default.createDirectory(at: cache, withIntermediateDirectories: false)
        try JSONEncoder().encode(["adxo": FixtureFeed(items: [old], lastSuccess: now, lastAttempt: now)])
            .write(to: cache.appendingPathComponent("public-feed-cache.json"))
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [EmptyOpportunityProjectionFeed.self]
        let session = URLSession(configuration: config); defer { session.invalidateAndCancel() }
        let actor = LiveOpportunitiesMethods(logbook: logbook, session: session, clusterSpots: { [] })
        let result = try await actor.handle(method: "opportunities_dxpedition_refresh", params: ["source": "adxo", "automatic": true])
        let rows = try #require(result["items"] as? [[String: Any]])
        #expect(rows.contains { $0["callsign"] as? String == "TEST1" })
        #expect(!rows.contains { $0["callsign"] as? String == "HR5" })
    }

    @Test("Every shared public programme and the DX calendar retain their source evidence")
    func portableProgrammeParsing() throws {
        let now = Date(timeIntervalSince1970: 1_791_763_200)
        for (source, reference) in [("pota", "OM-0001"), ("sota", "FL/VO-209"),
                                    ("wwff", "OMFF-0123"), ("wwbota", "OM-CAS-1")] {
            let body = try JSONSerialization.data(withJSONObject: [["activator": "OM0RX/P",
                "reference": reference, "frequency": "14074", "mode": "FT8"]])
            let rows = try OpportunityFeedParser.parse(body, source: source, observedAt: now)
            #expect(rows.count == 1)
            #expect(rows[0].reference == reference)
            #expect(rows[0].frequencyHz == 14_074_000)
            #expect(rows[0].sourceURL == OpportunityFeedParser.sourceURL(source))
        }
        let calendar = Data(#"[{"from":"2026-10-01","to":"2026-10-20","cal":"DX1ABC: Island (EU-001)"}]"#.utf8)
        let events = try OpportunityFeedParser.parse(calendar, source: "425dxn", observedAt: now)
        #expect(events.first?.kind == "dxpedition")
        #expect(events.first?.frequencyHz == nil)
        #expect(events.first?.sourceURL.contains("425dxn.org") == true)
        #expect(events.first?.reference == "EU-001")
        #expect(events.first?.startsAt == ISO8601DateFormatter().date(from: "2026-10-01T00:00:00Z"))
        #expect(events.first?.callsigns == ["DX1ABC"])
        #expect(OpportunityFeedParser.iotaReference(in: "Island holiday") == nil)
        #expect(throws: OpportunityFeedError.self) {
            try OpportunityFeedParser.parse(Data("<html>not a feed</html>".utf8), source: "pota", observedAt: now)
        }
    }

    @Test("Island expeditions join reference areas and only fresh exact-alias spots during their dates")
    func islandExpeditions() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let logbook = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        _ = try logbook.handle(method: "workspace_create", params: ["mode": "empty"])
        let directory = try logbook.referenceDirectoryURL()
        try Data(#"[{"refno":"OC-001","name":"Date line islands","latitude_min":-12,"latitude_max":-10,"longitude_min":179,"longitude_max":-179}]"#.utf8)
            .write(to: directory.appendingPathComponent("iota-groups.json"))
        let now = Date()
        let item = PublicOpportunity(id: "calendar:island", kind: "dxpedition", callsign: "DX1ABC", reference: "OC-001",
            name: "DX1ABC, DX2ABC: Island (OC-001)", frequencyHz: nil, mode: "", observedAt: now,
            expiresAt: now.addingTimeInterval(86_400), source: "425DXN Worldwide DX Calendar", sourceURL: "", comment: "",
            startsAt: now.addingTimeInterval(-86_400), endsAt: now.addingTimeInterval(86_400), callsigns: ["DX1ABC", "DX2ABC"], qslRoute: "via M0OXO")
        var future = item; future.id = "calendar:future"; future.startsAt = now.addingTimeInterval(2 * 86_400)
        future.endsAt = now.addingTimeInterval(3 * 86_400); future.expiresAt = future.endsAt!
        var unlocated = item; unlocated.id = "calendar:unknown"; unlocated.reference = ""; unlocated.name = "Unknown island"; unlocated.callsigns = ["DX3ABC"]
        let cache = logbook.workspaceDirectoryURL.appendingPathComponent("Opportunities", isDirectory: true)
        try FileManager.default.createDirectory(at: cache, withIntermediateDirectories: false)
        try JSONEncoder().encode(["425dxn": FixtureFeed(items: [item, future, unlocated], lastSuccess: now, lastAttempt: now)])
            .write(to: cache.appendingPathComponent("public-feed-cache.json"))
        let actor = LiveOpportunitiesMethods(logbook: logbook, clusterSpots: {
            [["id": "fresh", "callsign": "DX2ABC", "comment": "POTA US-3051", "frequencyKHz": 14250.0, "mode": "SSB", "receivedAt": now.timeIntervalSinceReferenceDate],
             ["id": "old", "callsign": "DX1ABC", "frequencyKHz": 21050.0, "receivedAt": now.addingTimeInterval(-7_200).timeIntervalSinceReferenceDate]]
        })
        let result = try await actor.handle(method: "opportunities_snapshot", params: [:])
        let rows = try #require(result["items"] as? [[String: Any]])
        let located = try #require(rows.first { $0["id"] as? String == item.id })
        #expect(located["programmes"] as? [String] == ["dxpedition", "iota"])
        #expect(located["longitude"] as? Double == 180)
        #expect(located["latitude"] as? Double == -11)
        #expect(located["location_accuracy"] as? String == "reference_area")
        #expect(located["callsign"] as? String == "DX2ABC")
        #expect(located["frequency_hz"] as? Int64 == 14_250_000)
        #expect(located["activity"] as? String == "spotted_operation")
        let futureRow = try #require(rows.first { $0["id"] as? String == future.id })
        #expect(futureRow["frequency_hz"] is NSNull)
        #expect(futureRow["activity"] as? String == "scheduled")
        let unknown = try #require(rows.first { $0["id"] as? String == unlocated.id })
        #expect(unknown["latitude"] is NSNull)
        #expect(unknown["location_accuracy"] as? String == "unavailable")
        #expect(result["selection_tunes"] as? Bool == false)
        _ = try JSONSerialization.data(withJSONObject: result)

        let map = try await actor.handle(method: "opportunities_dxpedition_snapshot", params: [:])
        let expeditions = try #require(map["items"] as? [[String: Any]])
        #expect(expeditions.count == 3)
        #expect(map["total_available"] as? Int == 3)
        #expect(expeditions.allSatisfy { $0["kind"] as? String == "dxpedition" })
        let primary = try #require(expeditions.first { $0["id"] as? String == item.id })
        #expect(primary["callsign"] as? String == "DX1ABC")
        #expect(primary["aliases"] as? [String] == ["DX1ABC", "DX2ABC"])
        #expect(primary["frequency_hz"] as? Int64 == 14_250_000)
        #expect(primary["qsl_route"] as? String == "via M0OXO")
        #expect(primary["activity"] as? String == "spotted_operation")
        #expect(map["surface"] as? String == "dxpedition_map")
    }

    @Test("Refresh uses the bounded portable transport and preserves validated cache on failure")
    func refreshAndFallback() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let logbook = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        _ = try logbook.handle(method: "workspace_create", params: ["mode": "empty"])
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [ValidOpportunityProjectionFeed.self]
        let session = URLSession(configuration: config)
        defer { session.invalidateAndCancel() }
        let actor = LiveOpportunitiesMethods(logbook: logbook, session: session, clusterSpots: { [] })
        let fresh = try await actor.handle(method: "opportunities_refresh", params: ["source": "pota"])
        let freshRows = try #require(fresh["items"] as? [[String: Any]])
        #expect(freshRows.count == 1)
        #expect(freshRows.first?["callsign"] as? String == "OM0RX/P")
        #expect(freshRows.first?["frequency_hz"] as? Int64 == 14_074_000)
        #expect(freshRows.first?["reference_status"] as? String == "not_installed")
        #expect(freshRows.first?["latitude"] as? Double == 48.2)
        #expect(freshRows.first?["longitude"] as? Double == 18.4)
        #expect(freshRows.first?["location_source"] as? String == "Public feed")
        let wire = try JSONSerialization.data(withJSONObject: fresh)
        let decoded = try #require(JSONSerialization.jsonObject(with: wire) as? [String: Any])
        #expect((decoded["items"] as? [[String: Any]])?.first?["latitude"] as? Double == 48.2)

        let badConfig = URLSessionConfiguration.ephemeral
        badConfig.protocolClasses = [FailedOpportunityProjectionFeed.self]
        let badSession = URLSession(configuration: badConfig)
        defer { badSession.invalidateAndCancel() }
        let reopened = LiveOpportunitiesMethods(logbook: logbook, session: badSession, clusterSpots: { [] })
        // Automatic per-source refreshes retain the cross-window/remount cooldown.
        // The failing transport would make this stale if another download started.
        let automatic = try await reopened.handle(method: "opportunities_refresh", params: ["source": "pota", "automatic": true])
        let automaticSource = try #require((automatic["sources"] as? [[String: Any]])?.first { $0["source"] as? String == "pota" })
        #expect(automaticSource["state"] as? String == "current")
        #expect(automaticSource["safe_error"] is NSNull)
        let freshSource = try #require((fresh["sources"] as? [[String: Any]])?.first { $0["source"] as? String == "pota" })
        #expect(automaticSource["last_attempt"] as? String == freshSource["last_attempt"] as? String)
        await #expect(throws: WorkerFailure.self) {
            try await reopened.handle(method: "opportunities_refresh", params: ["source": "pota", "automatic": "true"])
        }
        let fallback = try await reopened.handle(method: "opportunities_refresh", params: ["source": "pota"])
        let fallbackRows = try #require(fallback["items"] as? [[String: Any]])
        #expect(fallbackRows.first?["id"] as? String == freshRows.first?["id"] as? String)
        let sources = try #require(fallback["sources"] as? [[String: Any]])
        let source = try #require(sources.first { $0["source"] as? String == "pota" })
        #expect(source["state"] as? String == "stale")
        #expect(source["safe_error"] as? String == "SOURCE_UNAVAILABLE_OR_INVALID")
    }

    @Test("Worker routes opportunities to its own local workspace without contacting a publisher")
    func workerRoute() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let logbook = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        _ = try logbook.handle(method: "workspace_create", params: ["mode": "empty"])
        let worker = LiveWorker(logbook: logbook)
        let request = Data(#"{"id":"opportunities","method":"opportunities_snapshot","params":{}}"#.utf8)
        let response = try #require(JSONSerialization.jsonObject(with: await worker.response(to: request)) as? [String: Any])
        #expect(response["ok"] as? Bool == true)
        let result = try #require(response["result"] as? [String: Any])
        #expect((result["items"] as? [[String: Any]])?.isEmpty == true)
        #expect(result["history_state"] as? String == "ready")
        let mapRequest = Data(#"{"id":"dx-map","method":"opportunities_dxpedition_snapshot","params":{}}"#.utf8)
        let mapResponse = try #require(JSONSerialization.jsonObject(with: await worker.response(to: mapRequest)) as? [String: Any])
        #expect(mapResponse["ok"] as? Bool == true)
        let map = try #require(mapResponse["result"] as? [String: Any])
        #expect(map["surface"] as? String == "dxpedition_map")
        #expect((map["sources"] as? [[String: Any]])?.count == 3)
        await worker.beginTerminalShutdown()
        let stopped = try #require(JSONSerialization.jsonObject(with: await worker.response(to: request)) as? [String: Any])
        #expect((stopped["error"] as? [String: Any])?["code"] as? String == "worker_stopping")
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
        qso["band"] = "20m"
        qso["mode"] = "FT8"
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
        let callsign = try #require(row["callsign_history"] as? [String: Any])
        #expect(callsign["worked_count"] as? Int == 1)
        #expect(callsign["confirmed_count"] as? Int == 1)
        #expect(callsign["worked_modes"] as? [String] == ["FT8"])
        #expect(callsign["confirmed_modes"] as? [String] == ["FT8"])
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

private final class ValidOpportunityProjectionFeed: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let response = HTTPURLResponse(url: request.url!, statusCode: 200,
            httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(#"[{"activator":"OM0RX/P","reference":"OM-0001","frequency":"14074","mode":"FT8","latitude":48.2,"longitude":18.4}]"#.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() { }
}

private final class FailedOpportunityProjectionFeed: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let response = HTTPURLResponse(url: request.url!, statusCode: 503,
            httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "text/html"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() { }
}

private final class EmptyOpportunityProjectionFeed: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let adxo = request.url?.path.hasSuffix("/adxoplain.html") == true
        let response = HTTPURLResponse(url: request.url!, statusCode: 200,
            httpVersion: "HTTP/1.1", headerFields: ["Content-Type": adxo || request.url?.host == "clublog.org" ? "text/html" : "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        let body = adxo ? "<p>Jan 1, 2020 - Dec 31, 2099</p><p>DXCC: Fixture</p><p>Callsign: TEST1</p>" : "[]"
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() { }
}

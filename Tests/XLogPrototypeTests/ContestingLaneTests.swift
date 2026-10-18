import Foundation
import XCTest
import XContestCore
@testable import XLogPrototypeSupport

final class ContestingLaneTests: XCTestCase {
    private let generation = "f1111111-2222-4333-8444-555555555555"

    func testFoundationBooleanFallbackRejectsNumericAndInt8Values() throws {
        func number(_ source: String) throws -> NSNumber {
            let value = try JSONSerialization.jsonObject(with: Data(source.utf8), options: [.fragmentsAllowed])
            return try XCTUnwrap(value as? NSNumber)
        }
        XCTAssertTrue(ContestLane.isFoundationBoolean(try number("true")))
        XCTAssertTrue(ContestLane.isFoundationBoolean(try number("false")))
        XCTAssertFalse(ContestLane.isFoundationBoolean(try number("0")))
        XCTAssertFalse(ContestLane.isFoundationBoolean(try number("1")))
        XCTAssertFalse(ContestLane.isFoundationBoolean(NSNumber(value: Int8(0))))
        XCTAssertFalse(ContestLane.isFoundationBoolean(NSNumber(value: Int8(1))))
    }

    func testGeographicDisplayLabelsRequireThePinnedReferenceAndNeverExposeMalformedKeys() throws {
        let reference = try ContestReferenceData.bundled()
        func value(_ components: [String]) -> String {
            components.map { "\($0.utf8.count):\($0)" }.joined()
        }
        let subdivision = ContestMultiplierKey(
            kind: "administrativeSubdivision",
            value: value(["sst-canadian-province", reference.version, "1", "NF"]), scope: "40m")
        XCTAssertEqual(reference.displayLabel(subdivision, referenceDataVersion: reference.version),
                       "NF subdivision · 40m")

        let entity = ContestMultiplierKey(
            kind: "dxccEntity",
            value: value(["dxcc-entity", reference.version, "110"]), scope: "20m")
        XCTAssertEqual(reference.displayLabel(entity, referenceDataVersion: reference.version),
                       "Hawaii · 20m")
        XCTAssertEqual(reference.displayLabel(entity, referenceDataVersion: "different-reference"),
                       "Unknown geographic multiplier · 20m")

        let malformedValue = "999:serialized-key-must-not-escape"
        let malformed = ContestMultiplierKey(kind: "administrativeSubdivision",
                                             value: malformedValue, scope: "80m")
        let malformedLabel = reference.displayLabel(malformed, referenceDataVersion: reference.version)
        XCTAssertEqual(malformedLabel, "Unknown geographic multiplier · 80m")
        XCTAssertFalse(malformedLabel.contains(malformedValue))

        XCTAssertEqual(reference.displayLabel(
            .init(kind: "naqp-state", value: "HI", scope: "20m"),
            referenceDataVersion: reference.version), "Hawaii · 20m")
    }

    private func fixture() throws -> (URL, ContestLane) {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-contest-lane-\(UUID().uuidString)")
        let lane = try ContestLane(databaseURL: root.appendingPathComponent("Contesting/contests.sqlite")) { [generation] in generation }
        return (root, lane)
    }

    private func mutation(sessionID: UUID, requestID: UUID, revision: Int, timestamp: String,
                          payload: [String: Any], draftID: UUID? = nil, digest: String? = nil,
                          workspaceGeneration: String? = nil) -> [String: Any] {
        var value: [String: Any] = [
            "sessionID": wireID(sessionID), "workspaceGeneration": workspaceGeneration ?? generation,
            "requestID": wireID(requestID), "expectedRevision": revision,
            "payloadDigest": digest ?? String(repeating: "a", count: 64),
            "operationTimestamp": timestamp, "payload": payload,
        ]
        if let draftID { value["draftID"] = wireID(draftID) }
        return value
    }

    private func wireID(_ value: UUID) -> String { value.uuidString.lowercased() }
    private func canonicalJSON(_ value: [String: Any]) throws -> Data {
        try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    }

    func testSCPStatusCannotCreateServiceAfterShutdownDuringInitialGenerationFence() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-scp-shutdown-fence-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let gate = ContestGenerationGate(value: generation)
        let lane = try ContestLane(databaseURL: root.appendingPathComponent("Contesting/contests.sqlite")) { await gate.wait() }
        let operation = Task { try await lane.handle(method: "contest_scp_status", params: [:]) }
        await gate.awaiting()
        await lane.shutdown()
        await gate.release()
        do { _ = try await operation.value; XCTFail("Expected terminal assistance lane") }
        catch let error as ContestLaneError { XCTAssertEqual(error.code, "scp_unavailable") }
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent("Contesting/SuperCheckPartial").path))
    }

    func testAssistanceStatusAfterShutdownPreservesRouteSpecificErrorsWithoutCreatingCaches() async throws {
        let (root, lane) = try fixture()
        defer { try? FileManager.default.removeItem(at: root) }
        await lane.shutdown()
        for (method, code) in [("contest_scp_status", "scp_unavailable"),
                               ("contest_history_status", "history_unavailable")] {
            do { _ = try await lane.handle(method: method, params: [:]); XCTFail("Expected \(code)") }
            catch let error as ContestLaneError { XCTAssertEqual(error.code, code) }
        }
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent("Contesting/SuperCheckPartial").path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent("Contesting/CallHistory").path))
    }

    private func workerRequest(_ worker: LiveWorker, method: String, params: [String: Any] = [:],
                               id: UUID = UUID()) async throws -> [String: Any] {
        let data = try JSONSerialization.data(withJSONObject: ["id": wireID(id), "method": method, "params": params])
        let response = await worker.response(to: data)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: response) as? [String: Any])
    }

    private func makeSession(_ lane: ContestLane, ruleName: String = "CQ WPX CW",
                             stationCallsign: String = "OM0RX", cqZone: String = "15",
                             dxccEntity: String = "SLOVAK REPUBLIC") async throws -> (UUID, UUID, [String: Any]) {
        let catalog = try await lane.handle(method: "contest_catalog", params: [:])
        let rules = try XCTUnwrap(catalog["rules"] as? [[String: Any]])
        let rule = try XCTUnwrap(rules.first { $0["displayName"] as? String == ruleName })
        let identity = try XCTUnwrap(rule["identity"] as? [String: Any])
        let reference = try XCTUnwrap(rule["referenceDataVersion"] as? String)
        let sessionID = UUID(uuidString: "f1234567-89ab-4cde-8fab-0123456789ab")!
        let createID = UUID(uuidString: "a1234567-89ab-4cde-8fab-0123456789ab")!
        let payload: [String: Any] = [
            "sessionID": wireID(sessionID), "name": "WPX test",
            "ruleIdentity": identity, "referenceDataVersion": reference,
            "station": ["callsign": stationCallsign, "cqZone": cqZone, "dxccEntity": dxccEntity],
            "operator": ["callsign": stationCallsign, "category": "single-op"],
        ]
        let result = try await lane.handle(method: "contest_create", params: mutation(
            sessionID: sessionID, requestID: createID, revision: 0,
            timestamp: "2026-10-17T01:00:00.000Z", payload: payload))
        return (sessionID, createID, result)
    }

    func testCQWWWorkerCreatePreservesStationSnapshotExchangeThroughCommit() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-cqww-worker-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let profile = try AppRuntimeProfile.contestingTestProfile(applicationSupport: root)
        guard case .contestingTest(let supportRoot) = profile else { return XCTFail("Expected contest profile") }
        let logbook = LiveLogbookMethods(supportDirectory: supportRoot, inheritNativePreferences: false, runtimeProfile: profile)
        _ = try logbook.handle(method: "workspace_create", params: ["mode": "empty"])
        let worker = LiveWorker(logbook: logbook, runtimeProfile: profile)
        let catalogFrame = try await workerRequest(worker, method: "contest_catalog")
        let catalog = try XCTUnwrap(catalogFrame["result"] as? [String: Any])
        let generation = try XCTUnwrap(catalog["workspaceGeneration"] as? String)
        let rules = try XCTUnwrap(catalog["rules"] as? [[String: Any]])
        let rule = try XCTUnwrap(rules.first { ($0["identity"] as? [String: Any])?["id"] as? String == "cq-ww-cw" })
        let sessionID = UUID(), draftID = UUID()
        let payload: [String: Any] = [
            "sessionID": wireID(sessionID), "name": "CQ WW v1 reset regression",
            "ruleIdentity": try XCTUnwrap(rule["identity"] as? [String: Any]),
            "referenceDataVersion": try XCTUnwrap(rule["referenceDataVersion"] as? String),
            "station": ["callsign": "OM0RX", "cqZone": "15", "dxccEntity": "SLOVAK REPUBLIC"],
            "operator": ["callsign": "OM0RX", "category": "single-op"],
        ]
        let created = try await workerRequest(worker, method: "contest_create", params: mutation(
            sessionID: sessionID, requestID: draftID, revision: 0, timestamp: "2026-10-18T22:00:00.000Z",
            payload: payload, workspaceGeneration: generation))
        let createdResult = try XCTUnwrap(created["result"] as? [String: Any])
        let createdFields = try XCTUnwrap((createdResult["draft"] as? [String: Any])?["fields"] as? [String: Any])
        XCTAssertEqual(createdFields["sentExchange"] as? String, "15")

        let fields: [String: Any] = ["callsign": "K1ABC", "sentReport": "599", "sentExchange": "15",
            "receivedReport": "599", "receivedExchange": "05", "frequencyHz": 14_025_000,
            "band": "20m", "mode": "CW"]
        let applied = try await workerRequest(worker, method: "contest_draft_apply", params: mutation(
            sessionID: sessionID, requestID: UUID(), revision: 1, timestamp: "2026-10-18T22:01:00.000Z",
            payload: ["fields": fields], draftID: draftID, workspaceGeneration: generation))
        XCTAssertEqual((((applied["result"] as? [String: Any])?["draft"] as? [String: Any])?["fields"] as? [String: Any])?["sentExchange"] as? String, "15")
        let committed = try await workerRequest(worker, method: "contest_qso_commit", params: mutation(
            sessionID: sessionID, requestID: UUID(), revision: 2, timestamp: "2026-10-18T22:02:00.000Z",
            payload: [:], draftID: draftID, workspaceGeneration: generation))
        XCTAssertEqual(((committed["result"] as? [String: Any])?["qso"] as? [String: Any])?["sentExchange"] as? String, "15")
    }

    private func commitSerialContact(_ lane: ContestLane, sessionID: UUID, draftID: UUID, revision: Int,
                                     call: String, band: String, frequencyHz: Int, mode: String,
                                     report: String, received: String, minute: Int) async throws -> Int {
        let reserved = try await lane.handle(method: "contest_serial_reserve", params: mutation(
            sessionID: sessionID, requestID: UUID(), revision: revision,
            timestamp: String(format: "2026-10-17T07:%02d:00.000Z", minute), payload: [:], draftID: draftID))
        let sent = try XCTUnwrap((((reserved["draft"] as? [String: Any])?["fields"] as? [String: Any])?["sentExchange"] as? String))
        let fields: [String: Any] = ["callsign": call, "sentReport": report, "sentExchange": sent,
            "receivedReport": report, "receivedExchange": received, "frequencyHz": frequencyHz,
            "band": band, "mode": mode]
        _ = try await lane.handle(method: "contest_draft_apply", params: mutation(
            sessionID: sessionID, requestID: UUID(), revision: revision + 1,
            timestamp: String(format: "2026-10-17T07:%02d:10.000Z", minute), payload: ["fields": fields], draftID: draftID))
        _ = try await lane.handle(method: "contest_qso_commit", params: mutation(
            sessionID: sessionID, requestID: UUID(), revision: revision + 2,
            timestamp: String(format: "2026-10-17T07:%02d:20.000Z", minute), payload: [:], draftID: draftID))
        return revision + 3
    }

    private func commitContact(_ lane: ContestLane, sessionID: UUID, draftID: UUID,
                               revision: Int, callsign: String, minute: Int,
                               operatorStyle: String? = nil) async throws -> (UUID, Int, [String: Any]) {
        let reserveID = UUID(), applyID = UUID(), qsoID = UUID()
        let reserved = try await lane.handle(method: "contest_serial_reserve", params: mutation(
            sessionID: sessionID, requestID: reserveID, revision: revision,
            timestamp: String(format: "2026-10-17T03:%02d:00.000Z", minute), payload: [:], draftID: draftID))
        let sent = try XCTUnwrap((((reserved["draft"] as? [String: Any])?["fields"] as? [String: Any])?["sentExchange"] as? String))
        let fields: [String: Any] = ["callsign": callsign, "sentReport": "599", "sentExchange": sent,
            "receivedReport": "599", "receivedExchange": "1", "frequencyHz": 14_025_000,
            "band": "20m", "mode": "CW"]
        _ = try await lane.handle(method: "contest_draft_apply", params: mutation(
            sessionID: sessionID, requestID: applyID, revision: revision + 1,
            timestamp: String(format: "2026-10-17T03:%02d:10.000Z", minute),
            payload: ["fields": fields], draftID: draftID))
        var commitPayload: [String: Any] = [:]
        if let operatorStyle { commitPayload["operatorStyle"] = operatorStyle }
        let committed = try await lane.handle(method: "contest_qso_commit", params: mutation(
            sessionID: sessionID, requestID: qsoID, revision: revision + 2,
            timestamp: String(format: "2026-10-17T03:%02d:20.000Z", minute),
            payload: commitPayload, draftID: draftID))
        return (qsoID, revision + 3, committed)
    }

    func testStatisticsUsesLoggedContactsPersistedStylesAndStableInjectedClockAcrossRestart() async throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("xlog-contest-statistics-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let databaseURL = root.appendingPathComponent("Contesting/contests.sqlite")
        let now = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-10-17T03:30:00Z"))
        let lane = try ContestLane(databaseURL: databaseURL, generationSource: { [generation] in generation },
                                   clock: { now })
        let (sessionID, draftID, _) = try await makeSession(lane)
        let (_, revision, _) = try await commitContact(lane, sessionID: sessionID, draftID: draftID,
                                                        revision: 1, callsign: "K1ABC", minute: 1,
                                                        operatorStyle: "run")
        let (_, finalRevision, _) = try await commitContact(lane, sessionID: sessionID, draftID: draftID,
                                                             revision: revision, callsign: "K1ABC", minute: 2,
                                                             operatorStyle: "search-and-pounce")
        let params: [String: Any] = ["sessionID": wireID(sessionID), "workspaceGeneration": generation,
                                     "expectedRevision": finalRevision]
        let statistics = try await lane.handle(method: "contest_statistics", params: params)
        XCTAssertEqual((statistics["loggedQSOs"] as? NSNumber)?.intValue, 2)
        XCTAssertEqual((statistics["acceptedQSOs"] as? NSNumber)?.intValue, 1)
        XCTAssertEqual((statistics["duplicateQSOs"] as? NSNumber)?.intValue, 1)
        XCTAssertEqual((statistics["currentHourQSOs"] as? NSNumber)?.intValue, 2)
        let styles = try XCTUnwrap((statistics["operatorStyles"] as? [String: Any])?["total"] as? [String: Any])
        XCTAssertEqual((styles["run"] as? NSNumber)?.intValue, 1)
        XCTAssertEqual((styles["searchAndPounce"] as? NSNumber)?.intValue, 1)
        XCTAssertEqual((styles["unknown"] as? NSNumber)?.intValue, 0)
        let total = try XCTUnwrap(statistics["total"] as? [String: Any])
        XCTAssertEqual((total["distinctWPXPrefixes"] as? NSNumber)?.intValue, 1)
        XCTAssertEqual((total["creditedPoints"] as? NSNumber)?.int64Value, 3)
        XCTAssertEqual(statistics["asOfUTC"] as? String, "2026-10-17T03:30:00.000Z")

        let reopened = try ContestLane(databaseURL: databaseURL,
                                       generationSource: { [generation] in generation }, clock: { now })
        let replayed = try await reopened.handle(method: "contest_statistics", params: params)
        XCTAssertEqual(try canonicalJSON(replayed), try canonicalJSON(statistics))
    }

    private func qsoGet(_ lane: ContestLane, sessionID: UUID, qsoID: UUID, revision: Int) async throws -> [String: Any] {
        try await lane.handle(method: "contest_qso_get", params: [
            "sessionID": wireID(sessionID), "workspaceGeneration": generation,
            "expectedRevision": revision, "qsoID": wireID(qsoID),
        ])
    }

    func testCreateReserveCommitReplayAndReopenUseDurableContestStore() async throws {
        let (root, lane) = try fixture(); defer { try? FileManager.default.removeItem(at: root) }
        let (sessionID, draftID, created) = try await makeSession(lane)
        XCTAssertEqual(((created["session"] as? [String: Any])?["revision"] as? NSNumber)?.intValue, 1)
        let listed = try await lane.handle(method: "contest_sessions", params: [:])
        XCTAssertEqual((listed["sessions"] as? [[String: Any]])?.count, 1)
        let initialDraft = try await lane.handle(method: "contest_draft_get", params: [
            "sessionID": wireID(sessionID), "workspaceGeneration": generation,
        ])
        XCTAssertEqual((initialDraft["draft"] as? [String: Any])?["draftID"] as? String, wireID(draftID))

        let reserveID = UUID()
        let reserved = try await lane.handle(method: "contest_serial_reserve", params: mutation(
            sessionID: sessionID, requestID: reserveID, revision: 1,
            timestamp: "2026-10-17T01:01:00.000Z", payload: [:], draftID: draftID))
        XCTAssertEqual(((reserved["draft"] as? [String: Any])?["reservedSerial"] as? NSNumber)?.intValue, 1)

        let applyID = UUID()
        let fields: [String: Any] = [
            "callsign": "K1ABC", "sentReport": "599", "sentExchange": "001",
            "receivedReport": "599", "receivedExchange": "1", "frequencyHz": 14_025_000,
            "band": "20m", "mode": "CW",
        ]
        let applied = try await lane.handle(method: "contest_draft_apply", params: mutation(
            sessionID: sessionID, requestID: applyID, revision: 2,
            timestamp: "2026-10-17T01:02:00.000Z", payload: ["fields": fields], draftID: draftID))
        XCTAssertEqual(((applied["session"] as? [String: Any])?["revision"] as? NSNumber)?.intValue, 3)
        XCTAssertEqual(((applied["draft"] as? [String: Any])?["reservedSerial"] as? NSNumber)?.intValue, 1)

        let commitID = UUID()
        let commitParams = mutation(sessionID: sessionID, requestID: commitID, revision: 3,
            timestamp: "2026-10-17T01:03:00.000Z", payload: [:], draftID: draftID)
        let committed = try await lane.handle(method: "contest_qso_commit", params: commitParams)
        XCTAssertEqual(((committed["receipt"] as? [String: Any])?["committedRevision"] as? NSNumber)?.intValue, 4)
        XCTAssertEqual((committed["qso"] as? [String: Any])?["workedAt"] as? String, "2026-10-17T01:03:00.000Z")

        let partial = fields.merging(["callsign": "K1/"], uniquingKeysWith: { _, new in new })
        let partialResult = try await lane.handle(method: "contest_draft_apply", params: mutation(
            sessionID: sessionID, requestID: UUID(), revision: 4,
            timestamp: "2026-10-17T01:04:00.000Z", payload: ["fields": partial], draftID: draftID))
        XCTAssertEqual((((partialResult["draft"] as? [String: Any])?["fields"] as? [String: Any])?["callsign"] as? String), "K1/")
        XCTAssertFalse(((((partialResult["draft"] as? [String: Any])?["validation"] as? [String: Any])?["errors"] as? [String]) ?? []).isEmpty)

        let reopened = try ContestLane(databaseURL: root.appendingPathComponent("Contesting/contests.sqlite")) { [generation] in generation }
        let partialOpen = try await reopened.handle(method: "contest_open", params: [
            "sessionID": wireID(sessionID), "workspaceGeneration": generation,
        ])
        XCTAssertEqual((((partialOpen["draft"] as? [String: Any])?["fields"] as? [String: Any])?["callsign"] as? String), "K1/")
        let duplicate = try await reopened.handle(method: "contest_draft_apply", params: mutation(
            sessionID: sessionID, requestID: UUID(), revision: 5,
            timestamp: "2026-10-17T01:05:00.000Z", payload: ["fields": fields], draftID: draftID))
        XCTAssertEqual((((duplicate["draft"] as? [String: Any])?["dupe"] as? [String: Any])?["state"] as? String), "duplicate")

        let replay = try await reopened.handle(method: "contest_qso_commit", params: commitParams)
        XCTAssertEqual(try canonicalJSON(replay), try canonicalJSON(committed))
        XCTAssertEqual((replay["receipt"] as? [String: Any])?["requestID"] as? String, wireID(commitID))
        let receipt = try await reopened.handle(method: "contest_operation_receipt", params: [
            "sessionID": wireID(sessionID), "workspaceGeneration": generation,
            "requestID": wireID(commitID), "payloadDigest": String(repeating: "a", count: 64),
        ])
        XCTAssertEqual(receipt["status"] as? String, "committed")
        let opened = try await reopened.handle(method: "contest_open", params: [
            "sessionID": wireID(sessionID), "workspaceGeneration": generation,
        ])
        XCTAssertEqual((opened["session"] as? [String: Any])?["qsoCount"] as? Int, 1)
        let page = try await reopened.handle(method: "contest_log_page", params: [
            "sessionID": wireID(sessionID), "workspaceGeneration": generation,
            "expectedRevision": 6, "offset": 0, "limit": 50,
        ])
        XCTAssertEqual((page["qsos"] as? [[String: Any]])?.count, 1)
        let score = try await reopened.handle(method: "contest_score", params: [
            "sessionID": wireID(sessionID), "workspaceGeneration": generation, "expectedRevision": 6,
        ])
        XCTAssertEqual((score["qsos"] as? NSNumber)?.intValue, 1)
    }

    func testCurrentCatalogAndLegacyMutationRestartExportFlowUseEntryDescriptors() async throws {
        let catalogRoot = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-eight-pilot-catalog-\(UUID().uuidString)")
        defer {
            if FileManager.default.fileExists(atPath: catalogRoot.path) {
                try? FileManager.default.removeItem(at: catalogRoot)
            }
        }
        let catalogLane = try ContestLane(databaseURL: catalogRoot.appendingPathComponent("Contesting/contests.sqlite")) { [generation] in generation }
        let catalog = try await catalogLane.handle(method: "contest_catalog", params: [:])
        let rules = try XCTUnwrap(catalog["rules"] as? [[String: Any]])
        let legacyIDs: Set<String> = [
            "cq-ww-cw", "cq-wpx-cw", "cq-ww-ssb", "cq-wpx-ssb", "oceania-dx-cw", "oceania-dx-ssb", "sac-cw", "sac-ssb",
            "naqp-cw", "naqp-ssb", "naqp-rtty", "arrl-rtty-roundup", "jidx-cw", "jidx-ssb", "arrl-dx-cw", "arrl-dx-ssb",
        ]
        let catalogIDs = Set(rules.compactMap { ($0["identity"] as? [String: Any])?["id"] as? String })
        XCTAssertTrue(legacyIDs.isSubset(of: catalogIDs))
        XCTAssertEqual(rules.count, 26)
        XCTAssertEqual(rules.filter { $0["declarativeDefinition"] != nil }.count, 8)
        for rule in rules.filter({ legacyIDs.contains((($0["identity"] as? [String: Any])?["id"] as? String) ?? "") }) {
            let mode = try XCTUnwrap(rule["mode"] as? String)
            let entry = try XCTUnwrap(rule["entry"] as? [String: Any])
            XCTAssertEqual(entry["mode"] as? String, mode)
            let ruleID = try XCTUnwrap((rule["identity"] as? [String: Any])?["id"] as? String)
            XCTAssertEqual((entry["report"] as? [String: Any])?["defaultSent"] as? String,
                           ruleID.hasPrefix("naqp-") ? "" : mode == "SSB" ? "59" : "599")
            if ruleID.hasPrefix("naqp-") || ruleID == "arrl-rtty-roundup" ||
                ruleID.hasPrefix("jidx-") || ruleID.hasPrefix("arrl-dx-") {
                XCTAssertEqual((rule["entryDescriptorVersion"] as? NSNumber)?.intValue, 2)
                XCTAssertEqual((entry["version"] as? NSNumber)?.intValue, 2)
            } else {
                XCTAssertEqual((rule["entryDescriptorVersion"] as? NSNumber)?.intValue, 1)
                XCTAssertNil(entry["version"])
            }
            if ruleID == "arrl-rtty-roundup" || ruleID.hasPrefix("arrl-dx-") {
                XCTAssertNotNil(entry["stationFields"])
                if ruleID == "arrl-rtty-roundup" { XCTAssertNotNil(entry["stationResolvedSerial"]) }
                else { XCTAssertNil(entry["stationResolvedSerial"]) }
            } else {
                XCTAssertNil(entry["stationFields"]); XCTAssertNil(entry["stationResolvedSerial"])
            }
        }

        for ruleName in ["CQ WW SSB", "CQ WPX SSB", "Oceania DX CW", "Oceania DX SSB",
                         "Scandinavian Activity Contest CW", "Scandinavian Activity Contest SSB"] {
            let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-ssb-lifecycle-\(UUID().uuidString)")
            defer { try? FileManager.default.removeItem(at: root) }
            let lane = try ContestLane(databaseURL: root.appendingPathComponent("Contesting/contests.sqlite")) { [generation] in generation }
            let (sessionID, draftID, created) = try await makeSession(lane, ruleName: ruleName)
            let createdSession = try XCTUnwrap(created["session"] as? [String: Any])
            let createdDraft = try XCTUnwrap(created["draft"] as? [String: Any])
            XCTAssertNil(createdSession["resolvedSerial"])
            XCTAssertNil((createdSession["station"] as? [String: Any])?["stationFields"])
            XCTAssertNil(createdDraft["resolvedSerial"])
            let sessionRule = try XCTUnwrap(((created["session"] as? [String: Any])?["rule"] as? [String: Any]))
            let entry = try XCTUnwrap(sessionRule["entry"] as? [String: Any])
            let mode = ruleName.hasSuffix("CW") ? "CW" : "SSB"
            let report = mode == "CW" ? "599" : "59"
            let serialContest = ruleName != "CQ WW SSB"
            XCTAssertEqual(sessionRule["mode"] as? String, mode)
            XCTAssertEqual(entry["cabrilloProjectionFormatterVersion"] as? String, mode == "CW" ? "pilot-2" : "ssb-pilot-2")
            var revision = 1
            if serialContest {
                let reserved = try await lane.handle(method: "contest_serial_reserve", params: mutation(
                    sessionID: sessionID, requestID: UUID(), revision: revision,
                    timestamp: "2026-10-17T06:01:00.000Z", payload: [:], draftID: draftID))
                XCTAssertEqual(((reserved["draft"] as? [String: Any])?["reservedSerial"] as? NSNumber)?.intValue, 1)
                revision += 1
            } else {
                do {
                    _ = try await lane.handle(method: "contest_serial_reserve", params: mutation(
                        sessionID: sessionID, requestID: UUID(), revision: revision,
                        timestamp: "2026-10-17T06:01:00.000Z", payload: [:], draftID: draftID))
                    XCTFail("Expected WW SSB to reject serial reservation")
                } catch let error as ContestLaneError { XCTAssertEqual(error.code, "serial_not_supported") }
            }
            let sent = serialContest ? "001" : "15"
            let received = serialContest ? "101" : "5"
            let fields: [String: Any] = ["callsign": "K1ABC", "sentReport": report, "sentExchange": sent,
                "receivedReport": report, "receivedExchange": received, "frequencyHz": mode == "CW" ? 14_025_000 : 14_250_000,
                "band": "20m", "mode": mode]
            _ = try await lane.handle(method: "contest_draft_apply", params: mutation(
                sessionID: sessionID, requestID: UUID(), revision: revision,
                timestamp: "2026-10-17T06:02:00.000Z", payload: ["fields": fields], draftID: draftID))
            revision += 1
            let committed = try await lane.handle(method: "contest_qso_commit", params: mutation(
                sessionID: sessionID, requestID: UUID(), revision: revision,
                timestamp: "2026-10-17T06:03:00.000Z", payload: [:], draftID: draftID))
            revision += 1
            XCTAssertEqual((committed["qso"] as? [String: Any])?["mode"] as? String, mode)

            for format in ["cabrillo", "adif"] {
                let exportID = UUID()
                let prepared = try await lane.handle(method: "contest_export_prepare", params: [
                    "exportID": wireID(exportID), "sessionID": wireID(sessionID), "workspaceGeneration": generation,
                    "expectedRevision": revision, "generatedAtUTC": "2026-10-17T06:04:00.000Z", "format": format,
                    "header": ["callsign": "OM0RX", "categoryOperator": "SINGLE-OP", "categoryAssisted": "NON-ASSISTED",
                               "categoryBand": "ALL", "categoryMode": mode, "categoryTransmitter": "ONE", "categoryPower": "LOW",
                               "operators": ["OM0RX"], "location": "DX", "name": "Oliver Operator", "addressLines": [], "email": ""],
                ])
                let policy = mode == "CW" ? (format == "cabrillo" ? "pilot-2" : "pilot-1") : (format == "cabrillo" ? "ssb-pilot-2" : "ssb-pilot-1")
                XCTAssertEqual(prepared["formatterVersion"] as? String, policy)
                let byteLength = try XCTUnwrap((prepared["byteLength"] as? NSNumber)?.intValue)
                let chunk = try await lane.handle(method: "contest_export_read", params: [
                    "exportID": wireID(exportID), "sessionID": wireID(sessionID), "workspaceGeneration": generation,
                    "offset": 0, "length": byteLength,
                ])
                let data = try XCTUnwrap(Data(base64Encoded: try XCTUnwrap(chunk["dataBase64"] as? String)))
                let document = try XCTUnwrap(String(data: data, encoding: .utf8))
                XCTAssertTrue(format == "cabrillo" ? document.contains(mode == "CW" ? " CW " : " PH ") : document.contains("<MODE:\(mode.utf8.count)>\(mode)"))
                XCTAssertEqual(document.contains("<STX:"), format == "adif" && ruleName == "CQ WPX SSB")
                if format == "adif" && (ruleName.hasPrefix("Oceania") || ruleName.hasPrefix("Scandinavian")) {
                    XCTAssertTrue(document.contains("<STX_STRING:")); XCTAssertTrue(document.contains("<SRX_STRING:"))
                    XCTAssertFalse(document.contains("<STX:")); XCTAssertFalse(document.contains("<SRX:"))
                }
                _ = try await lane.handle(method: "contest_export_release", params: [
                    "exportID": wireID(exportID), "sessionID": wireID(sessionID), "workspaceGeneration": generation,
                ])
            }

            let qsoID = try XCTUnwrap((committed["qso"] as? [String: Any])?["qsoID"] as? String)
            let got = try await qsoGet(lane, sessionID: sessionID, qsoID: UUID(uuidString: qsoID)!, revision: revision)
            var qso = try XCTUnwrap(got["qso"] as? [String: Any]); qso.removeValue(forKey: "entity")
            qso["callsign"] = "DL1AAA"; qso["receivedExchange"] = serialContest ? "102" : "14"
            qso["normalizedReceivedExchange"] = qso["receivedExchange"]
            let correction = mutation(sessionID: sessionID, requestID: UUID(), revision: revision,
                timestamp: "2026-10-17T06:05:00.000Z", payload: ["qso": qso, "reason": "Correct copied call"])
            let corrected = try await lane.handle(method: "contest_qso_correct", params: correction); revision += 1
            let deletion = mutation(sessionID: sessionID, requestID: UUID(), revision: revision,
                timestamp: "2026-10-17T06:06:00.000Z", payload: ["qsoID": qsoID, "reason": "Remove invalid contact"])
            let deleted = try await lane.handle(method: "contest_qso_delete", params: deletion); revision += 1
            let reopened = try ContestLane(databaseURL: root.appendingPathComponent("Contesting/contests.sqlite")) { [generation] in generation }
            let replayedCorrection = try await reopened.handle(method: "contest_qso_correct", params: correction)
            let replayedDeletion = try await reopened.handle(method: "contest_qso_delete", params: deletion)
            XCTAssertEqual(try canonicalJSON(replayedCorrection), try canonicalJSON(corrected))
            XCTAssertEqual(try canonicalJSON(replayedDeletion), try canonicalJSON(deleted))
            let open = try await reopened.handle(method: "contest_open", params: ["sessionID": wireID(sessionID), "workspaceGeneration": generation])
            XCTAssertEqual(((open["session"] as? [String: Any])?["revision"] as? NSNumber)?.intValue, revision)
        }
    }

    func testInactiveARRLWireUsesFrozenSectionAndStationResolvedSerialAuthority() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-arrl-rtty-lane-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let registry = ContestRuleRegistry([ARRLRTTYRoundupRule()])
        let lane = try ContestLane(databaseURL: root.appendingPathComponent("Contesting/contests.sqlite"),
                                   generationSource: { [generation] in generation }, rules: registry)
        let catalog = try await lane.handle(method: "contest_catalog", params: [:])
        let rule = try XCTUnwrap((catalog["rules"] as? [[String: Any]])?.first)
        let entry = try XCTUnwrap(rule["entry"] as? [String: Any])
        XCTAssertEqual((entry["stationFields"] as? [[String: Any]])?.first?["id"] as? String, "section")
        XCTAssertEqual((entry["stationResolvedSerial"] as? [String: Any])?["policy"] as? String,
                       "arrlRTTYRoundupWVEOrDX")

        func create(_ sessionID: UUID, _ requestID: UUID, call: String, zone: String,
                    entity: String, exchange: [String: String], section: String) async throws -> [String: Any] {
            try await lane.handle(method: "contest_create", params: mutation(
                sessionID: sessionID, requestID: requestID, revision: 0,
                timestamp: "2026-10-18T15:00:00.000Z", payload: [
                    "sessionID": wireID(sessionID), "name": "ARRL RTTY inactive wire",
                    "ruleIdentity": try XCTUnwrap(rule["identity"] as? [String: Any]),
                    "referenceDataVersion": try XCTUnwrap(rule["referenceDataVersion"] as? String),
                    "station": ["callsign": call, "cqZone": zone, "dxccEntity": entity,
                                "exchangeFields": exchange, "stationFields": ["section": section]],
                    "operator": ["callsign": call, "category": "Single Operator"],
                ]))
        }

        let usSession = UUID(), usDraft = UUID()
        let usCreated = try await create(usSession, usDraft, call: "K1AAA", zone: "5",
                                         entity: "UNITED STATES",
                                         exchange: ["location": "CA", "serial": ""], section: "EB")
        let usSessionWire = try XCTUnwrap(usCreated["session"] as? [String: Any])
        XCTAssertEqual((usSessionWire["station"] as? [String: Any])?["stationFields"] as? [String: String],
                       ["section": "EB"])
        let usSessionPolicy = try XCTUnwrap(usSessionWire["resolvedSerial"] as? [String: Any])
        let usDraftPolicy = try XCTUnwrap((usCreated["draft"] as? [String: Any])?["resolvedSerial"] as? [String: Any])
        XCTAssertEqual(usSessionPolicy["requirement"] as? String, "none")
        XCTAssertEqual(try canonicalJSON(usSessionPolicy), try canonicalJSON(usDraftPolicy))
        do {
            _ = try await lane.handle(method: "contest_serial_reserve", params: mutation(
                sessionID: usSession, requestID: UUID(), revision: 1,
                timestamp: "2026-10-18T15:01:00.000Z", payload: [:], draftID: usDraft))
            XCTFail("Expected W/VE serial reservation to reject before mutation")
        } catch let error as ContestLaneError { XCTAssertEqual(error.code, "serial_not_supported") }
        let usOpen = try await lane.handle(method: "contest_open", params: [
            "sessionID": wireID(usSession), "workspaceGeneration": generation])
        XCTAssertEqual(((usOpen["session"] as? [String: Any])?["revision"] as? NSNumber)?.intValue, 1)

        let invalidSession = UUID(), invalidDraft = UUID()
        do {
            _ = try await create(invalidSession, invalidDraft, call: "K1BBB", zone: "5",
                                 entity: "UNITED STATES",
                                 exchange: ["location": "CA", "serial": ""], section: "CA")
            XCTFail("Expected invalid section to fail before durable creation")
        } catch let error as ContestLaneError { XCTAssertEqual(error.code, "invalid_session") }
        let afterInvalid = try await lane.handle(method: "contest_sessions", params: [:])
        XCTAssertEqual((afterInvalid["sessions"] as? [[String: Any]])?.count, 1)

        let dxSession = UUID(), dxDraft = UUID(), reserveID = UUID()
        let dxCreated = try await create(dxSession, dxDraft, call: "DL1AAA", zone: "14",
                                         entity: "FED. REP. OF GERMANY",
                                         exchange: ["location": "", "serial": ""], section: "DX")
        XCTAssertEqual((((dxCreated["session"] as? [String: Any])?["resolvedSerial"] as? [String: Any])?["allocatedFieldID"] as? String),
                       "serial")
        let reserveParams = mutation(sessionID: dxSession, requestID: reserveID, revision: 1,
                                     timestamp: "2026-10-18T15:02:00.000Z", payload: [:], draftID: dxDraft)
        let reserved = try await lane.handle(method: "contest_serial_reserve", params: reserveParams)
        XCTAssertEqual((((reserved["draft"] as? [String: Any])?["fields"] as? [String: Any])?["sentExchangeFields"] as? [String: String])?["serial"],
                       "001")
        let replayed = try await lane.handle(method: "contest_serial_reserve", params: reserveParams)
        XCTAssertEqual(try canonicalJSON(reserved), try canonicalJSON(replayed))

        let reopened = try ContestLane(databaseURL: root.appendingPathComponent("Contesting/contests.sqlite"),
                                       generationSource: { [generation] in generation }, rules: registry)
        let dxOpen = try await reopened.handle(method: "contest_open", params: [
            "sessionID": wireID(dxSession), "workspaceGeneration": generation])
        XCTAssertEqual((((dxOpen["draft"] as? [String: Any])?["fields"] as? [String: Any])?["sentExchangeFields"] as? [String: String])?["serial"],
                       "001")
    }

    func testOceaniaWorkerScoringMatchesIndependentFiftyOneAndOneHundredOracles() async throws {
        let cwRoot = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-oceania-cw-oracle-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: cwRoot) }
        let cwLane = try ContestLane(databaseURL: cwRoot.appendingPathComponent("Contesting/contests.sqlite")) { [generation] in generation }
        let (cwSession, cwDraft, _) = try await makeSession(cwLane, ruleName: "Oceania DX CW")
        var cwRevision = 1
        let cwContacts: [(String, String, Int, String)] = [
            ("VK1AAA", "20m", 14_250_000, "101"), ("VK1BBB", "20m", 14_251_000, "102"),
            ("VK1AAA", "40m", 7_100_000, "103"), ("ZL2ABC", "80m", 3_700_000, "104"),
            ("K1ABC", "10m", 28_500_000, "105"), ("ZL2ABC", "80m", 3_701_000, "106"),
        ]
        for (index, contact) in cwContacts.enumerated() {
            cwRevision = try await commitSerialContact(cwLane, sessionID: cwSession, draftID: cwDraft, revision: cwRevision,
                call: contact.0, band: contact.1, frequencyHz: contact.2, mode: "CW", report: "599", received: contact.3, minute: index)
        }
        let cwScore = try await cwLane.handle(method: "contest_score", params: [
            "sessionID": wireID(cwSession), "workspaceGeneration": generation, "expectedRevision": cwRevision])
        XCTAssertEqual((cwScore["points"] as? NSNumber)?.intValue, 17)
        XCTAssertEqual((cwScore["multipliers"] as? NSNumber)?.intValue, 3)
        XCTAssertEqual((cwScore["claimedScore"] as? NSNumber)?.intValue, 51)

        let ssbRoot = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-oceania-ssb-oracle-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: ssbRoot) }
        let ssbLane = try ContestLane(databaseURL: ssbRoot.appendingPathComponent("Contesting/contests.sqlite")) { [generation] in generation }
        let (ssbSession, ssbDraft, _) = try await makeSession(ssbLane, ruleName: "Oceania DX SSB",
            stationCallsign: "VK1ZZZ", cqZone: "30", dxccEntity: "AUSTRALIA")
        var ssbRevision = 1
        let ssbContacts: [(String, String, Int, String)] = [
            ("K1ABC", "160m", 1_850_000, "201"), ("K1XYZ", "160m", 1_851_000, "202"),
            ("DL1AAA", "80m", 3_700_000, "203"), ("DL1AAA", "80m", 3_701_000, "204"),
        ]
        for (index, contact) in ssbContacts.enumerated() {
            ssbRevision = try await commitSerialContact(ssbLane, sessionID: ssbSession, draftID: ssbDraft, revision: ssbRevision,
                call: contact.0, band: contact.1, frequencyHz: contact.2, mode: "SSB", report: "59", received: contact.3, minute: index)
        }
        let ssbScore = try await ssbLane.handle(method: "contest_score", params: [
            "sessionID": wireID(ssbSession), "workspaceGeneration": generation, "expectedRevision": ssbRevision])
        XCTAssertEqual((ssbScore["points"] as? NSNumber)?.intValue, 50)
        XCTAssertEqual((ssbScore["multipliers"] as? NSNumber)?.intValue, 2)
        XCTAssertEqual((ssbScore["claimedScore"] as? NSNumber)?.intValue, 100)
    }

    func testSACWorkerScoringMatchesIndependentFortyFourAndTwelveOracles() async throws {
        let cwRoot = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-sac-cw-oracle-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: cwRoot) }
        let cwLane = try ContestLane(databaseURL: cwRoot.appendingPathComponent("Contesting/contests.sqlite")) { [generation] in generation }
        let (cwSession, cwDraft, _) = try await makeSession(cwLane, ruleName: "Scandinavian Activity Contest CW",
            stationCallsign: "SM0AAA", cqZone: "14", dxccEntity: "SWEDEN")
        var cwRevision = 1
        let cwContacts: [(String, String, Int, String)] = [
            ("DL1AAA", "20m", 14_030_000, "101"), ("K1ABC", "20m", 14_031_000, "102"),
            ("K1XYZ", "20m", 14_032_000, "103"), ("K1ABC", "40m", 7_030_000, "104"),
            ("OH1AAA", "20m", 14_033_000, "105"), ("K1ABC", "20m", 14_034_000, "106"),
        ]
        for (index, contact) in cwContacts.enumerated() {
            cwRevision = try await commitSerialContact(cwLane, sessionID: cwSession, draftID: cwDraft, revision: cwRevision,
                call: contact.0, band: contact.1, frequencyHz: contact.2, mode: "CW", report: "599", received: contact.3, minute: index)
        }
        let cwScore = try await cwLane.handle(method: "contest_score", params: [
            "sessionID": wireID(cwSession), "workspaceGeneration": generation, "expectedRevision": cwRevision])
        XCTAssertEqual((cwScore["points"] as? NSNumber)?.intValue, 11)
        XCTAssertEqual((cwScore["multipliers"] as? NSNumber)?.intValue, 4)
        XCTAssertEqual((cwScore["claimedScore"] as? NSNumber)?.intValue, 44)

        let ssbRoot = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-sac-ssb-oracle-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: ssbRoot) }
        let ssbLane = try ContestLane(databaseURL: ssbRoot.appendingPathComponent("Contesting/contests.sqlite")) { [generation] in generation }
        let (ssbSession, ssbDraft, _) = try await makeSession(ssbLane, ruleName: "Scandinavian Activity Contest SSB")
        var ssbRevision = 1
        let ssbContacts: [(String, String, Int, String)] = [
            ("SM1AAA", "20m", 14_250_000, "201"), ("SM2AAA", "20m", 14_251_000, "202"),
            ("SM1BBB", "20m", 14_252_000, "203"), ("OH1AAA", "40m", 7_150_000, "204"),
            ("K1ABC", "20m", 14_253_000, "205"),
        ]
        for (index, contact) in ssbContacts.enumerated() {
            ssbRevision = try await commitSerialContact(ssbLane, sessionID: ssbSession, draftID: ssbDraft, revision: ssbRevision,
                call: contact.0, band: contact.1, frequencyHz: contact.2, mode: "SSB", report: "59", received: contact.3, minute: index)
        }
        let ssbScore = try await ssbLane.handle(method: "contest_score", params: [
            "sessionID": wireID(ssbSession), "workspaceGeneration": generation, "expectedRevision": ssbRevision])
        XCTAssertEqual((ssbScore["points"] as? NSNumber)?.intValue, 4)
        XCTAssertEqual((ssbScore["multipliers"] as? NSNumber)?.intValue, 3)
        XCTAssertEqual((ssbScore["claimedScore"] as? NSNumber)?.intValue, 12)
    }

    func testQSOGetCorrectionDeletionReplayAndStrictFailures() async throws {
        let (root, lane) = try fixture(); defer { try? FileManager.default.removeItem(at: root) }
        let (sessionID, draftID, _) = try await makeSession(lane)
        let (qsoID, revision, _) = try await commitContact(lane, sessionID: sessionID, draftID: draftID,
                                                           revision: 1, callsign: "K1ABC", minute: 10,
                                                           operatorStyle: "run")
        let read = try await qsoGet(lane, sessionID: sessionID, qsoID: qsoID, revision: revision)
        var full = try XCTUnwrap(read["qso"] as? [String: Any])
        XCTAssertEqual(full["qsoID"] as? String, wireID(qsoID))
        XCTAssertEqual(full["sessionID"] as? String, wireID(sessionID))
        XCTAssertEqual(full["originalUTC"] as? String, "2026-10-17T03:10:20.000Z")
        XCTAssertEqual(full["allocatedSerial"] as? String, "001")
        XCTAssertNotNil(full["provenance"] as? [String: Any])
        XCTAssertNotNil(full["entity"] as? [String: Any])
        XCTAssertNotNil(full["ruleIdentity"] as? [String: Any])
        do { _ = try await qsoGet(lane, sessionID: sessionID, qsoID: qsoID, revision: revision - 1); XCTFail("Expected stale read") }
        catch let error as ContestLaneError { XCTAssertEqual(error.code, "stale_revision") }
        do {
            _ = try await lane.handle(method: "contest_qso_get", params: [
                "sessionID": wireID(sessionID), "workspaceGeneration": "f1111111-2222-4333-9444-555555555555",
                "expectedRevision": revision, "qsoID": wireID(qsoID),
            ])
            XCTFail("Expected generation-fenced read")
        } catch let error as ContestLaneError { XCTAssertEqual(error.code, "stale_workspace") }
        full.removeValue(forKey: "entity")
        full["callsign"] = "DL1AAA"
        full["receivedReport"] = "579"
        full["receivedExchange"] = "2"
        full["normalizedReceivedExchange"] = "2"
        let correctionID = UUID()
        let correctionParams = mutation(sessionID: sessionID, requestID: correctionID, revision: revision,
            timestamp: "2026-10-17T03:20:00.000Z", payload: ["qso": full, "reason": "Correct copied call"],
            digest: String(repeating: "c", count: 64))
        let corrected = try await lane.handle(method: "contest_qso_correct", params: correctionParams)
        XCTAssertEqual(corrected["operation"] as? String, "correction")
        XCTAssertEqual((corrected["qsoCount"] as? NSNumber)?.intValue, 1)
        XCTAssertEqual((corrected["currentTarget"] as? [String: Any])?["callsign"] as? String, "DL1AAA")
        XCTAssertEqual(((corrected["currentTarget"] as? [String: Any])?["entity"] as? [String: Any])?["countryPrefix"] as? String, "DL")
        XCTAssertEqual(((corrected["score"] as? [String: Any])?["claimedScore"] as? NSNumber)?.intValue, 1)
        XCTAssertEqual(((corrected["session"] as? [String: Any])?["revision"] as? NSNumber)?.intValue, revision + 1)

        var changedTimestamp = correctionParams
        changedTimestamp["operationTimestamp"] = "2026-10-17T03:20:01.000Z"
        do { _ = try await lane.handle(method: "contest_qso_correct", params: changedTimestamp); XCTFail("Expected canonical timestamp conflict") }
        catch let error as ContestLaneError { XCTAssertEqual(error.code, "request_conflict") }
        var crossOperation = correctionParams
        crossOperation["payload"] = ["qsoID": wireID(qsoID), "reason": "Wrong operation for request ID"]
        do { _ = try await lane.handle(method: "contest_qso_delete", params: crossOperation); XCTFail("Expected cross-operation request conflict") }
        catch let error as ContestLaneError { XCTAssertEqual(error.code, "request_conflict") }
        var immutable = correctionParams
        immutable["requestID"] = wireID(UUID()); immutable["expectedRevision"] = revision + 1
        var immutablePayload = try XCTUnwrap(immutable["payload"] as? [String: Any])
        var immutableQSO = try XCTUnwrap(immutablePayload["qso"] as? [String: Any])
        immutableQSO["originalUTC"] = "2026-10-17T03:10:21.000Z"
        immutablePayload["qso"] = immutableQSO; immutable["payload"] = immutablePayload
        do { _ = try await lane.handle(method: "contest_qso_correct", params: immutable); XCTFail("Expected immutable identity rejection") }
        catch let error as ContestLaneError { XCTAssertEqual(error.code, "immutable_qso") }
        var callerEntity = correctionParams
        callerEntity["requestID"] = wireID(UUID()); callerEntity["expectedRevision"] = revision + 1
        var callerEntityPayload = try XCTUnwrap(callerEntity["payload"] as? [String: Any])
        var callerEntityQSO = try XCTUnwrap(callerEntityPayload["qso"] as? [String: Any])
        callerEntityQSO["entity"] = ["adif": 291, "name": "UNITED STATES", "countryPrefix": "K", "continent": "NA", "cqZone": 5]
        callerEntityPayload["qso"] = callerEntityQSO; callerEntity["payload"] = callerEntityPayload
        do { _ = try await lane.handle(method: "contest_qso_correct", params: callerEntity); XCTFail("Expected caller entity rejection") }
        catch let error as ContestLaneError { XCTAssertEqual(error.code, "invalid_params") }
        var unresolved = correctionParams
        unresolved["requestID"] = wireID(UUID()); unresolved["expectedRevision"] = revision + 1
        var unresolvedPayload = try XCTUnwrap(unresolved["payload"] as? [String: Any])
        var unresolvedQSO = try XCTUnwrap(unresolvedPayload["qso"] as? [String: Any])
        unresolvedQSO["callsign"] = "Q0ABC"; unresolvedPayload["qso"] = unresolvedQSO; unresolved["payload"] = unresolvedPayload
        do { _ = try await lane.handle(method: "contest_qso_correct", params: unresolved); XCTFail("Expected unresolved callsign rejection") }
        catch let error as ContestLaneError { XCTAssertEqual(error.code, "reference_mismatch") }
        var malformed = correctionParams
        malformed["requestID"] = wireID(UUID())
        malformed["expectedRevision"] = revision + 1
        var malformedPayload = try XCTUnwrap(malformed["payload"] as? [String: Any])
        var malformedQSO = try XCTUnwrap(malformedPayload["qso"] as? [String: Any])
        malformedQSO.removeValue(forKey: "provenance"); malformedPayload["qso"] = malformedQSO; malformed["payload"] = malformedPayload
        do { _ = try await lane.handle(method: "contest_qso_correct", params: malformed); XCTFail("Expected strict malformed rejection") }
        catch let error as ContestLaneError { XCTAssertEqual(error.code, "invalid_params") }
        var stale = correctionParams
        stale["requestID"] = wireID(UUID()); stale["expectedRevision"] = revision
        do { _ = try await lane.handle(method: "contest_qso_correct", params: stale); XCTFail("Expected stale correction") }
        catch let error as ContestLaneError { XCTAssertEqual(error.code, "stale_revision") }
        var wrongSession = correctionParams
        wrongSession["requestID"] = wireID(UUID()); wrongSession["expectedRevision"] = revision + 1
        var wrongPayload = try XCTUnwrap(wrongSession["payload"] as? [String: Any])
        var wrongQSO = try XCTUnwrap(wrongPayload["qso"] as? [String: Any])
        wrongQSO["sessionID"] = wireID(UUID()); wrongPayload["qso"] = wrongQSO; wrongSession["payload"] = wrongPayload
        do { _ = try await lane.handle(method: "contest_qso_correct", params: wrongSession); XCTFail("Expected cross-session rejection") }
        catch let error as ContestLaneError { XCTAssertEqual(error.code, "wrong_session") }
        var wrongGeneration = correctionParams
        wrongGeneration["requestID"] = wireID(UUID())
        wrongGeneration["workspaceGeneration"] = "f1111111-2222-4333-9444-555555555555"
        do { _ = try await lane.handle(method: "contest_qso_correct", params: wrongGeneration); XCTFail("Expected generation rejection") }
        catch let error as ContestLaneError { XCTAssertEqual(error.code, "stale_workspace") }

        let deleteID = UUID()
        let deleteParams = mutation(sessionID: sessionID, requestID: deleteID, revision: revision + 1,
            timestamp: "2026-10-17T03:21:00.000Z",
            payload: ["qsoID": wireID(qsoID), "reason": "Remove invalid contact"],
            digest: String(repeating: "d", count: 64))
        let deleted = try await lane.handle(method: "contest_qso_delete", params: deleteParams)
        XCTAssertEqual(deleted["operation"] as? String, "deletion")
        XCTAssertTrue(deleted["currentTarget"] is NSNull)
        XCTAssertEqual((deleted["qsoCount"] as? NSNumber)?.intValue, 0)
        let reopened = try ContestLane(databaseURL: root.appendingPathComponent("Contesting/contests.sqlite")) { [generation] in generation }
        let replayed = try await reopened.handle(method: "contest_qso_correct", params: correctionParams)
        XCTAssertEqual(try canonicalJSON(replayed), try canonicalJSON(corrected))
        let deleteReplay = try await reopened.handle(method: "contest_qso_delete", params: deleteParams)
        XCTAssertEqual(try canonicalJSON(deleteReplay), try canonicalJSON(deleted))
        do { _ = try await qsoGet(reopened, sessionID: sessionID, qsoID: qsoID, revision: revision + 2); XCTFail("Expected tombstone error") }
        catch let error as ContestLaneError { XCTAssertEqual(error.code, "qso_deleted") }
        let receipt = try await reopened.handle(method: "contest_operation_receipt", params: [
            "sessionID": wireID(sessionID), "workspaceGeneration": generation,
            "requestID": wireID(correctionID), "payloadDigest": String(repeating: "c", count: 64),
        ])
        XCTAssertEqual(receipt["status"] as? String, "committed")
    }

    func testQSOChangesRescoreDuplicateCreditAndRecoverPostCommitUncertainty() async throws {
        enum FenceFailure: Error { case unavailable }
        actor Fence {
            let generation: String; var calls = 0
            init(_ generation: String) { self.generation = generation }
            func next() throws -> String { calls += 1; if calls == 1 { return generation }; throw FenceFailure.unavailable }
        }
        let (root, stable) = try fixture(); defer { try? FileManager.default.removeItem(at: root) }
        let (sessionID, draftID, _) = try await makeSession(stable)
        let (firstID, firstRevision, _) = try await commitContact(stable, sessionID: sessionID, draftID: draftID,
                                                                  revision: 1, callsign: "K1ABC", minute: 30)
        let (secondID, secondRevision, _) = try await commitContact(stable, sessionID: sessionID, draftID: draftID,
                                                                    revision: firstRevision, callsign: "K1ABC", minute: 31)
        let firstRead = try await qsoGet(stable, sessionID: sessionID, qsoID: firstID, revision: secondRevision)
        var first = try XCTUnwrap(firstRead["qso"] as? [String: Any])
        first.removeValue(forKey: "entity")
        first["callsign"] = "K2ABC"
        let correctionID = UUID()
        let params = mutation(sessionID: sessionID, requestID: correctionID, revision: secondRevision,
            timestamp: "2026-10-17T03:32:00.000Z", payload: ["qso": first, "reason": "Promote duplicate"],
            digest: String(repeating: "e", count: 64))
        let fence = Fence(generation)
        let uncertain = try ContestLane(databaseURL: root.appendingPathComponent("Contesting/contests.sqlite")) { try await fence.next() }
        do { _ = try await uncertain.handle(method: "contest_qso_correct", params: params); XCTFail("Expected post-commit uncertainty") }
        catch let error as ContestLaneError { XCTAssertEqual(error.outcome, "uncertain") }
        let receipt = try await stable.handle(method: "contest_operation_receipt", params: [
            "sessionID": wireID(sessionID), "workspaceGeneration": generation,
            "requestID": wireID(correctionID), "payloadDigest": String(repeating: "e", count: 64),
        ])
        XCTAssertEqual(receipt["status"] as? String, "committed")
        let corrected = try await stable.handle(method: "contest_qso_correct", params: params)
        let score = try XCTUnwrap(corrected["score"] as? [String: Any])
        XCTAssertEqual((score["qsos"] as? NSNumber)?.intValue, 2)
        XCTAssertEqual((score["points"] as? NSNumber)?.intValue, 6)
        let deleteParams = mutation(sessionID: sessionID, requestID: UUID(), revision: secondRevision + 1,
            timestamp: "2026-10-17T03:33:00.000Z",
            payload: ["qsoID": wireID(firstID), "reason": "Remove corrected first contact"])
        let deleted = try await stable.handle(method: "contest_qso_delete", params: deleteParams)
        let deleteScore = try XCTUnwrap(deleted["score"] as? [String: Any])
        XCTAssertEqual((deleteScore["qsos"] as? NSNumber)?.intValue, 1)
        XCTAssertEqual((deleteScore["points"] as? NSNumber)?.intValue, 3)
        let survivor = try await qsoGet(stable, sessionID: sessionID, qsoID: secondID, revision: secondRevision + 2)
        XCTAssertEqual((survivor["qso"] as? [String: Any])?["callsign"] as? String, "K1ABC")
    }

    func testSameRequestChangedTimestampConflictsAndInvalidDateIsConfirmed() async throws {
        let (root, lane) = try fixture(); defer { try? FileManager.default.removeItem(at: root) }
        let (sessionID, draftID, _) = try await makeSession(lane)
        let requestID = UUID()
        let fields: [String: Any] = ["callsign": "K1ABC", "sentReport": "599", "sentExchange": "001",
            "receivedReport": "599", "receivedExchange": "1", "frequencyHz": 14_025_000, "band": "20m", "mode": "CW"]
        let original = mutation(sessionID: sessionID, requestID: requestID, revision: 1,
            timestamp: "2026-10-17T01:01:00.000Z", payload: ["fields": fields], draftID: draftID)
        _ = try await lane.handle(method: "contest_draft_apply", params: original)
        var changedPayload = original
        var payload = try XCTUnwrap(changedPayload["payload"] as? [String: Any])
        var changedFields = try XCTUnwrap(payload["fields"] as? [String: Any]); changedFields["receivedExchange"] = "2"
        payload["fields"] = changedFields; changedPayload["payload"] = payload
        do { _ = try await lane.handle(method: "contest_draft_apply", params: changedPayload); XCTFail("Expected canonical payload conflict") }
        catch let error as ContestLaneError { XCTAssertEqual(error.code, "request_conflict"); XCTAssertEqual(error.outcome, "confirmed") }
        var changed = original; changed["operationTimestamp"] = "2026-10-17T01:01:01.000Z"
        do { _ = try await lane.handle(method: "contest_draft_apply", params: changed); XCTFail("Expected conflict") }
        catch let error as ContestLaneError { XCTAssertEqual(error.code, "request_conflict"); XCTAssertEqual(error.outcome, "confirmed") }
        var invalid = original; invalid["requestID"] = wireID(UUID()); invalid["operationTimestamp"] = "today"
        do { _ = try await lane.handle(method: "contest_draft_apply", params: invalid); XCTFail("Expected invalid timestamp") }
        catch let error as ContestLaneError { XCTAssertEqual(error.code, "invalid_params"); XCTAssertEqual(error.outcome, "confirmed") }
        var uppercase = original; uppercase["sessionID"] = wireID(sessionID).uppercased()
        do { _ = try await lane.handle(method: "contest_draft_apply", params: uppercase); XCTFail("Expected canonical UUID rejection") }
        catch let error as ContestLaneError { XCTAssertEqual(error.code, "invalid_params"); XCTAssertEqual(error.outcome, "confirmed") }
    }

    func testCQWWRejectsSerialReservationBeforeAllocation() async throws {
        let (root, lane) = try fixture(); defer { try? FileManager.default.removeItem(at: root) }
        let (sessionID, draftID, _) = try await makeSession(lane, ruleName: "CQ WW CW")
        do {
            _ = try await lane.handle(method: "contest_serial_reserve", params: mutation(
                sessionID: sessionID, requestID: UUID(), revision: 1,
                timestamp: "2026-10-17T01:01:00.000Z", payload: [:], draftID: draftID))
            XCTFail("Expected CQ WW reservation rejection")
        } catch let error as ContestLaneError {
            XCTAssertEqual(error.code, "serial_not_supported")
            XCTAssertEqual(error.outcome, "confirmed")
        }
        let opened = try await lane.handle(method: "contest_open", params: [
            "sessionID": wireID(sessionID), "workspaceGeneration": generation,
        ])
        XCTAssertEqual(((opened["session"] as? [String: Any])?["revision"] as? NSNumber)?.intValue, 1)
        XCTAssertTrue((opened["draft"] as? [String: Any])?["reservedSerial"] is NSNull)
    }

    func testGenerationFenceChecksBeforeAndAfterOperation() async throws {
        actor Sequence {
            var values = ["11111111-2222-4333-8444-555555555555", "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"]
            func next() -> String { values.count > 1 ? values.removeFirst() : values[0] }
        }
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-contest-fence-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let sequence = Sequence()
        let lane = try ContestLane(databaseURL: root.appendingPathComponent("Contesting/contests.sqlite")) { await sequence.next() }
        do { _ = try await lane.handle(method: "contest_catalog", params: [:]); XCTFail("Expected post-operation fence") }
        catch let error as ContestLaneError { XCTAssertEqual(error.code, "stale_workspace"); XCTAssertEqual(error.outcome, "uncertain") }
    }

    func testFullHighBitWorkspaceUUIDDistinguishesSameFirstSixtyFourBits() async throws {
        let (root, lane) = try fixture(); defer { try? FileManager.default.removeItem(at: root) }
        let (sessionID, _, _) = try await makeSession(lane)
        let otherGeneration = "f1111111-2222-4333-9444-555555555555"
        let reopened = try ContestLane(databaseURL: root.appendingPathComponent("Contesting/contests.sqlite")) { otherGeneration }
        do {
            _ = try await reopened.handle(method: "contest_open", params: [
                "sessionID": wireID(sessionID), "workspaceGeneration": otherGeneration,
            ])
            XCTFail("Expected full UUID generation mismatch")
        } catch let error as ContestLaneError {
            XCTAssertEqual(error.code, "stale_workspace")
            XCTAssertEqual(error.outcome, "confirmed")
        }
    }

    func testPostCommitWorkspaceFenceFailureIsUncertainAndReceiptRemainsRecoverable() async throws {
        enum FenceFailure: Error { case unavailable }
        actor Fence {
            let generation: String
            var calls = 0
            init(_ generation: String) { self.generation = generation }
            func next() throws -> String {
                calls += 1
                if calls == 1 { return generation }
                throw FenceFailure.unavailable
            }
        }
        let (root, stable) = try fixture(); defer { try? FileManager.default.removeItem(at: root) }
        let (sessionID, draftID, _) = try await makeSession(stable)
        let requestID = UUID(uuidString: "b1234567-89ab-4cde-8fab-0123456789ab")!
        let digest = String(repeating: "b", count: 64)
        let params = mutation(sessionID: sessionID, requestID: requestID, revision: 1,
            timestamp: "2026-10-17T01:01:00.000Z", payload: ["fields": [
                "callsign": "K1ABC", "sentReport": "599", "sentExchange": "",
                "receivedReport": "599", "receivedExchange": "1", "frequencyHz": 14_025_000,
                "band": "20m", "mode": "CW",
            ]], draftID: draftID, digest: digest)
        let fence = Fence(generation)
        let uncertain = try ContestLane(databaseURL: root.appendingPathComponent("Contesting/contests.sqlite")) {
            try await fence.next()
        }
        do { _ = try await uncertain.handle(method: "contest_draft_apply", params: params); XCTFail("Expected post-commit fence failure") }
        catch let error as ContestLaneError {
            XCTAssertEqual(error.code, "workspace_fence_failed")
            XCTAssertEqual(error.outcome, "uncertain")
        }
        let recovered = try await stable.handle(method: "contest_operation_receipt", params: [
            "sessionID": wireID(sessionID), "workspaceGeneration": generation,
            "requestID": wireID(requestID), "payloadDigest": digest,
        ])
        XCTAssertEqual(recovered["status"] as? String, "committed")
    }

    func testContestDatabaseRejectsBothProductionHardlinksAndSymlinkAncestorsBeforeOpeningSQLite() throws {
        let fileManager = FileManager.default
        let root = fileManager.temporaryDirectory.appendingPathComponent("xlog-contest-boundary-\(UUID().uuidString)")
        defer { try? fileManager.removeItem(at: root) }
        let applicationSupport = root.appendingPathComponent("Application Support")
        let testSupport = applicationSupport.appendingPathComponent("OM0RX-xLog-Contesting-Test")
        let contestDatabase = testSupport.appendingPathComponent("Contesting/contests.sqlite")
        let protected = [
            applicationSupport.appendingPathComponent("OM0RX-xLog/OM0RX-xLog.sqlite"),
            applicationSupport.appendingPathComponent("OM0RX-xLog-Integrated Preview/OM0RX-xLog.sqlite"),
        ]
        for database in protected {
            try fileManager.createDirectory(at: database.deletingLastPathComponent(), withIntermediateDirectories: true)
            try Data("synthetic-production".utf8).write(to: database)
        }
        try fileManager.createDirectory(at: contestDatabase.deletingLastPathComponent(), withIntermediateDirectories: true)
        for production in protected {
            try fileManager.linkItem(at: production, to: contestDatabase)
            XCTAssertThrowsError(try ContestLane(databaseURL: contestDatabase) { [generation] in generation }) { error in
                XCTAssertEqual((error as? ContestLaneError)?.code, "unsafe_workspace")
            }
            XCTAssertEqual(try Data(contentsOf: production), Data("synthetic-production".utf8))
            try fileManager.removeItem(at: contestDatabase)
        }

        try fileManager.removeItem(at: testSupport)
        let redirected = root.appendingPathComponent("redirected")
        try fileManager.createDirectory(at: redirected, withIntermediateDirectories: true)
        try fileManager.createSymbolicLink(at: testSupport, withDestinationURL: redirected)
        XCTAssertThrowsError(try ContestLane(databaseURL: contestDatabase) { [generation] in generation }) { error in
            XCTAssertEqual((error as? ContestLaneError)?.code, "unsafe_workspace")
        }
        XCTAssertEqual(try fileManager.contentsOfDirectory(atPath: redirected.path), [])
    }

    func testPrivateBoundaryAcceptsStrictDescendantsWhenAncestorIsFilesystemRoot() throws {
        let fileManager = FileManager.default
        let trustedBase = URL(fileURLWithPath: fileManager.currentDirectoryPath, isDirectory: true)
            .resolvingSymlinksInPath()
        let privateRoot = trustedBase.appendingPathComponent(".build/xlog-contest-root-boundary-\(UUID().uuidString)")
        defer { try? fileManager.removeItem(at: privateRoot) }
        try fileManager.createDirectory(at: privateRoot, withIntermediateDirectories: true)
        let filesystemRoot = URL(fileURLWithPath: try XCTUnwrap(privateRoot.pathComponents.first), isDirectory: true)
        let database = privateRoot.appendingPathComponent("contests.sqlite")
        XCTAssertTrue(ContestDatabaseBoundary.isStrictDescendant(privateRoot, of: filesystemRoot))
        XCTAssertTrue(ContestDatabaseBoundary.isStrictDescendant(database, of: privateRoot))
        XCTAssertNoThrow(try ContestDatabaseBoundary.validatePrivateFile(database, privateRoot: privateRoot,
            ancestorBoundary: filesystemRoot, protectedFiles: [], fileManager: fileManager))

        let sibling = privateRoot.deletingLastPathComponent()
            .appendingPathComponent(privateRoot.lastPathComponent + "-sibling/contests.sqlite")
        XCTAssertFalse(ContestDatabaseBoundary.isStrictDescendant(privateRoot, of: privateRoot))
        XCTAssertFalse(ContestDatabaseBoundary.isStrictDescendant(sibling, of: privateRoot))
        XCTAssertThrowsError(try ContestDatabaseBoundary.validatePrivateFile(sibling, privateRoot: privateRoot,
            ancestorBoundary: filesystemRoot, protectedFiles: [], fileManager: fileManager)) { error in
            XCTAssertEqual((error as? ContestLaneError)?.code, "unsafe_workspace")
        }
    }

    func testLiveWorkerBrowserWireLifecycleAndCrossLanguageFixture() async throws {
        enum FenceFailure: Error { case unavailable }
        actor Fence {
            let generation: String
            var calls = 0
            init(_ generation: String) { self.generation = generation }
            func next() throws -> String { calls += 1; if calls == 1 { return generation }; throw FenceFailure.unavailable }
        }
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-contest-worker-wire-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let profile = try AppRuntimeProfile.contestingTestProfile(applicationSupport: root)
        guard case .contestingTest(let supportRoot) = profile else { return XCTFail("Expected test profile") }
        let logbook = LiveLogbookMethods(supportDirectory: supportRoot, inheritNativePreferences: false, runtimeProfile: profile)
        _ = try logbook.handle(method: "workspace_create", params: ["mode": "empty"])
        let worker = LiveWorker(logbook: logbook, runtimeProfile: profile)
        let health = try await workerRequest(worker, method: "health")
        XCTAssertEqual((health["result"] as? [String: Any])?["mode"] as? String, "contesting_test")
        let status = try await workerRequest(worker, method: "workspace_status")
        XCTAssertEqual((status["result"] as? [String: Any])?["workspace_exists"] as? Bool, true)

        let catalogFrame = try await workerRequest(worker, method: "contest_catalog")
        let catalog = try XCTUnwrap(catalogFrame["result"] as? [String: Any])
        let workspaceGeneration = try XCTUnwrap(catalog["workspaceGeneration"] as? String)
        XCTAssertEqual(workspaceGeneration, workspaceGeneration.lowercased())
        let rules = try XCTUnwrap(catalog["rules"] as? [[String: Any]])
        XCTAssertEqual(rules.count, 26)
        let legacyOperatorIDs: Set<String> = ["cq-ww-cw", "cq-wpx-cw", "cq-ww-ssb", "cq-wpx-ssb", "oceania-dx-cw", "oceania-dx-ssb", "sac-cw", "sac-ssb",
                                "naqp-cw", "naqp-ssb", "jidx-cw", "jidx-ssb", "arrl-dx-cw", "arrl-dx-ssb"]
        let countryReferenceOperatorIDs: Set<String> = ["cq-ww-cw-country-reference", "cq-ww-ssb-country-reference"]
        let inertRTTYIDs: Set<String> = ["naqp-rtty", "arrl-rtty-roundup"]
        let declarativeOperatorIDs: Set<String> = ["cwops-cwt", "cwops-open", "icwc-mst", "ten-ten-fallCW", "ten-ten-springCW", "ten-ten-summerPhone", "ten-ten-winterPhone", "k1usn-sst"]
        let catalogIDs = Set(rules.compactMap { ($0["identity"] as? [String: Any])?["id"] as? String })
        XCTAssertEqual(catalogIDs, legacyOperatorIDs.union(countryReferenceOperatorIDs).union(inertRTTYIDs).union(declarativeOperatorIDs))
        let declarativeRules = rules.filter { $0["declarativeDefinition"] != nil }
        XCTAssertEqual(Set(declarativeRules.compactMap { ($0["identity"] as? [String: Any])?["id"] as? String }), declarativeOperatorIDs)
        XCTAssertTrue(rules.allSatisfy { $0["entry"] is [String: Any] })
        let operatorRules = rules.filter { $0["operatorCapability"] is [String: Any] }
        XCTAssertEqual(Set(operatorRules.compactMap { ($0["identity"] as? [String: Any])?["id"] as? String }),
                       legacyOperatorIDs.union(countryReferenceOperatorIDs).union(declarativeOperatorIDs))
        for candidate in rules where countryReferenceOperatorIDs.contains(
            ((candidate["identity"] as? [String: Any])?["id"] as? String) ?? "") {
            let reference = try XCTUnwrap(candidate["countryReference"] as? [String: Any])
            XCTAssertEqual(Set(reference.keys), Set(["id", "version", "sha256", "recordCount", "immutablePerSession", "submissionReady"]))
            XCTAssertEqual(reference["id"] as? String, "cqww-country")
            XCTAssertEqual(reference["version"] as? String, "2026.1-complete")
            XCTAssertEqual(reference["sha256"] as? String, ContestPackagedCountryReferenceLoader.resourceSHA256)
            XCTAssertEqual((reference["recordCount"] as? NSNumber)?.intValue, 362)
            XCTAssertEqual(reference["immutablePerSession"] as? Bool, true)
            XCTAssertEqual(reference["submissionReady"] as? Bool, false)
        }
        for candidate in declarativeRules {
            let definition = try XCTUnwrap(candidate["declarativeDefinition"] as? [String: Any])
            let capability = try XCTUnwrap(candidate["operatorCapability"] as? [String: Any])
            XCTAssertEqual(capability["auditDigest"] as? String, definition["definitionDigest"] as? String)
            let entry = try XCTUnwrap(candidate["entry"] as? [String: Any])
            let entryProfiles = try XCTUnwrap(entry["modeProfiles"] as? [[String: Any]])
            let capabilityProfiles = try XCTUnwrap(capability["signalProfiles"] as? [[String: Any]])
            let entryModes = try entryProfiles.map { try XCTUnwrap($0["mode"] as? String) }
            let capabilityModes = try capabilityProfiles.map { profile in
                let mode = try XCTUnwrap(profile["mode"] as? String)
                let signal = try XCTUnwrap(profile["signal"] as? String)
                XCTAssertTrue(["CW", "SSB", "AM", "FM"].contains(mode))
                XCTAssertEqual(signal, mode == "CW" ? "cw" : "phone")
                return mode
            }
            XCTAssertEqual(capabilityModes.count, entryModes.count)
            XCTAssertEqual(Set(capabilityModes), Set(entryModes))
        }
        let capabilityDigests = try operatorRules.map {
            try XCTUnwrap(($0["operatorCapability"] as? [String: Any])?["auditDigest"] as? String)
        }
        XCTAssertEqual(Set(capabilityDigests).count, 24)
        XCTAssertTrue(capabilityDigests.allSatisfy { $0.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil })
        XCTAssertFalse(rules.filter { inertRTTYIDs.contains(($0["identity"] as? [String: Any])?["id"] as? String ?? "") }
            .contains { $0["operatorCapability"] != nil })
        let rule = try XCTUnwrap(rules.first { $0["displayName"] as? String == "CQ WPX CW" })
        let sessionID = UUID(uuidString: "f7654321-89ab-4cde-8fab-0123456789ab")!
        let createID = UUID(uuidString: "a7654321-89ab-4cde-8fab-0123456789ab")!
        let reserveID = UUID(uuidString: "b7654321-89ab-4cde-8fab-0123456789ab")!
        let applyID = UUID(uuidString: "c7654321-89ab-4cde-8fab-0123456789ab")!
        let commitID = UUID(uuidString: "d7654321-89ab-4cde-8fab-0123456789ab")!
        let correctionID = UUID(uuidString: "17654321-89ab-4cde-8fab-0123456789ab")!
        let deletionID = UUID(uuidString: "27654321-89ab-4cde-8fab-0123456789ab")!
        let payload: [String: Any] = [
            "sessionID": wireID(sessionID), "name": "Browser wire test",
            "ruleIdentity": try XCTUnwrap(rule["identity"] as? [String: Any]),
            "referenceDataVersion": try XCTUnwrap(rule["referenceDataVersion"] as? String),
            "station": ["callsign": "OM0RX", "cqZone": "15", "dxccEntity": "SLOVAK REPUBLIC"],
            "operator": ["callsign": "OM0RX", "category": "single-op"],
        ]
        let createParams = mutation(sessionID: sessionID, requestID: createID, revision: 0,
            timestamp: "2026-10-17T02:00:00.000Z", payload: payload, workspaceGeneration: workspaceGeneration)
        let created = try await workerRequest(worker, method: "contest_create", params: createParams)
        XCTAssertEqual(created["ok"] as? Bool, true)
        let draftID = createID
        let reserveParams = mutation(sessionID: sessionID, requestID: reserveID, revision: 1,
            timestamp: "2026-10-17T02:01:00.000Z", payload: [:], draftID: draftID,
            workspaceGeneration: workspaceGeneration)
        let reserved = try await workerRequest(worker, method: "contest_serial_reserve", params: reserveParams)
        XCTAssertEqual(reserved["ok"] as? Bool, true)
        let fields: [String: Any] = ["callsign": "K1ABC", "sentReport": "599", "sentExchange": "001",
            "receivedReport": "599", "receivedExchange": "1", "frequencyHz": 14_025_000,
            "band": "20m", "mode": "CW"]
        let applyParams = mutation(sessionID: sessionID, requestID: applyID, revision: 2,
            timestamp: "2026-10-17T02:02:00.000Z", payload: ["fields": fields], draftID: draftID,
            workspaceGeneration: workspaceGeneration)
        let applied = try await workerRequest(worker, method: "contest_draft_apply", params: applyParams)
        XCTAssertEqual((((applied["result"] as? [String: Any])?["draft"] as? [String: Any])?["reservedSerial"] as? NSNumber)?.intValue, 1)
        let commitParams = mutation(sessionID: sessionID, requestID: commitID, revision: 3,
            timestamp: "2026-10-17T02:03:00.000Z", payload: [:], draftID: draftID,
            workspaceGeneration: workspaceGeneration)
        let committed = try await workerRequest(worker, method: "contest_qso_commit", params: commitParams)
        XCTAssertEqual(committed["ok"] as? Bool, true)
        let replayed = try await workerRequest(worker, method: "contest_qso_commit", params: commitParams)
        XCTAssertEqual(try canonicalJSON(try XCTUnwrap(replayed["result"] as? [String: Any])),
                       try canonicalJSON(try XCTUnwrap(committed["result"] as? [String: Any])))
        let replayDraft = try XCTUnwrap((replayed["result"] as? [String: Any])?["draft"] as? [String: Any])
        let replayReadiness = try XCTUnwrap(replayDraft["operatorReadiness"] as? [String: Any])
        XCTAssertEqual(replayReadiness["capabilityDigest"] as? String,
                       ((rule["operatorCapability"] as? [String: Any])?["auditDigest"] as? String))
        XCTAssertEqual(replayReadiness["canSendCQ"] as? Bool, true)
        XCTAssertEqual(replayReadiness["canCommit"] as? Bool, false)
        let committedResult = try XCTUnwrap(committed["result"] as? [String: Any])
        let committedTarget = try XCTUnwrap(committedResult["qso"] as? [String: Any])
        let qsoID = try XCTUnwrap(committedTarget["qsoID"] as? String)
        let getParams: [String: Any] = ["sessionID": wireID(sessionID), "workspaceGeneration": workspaceGeneration,
            "expectedRevision": 4, "qsoID": qsoID]
        let got = try await workerRequest(worker, method: "contest_qso_get", params: getParams)
        var correctedQSO = try XCTUnwrap((got["result"] as? [String: Any])?["qso"] as? [String: Any])
        correctedQSO.removeValue(forKey: "entity")
        correctedQSO["callsign"] = "DL1AAA"
        correctedQSO["receivedReport"] = "579"
        correctedQSO["receivedExchange"] = "2"
        correctedQSO["normalizedReceivedExchange"] = "2"
        let correctionParams = mutation(sessionID: sessionID, requestID: correctionID, revision: 4,
            timestamp: "2026-10-17T02:03:30.000Z",
            payload: ["qso": correctedQSO, "reason": "Correct copied call"],
            digest: String(repeating: "1", count: 64), workspaceGeneration: workspaceGeneration)
        let corrected = try await workerRequest(worker, method: "contest_qso_correct", params: correctionParams)
        XCTAssertEqual((corrected["result"] as? [String: Any])?["operation"] as? String, "correction")
        let deletionParams = mutation(sessionID: sessionID, requestID: deletionID, revision: 5,
            timestamp: "2026-10-17T02:03:40.000Z",
            payload: ["qsoID": qsoID, "reason": "Remove invalid contact"],
            digest: String(repeating: "2", count: 64), workspaceGeneration: workspaceGeneration)
        let deleted = try await workerRequest(worker, method: "contest_qso_delete", params: deletionParams)
        XCTAssertEqual((deleted["result"] as? [String: Any])?["operation"] as? String, "deletion")
        let correctionReplay = try await workerRequest(worker, method: "contest_qso_correct", params: correctionParams)
        XCTAssertEqual(try canonicalJSON(try XCTUnwrap(correctionReplay["result"] as? [String: Any])),
                       try canonicalJSON(try XCTUnwrap(corrected["result"] as? [String: Any])))
        let deletionReplay = try await workerRequest(worker, method: "contest_qso_delete", params: deletionParams)
        XCTAssertEqual(try canonicalJSON(try XCTUnwrap(deletionReplay["result"] as? [String: Any])),
                       try canonicalJSON(try XCTUnwrap(deleted["result"] as? [String: Any])))

        let laterParams = mutation(sessionID: sessionID, requestID: UUID(), revision: 6,
            timestamp: "2026-10-17T02:04:00.000Z", payload: ["fields": fields.merging(["callsign": "K1/"], uniquingKeysWith: { _, new in new })],
            draftID: draftID, workspaceGeneration: workspaceGeneration)
        _ = try await workerRequest(worker, method: "contest_draft_apply", params: laterParams)

        let confirmed = try await workerRequest(worker, method: "contest_open", params: [
            "sessionID": wireID(sessionID).uppercased(), "workspaceGeneration": workspaceGeneration,
        ])
        XCTAssertEqual(((confirmed["error"] as? [String: Any])?["outcome"] as? String), "confirmed")

        let uncertainRequestID = UUID(uuidString: "e7654321-89ab-4cde-8fab-0123456789ab")!
        let uncertainParams = mutation(sessionID: sessionID, requestID: uncertainRequestID, revision: 7,
            timestamp: "2026-10-17T02:05:00.000Z", payload: ["fields": fields], draftID: draftID,
            digest: String(repeating: "e", count: 64), workspaceGeneration: workspaceGeneration)
        let fence = Fence(workspaceGeneration)
        let direct = try ContestLane(databaseURL: supportRoot.appendingPathComponent("Contesting/contests.sqlite")) { try await fence.next() }
        let uncertainError: ContestLaneError
        do { _ = try await direct.handle(method: "contest_draft_apply", params: uncertainParams); return XCTFail("Expected uncertain post-commit fence") }
        catch let error as ContestLaneError { uncertainError = error }
        XCTAssertEqual(uncertainError.outcome, "uncertain")
        let uncertainFrame: [String: Any] = ["id": "postcommit-fence", "ok": false,
            "error": ["code": uncertainError.code, "message": uncertainError.message, "outcome": uncertainError.outcome]]
        let receipt = try await workerRequest(worker, method: "contest_operation_receipt", params: [
            "sessionID": wireID(sessionID), "workspaceGeneration": workspaceGeneration,
            "requestID": wireID(uncertainRequestID), "payloadDigest": String(repeating: "e", count: 64),
        ])
        XCTAssertEqual((receipt["result"] as? [String: Any])?["status"] as? String, "committed")

        let naqpRule = try XCTUnwrap(rules.first { (($0["identity"] as? [String: Any])?["id"] as? String) == "naqp-cw" })
        let naqpSessionID = UUID(uuidString: "37654321-89ab-4cde-8fab-0123456789ab")!
        let naqpCreateID = UUID(uuidString: "47654321-89ab-4cde-8fab-0123456789ab")!
        let naqpPartialID = UUID(uuidString: "57654321-89ab-4cde-8fab-0123456789ab")!
        let naqpResetID = UUID(uuidString: "67654321-89ab-4cde-8fab-0123456789ab")!
        let naqpCompleteID = UUID(uuidString: "77654321-89ab-4cde-8fab-0123456789ab")!
        let naqpCommitID = UUID(uuidString: "87654321-89ab-4cde-8fab-0123456789ab")!
        let naqpCreate = mutation(sessionID: naqpSessionID, requestID: naqpCreateID, revision: 0,
            timestamp: "2026-10-18T11:00:00.000Z", payload: [
                "sessionID": wireID(naqpSessionID), "name": "NAQP generated wire",
                "ruleIdentity": try XCTUnwrap(naqpRule["identity"] as? [String: Any]),
                "referenceDataVersion": try XCTUnwrap(naqpRule["referenceDataVersion"] as? String),
                "station": ["callsign": "DL1AAA", "cqZone": "14", "dxccEntity": "FED. REP. OF GERMANY",
                            "exchangeFields": ["name": "Al", "location": ""]],
                "operator": ["callsign": "DL1AAA", "category": "Single Operator"],
            ], workspaceGeneration: workspaceGeneration)
        let naqpCreated = try await workerRequest(worker, method: "contest_create", params: naqpCreate)
        let naqpCreatedResult = try XCTUnwrap(naqpCreated["result"] as? [String: Any])
        XCTAssertNil((naqpCreatedResult["session"] as? [String: Any])?["resolvedSerial"])
        XCTAssertNil(((naqpCreatedResult["session"] as? [String: Any])?["station"] as? [String: Any])?["stationFields"])
        XCTAssertNil((naqpCreatedResult["draft"] as? [String: Any])?["resolvedSerial"])
        XCTAssertEqual(((naqpCreatedResult["session"] as? [String: Any])?["station"] as? [String: Any])?["exchangeFields"] as? [String: String],
                       ["name": "AL", "location": ""])
        XCTAssertEqual(((naqpCreatedResult["draft"] as? [String: Any])?["fields"] as? [String: Any])?["receivedExchangeFields"] as? [String: String],
                       ["name": "", "location": ""])
        let naqpPartialFields: [String: Any] = ["callsign": "K1ABC", "sentReport": "", "sentExchange": "AL",
            "receivedReport": "", "receivedExchange": "Sam", "frequencyHz": 14_050_000,
            "band": "20m", "mode": "CW", "sentExchangeFields": ["name": "AL", "location": ""],
            "receivedExchangeFields": ["name": "Sam", "location": ""]]
        let naqpPartial = mutation(sessionID: naqpSessionID, requestID: naqpPartialID, revision: 1,
            timestamp: "2026-10-18T11:01:00.000Z", payload: ["fields": naqpPartialFields],
            draftID: naqpCreateID, workspaceGeneration: workspaceGeneration)
        let naqpPartiallyApplied = try await workerRequest(worker, method: "contest_draft_apply", params: naqpPartial)
        let naqpResetFields: [String: Any] = ["callsign": "", "sentReport": "", "sentExchange": "AL",
            "receivedReport": "", "receivedExchange": "", "frequencyHz": NSNull(),
            "band": "20m", "mode": "CW", "sentExchangeFields": ["name": "AL", "location": ""],
            "receivedExchangeFields": ["name": "", "location": ""]]
        let naqpReset = mutation(sessionID: naqpSessionID, requestID: naqpResetID, revision: 2,
            timestamp: "2026-10-18T11:02:00.000Z", payload: ["fields": naqpResetFields],
            draftID: naqpCreateID, workspaceGeneration: workspaceGeneration)
        let naqpResetApplied = try await workerRequest(worker, method: "contest_draft_apply", params: naqpReset)
        let naqpOpenParams: [String: Any] = ["sessionID": wireID(naqpSessionID), "workspaceGeneration": workspaceGeneration]
        let naqpReopened = try await workerRequest(worker, method: "contest_open", params: naqpOpenParams)
        var naqpCompleteFields = naqpPartialFields
        naqpCompleteFields["receivedExchange"] = "Sam ca"
        naqpCompleteFields["receivedExchangeFields"] = ["name": "Sam", "location": "ca"]
        let naqpComplete = mutation(sessionID: naqpSessionID, requestID: naqpCompleteID, revision: 3,
            timestamp: "2026-10-18T11:03:00.000Z", payload: ["fields": naqpCompleteFields],
            draftID: naqpCreateID, workspaceGeneration: workspaceGeneration)
        let naqpCompleted = try await workerRequest(worker, method: "contest_draft_apply", params: naqpComplete)
        let naqpCommit = mutation(sessionID: naqpSessionID, requestID: naqpCommitID, revision: 4,
            timestamp: "2026-10-18T11:04:00.000Z", payload: [:], draftID: naqpCreateID,
            workspaceGeneration: workspaceGeneration)
        let naqpCommitted = try await workerRequest(worker, method: "contest_qso_commit", params: naqpCommit)

        if let output = ProcessInfo.processInfo.environment["XLOG_CONTEST_FIXTURE_OUTPUT"] {
            let fixture: [String: Any] = ["schemaVersion": 8,
                "requests": ["create": createParams, "reserve": reserveParams, "apply": applyParams,
                             "commit": commitParams, "qsoGet": getParams, "qsoCorrect": correctionParams,
                             "qsoDelete": deletionParams, "postCommitApply": uncertainParams],
                "responses": ["catalog": catalogFrame, "create": created, "reserve": reserved, "apply": applied, "commit": committed,
                              "qsoGet": got, "qsoCorrect": corrected, "qsoDelete": deleted,
                              "qsoCorrectReplayAfterDelete": correctionReplay, "qsoDeleteReplay": deletionReplay,
                              "replay": replayed, "confirmedError": confirmed, "postCommitUncertain": uncertainFrame,
                              "receiptAfterUncertain": receipt],
                "naqp": ["requests": ["create": naqpCreate, "partial": naqpPartial, "reset": naqpReset,
                                          "open": naqpOpenParams, "complete": naqpComplete, "commit": naqpCommit],
                         "responses": ["create": naqpCreated, "partial": naqpPartiallyApplied, "reset": naqpResetApplied,
                                           "open": naqpReopened, "complete": naqpCompleted, "commit": naqpCommitted]],
                "provenance": ["liveWorkerResponses": ["catalog", "create", "reserve", "apply", "commit", "qsoGet", "qsoCorrect", "qsoDelete", "qsoCorrectReplayAfterDelete", "qsoDeleteReplay", "replay", "confirmedError", "receiptAfterUncertain"],
                               "postCommitUncertain": "actual direct ContestLane error serialized by the Swift fixture test; not a LiveWorker response"],
                "assertions": ["replayResultExactlyEqual": true, "qsoChangeReplayAfterDeleteExactlyEqual": true,
                               "allContestUUIDsCanonicalLowercase": true]]
            let url = URL(fileURLWithPath: output)
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try JSONSerialization.data(withJSONObject: fixture, options: [.prettyPrinted, .sortedKeys]).write(to: url, options: .atomic)
        }
        if let output = ProcessInfo.processInfo.environment["XLOG_CURRENT_CONTEST_CATALOG_FIXTURE_OUTPUT"] {
            let fixture: [String: Any] = ["schemaVersion": 1, "catalog": catalogFrame,
                "assertions": ["legacyOperatorCapabilities": 14, "countryReferenceOperatorCapabilities": 2,
                               "declarativeOperatorCapabilities": 8, "inertRTTYRules": 2, "totalRules": 26]]
            let url = URL(fileURLWithPath: output)
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try JSONSerialization.data(withJSONObject: fixture, options: [.prettyPrinted, .sortedKeys]).write(to: url, options: .atomic)
        }
        if let output = ProcessInfo.processInfo.environment["XLOG_OPERATOR_CAPABILITIES_TS_OUTPUT"] {
            var bindings: [String: String] = [:]
            for candidate in operatorRules where legacyOperatorIDs.union(countryReferenceOperatorIDs).contains(
                ((candidate["identity"] as? [String: Any])?["id"] as? String) ?? "") {
                let identity = try XCTUnwrap(candidate["identity"] as? [String: Any])
                let keyData = try JSONSerialization.data(withJSONObject: [
                    try XCTUnwrap(identity["id"] as? String), try XCTUnwrap(identity["version"] as? String),
                    try XCTUnwrap(identity["edition"] as? String), try XCTUnwrap(identity["sourceRevision"] as? String),
                ])
                let key = try XCTUnwrap(String(data: keyData, encoding: .utf8))
                bindings[key] = try XCTUnwrap((candidate["operatorCapability"] as? [String: Any])?["auditDigest"] as? String)
            }
            XCTAssertEqual(bindings.count, 16)
            let object = try XCTUnwrap(String(data: JSONSerialization.data(withJSONObject: bindings,
                options: [.prettyPrinted, .sortedKeys]), encoding: .utf8))
            let source = """
            // Generated by ContestingLaneTests.testLiveWorkerBrowserWireLifecycleAndCrossLanguageFixture.
            // The digest binds the complete rule identity and entry descriptor to the reviewed simulation policy.
            export const REVIEWED_OPERATOR_CAPABILITY_DIGESTS: Readonly<Record<string, string>> = Object.freeze(\(object));

            export function reviewedOperatorCapabilityDigest(identity: { id: string; version: string; edition: string; sourceRevision: string }) {
              return REVIEWED_OPERATOR_CAPABILITY_DIGESTS[JSON.stringify([identity.id, identity.version, identity.edition, identity.sourceRevision])];
            }
            """
            let url = URL(fileURLWithPath: output)
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try Data(source.utf8).write(to: url, options: .atomic)
        }
    }

    func testLiveWorkerARRLRTTYConditionalSerialLifecycleAndGeneratedFixture() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-arrl-rtty-worker-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let profile = try AppRuntimeProfile.contestingTestProfile(applicationSupport: root)
        guard case .contestingTest(let supportRoot) = profile else { return XCTFail("Expected contest test profile") }
        let logbook = LiveLogbookMethods(supportDirectory: supportRoot, inheritNativePreferences: false, runtimeProfile: profile)
        _ = try logbook.handle(method: "workspace_create", params: ["mode": "empty"])
        let worker = LiveWorker(logbook: logbook, runtimeProfile: profile)
        let catalogFrame = try await workerRequest(worker, method: "contest_catalog")
        let catalog = try XCTUnwrap(catalogFrame["result"] as? [String: Any])
        let generation = try XCTUnwrap(catalog["workspaceGeneration"] as? String)
        let rule = try XCTUnwrap((catalog["rules"] as? [[String: Any]])?.first {
            (($0["identity"] as? [String: Any])?["id"] as? String) == "arrl-rtty-roundup"
        })
        let identity = try XCTUnwrap(rule["identity"] as? [String: Any])
        let reference = try XCTUnwrap(rule["referenceDataVersion"] as? String)

        func create(sessionID: UUID, requestID: UUID, name: String, call: String, zone: String,
                    entity: String, location: String, section: String) async throws -> ([String: Any], [String: Any]) {
            let params = mutation(sessionID: sessionID, requestID: requestID, revision: 0,
                timestamp: "2026-10-18T16:00:00.000Z", payload: [
                    "sessionID": wireID(sessionID), "name": name, "ruleIdentity": identity,
                    "referenceDataVersion": reference,
                    "station": ["callsign": call, "cqZone": zone, "dxccEntity": entity,
                                "exchangeFields": ["location": location, "serial": ""],
                                "stationFields": ["section": section]],
                    "operator": ["callsign": call, "category": "Single Operator"],
                ], workspaceGeneration: generation)
            return (params, try await workerRequest(worker, method: "contest_create", params: params))
        }

        let wveSession = UUID(), wveDraft = UUID()
        let (wveCreateRequest, wveCreated) = try await create(sessionID: wveSession, requestID: wveDraft,
            name: "ARRL RTTY WVE", call: "K1AAA", zone: "5", entity: "UNITED STATES", location: "CA", section: "EB")
        XCTAssertEqual(wveCreated["ok"] as? Bool, true)
        let wveResult = try XCTUnwrap(wveCreated["result"] as? [String: Any])
        XCTAssertEqual(((wveResult["draft"] as? [String: Any])?["resolvedSerial"] as? [String: Any])?["requirement"] as? String, "none")
        let wveReserveRequest = mutation(sessionID: wveSession, requestID: UUID(), revision: 1,
            timestamp: "2026-10-18T16:01:00.000Z", payload: [:], draftID: wveDraft, workspaceGeneration: generation)
        let wveReserve = try await workerRequest(worker, method: "contest_serial_reserve", params: wveReserveRequest)
        XCTAssertEqual(((wveReserve["error"] as? [String: Any])?["code"] as? String), "serial_not_supported")

        let invalidSession = UUID(), invalidDraft = UUID()
        let (_, invalidCreate) = try await create(sessionID: invalidSession, requestID: invalidDraft,
            name: "Invalid ARRL RTTY", call: "K1BBB", zone: "5", entity: "UNITED STATES", location: "CA", section: "CA")
        XCTAssertEqual(((invalidCreate["error"] as? [String: Any])?["code"] as? String), "invalid_session")
        let afterInvalid = try await workerRequest(worker, method: "contest_sessions")
        XCTAssertEqual((((afterInvalid["result"] as? [String: Any])?["sessions"] as? [[String: Any]])?.count), 1)

        let dxSession = UUID(), dxDraft = UUID(), reserveID = UUID()
        let (dxCreateRequest, dxCreated) = try await create(sessionID: dxSession, requestID: dxDraft,
            name: "ARRL RTTY DX", call: "DL1AAA", zone: "14", entity: "FED. REP. OF GERMANY", location: "", section: "DX")
        let dxResult = try XCTUnwrap(dxCreated["result"] as? [String: Any])
        XCTAssertEqual(((dxResult["session"] as? [String: Any])?["resolvedSerial"] as? [String: Any])?["requirement"] as? String, "requiredForCommit")
        let reserveRequest = mutation(sessionID: dxSession, requestID: reserveID, revision: 1,
            timestamp: "2026-10-18T16:02:00.000Z", payload: [:], draftID: dxDraft, workspaceGeneration: generation)
        let reserved = try await workerRequest(worker, method: "contest_serial_reserve", params: reserveRequest)
        let reserveReplay = try await workerRequest(worker, method: "contest_serial_reserve", params: reserveRequest)
        XCTAssertEqual(try canonicalJSON(try XCTUnwrap(reserved["result"] as? [String: Any])),
                       try canonicalJSON(try XCTUnwrap(reserveReplay["result"] as? [String: Any])))
        let fields: [String: Any] = ["callsign": "K1AAA", "sentReport": "589", "sentExchange": "001",
            "receivedReport": "579", "receivedExchange": "CA", "frequencyHz": 14_080_000,
            "band": "20m", "mode": "RTTY", "sentExchangeFields": ["location": "", "serial": "001"],
            "receivedExchangeFields": ["exchange": "CA"]]
        let applyRequest = mutation(sessionID: dxSession, requestID: UUID(), revision: 2,
            timestamp: "2026-10-18T16:03:00.000Z", payload: ["fields": fields], draftID: dxDraft, workspaceGeneration: generation)
        let applied = try await workerRequest(worker, method: "contest_draft_apply", params: applyRequest)
        let commitRequest = mutation(sessionID: dxSession, requestID: UUID(), revision: 3,
            timestamp: "2026-10-18T16:04:00.000Z", payload: [:], draftID: dxDraft, workspaceGeneration: generation)
        let committed = try await workerRequest(worker, method: "contest_qso_commit", params: commitRequest)
        let committedResult = try XCTUnwrap(committed["result"] as? [String: Any])
        let nextDraft = try XCTUnwrap(committedResult["draft"] as? [String: Any])
        XCTAssertNil(nextDraft["reservedSerial"] as? NSNumber)
        XCTAssertEqual(((nextDraft["fields"] as? [String: Any])?["sentExchangeFields"] as? [String: String])?["serial"], "")
        let qsoID = try XCTUnwrap((committedResult["qso"] as? [String: Any])?["qsoID"] as? String)
        let openRequest: [String: Any] = ["sessionID": wireID(dxSession), "workspaceGeneration": generation]
        let reopened = try await workerRequest(worker, method: "contest_open", params: openRequest)
        let getRequest: [String: Any] = ["sessionID": wireID(dxSession), "workspaceGeneration": generation,
            "expectedRevision": 4, "qsoID": qsoID]
        let got = try await workerRequest(worker, method: "contest_qso_get", params: getRequest)
        var correctedQSO = try XCTUnwrap(((got["result"] as? [String: Any])?["qso"] as? [String: Any]))
        correctedQSO.removeValue(forKey: "entity")
        correctedQSO["receivedExchange"] = "NY"; correctedQSO["normalizedReceivedExchange"] = "NY"
        correctedQSO["receivedExchangeFields"] = ["exchange": "NY"]
        let correctionRequest = mutation(sessionID: dxSession, requestID: UUID(), revision: 4,
            timestamp: "2026-10-18T16:05:00.000Z", payload: ["qso": correctedQSO, "reason": "Correct subdivision"],
            workspaceGeneration: generation)
        let corrected = try await workerRequest(worker, method: "contest_qso_correct", params: correctionRequest)

        var exportFrames: [String: Any] = [:]
        for format in ["cabrillo", "adif"] {
            let exportID = UUID()
            let prepare: [String: Any] = ["exportID": wireID(exportID), "sessionID": wireID(dxSession),
                "workspaceGeneration": generation, "expectedRevision": 5,
                "generatedAtUTC": "2026-10-18T16:06:00.000Z", "format": format,
                "header": ["callsign": "DL1AAA", "categoryOperator": "SINGLE-OP", "categoryAssisted": "NON-ASSISTED",
                    "categoryBand": "ALL", "categoryMode": "RTTY", "categoryTransmitter": "ONE", "categoryPower": "LOW",
                    "operators": ["DL1AAA"], "location": "DX", "name": "DX Operator", "addressLines": [], "email": ""]]
            let prepared = try await workerRequest(worker, method: "contest_export_prepare", params: prepare)
            XCTAssertEqual(prepared["ok"] as? Bool, true)
            let preparedResult = try XCTUnwrap(prepared["result"] as? [String: Any])
            let length = try XCTUnwrap((preparedResult["byteLength"] as? NSNumber)?.intValue)
            let readRequest: [String: Any] = ["exportID": wireID(exportID), "sessionID": wireID(dxSession),
                "workspaceGeneration": generation, "offset": 0, "length": length]
            let read = try await workerRequest(worker, method: "contest_export_read", params: readRequest)
            let bytes = try XCTUnwrap(Data(base64Encoded: try XCTUnwrap((read["result"] as? [String: Any])?["dataBase64"] as? String)))
            let document = try XCTUnwrap(String(data: bytes, encoding: .utf8))
            XCTAssertTrue(document.contains(format == "cabrillo" ? "LOCATION: DX" : "<CALL:5>K1AAA"))
            exportFrames[format] = ["request": prepare, "response": prepared, "readRequest": readRequest, "readResponse": read]
        }
        let deleteRequest = mutation(sessionID: dxSession, requestID: UUID(), revision: 5,
            timestamp: "2026-10-18T16:07:00.000Z", payload: ["qsoID": qsoID, "reason": "Remove test contact"], workspaceGeneration: generation)
        let deleted = try await workerRequest(worker, method: "contest_qso_delete", params: deleteRequest)
        XCTAssertEqual((deleted["result"] as? [String: Any])?["qsoCount"] as? NSNumber, 0)

        if let output = ProcessInfo.processInfo.environment["XLOG_ARRL_RTTY_FIXTURE_OUTPUT"] {
            let fixture: [String: Any] = ["schemaVersion": 1, "catalog": catalogFrame,
                "wve": ["createRequest": wveCreateRequest, "createResponse": wveCreated,
                        "reserveRequest": wveReserveRequest, "reserveResponse": wveReserve],
                "invalidCreateResponse": invalidCreate,
                "dx": ["createRequest": dxCreateRequest, "createResponse": dxCreated, "reserveRequest": reserveRequest,
                       "reserveResponse": reserved, "reserveReplayResponse": reserveReplay, "applyRequest": applyRequest,
                       "applyResponse": applied, "commitRequest": commitRequest, "commitResponse": committed,
                       "openRequest": openRequest, "openResponse": reopened, "getRequest": getRequest, "getResponse": got,
                       "correctionRequest": correctionRequest, "correctionResponse": corrected,
                       "deleteRequest": deleteRequest, "deleteResponse": deleted, "exports": exportFrames]]
            let url = URL(fileURLWithPath: output)
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try JSONSerialization.data(withJSONObject: fixture, options: [.prettyPrinted, .sortedKeys]).write(to: url, options: .atomic)
        }
    }

    func testLiveWorkerNAQPThreeModeStructuredEntryAndExports() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-contest-naqp-worker-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let profile = try AppRuntimeProfile.contestingTestProfile(applicationSupport: root)
        guard case .contestingTest(let supportRoot) = profile else { return XCTFail("Expected contest test profile") }
        let logbook = LiveLogbookMethods(supportDirectory: supportRoot, inheritNativePreferences: false, runtimeProfile: profile)
        _ = try logbook.handle(method: "workspace_create", params: ["mode": "empty"])
        let worker = LiveWorker(logbook: logbook, runtimeProfile: profile)
        let catalogResponse = try await workerRequest(worker, method: "contest_catalog")
        let catalog = try XCTUnwrap(catalogResponse["result"] as? [String: Any])
        let generation = try XCTUnwrap(catalog["workspaceGeneration"] as? String)
        let rules = try XCTUnwrap(catalog["rules"] as? [[String: Any]])

        for (offset, item) in [("naqp-cw", "CW", 14_050_000), ("naqp-ssb", "SSB", 14_250_000), ("naqp-rtty", "RTTY", 14_080_000)].enumerated() {
            let rule = try XCTUnwrap(rules.first { (($0["identity"] as? [String: Any])?["id"] as? String) == item.0 })
            XCTAssertEqual((rule["entryDescriptorVersion"] as? NSNumber)?.intValue, 2)
            let entry = try XCTUnwrap(rule["entry"] as? [String: Any])
            XCTAssertEqual(((entry["report"] as? [String: Any])?["format"] as? String), "none")
            let sessionID = UUID(), createID = UUID(), applyID = UUID(), commitID = UUID()
            let create = mutation(sessionID: sessionID, requestID: createID, revision: 0,
                timestamp: "2026-10-18T0\(offset):00:00.000Z", payload: [
                    "sessionID": wireID(sessionID), "name": "NAQP \(item.1) worker",
                    "ruleIdentity": try XCTUnwrap(rule["identity"] as? [String: Any]),
                    "referenceDataVersion": try XCTUnwrap(rule["referenceDataVersion"] as? String),
                    "station": ["callsign": "K1AAA", "cqZone": "5", "dxccEntity": "United States",
                                "exchangeFields": ["name": "AL", "location": "CA"]],
                    "operator": ["callsign": "K1AAA", "category": "Single Operator"],
                ], workspaceGeneration: generation)
            let createResponse = try await workerRequest(worker, method: "contest_create", params: create)
            let created = try XCTUnwrap(createResponse["result"] as? [String: Any])
            let initialDraft = try XCTUnwrap(created["draft"] as? [String: Any])
            XCTAssertNil(initialDraft["reservedSerial"] as? NSNumber)
            let initialFields = try XCTUnwrap(initialDraft["fields"] as? [String: Any])
            XCTAssertEqual(initialFields["sentReport"] as? String, "")
            XCTAssertEqual(initialFields["sentExchange"] as? String, "AL CA")
            let workedCall = offset == 0 ? "K1ABC" : "VE3AAA"
            let receivedName = offset == 0 ? "BOB" : "SAM"
            let receivedLocation = offset == 0 ? "CT" : "ON"
            let fields: [String: Any] = ["callsign": workedCall, "sentReport": "", "sentExchange": "AL CA",
                "receivedReport": "", "receivedExchange": "\(receivedName) \(receivedLocation)", "frequencyHz": item.2,
                "band": "20m", "mode": item.1, "sentExchangeFields": ["name": "AL", "location": "CA"],
                "receivedExchangeFields": ["name": receivedName, "location": receivedLocation]]
            var applyRevision = 1
            if offset == 0 {
                for (call, location) in [("DL1ABC", "CA"), ("K1ABC/MM", "CA")] {
                    var invalidPartialFields = fields
                    invalidPartialFields["callsign"] = call
                    invalidPartialFields["receivedExchange"] = location
                    invalidPartialFields["receivedExchangeFields"] = ["name": "", "location": location]
                    let invalidPartial = mutation(sessionID: sessionID, requestID: UUID(), revision: applyRevision,
                        timestamp: "2026-10-18T00:00:20.000Z", payload: ["fields": invalidPartialFields],
                        draftID: createID, workspaceGeneration: generation)
                    let invalidResponse = try await workerRequest(worker, method: "contest_draft_apply", params: invalidPartial)
                    let invalidResult = try XCTUnwrap(invalidResponse["result"] as? [String: Any])
                    let invalidDraft = try XCTUnwrap(invalidResult["draft"] as? [String: Any])
                    XCTAssertEqual((invalidDraft["dupe"] as? [String: Any])?["state"] as? String, "unchecked")
                    XCTAssertFalse(try XCTUnwrap((invalidDraft["validation"] as? [String: Any])?["errors"] as? [String]).isEmpty)
                    applyRevision += 1
                }
                let emptyPage = try await workerRequest(worker, method: "contest_log_page", params: [
                    "sessionID": wireID(sessionID), "workspaceGeneration": generation,
                    "expectedRevision": applyRevision, "offset": 0, "limit": 10])
                XCTAssertEqual((((emptyPage["result"] as? [String: Any])?["qsos"] as? [[String: Any]])?.count), 0)
                var incompleteFields = fields
                incompleteFields["receivedExchange"] = "SAM"
                incompleteFields["receivedExchangeFields"] = ["name": "SAM", "location": ""]
                let incomplete = mutation(sessionID: sessionID, requestID: UUID(), revision: applyRevision,
                    timestamp: "2026-10-18T00:00:30.000Z", payload: ["fields": incompleteFields], draftID: createID,
                    workspaceGeneration: generation)
                let incompleteResponse = try await workerRequest(worker, method: "contest_draft_apply", params: incomplete)
                let incompleteResult = try XCTUnwrap(incompleteResponse["result"] as? [String: Any])
                let incompleteDraft = try XCTUnwrap(incompleteResult["draft"] as? [String: Any])
                let validation = try XCTUnwrap(incompleteDraft["validation"] as? [String: Any])
                XCTAssertFalse(try XCTUnwrap(validation["errors"] as? [String]).isEmpty)
                applyRevision += 1
            }
            let apply = mutation(sessionID: sessionID, requestID: applyID, revision: applyRevision,
                timestamp: "2026-10-18T0\(offset):01:00.000Z", payload: ["fields": fields], draftID: createID,
                workspaceGeneration: generation)
            let applied = try await workerRequest(worker, method: "contest_draft_apply", params: apply)
            XCTAssertEqual(applied["ok"] as? Bool, true)
            let commit = mutation(sessionID: sessionID, requestID: commitID, revision: applyRevision + 1,
                timestamp: "2026-10-18T0\(offset):02:00.000Z", payload: [:], draftID: createID,
                workspaceGeneration: generation)
            let commitResponse = try await workerRequest(worker, method: "contest_qso_commit", params: commit)
            let committed = try XCTUnwrap(commitResponse["result"] as? [String: Any])
            XCTAssertEqual(((committed["score"] as? [String: Any])?["claimedScore"] as? NSNumber)?.intValue, 1)
            let nextFields = try XCTUnwrap((committed["draft"] as? [String: Any])?["fields"] as? [String: Any])
            XCTAssertEqual(nextFields["sentExchange"] as? String, "AL CA")
            XCTAssertEqual(nextFields["receivedExchange"] as? String, "")
            XCTAssertEqual(nextFields["sentReport"] as? String, "")

            let revision = try XCTUnwrap(((committed["session"] as? [String: Any])?["revision"] as? NSNumber)?.uint64Value)
            for format in ["cabrillo", "adif"] {
                let exportID = UUID()
                let prepare: [String: Any] = ["exportID": wireID(exportID), "sessionID": wireID(sessionID),
                    "workspaceGeneration": generation, "expectedRevision": revision,
                    "generatedAtUTC": "2026-10-18T0\(offset):03:00.000Z", "format": format,
                    "header": ["callsign": "K1AAA", "categoryOperator": "SINGLE-OP", "categoryAssisted": "NON-ASSISTED",
                        "categoryBand": "ALL", "categoryMode": item.1, "categoryTransmitter": "ONE", "categoryPower": "LOW",
                        "operators": ["K1AAA"], "location": "CA", "name": "AL Operator", "addressLines": [], "email": ""]]
                let prepareResponse = try await workerRequest(worker, method: "contest_export_prepare", params: prepare)
                XCTAssertEqual(prepareResponse["ok"] as? Bool, true, "\(prepareResponse)")
                let prepared = try XCTUnwrap(prepareResponse["result"] as? [String: Any])
                let length = try XCTUnwrap((prepared["byteLength"] as? NSNumber)?.intValue)
                let read = try await workerRequest(worker, method: "contest_export_read", params: [
                    "exportID": wireID(exportID), "sessionID": wireID(sessionID), "workspaceGeneration": generation,
                    "offset": 0, "length": length])
                let chunk = try XCTUnwrap(read["result"] as? [String: Any])
                let bytes = try XCTUnwrap(Data(base64Encoded: try XCTUnwrap(chunk["dataBase64"] as? String)))
                let text = try XCTUnwrap(String(data: bytes, encoding: .utf8))
                XCTAssertTrue(text.contains(workedCall)); XCTAssertTrue(text.contains(receivedName))
                if format == "adif" {
                    XCTAssertFalse(text.contains("<RST_SENT:")); XCTAssertFalse(text.contains("<RST_RCVD:"))
                } else {
                    let qsoLine = try XCTUnwrap(text.components(separatedBy: "\r\n").first { $0.hasPrefix("QSO:") })
                    XCTAssertFalse(qsoLine.contains(" 599 "), qsoLine)
                }
                _ = try await workerRequest(worker, method: "contest_export_release", params: [
                    "exportID": wireID(exportID), "sessionID": wireID(sessionID), "workspaceGeneration": generation])
            }

            let openResponse = try await workerRequest(worker, method: "contest_open", params: [
                "sessionID": wireID(sessionID), "workspaceGeneration": generation])
            let opened = try XCTUnwrap(openResponse["result"] as? [String: Any])
            XCTAssertEqual(((opened["session"] as? [String: Any])?["revision"] as? NSNumber)?.uint64Value, revision)
            let qsoID = try XCTUnwrap((committed["qso"] as? [String: Any])?["qsoID"] as? String)
            let getResponse = try await workerRequest(worker, method: "contest_qso_get", params: [
                "sessionID": wireID(sessionID), "workspaceGeneration": generation,
                "expectedRevision": revision, "qsoID": qsoID])
            let got = try XCTUnwrap(getResponse["result"] as? [String: Any])
            var correctedQSO = try XCTUnwrap(got["qso"] as? [String: Any]); correctedQSO.removeValue(forKey: "entity")
            let correctedName = offset == 0 ? "Sam" : "TOM"
            correctedQSO["receivedExchange"] = "\(correctedName) \(receivedLocation)"
            correctedQSO["normalizedReceivedExchange"] = "\(correctedName.uppercased()) \(receivedLocation)"
            correctedQSO["receivedExchangeFields"] = ["name": correctedName, "location": receivedLocation]
            let correctionID = UUID()
            let correction = mutation(sessionID: sessionID, requestID: correctionID, revision: Int(revision),
                timestamp: "2026-10-18T0\(offset):04:00.000Z", payload: ["qso": correctedQSO, "reason": "Correct copied name"],
                workspaceGeneration: generation)
            let correctionResponse = try await workerRequest(worker, method: "contest_qso_correct", params: correction)
            let corrected = try XCTUnwrap(correctionResponse["result"] as? [String: Any])
            XCTAssertEqual(((corrected["score"] as? [String: Any])?["claimedScore"] as? NSNumber)?.intValue, 1)
            if offset == 0 {
                let target = try XCTUnwrap(corrected["currentTarget"] as? [String: Any])
                XCTAssertEqual(target["receivedExchange"] as? String, "Sam CT")
                XCTAssertEqual(target["normalizedReceivedExchange"] as? String, "SAM CT")
                XCTAssertEqual(target["receivedExchangeFields"] as? [String: String], ["name": "Sam", "location": "CT"])
            }
            let scoreResponse = try await workerRequest(worker, method: "contest_score", params: [
                "sessionID": wireID(sessionID), "workspaceGeneration": generation, "expectedRevision": revision + 1])
            let rescored = try XCTUnwrap(scoreResponse["result"] as? [String: Any])
            XCTAssertEqual((rescored["claimedScore"] as? NSNumber)?.intValue, 1)
            let deletionID = UUID()
            let deletion = mutation(sessionID: sessionID, requestID: deletionID, revision: Int(revision + 1),
                timestamp: "2026-10-18T0\(offset):05:00.000Z", payload: ["qsoID": qsoID, "reason": "Remove test contact"],
                workspaceGeneration: generation)
            let deletionResponse = try await workerRequest(worker, method: "contest_qso_delete", params: deletion)
            let deleted = try XCTUnwrap(deletionResponse["result"] as? [String: Any])
            XCTAssertEqual(((deleted["score"] as? [String: Any])?["claimedScore"] as? NSNumber)?.intValue, 0)
        }

        let scoreRule = try XCTUnwrap(rules.first { (($0["identity"] as? [String: Any])?["id"] as? String) == "naqp-cw" })
        let scoreSessionID = UUID(), scoreDraftID = UUID()
        let scoreCreate = mutation(sessionID: scoreSessionID, requestID: scoreDraftID, revision: 0,
            timestamp: "2026-10-18T10:00:00.000Z", payload: [
                "sessionID": wireID(scoreSessionID), "name": "NAQP independent score oracle",
                "ruleIdentity": try XCTUnwrap(scoreRule["identity"] as? [String: Any]),
                "referenceDataVersion": try XCTUnwrap(scoreRule["referenceDataVersion"] as? String),
                "station": ["callsign": "K1AAA", "cqZone": "5", "dxccEntity": "United States",
                            "exchangeFields": ["name": "AL", "location": "CA"]],
                "operator": ["callsign": "K1AAA", "category": "Single Operator"],
            ], workspaceGeneration: generation)
        _ = try await workerRequest(worker, method: "contest_create", params: scoreCreate)
        let contacts: [(String, String, String, String, Int)] = [
            ("K2AAA", "BOB", "CA", "20m", 14_050_000),
            ("KH6AAA", "KAI", "HI", "20m", 14_051_000),
            ("HI8AAA", "ANA", "HI", "20m", 14_052_000),
            ("VE3AAA", "SAM", "ON", "20m", 14_053_000),
            ("K3AAA", "LEE", "CA", "40m", 7_050_000),
            ("DL1AAA", "MAX", "DX", "20m", 14_054_000),
            ("K2AAA", "BOB", "CA", "20m", 14_055_000),
        ]
        var scoreRevision = 1
        var finalCommit: [String: Any] = [:]
        for (index, contact) in contacts.enumerated() {
            let fields: [String: Any] = [
                "callsign": contact.0, "sentReport": "", "sentExchange": "AL CA",
                "receivedReport": "", "receivedExchange": "\(contact.1) \(contact.2)",
                "frequencyHz": contact.4, "band": contact.3, "mode": "CW",
                "sentExchangeFields": ["name": "AL", "location": "CA"],
                "receivedExchangeFields": ["name": contact.1, "location": contact.2],
            ]
            let apply = mutation(sessionID: scoreSessionID, requestID: UUID(), revision: scoreRevision,
                timestamp: "2026-10-18T10:\(String(format: "%02d", index * 2 + 1)):00.000Z",
                payload: ["fields": fields], draftID: scoreDraftID, workspaceGeneration: generation)
            _ = try await workerRequest(worker, method: "contest_draft_apply", params: apply)
            scoreRevision += 1
            let commit = mutation(sessionID: scoreSessionID, requestID: UUID(), revision: scoreRevision,
                timestamp: "2026-10-18T10:\(String(format: "%02d", index * 2 + 2)):00.000Z",
                payload: [:], draftID: scoreDraftID, workspaceGeneration: generation)
            let response = try await workerRequest(worker, method: "contest_qso_commit", params: commit)
            finalCommit = try XCTUnwrap(response["result"] as? [String: Any])
            scoreRevision += 1
        }
        let score = try XCTUnwrap(finalCommit["score"] as? [String: Any])
        XCTAssertEqual((score["points"] as? NSNumber)?.intValue, 6)
        XCTAssertEqual((score["multipliers"] as? NSNumber)?.intValue, 5)
        XCTAssertEqual((score["claimedScore"] as? NSNumber)?.intValue, 30)
        XCTAssertEqual((finalCommit["qso"] as? [String: Any])?["isDupe"] as? Bool, true)
        let projectedScoreResponse = try await workerRequest(worker, method: "contest_score", params: [
            "sessionID": wireID(scoreSessionID), "workspaceGeneration": generation, "expectedRevision": scoreRevision])
        let projectedScore = try XCTUnwrap(projectedScoreResponse["result"] as? [String: Any])
        let displayLabels = try XCTUnwrap(projectedScore["multiplierDisplayLabels"] as? [String])
        XCTAssertTrue(displayLabels.contains("Hawaii · 20m"))
        XCTAssertTrue(displayLabels.contains("Dominican Republic · 20m"))
        let pageResponse = try await workerRequest(worker, method: "contest_log_page", params: [
            "sessionID": wireID(scoreSessionID), "workspaceGeneration": generation, "expectedRevision": scoreRevision,
            "offset": 0, "limit": 20])
        let page = try XCTUnwrap(pageResponse["result"] as? [String: Any])
        let projectedQSOs = try XCTUnwrap(page["qsos"] as? [[String: Any]])
        XCTAssertEqual(projectedQSOs.first { $0["callsign"] as? String == "KH6AAA" }?["multiplierDisplayLabels"] as? [String], ["Hawaii · 20m"])
        XCTAssertEqual(projectedQSOs.first { $0["callsign"] as? String == "HI8AAA" }?["multiplierDisplayLabels"] as? [String], ["Dominican Republic · 20m"])
    }

    func testWorkerAllowsContestOnlyInBoundTestProfileAndStillDeniesExternalIO() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-contest-worker-lane-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let profile = try AppRuntimeProfile.contestingTestProfile(applicationSupport: root)
        guard case .contestingTest(let supportRoot) = profile else { return XCTFail("Expected test profile") }
        let logbook = LiveLogbookMethods(supportDirectory: supportRoot, inheritNativePreferences: false, runtimeProfile: profile)
        _ = try logbook.handle(method: "workspace_create", params: ["mode": "empty"])
        let worker = LiveWorker(logbook: logbook, runtimeProfile: profile)
        func request(_ method: String) async throws -> [String: Any] {
            let data = try JSONSerialization.data(withJSONObject: ["id": wireID(UUID()), "method": method, "params": [:]])
            let responseData = await worker.response(to: data)
            return try XCTUnwrap(JSONSerialization.jsonObject(with: responseData) as? [String: Any])
        }
        let catalog = try await request("contest_catalog")
        XCTAssertEqual(catalog["ok"] as? Bool, true)
        let external = try await request("cluster_connect")
        XCTAssertEqual((external["error"] as? [String: Any])?["code"] as? String, "external_io_disabled")

        let production = LiveWorker(logbook: LiveLogbookMethods(supportDirectory: root.appendingPathComponent("production"), inheritNativePreferences: false))
        let data = try JSONSerialization.data(withJSONObject: ["id": "production", "method": "contest_catalog", "params": [:]])
        let responseData = await production.response(to: data)
        let response = try XCTUnwrap(JSONSerialization.jsonObject(with: responseData) as? [String: Any])
        XCTAssertEqual((response["error"] as? [String: Any])?["code"] as? String, "contest_profile_required")
    }
}

private actor ContestGenerationGate {
    let value: String
    private var continuation: CheckedContinuation<Void,Never>?
    private var waiting = false
    init(value:String){self.value=value}
    func wait() async -> String { await withCheckedContinuation{continuation=$0;waiting=true}; return value }
    func awaiting() async { while !waiting { await Task.yield() } }
    func release(){continuation?.resume();continuation=nil}
}

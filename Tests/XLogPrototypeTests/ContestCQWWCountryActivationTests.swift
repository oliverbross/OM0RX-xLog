import Foundation
import XCTest
@testable import XLogPrototypeSupport

final class ContestCQWWCountryActivationTests: XCTestCase {
    private var generation = "f1111111-2222-4333-8444-555555555555"
    private let sourceRevision = "cqww-country@2026.1-complete+sha256:3f4e9752188f47677661a156790ddbbf1ac8afde8b282d3e2ebbbc9f68ba070b"

    func testCatalogBindsPackagedReferenceAndMissingResourceFailsClosedForOnlyNewRules() async throws {
        enum Missing: Error { case resource }
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-cqww-country-catalog-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let databaseURL = root.appendingPathComponent("Contesting/contests.sqlite")
        var active: ContestLane? = try ContestLane(databaseURL: databaseURL) { [generation] in generation }
        let catalog = try await active!.handle(method: "contest_catalog", params: [:])
        let rules = try XCTUnwrap(catalog["rules"] as? [[String: Any]])
        XCTAssertEqual(rules.count, 26)
        for id in ["cq-ww-cw-country-reference", "cq-ww-ssb-country-reference"] {
            let rule = try XCTUnwrap(rules.first { identityID($0) == id })
            let identity = try XCTUnwrap(rule["identity"] as? [String: Any])
            XCTAssertEqual(identity["sourceRevision"] as? String, sourceRevision)
            XCTAssertEqual(rule["sourceVerification"] as? String, "provisional")
            let binding = try XCTUnwrap(rule["countryReference"] as? [String: Any])
            XCTAssertEqual(Set(binding.keys), Set(["id", "version", "sha256", "recordCount", "immutablePerSession", "submissionReady"]))
            XCTAssertEqual(binding["id"] as? String, "cqww-country")
            XCTAssertEqual(binding["version"] as? String, "2026.1-complete")
            XCTAssertEqual(binding["sha256"] as? String,
                           "3f4e9752188f47677661a156790ddbbf1ac8afde8b282d3e2ebbbc9f68ba070b")
            XCTAssertEqual((binding["recordCount"] as? NSNumber)?.intValue, 362)
            XCTAssertEqual(binding["immutablePerSession"] as? Bool, true)
            XCTAssertEqual(binding["submissionReady"] as? Bool, false)
        }
        let cwRule = try XCTUnwrap(rules.first { identityID($0) == "cq-ww-cw-country-reference" })
        let sessionID = UUID(), draftID = UUID()
        let create = mutation(sessionID: sessionID, requestID: draftID, revision: 0,
            timestamp: "2026-10-18T01:00:00.000Z", payload: createPayload(rule: cwRule,
                sessionID: sessionID, stationCall: "OM0RX", zone: "15", entity: "SLOVAK REPUBLIC"))
        _ = try await active!.handle(method: "contest_create", params: create)
        active = nil

        let unavailable = try ContestLane(databaseURL: databaseURL, generationSource: { [generation] in generation },
                                          countryReferenceLoader: { throw Missing.resource })
        let fallback = try await unavailable.handle(method: "contest_catalog", params: [:])
        let fallbackRules = try XCTUnwrap(fallback["rules"] as? [[String: Any]])
        XCTAssertEqual(fallbackRules.count, 24)
        XCTAssertNotNil(fallbackRules.first { identityID($0) == "cq-ww-cw" })
        XCTAssertNil(fallbackRules.first { identityID($0) == "cq-ww-cw-country-reference" })
        await assertError("unknown_rule") {
            try await unavailable.handle(method: "contest_open", params: [
                "sessionID": wireID(sessionID), "workspaceGeneration": generation,
            ])
        }
        await assertError("unknown_rule") {
            try await unavailable.handle(method: "contest_create", params: create)
        }
    }

    func testRealWorkerCWAndSSBCreateScoreCorrectDeleteRestartAndExport() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-cqww-country-worker-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let profile = try AppRuntimeProfile.contestingTestProfile(applicationSupport: root)
        guard case .contestingTest(let supportRoot) = profile else { return XCTFail("Expected contesting test profile") }
        var logbook = LiveLogbookMethods(supportDirectory: supportRoot, inheritNativePreferences: false, runtimeProfile: profile)
        _ = try logbook.handle(method: "workspace_create", params: ["mode": "empty"])
        var worker: LiveWorker? = LiveWorker(logbook: logbook, runtimeProfile: profile)
        let catalogFrame = try await request(worker!, "contest_catalog")
        let catalog = try result(catalogFrame)
        generation = try XCTUnwrap(catalog["workspaceGeneration"] as? String)
        let rules = try XCTUnwrap(catalog["rules"] as? [[String: Any]])
        let cwRule = try XCTUnwrap(rules.first { identityID($0) == "cq-ww-cw-country-reference" })
        let ssbRule = try XCTUnwrap(rules.first { identityID($0) == "cq-ww-ssb-country-reference" })

        let cw = try await create(worker!, rule: cwRule, stationCall: "OM0RX", zone: "15",
                                  entity: "SLOVAK REPUBLIC", name: "CQWW country CW")
        var cwRevision = 1
        var committed: [(call: String, qsoID: String)] = []
        let contacts: [(String, String)] = [
            ("OM1AAA", "15"), ("DL1AAA", "14"), ("K1AAA", "05"),
            ("OE1AAA", "15"), ("4U1VIC", "15"), ("I1AAA", "15"),
            ("IT9AAA", "15"), ("IG9AAA", "33"), ("IH9AAA", "33"),
        ]
        for (index, contact) in contacts.enumerated() {
            let response = try await log(worker!, sessionID: cw.sessionID, draftID: cw.draftID,
                revision: cwRevision, call: contact.0, receivedZone: contact.1, mode: "CW",
                frequencyHz: 14_025_000, minute: index)
            cwRevision += 2
            committed.append((contact.0, try XCTUnwrap((try result(response)["qso"] as? [String: Any])?["qsoID"] as? String)))
        }
        var cwScore = try await score(worker!, sessionID: cw.sessionID, revision: cwRevision)
        XCTAssertEqual(scoreTuple(cwScore), [14, 12, 168])
        let initialLabels = multiplierLabels(cwScore)
        XCTAssertTrue(initialLabels.isSuperset(of: [
            "cqww-country:DXCC-248:20m", "cqww-country:WAE-IT9:20m",
            "cqww-country:CQWW-IG9-IH9:20m", "cq-zone:33:20m",
        ]), "\(initialLabels.sorted())")

        let ih9 = try XCTUnwrap(committed.first { $0.call == "IH9AAA" })
        let correction = try await correctedQSO(worker!, sessionID: cw.sessionID, qsoID: ih9.qsoID,
                                                 revision: cwRevision, callsign: "IT9BBB", receivedZone: "15")
        cwRevision += 1
        XCTAssertEqual(scoreTuple(try result(correction)["score"] as? [String: Any]), [12, 12, 144])
        let correctedScore = try await score(worker!, sessionID: cw.sessionID, revision: cwRevision)
        let correctedLabels = multiplierLabels(correctedScore)
        XCTAssertTrue(correctedLabels.isSuperset(of: [
            "cqww-country:DXCC-248:20m", "cqww-country:WAE-IT9:20m",
            "cqww-country:CQWW-IG9-IH9:20m", "cq-zone:33:20m",
        ]), "\(correctedLabels.sorted())")
        let ig9 = try XCTUnwrap(committed.first { $0.call == "IG9AAA" })
        let deletion = try await request(worker!, "contest_qso_delete", params: mutation(
            sessionID: cw.sessionID, requestID: UUID(), revision: cwRevision,
            timestamp: "2026-10-18T02:40:00.000Z",
            payload: ["qsoID": ig9.qsoID, "reason": "Remove African Italy test contact"]))
        cwRevision += 1
        // Mainland Italy, Sicily, and African Italy are distinct sponsor-country keys.
        // After IH9 is corrected to Sicily/zone 15, deleting IG9 removes African Italy and zone 33.
        XCTAssertEqual(scoreTuple(try result(deletion)["score"] as? [String: Any]), [9, 10, 90])
        let deletedScore = try await score(worker!, sessionID: cw.sessionID, revision: cwRevision)
        let deletedLabels = multiplierLabels(deletedScore)
        XCTAssertTrue(deletedLabels.contains("cqww-country:DXCC-248:20m"))
        XCTAssertTrue(deletedLabels.contains("cqww-country:WAE-IT9:20m"))
        XCTAssertFalse(deletedLabels.contains("cqww-country:CQWW-IG9-IH9:20m"))
        XCTAssertFalse(deletedLabels.contains("cq-zone:33:20m"))

        for format in ["cabrillo", "adif"] {
            let text = try await export(worker!, format: format, sessionID: cw.sessionID, revision: cwRevision,
                                        mode: "CW", timestamp: "2026-10-18T02:41:00.000Z")
            XCTAssertTrue(text.contains("IT9BBB"), format)
            XCTAssertFalse(text.contains("IG9AAA"), format)
            XCTAssertFalse(text.contains("IH9AAA"), format)
        }

        let ssb = try await create(worker!, rule: ssbRule, stationCall: "K1ZZZ", zone: "05",
                                   entity: "UNITED STATES", name: "CQWW country SSB")
        _ = try await log(worker!, sessionID: ssb.sessionID, draftID: ssb.draftID, revision: 1,
                          call: "VE3AAA", receivedZone: "04", mode: "SSB",
                          frequencyHz: 14_250_000, minute: 45)
        let ssbScore = try await score(worker!, sessionID: ssb.sessionID, revision: 3)
        XCTAssertEqual(scoreTuple(ssbScore), [2, 2, 4])
        for format in ["cabrillo", "adif"] {
            let text = try await export(worker!, format: format, sessionID: ssb.sessionID, revision: 3,
                                        mode: "SSB", timestamp: "2026-10-18T02:50:00.000Z")
            XCTAssertTrue(text.contains("VE3AAA"), format)
        }

        await worker!.shutdown()
        worker = nil
        logbook = LiveLogbookMethods(supportDirectory: supportRoot, inheritNativePreferences: false, runtimeProfile: profile)
        let reopenedWorker = LiveWorker(logbook: logbook, runtimeProfile: profile)
        let reopened = try result(try await request(reopenedWorker, "contest_open", params: [
            "sessionID": wireID(cw.sessionID), "workspaceGeneration": generation,
        ]))
        XCTAssertEqual(((reopened["session"] as? [String: Any])?["revision"] as? NSNumber)?.intValue, cwRevision)
        let reopenedRule = try XCTUnwrap((reopened["session"] as? [String: Any])?["rule"] as? [String: Any])
        XCTAssertEqual(((reopenedRule["identity"] as? [String: Any])?["sourceRevision"] as? String), sourceRevision)
        XCTAssertEqual((reopenedRule["countryReference"] as? [String: Any])?["sha256"] as? String,
                       "3f4e9752188f47677661a156790ddbbf1ac8afde8b282d3e2ebbbc9f68ba070b")
        cwScore = try await score(reopenedWorker, sessionID: cw.sessionID, revision: cwRevision)
        XCTAssertEqual(scoreTuple(cwScore), [9, 10, 90])
        XCTAssertEqual(multiplierLabels(cwScore), deletedLabels)

        if let output = ProcessInfo.processInfo.environment["XLOG_CQWW_COUNTRY_ACTIVATION_FIXTURE_OUTPUT"] {
            var countryCatalog = catalogFrame
            var countryCatalogResult = catalog
            countryCatalogResult["rules"] = rules.filter { identityID($0)?.contains("country-reference") == true }
            countryCatalog["result"] = countryCatalogResult
            let fixture: [String: Any] = [
                "schemaVersion": 1, "generatedBy": "ContestCQWWCountryActivationTests",
                "catalog": countryCatalog,
                "assertions": ["cwFinalPoints": 9, "cwFinalMultipliers": 10, "cwFinalScore": 90,
                               "ssbPoints": 2, "ssbMultipliers": 2, "ssbScore": 4,
                               "packagedReferenceSHA256": "3f4e9752188f47677661a156790ddbbf1ac8afde8b282d3e2ebbbc9f68ba070b"],
            ]
            try JSONSerialization.data(withJSONObject: fixture, options: [.prettyPrinted, .sortedKeys])
                .write(to: URL(fileURLWithPath: output), options: .atomic)
        }
        await reopenedWorker.shutdown()
    }

    private func create(_ worker: LiveWorker, rule: [String: Any], stationCall: String,
                        zone: String, entity: String, name: String) async throws -> (sessionID: UUID, draftID: UUID) {
        let sessionID = UUID(), draftID = UUID()
        let response = try await request(worker, "contest_create", params: mutation(
            sessionID: sessionID, requestID: draftID, revision: 0,
            timestamp: "2026-10-18T01:30:00.000Z",
            payload: createPayload(rule: rule, sessionID: sessionID, stationCall: stationCall,
                                   zone: zone, entity: entity, name: name)))
        _ = try result(response)
        return (sessionID, draftID)
    }

    private func createPayload(rule: [String: Any], sessionID: UUID, stationCall: String,
                               zone: String, entity: String, name: String = "CQWW country preview") -> [String: Any] {
        ["sessionID": wireID(sessionID), "name": name,
         "ruleIdentity": rule["identity"]!, "referenceDataVersion": rule["referenceDataVersion"]!,
         "station": ["callsign": stationCall, "cqZone": zone, "dxccEntity": entity],
         "operator": ["callsign": stationCall, "category": "Single Operator"]]
    }

    private func log(_ worker: LiveWorker, sessionID: UUID, draftID: UUID, revision: Int,
                     call: String, receivedZone: String, mode: String,
                     frequencyHz: Int, minute: Int) async throws -> [String: Any] {
        let report = mode == "CW" ? "599" : "59"
        let sentZone = mode == "CW" ? "15" : "05"
        let fields: [String: Any] = [
            "callsign": call, "sentReport": report, "sentExchange": sentZone,
            "receivedReport": report, "receivedExchange": receivedZone,
            "frequencyHz": frequencyHz, "band": "20m", "mode": mode,
        ]
        _ = try result(try await request(worker, "contest_draft_apply", params: mutation(
            sessionID: sessionID, requestID: UUID(), revision: revision,
            timestamp: String(format: "2026-10-18T02:%02d:00.000Z", minute),
            payload: ["fields": fields], draftID: draftID)))
        return try await request(worker, "contest_qso_commit", params: mutation(
            sessionID: sessionID, requestID: UUID(), revision: revision + 1,
            timestamp: String(format: "2026-10-18T02:%02d:10.000Z", minute),
            payload: [:], draftID: draftID))
    }

    private func correctedQSO(_ worker: LiveWorker, sessionID: UUID, qsoID: String,
                              revision: Int, callsign: String, receivedZone: String) async throws -> [String: Any] {
        let got = try result(try await request(worker, "contest_qso_get", params: [
            "sessionID": wireID(sessionID), "workspaceGeneration": generation,
            "expectedRevision": revision, "qsoID": qsoID,
        ]))
        var qso = try XCTUnwrap(got["qso"] as? [String: Any])
        qso.removeValue(forKey: "entity")
        qso["callsign"] = callsign
        qso["receivedExchange"] = receivedZone
        qso["normalizedReceivedExchange"] = receivedZone
        return try await request(worker, "contest_qso_correct", params: mutation(
            sessionID: sessionID, requestID: UUID(), revision: revision,
            timestamp: "2026-10-18T02:39:00.000Z",
            payload: ["qso": qso, "reason": "Correct country endpoint callsign"]))
    }

    private func score(_ worker: LiveWorker, sessionID: UUID, revision: Int) async throws -> [String: Any] {
        try result(try await request(worker, "contest_score", params: [
            "sessionID": wireID(sessionID), "workspaceGeneration": generation, "expectedRevision": revision,
        ]))
    }

    private func scoreTuple(_ value: [String: Any]?) -> [Int] {
        guard let value else { return [] }
        return ["points", "multipliers", "claimedScore"].map { (value[$0] as? NSNumber)?.intValue ?? -1 }
    }

    private func multiplierLabels(_ value: [String: Any]) -> Set<String> {
        Set(value["multiplierLabels"] as? [String] ?? [])
    }

    private func export(_ worker: LiveWorker, format: String, sessionID: UUID,
                        revision: Int, mode: String, timestamp: String) async throws -> String {
        let exportID = UUID()
        let prepared = try result(try await request(worker, "contest_export_prepare", params: [
            "exportID": wireID(exportID), "sessionID": wireID(sessionID),
            "workspaceGeneration": generation, "expectedRevision": revision,
            "generatedAtUTC": timestamp, "format": format,
            "header": ["callsign": mode == "CW" ? "OM0RX" : "K1ZZZ", "categoryOperator": "SINGLE-OP",
                       "categoryAssisted": "NON-ASSISTED", "categoryBand": "ALL", "categoryMode": mode,
                       "categoryTransmitter": "ONE", "categoryPower": "LOW",
                       "operators": [mode == "CW" ? "OM0RX" : "K1ZZZ"], "location": "DX",
                       "name": "Oliver Operator", "addressLines": [], "email": ""],
        ]))
        let length = try XCTUnwrap((prepared["byteLength"] as? NSNumber)?.intValue)
        let chunk = try result(try await request(worker, "contest_export_read", params: [
            "exportID": wireID(exportID), "sessionID": wireID(sessionID),
            "workspaceGeneration": generation, "offset": 0, "length": length,
        ]))
        let data = try XCTUnwrap(Data(base64Encoded: try XCTUnwrap(chunk["dataBase64"] as? String)))
        _ = try result(try await request(worker, "contest_export_release", params: [
            "exportID": wireID(exportID), "sessionID": wireID(sessionID), "workspaceGeneration": generation,
        ]))
        return try XCTUnwrap(String(data: data, encoding: .utf8))
    }

    private func request(_ worker: LiveWorker, _ method: String,
                         params: [String: Any] = [:]) async throws -> [String: Any] {
        let data = try JSONSerialization.data(withJSONObject: [
            "id": wireID(UUID()), "method": method, "params": params,
        ])
        let response = await worker.response(to: data)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: response) as? [String: Any])
    }

    private func result(_ frame: [String: Any]) throws -> [String: Any] {
        guard frame["ok"] as? Bool == true else {
            XCTFail("Worker failed: \(frame)")
            throw NSError(domain: "ContestCQWWCountryActivationTests", code: 1)
        }
        return try XCTUnwrap(frame["result"] as? [String: Any])
    }

    private func mutation(sessionID: UUID, requestID: UUID, revision: Int, timestamp: String,
                          payload: [String: Any], draftID: UUID? = nil) -> [String: Any] {
        var params: [String: Any] = [
            "sessionID": wireID(sessionID), "workspaceGeneration": generation,
            "requestID": wireID(requestID), "expectedRevision": revision,
            "payloadDigest": String(repeating: "a", count: 32) + wireID(requestID).replacingOccurrences(of: "-", with: ""),
            "operationTimestamp": timestamp, "payload": payload,
        ]
        if let draftID { params["draftID"] = wireID(draftID) }
        return params
    }

    private func assertError(_ code: String, _ body: () async throws -> [String: Any]) async {
        do { _ = try await body(); XCTFail("Expected \(code)") }
        catch let error as ContestLaneError { XCTAssertEqual(error.code, code) }
        catch { XCTFail("Unexpected error: \(error)") }
    }

    private func identityID(_ rule: [String: Any]) -> String? {
        (rule["identity"] as? [String: Any])?["id"] as? String
    }

    private func wireID(_ value: UUID) -> String { value.uuidString.lowercased() }
}

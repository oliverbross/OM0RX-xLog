import Foundation
import XCTest
@testable import XLogPrototypeSupport

final class ContestARRLDXWorkerWireTests: XCTestCase {
    private func wire(_ value: UUID) -> String { value.uuidString.lowercased() }

    private func mutation(sessionID: UUID, requestID: UUID, revision: Int, timestamp: String,
                          payload: [String: Any], draftID: UUID? = nil,
                          generation: String) -> [String: Any] {
        var value: [String: Any] = [
            "sessionID": wire(sessionID), "workspaceGeneration": generation,
            "requestID": wire(requestID), "expectedRevision": revision,
            "payloadDigest": String(repeating: String(format: "%x", revision % 15 + 1), count: 64),
            "operationTimestamp": timestamp, "payload": payload,
        ]
        if let draftID { value["draftID"] = wire(draftID) }
        return value
    }

    private func frame(_ worker: LiveWorker, _ method: String,
                       _ params: [String: Any] = [:]) async throws -> [String: Any] {
        let request = try JSONSerialization.data(withJSONObject: [
            "id": wire(UUID()), "method": method, "params": params,
        ])
        let response = await worker.response(to: request)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: response) as? [String: Any])
    }

    func testARRLDXFourWayLifecycleAuthorityAndGeneratedFixture() async throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("xlog-arrl-dx-worker-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let profile = try AppRuntimeProfile.contestingTestProfile(applicationSupport: root)
        guard case .contestingTest(let supportRoot) = profile else { return XCTFail("Expected contest profile") }
        let logbook = LiveLogbookMethods(supportDirectory: supportRoot,
                                         inheritNativePreferences: false,
                                         runtimeProfile: profile)
        _ = try logbook.handle(method: "workspace_create", params: ["mode": "empty"])
        var worker = LiveWorker(logbook: logbook, runtimeProfile: profile)
        let catalogFrame = try await frame(worker, "contest_catalog")
        let catalog = try XCTUnwrap(catalogFrame["result"] as? [String: Any])
        let generation = try XCTUnwrap(catalog["workspaceGeneration"] as? String)
        let rules = try XCTUnwrap(catalog["rules"] as? [[String: Any]])
        XCTAssertEqual(rules.count, 24)
        XCTAssertEqual(rules.filter { $0["declarativeDefinition"] != nil }.count, 8)

        struct Scenario {
            let key: String, ruleID: String, mode: String, sentReport: String
            let stationCall: String, stationZone: String, stationEntity: String
            let stationField: String, stationRaw: String, stationNormalized: String, section: String
            let firstCall: String, firstField: String, firstRaw: String, firstNormalized: String
            let secondCall: String, secondRaw: String, correctedRaw: String, correctedNormalized: String
        }
        let scenarios = [
            Scenario(key: "cw-wve", ruleID: "arrl-dx-cw", mode: "CW", sentReport: "599",
                     stationCall: "K1AAA", stationZone: "5", stationEntity: "UNITED STATES",
                     stationField: "location", stationRaw: "CA", stationNormalized: "CA", section: "EB",
                     firstCall: "OM0RX", firstField: "power", firstRaw: "1KW", firstNormalized: "1000",
                     secondCall: "DL1AAA", secondRaw: "100WATTS", correctedRaw: "K", correctedNormalized: "1000"),
            Scenario(key: "cw-dx", ruleID: "arrl-dx-cw", mode: "CW", sentReport: "599",
                     stationCall: "OM0RX", stationZone: "15", stationEntity: "SLOVAK REPUBLIC",
                     stationField: "power", stationRaw: "K", stationNormalized: "1000", section: "DX",
                     firstCall: "K1AAA", firstField: "location", firstRaw: "CA", firstNormalized: "CA",
                     secondCall: "K1BBB", secondRaw: "NY", correctedRaw: "NV", correctedNormalized: "NV"),
            Scenario(key: "ssb-wve", ruleID: "arrl-dx-ssb", mode: "SSB", sentReport: "59",
                     stationCall: "K1AAA", stationZone: "5", stationEntity: "UNITED STATES",
                     stationField: "location", stationRaw: "CA", stationNormalized: "CA", section: "EB",
                     firstCall: "OM0RX", firstField: "power", firstRaw: "100WATTS", firstNormalized: "100",
                     secondCall: "DL1AAA", secondRaw: "1KW", correctedRaw: "K", correctedNormalized: "1000"),
            Scenario(key: "ssb-dx", ruleID: "arrl-dx-ssb", mode: "SSB", sentReport: "59",
                     stationCall: "OM0RX", stationZone: "15", stationEntity: "SLOVAK REPUBLIC",
                     stationField: "power", stationRaw: "1KW", stationNormalized: "1000", section: "DX",
                     firstCall: "K1AAA", firstField: "location", firstRaw: "CA", firstNormalized: "CA",
                     secondCall: "K1BBB", secondRaw: "NY", correctedRaw: "NV", correctedNormalized: "NV"),
        ]

        var fixtures: [String: Any] = [:]
        for (index, scenario) in scenarios.enumerated() {
            let rule = try XCTUnwrap(rules.first {
                ($0["identity"] as? [String: Any])?["id"] as? String == scenario.ruleID
            })
            let sessionID = UUID(), draftID = UUID()
            let exchangeFields = scenario.stationField == "location"
                ? ["location": scenario.stationRaw, "power": ""]
                : ["location": "", "power": scenario.stationRaw]
            let createRequest = mutation(sessionID: sessionID, requestID: draftID, revision: 0,
                timestamp: "2026-10-18T21:\(String(format: "%02d", index * 10)):00.000Z",
                payload: [
                    "sessionID": wire(sessionID), "name": "ARRL DX \(scenario.key)",
                    "ruleIdentity": try XCTUnwrap(rule["identity"] as? [String: Any]),
                    "referenceDataVersion": try XCTUnwrap(rule["referenceDataVersion"] as? String),
                    "station": ["callsign": scenario.stationCall, "cqZone": scenario.stationZone,
                                "dxccEntity": scenario.stationEntity, "exchangeFields": exchangeFields,
                                "stationFields": ["section": scenario.section]],
                    "operator": ["callsign": scenario.stationCall, "category": "Single Operator"],
                ], generation: generation)
            let created = try await frame(worker, "contest_create", createRequest)
            XCTAssertEqual(created["ok"] as? Bool, true, "\(scenario.key): \(created)")
            let createdResult = try XCTUnwrap(created["result"] as? [String: Any])
            let capability = try XCTUnwrap((((createdResult["session"] as? [String: Any])?["rule"] as? [String: Any])?["operatorCapability"] as? [String: Any]))
            XCTAssertEqual(capability["policy"] as? String, "simulated-run-sp-v1")
            XCTAssertEqual(capability["output"] as? String, "simulation-only")
            let createdStation = try XCTUnwrap((createdResult["session"] as? [String: Any])?["station"] as? [String: Any])
            XCTAssertEqual(createdStation["exchangeFields"] as? [String: String], exchangeFields)
            XCTAssertEqual(createdStation["stationFields"] as? [String: String], ["section": scenario.section])
            var firstFields = try XCTUnwrap((createdResult["draft"] as? [String: Any])?["fields"] as? [String: Any])
            XCTAssertEqual(firstFields["sentExchange"] as? String, scenario.stationRaw)
            firstFields["callsign"] = scenario.firstCall
            firstFields["receivedExchange"] = scenario.firstRaw
            firstFields["receivedExchangeFields"] = scenario.firstField == "location"
                ? ["location": scenario.firstRaw, "power": ""]
                : ["location": "", "power": scenario.firstRaw]
            firstFields["frequencyHz"] = 14_025_000
            let applyFirstRequest = mutation(sessionID: sessionID, requestID: UUID(), revision: 1,
                timestamp: "2026-10-18T21:\(String(format: "%02d", index * 10 + 1)):00.000Z",
                payload: ["fields": firstFields], draftID: draftID, generation: generation)
            let appliedFirst = try await frame(worker, "contest_draft_apply", applyFirstRequest)
            XCTAssertEqual(appliedFirst["ok"] as? Bool, true, scenario.key)
            let appliedResult = try XCTUnwrap(appliedFirst["result"] as? [String: Any])
            let readiness = try XCTUnwrap((appliedResult["draft"] as? [String: Any])?["operatorReadiness"] as? [String: Any])
            XCTAssertEqual(readiness["capabilityDigest"] as? String, capability["auditDigest"] as? String)
            XCTAssertEqual(readiness["callsign"] as? String, "ready")
            XCTAssertEqual(readiness["exchange"] as? String, "ready")
            XCTAssertEqual(readiness["canSendCall"] as? Bool, true)
            XCTAssertEqual(readiness["canCommit"] as? Bool, true)
            let commitFirstRequest = mutation(sessionID: sessionID, requestID: UUID(), revision: 2,
                timestamp: "2026-10-18T21:\(String(format: "%02d", index * 10 + 2)):00.000Z",
                payload: [:], draftID: draftID, generation: generation)
            let committedFirst = try await frame(worker, "contest_qso_commit", commitFirstRequest)
            XCTAssertEqual(committedFirst["ok"] as? Bool, true, scenario.key)
            let firstResult = try XCTUnwrap(committedFirst["result"] as? [String: Any])
            let firstQSO = try XCTUnwrap(firstResult["qso"] as? [String: Any])
            XCTAssertEqual(firstQSO["sentExchange"] as? String, scenario.stationRaw)

            var secondFields = try XCTUnwrap((firstResult["draft"] as? [String: Any])?["fields"] as? [String: Any])
            XCTAssertEqual(secondFields["sentExchange"] as? String, scenario.stationRaw)
            secondFields["callsign"] = scenario.secondCall
            secondFields["receivedExchange"] = scenario.secondRaw
            secondFields["receivedExchangeFields"] = scenario.firstField == "location"
                ? ["location": scenario.secondRaw, "power": ""]
                : ["location": "", "power": scenario.secondRaw]
            secondFields["frequencyHz"] = 14_026_000
            let applySecondRequest = mutation(sessionID: sessionID, requestID: UUID(), revision: 3,
                timestamp: "2026-10-18T21:\(String(format: "%02d", index * 10 + 3)):00.000Z",
                payload: ["fields": secondFields], draftID: draftID, generation: generation)
            let appliedSecond = try await frame(worker, "contest_draft_apply", applySecondRequest)
            XCTAssertEqual(appliedSecond["ok"] as? Bool, true, scenario.key)
            let commitSecondRequest = mutation(sessionID: sessionID, requestID: UUID(), revision: 4,
                timestamp: "2026-10-18T21:\(String(format: "%02d", index * 10 + 4)):00.000Z",
                payload: [:], draftID: draftID, generation: generation)
            let committedSecond = try await frame(worker, "contest_qso_commit", commitSecondRequest)
            XCTAssertEqual(committedSecond["ok"] as? Bool, true, scenario.key)
            let secondResult = try XCTUnwrap(committedSecond["result"] as? [String: Any])
            let secondQSO = try XCTUnwrap(secondResult["qso"] as? [String: Any])
            let firstQSOID = try XCTUnwrap(firstQSO["qsoID"] as? String)
            let secondQSOID = try XCTUnwrap(secondQSO["qsoID"] as? String)

            worker = LiveWorker(logbook: logbook, runtimeProfile: profile)
            let openRequest: [String: Any] = ["sessionID": wire(sessionID), "workspaceGeneration": generation]
            let reopened = try await frame(worker, "contest_open", openRequest)
            XCTAssertEqual(((reopened["result"] as? [String: Any])?["session"] as? [String: Any])?["qsoCount"] as? Int, 2)
            let replaySecond = try await frame(worker, "contest_qso_commit", commitSecondRequest)
            XCTAssertEqual(replaySecond["ok"] as? Bool, true)
            XCTAssertEqual(
                try JSONSerialization.data(withJSONObject: try XCTUnwrap(replaySecond["result"]), options: .sortedKeys),
                try JSONSerialization.data(withJSONObject: secondResult, options: .sortedKeys)
            )

            let getRequest: [String: Any] = ["sessionID": wire(sessionID), "workspaceGeneration": generation,
                "expectedRevision": 5, "qsoID": firstQSOID]
            let got = try await frame(worker, "contest_qso_get", getRequest)
            var correctedQSO = try XCTUnwrap(((got["result"] as? [String: Any])?["qso"] as? [String: Any]))
            XCTAssertEqual(correctedQSO["sentExchange"] as? String, scenario.stationRaw)
            XCTAssertEqual(correctedQSO["normalizedSentExchange"] as? String, scenario.stationNormalized)
            XCTAssertEqual(correctedQSO["normalizedReceivedExchange"] as? String, scenario.firstNormalized)
            correctedQSO.removeValue(forKey: "entity")
            var forgedQSO = correctedQSO
            forgedQSO["sentExchange"] = "1500"
            forgedQSO["normalizedSentExchange"] = "1500"
            forgedQSO["allocatedSerial"] = "1500"
            forgedQSO["sentExchangeFields"] = ["location": "", "power": "1500"]
            let forgedReason = scenario.stationField == "location"
                ? "Forged W/VE station exchange role"
                : "Changed DX station power"
            let forgedRequest = mutation(sessionID: sessionID, requestID: UUID(), revision: 5,
                timestamp: "2026-10-18T21:\(String(format: "%02d", index * 10 + 5)):00.000Z",
                payload: ["qso": forgedQSO, "reason": forgedReason], generation: generation)
            let forged = try await frame(worker, "contest_qso_correct", forgedRequest)
            XCTAssertEqual(forged["ok"] as? Bool, false, scenario.key)
            let forgedError = try XCTUnwrap(forged["error"] as? [String: Any])
            XCTAssertEqual(forgedError["code"] as? String, "immutable_qso", scenario.key)
            XCTAssertEqual(forgedError["message"] as? String,
                           "The correction changed immutable field allocatedSentSerial.", scenario.key)
            XCTAssertEqual(forgedError["outcome"] as? String, "confirmed", scenario.key)
            let afterForged = try await frame(worker, "contest_open", openRequest)
            XCTAssertEqual(((afterForged["result"] as? [String: Any])?["session"] as? [String: Any])?["revision"] as? Int, 5)
            let gotAfterForged = try await frame(worker, "contest_qso_get", getRequest)
            XCTAssertEqual(
                try JSONSerialization.data(withJSONObject: try XCTUnwrap(gotAfterForged["result"]), options: .sortedKeys),
                try JSONSerialization.data(withJSONObject: try XCTUnwrap(got["result"]), options: .sortedKeys),
                scenario.key
            )
            let forgedReceipt = try await frame(worker, "contest_operation_receipt", [
                "sessionID": wire(sessionID), "workspaceGeneration": generation,
                "requestID": try XCTUnwrap(forgedRequest["requestID"] as? String),
                "payloadDigest": try XCTUnwrap(forgedRequest["payloadDigest"] as? String),
            ])
            XCTAssertEqual((forgedReceipt["result"] as? [String: Any])?["status"] as? String,
                           "not_found", scenario.key)

            correctedQSO["receivedExchange"] = scenario.correctedRaw
            correctedQSO["normalizedReceivedExchange"] = scenario.correctedNormalized
            correctedQSO["receivedExchangeFields"] = scenario.firstField == "location"
                ? ["location": scenario.correctedRaw, "power": ""]
                : ["location": "", "power": scenario.correctedRaw]
            let correctionRequest = mutation(sessionID: sessionID, requestID: UUID(), revision: 5,
                timestamp: "2026-10-18T21:\(String(format: "%02d", index * 10 + 6)):00.000Z",
                payload: ["qso": correctedQSO, "reason": "Correct received exchange"], generation: generation)
            let corrected = try await frame(worker, "contest_qso_correct", correctionRequest)
            XCTAssertEqual(corrected["ok"] as? Bool, true, scenario.key)

            var exports: [String: Any] = [:]
            for format in ["cabrillo", "adif"] {
                let exportID = UUID()
                let prepare: [String: Any] = ["exportID": wire(exportID), "sessionID": wire(sessionID),
                    "workspaceGeneration": generation, "expectedRevision": 6,
                    "generatedAtUTC": "2026-10-18T22:00:00.000Z", "format": format,
                    "header": ["callsign": scenario.stationCall, "categoryOperator": "SINGLE-OP",
                        "categoryAssisted": "NON-ASSISTED", "categoryBand": "ALL",
                        "categoryMode": scenario.mode, "categoryTransmitter": "ONE", "categoryPower": "LOW",
                        "operators": [scenario.stationCall], "location": scenario.section,
                        "name": "Operator", "addressLines": [], "email": ""]]
                let prepared = try await frame(worker, "contest_export_prepare", prepare)
                XCTAssertEqual(prepared["ok"] as? Bool, true, "\(scenario.key) \(format)")
                let length = try XCTUnwrap((((prepared["result"] as? [String: Any])?["byteLength"] as? NSNumber)?.intValue))
                let read: [String: Any] = ["exportID": wire(exportID), "sessionID": wire(sessionID),
                    "workspaceGeneration": generation, "offset": 0, "length": length]
                let chunk = try await frame(worker, "contest_export_read", read)
                exports[format] = ["prepareRequest": prepare, "prepareResponse": prepared,
                                   "readRequest": read, "readResponse": chunk]
            }

            let deletionRequest = mutation(sessionID: sessionID, requestID: UUID(), revision: 6,
                timestamp: "2026-10-18T21:\(String(format: "%02d", index * 10 + 7)):00.000Z",
                payload: ["qsoID": secondQSOID, "reason": "Remove second contact"], generation: generation)
            let deleted = try await frame(worker, "contest_qso_delete", deletionRequest)
            XCTAssertEqual(((deleted["result"] as? [String: Any])?["qsoCount"] as? Int), 1)
            fixtures[scenario.key] = [
                "create": ["request": createRequest, "response": created],
                "applyFirst": ["request": applyFirstRequest, "response": appliedFirst],
                "commitFirst": ["request": commitFirstRequest, "response": committedFirst],
                "applySecond": ["request": applySecondRequest, "response": appliedSecond],
                "commitSecond": ["request": commitSecondRequest, "response": committedSecond],
                "openAfterRestart": ["request": openRequest, "response": reopened],
                "replaySecondCommit": ["request": commitSecondRequest, "response": replaySecond],
                "get": ["request": getRequest, "response": got],
                "forgedCorrection": ["request": forgedRequest, "response": forged],
                "correct": ["request": correctionRequest, "response": corrected],
                "exports": exports,
                "delete": ["request": deletionRequest, "response": deleted],
            ]
        }

        if let output = ProcessInfo.processInfo.environment["XLOG_ARRL_DX_FIXTURE_OUTPUT"] {
            let fixture: [String: Any] = ["schemaVersion": 1, "catalog": catalogFrame, "scenarios": fixtures]
            let url = URL(fileURLWithPath: output)
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(),
                                                    withIntermediateDirectories: true)
            try JSONSerialization.data(withJSONObject: fixture, options: [.prettyPrinted, .sortedKeys])
                .write(to: url, options: .atomic)
        }
    }
}

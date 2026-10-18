import Foundation
import XCTest
@testable import XLogPrototypeSupport

final class ContestJIDXWorkerWireTests: XCTestCase {
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
        let request = try JSONSerialization.data(withJSONObject: ["id": wire(UUID()), "method": method, "params": params])
        let response = await worker.response(to: request)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: response) as? [String: Any])
    }

    func testJIDXWorkerLifecycleAuthorityRestartAndGeneratedFixture() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-jidx-worker-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let profile = try AppRuntimeProfile.contestingTestProfile(applicationSupport: root)
        guard case .contestingTest(let supportRoot) = profile else { return XCTFail("Expected contest profile") }
        let logbook = LiveLogbookMethods(supportDirectory: supportRoot, inheritNativePreferences: false, runtimeProfile: profile)
        _ = try logbook.handle(method: "workspace_create", params: ["mode": "empty"])
        var worker = LiveWorker(logbook: logbook, runtimeProfile: profile)
        let catalogFrame = try await frame(worker, "contest_catalog")
        let catalog = try XCTUnwrap(catalogFrame["result"] as? [String: Any])
        let generation = try XCTUnwrap(catalog["workspaceGeneration"] as? String)
        let rules = try XCTUnwrap(catalog["rules"] as? [[String: Any]])
        XCTAssertEqual(rules.count, 26)
        XCTAssertEqual(rules.filter { $0["declarativeDefinition"] != nil }.count, 8)
        let cw = try XCTUnwrap(rules.first { ($0["identity"] as? [String: Any])?["id"] as? String == "jidx-cw" })
        let ssb = try XCTUnwrap(rules.first { ($0["identity"] as? [String: Any])?["id"] as? String == "jidx-ssb" })

        func create(_ rule: [String: Any], sessionID: UUID, draftID: UUID, name: String,
                    call: String, zone: String, entity: String, number: String,
                    category: String = "Single Operator") async throws -> ([String: Any], [String: Any]) {
            let params = mutation(sessionID: sessionID, requestID: draftID, revision: 0,
                timestamp: "2026-10-18T20:00:00.000Z", payload: [
                    "sessionID": wire(sessionID), "name": name,
                    "ruleIdentity": try XCTUnwrap(rule["identity"] as? [String: Any]),
                    "referenceDataVersion": try XCTUnwrap(rule["referenceDataVersion"] as? String),
                    "station": ["callsign": call, "cqZone": zone, "dxccEntity": entity,
                                "exchangeFields": ["number": number]],
                    "operator": ["callsign": call, "category": category],
                ], generation: generation)
            return (params, try await frame(worker, "contest_create", params))
        }

        let dxSession = UUID(), dxDraft = UUID()
        let (dxCreateRequest, dxCreate) = try await create(cw, sessionID: dxSession, draftID: dxDraft,
            name: "JIDX CW DX", call: "OM0RX", zone: "15", entity: "SLOVAK REPUBLIC", number: "15")
        XCTAssertEqual(dxCreate["ok"] as? Bool, true)
        let dxCreatedResult = try XCTUnwrap(dxCreate["result"] as? [String: Any])
        let dxCapability = try XCTUnwrap((((dxCreatedResult["session"] as? [String: Any])?["rule"] as? [String: Any])?["operatorCapability"] as? [String: Any]))
        XCTAssertEqual(dxCapability["policy"] as? String, "simulated-run-sp-v1")
        XCTAssertEqual(dxCapability["output"] as? String, "simulation-only")
        let jaSession = UUID(), jaDraft = UUID()
        let (jaCreateRequest, jaCreate) = try await create(ssb, sessionID: jaSession, draftID: jaDraft,
            name: "JIDX Phone JA", call: "JA1AAA", zone: "25", entity: "JAPAN", number: "13")
        XCTAssertEqual(jaCreate["ok"] as? Bool, true)
        let mmSession = UUID(), mmDraft = UUID()
        let (mmCreateRequest, mmCreate) = try await create(cw, sessionID: mmSession, draftID: mmDraft,
            name: "JIDX CW MM", call: "OM0RX/MM", zone: "3", entity: "", number: "3")
        let mmResult = try XCTUnwrap(mmCreate["result"] as? [String: Any])
        let mmStation = try XCTUnwrap((mmResult["session"] as? [String: Any])?["station"] as? [String: Any])
        XCTAssertEqual(mmStation["cqZone"] as? String, "03")
        XCTAssertEqual(mmStation["dxccEntity"] as? String, "")
        XCTAssertEqual((mmStation["exchangeFields"] as? [String: String])?["number"], "3")
        let mmInitialFields = try XCTUnwrap((mmResult["draft"] as? [String: Any])?["fields"] as? [String: Any])
        XCTAssertEqual(mmInitialFields["sentExchange"] as? String, "3")
        XCTAssertEqual((mmInitialFields["sentExchangeFields"] as? [String: String])?["number"], "3")

        var mmFirstFields = mmInitialFields
        mmFirstFields["callsign"] = "JA1AAA"
        mmFirstFields["receivedExchange"] = "3"
        mmFirstFields["receivedExchangeFields"] = ["number": "3"]
        mmFirstFields["frequencyHz"] = 14_025_000
        let mmApplyFirstRequest = mutation(sessionID: mmSession, requestID: UUID(), revision: 1,
            timestamp: "2026-10-18T20:10:00.000Z", payload: ["fields": mmFirstFields],
            draftID: mmDraft, generation: generation)
        let mmAppliedFirst = try await frame(worker, "contest_draft_apply", mmApplyFirstRequest)
        XCTAssertEqual(mmAppliedFirst["ok"] as? Bool, true)
        let mmCommitFirstRequest = mutation(sessionID: mmSession, requestID: UUID(), revision: 2,
            timestamp: "2026-10-18T20:11:00.000Z", payload: [:], draftID: mmDraft,
            generation: generation)
        let mmCommittedFirst = try await frame(worker, "contest_qso_commit", mmCommitFirstRequest)
        let mmFirstResult = try XCTUnwrap(mmCommittedFirst["result"] as? [String: Any])
        let mmFirstQSO = try XCTUnwrap(mmFirstResult["qso"] as? [String: Any])
        XCTAssertEqual(mmFirstQSO["sentExchange"] as? String, "3")
        XCTAssertEqual(mmFirstQSO["receivedExchange"] as? String, "3")
        let mmResetFields = try XCTUnwrap((mmFirstResult["draft"] as? [String: Any])?["fields"] as? [String: Any])
        XCTAssertEqual(mmResetFields["sentExchange"] as? String, "3")
        XCTAssertEqual((mmResetFields["sentExchangeFields"] as? [String: String])?["number"], "3")

        var mmSecondFields = mmResetFields
        mmSecondFields["callsign"] = "JA1BBB"
        mmSecondFields["receivedExchange"] = "4"
        mmSecondFields["receivedExchangeFields"] = ["number": "4"]
        mmSecondFields["frequencyHz"] = 14_026_000
        let mmApplySecondRequest = mutation(sessionID: mmSession, requestID: UUID(), revision: 3,
            timestamp: "2026-10-18T20:12:00.000Z", payload: ["fields": mmSecondFields],
            draftID: mmDraft, generation: generation)
        let mmAppliedSecond = try await frame(worker, "contest_draft_apply", mmApplySecondRequest)
        XCTAssertEqual(mmAppliedSecond["ok"] as? Bool, true)
        let mmCommitSecondRequest = mutation(sessionID: mmSession, requestID: UUID(), revision: 4,
            timestamp: "2026-10-18T20:13:00.000Z", payload: [:], draftID: mmDraft,
            generation: generation)
        let mmCommittedSecond = try await frame(worker, "contest_qso_commit", mmCommitSecondRequest)
        let mmSecondResult = try XCTUnwrap(mmCommittedSecond["result"] as? [String: Any])
        let mmSecondQSO = try XCTUnwrap(mmSecondResult["qso"] as? [String: Any])
        XCTAssertEqual(mmSecondQSO["sentExchange"] as? String, "3")
        XCTAssertEqual(mmSecondQSO["receivedExchange"] as? String, "4")
        let mmSecondQSOID = try XCTUnwrap(mmSecondQSO["qsoID"] as? String)

        worker = LiveWorker(logbook: logbook, runtimeProfile: profile)
        let mmOpenRequest: [String: Any] = ["sessionID": wire(mmSession), "workspaceGeneration": generation]
        let mmReopened = try await frame(worker, "contest_open", mmOpenRequest)
        XCTAssertEqual(((mmReopened["result"] as? [String: Any])?["session"] as? [String: Any])?["qsoCount"] as? Int, 2)
        let mmReplaySecond = try await frame(worker, "contest_qso_commit", mmCommitSecondRequest)
        XCTAssertEqual(((mmReplaySecond["result"] as? [String: Any])?["receipt"] as? [String: Any])?["committedRevision"] as? Int, 5)
        let mmGetRequest: [String: Any] = ["sessionID": wire(mmSession), "workspaceGeneration": generation,
            "expectedRevision": 5, "qsoID": mmSecondQSOID]
        let mmGot = try await frame(worker, "contest_qso_get", mmGetRequest)
        var mmCorrectedQSO = try XCTUnwrap(((mmGot["result"] as? [String: Any])?["qso"] as? [String: Any]))
        XCTAssertEqual(mmCorrectedQSO["sentExchange"] as? String, "3")
        XCTAssertEqual(mmCorrectedQSO["normalizedSentExchange"] as? String, "03")
        XCTAssertEqual(mmCorrectedQSO["receivedExchange"] as? String, "4")
        XCTAssertEqual(mmCorrectedQSO["normalizedReceivedExchange"] as? String, "04")
        mmCorrectedQSO.removeValue(forKey: "entity")
        mmCorrectedQSO["receivedExchange"] = "5"
        mmCorrectedQSO["normalizedReceivedExchange"] = "05"
        mmCorrectedQSO["receivedExchangeFields"] = ["number": "5"]
        let mmCorrectionRequest = mutation(sessionID: mmSession, requestID: UUID(), revision: 5,
            timestamp: "2026-10-18T20:14:00.000Z", payload: ["qso": mmCorrectedQSO, "reason": "Correct prefecture"],
            generation: generation)
        let mmCorrected = try await frame(worker, "contest_qso_correct", mmCorrectionRequest)
        XCTAssertEqual(mmCorrected["ok"] as? Bool, true)
        let mmCurrent = try XCTUnwrap((mmCorrected["result"] as? [String: Any])?["currentTarget"] as? [String: Any])
        XCTAssertEqual(mmCurrent["receivedExchange"] as? String, "5")
        XCTAssertEqual(mmCurrent["normalizedReceivedExchange"] as? String, "05")

        var mmExports: [String: Any] = [:]
        for format in ["cabrillo", "adif"] {
            let exportID = UUID()
            let prepare: [String: Any] = ["exportID": wire(exportID), "sessionID": wire(mmSession),
                "workspaceGeneration": generation, "expectedRevision": 6,
                "generatedAtUTC": "2026-10-18T20:15:00.000Z", "format": format,
                "header": ["callsign": "OM0RX/MM", "categoryOperator": "SINGLE-OP", "categoryAssisted": "NON-ASSISTED",
                    "categoryBand": "ALL", "categoryMode": "CW", "categoryTransmitter": "ONE", "categoryPower": "LOW",
                    "operators": ["OM0RX/MM"], "location": "DX", "name": "Operator", "addressLines": [], "email": ""]]
            let prepared = try await frame(worker, "contest_export_prepare", prepare)
            let length = try XCTUnwrap((((prepared["result"] as? [String: Any])?["byteLength"] as? NSNumber)?.intValue))
            let read: [String: Any] = ["exportID": wire(exportID), "sessionID": wire(mmSession),
                "workspaceGeneration": generation, "offset": 0, "length": length]
            let chunk = try await frame(worker, "contest_export_read", read)
            mmExports[format] = ["prepareRequest": prepare, "prepareResponse": prepared,
                                 "readRequest": read, "readResponse": chunk]
        }

        var rejected: [String: Any] = [:]
        for candidate in [
            ("JIDX land nil", "OM0RX", "15", "", "15"),
            ("JIDX MM entity", "OM0RX/MM", "15", "SLOVAK REPUBLIC", "15"),
            ("JIDX crossed MM", "OM0RX/MM", "15", "", "03"),
            ("JIDX malformed", "OM0RX", "15", "SLOVAK REPUBLIC", "A"),
        ] {
            let (_, response) = try await create(cw, sessionID: UUID(), draftID: UUID(), name: candidate.0,
                call: candidate.1, zone: candidate.2, entity: candidate.3, number: candidate.4)
            XCTAssertEqual(response["ok"] as? Bool, false)
            rejected[candidate.0] = response
        }

        let fields: [String: Any] = [
            "callsign": "JA1AAA", "sentReport": "599", "sentExchange": "15",
            "receivedReport": "599", "receivedExchange": "13", "frequencyHz": 14_025_000,
            "band": "20m", "mode": "CW", "sentExchangeFields": ["number": "15"],
            "receivedExchangeFields": ["number": "13"],
        ]
        let applyRequest = mutation(sessionID: dxSession, requestID: UUID(), revision: 1,
            timestamp: "2026-10-18T20:01:00.000Z", payload: ["fields": fields],
            draftID: dxDraft, generation: generation)
        let applied = try await frame(worker, "contest_draft_apply", applyRequest)
        XCTAssertEqual(applied["ok"] as? Bool, true)
        let appliedResult = try XCTUnwrap(applied["result"] as? [String: Any])
        let appliedReadiness = try XCTUnwrap((appliedResult["draft"] as? [String: Any])?["operatorReadiness"] as? [String: Any])
        XCTAssertEqual(appliedReadiness["capabilityDigest"] as? String, dxCapability["auditDigest"] as? String)
        XCTAssertEqual(appliedReadiness["callsign"] as? String, "ready")
        XCTAssertEqual(appliedReadiness["exchange"] as? String, "ready")
        XCTAssertEqual(appliedReadiness["canSendCall"] as? Bool, true)
        XCTAssertEqual(appliedReadiness["canCommit"] as? Bool, true)
        let commitRequest = mutation(sessionID: dxSession, requestID: UUID(), revision: 2,
            timestamp: "2026-10-18T20:02:00.000Z", payload: [:], draftID: dxDraft,
            generation: generation)
        let committed = try await frame(worker, "contest_qso_commit", commitRequest)
        let committedResult = try XCTUnwrap(committed["result"] as? [String: Any])
        XCTAssertEqual(((committedResult["score"] as? [String: Any])?["claimedScore"] as? NSNumber)?.intValue, 1)
        let qsoID = try XCTUnwrap((committedResult["qso"] as? [String: Any])?["qsoID"] as? String)

        worker = LiveWorker(logbook: logbook, runtimeProfile: profile)
        let openRequest: [String: Any] = ["sessionID": wire(dxSession), "workspaceGeneration": generation]
        let reopened = try await frame(worker, "contest_open", openRequest)
        XCTAssertEqual(((reopened["result"] as? [String: Any])?["session"] as? [String: Any])?["qsoCount"] as? Int, 1)
        let getRequest: [String: Any] = ["sessionID": wire(dxSession), "workspaceGeneration": generation,
            "expectedRevision": 3, "qsoID": qsoID]
        let got = try await frame(worker, "contest_qso_get", getRequest)
        var correctedQSO = try XCTUnwrap(((got["result"] as? [String: Any])?["qso"] as? [String: Any]))
        correctedQSO.removeValue(forKey: "entity")
        correctedQSO["receivedExchange"] = "14"
        correctedQSO["normalizedReceivedExchange"] = "14"
        correctedQSO["receivedExchangeFields"] = ["number": "14"]
        let correctionRequest = mutation(sessionID: dxSession, requestID: UUID(), revision: 3,
            timestamp: "2026-10-18T20:03:00.000Z", payload: ["qso": correctedQSO, "reason": "Correct prefecture"],
            generation: generation)
        let corrected = try await frame(worker, "contest_qso_correct", correctionRequest)
        XCTAssertEqual(corrected["ok"] as? Bool, true)

        var exports: [String: Any] = [:]
        for format in ["cabrillo", "adif"] {
            let exportID = UUID()
            let prepare: [String: Any] = ["exportID": wire(exportID), "sessionID": wire(dxSession),
                "workspaceGeneration": generation, "expectedRevision": 4,
                "generatedAtUTC": "2026-10-18T20:04:00.000Z", "format": format,
                "header": ["callsign": "OM0RX", "categoryOperator": "SINGLE-OP", "categoryAssisted": "NON-ASSISTED",
                    "categoryBand": "ALL", "categoryMode": "CW", "categoryTransmitter": "ONE", "categoryPower": "LOW",
                    "operators": ["OM0RX"], "location": "DX", "name": "Operator", "addressLines": [], "email": ""]]
            let prepared = try await frame(worker, "contest_export_prepare", prepare)
            let length = try XCTUnwrap((((prepared["result"] as? [String: Any])?["byteLength"] as? NSNumber)?.intValue))
            let read: [String: Any] = ["exportID": wire(exportID), "sessionID": wire(dxSession),
                "workspaceGeneration": generation, "offset": 0, "length": length]
            let chunk = try await frame(worker, "contest_export_read", read)
            exports[format] = ["prepareRequest": prepare, "prepareResponse": prepared,
                               "readRequest": read, "readResponse": chunk]
        }

        let deletionRequest = mutation(sessionID: dxSession, requestID: UUID(), revision: 4,
            timestamp: "2026-10-18T20:05:00.000Z", payload: ["qsoID": qsoID, "reason": "Remove contact"],
            generation: generation)
        let deleted = try await frame(worker, "contest_qso_delete", deletionRequest)
        XCTAssertEqual(((deleted["result"] as? [String: Any])?["qsoCount"] as? Int), 0)

        let multiSession = UUID(), multiDraft = UUID()
        let (_, multiCreated) = try await create(cw, sessionID: multiSession, draftID: multiDraft,
            name: "JIDX unsupported category", call: "OM0RX", zone: "15", entity: "SLOVAK REPUBLIC",
            number: "15", category: "Multi Operator")
        let unsupportedPrepare: [String: Any] = ["exportID": wire(UUID()), "sessionID": wire(multiSession),
            "workspaceGeneration": generation, "expectedRevision": 1,
            "generatedAtUTC": "2026-10-18T20:06:00.000Z", "format": "cabrillo",
            "header": ["callsign": "OM0RX", "categoryOperator": "MULTI-OP", "categoryAssisted": "NON-ASSISTED",
                "categoryBand": "ALL", "categoryMode": "CW", "categoryTransmitter": "ONE", "categoryPower": "LOW",
                "operators": ["OM0RX"], "location": "DX", "name": "Operator", "addressLines": [], "email": ""]]
        let unsupported = try await frame(worker, "contest_export_prepare", unsupportedPrepare)
        XCTAssertEqual(unsupported["ok"] as? Bool, false)
        let unsupportedError = try XCTUnwrap(unsupported["error"] as? [String: Any])
        XCTAssertEqual(unsupportedError["code"] as? String, "unsupported_category")
        XCTAssertTrue(try XCTUnwrap(unsupportedError["message"] as? String).localizedCaseInsensitiveContains("multi operator"))
        XCTAssertEqual(multiCreated["ok"] as? Bool, true)

        if let output = ProcessInfo.processInfo.environment["XLOG_JIDX_FIXTURE_OUTPUT"] {
            let fixture: [String: Any] = ["schemaVersion": 1, "catalog": catalogFrame,
                "creates": ["dx": ["request": dxCreateRequest, "response": dxCreate],
                            "ja": ["request": jaCreateRequest, "response": jaCreate],
                            "mm": ["request": mmCreateRequest, "response": mmCreate]],
                "rejectedCreates": rejected,
                "lifecycle": ["apply": ["request": applyRequest, "response": applied],
                              "commit": ["request": commitRequest, "response": committed],
                              "openAfterRestart": ["request": openRequest, "response": reopened],
                              "get": ["request": getRequest, "response": got],
                              "correct": ["request": correctionRequest, "response": corrected],
                              "delete": ["request": deletionRequest, "response": deleted]],
                "singleDigitLifecycle": [
                    "applyFirst": ["request": mmApplyFirstRequest, "response": mmAppliedFirst],
                    "commitFirst": ["request": mmCommitFirstRequest, "response": mmCommittedFirst],
                    "applySecond": ["request": mmApplySecondRequest, "response": mmAppliedSecond],
                    "commitSecond": ["request": mmCommitSecondRequest, "response": mmCommittedSecond],
                    "openAfterRestart": ["request": mmOpenRequest, "response": mmReopened],
                    "replaySecondCommit": ["request": mmCommitSecondRequest, "response": mmReplaySecond],
                    "get": ["request": mmGetRequest, "response": mmGot],
                    "correct": ["request": mmCorrectionRequest, "response": mmCorrected]],
                "exports": exports, "singleDigitExports": mmExports,
                "unsupportedExport": ["request": unsupportedPrepare, "response": unsupported]]
            let url = URL(fileURLWithPath: output)
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try JSONSerialization.data(withJSONObject: fixture, options: [.prettyPrinted, .sortedKeys]).write(to: url, options: .atomic)
        }
    }
}

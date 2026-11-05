import Foundation
import XCTest
@testable import XLogPrototypeSupport
#if canImport(XLogCore)
@testable import XLogCore
#else
@testable import XLogPortableCore
#endif

final class FirstDraftStationDefaultsTests: XCTestCase {
    private struct Fixture {
        let root: URL
        let service: LiveLogbookMethods
        let worker: LiveWorker
    }

    private func fixture(at existingRoot: URL? = nil) throws -> Fixture {
        let temporary = URL(fileURLWithPath: try AppRuntimeProfile.canonicalFilesystemPath(FileManager.default.temporaryDirectory), isDirectory: true)
        let root = existingRoot ?? temporary.appendingPathComponent("xlog-first-draft-quality-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true, attributes: LocalFilePermissions.directoryAttributes)
        let profile = AppRuntimeProfile.contestingTest(supportRoot: root)
        let service = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false, runtimeProfile: profile)
        let worker = LiveWorker(logbook: service, runtimeProfile: profile)
        addTeardownBlock {
            _ = await worker.shutdown()
            (try? service.openedDatabase())?.close()
            if let workspace = try? IntegrationWorkspaceBootstrap.open(at: service.workspaceDirectoryURL,
                expectedIdentityPrefix: AppRuntimeProfile.contestingIdentityPrefix) {
                UserDefaults.standard.removePersistentDomain(forName: workspace.defaultsSuiteName)
            }
            try? FileManager.default.removeItem(at: root)
        }
        return Fixture(root: root, service: service, worker: worker)
    }

    private func call(_ f: Fixture, _ method: String, _ params: [String: Any] = [:]) async throws -> [String: Any] {
        let frame = try JSONSerialization.data(withJSONObject: ["id": UUID().uuidString, "method": method,
            "params": params, "operatingModule": "normal_logging"])
        let data = await f.worker.response(to: frame)
        let reply = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(reply["ok"] as? Bool, true, String(describing: reply["error"]))
        return try XCTUnwrap(reply["result"] as? [String: Any])
    }

    private func settingsMutation(_ f: Fixture, completed: Bool, call: String = "K1TEST/P") async throws -> [String: Any] {
        let loaded = try await self.call(f, "settings_load")
        var settings = try XCTUnwrap(loaded["settings"] as? [String: Any])
        settings["operatorCall"] = "K1TEST"; settings["stationCall"] = call
        settings["gridSquare"] = "FN31PR"; settings["stationLocation"] = "Generated private fixture"
        settings["defaultPower"] = "25"; settings["defaultRadio"] = "Fixture radio"
        settings["onboardingCompleted"] = completed
        return ["operationID": UUID().uuidString, "expectedRevision": loaded["revision"]!,
            "generation": loaded["generation"]!, "settings": settings]
    }

    private func assertStation(_ qso: QSO, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertEqual(qso.operatorCall, "K1TEST", file: file, line: line)
        XCTAssertEqual(qso.myCall, "K1TEST/P", file: file, line: line)
        XCTAssertEqual(qso.myGrid, "FN31PR", file: file, line: line)
        XCTAssertEqual(qso.stationLocation, "Generated private fixture", file: file, line: line)
        XCTAssertEqual(qso.radio, "Fixture radio", file: file, line: line)
        XCTAssertEqual(qso.txPower, "25", file: file, line: line)
    }

    private func saveContact(_ f: Fixture, call: String) async throws {
        let loaded = try await self.call(f, "logbook_operator_draft")
        let draft = try XCTUnwrap(loaded["draft"] as? [String: Any])
        var qso = try XCTUnwrap(draft["qso"] as? [String: Any])
        qso["call"] = call; qso["frequencyHz"] = 14_250_000
        let changed = try await self.call(f, "logbook_operator_draft_apply", ["operationID": UUID().uuidString,
            "generation": draft["generation"]!, "draftID": qso["id"]!, "expectedRevision": draft["revision"]!, "action": "replace", "qso": qso])
        let receipt = try XCTUnwrap(changed["receipt"] as? [String: Any])
        let current = try XCTUnwrap(receipt["draft"] as? [String: Any])
        _ = try await self.call(f, "logbook_operator_draft_apply", ["operationID": UUID().uuidString,
            "generation": draft["generation"]!, "draftID": qso["id"]!, "expectedRevision": current["revision"]!, "action": "save"])
    }

    func testFreshSetupFirstAndSubsequentContactsCaptureDefaultsAndExport() async throws {
        let f = try fixture()
        _ = try await call(f, "workspace_create", ["mode": "empty", "onboarding": true])
        _ = try await call(f, "settings_save", settingsMutation(f, completed: false))
        _ = try await call(f, "settings_save", settingsMutation(f, completed: true))
        assertStation(try XCTUnwrap(f.service.openedDatabase().operatorDraft()).qso)
        try await saveContact(f, call: "K1FIRST")
        try await saveContact(f, call: "K1SECOND")
        let contacts = try f.service.openedDatabase().fetchAll()
        XCTAssertEqual(contacts.count, 2)
        contacts.forEach { assertStation($0) }
        let export = try await call(f, "logbook_export_adif", ["action": "begin", "scope": "all"])
        let read = try await call(f, "logbook_export_adif", ["action": "read", "token": export["token"]!])
        let records = ADIFParser().records(in: try XCTUnwrap(read["text"] as? String))
        XCTAssertEqual(records.count, 2)
        for record in records {
            XCTAssertEqual(record["OPERATOR"], "K1TEST")
            XCTAssertEqual(record["STATION_CALLSIGN"], "K1TEST/P")
            XCTAssertEqual(record["MY_GRIDSQUARE"], "FN31PR")
            XCTAssertEqual(record["TX_PWR"], "25")
        }
    }

    func testResumedUntouchedSeedRefreshIsFencedAndCompletionReplayDoesNotRetag() async throws {
        let initial = try fixture()
        _ = try await call(initial, "workspace_create", ["mode": "empty", "onboarding": true])
        let loaded = try await call(initial, "logbook_operator_draft") // An incomplete-workspace startup reload.
        let oldWire = try XCTUnwrap((loaded["draft"] as? [String: Any])?["qso"] as? [String: Any])
        let old = try XCTUnwrap(initial.service.openedDatabase().operatorDraft())
        _ = await initial.worker.shutdown(); try initial.service.openedDatabase().close()
        let f = try fixture(at: initial.root)
        let completion = try await settingsMutation(f, completed: true)
        _ = try await call(f, "settings_save", completion)
        let refreshed = try XCTUnwrap(f.service.openedDatabase().operatorDraft())
        assertStation(refreshed.qso)
        XCTAssertEqual(refreshed.qso.id, old.qso.id)
        XCTAssertEqual(refreshed.qso.start, old.qso.start)
        XCTAssertEqual(refreshed.revision, old.revision + 1)
        _ = try await call(f, "settings_save", completion)
        XCTAssertEqual(try f.service.openedDatabase().operatorDraft(), refreshed)
        let stale = try await call(f, "logbook_operator_draft_apply", ["operationID": UUID().uuidString,
            "generation": completion["generation"]!, "draftID": old.qso.id.uuidString,
            "expectedRevision": old.revision, "action": "replace", "qso": oldWire])
        XCTAssertEqual(stale["status"] as? String, "conflict")
        _ = try await call(f, "settings_save", settingsMutation(f, completed: true, call: "K2LATER"))
        XCTAssertEqual(try f.service.openedDatabase().operatorDraft(), refreshed)
        try await saveContact(f, call: "K1RESUMED")
        assertStation(try XCTUnwrap(f.service.openedDatabase().fetchAll().first))
        XCTAssertEqual(try f.service.openedDatabase().operatorDraft()?.qso.myCall, "K2LATER")
        let export = try await call(f, "logbook_export_adif", ["action": "begin", "scope": "all"])
        let read = try await call(f, "logbook_export_adif", ["action": "read", "token": export["token"]!])
        let record = try XCTUnwrap(ADIFParser().records(in: XCTUnwrap(read["text"] as? String)).first)
        XCTAssertEqual(record["STATION_CALLSIGN"], "K1TEST/P")
        XCTAssertEqual(record["OPERATOR"], "K1TEST")
        XCTAssertEqual(record["MY_GRIDSQUARE"], "FN31PR")
        XCTAssertEqual(record["TX_PWR"], "25")
    }

    func testCompletionPreservesPopulatedAndExplicitlyAuthoredEmptyDrafts() async throws {
        for populated in [false, true] {
            let f = try fixture()
            _ = try await call(f, "workspace_create", ["mode": "empty", "onboarding": true])
            let loaded = try await call(f, "logbook_operator_draft")
            let draft = try XCTUnwrap(loaded["draft"] as? [String: Any])
            var qso = try XCTUnwrap(draft["qso"] as? [String: Any])
            qso["call"] = populated ? "K1RETAIN" : ""
            qso["comment"] = populated ? "Typed before completing setup" : ""
            qso["myCall"] = ""; qso["myGrid"] = ""; qso["operatorCall"] = ""; qso["stationLocation"] = ""
            _ = try await call(f, "logbook_operator_draft_apply", ["operationID": UUID().uuidString,
                "generation": draft["generation"]!, "draftID": qso["id"]!, "expectedRevision": draft["revision"]!, "action": "replace", "qso": qso])
            let retained = try XCTUnwrap(f.service.openedDatabase().operatorDraft())
            XCTAssertFalse(retained.operatingDefaultsMutable)
            _ = try await call(f, "settings_save", settingsMutation(f, completed: true))
            XCTAssertEqual(try f.service.openedDatabase().operatorDraft(), retained)
        }
    }

    func testCompletionPreservesExplicitManualAndCapturedPower() async throws {
        for captured in [false, true] {
            let f = try fixture()
            _ = try await call(f, "workspace_create", ["mode": "empty", "onboarding": true])
            var partial = try await settingsMutation(f, completed: false)
            var settings = try XCTUnwrap(partial["settings"] as? [String: Any])
            settings["automaticTransmitPower"] = true; partial["settings"] = settings
            _ = try await call(f, "settings_save", partial)
            let loaded = try await call(f, "logbook_operator_draft")
            let wire = try XCTUnwrap(loaded["draft"] as? [String: Any])
            var qso = try XCTUnwrap(wire["qso"] as? [String: Any])
            qso["call"] = captured ? "K1CAPTURE" : ""
            qso["frequencyHz"] = 14_250_000
            _ = try await call(f, "logbook_operator_draft_apply", ["operationID": UUID().uuidString,
                "generation": wire["generation"]!, "draftID": qso["id"]!, "expectedRevision": wire["revision"]!,
                "action": "replace", "qso": qso,
                "powerIntent": captured ? ["action": "automatic"] : ["action": "manual", "value": "73"]])
            let db = try f.service.openedDatabase()
            if captured {
                let current = try XCTUnwrap(db.operatorDraft())
                let now = Date(), workspace = try XCTUnwrap(UUID(uuidString: wire["generation"] as! String))
                let context = OperatorDraftPowerContext(providerID: "fixture", selectionID: "fixture",
                    sessionID: UUID(), sessionStartedAt: now.addingTimeInterval(-1))
                let armed = try db.armOperatorDraftPower(context: context, workspaceID: workspace,
                    draftID: current.qso.id, expectedRevision: current.revision, now: now)
                let received = now.addingTimeInterval(0.1)
                let sample = try XCTUnwrap(OperatorDraftPowerSample(watts: 73, observedAt: received,
                    radioObservedAt: received, amplifierObservedAt: received, receivedAt: received, sessionID: context.sessionID))
                _ = try db.captureOperatorDraftPower(sample: sample, scopeID: XCTUnwrap(armed.power?.activeScope?.id), now: received)
            }
            let retained = try XCTUnwrap(db.operatorDraft())
            XCTAssertFalse(retained.operatingDefaultsMutable)
            XCTAssertEqual(retained.qso.txPower, "73")
            _ = try await call(f, "settings_save", settingsMutation(f, completed: true))
            let after = try XCTUnwrap(db.operatorDraft())
            XCTAssertEqual(after.qso, retained.qso)
            XCTAssertEqual(after.power?.manualOverride, !captured)
            XCTAssertEqual(after.power?.selectedSample, retained.power?.selectedSample)
        }
    }

    func testUntouchedSeedRefreshPreservesEnabledPowerOwnerAndNativeRadioMetadata() async throws {
        let f = try fixture()
        _ = try await call(f, "workspace_create", ["mode": "empty", "onboarding": true])
        _ = try await call(f, "logbook_operator_draft")
        let db = try f.service.openedDatabase()
        let seed = try XCTUnwrap(db.operatorDraft())
        // Simulate admitted native radio following, which retains default
        // eligibility independently of operator-authored text provenance.
        var qso = seed.qso; qso.frequencyHz = 7_025_000; qso.band = "40m"; qso.mode = "CW"
        _ = try db.applyOperatorDraft(.init(operationID: UUID(), draftID: qso.id,
            expectedRevision: seed.revision, action: .replace, qso: qso), nextDraft: qso,
            preserveOperatingDefaultsEligibility: true)
        var completion = try await settingsMutation(f, completed: true)
        var settings = try XCTUnwrap(completion["settings"] as? [String: Any])
        settings["automaticTransmitPower"] = true; settings["defaultPower"] = "100"; completion["settings"] = settings
        let workspace = try XCTUnwrap(UUID(uuidString: completion["generation"] as! String))
        let before = try db.configureOperatorDraftPower(enabled: true, fallback: "100", workspaceID: workspace)
        XCTAssertTrue(before.operatingDefaultsMutable)
        XCTAssertEqual(before.power?.enabled, true)
        _ = try await call(f, "settings_save", completion)
        let after = try XCTUnwrap(db.operatorDraft())
        XCTAssertEqual(after.qso.operatorCall, "K1TEST"); XCTAssertEqual(after.qso.myCall, "K1TEST/P")
        XCTAssertEqual(after.qso.myGrid, "FN31PR"); XCTAssertEqual(after.qso.stationLocation, "Generated private fixture")
        XCTAssertEqual(after.power, before.power)
        XCTAssertEqual(after.power?.activeScope, before.power?.activeScope)
        XCTAssertEqual(after.qso.txPower, before.qso.txPower)
        XCTAssertEqual(after.qso.id, before.qso.id); XCTAssertEqual(after.qso.start, before.qso.start)
        XCTAssertEqual(after.automaticStart, before.automaticStart)
        XCTAssertEqual(after.qso.frequencyHz, before.qso.frequencyHz)
        XCTAssertEqual(after.qso.band, before.qso.band); XCTAssertEqual(after.qso.mode, before.qso.mode)
        XCTAssertEqual(after.qso.rstSent, before.qso.rstSent); XCTAssertEqual(after.qso.rstReceived, before.qso.rstReceived)
        XCTAssertEqual(after.revision, before.revision + 1)
    }
}

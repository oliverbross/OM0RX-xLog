import Foundation
import Testing
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif
@testable import XLogPrototypeSupport

@Suite("Native spot draft activation receipts and reservations")
struct SpotDraftActivationTests {
    private func fixture(_ body: (LiveLogbookMethods, URL) throws -> Void) throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("spot-draft-\(UUID())")
        let service = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        defer { try? service.openedDatabase().close(); try? FileManager.default.removeItem(at: root) }
        _ = try service.handle(method: "workspace_create", params: ["mode": "empty"])
        let workspace = try IntegrationWorkspaceBootstrap.open(at: service.workspaceDirectoryURL)
        defer { workspace.makeDefaults()?.removePersistentDomain(forName: workspace.defaultsSuiteName) }
        try body(service, root)
    }

    private func snapshot(_ service: LiveLogbookMethods) throws -> [String: Any] {
        try #require(service.handle(method: "logbook_operator_draft", params: [:])["draft"] as? [String: Any])
    }

    private func command(_ draft: [String: Any], operationID: UUID = UUID(), call: String = "K1ABC") throws -> [String: Any] {
        let qso = try #require(draft["qso"] as? [String: Any])
        return ["operationID": operationID.uuidString, "generation": try #require(draft["generation"]),
                "draftID": try #require(qso["id"]), "expectedRevision": try #require(draft["revision"]),
                "spot": ["call": call, "frequencyHz": 14_025_000, "band": "20m", "mode": "CW",
                         "country": "United States", "dxcc": 291, "comment": "POTA K-0001", "specialTags": ["POTA"]]]
    }

    private func control(_ command: [String: Any], _ applied: [String: Any]) throws -> [String: Any] {
        ["operationID": try #require(command["operationID"]), "generation": try #require(command["generation"]),
         "leaseID": try #require(applied["leaseID"])]
    }

    private func scopedReceiptDraft(_ result: [String: Any]) throws -> [String: Any] {
        let receipt = try #require(result["receipt"] as? [String: Any])
        return try #require(receipt["draft"] as? [String: Any])
    }
    private func cwSelection() -> [String:Any] {
        ["call":"K1ABC","frequencyHz":NSNull(),"band":"","mode":"","country":"","comment":"","specialTags":[],
         "cwCallsign":["sessionID":UUID().uuidString,"sourceID":UUID().uuidString,"streamToken":UUID().uuidString,
            "epoch":"1","trackID":UUID().uuidString,"revision":"0","selectionID":UUID().uuidString]]
    }

    @Test("CW callsign loading preserves operating fields and user text and cannot grant station effects")
    func cwCallsignOnly() throws {
        try fixture { service, _ in
            let db=try service.openedDatabase(),current=try db.operatorDraft(initial:QSO(call:"",band:"20m",mode:"CW"))
            var qso=current.qso
            qso.call="DL1ABC";qso.start=Date(timeIntervalSince1970:1_700_000_000)
            qso.frequencyHz=7_188_000;qso.band="40m";qso.mode="SSB";qso.rstSent="57";qso.rstReceived="56"
            qso.country="Germany";qso.dxcc=230;qso.name="Prior station";qso.gridSquare="JO62"
            qso.comment="Operator text";qso.potaReference="K-0001"
            let edit=OperatorDraftMutation(operationID:UUID(),draftID:current.qso.id,expectedRevision:current.revision,action:.replace,qso:qso)
            _ = try db.applyOperatorDraft(edit,nextDraft:QSO(call:"",band:"20m",mode:"CW"))
            var request=try command(snapshot(service));request["spot"]=cwSelection()
            let applied=try service.handle(method:"spot_draft_apply",params:request)
            let selected=try #require(scopedReceiptDraft(applied)["qso"] as? [String:Any])
            #expect(selected["call"] as? String == "K1ABC")
            #expect(selected["frequencyHz"] as? Int == 7_188_000)
            #expect(selected["band"] as? String == "40m");#expect(selected["mode"] as? String == "SSB")
            #expect(selected["rstSent"] as? String == "57");#expect(selected["rstReceived"] as? String == "56")
            #expect(selected["comment"] as? String == "Operator text");#expect(selected["potaReference"] as? String == "K-0001")
            let saved=try db.operatorDraft(initial:qso)
            #expect(saved.qso.start==qso.start);#expect(!saved.automaticStart)
            #expect(saved.qso.country.isEmpty);#expect(saved.qso.dxcc==nil);#expect(saved.qso.name.isEmpty);#expect(saved.qso.gridSquare.isEmpty)
            for name in ["tune_started","rotor_started"] {
                var stage=try control(request,applied);stage["stage"]=name
                #expect(throws:WorkerFailure.self){try service.handle(method:"spot_draft_stage",params:stage)}
            }
            var finish=try control(request,applied);finish["outcome"]="confirmed"
            #expect(try service.handle(method:"spot_draft_finish",params:finish)["phase"] as? String == "confirmed")
            let replay=try service.handle(method:"spot_draft_apply",params:request)
            #expect(replay["replay"] as? Bool == true);#expect(replay["leaseID"]==nil)
        }
    }

    @Test("CW callsign-only commands reject mixed selections, RF fields and unknown provenance")
    func cwCallsignCommandBounds() throws {
        try fixture { service, _ in
            let request=try command(snapshot(service))
            for (key,value):(String,Any) in [("frequencyHz",14_025_000),("mode","CW"),("country","United States"),
                ("call","CQ"),("call","K1ABC-1"),
                ("opportunity",["kind":"pota","reference":"K-0001","referenceKind":"pota"])] {
                var invalid=request,spot=cwSelection();spot[key]=value;invalid["spot"]=spot
                #expect(throws:WorkerFailure.self){try service.handle(method:"spot_draft_apply",params:invalid)}
            }
            var invalid=request,spot=cwSelection(),reference=try #require(spot["cwCallsign"] as? [String:Any])
            reference["call"]="K1ABC";spot["cwCallsign"]=reference;invalid["spot"]=spot
            #expect(throws:WorkerFailure.self){try service.handle(method:"spot_draft_apply",params:invalid)}
        }
    }

    @Test("CW receipt-only recovery survives worker replacement and cannot replace later draft edits")
    func cwReceiptReadAfterRestart() throws {
        try fixture { service, root in
            var request=try command(snapshot(service));request["spot"]=cwSelection()
            let applied=try service.handle(method:"spot_draft_apply",params:request)
            var finish=try control(request,applied);finish["outcome"]="confirmed"
            _ = try service.handle(method:"spot_draft_finish",params:finish)
            let db=try service.openedDatabase(),current=try db.operatorDraft(initial:QSO(call:"",band:"20m",mode:"CW"))
            var edited=current.qso;edited.call="K2XYZ";edited.comment="Later operator text"
            _ = try db.applyOperatorDraft(OperatorDraftMutation(operationID:UUID(),draftID:current.qso.id,
                expectedRevision:current.revision,action:.replace,qso:edited),nextDraft:QSO(call:"",band:"20m",mode:"CW"))
            db.close()
            let replacement=LiveLogbookMethods(supportDirectory:root,inheritNativePreferences:false)
            defer {try? replacement.openedDatabase().close()}
            let before=try snapshot(replacement)
            let result=try replacement.handle(method:"spot_draft_cw_status",params:["operationID":try #require(request["operationID"])])
            #expect(result["phase"] as? String == "confirmed")
            #expect(result["reservationActive"] as? Bool == false)
            #expect(result["draftOnly"] as? Bool == true);#expect(result["tuneConfirmed"] as? Bool == false)
            #expect(result["rotor"] as? String == "not_requested");#expect(result["draft"]==nil)
            #expect(NSDictionary(dictionary:before).isEqual(to:try snapshot(replacement)))
            #expect((before["qso"] as? [String:Any])?["call"] as? String == "K2XYZ")
            try JSONEncoder().encode(UUID()).write(to:replacement.workspaceDirectoryURL.appendingPathComponent("edit-generation.json"),options:.atomic)
            #expect(throws:WorkerFailure.self){try replacement.handle(method:"spot_draft_cw_status",params:["operationID":try #require(request["operationID"])])}
        }
    }

    @Test("CW receipt-only read withholds missing, unrelated, malformed and unfinished outcomes")
    func cwReceiptReadBounds() throws {
        try fixture { service, root in
            let missing=try service.handle(method:"spot_draft_cw_status",params:["operationID":UUID().uuidString])
            #expect(missing["phase"] as? String == "uncertain");#expect(missing["reservationActive"] as? Bool == false)
            for params:[String:Any] in [["operationID":"bad"],["operationID":UUID().uuidString,"generation":UUID().uuidString],
                ["operationID":"00000000-0000-0000-0000-000000000000"],["operationID":UUID().uuidString,"outcome":"confirmed"]] {
                #expect(throws:WorkerFailure.self){try service.handle(method:"spot_draft_cw_status",params:params)}
            }
            let normal=try command(snapshot(service)),applied=try service.handle(method:"spot_draft_apply",params:normal)
            #expect(throws:WorkerFailure.self){try service.handle(method:"spot_draft_cw_status",params:["operationID":try #require(normal["operationID"])])}
            var finish=try control(normal,applied);finish["outcome"]="failed"
            _ = try service.handle(method:"spot_draft_finish",params:finish)
            var cw=try command(snapshot(service));cw["spot"]=cwSelection()
            _ = try service.handle(method:"spot_draft_apply",params:cw)
            let active=try service.handle(method:"spot_draft_cw_status",params:["operationID":try #require(cw["operationID"])])
            #expect(active["phase"] as? String == "draft_applied");#expect(active["reservationActive"] as? Bool == true)
            #expect(try service.openedDatabase().spotDraftActivationActive)
            try service.openedDatabase().close()
            let replacement=LiveLogbookMethods(supportDirectory:root,inheritNativePreferences:false)
            defer {try? replacement.openedDatabase().close()}
            let recovered=try replacement.handle(method:"spot_draft_cw_status",params:["operationID":try #require(cw["operationID"])])
            #expect(recovered["phase"] as? String == "uncertain");#expect(recovered["reservationActive"] as? Bool == false)
        }
    }

    @Test("Apply is atomic, same-ID retries retain receipt, and a stage grants one send only")
    func replayAndStages() throws {
        try fixture { service, _ in
            let initial = try snapshot(service), request = try command(initial)
            let result = try service.handle(method: "spot_draft_apply", params: request)
            #expect(result["status"] as? String == "applied")
            #expect(result["replay"] as? Bool == false)
            let repeated = try service.handle(method: "spot_draft_apply", params: request)
            #expect(repeated["replay"] as? Bool == true)
            #expect(NSDictionary(dictionary: try scopedReceiptDraft(result)).isEqual(to: try scopedReceiptDraft(repeated)))
            #expect(try scopedReceiptDraft(result)["generation"] as? String == initial["generation"] as? String)
            var stage = try control(request, result); stage["stage"] = "tune_started"
            #expect(try service.handle(method: "spot_draft_stage", params: stage)["status"] as? String == "staged")
            #expect(try service.handle(method: "spot_draft_stage", params: stage)["status"] as? String == "already_staged")
            stage["stage"] = "tune_confirmed"
            #expect(try service.handle(method: "spot_draft_stage", params: stage)["status"] as? String == "staged")
            var finish = try control(request, result); finish["outcome"] = "confirmed"
            let ended = try service.handle(method: "spot_draft_finish", params: finish)
            #expect(ended["phase"] as? String == "confirmed")
            #expect(ended["leaseID"] == nil)
            #expect(try service.handle(method: "spot_draft_apply", params: request)["leaseID"] == nil)
            #expect(try service.handle(method: "spot_draft_finish", params: finish)["phase"] as? String == "confirmed")
        }
    }

    @Test("Successive live spots refresh an automatic start but preserve an explicitly edited start")
    func spotStartProvenance() throws {
        let old = Date(timeIntervalSince1970: 1_700_000_000)
        try fixture { service, _ in
            let db = try service.openedDatabase()
            let current = try db.operatorDraft(initial: QSO(call: "", band: "20m", mode: "CW"))
            let reset = QSO(call: "", start: old, band: "20m", mode: "CW", updatedAt: old)
            let clear = OperatorDraftMutation(operationID: UUID(), draftID: current.qso.id,
                expectedRevision: current.revision, action: .clear)
            let automatic = try db.applyOperatorDraft(clear, nextDraft: reset).draft
            #expect(automatic.automaticStart)
            func decoded(_ request: [String: Any]) throws -> SpotDraftCommand {
                try JSONDecoder().decode(SpotDraftCommand.self,
                    from: JSONSerialization.data(withJSONObject: request))
            }
            let firstTime = old.addingTimeInterval(60)
            let firstCommand = try decoded(command(try snapshot(service), call: "N0GRA"))
            let first = try db.applySpotDraft(firstCommand, now: firstTime)
            #expect(first.record.receipt.draft.qso.start == firstTime)
            #expect(first.record.receipt.draft.automaticStart)
            let firstLease = try #require(first.leaseID)
            _ = try db.finishSpotDraft(operationID: firstCommand.operationID,
                generation: firstCommand.generation, leaseID: firstLease, outcome: .failed)

            let secondTime = old.addingTimeInterval(120)
            let secondCommand = try decoded(command(try snapshot(service), call: "C5R"))
            let second = try db.applySpotDraft(secondCommand, now: secondTime)
            #expect(second.record.receipt.draft.qso.call == "C5R")
            #expect(second.record.receipt.draft.qso.start == secondTime)
            #expect(second.record.receipt.draft.automaticStart)
        }

        try fixture { service, _ in
            let db = try service.openedDatabase()
            let current = try db.operatorDraft(initial: QSO(call: "", band: "20m", mode: "CW"))
            var historical = current.qso; historical.start = old
            let edit = OperatorDraftMutation(operationID: UUID(), draftID: current.qso.id,
                expectedRevision: current.revision, action: .replace, qso: historical)
            let manual = try db.applyOperatorDraft(edit, nextDraft: QSO(call: "", band: "20m", mode: "CW")).draft
            #expect(!manual.automaticStart)
            _ = try service.handle(method: "spot_draft_apply", params: command(try snapshot(service)))
            let selected = try db.operatorDraft(initial: historical)
            #expect(selected.qso.start == old)
            #expect(!selected.automaticStart)
        }
    }

    @Test("Opportunity selection supports a calendar without frequency and cannot stage station effects")
    func opportunityDraftOnly() throws {
        try fixture { service, _ in
            let initial = try snapshot(service), previous = try #require(initial["qso"] as? [String: Any])
            var request = try command(initial, call: "OM0RX/P")
            request["spot"] = ["call":"OM0RX/P", "frequencyHz":NSNull(), "band":"", "mode":"", "country":"",
                "comment":"Calendar selection", "specialTags":[],
                "opportunity":["kind":"dxpedition", "reference":"EU-001", "referenceKind":"iota"]] as [String:Any]
            let applied = try service.handle(method:"spot_draft_apply", params:request)
            let selected = try #require(scopedReceiptDraft(applied)["qso"] as? [String:Any])
            #expect(selected["frequencyHz"] == nil || selected["frequencyHz"] is NSNull)
            #expect(selected["band"] as? String == previous["band"] as? String)
            #expect(selected["mode"] as? String == previous["mode"] as? String)
            #expect(selected["iota"] as? String == "EU-001")
            #expect(selected["potaReference"] as? String == "")
            var stage = try control(request, applied); stage["stage"] = "tune_started"
            #expect(throws:WorkerFailure.self) { try service.handle(method:"spot_draft_stage", params:stage) }
            var finish = try control(request, applied); finish["outcome"] = "confirmed"
            #expect(try service.handle(method:"spot_draft_finish", params:finish)["phase"] as? String == "confirmed")
            #expect(try service.handle(method:"spot_draft_apply", params:request)["replay"] as? Bool == true)
            #expect(try service.handle(method:"spot_draft_apply", params:request)["leaseID"] == nil)
        }
    }

    @Test("Opportunity references are explicit and independent of misleading comment tags")
    func opportunityReferenceMapping() throws {
        for (kind, field) in [("pota","potaReference"), ("sota","sotaReference"), ("wwff","wwffReference"), ("wwbota","sigInfo"), ("castle","sigInfo")] {
            try fixture { service, _ in
                var request = try command(snapshot(service))
                var spot = try #require(request["spot"] as? [String:Any])
                spot["opportunity"] = ["kind":kind,"reference":"EXPLICIT-1","referenceKind":kind]
                request["spot"] = spot
                let selected = try #require(scopedReceiptDraft(service.handle(method:"spot_draft_apply", params:request))["qso"] as? [String:Any])
                #expect(selected[field] as? String == "EXPLICIT-1")
                #expect(selected["band"] as? String == "20m")
                if kind != "pota" { #expect(selected["potaReference"] as? String == "") }
            }
        }
    }

    @Test("Only exact immutable payload retries; identities, integer values and unknown keys are strict")
    func invalidCommands() throws {
        try fixture { service, _ in
            let initial = try snapshot(service), request = try command(initial)
            var wrongGeneration = request; wrongGeneration["generation"] = UUID().uuidString
            #expect(try service.handle(method: "spot_draft_apply", params: wrongGeneration)["status"] as? String == "workspace_changed")
            var wrongDraft = request; wrongDraft["draftID"] = UUID().uuidString
            #expect(try service.handle(method: "spot_draft_apply", params: wrongDraft)["status"] as? String == "conflict")
            for invalidFrequency: Any in [true, 0, 14_025_000.5, 1_000_000_000_001] {
                var invalidRequest = request, spot = try #require(request["spot"] as? [String: Any])
                spot["frequencyHz"] = invalidFrequency; invalidRequest["spot"] = spot
                #expect(throws: WorkerFailure.self) { try service.handle(method: "spot_draft_apply", params: invalidRequest) }
            }
            var unknown = request; unknown["qso"] = [:] as [String: Any]
            #expect(throws: WorkerFailure.self) { try service.handle(method: "spot_draft_apply", params: unknown) }
            _ = try service.handle(method: "spot_draft_apply", params: request)
            var changed = request, spot = try #require(request["spot"] as? [String: Any])
            spot["call"] = "K2ABC"; changed["spot"] = spot
            #expect(throws: WorkerFailure.self) { try service.handle(method: "spot_draft_apply", params: changed) }
        }
    }

    @Test("Reservation blocks every ordinary draft mutation, legacy save and restore, but not reads")
    func draftReservation() throws {
        try fixture { service, _ in
            let request = try command(snapshot(service))
            let result = try service.handle(method: "spot_draft_apply", params: request)
            let draft = try scopedReceiptDraft(result), qso = try #require(draft["qso"] as? [String: Any])
            for action in ["replace", "clear", "save"] {
                var mutation: [String: Any] = ["operationID": UUID().uuidString, "generation": try #require(draft["generation"]),
                    "draftID": try #require(qso["id"]), "expectedRevision": try #require(draft["revision"]), "action": action]
                if action == "replace" { mutation["qso"] = qso }
                #expect(throws: WorkerFailure.self) { try service.handle(method: "logbook_operator_draft_apply", params: mutation) }
            }
            #expect(throws: (any Error).self) { try service.handle(method: "logbook_save", params: ["qso": qso]) }
            #expect(throws: WorkerFailure.self) { try service.handle(method: "backup_restore", params: [:]) }
            #expect(NSDictionary(dictionary: try snapshot(service)).isEqual(to: draft))
            let another = try command(draft)
            #expect(throws: WorkerFailure.self) { try service.handle(method: "spot_draft_apply", params: another) }
            #expect(try service.openedDatabase().count() == 0)
        }
    }

    @Test("Cancelled/unknown replies release only their matching lease and cannot clear a newer activation")
    func matchingFinishOnly() throws {
        try fixture { service, _ in
            let request = try command(snapshot(service)), first = try service.handle(method: "spot_draft_apply", params: request)
            var finish = try control(request, first); finish["outcome"] = "failed"
            _ = try service.handle(method: "spot_draft_finish", params: finish)
            let nextRequest = try command(snapshot(service), call: "K2ABC")
            let next = try service.handle(method: "spot_draft_apply", params: nextRequest)
            _ = try service.handle(method: "spot_draft_finish", params: finish)
            #expect(try service.openedDatabase().spotDraftActivationActive)
            var stale = try control(nextRequest, next); stale["leaseID"] = first["leaseID"]; stale["outcome"] = "uncertain"
            #expect(throws: WorkerFailure.self) { try service.handle(method: "spot_draft_finish", params: stale) }
            #expect(try service.openedDatabase().spotDraftActivationActive)
            var badStage = try control(nextRequest, next); badStage["stage"] = "rotor_started"
            #expect(throws: WorkerFailure.self) { try service.handle(method: "spot_draft_stage", params: badStage) }
            var nextFinish = try control(nextRequest, next); nextFinish["outcome"] = "uncertain"
            _ = try service.handle(method: "spot_draft_finish", params: nextFinish)
            #expect(try !service.openedDatabase().spotDraftActivationActive)
        }
    }

    @Test("Worker replacement persistently makes a nonterminal receipt uncertain; replay never reacquires authority")
    func workerReplacement() throws {
        try fixture { service, root in
            let request = try command(snapshot(service)), result = try service.handle(method: "spot_draft_apply", params: request)
            var stage = try control(request, result); stage["stage"] = "tune_started"
            _ = try service.handle(method: "spot_draft_stage", params: stage)
            let replacement = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
            defer { try? replacement.openedDatabase().close() }
            let replay = try replacement.handle(method: "spot_draft_apply", params: request)
            #expect(replay["phase"] as? String == "uncertain")
            #expect(replay["replay"] as? Bool == true)
            #expect(replay["leaseID"] == nil)
            #expect(throws: WorkerFailure.self) { try replacement.handle(method: "spot_draft_stage", params: stage) }
            #expect(throws: WorkerFailure.self) { try service.handle(method: "spot_draft_stage", params: stage) }
            let again = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
            defer { try? again.openedDatabase().close() }
            let status = try again.handle(method: "spot_draft_status", params: ["operationID": try #require(request["operationID"]), "generation": try #require(request["generation"])])
            #expect(status["phase"] as? String == "uncertain")
            #expect((status["receipt"] as? [String: Any])?["phase"] as? String == "draft_applied")
        }
    }

    @Test("Spot mapping preserves manual power, notes, reports and unrelated ADIF; call and references retarget safely")
    func manualFieldsAndReferences() throws {
        try fixture { service, _ in
            let initial = try snapshot(service)
            var qso = try #require(initial["qso"] as? [String: Any])
            qso["call"] = "K0OLD"; qso["name"] = "Previous"; qso["gridSquare"] = "FN31"
            qso["notes"] = "operator notes"; qso["rstSent"] = "579"; qso["txPower"] = "42"
            qso["extraFields"] = ["APP_TEST": "keep"]
            let edit: [String: Any] = ["operationID": UUID().uuidString, "generation": try #require(initial["generation"]),
                "draftID": try #require(qso["id"]), "expectedRevision": try #require(initial["revision"]), "action": "replace", "qso": qso,
                "powerIntent": ["action": "manual", "value": "42"]]
            _ = try service.handle(method: "logbook_operator_draft_apply", params: edit)
            let request = try command(snapshot(service)), result = try service.handle(method: "spot_draft_apply", params: request)
            let selected = try #require(scopedReceiptDraft(result)["qso"] as? [String: Any])
            #expect(selected["call"] as? String == "K1ABC")
            #expect(selected["name"] as? String == "")
            #expect(selected["gridSquare"] as? String == "")
            #expect(selected["notes"] as? String == "operator notes")
            #expect(selected["rstSent"] as? String == "579")
            #expect(selected["txPower"] as? String == "42")
            #expect((selected["extraFields"] as? [String: String])?["APP_TEST"] == "keep")
            #expect(selected["potaReference"] as? String == "K-0001")
            // Native meter configuration is permitted while contact editing is reserved.
            let owner = try service.powerOwnerSnapshot()
            _ = try service.configureDraftPower(expectedWorkspaceID: owner.workspaceID)
            #expect(try service.openedDatabase().spotDraftActivationActive)
        }
    }

    @Test("Same-call selection removes old references without clearing contact metadata")
    func sameCallReferences() throws {
        try fixture { service, _ in
            let firstRequest = try command(snapshot(service))
            let first = try service.handle(method: "spot_draft_apply", params: firstRequest)
            var finish = try control(firstRequest, first); finish["outcome"] = "failed"
            _ = try service.handle(method: "spot_draft_finish", params: finish)
            let draft = try snapshot(service)
            var qso = try #require(draft["qso"] as? [String: Any]); qso["name"] = "Keep same station"
            _ = try service.handle(method: "logbook_operator_draft_apply", params: ["operationID": UUID().uuidString,
                "generation": try #require(draft["generation"]), "draftID": try #require(qso["id"]),
                "expectedRevision": try #require(draft["revision"]), "action": "replace", "qso": qso])
            var next = try command(snapshot(service)), spot = try #require(firstRequest["spot"] as? [String: Any])
            spot["comment"] = "plain spot"; spot["specialTags"] = [] as [String]; next["spot"] = spot
            let result = try service.handle(method: "spot_draft_apply", params: next)
            let selected = try #require(scopedReceiptDraft(result)["qso"] as? [String: Any])
            #expect(selected["name"] as? String == "Keep same station")
            #expect(selected["potaReference"] as? String == "")
        }
    }

    @Test("Changed call resets captured automatic power and fences queued old readings, while new readings remain allowed")
    func automaticPowerRetarget() throws {
        try fixture { service, _ in
            _ = try snapshot(service)
            let owner = try service.powerOwnerSnapshot(), db = try service.openedDatabase()
            _ = try db.configureOperatorDraftPower(enabled: true, fallback: "90", workspaceID: owner.workspaceID)
            var qso = owner.draft.qso; qso.call = "K0OLD"; qso.frequencyHz = 14_025_000; qso.mode = "CW"
            _ = try db.applyOperatorDraft(.init(operationID: UUID(), draftID: qso.id, expectedRevision: owner.draft.revision,
                action: .replace, qso: qso, powerIntent: .init(action: .automatic)), nextDraft: qso)
            let now = Date(), session = UUID()
            let context = OperatorDraftPowerContext(providerID: "fixture", selectionID: "fixture", sessionID: session, sessionStartedAt: now)
            let before = try service.powerOwnerSnapshot()
            let armed = try db.armOperatorDraftPower(context: context, workspaceID: owner.workspaceID,
                draftID: qso.id, expectedRevision: before.draft.revision, now: now)
            let scope = try #require(armed.power?.activeScope?.id), time = now.addingTimeInterval(0.1)
            let sample = try #require(OperatorDraftPowerSample(watts: 500, observedAt: time, radioObservedAt: time,
                amplifierObservedAt: time, receivedAt: time, sessionID: session))
            _ = try db.captureOperatorDraftPower(sample: sample, scopeID: scope, now: time)
            #expect(try service.powerOwnerSnapshot().draft.qso.txPower == "500")
            let request = try command(snapshot(service))
            _ = try service.handle(method: "spot_draft_apply", params: request)
            let selected = try service.powerOwnerSnapshot().draft
            #expect(selected.qso.txPower == "90")
            #expect(selected.power?.selectedSample == nil)
            #expect(selected.power?.activeScope == nil)
            let stale = try db.captureOperatorDraftPower(sample: sample, scopeID: scope, now: time)
            #expect(stale == selected)
            let rearmed = try db.armOperatorDraftPower(context: context, workspaceID: owner.workspaceID,
                draftID: selected.qso.id, expectedRevision: selected.revision, now: time)
            let newScope = try #require(rearmed.power?.activeScope?.id), newTime = time.addingTimeInterval(0.1)
            let fresh = try #require(OperatorDraftPowerSample(watts: 400, observedAt: newTime, radioObservedAt: newTime,
                amplifierObservedAt: newTime, receivedAt: newTime, sessionID: session))
            let captured = try db.captureOperatorDraftPower(sample: fresh, scopeID: newScope, now: newTime)
            #expect(captured.qso.txPower == "400")
            #expect(captured.revision == selected.revision)
            #expect(db.spotDraftActivationActive)
        }
    }

    @Test("A rejected oversized selection rolls back both draft and receipt")
    func rejectedApplyIsAtomic() throws {
        try fixture { service, _ in
            let initial = try snapshot(service)
            var qso = try #require(initial["qso"] as? [String: Any])
            qso["notes"] = String(repeating: "x", count: 17_000)
            _ = try service.handle(method: "logbook_operator_draft_apply", params: ["operationID": UUID().uuidString,
                "generation": try #require(initial["generation"]), "draftID": try #require(qso["id"]),
                "expectedRevision": try #require(initial["revision"]), "action": "replace", "qso": qso])
            let before = try snapshot(service)
            var request = try command(before), spot = try #require(request["spot"] as? [String: Any])
            spot["comment"] = String(repeating: "y", count: 8_000); request["spot"] = spot
            #expect(throws: (any Error).self) { try service.handle(method: "spot_draft_apply", params: request) }
            #expect(NSDictionary(dictionary: try snapshot(service)).isEqual(to: before))
            let status = try service.handle(method: "spot_draft_status", params: ["operationID": try #require(request["operationID"]), "generation": try #require(request["generation"])])
            #expect(status["status"] as? String == "not_found")
            #expect(try !service.openedDatabase().spotDraftActivationActive)
        }
    }

    @Test("A status-before-late-apply race is closed by a permanent exact-generation abandonment tombstone")
    func abandonmentWinsLateApply() throws {
        try fixture { service, root in
            let before = try snapshot(service), request = try command(before)
            let identity: [String: Any] = ["operationID": try #require(request["operationID"]), "generation": try #require(request["generation"])]
            #expect(try service.handle(method: "spot_draft_status", params: identity)["status"] as? String == "not_found")
            let abandoned = try service.handle(method: "spot_draft_abandon", params: identity)
            #expect(abandoned["status"] as? String == "abandoned")
            #expect(abandoned["leaseID"] == nil)
            #expect(try service.handle(method: "spot_draft_apply", params: request)["status"] as? String == "abandoned")
            #expect(NSDictionary(dictionary: try snapshot(service)).isEqual(to: before))
            let replacement = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
            defer { try? replacement.openedDatabase().close() }
            #expect(try replacement.handle(method: "spot_draft_apply", params: request)["status"] as? String == "abandoned")
            #expect(try replacement.handle(method: "spot_draft_status", params: identity)["status"] as? String == "abandoned")
            #expect(try !replacement.openedDatabase().spotDraftActivationActive)
        }
    }

    @Test("Abandonment arriving after apply returns the live receipt without releasing or changing its lease")
    func appliedReceiptWinsAbandonment() throws {
        try fixture { service, _ in
            let request = try command(snapshot(service)), applied = try service.handle(method: "spot_draft_apply", params: request)
            let identity: [String: Any] = ["operationID": try #require(request["operationID"]), "generation": try #require(request["generation"])]
            let status = try service.handle(method: "spot_draft_status", params: identity)
            #expect(status["leaseID"] as? String == applied["leaseID"] as? String)
            let abandoned = try service.handle(method: "spot_draft_abandon", params: identity)
            #expect(abandoned["status"] as? String == "found")
            #expect(abandoned["leaseID"] as? String == applied["leaseID"] as? String)
            #expect(abandoned["phase"] as? String == "draft_applied")
            #expect(try service.openedDatabase().spotDraftActivationActive)
            var finish = try control(request, applied); finish["outcome"] = "uncertain"
            _ = try service.handle(method: "spot_draft_finish", params: finish)
            #expect(try service.handle(method: "spot_draft_abandon", params: identity)["phase"] as? String == "uncertain")
            #expect(try service.openedDatabase().spotDraftAbandonedGeneration(operationID: UUID(uuidString: request["operationID"] as! String)!) == nil)
        }
    }

    @Test("Abandoned IDs survive backup restoration but never authorize an old workspace generation")
    func abandonmentBackupRestoreGeneration() throws {
        try fixture { service, _ in
            let request = try command(snapshot(service))
            let identity: [String: Any] = ["operationID": try #require(request["operationID"]), "generation": try #require(request["generation"])]
            _ = try service.handle(method: "spot_draft_abandon", params: identity)
            let backup = try service.handle(method: "backup_create", params: ["name": "abandoned"])
            _ = try service.handle(method: "backup_restore", params: ["name": try #require(backup["name"]), "confirm_restore": true])
            let restored = try snapshot(service)
            #expect(restored["generation"] as? String != request["generation"] as? String)
            #expect(try service.handle(method: "spot_draft_apply", params: request)["status"] as? String == "workspace_changed")
            let reused = try command(restored, operationID: try #require(UUID(uuidString: request["operationID"] as! String)))
            #expect(throws: WorkerFailure.self) { try service.handle(method: "spot_draft_apply", params: reused) }
            #expect(NSDictionary(dictionary: try snapshot(service)).isEqual(to: restored))
            #expect(try !service.openedDatabase().spotDraftActivationActive)
        }
    }
}

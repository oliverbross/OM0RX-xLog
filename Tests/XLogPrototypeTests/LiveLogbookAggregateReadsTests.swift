import Foundation
import XCTest
@testable import XLogPrototypeSupport
#if canImport(XLogCore)
@testable import XLogCore
#else
@testable import XLogPortableCore
#endif

final class LiveLogbookAggregateReadsTests: XCTestCase {
    private final class ExportGate: @unchecked Sendable {
        private let condition=NSCondition()
        private var started=false, released=false
        var entered: Bool { condition.withLock { started } }
        func hold() {
            condition.lock();started=true
            while !released { condition.wait() }
            condition.unlock()
        }
        func release() { condition.lock();released=true;condition.broadcast();condition.unlock() }
    }
    private final class Gate: @unchecked Sendable {
        private let condition = NSCondition()
        private let heldKinds: Set<LogbookAggregateKind>
        private let cancellationAware: Bool
        private let failFirst: Bool
        private var released = false
        private var entries: [LogbookAggregateKind: Int] = [:]
        private var cancellations: [LogbookAggregateKind: LogbookAggregateCancellation] = [:]

        init(_ kinds: Set<LogbookAggregateKind> = [.catalogue], cancellationAware: Bool = false, failFirst: Bool = false) {
            heldKinds = kinds; self.cancellationAware = cancellationAware; self.failFirst = failFirst
        }
        func count(_ kind: LogbookAggregateKind) -> Int { condition.withLock { entries[kind, default: 0] } }
        func cancelled(_ kind: LogbookAggregateKind) -> Bool { condition.withLock { cancellations[kind]?.isCancelled == true } }
        func release() { condition.lock(); released = true; condition.broadcast(); condition.unlock() }
        func evaluate(_ snapshot: LogbookAggregateSnapshot, _ cancellation: LogbookAggregateCancellation) throws -> LogbookAggregateResult {
            condition.lock()
            let kind = snapshot.request.kind
            entries[kind, default: 0] += 1
            let first = entries[kind] == 1
            if first { cancellations[kind] = cancellation }
            while first && heldKinds.contains(kind) && !released {
                if cancellationAware && cancellation.isCancelled { condition.unlock(); try cancellation.check() }
                _ = condition.wait(until: Date().addingTimeInterval(0.01))
            }
            condition.unlock()
            if first && failFirst { throw LogbookDatabaseError.corruptRecord }
            return try snapshot.evaluate(cancellation: cancellation)
        }
    }

    private final class WaitingRequests: @unchecked Sendable {
        private let lock = NSLock()
        private var requests: Set<LogbookAggregateRequest> = []
        func observe(_ request: LogbookAggregateRequest) { lock.withLock { _ = requests.insert(request) } }
        var offsets: Set<Int> { lock.withLock { Set(requests.map(\.offset)) } }
        var count: Int { lock.withLock { requests.count } }
    }

    private final class Reply: @unchecked Sendable {
        private let lock = NSLock()
        private var received = false
        var finished: Bool { lock.withLock { received } }
        func finish() { lock.withLock { received = true } }
    }
    private struct Call {
        let task: Task<Data, Never>
        let reply: Reply
    }
    private struct Fixture {
        let service: LiveLogbookMethods
        let worker: LiveWorker
        let root: URL
        let generation: String
    }

    private func fixture(_ gate: Gate, exportGate: ExportGate? = nil) throws -> Fixture {
        let temporary = URL(fileURLWithPath: try AppRuntimeProfile.canonicalFilesystemPath(FileManager.default.temporaryDirectory), isDirectory: true)
        let root = temporary.appendingPathComponent("xlog-aggregate-owner-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false, attributes: LocalFilePermissions.directoryAttributes)
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        let profile = AppRuntimeProfile.contestingTest(supportRoot: root)
        let service = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false, runtimeProfile: profile)
        _ = try service.handle(method: "workspace_create", params: ["mode": "empty"])
        let workspace = try IntegrationWorkspaceBootstrap.open(at: service.workspaceDirectoryURL,
            expectedIdentityPrefix: AppRuntimeProfile.contestingIdentityPrefix)
        addTeardownBlock {
            (try? service.openedDatabase())?.close()
            UserDefaults.standard.removePersistentDomain(forName: workspace.defaultsSuiteName)
        }
        try service.openedDatabase().save(QSO(call: "JA1BASE", start: Date(timeIntervalSince1970: 1_700_000_000),
            band: "20m", mode: "CW", dxcc: 339, state: "01", county: "0102", qslReceived: "Y"))
        let generation = try XCTUnwrap(service.handle(method: "workspace_status", params: [:])["generation"] as? String)
        let worker = LiveWorker(logbook: service, runtimeProfile: profile,
            aggregateEvaluator: { try gate.evaluate($0, $1) },
            beforeAggregateExportPreparation: { exportGate?.hold() })
        addTeardownBlock { gate.release(); _ = await worker.shutdown() }
        return Fixture(service: service, worker: worker, root: root, generation: generation)
    }

    private func contactReads(_ f: Fixture, gate: Gate, waiting: WaitingRequests) -> LiveLogbookAggregateReads {
        let reads = LiveLogbookAggregateReads(service: f.service,
            evaluate: { try gate.evaluate($0, $1) }, onWaitForTesting: { waiting.observe($0) })
        addTeardownBlock { await reads.terminate() }
        return reads
    }

    private func assertContactPage(_ reply: LiveLogbookAggregateReply, params: [String: Any],
                                   service: LiveLogbookMethods, file: StaticString = #filePath, line: UInt = #line) throws {
        let expected = try service.handle(method: "logbook_list", params: params)
        XCTAssertEqual(try JSONSerialization.data(withJSONObject: reply.payload, options: [.sortedKeys]),
                       try JSONSerialization.data(withJSONObject: expected, options: [.sortedKeys]), file: file, line: line)
    }

    private func call(_ worker: LiveWorker, _ method: String, _ params: [String: Any] = [:]) throws -> Call {
        let frame = try JSONSerialization.data(withJSONObject: ["id": UUID().uuidString, "method": method,
            "params": params, "operatingModule": "normal_logging"])
        let reply = Reply()
        let task = Task { let data = await worker.response(to: frame); reply.finish(); return data }
        return Call(task: task, reply: reply)
    }
    private func object(_ call: Call) async throws -> [String: Any] {
        let data = await call.task.value
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }
    private func success(_ call: Call) async throws -> [String: Any] {
        let response = try await object(call)
        XCTAssertEqual(response["ok"] as? Bool, true, String(describing: response["error"]))
        return try XCTUnwrap(response["result"] as? [String: Any])
    }
    private func waitUntil(_ condition: () -> Bool) async throws -> Bool {
        let deadline = Date().addingTimeInterval(10)
        while !condition() && Date() < deadline { try await Task.sleep(nanoseconds: 10_000_000) }
        return condition()
    }
    private func waitHeld(_ gate: Gate, kind: LogbookAggregateKind, call: Call) async throws {
        let captured = try await waitUntil { gate.count(kind) != 0 || call.reply.finished }
        XCTAssertTrue(captured)
        XCTAssertEqual(gate.count(kind), 1, "The real readonly capture must finish before the barrier is held.")
        XCTAssertFalse(call.reply.finished)
    }
    private func beforeRelease(_ calls: [Call], gate: Gate) async throws {
        let finished = try await waitUntil { calls.allSatisfy { $0.reply.finished } }
        // Release on failure too, so the regression cannot leave a blocked test
        // process instead of reporting the foreground-lane failure.
        if !finished { gate.release() }
        XCTAssertTrue(finished, "Foreground requests waited for held aggregate evaluation.")
    }
    private func wireQSO() throws -> [String: Any] {
        let encoder = JSONEncoder(); encoder.dateEncodingStrategy = .iso8601
        return try XCTUnwrap(JSONSerialization.jsonObject(with: encoder.encode(QSO(call: "JA1NEXT", band: "20m", mode: "CW",
            dxcc: 339, state: "01", county: "0103", qslReceived: "Y"))) as? [String: Any])
    }
    private func restoreParameters(_ name: String) -> [String: Any] {
        ["name": name, "confirm_restore": true, "restore_settings": false,
         "restore_preferences": false, "restore_reference_data": false]
    }

    func testMapSharesStatisticsAndCannotBlockInteractiveSaveOrPage() async throws {
        let gate = Gate([.statistics]), f = try fixture(gate)
        defer { gate.release() }
        let map = try call(f.worker, "workspace_map_context")
        try await waitHeld(gate, kind: .statistics, call: map)
        let save = try call(f.worker, "logbook_save", ["qso": wireQSO()])
        try await beforeRelease([save], gate: gate)
        _ = try await success(save)
        let page = try call(f.worker, "logbook_list", ["limit": 20])
        try await beforeRelease([page], gate: gate)
        let rows = try await success(page)
        XCTAssertEqual(rows["total"] as? Int, 2)
        XCTAssertFalse(map.reply.finished)
        gate.release()
        let context = try await success(map)
        let expected = try f.service.handle(method: "workspace_map_context", params: [:])
        XCTAssertEqual(context["dxccStatuses"] as? [String: String], expected["dxccStatuses"] as? [String: String])
        XCTAssertEqual(context["generation"] as? String, f.generation)
        _ = try await success(call(f.worker, "logbook_stats"))
        XCTAssertEqual(gate.count(.statistics), 2, "The obsolete read retries once; maps and statistics then reuse it.")
        let invalid = try await object(call(f.worker, "workspace_map_context", ["unexpected": true]))
        XCTAssertEqual(invalid["ok"] as? Bool, false)
        XCTAssertEqual(gate.count(.statistics), 2)
    }

    func testPOTAWirePreservesFrozenUTCDateWithoutRelativeConditions() async throws {
        let gate=Gate([]),f=try fixture(gate)
        let reference=try f.service.referenceDirectoryURL().appendingPathComponent("pota-parks.csv")
        try Data("reference,name,locationDesc,active\nSK-0001,Synthetic park,SK-BL,1\n".utf8).write(to:reference)
        let day=try XCTUnwrap(LogbookQuery.absoluteUTCDate("2026-11-02T12:00:00Z"))
        var contacts=(0..<10).map { index in
            QSO(call:"K\(index+1)SYN",start:day.addingTimeInterval(Double(index)*60),band:"20m",mode:"CW",
                myCall:"OM0RX/P",myGrid:"JN98",extraFields:["MY_DXCC":"504","MY_STATE":"SK-BL","MY_POTA_REF":"SK-0001"])
        }
        var sameDay=contacts[0];sameDay.id=UUID();sameDay.call="K1LATE"
        sameDay.start=try XCTUnwrap(LogbookQuery.absoluteUTCDate("2026-11-03T23:59:59Z"))
        var future=contacts[0];future.id=UUID();future.call="K1FUTURE"
        future.start=try XCTUnwrap(LogbookQuery.absoluteUTCDate("2026-11-04T00:00:00Z"))
        contacts += [sameDay,future]
        for contact in contacts { try f.service.openedDatabase().save(contact) }
        let frozen="2026-11-03T00:00:00.125Z"
        var params:[String:Any]=["programme":"pota","role":"activator","unit":"SK-0001","unit_role":"activator",
            "reference_time":frozen,"expected_generation":f.generation,
            "query":["version":1,"join":"all","clauses":[]] as [String:Any]]
        let parsed=try f.service.aggregateQuery(method:"logbook_award_progress",params:params)
        let expected=try XCTUnwrap(LogbookQuery.absoluteUTCDate(frozen)).timeIntervalSince1970
        XCTAssertEqual(parsed.referenceTime,expected)
        XCTAssertEqual(try parsed.request().referenceTime,expected)
        let result=try await success(call(f.worker,"logbook_award_progress",params))
        let days=try XCTUnwrap(result["activationCandidates"] as? [[String:Any]])
        let past=try XCTUnwrap(days.first{$0["day"] as? String == "2026-11-02"})
        XCTAssertEqual(past["countableContacts"] as? Int,10)
        XCTAssertEqual(past["candidateStatus"] as? String,"local candidate")
        let current=try XCTUnwrap(days.first{$0["day"] as? String == "2026-11-03"})
        XCTAssertEqual(current["countableContacts"] as? Int,1,"A later time on the frozen UTC day is not a future-date exclusion.")
        XCTAssertEqual(current["excludedRows"] as? Int,0)
        let excluded=try XCTUnwrap(days.first{$0["day"] as? String == "2026-11-04"})
        XCTAssertEqual(excluded["countableContacts"] as? Int,0)
        XCTAssertEqual(excluded["excludedRows"] as? Int,1)
        XCTAssertTrue((excluded["reasons"] as? [String] ?? []).contains("Future UTC date is excluded"))
        XCTAssertEqual(result["evidenceTotal"] as? Int,12)
        _=try await success(call(f.worker,"logbook_award_progress",params))
        XCTAssertEqual(gate.count(.localAwards),1,"The same frozen POTA query should reuse its immutable snapshot.")
        params["reference_time"]="2026-11-05T00:00:00Z"
        let later=try await success(call(f.worker,"logbook_award_progress",params))
        let laterDays=try XCTUnwrap(later["activationCandidates"] as? [[String:Any]])
        let reclassified=try XCTUnwrap(laterDays.first{$0["day"] as? String == "2026-11-04"})
        XCTAssertEqual(reclassified["countableContacts"] as? Int,1,"Eligibility uses the requested frozen day, not the host clock or an earlier cached result.")
        XCTAssertEqual(reclassified["excludedRows"] as? Int,0)
        XCTAssertEqual(gate.count(.localAwards),2,"Changing the frozen POTA date requires a new counting snapshot.")
    }

    func testPOTAWireRejectsUnknownSubmodeWithoutChangingStoredEvidence() async throws {
        let gate=Gate([]),f=try fixture(gate)
        let reference=try f.service.referenceDirectoryURL().appendingPathComponent("pota-parks.csv")
        try Data("reference,name,locationDesc,active\nSK-0001,Synthetic park,SK-BL,1\n".utf8).write(to:reference)
        let day=try XCTUnwrap(LogbookQuery.absoluteUTCDate("2026-11-02T12:00:00Z"))
        var contacts=(0..<11).map { index in
            QSO(call:"K\(index+1)SYN",start:day.addingTimeInterval(Double(index)*60),band:"20m",mode:"CW",
                myCall:"OM0RX/P",myGrid:"JN98",extraFields:["MY_DXCC":"504","MY_STATE":"SK-BL","MY_POTA_REF":"SK-0001"])
        }
        contacts[1].mode="SSB"
        contacts[2].mode="FT4"
        contacts[3].mode="MFSK";contacts[3].submode="FT4"
        contacts[4].mode="JT9";contacts[4].submode="JT9E FAST"
        contacts[9].submode="BOGUS"
        let db=try f.service.openedDatabase()
        for contact in contacts.prefix(10) { try db.save(contact) }
        let before=try db.fetchAll()
        let params:[String:Any]=["programme":"pota","role":"activator","unit":"SK-0001","unit_role":"activator",
            "reference_time":"2026-11-03T00:00:00Z","expected_generation":f.generation]
        let result=try await success(call(f.worker,"logbook_award_progress",params))
        let candidate=try XCTUnwrap((result["activationCandidates"] as? [[String:Any]])?.first)
        XCTAssertEqual(candidate["physicalRows"] as? Int,10)
        XCTAssertEqual(candidate["countableContacts"] as? Int,9)
        XCTAssertEqual(candidate["programmeLogRecords"] as? Int,9)
        XCTAssertEqual(candidate["unknownEligibilityRows"] as? Int,1)
        XCTAssertEqual(candidate["thresholdReached"] as? Bool,false)
        XCTAssertEqual(candidate["candidateStatus"] as? String,"incomplete")
        XCTAssertTrue((candidate["reasons"] as? [String] ?? []).contains{$0.contains("BOGUS") && $0.contains("ADIF 3.1.8")})
        let begin=try await success(call(f.worker,"logbook_export_adif",["action":"begin","scope":"selected","ids":contacts.prefix(10).map{$0.id.uuidString}]))
        let token=try XCTUnwrap(begin["token"] as? String)
        let response=try await success(call(f.worker,"logbook_export_adif",["action":"pota_preview","token":token]))
        let preview=try XCTUnwrap(response["preview"] as? [String:Any])
        XCTAssertEqual(preview["physicalContacts"] as? Int,10)
        XCTAssertEqual(preview["includedContacts"] as? Int,9)
        XCTAssertEqual(preview["derivedRecords"] as? Int,9)
        let issue=try XCTUnwrap((preview["issues"] as? [[String:Any]])?.first)
        XCTAssertEqual((issue["contactID"] as? String)?.uppercased(),contacts[9].id.uuidString.uppercased())
        XCTAssertTrue((issue["message"] as? String ?? "").contains("BOGUS"))
        XCTAssertEqual(try db.fetchAll(),before)
        XCTAssertEqual(try db.lookup(localID:contacts[9].id)?.submode,"BOGUS")
        try db.save(contacts[10])
        let reached=try await success(call(f.worker,"logbook_award_progress",params))
        let known=try XCTUnwrap((reached["activationCandidates"] as? [[String:Any]])?.first)
        XCTAssertEqual(known["physicalRows"] as? Int,11)
        XCTAssertEqual(known["countableContacts"] as? Int,10)
        XCTAssertEqual(known["unknownEligibilityRows"] as? Int,1)
        XCTAssertEqual(known["thresholdReached"] as? Bool,true)
        XCTAssertEqual(known["candidateStatus"] as? String,"local candidate")
    }

    func testNonrelativeDXCCWireKeepsStableWarmCacheAcrossReferenceTimes() async throws {
        let gate=Gate([]),f=try fixture(gate)
        let first:[String:Any]=["programme":"dxcc","reference_time":"2026-11-03T00:00:00Z","expected_generation":f.generation]
        var second=first;second["reference_time"]="2026-11-05T00:00:00Z"
        let a=try f.service.aggregateQuery(method:"logbook_award_progress",params:first)
        let b=try f.service.aggregateQuery(method:"logbook_award_progress",params:second)
        XCTAssertEqual(a.referenceTime,0)
        XCTAssertEqual(b.referenceTime,0)
        XCTAssertEqual(try a.request(),try b.request())
        let cold=try await success(call(f.worker,"logbook_award_progress",first))
        let warm=try await success(call(f.worker,"logbook_award_progress",second))
        XCTAssertEqual(cold["workedUnits"] as? Int,1)
        XCTAssertEqual(warm["workedUnits"] as? Int,1)
        XCTAssertEqual(cold["logbook_revision"] as? Int,warm["logbook_revision"] as? Int)
        XCTAssertEqual(gate.count(.localAwards),1,"Ordinary DXCC has no clock-dependent counting rule; timestamps must not defeat the warm cache.")
    }

    func testPOTAWireSupportsOperatorOnlyWithoutMergingOperatorsOrClubCredit() async throws {
        let gate=Gate([]),f=try fixture(gate)
        let reference=try f.service.referenceDirectoryURL().appendingPathComponent("pota-parks.csv")
        try Data("reference,name,locationDesc,active\nSK-0001,Synthetic park,SK-BL,1\n".utf8).write(to:reference)
        let day=try XCTUnwrap(LogbookQuery.absoluteUTCDate("2026-11-02T12:00:00Z"))
        var contacts=(0..<10).map { index in
            QSO(call:"K\(index+1)SYN",start:day.addingTimeInterval(Double(index)*60),band:"20m",mode:"CW",
                operatorCall:"OM0RX/P",myCall:"",myGrid:"JN98",extraFields:["MY_DXCC":"504","MY_STATE":"SK-BL","MY_POTA_REF":"SK-0001"])
        }
        var other=contacts[0];other.id=UUID();other.operatorCall="OM0ZZ/P"
        var operatorSelf=contacts[0];operatorSelf.id=UUID();operatorSelf.call="OM0RX/P"
        var club=contacts[0];club.id=UUID();club.myCall="OM0CLUB"
        var clubDuplicate=club;clubDuplicate.id=UUID();clubDuplicate.operatorCall="OM0ZZ/P"
        var clubSelf=club;clubSelf.id=UUID();clubSelf.call="OM0CLUB"
        var clubOperatorSelf=clubDuplicate;clubOperatorSelf.id=UUID();clubOperatorSelf.call="OM0ZZ/P"
        contacts += [other,operatorSelf,club,clubDuplicate,clubSelf,clubOperatorSelf]
        for contact in contacts { try f.service.openedDatabase().save(contact) }
        let params:[String:Any]=["programme":"pota","role":"activator","unit":"SK-0001","unit_role":"activator",
            "reference_time":"2026-11-03T00:00:00Z","expected_generation":f.generation]
        func progress(_ identity:String) async throws -> [String:Any] {
            var scoped=params;scoped["station_scope"]="\(identity) · own DXCC 504 · subdivision BL"
            return try await success(call(f.worker,"logbook_award_progress",scoped))
        }
        let individual=try await progress("OM0RX/P")
        let summary=try XCTUnwrap((individual["activationCandidates"] as? [[String:Any]])?.first)
        XCTAssertEqual(summary["countableContacts"] as? Int,10)
        XCTAssertEqual(summary["candidateStatus"] as? String,"local candidate")
        XCTAssertEqual(summary["excludedRows"] as? Int,1)
        XCTAssertEqual(individual["evidenceTotal"] as? Int,11)
        let evidence=try XCTUnwrap(individual["evidence"] as? [[String:Any]])
        XCTAssertTrue(evidence.allSatisfy { ($0["recordedContext"] as? String)?.hasPrefix("Unknown station") == true },"Fallback must not rewrite missing recorded STATION_CALLSIGN evidence.")
        XCTAssertTrue(evidence.allSatisfy { ($0["pota"] as? [String:Any])?["stationCall"] as? String == "OM0RX/P" })
        let separate=try await progress("OM0ZZ/P")
        let separateDay=try XCTUnwrap((separate["activationCandidates"] as? [[String:Any]])?.first)
        XCTAssertEqual(separateDay["countableContacts"] as? Int,1)
        XCTAssertEqual(separateDay["candidateStatus"] as? String,"below threshold")
        let clubResult=try await progress("OM0CLUB")
        let clubDay=try XCTUnwrap((clubResult["activationCandidates"] as? [[String:Any]])?.first)
        XCTAssertEqual(clubDay["countableContacts"] as? Int,1,"A second operator does not duplicate a station-owned programme contact.")
        XCTAssertEqual(clubDay["duplicateProgrammeRecords"] as? Int,1)
        XCTAssertEqual(clubDay["excludedRows"] as? Int,2,"Both the recorded station and individual operator self contacts are excluded.")
        XCTAssertEqual(clubResult["evidenceTotal"] as? Int,4)
        XCTAssertEqual((individual["scopes"] as? [String])?.filter{!$0.hasPrefix("Unknown station")}.count,3)
        XCTAssertEqual(gate.count(.localAwards),1,"Scope selection uses one native counting snapshot.")
    }

    func testHeldCatalogueLeavesSaveFirstPageColdStatsAndSettingsUsable() async throws {
        let gate = Gate(), f = try fixture(gate)
        defer { gate.release() }
        let catalogue = try call(f.worker, "logbook_catalog", ["limit": 5])
        try await waitHeld(gate, kind: .catalogue, call: catalogue)
        let save = try call(f.worker, "logbook_save", ["qso": wireQSO()])
        try await beforeRelease([save], gate: gate)
        _ = try await success(save)
        let page = try call(f.worker, "logbook_list", ["limit": 20, "offset": 0, "search": ""])
        let stats = try call(f.worker, "logbook_stats")
        let duplicate = try call(f.worker, "logbook_duplicate", ["call": "JA1NEXT", "band": "20m", "mode": "CW"])
        let status = try call(f.worker, "workspace_status")
        let settings = try call(f.worker, "settings_load")
        try await beforeRelease([page, stats, duplicate, status, settings], gate: gate)
        XCTAssertFalse(catalogue.reply.finished, "Catalogue must still be held when foreground and cold stats finish.")
        let contacts = try await success(page)
        XCTAssertEqual(contacts["total"] as? Int, 2)
        let totals = try await success(stats)
        XCTAssertEqual((totals["stats"] as? [String: Any])?["qso_count"] as? Int, 2)
        XCTAssertEqual(totals["workspace_generation"] as? String, f.generation)
        XCTAssertEqual(totals["logbook_revision"] as? Int64, try f.service.openedDatabase().currentRevision())
        let worked = try await success(duplicate), currentStatus = try await success(status)
        XCTAssertNotNil(worked["last_worked_at"] as? String)
        XCTAssertEqual(currentStatus["qso_count"] as? Int, 2)
        _ = try await success(settings)
        gate.release()
        let progress = try await success(catalogue)
        XCTAssertEqual(progress["logbook_revision"] as? Int64, try f.service.openedDatabase().currentRevision())
        XCTAssertEqual(gate.count(.catalogue), 2, "The cancelled old revision must be retried once for current demand.")
    }

    func testHeldExportConversionLeavesForegroundUsableAndRevalidatesBeforeTokenAdmission() async throws {
        let gate=Gate(), conversion=ExportGate(), f=try fixture(gate,exportGate:conversion)
        defer { conversion.release();gate.release() }
        let export=try call(f.worker,"logbook_export_adif",["action":"begin","scope":"all","expected_generation":f.generation])
        let entered=try await waitUntil { conversion.entered || export.reply.finished }
        XCTAssertTrue(entered)
        XCTAssertTrue(conversion.entered)
        XCTAssertFalse(export.reply.finished)
        let save=try call(f.worker,"logbook_save",["qso":wireQSO()])
        let settings=try call(f.worker,"settings_load"),draft=try call(f.worker,"logbook_operator_draft")
        let status=try call(f.worker,"workspace_status")
        let finished=try await waitUntil { [save,settings,draft,status].allSatisfy{$0.reply.finished} }
        if !finished { conversion.release() }
        XCTAssertTrue(finished,"Frozen ADIF conversion held the shared draft/settings lock.")
        for request in [save,settings,draft,status] { _=try await success(request) }
        let page=try call(f.worker,"logbook_list",["limit":20])
        let pageFinished=try await waitUntil { page.reply.finished }
        if !pageFinished { conversion.release() }
        XCTAssertTrue(pageFinished)
        let listed=try await success(page)
        XCTAssertEqual(listed["total"] as? Int,2)
        XCTAssertFalse(export.reply.finished)
        conversion.release()
        let admitted=try await success(export)
        XCTAssertEqual(admitted["total"] as? Int,2,"The changed revision must be recaptured before a token is admitted.")
        let data=try await success(call(f.worker,"logbook_export_adif",["action":"read","token":admitted["token"]!]))
        let text=try XCTUnwrap(data["text"] as? String)
        XCTAssertEqual(Set(ADIFParser().records(in:text).compactMap{$0["CALL"]}),["JA1BASE","JA1NEXT"])
    }

    func testShutdownRetiresHeldExportPreparationWithoutAdmittingOrReopeningItsSnapshot() async throws {
        let conversion=ExportGate(),f=try fixture(Gate(),exportGate:conversion)
        defer { conversion.release() }
        let export=try call(f.worker,"logbook_export_adif",["action":"begin","scope":"all","expected_generation":f.generation])
        let entered=try await waitUntil { conversion.entered || export.reply.finished }
        XCTAssertTrue(entered);XCTAssertTrue(conversion.entered);XCTAssertFalse(export.reply.finished)
        let completed=Reply()
        let shutdown=Task { await f.worker.shutdown();completed.finish() }
        let stopped=try await waitUntil { completed.finished }
        if !stopped { conversion.release() }
        XCTAssertTrue(stopped,"Optional export preparation must not hold the shared worker owner during shutdown.")
        await shutdown.value
        conversion.release()
        let rejected=try await object(export)
        XCTAssertEqual(rejected["ok"] as? Bool,false)
        XCTAssertEqual((rejected["error"] as? [String:Any])?["code"] as? String,"worker_stopping")
        XCTAssertNil(rejected["result"])
    }

    func testConcurrentContactPageFramesDrainWithoutCancellingTheirSharedQuery() async throws {
        let gate = Gate([.contacts]), waiting = WaitingRequests(), f = try fixture(Gate([]))
        defer { gate.release() }
        for index in 1..<100 {
            try f.service.openedDatabase().save(QSO(call: "K1PAGE\(index)",
                start: Date(timeIntervalSince1970: 1_700_000_000 + Double(index)), band: "20m", mode: "CW"))
        }
        let reads = LiveLogbookAggregateReads(service: f.service, evaluate: { snapshot, cancellation in
            // Match the Desk's completed first frame followed by four concurrent
            // remaining frames. Only that first remaining evaluation is held.
            if snapshot.request.offset == 0 { return try snapshot.evaluate(cancellation: cancellation) }
            return try gate.evaluate(snapshot, cancellation)
        }, onWaitForTesting: { waiting.observe($0) })
        addTeardownBlock { await reads.terminate() }
        let first = try await reads.handle(method: "logbook_list", params: ["offset": 0, "limit": 20])
        XCTAssertEqual(first.payload["total"] as? Int, 100)
        let parameters: [[String: Any]] = [20, 40, 60, 80].map { ["offset": $0, "limit": 20] }
        let held = Task { try await reads.handle(method: "logbook_list", params: parameters[0]) }
        let entered = try await waitUntil { gate.count(.contacts) == 1 }
        XCTAssertTrue(entered)
        let rest = parameters.dropFirst().map { params in
            Task { try await reads.handle(method: "logbook_list", params: params) }
        }
        let allWaiting = try await waitUntil { waiting.offsets.isSuperset(of: [40, 60, 80]) }
        XCTAssertTrue(allWaiting, "Every remaining frame must reach the held flight before release.")
        XCTAssertFalse(gate.cancelled(.contacts), "Pagination within one query must not cancel a valid page.")
        gate.release()
        for (index, task) in ([held] + rest).enumerated() {
            do {
                let actual = try await task.value
                let expected = try f.service.handle(method: "logbook_list", params: parameters[index])
                XCTAssertEqual(try JSONSerialization.data(withJSONObject: actual.payload, options: [.sortedKeys]),
                               try JSONSerialization.data(withJSONObject: expected, options: [.sortedKeys]))
            } catch { XCTFail("Contact frame \(parameters[index]) failed: \(error)") }
        }
        XCTAssertEqual(gate.count(.contacts), 4, "Each remaining page must be evaluated exactly once.")
    }

    func testCompatibleContactLimitsStayDistinctWhileIdenticalPagesShareWork() async throws {
        let gate = Gate([.contacts]), waiting = WaitingRequests(), f = try fixture(Gate([]))
        defer { gate.release() }
        for index in 1..<35 {
            try f.service.openedDatabase().save(QSO(call: "K1LIMIT\(index)",
                start: Date(timeIntervalSince1970: 1_700_000_000 + Double(index)), band: "20m", mode: "CW"))
        }
        let reads = contactReads(f, gate: gate, waiting: waiting)
        let query: [String: Any] = ["version": 1, "join": "all",
            "clauses": [["field": "date", "op": "relative", "values": ["today"]]]]
        let parameters: [[String: Any]] = [(0, 20), (0, 20), (0, 5), (20, 15)].map { offset, limit in
            ["offset": offset, "limit": limit, "query": query, "reference_time": "2023-11-14T12:00:00Z"]
        }
        let held = Task { try await reads.handle(method: "logbook_list", params: parameters[0]) }
        let entered = try await waitUntil { gate.count(.contacts) == 1 }
        XCTAssertTrue(entered)
        let rest = parameters.dropFirst().map { params in
            Task { try await reads.handle(method: "logbook_list", params: params) }
        }
        let allWaiting = try await waitUntil { waiting.count == 3 }
        XCTAssertTrue(allWaiting)
        XCTAssertFalse(gate.cancelled(.contacts))
        gate.release()
        for (index, task) in ([held] + rest).enumerated() {
            try assertContactPage(try await task.value, params: parameters[index], service: f.service)
        }
        XCTAssertEqual(gate.count(.contacts), 3, "Only the exact duplicate may share a result; other limits remain separate pages.")
    }

    func testDifferentContactPredicatesAndFrozenTimesStillCancelTheHeldRead() async throws {
        func query(_ field: String, _ op: String, _ value: String) -> [String: Any] {
            ["version": 1, "join": "all", "clauses": [["field": field, "op": op, "values": [value]]]]
        }
        let relative = query("date", "relative", "today")
        let scenarios: [(String, [String: Any], [String: Any])] = [
            ("search", ["search": "JA"], ["search": "K1"]),
            ("query", ["query": query("band", "eq", "20m")], ["query": query("band", "eq", "40m")]),
            ("frozen clock", ["query": relative, "reference_time": "2023-11-14T12:00:00Z"],
                             ["query": relative, "reference_time": "2023-11-15T12:00:00Z"])
        ]
        for (label, firstQuery, secondQuery) in scenarios {
            let gate = Gate([.contacts]), waiting = WaitingRequests(), f = try fixture(Gate([]))
            defer { gate.release() }
            let reads = contactReads(f, gate: gate, waiting: waiting)
            var firstParams = firstQuery, secondParams = secondQuery
            firstParams["offset"] = 0; firstParams["limit"] = 1
            secondParams["offset"] = 1; secondParams["limit"] = 2
            let first = Task { try await reads.handle(method: "logbook_list", params: firstParams) }
            let entered = try await waitUntil { gate.count(.contacts) == 1 }
            XCTAssertTrue(entered, label)
            let second = Task { try await reads.handle(method: "logbook_list", params: secondParams) }
            let joined = try await waitUntil { waiting.count == 1 }
            XCTAssertTrue(joined, label)
            XCTAssertTrue(gate.cancelled(.contacts), "Changed \(label) must retain cancellation semantics.")
            gate.release()
            var successes = 0
            for (task, params) in [(first, firstParams), (second, secondParams)] {
                do {
                    try assertContactPage(try await task.value, params: params, service: f.service)
                    successes += 1
                } catch {
                    XCTAssertEqual((error as? WorkerFailure)?.code, "logbook_refresh_superseded", label)
                }
            }
            XCTAssertGreaterThan(successes, 0, "The bounded replacement must settle after \(label) contention ends.")
        }
    }

    func testContactRevisionChangeCancelsCompatibleWaitersAndOnlyPublishesTheNewRevision() async throws {
        let gate = Gate([.contacts]), waiting = WaitingRequests(), f = try fixture(Gate([]))
        defer { gate.release() }
        let reads = contactReads(f, gate: gate, waiting: waiting)
        let parameters: [[String: Any]] = [0, 1, 2].map {
            ["offset": $0, "limit": 1, "expected_generation": f.generation]
        }
        let first = Task { try await reads.handle(method: "logbook_list", params: parameters[0]) }
        let entered = try await waitUntil { gate.count(.contacts) == 1 }
        XCTAssertTrue(entered)
        let second = Task { try await reads.handle(method: "logbook_list", params: parameters[1]) }
        let joined = try await waitUntil { waiting.offsets.contains(1) }
        XCTAssertTrue(joined)
        XCTAssertFalse(gate.cancelled(.contacts))
        try f.service.openedDatabase().save(QSO(call: "K1REVISION", band: "40m", mode: "SSB"))
        let revision = try f.service.openedDatabase().currentRevision()
        let third = Task { try await reads.handle(method: "logbook_list", params: parameters[2]) }
        let changed = try await waitUntil { waiting.offsets.contains(2) }
        XCTAssertTrue(changed)
        XCTAssertTrue(gate.cancelled(.contacts), "A new database revision must not join the old page family.")
        gate.release()
        for (index, task) in [first, second, third].enumerated() {
            let reply = try await task.value
            XCTAssertEqual(reply.payload["logbook_revision"] as? Int64, revision)
            XCTAssertEqual(reply.payload["total"] as? Int, 2)
            try assertContactPage(reply, params: parameters[index], service: f.service)
        }
        XCTAssertEqual(gate.count(.contacts), 4, "The old flight drains once; each requested page then reads the new revision once.")
    }

    func testContactWorkspaceRetirementRejectsHeldAndWaitingOldGenerationPages() async throws {
        let gate = Gate([.contacts], cancellationAware: true), waiting = WaitingRequests(), f = try fixture(Gate([]))
        defer { gate.release() }
        let backup = try f.service.handle(method: "backup_create", params: ["name": "contact-generation"])
        let name = try XCTUnwrap(backup["name"] as? String)
        let revision = try f.service.openedDatabase().currentRevision()
        let reads = contactReads(f, gate: gate, waiting: waiting)
        let first = Task { try await reads.handle(method: "logbook_list",
            params: ["offset": 0, "limit": 1, "expected_generation": f.generation]) }
        let entered = try await waitUntil { gate.count(.contacts) == 1 }
        XCTAssertTrue(entered)
        let second = Task { try await reads.handle(method: "logbook_list",
            params: ["offset": 1, "limit": 1, "expected_generation": f.generation]) }
        let joined = try await waitUntil { waiting.offsets.contains(1) }
        XCTAssertTrue(joined)
        XCTAssertFalse(gate.cancelled(.contacts))
        await reads.suspendForWorkspaceChange()
        _ = try f.service.handle(method: "backup_restore", params: restoreParameters(name))
        let generation = try XCTUnwrap(f.service.handle(method: "workspace_status", params: [:])["generation"] as? String)
        await reads.finishWorkspaceChange()
        XCTAssertNotEqual(generation, f.generation)
        XCTAssertEqual(try f.service.openedDatabase().currentRevision(), revision)
        for task in [first, second] {
            do { _ = try await task.value; XCTFail("An old-generation contact page was published.") }
            catch { XCTAssertEqual((error as? WorkerFailure)?.code, "logbook_refresh_retired") }
        }
        let freshParams: [String: Any] = ["offset": 0, "limit": 1, "expected_generation": generation]
        let fresh = try await reads.handle(method: "logbook_list", params: freshParams)
        XCTAssertEqual(fresh.payload["workspace_generation"] as? String, generation)
        try assertContactPage(fresh, params: freshParams, service: f.service)
        XCTAssertEqual(gate.count(.contacts), 2, "Waiting old-generation pages must not start another read.")
    }

    func testContactTerminationRejectsHeldWaitingAndFuturePages() async throws {
        let gate = Gate([.contacts], cancellationAware: true), waiting = WaitingRequests(), f = try fixture(Gate([]))
        defer { gate.release() }
        let reads = contactReads(f, gate: gate, waiting: waiting)
        let first = Task { try await reads.handle(method: "logbook_list", params: ["offset": 0, "limit": 1]) }
        let entered = try await waitUntil { gate.count(.contacts) == 1 }
        XCTAssertTrue(entered)
        let second = Task { try await reads.handle(method: "logbook_list", params: ["offset": 1, "limit": 1]) }
        let joined = try await waitUntil { waiting.offsets.contains(1) }
        XCTAssertTrue(joined)
        XCTAssertFalse(gate.cancelled(.contacts))
        await reads.terminate()
        for (index, task) in [first, second].enumerated() {
            do { _ = try await task.value; XCTFail("A terminal contact page was published.") }
            catch {
                // The existing owner reports terminal completion to its active
                // read and epoch retirement to a distinct waiting request.
                XCTAssertEqual((error as? WorkerFailure)?.code,
                               index == 0 ? "worker_stopping" : "logbook_refresh_retired")
            }
        }
        do { _ = try await reads.handle(method: "logbook_list", params: [:]); XCTFail("A read reopened after termination.") }
        catch { XCTAssertEqual((error as? WorkerFailure)?.code, "worker_stopping") }
        XCTAssertEqual(gate.count(.contacts), 1)
    }

    func testIdenticalCatalogueWorkIsSharedButPagesKeepTheirOwnFilters() async throws {
        let gate = Gate(), f = try fixture(gate)
        defer { gate.release() }
        let parameters: [[String: Any]] = [["limit": 5, "offset": 0], ["limit": 5, "offset": 5],
                                           ["limit": 5, "offset": 0, "search": "Chinese"]]
        let calls = try parameters.map { try call(f.worker, "logbook_catalog", $0) }
        try await waitHeld(gate, kind: .catalogue, call: calls[0])
        XCTAssertEqual(gate.count(.catalogue), 1)
        gate.release()
        for (index, request) in calls.enumerated() {
            let actual = try await success(request)
            let expected = try f.service.handle(method: "logbook_catalog", params: parameters[index])
            XCTAssertEqual(try JSONSerialization.data(withJSONObject: actual, options: [.sortedKeys]),
                           try JSONSerialization.data(withJSONObject: expected, options: [.sortedKeys]))
        }
        XCTAssertEqual(gate.count(.catalogue), 1)
    }

    func testRevisionChurnCannotPublishOrCacheTheHeldOldStatistics() async throws {
        let gate = Gate([.statistics]), f = try fixture(gate)
        defer { gate.release() }
        let first = try call(f.worker, "logbook_stats")
        try await waitHeld(gate, kind: .statistics, call: first)
        try f.service.openedDatabase().save(QSO(call: "K1EXTERNAL", band: "40m", mode: "SSB"))
        let second = try call(f.worker, "logbook_stats")
        let cancelled = try await waitUntil { gate.cancelled(.statistics) }
        XCTAssertTrue(cancelled)
        gate.release()
        for request in [first, second] {
            let value = try await success(request)
            XCTAssertEqual((value["stats"] as? [String: Any])?["qso_count"] as? Int, 2)
            XCTAssertEqual(value["logbook_revision"] as? Int64, try f.service.openedDatabase().currentRevision())
        }
        XCTAssertEqual(gate.count(.statistics), 2)
        XCTAssertEqual(try f.service.openedDatabase().stats().qsoCount, 2)
    }

    func testSameRevisionRestoreDrainsAndRejectsTheOldGenerationBeforeAdmission() async throws {
        let gate = Gate(cancellationAware: true), f = try fixture(gate)
        defer { gate.release() }
        let backup = try f.service.handle(method: "backup_create", params: ["name": "same-revision"])
        let name = try XCTUnwrap(backup["name"] as? String)
        let revision = try f.service.openedDatabase().currentRevision()
        let old = try call(f.worker, "logbook_catalog")
        try await waitHeld(gate, kind: .catalogue, call: old)
        let restore = try call(f.worker, "backup_restore", restoreParameters(name))
        try await beforeRelease([restore], gate: gate)
        _ = try await success(restore)
        let generation = try XCTUnwrap(f.service.handle(method: "workspace_status", params: [:])["generation"] as? String)
        XCTAssertNotEqual(generation, f.generation)
        XCTAssertEqual(try f.service.openedDatabase().currentRevision(), revision)
        let mismatch = try await object(call(f.worker, "logbook_stats", ["expected_generation": f.generation]))
        XCTAssertEqual((mismatch["error"] as? [String: Any])?["code"] as? String, "logbook_refresh_retired")
        XCTAssertEqual(gate.count(.statistics), 0, "An old generation must be rejected before any capture/evaluation.")
        let fresh = try await success(call(f.worker, "logbook_stats"))
        XCTAssertEqual(fresh["workspace_generation"] as? String, generation)
        let earlier = try await object(old)
        if earlier["ok"] as? Bool == true {
            XCTAssertEqual((earlier["result"] as? [String: Any])?["workspace_generation"] as? String, generation)
        } else {
            XCTAssertEqual((earlier["error"] as? [String: Any])?["code"] as? String, "logbook_refresh_retired")
        }
    }

    func testRejectedRestoreResumesAndShutdownClosesAllReaders() async throws {
        let gate = Gate([.statistics, .catalogue], cancellationAware: true), f = try fixture(gate)
        defer { gate.release() }
        let stats = try call(f.worker, "logbook_stats")
        try await waitHeld(gate, kind: .statistics, call: stats)
        let restore = try call(f.worker, "backup_restore", restoreParameters("missing.xlogbackup"))
        try await beforeRelease([restore], gate: gate)
        let rejectedRestore = try await object(restore)
        XCTAssertEqual(rejectedRestore["ok"] as? Bool, false)
        let resumed = try await success(call(f.worker, "logbook_stats", ["expected_generation": f.generation]))
        XCTAssertEqual(resumed["workspace_generation"] as? String, f.generation)
        _ = await stats.task.value
        let catalogue = try call(f.worker, "logbook_catalog")
        try await waitHeld(gate, kind: .catalogue, call: catalogue)
        let stopped = Reply()
        let shutdown = Task { _ = await f.worker.shutdown(); stopped.finish() }
        let terminated = try await waitUntil { stopped.finished }
        XCTAssertTrue(terminated)
        if !stopped.finished { gate.release() }
        await shutdown.value
        _ = await catalogue.task.value
        let rejected = try await object(call(f.worker, "logbook_stats"))
        XCTAssertEqual((rejected["error"] as? [String: Any])?["code"] as? String, "worker_stopping")
        let db = try f.service.openedDatabase(), path = db.url
        db.close()
        let moved = path.deletingLastPathComponent().appendingPathComponent("closed-reader.sqlite")
        try FileManager.default.moveItem(at: path, to: moved)
        try FileManager.default.moveItem(at: moved, to: path)
    }

    func testFailedWorkDoesNotPoisonTheSharedEntryOrHideCorruption() async throws {
        let gate = Gate([], failFirst: true), f = try fixture(gate)
        let failed = try await object(call(f.worker, "logbook_catalog"))
        XCTAssertEqual(failed["ok"] as? Bool, false)
        let code = (failed["error"] as? [String: Any])?["code"] as? String
        XCTAssertNotEqual(code, "logbook_refresh_superseded")
        XCTAssertNotEqual(code, "logbook_refresh_retired")
        _ = try await success(call(f.worker, "logbook_catalog"))
        XCTAssertEqual(gate.count(.catalogue), 2)
    }

    func testBoundsAndGenerationMismatchFailBeforeBackgroundAdmission() async throws {
        let gate = Gate([]), f = try fixture(gate)
        for (method, params) in [("logbook_stats", ["unexpected": true] as [String: Any]),
                                 ("logbook_stats", ["expected_generation": "invalid"]),
                                 ("logbook_catalog", ["limit": 26]), ("logbook_catalog", ["offset": -1]),
                                 ("logbook_export_adif", ["action":"begin","scope":"all","expected_generation":"invalid"])] {
            let failed = try await object(call(f.worker, method, params))
            XCTAssertEqual((failed["error"] as? [String: Any])?["code"] as? String, "invalid_params")
        }
        let mismatch = try await object(call(f.worker, "logbook_catalog", ["expected_generation": UUID().uuidString]))
        XCTAssertEqual((mismatch["error"] as? [String: Any])?["code"] as? String, "logbook_refresh_retired")
        XCTAssertEqual(gate.count(.catalogue), 0)
        let staleExport=try await object(call(f.worker,"logbook_export_adif",["action":"begin","scope":"all","expected_generation":UUID().uuidString]))
        XCTAssertEqual((staleExport["error"] as? [String:Any])?["code"] as? String,"logbook_refresh_retired")
        XCTAssertEqual(gate.count(.exportContacts),0)
        let valid = try await success(call(f.worker, "logbook_catalog", ["expected_generation": f.generation.uppercased()]))
        XCTAssertEqual(valid["workspace_generation"] as? String, f.generation)
    }

    func testColdOldGenerationIsRetiredBeforeOpeningButFreshRequestsStillValidateTheDatabase() async throws {
        let gate = Gate([]), f = try fixture(gate)
        let db = try f.service.openedDatabase()
        db.close()
        let newGeneration = UUID()
        try JSONEncoder().encode(newGeneration).write(
            to: f.service.workspaceDirectoryURL.appendingPathComponent("edit-generation.json"), options: .atomic)
        // Deliberately corrupt only this disposable closed fixture. An expected
        // old generation must be rejected without reaching full bootstrap;
        // dropping that expectation must still encounter the real validation.
        try Data("not a SQLite database".utf8).write(to: db.url, options: .atomic)
        let profile = AppRuntimeProfile.contestingTest(supportRoot: f.root)
        let cold = LiveLogbookMethods(supportDirectory: f.root, inheritNativePreferences: false, runtimeProfile: profile)
        let reads = LiveLogbookAggregateReads(service: cold, evaluate: { try gate.evaluate($0, $1) })
        do {
            _ = try await reads.handle(method: "logbook_stats", params: ["expected_generation": f.generation])
            XCTFail("The old generation was admitted.")
        } catch { XCTAssertEqual((error as? WorkerFailure)?.code, "logbook_refresh_retired") }
        do {
            _ = try await reads.handle(method: "logbook_stats", params: [:])
            XCTFail("A malformed database bypassed routine full validation.")
        } catch { XCTAssertNotEqual((error as? WorkerFailure)?.code, "logbook_refresh_retired") }
        XCTAssertEqual(gate.count(.statistics), 0)
        await reads.terminate()
    }
}

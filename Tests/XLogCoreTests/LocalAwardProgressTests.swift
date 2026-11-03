import Foundation
import Testing
@testable import XLogCore

struct LocalAwardProgressTests {
    @Test func iotaCombinesKnownCountryLocationsAndRetainsExactEvidence() throws {
        var first=qso("G1ABC",dxcc:223,continent:"EU",refs:["IOTA":"EU-005"])
        first.stationLocation="Bratislava"
        var second=qso("JA1ABC",dxcc:339,continent:"AS",refs:["IOTA":"AS-007"])
        second.myGrid="JN88";second.stationLocation="Mountain"
        var other=second;other.id=UUID();other.extraFields["MY_DXCC"]="150"
        var unknownA=first;unknownA.id=UUID();unknownA.extraFields.removeValue(forKey:"MY_DXCC")
        var unknownB=second;unknownB.id=UUID();unknownB.extraFields.removeValue(forKey:"MY_DXCC")
        let result=try LocalAwardEngine.compute(contacts:[first,second,other,unknownA,unknownB].map(AwardEvidenceContact.init),programme:"iota")
        #expect(result.scopes.count == 4)
        let scope=try #require(result.scopes.first{$0.contains("504")})
        let matrix=try result.projection(scope:scope,band:"",mode:"Mixed",role:"HF",unit:"",offset:0,limit:20)
        #expect(matrix["workedUnits"] as? Int == 2)
        #expect(matrix["supportingQSOs"] as? Int == 2)
        let evidence=try result.projection(scope:scope,band:"",mode:"Mixed",role:"HF",unit:"AS-007",unitRole:"HF",offset:0,limit:20)
        let row=try #require((evidence["evidence"] as? [[String:Any]])?.first)
        #expect(row["recordedGrid"] as? String == "JN88")
        #expect(row["recordedLocation"] as? String == "Mountain")
        #expect(row["id"] as? String == second.id.uuidString)
        let otherProgramme=try LocalAwardEngine.compute(contacts:[first,second].map(AwardEvidenceContact.init),programme:"dxcc")
        #expect(otherProgramme.scopes.count == 2)
        let db=try LogbookDatabase(url:FileManager.default.temporaryDirectory.appendingPathComponent("award-locations-\(UUID()).sqlite"))
        for q in [first,second] { try db.save(q) }
        var request=try LogbookAggregateRequest.current(.localAwards)
        request.programme="iota";request.referenceDirectory=FileManager.default.temporaryDirectory.path
        request.referenceVersion=try ActivationReferenceDirectory.fingerprint(directory:FileManager.default.temporaryDirectory)
        request.query = .init(clauses:[.init("ownGrid","eq",["JN88"])])
        let cancellation=LogbookAggregateCancellation()
        let snapshot=try LogbookDatabase.readAggregateSnapshot(at:db.url,authority:db.aggregateReadAuthority(),request:request,cancellation:cancellation)
        guard case .localAwards(let filtered)=try snapshot.evaluate(cancellation:cancellation).value else { Issue.record("Wrong aggregate");return }
        #expect(filtered.units.count == 1)
        #expect(filtered.units.first?.scope == scope)
        #expect(filtered.units.first?.evidence.map(\.id) == [second.id])
    }

    private func potaRows(_ count:Int) -> [QSO] {
        (0..<count).map { i in qso("K\(i+1)ABC",dxcc:291,continent:"NA",refs:["MY_POTA_REF":"SK-0001","MY_STATE":"SK-BL"]) }
    }
    private func potaDays(_ qsos:[QSO],park:String="SK-0001",now:Date=Date(timeIntervalSince1970:1800000000)) throws -> [[String:Any]] {
        let directory=ActivationReferenceDirectory(records:[.init(kind:.pota,reference:"SK-0001",name:"Park"),.init(kind:.pota,reference:"SK-0002",name:"Second park")])
        let result=try LocalAwardEngine.compute(contacts:qsos.map(AwardEvidenceContact.init),programme:"pota",directory:directory,at:now)
        let page=try result.projection(scope:"",band:"",mode:"Mixed",role:"activator",unit:park,unitRole:"activator",offset:0,limit:20)
        #expect(page["evidenceTotal"] as? Int == qsos.count)
        return try #require(page["activationCandidates"] as? [[String:Any]])
    }
    @Test func potaLocalThresholdDeduplicatesPublishedKeysAndUTC() throws {
        let rows=potaRows(10)
        let below=try #require(potaDays(Array(rows.prefix(9))).first)
        #expect(below["candidateStatus"] as? String == "below threshold")
        let ten=try #require(potaDays(rows).first)
        #expect(ten["candidateStatus"] as? String == "local candidate")
        #expect(ten["countableContacts"] as? Int == 10)
        var duplicate=rows[0];duplicate.id=UUID();duplicate.start=duplicate.start.addingTimeInterval(60)
        let eleven=try #require(potaDays(rows+[duplicate]).first)
        #expect(eleven["physicalRows"] as? Int == 11)
        #expect(eleven["countableContacts"] as? Int == 10)
        #expect(eleven["programmeLogRecords"] as? Int == 10)
        #expect(eleven["duplicateProgrammeRecords"] as? Int == 1)
        var band=rows[0];band.id=UUID();band.band="40m"
        var mode=rows[0];mode.id=UUID();mode.mode="MFSK";mode.submode="FT4"
        var localMode=mode;localMode.id=UUID();localMode.mode="FT4";localMode.submode=""
        #expect(localMode.adifRecord["MODE"] == mode.adifRecord["MODE"])
        #expect(localMode.adifRecord["SUBMODE"] == mode.adifRecord["SUBMODE"])
        var next=rows[0];next.id=UUID();next.start=Date(timeIntervalSince1970:1735776000)
        var boundary=rows[0];boundary.id=UUID();boundary.start=next.start.addingTimeInterval(-1)
        let days=try potaDays([boundary,next,band,mode,localMode])
        #expect(days.count == 2)
        #expect(days.first?["countableContacts"] as? Int == 1)
        #expect(days.last?["countableContacts"] as? Int == 3)
        #expect(days.last?["duplicateProgrammeRecords"] as? Int == 1)
    }
    @Test func potaMultiParkExpansionDoesNotInventActivationMinimum() throws {
        var rows=potaRows(4)
        for i in rows.indices { rows[i].extraFields["MY_POTA_REF"]="SK-0001 SK-0002";rows[i].potaReference="US-0001 US-0002 US-0003" }
        for park in ["SK-0001","SK-0002"] {
            let day=try #require(potaDays(rows,park:park).first)
            #expect(day["physicalRows"] as? Int == 4)
            #expect(day["countableContacts"] as? Int == 4)
            #expect(day["programmeLogRecords"] as? Int == 12)
            #expect(day["candidateStatus"] as? String == "conditional")
            #expect(day["thresholdReached"] as? Bool == false)
        }
        let one=try #require(potaDays([rows[0]]).first)
        #expect(one["physicalRows"] as? Int == 1)
        #expect(one["programmeLogRecords"] as? Int == 3)
    }
    @Test func potaKnownMinimumSurvivesAdditionalUnknownRows() throws {
        let known=potaRows(10)
        var unknown=potaRows(11)[10];unknown.band=""
        let reached=try #require(potaDays(known+[unknown]).first)
        #expect(reached["physicalRows"] as? Int == 11)
        #expect(reached["countableContacts"] as? Int == 10)
        #expect(reached["unknownEligibilityRows"] as? Int == 1)
        #expect(reached["thresholdReached"] as? Bool == true)
        #expect(reached["candidateStatus"] as? String == "local candidate")
        #expect((reached["reasons"] as? [String])?.contains("Band/mode counting evidence missing or unsupported") == true)
        #expect((reached["eligibility"] as? String)?.contains("remain unverified") == true)
        let below=try #require(potaDays(Array(known.prefix(9))+[unknown]).first)
        #expect(below["countableContacts"] as? Int == 9)
        #expect(below["unknownEligibilityRows"] as? Int == 1)
        #expect(below["thresholdReached"] as? Bool == false)
        #expect(below["candidateStatus"] as? String == "incomplete")
    }
    @Test func potaUnknownInputsAndKnownExclusionsStayDistinct() throws {
        var rows=potaRows(8)
        rows[0].call="OM0RX" // self
        rows[1].propagationMode="RPT"
        rows[2].start=Date(timeIntervalSince1970:1900000000) // future
        rows[3].band=""
        rows[4].mode=""
        rows[5].myCall="" // distinct unknown station scope
        rows[6].extraFields.removeValue(forKey:"MY_STATE") // distinct unknown location scope
        rows[7].propagationMode="SAT"
        let knownScope=rows.filter{!$0.myCall.isEmpty && $0.extraFields["MY_STATE"] != nil}
        let days=try potaDays(knownScope)
        let present=try #require(days.first{$0["day"] as? String == "2025-01-01"})
        #expect(present["unknownEligibilityRows"] as? Int == 2)
        #expect(present["excludedRows"] as? Int == 2)
        #expect(present["countableContacts"] as? Int == 1) // satellite permitted
        #expect(present["candidateStatus"] as? String == "incomplete")
        let future=try #require(days.first{$0["day"] as? String != "2025-01-01"})
        #expect(future["excludedRows"] as? Int == 1)
        for q in [rows[5],rows[6]] {
            let unknown=try #require(potaDays([q]).first)
            #expect(unknown["unknownEligibilityRows"] as? Int == 1)
            #expect(unknown["candidateStatus"] as? String == "incomplete")
        }
    }
    @Test func nativePOTASnapshotRetainsCountingInputsAndFrozenClock() throws {
        var rows=potaRows(10)
        var selfOperator=rows[0];selfOperator.id=UUID();selfOperator.operatorCall=selfOperator.call
        var repeater=rows[1];repeater.id=UUID();repeater.propagationMode="RPT"
        rows += [selfOperator,repeater]
        let db=try LogbookDatabase(url:FileManager.default.temporaryDirectory.appendingPathComponent("award-pota-native-\(UUID()).sqlite"))
        for q in rows { try db.save(q) }
        var request=try LogbookAggregateRequest.current(.localAwards,at:Date(timeIntervalSince1970:1800000000))
        request.programme="pota";request.referenceDirectory=FileManager.default.temporaryDirectory.path
        request.referenceVersion=try ActivationReferenceDirectory.fingerprint(directory:FileManager.default.temporaryDirectory)
        let cancellation=LogbookAggregateCancellation()
        let snapshot=try LogbookDatabase.readAggregateSnapshot(at:db.url,authority:db.aggregateReadAuthority(),request:request,cancellation:cancellation)
        guard case .localAwards(let result)=try snapshot.evaluate(cancellation:cancellation).value else { Issue.record("Wrong aggregate");return }
        let page=try result.projection(scope:"",band:"",mode:"Mixed",role:"activator",unit:"SK-0001",unitRole:"activator",offset:0,limit:20)
        let day=try #require((page["activationCandidates"] as? [[String:Any]])?.first)
        #expect(day["physicalRows"] as? Int == 12)
        #expect(day["countableContacts"] as? Int == 0)
        #expect(day["programmeLogRecords"] as? Int == 10)
        #expect(day["unknownEligibilityRows"] as? Int == 10)
        #expect(day["excludedRows"] as? Int == 2)
        #expect(day["candidateStatus"] as? String == "incomplete") // no directory data inferred
        #expect(day["thresholdReached"] as? Bool == false)
        #expect(request.referenceTime == 1800000000)
    }
    @Test func potaQualifiedRecordedLocationsResolveOrRemainUnknown() throws {
        var qualified=potaRows(10)
        for i in qualified.indices {
            qualified[i].extraFields["MY_POTA_REF"]="SK-0001@SK-BL"
            qualified[i].extraFields.removeValue(forKey:"MY_STATE")
        }
        let resolved=try #require(potaDays(qualified).first)
        #expect(resolved["candidateStatus"] as? String == "local candidate")
        #expect(resolved["countableContacts"] as? Int == 10)
        for i in qualified.indices { qualified[i].extraFields["MY_STATE"]="KI" }
        let conflict=try #require(potaDays(qualified).first)
        #expect(conflict["countableContacts"] as? Int == 0)
        #expect(conflict["unknownEligibilityRows"] as? Int == 10)
        #expect(conflict["thresholdReached"] as? Bool == false)
        #expect(conflict["candidateStatus"] as? String == "incomplete")
        var repeated=potaRows(1)[0]
        repeated.potaReference="US-0001@US-MI US-0001@US-NY"
        let contactConflict=try #require(potaDays([repeated]).first)
        #expect(contactConflict["unknownEligibilityRows"] as? Int == 1)
        #expect(contactConflict["countableContacts"] as? Int == 0)
        var secondState=potaRows(1)[0];secondState.extraFields["MY_STATE"]="KI"
        let separate=try LocalAwardEngine.compute(contacts:[potaRows(1)[0],secondState].map(AwardEvidenceContact.init),programme:"pota")
        #expect(separate.scopes.count == 2)
    }
    private func qso(_ call: String, dxcc: Int, continent: String, refs: [String:String] = [:], band: String = "20m", mode: String = "CW") -> QSO {
        QSO(call:call,start:Date(timeIntervalSince1970:1735732800),band:band,mode:mode,dxcc:dxcc,continent:continent,
            iota:refs["IOTA"] ?? "",sotaReference:refs["SOTA_REF"] ?? "",potaReference:refs["POTA_REF"] ?? "",wwffReference:refs["WWFF_REF"] ?? "",
            myCall:"OM0RX",myGrid:"JN98",lotwReceived:"Y",extraFields:refs.merging(["MY_DXCC":"504"]) { first,_ in first })
    }
    @Test func globalCandidatesAndPositiveWAC() throws {
        let contacts = [qso("K1ABC",dxcc:291,continent:"NA"),qso("PY2ABC",dxcc:108,continent:"SA"),qso("VK8ABC",dxcc:150,continent:"OC"),
            qso("JA1ABC",dxcc:339,continent:"AS"),qso("OM1ABC",dxcc:504,continent:"EU"),qso("ZS1ABC",dxcc:462,continent:"AF"),qso("RI1AN",dxcc:13,continent:"AN")]
        let db = try LogbookDatabase(url:FileManager.default.temporaryDirectory.appendingPathComponent("award-world-\(UUID()).sqlite"))
        for q in contacts { try db.save(q) }
        var request = try LogbookAggregateRequest.current(.localAwards)
        request.programme="wac"; request.referenceDirectory=FileManager.default.temporaryDirectory.path
        request.referenceVersion=try ActivationReferenceDirectory.fingerprint(directory:FileManager.default.temporaryDirectory)
        let cancellation=LogbookAggregateCancellation()
        let snapshot=try LogbookDatabase.readAggregateSnapshot(at:db.url,authority:db.aggregateReadAuthority(),request:request,cancellation:cancellation)
        guard case .localAwards(let result)=try snapshot.evaluate(cancellation:cancellation).value else { Issue.record("Wrong aggregate"); return }
        #expect(result.units.filter { !$0.evidence.isEmpty }.count == 6)
        #expect(Set(result.units.flatMap(\.evidence).map(\.id)) == Set(contacts.dropLast().map(\.id)))
        let page=try result.projection(scope:"",band:"",mode:"Mixed",role:"",unit:"AF",offset:0,limit:20)
        #expect(page["workedUnits"] as? Int == 6)
        #expect(page["confirmationUnits"] as? Int == 0) // LoTW is not WAC card evidence.
        #expect(page["evidenceTotal"] as? Int == 1)
    }
    @Test func prefixRulesAndExplicitModeScope() throws {
        let cases=["K1ABC":"K1","K1ABC/4":"K4","F/OM0RX":"F0","OM0RX/P":"OM0","R14CWC/3":"R14","W100AW/9":"W100","VI2AJ2010":"VI2","AM70X/8":"AM70","SZ3PMBG19":"SZ3","3D2AG":"3D2","9A3A":"9A3","5B4ALX":"5B4","4U1UN":"4U1","8J1RL":"8J1","3DA0XX":"3DA0","2E0ABC":"2E0"]
        for (call,prefix) in cases { #expect(LocalAwardEngine.wpxPrefix(call) == prefix) }
        #expect(LocalAwardEngine.wpxPrefix("D075GR") == nil)
        var australia=qso("VK1A",dxcc:150,continent:"OC"); australia.myCall="VK8RX"; australia.extraFields["MY_DXCC"]="150"
        let input=[qso("K1ABC",dxcc:291,continent:"NA",mode:"SSB"),qso("K1XYZ",dxcc:291,continent:"NA",mode:"AM"),australia,
            qso("3D2AG",dxcc:176,continent:"OC"),qso("3D2R",dxcc:176,continent:"OC"),qso("9A3A",dxcc:497,continent:"EU")]
        let result=try LocalAwardEngine.compute(contacts:input.map(AwardEvidenceContact.init),programme:"wpx")
        #expect(result.scopes.count == 2)
        let scope=try #require(result.scopes.first(where:{$0.hasPrefix("OM0RX")}))
        let mixed=try result.projection(scope:scope,band:"",mode:"Mixed",role:"",unit:"K1",offset:0,limit:20)
        #expect(mixed["workedUnits"] as? Int == 3); #expect(mixed["evidenceTotal"] as? Int == 2)
        let numeric=try result.projection(scope:scope,band:"",mode:"Mixed",role:"",unit:"3D2",offset:0,limit:20)
        #expect(numeric["evidenceTotal"] as? Int == 2)
        #expect(Set((numeric["evidence"] as? [[String:Any]] ?? []).compactMap{$0["call"] as? String}) == ["3D2AG","3D2R"])
        let ssb=try result.projection(scope:scope,band:"",mode:"SSB",role:"",unit:"K1",offset:0,limit:20)
        #expect(ssb["evidenceTotal"] as? Int == 1)
        let phone=try result.projection(scope:scope,band:"",mode:"Phone",role:"",unit:"K1",offset:0,limit:20)
        #expect(phone["evidenceTotal"] as? Int == 2)
        #expect(phone["target"] is NSNull)
    }
    @Test func referenceRolesUnknownsAndDatedPositivePoints() throws {
        let contacts=[qso("G1A",dxcc:223,continent:"EU",refs:["IOTA":"EU-005","POTA_REF":"GB-0001,GB-0002","MY_POTA_REF":"SK-0001 SK-0002","SOTA_REF":"G/LD-001","MY_SOTA_REF":"OM/BA-001","WWFF_REF":"GFF-0001","MY_WWFF_REF":"OMFF-0001"]),
            qso("G1B",dxcc:223,continent:"EU",refs:["IOTA":"EU-005","SOTA_REF":"G/LD-001"]),qso("JA1C",dxcc:339,continent:"AS",refs:["IOTA":"AS-007"])]
        let directory=ActivationReferenceDirectory(records:[.init(kind:.iota,reference:"EU-005",name:"Great Britain"),.init(kind:.iota,reference:"AS-007",name:"Honshu"),
            .init(kind:.sota,reference:"G/LD-001",name:"Scafell Pike",points:10,validFrom:"01/01/2002",validTo:"31/12/2099",association:"England",pointSource:"https://www.sotadata.org.uk/summitslist.csv")])
        let iota=try LocalAwardEngine.compute(contacts:contacts.map(AwardEvidenceContact.init),programme:"iota",directory:directory)
        #expect(iota.units.count == 2); #expect(iota.units.flatMap(\.evidence).count == 3)
        for programme in ["pota","sota","wwff"] {
            let result=try LocalAwardEngine.compute(contacts:contacts.map(AwardEvidenceContact.init),programme:programme,directory:directory)
            #expect(result.units.contains(where:{$0.role == "activator"}))
            #expect(result.units.contains(where:{$0.role == (programme == "sota" ? "chaser":"hunter")}))
            if programme == "pota" { #expect(result.units.count == 4) }
            if programme == "sota" {
                #expect(result.units.first(where:{$0.role == "chaser"})?.points == 10) // Two QSOs, one UTC summit/day.
                #expect(result.units.first(where:{$0.role == "activator"})?.points == nil)
            }
        }
        let unknown=try LocalAwardEngine.compute(contacts:contacts.map(AwardEvidenceContact.init),programme:"sota")
        #expect(unknown.units.first(where:{$0.role == "chaser"})?.points == nil)
    }
    @Test func neededCellAndRecordedUnknownCountry() throws {
        var q=qso("K1A",dxcc:291,continent:"NA"); q.extraFields.removeValue(forKey:"MY_DXCC")
        let result=try LocalAwardEngine.compute(contacts:[AwardEvidenceContact(q)],programme:"wac",wacMembership:LocalAwardEngine.wacMembership())
        #expect(result.scopes.first?.contains("own DXCC unknown") == true)
        #expect(result.units.count == 6)
        let page=try result.projection(scope:"",band:"80m",mode:"CW",role:"",unit:"AF",offset:0,limit:20)
        #expect(page["evidenceTotal"] as? Int == 0)
    }
    @Test func standardSIGReferencesAndFilteredPointEstimates() throws {
        var q=qso("K1SIG",dxcc:291,continent:"NA",refs:["MY_POTA_REF":" ","MY_SIG":"POTA","MY_SIG_INFO":"SK-0001"])
        q.sig="POTA";q.sigInfo="US-0001,US-0002@US-MI"
        let pota=try LocalAwardEngine.compute(contacts:[AwardEvidenceContact(q)],programme:"pota")
        #expect(pota.units.filter{$0.role == "hunter"}.count == 2)
        #expect(pota.units.first(where:{$0.role == "activator"})?.unit == "SK-0001")
        var first=qso("G1POINT",dxcc:223,continent:"EU",refs:["SOTA_REF":"G/LD-001"],band:"20m")
        var second=first;second.id=UUID();second.band="40m";second.start=first.start.addingTimeInterval(86400)
        let directory=ActivationReferenceDirectory(records:[.init(kind:.sota,reference:"G/LD-001",name:"Summit",points:10,validFrom:"01/01/2002",validTo:"31/12/2099",association:"England",pointSource:"https://www.sotadata.org.uk/summitslist.csv")])
        first.myGrid="JN98";second.myGrid="JN98"
        let result=try LocalAwardEngine.compute(contacts:[first,second].map(AwardEvidenceContact.init),programme:"sota",directory:directory)
        let page=try result.projection(scope:"",band:"20m",mode:"Mixed",role:"chaser",unit:"G/LD-001",offset:0,limit:20)
        #expect((page["units"] as? [[String:Any]])?.first?["points"] as? Int == 10)
        #expect(page["evidenceTotal"] as? Int == 1)
    }
}

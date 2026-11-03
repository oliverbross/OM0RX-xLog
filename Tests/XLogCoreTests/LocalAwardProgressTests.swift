import Foundation
import Testing
@testable import XLogCore

struct LocalAwardProgressTests {
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

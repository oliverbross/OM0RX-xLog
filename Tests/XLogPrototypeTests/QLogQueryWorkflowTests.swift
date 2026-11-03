import Foundation
import Testing
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif
@testable import XLogPrototypeSupport

@Suite("Integrated QLog query, evidence and frozen export")
struct QLogQueryWorkflowTests {
    private func fixture() throws -> (URL,LiveLogbookMethods) {
        let root=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let service=LiveLogbookMethods(supportDirectory:root,inheritNativePreferences:false)
        _=try service.handle(method:"workspace_create",params:["mode":"empty"])
        return (root,service)
    }
    @Test func sameNativePredicateListCountExportAndAwardEvidence() throws {
        let (root,service)=try fixture(); defer { try? service.openedDatabase().close(); try? FileManager.default.removeItem(at:root) }
        let db=try service.openedDatabase()
        let good=QSO(call:"K1GOOD",band:"80m",mode:"CW",dxcc:291,continent:"NA",myCall:"OM0RX",lotwReceived:"N",extraFields:["MY_DXCC":"504","MY_POTA_REF":"SK-0001 SK-0002","APP_UNRELATED":"retained"])
        let confirmed=QSO(call:"K1CONF",band:"80m",mode:"CW",dxcc:291,continent:"NA",myCall:"OM0RX",lotwReceived:"Y")
        let unknown=QSO(call:"VK1UNK",band:"80m",mode:"CW",dxcc:150,myCall:"VK8RX",lotwReceived:"")
        for q in [good,confirmed,unknown] { try db.save(q) }
        let definition:[String:Any]=["version":1,"join":"all","clauses":[["field":"stationCall","op":"eq","values":["OM0RX"]],["field":"lotw","op":"eq","values":["N"]]]]
        let listed=try service.handle(method:"logbook_list",params:["query":definition,"reference_time":"2026-11-03T00:00:00.125Z"])
        #expect(listed["total"] as? Int == 1)
        #expect((listed["qsos"] as? [[String:Any]])?.first?["id"] as? String == good.id.uuidString)
        let frozen=try service.handle(method:"logbook_export_adif",params:["action":"begin","scope":"filtered","query":definition])
        #expect(frozen["total"] as? Int == 1)
        var edited=good; edited.call="K1EDIT"; try db.save(edited)
        let exported=try service.handle(method:"logbook_export_adif",params:["action":"read","token":frozen["token"]!])
        let records=ADIFParser().records(in:exported["text"] as! String)
        #expect(records.count == 1); #expect(records.first?["CALL"] == "K1GOOD"); #expect(records.first?["APP_UNRELATED"] == "retained")
        let evidence=try service.handle(method:"logbook_award_progress",params:["programme":"dxcc","query":definition,"unit":"291"])
        #expect(evidence["workedUnits"] as? Int == 1); #expect(evidence["evidenceTotal"] as? Int == 1)
        #expect((evidence["evidence"] as? [[String:Any]])?.first?["id"] as? String == good.id.uuidString)
    }
    @Test func structuredSavedQueryStableIdentityCloneConflictAndBackup() throws {
        let (root,service)=try fixture(); defer { try? service.openedDatabase().close(); try? FileManager.default.removeItem(at:root) }
        let base=try service.handle(method:"workspace_preferences_load",params:[:])
        let definition:[String:Any]=["version":1,"join":"any","clauses":[["field":"band","op":"in","values":["80m","160m"]]]]
        func apply(_ current:[String:Any],_ action:String,_ extra:[String:Any]) throws -> [String:Any] {
            var params:[String:Any]=["action":action,"generation":current["generation"]!,"expected":(current["preferences"] as! [String:Any])["savedLogbookFilters"]!]
            params.merge(extra){_,new in new}; return try service.handle(method:"workspace_logbook_filters_apply",params:params)
        }
        var current=try apply(base,"save",["name":"Low bands","query":"","definition":definition])
        let original=(current["preferences"] as! [String:Any])["savedLogbookFilters"] as! [[String:Any]]
        let id=try #require(original.first?["id"] as? String)
        #expect(try service.handle(method:"workspace_logbook_filters_apply",params:["generation":current["generation"]!,"expectedRevision":base["revision"]!,"action":"rename","source":"Low bands","name":"Stale revision"])["status"] as? String == "conflict")
        let revisionUpdate=try service.handle(method:"workspace_logbook_filters_apply",params:["generation":current["generation"]!,"expectedRevision":current["revision"]!,"action":"rename","source":"Low bands","name":"Low bands"])
        #expect(revisionUpdate["status"] as? String == "applied")
        current=try apply(current,"rename",["source":"Low bands","name":"Low band CW"])
        #expect(((current["preferences"] as! [String:Any])["savedLogbookFilters"] as! [[String:Any]])[0]["id"] as? String == id)
        #expect(try apply(base,"save",["name":"Stale","query":"x"])["status"] as? String == "conflict")
        current=try apply(current,"clone",["source":"Low band CW","name":"Copy"])
        let filters=(current["preferences"] as! [String:Any])["savedLogbookFilters"] as! [[String:Any]]
        #expect(Set(filters.compactMap{$0["id"] as? String}).count == 2)
        #expect(filters.allSatisfy{ ($0["definition"] as? [String:Any])?["join"] as? String == "any" })
        let backup=try service.handle(method:"backup_create",params:["name":"structured"])
        _=try apply(current,"delete",["source":"Copy"])
        let restored=try service.handle(method:"backup_restore",params:["name":backup["name"]!,"confirm_restore":true,"restore_preferences":true])
        #expect(restored["preferences_restored"] as? Bool == true)
        let loaded=try service.handle(method:"workspace_preferences_load",params:[:])
        #expect(((loaded["preferences"] as! [String:Any])["savedLogbookFilters"] as! [[String:Any]]).count == 2)
        #expect((loaded["preferences"] as! [String:Any])["deskBandMapBands"] as? [String] == ["20m"])
    }
    @Test func pagedPOTAPreviewUsesFrozenTwoByThreeAndPreservesSource() throws {
        let (root,service)=try fixture(); defer { try? service.openedDatabase().close(); try? FileManager.default.removeItem(at:root) }
        let db=try service.openedDatabase()
        let q=QSO(call:"K1PARK/P",start:Date(timeIntervalSince1970:1735732800),band:"20m",mode:"SSB",potaReference:"US-0001,US-0002,US-0003",myCall:"OM0RX/P",extraFields:["MY_POTA_REF":"SK-0001,SK-0002","MY_STATE":"SK-BL","APP_UNRELATED":"keep"])
        try db.save(q)
        let token=try service.handle(method:"logbook_export_adif",params:["action":"begin","scope":"selected","ids":[q.id.uuidString]])["token"]!
        var changed=q; changed.potaReference="US-9999"; try db.save(changed)
        let response=try service.handle(method:"logbook_export_adif",params:["action":"pota_preview","token":token])
        let preview=response["preview"] as! [String:Any]
        #expect(preview["physicalContacts"] as? Int == 1); #expect(preview["derivedRecords"] as? Int == 6); #expect(preview["fileCount"] as? Int == 2)
        #expect((preview["files"] as! [[String:Any]]).allSatisfy{$0["text"] as? String == ""})
        for index in 0..<2 {
            let read=try service.handle(method:"logbook_export_adif",params:["action":"pota_read","token":token,"fileIndex":index])
            let data=try #require(Data(base64Encoded:read["bytes"] as! String))
            let records=ADIFParser().records(in:String(decoding:data,as:UTF8.self))
            #expect(records.count == 3); #expect(Set(records.compactMap{$0["TIME_ON"]}).count == 1)
            #expect(Set(records.compactMap{$0["SIG_INFO"]}) == ["US-0001","US-0002","US-0003"])
            #expect(records.allSatisfy{$0["CALL"] == "K1PARK/P" && $0["APP_UNRELATED"] == "keep"})
        }
        #expect(try db.count() == 1); #expect(try db.fetchAll().first?.potaReference == "US-9999")
    }
}

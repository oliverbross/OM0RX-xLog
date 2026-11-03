import Foundation
import Testing
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif
@testable import XLogPrototypeSupport

@Suite("Native operator-action draft and preference transactions")
struct OperatorActionsIntegrationTests {
    private func fixture() throws -> (URL,LiveLogbookMethods) {
        let root=FileManager.default.temporaryDirectory.appendingPathComponent("operator-actions-" + UUID().uuidString)
        let service=LiveLogbookMethods(supportDirectory:root,inheritNativePreferences:false)
        _=try service.handle(method:"workspace_create",params:["mode":"empty"])
        return (root,service)
    }
    private func cleanup(_ root:URL,_ service:LiveLogbookMethods) {
        if let workspace=try? IntegrationWorkspaceBootstrap.open(at:service.workspaceDirectoryURL) {
            UserDefaults.standard.removePersistentDomain(forName:workspace.defaultsSuiteName)
        }
        try? service.openedDatabase().close()
        try? FileManager.default.removeItem(at:root)
    }
    private func draft(_ service:LiveLogbookMethods)throws->[String:Any] {
        try #require(service.handle(method:"logbook_operator_draft",params:[:])["draft"] as? [String:Any])
    }
    private func replace(_ service:LiveLogbookMethods,_ base:[String:Any],_ qso:[String:Any])throws {
        _=try service.handle(method:"logbook_operator_draft_apply",params:["operationID":UUID().uuidString,
            "draftID":qso["id"]!,"expectedRevision":base["revision"]!,"generation":base["generation"]!,"action":"replace","qso":qso])
    }
    @Test("Nearby callsign-only apply retains split/manual fields, uses one durable receipt and protects later typing")
    func callsignAdmission()throws {
        let (root,service)=try fixture();defer{cleanup(root,service)}
        var settings=try #require(service.handle(method:"settings_load",params:[:])["settings"] as? [String:Any])
        settings["nearbySpottedCallsigns"]=true;_=try service.saveSettingsForTest(settings)
        let initial=try draft(service);var qso=try #require(initial["qso"] as? [String:Any])
        qso["call"]="";qso["frequencyHz"]=14030000;qso["receiveFrequencyHz"]=14025000;qso["band"]="20m";qso["mode"]="CW"
        qso["comment"]="Retain my typed note";qso["rstSent"]="579"
        try replace(service,initial,qso)
        let before=try draft(service),beforeQSO=try #require(before["qso"] as? [String:Any])
        let params:[String:Any]=["operationID":UUID().uuidString,"draftID":beforeQSO["id"]!,
            "expectedRevision":before["revision"]!,"generation":before["generation"]!,"callsign":"ZL1ABC"]
        let applied=try service.handle(method:"logbook_operator_draft_nearby_call",params:params)
        #expect(applied["status"] as? String == "applied")
        let after=try draft(service),afterQSO=try #require(after["qso"] as? [String:Any])
        #expect(afterQSO["call"] as? String == "ZL1ABC")
        for key in ["frequencyHz","receiveFrequencyHz","start","end","rstSent","rstReceived","comment","extraFields"] {
            let first=beforeQSO[key] ?? NSNull(),second=afterQSO[key] ?? NSNull()
            #expect(try JSONSerialization.data(withJSONObject:["v":first],options:[.sortedKeys]) == JSONSerialization.data(withJSONObject:["v":second],options:[.sortedKeys]))
        }
        let replay=try service.handle(method:"logbook_operator_draft_nearby_call",params:params)
        #expect(try JSONSerialization.data(withJSONObject:replay,options:[.sortedKeys]) == JSONSerialization.data(withJSONObject:applied,options:[.sortedKeys]))
        #expect(try draft(service)["revision"] as? Int == after["revision"] as? Int)
        var typed=afterQSO;typed["call"]="OM0RX";try replace(service,after,typed)
        let latest=try draft(service);var blocked=params
        blocked["operationID"]=UUID().uuidString;blocked["expectedRevision"]=latest["revision"]!
        #expect(throws:WorkerFailure.self){try service.handle(method:"logbook_operator_draft_nearby_call",params:blocked)}
        #expect(try #require(draft(service)["qso"] as? [String:Any])["call"] as? String == "OM0RX")
    }
    @Test("Shortcut patches are revision checked and survive actual existing backup/restore plus restart")
    func preferenceBackupAndRevision()throws {
        let (root,service)=try fixture();defer{cleanup(root,service)}
        let base=try service.handle(method:"workspace_preferences_load",params:[:])
        let bindings:[String:Any]=["version":1,"overrides":["save-current-qso":"Primary+Shift+J","future-command":"Primary+Shift+U"]]
        let params:[String:Any]=["generation":base["generation"]!,"expectedRevision":base["revision"]!,"bindings":bindings]
        let saved=try service.handle(method:"workspace_commands_apply",params:params)
        #expect(saved["status"] as? String == "applied")
        #expect(try service.handle(method:"workspace_commands_apply",params:params)["status"] as? String == "conflict")
        let backup=try service.handle(method:"backup_create",params:["name":"operator-commands"])
        _=try service.handle(method:"workspace_commands_apply",params:["generation":saved["generation"]!,"expectedRevision":saved["revision"]!,"bindings":["version":1,"overrides":[:]]])
        _=try service.handle(method:"backup_restore",params:["name":backup["name"]!,"confirm_restore":true,"restore_preferences":true])
        let restored=try service.handle(method:"workspace_preferences_load",params:[:])
        #expect(restored["generation"] as? String != base["generation"] as? String)
        let prefs=try #require(restored["preferences"] as? [String:Any]),actual=try #require(prefs["normalCommandBindings"] as? [String:Any])
        #expect(actual["overrides"] as? [String:String] == bindings["overrides"] as? [String:String])
        #expect(try service.handle(method:"workspace_commands_apply",params:params)["status"] as? String == "workspace_changed")
        try service.openedDatabase().close()
        let reopened=LiveLogbookMethods(supportDirectory:root,inheritNativePreferences:false)
        defer{try? reopened.openedDatabase().close()}
        let reopenedPrefs=try #require(reopened.handle(method:"workspace_preferences_load",params:[:])["preferences"] as? [String:Any])
        #expect(try #require(reopenedPrefs["normalCommandBindings"] as? [String:Any])["overrides"] as? [String:String] == bindings["overrides"] as? [String:String])
    }
}

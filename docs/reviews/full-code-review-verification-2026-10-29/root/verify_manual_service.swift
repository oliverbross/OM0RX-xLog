import Foundation
import XLogCore
@testable import XLogPrototypeSupport

let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-second-pass-service-\(UUID().uuidString)")
try FileManager.default.createDirectory(at:root,withIntermediateDirectories:true)
let service = LiveLogbookMethods(supportDirectory:root,inheritNativePreferences:false)
_ = try service.handle(method:"workspace_create",params:["mode":"empty"])
let first = try service.handle(method:"logbook_operator_draft",params:[:])["draft"] as! [String:Any]
var qso = first["qso"] as! [String:Any]
qso["call"] = "K1ABC"
qso["band"] = "20m"
qso["mode"] = "CW"
qso["start"] = "2023-11-14T22:13:20Z"
qso["end"] = "2023-11-14T22:23:20Z"
let replace:[String:Any] = ["operationID":UUID().uuidString,"draftID":qso["id"]!,"expectedRevision":first["revision"]!,
    "generation":first["generation"]!,"action":"replace","qso":qso]
let replaced = try service.handle(method:"logbook_operator_draft_apply",params:replace)
let dated = (replaced["receipt"] as! [String:Any])["draft"] as! [String:Any]
precondition(dated["automaticStart"] as? Bool == false)
let saveID=UUID().uuidString
let save:[String:Any] = ["operationID":saveID,"draftID":qso["id"]!,"expectedRevision":dated["revision"]!,
    "generation":dated["generation"]!,"action":"save"]
let before=Date()
let savedResponse=try service.handle(method:"logbook_operator_draft_apply",params:save)
let after=Date()
let receipt=savedResponse["receipt"] as! [String:Any]
let saved=receipt["savedQSO"] as! [String:Any]
let iso=ISO8601DateFormatter()
let actual=iso.date(from:saved["start"] as! String)!
let finish=iso.date(from:saved["end"] as! String)!
let reopened=LiveLogbookMethods(supportDirectory:root,inheritNativePreferences:false)
let recovered=try reopened.handle(method:"logbook_operator_draft_receipt",params:["generation":first["generation"]!,"operationID":saveID])["receipt"] as! [String:Any]
let replay=try reopened.handle(method:"logbook_operator_draft_apply",params:save)["receipt"] as! [String:Any]
let count=try reopened.handle(method:"workspace_status",params:[:])["qso_count"] as! Int
precondition(count==1 && saved["start"] as! String != qso["start"] as! String)
precondition(actual.timeIntervalSince(before) >= -1 && actual <= after)
precondition(NSDictionary(dictionary:recovered).isEqual(to:receipt) && NSDictionary(dictionary:replay).isEqual(to:receipt))
let result:[String:Any] = ["supportRoot":root.path,"boundary":"actual LiveLogbookMethods.handle; no stubs",
    "automaticBeforeSave":dated["automaticStart"]!,"requestedStart":qso["start"]!,"requestedEnd":qso["end"]!,
    "savedStart":saved["start"]!,"savedEnd":saved["end"]!,"savedDurationSeconds":finish.timeIntervalSince(actual),
    "receiptReopenedEqual":true,"replayedReceiptEqual":true,"rowCount":count]
print(String(data:try JSONSerialization.data(withJSONObject:result,options:[.prettyPrinted,.sortedKeys]),encoding:.utf8)!)

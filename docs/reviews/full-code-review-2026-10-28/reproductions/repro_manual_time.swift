import Foundation
import XLogCore

let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-review-manual-time-\(UUID().uuidString)")
try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
let database = try LogbookDatabase(url: root.appendingPathComponent("test.sqlite"))
let old = Date(timeIntervalSince1970: 1_700_000_000)
let now = Date(timeIntervalSince1970: 1_790_000_000)
let initial = try database.operatorDraft(initial: QSO(call:"", start:now, band:"20m", mode:"CW", updatedAt:now))
var historical = initial.qso
historical.call = "K1ABC"
historical.start = old
let dated = try database.applyOperatorDraft(.init(operationID: UUID(), draftID:initial.qso.id, expectedRevision:initial.revision,
    action:.replace, qso:historical), nextDraft: QSO(call:"", band:"20m", mode:"CW"), now:now).draft
precondition(!dated.automaticStart && dated.qso.start == old)
let saved = try database.applyOperatorDraft(.init(operationID:UUID(), draftID:dated.qso.id, expectedRevision:dated.revision,
    action:.save), nextDraft: QSO(call:"", band:"20m", mode:"CW"), now:now)
database.close()
let reopened = try LogbookDatabase(url:root.appendingPathComponent("test.sqlite"))
let persisted = try reopened.lookup(localID:dated.qso.id)!
let replay = try reopened.operatorDraftReceipt(operationID:saved.mutation.operationID)!
let result:[String:Any] = ["fixtureRoot":root.path,"automaticBeforeSave":dated.automaticStart,
    "requestedStart":old.timeIntervalSince1970,"buttonTime":now.timeIntervalSince1970,
    "savedStart":persisted.start.timeIntervalSince1970,"receiptStart":replay.savedQSO!.start.timeIntervalSince1970,
    "newDraftAutomatic":saved.draft.automaticStart,"rowCount":try reopened.count()]
print(String(data:try JSONSerialization.data(withJSONObject:result, options:[.prettyPrinted,.sortedKeys]),encoding:.utf8)!)
precondition(persisted.start == now && persisted.start != old)
reopened.close()

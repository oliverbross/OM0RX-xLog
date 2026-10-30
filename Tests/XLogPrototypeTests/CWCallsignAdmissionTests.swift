import Foundation
import XCTest
@testable import XLogPrototypeSupport

#if os(macOS)
final class CWCallsignAdmissionTests:XCTestCase {
    func testNonOwnerAndDisabledWorkerCannotCommitCWCallsignPayload() async throws {
        for owns in [false,true] {
            let root=FileManager.default.temporaryDirectory.appendingPathComponent("cw-admission-\(UUID())")
            let service=LiveLogbookMethods(supportDirectory:root,inheritNativePreferences:false)
            defer {try? service.openedDatabase().close();try? FileManager.default.removeItem(at:root)}
            _ = try service.handle(method:"workspace_create",params:["mode":"empty"])
            let before=try XCTUnwrap(service.handle(method:"logbook_operator_draft",params:[:])["draft"] as? [String:Any])
            let qso=try XCTUnwrap(before["qso"] as? [String:Any])
            let reference:[String:Any]=["sessionID":UUID().uuidString,"sourceID":UUID().uuidString,"streamToken":UUID().uuidString,
                "epoch":"1","trackID":UUID().uuidString,"revision":"0","selectionID":UUID().uuidString]
            let params:[String:Any]=["operationID":UUID().uuidString,"generation":before["generation"]!,"draftID":qso["id"]!,
                "expectedRevision":before["revision"]!,"spot":["call":"K1ABC","frequencyHz":NSNull(),"band":"","mode":"","country":"","comment":"","specialTags":[],"cwCallsign":reference] as [String:Any]]
            let worker=LiveWorker(logbook:service,ownsProcessSessions:owns)
            let response=await worker.response(to:try JSONSerialization.data(withJSONObject:["id":"cw-apply","method":"spot_draft_apply","params":params]))
            let decoded=try XCTUnwrap(JSONSerialization.jsonObject(with:response) as? [String:Any])
            let error=try XCTUnwrap(decoded["error"] as? [String:Any])
            XCTAssertEqual(error["code"] as? String,owns ? "cw_feature_disabled":"cw_owner_required")
            let after=try XCTUnwrap(service.handle(method:"logbook_operator_draft",params:[:])["draft"] as? [String:Any])
            XCTAssertEqual(NSDictionary(dictionary:before),NSDictionary(dictionary:after))
            _ = await worker.shutdown()
        }
    }
}
#endif

import Foundation
import Testing
@testable import XLogCore

@Suite("Immutable POTA export projection")
struct POTAExportTests {
    let now = Date(timeIntervalSince1970: 1_793_606_400)
    func contact() -> QSO {
        QSO(call: "K1ABC/P", start: Date(timeIntervalSince1970: 1_700_000_000), band: "20m", mode: "CW", sig: "POTA", sigInfo: "US-0001,US-0002,US-0003", operatorCall: "VK8RX", myCall: "VK8RX/P", extraFields: ["MY_SIG": "POTA", "MY_SIG_INFO": "AU-0001,AU-0002,AU-0001", "MY_STATE": "NT", "APP_KEEP": "unchanged"])
    }
    @Test func twoByThreePreservesPhysicalQSOAndTimes() {
        let qso = contact(), snapshot = ADIFExportSnapshot(contacts: [qso], scope: .all)
        let preview = POTAExportPreview(snapshot: snapshot, now: now)
        #expect(preview.physicalContacts == 1); #expect(preview.includedContacts == 1)
        #expect(preview.derivedRecords == 6); #expect(preview.files.count == 2); #expect(preview.issues.isEmpty)
        for file in preview.files {
            let records = ADIFParser().records(in: file.text)
            #expect(records.count == 3); #expect(file.derivedRecords == 3)
            #expect(Set(records.compactMap { $0["TIME_ON"] }).count == 1)
            #expect(records.allSatisfy { $0["CALL"] == "K1ABC/P" && $0["STATION_CALLSIGN"] == "VK8RX/P" && $0["APP_KEEP"] == "unchanged" })
            #expect(Set(records.compactMap { $0["MY_SIG_INFO"] }).count == 1)
            #expect(Set(records.compactMap { $0["SIG_INFO"] }).count == 3)
        }
        #expect(snapshot.records == [qso.adifRecord])
        #expect(qso.extraFields["MY_SIG_INFO"] == "AU-0001,AU-0002,AU-0001")
    }
    @Test func duplicateTimesStaySeparateAndAssignmentsAreExportOnly() {
        var one = contact(); one.extraFields["MY_SIG_INFO"] = ""
        var two = one; two.id = UUID(); two.start = one.start.addingTimeInterval(120)
        let snapshot = ADIFExportSnapshot(contacts: [one, two], scope: .all)
        let incomplete = POTAExportPreview(snapshot: snapshot, now: now)
        #expect(incomplete.issues.count == 2)
        let preview = POTAExportPreview(snapshot: snapshot, now: now, assignment: .init(ownParks: ["AU-9999"]))
        #expect(preview.physicalContacts == 2); #expect(preview.derivedRecords == 6)
        #expect(preview.warnings.contains(where: { $0.contains("possible POTA duplicate") }))
        #expect(one.extraFields["MY_SIG_INFO"] == "")
    }
    @Test func locationClubAndUTCDayPartition() {
        var one = contact(); one.myCall = "VK8CLUB"; one.extraFields["MY_SIG_INFO"] = "AU-0001"
        var two = one; two.id = UUID(); two.start = one.start.addingTimeInterval(86_400); two.extraFields["MY_STATE"] = "WA"
        let snapshot = ADIFExportSnapshot(contacts: [one, two], scope: .all)
        let preview = POTAExportPreview(snapshot: snapshot, now: now)
        #expect(preview.files.count == 2); #expect(preview.files.allSatisfy { $0.stationCall == "VK8CLUB" })
        two.extraFields["MY_STATE"] = "NT"
        #expect(POTAExportPreview(snapshot: ADIFExportSnapshot(contacts: [one, two], scope: .all), now: now).files.count == 1)
        #expect(POTAExportPreview(snapshot: ADIFExportSnapshot(contacts: [one, two], scope: .all), now: now, splitByDay: true).files.count == 2)
    }
    @Test func futureDateAndBadReferencesAreExplicitExclusions() {
        var qso = contact(); qso.start = now.addingTimeInterval(172_800)
        let future = POTAExportPreview(snapshot: ADIFExportSnapshot(contacts: [qso], scope: .all), now: now)
        #expect(future.files.isEmpty); #expect(future.issues.first?.message.contains("future UTC date") == true)
        qso = contact(); qso.extraFields["MY_SIG_INFO"] = "bad"
        #expect(POTAExportPreview(snapshot: ADIFExportSnapshot(contacts: [qso], scope: .all), now: now).issues.count == 1)
    }
}

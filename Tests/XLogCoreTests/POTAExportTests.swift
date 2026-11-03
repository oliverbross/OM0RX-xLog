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
        one.extraFields["MY_STATE"] = ""
        let assigned = POTAExportPreview(snapshot: ADIFExportSnapshot(contacts: [one], scope: .all), now: now, assignment: .init(ownParks: ["AU-9999"], state: "NT"))
        #expect(assigned.files.first?.state == "NT"); #expect(one.extraFields["MY_STATE"] == "")
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
    @Test func clubIdentityAndModesAreReviewedWithoutRepairingSources() {
        var qso = contact(); qso.operatorCall = ""
        let snapshot = ADIFExportSnapshot(contacts: [qso], scope: .all)
        #expect(POTAExportPreview(snapshot: snapshot, now: now).issues.isEmpty)
        #expect(POTAExportPreview(snapshot: snapshot, now: now, assignment: .init(ownParks: [], clubOrGroup: true)).issues.count == 1)
        qso.mode = "MADEUP"
        #expect(POTAExportPreview(snapshot: ADIFExportSnapshot(contacts: [qso], scope: .all), now: now).issues.count == 1)
        qso.mode = "FT4"
        let ft4 = POTAExportPreview(snapshot: ADIFExportSnapshot(contacts: [qso], scope: .all), now: now)
        #expect(ft4.issues.isEmpty)
        #expect(ADIFParser().records(in: ft4.files[0].text).first?["SUBMODE"] == "FT4")
    }
    @Test(arguments: [
        ("CW", "", true), ("SSB", "", true), ("SSB", "USB", true),
        ("FT4", "", true), ("MFSK", "FT4", true), ("PSK31", "", true),
        ("C4FM", "", true), ("DSTAR", "", true),
        ("JT9", "JT9E FAST", true), ("jt9", "jt9e fast", true),
        ("CW", "BOGUS", false), ("CW", "FT4", false), ("JT9", "JT9E_FAST", false)
    ]) func modeAndSubmodeValidationAgreesWithCounting(mode:String,submode:String,supported:Bool) throws {
        var qso=contact();qso.mode=mode;qso.submode=submode
        let before=qso
        let snapshot=ADIFExportSnapshot(contacts:[qso],scope:.all)
        let record=try #require(snapshot.records.first)
        let preview=POTAExportPreview(snapshot:snapshot,now:now)
        #expect(POTAExportPreview.validCountingMode(record["MODE"] ?? "",submode:record["SUBMODE"] ?? "") == supported)
        #expect((preview.includedContacts == 1) == supported)
        if supported {
            #expect(preview.issues.isEmpty)
            #expect(preview.derivedRecords == 6)
            let exported=try #require(preview.files.first.flatMap{ADIFParser().records(in:$0.text).first})
            #expect(exported["MODE"] == record["MODE"])
            #expect(exported["SUBMODE"] == record["SUBMODE"])
        } else {
            #expect(preview.files.isEmpty)
            #expect(preview.issues.first?.message.contains(submode) == true)
            #expect(preview.issues.first?.message.contains("ADIF 3.1.8") == true)
        }
        #expect(snapshot.records == [qso.adifRecord])
        #expect(qso == before)
    }
    @Test func qualifiedReferencesPartitionWithoutRewritingOrDuplicatingParks() {
        var michigan = contact(); michigan.extraFields.removeValue(forKey: "MY_STATE")
        michigan.extraFields["MY_POTA_REF"] = "US-0001,US-0001@US-MI,US-0001@US-MI"
        michigan.potaReference = "US-0100,US-0100@US-CA"
        var newYork = michigan; newYork.id = UUID()
        newYork.extraFields["MY_POTA_REF"] = "US-0001@US-NY"
        let before = ADIFExportSnapshot(contacts: [michigan, newYork], scope: .all)
        let preview = POTAExportPreview(snapshot: before, now: now)
        #expect(preview.issues.isEmpty); #expect(preview.files.count == 2); #expect(preview.derivedRecords == 2)
        #expect(Set(preview.files.map(\.state)) == ["MI", "NY"])
        for file in preview.files {
            let record = ADIFParser().records(in: file.text).first!
            #expect(record["MY_SIG_INFO"] == "US-0001")
            #expect(record["MY_POTA_REF"] == "US-0001@US-\(file.state)")
            #expect(record["MY_STATE"] == file.state)
            #expect(record["SIG_INFO"] == "US-0100"); #expect(record["POTA_REF"] == "US-0100@US-CA")
            #expect(record["CALL"] == "K1ABC/P")
        }
        #expect(michigan.extraFields["MY_STATE"] == nil)
        #expect(before.records == ADIFExportSnapshot(contacts: [michigan, newYork], scope: .all).records)
        michigan.extraFields["MY_STATE"] = "NY"
        let conflicting = POTAExportPreview(snapshot: ADIFExportSnapshot(contacts: [michigan], scope: .all), now: now)
        #expect(conflicting.files.isEmpty); #expect(conflicting.issues[0].message.contains("conflicts with recorded park location US-MI"))
        michigan.extraFields.removeValue(forKey: "MY_STATE")
        let assignmentConflict = POTAExportPreview(snapshot: ADIFExportSnapshot(contacts: [michigan], scope: .all), now: now, assignment: .init(ownParks: [], state: "NY"))
        #expect(assignmentConflict.files.isEmpty); #expect(assignmentConflict.issues[0].message.contains("export-only subdivision"))
        #expect(!POTAExportPreview.validPark("US-1")); #expect(!POTAExportPreview.validPark("US-000001"))
    }
    @Test func boundedPreparationRejectsExpansionBeforeProducingPartialFiles() throws {
        let snapshot = ADIFExportSnapshot(contacts: [contact()], scope: .all)
        #expect(throws: POTAExportError.self) { try POTAExportPreview.prepare(snapshot: snapshot, now: now, maximumDerivedRecords: 5) }
        #expect(throws: POTAExportError.self) { try POTAExportPreview.prepare(snapshot: snapshot, now: now, maximumBytes: 100) }
        let complete = try POTAExportPreview.prepare(snapshot: snapshot, now: now, maximumDerivedRecords: 6)
        #expect(complete.physicalContacts == 1); #expect(complete.derivedRecords == 6); #expect(complete.files.count == 2)
        #expect(snapshot.records == [contact().adifRecord])
    }
    @Test func typedExtensionsAndConflictingUserDefinitionsRemainLossless() throws {
        var first = contact(); first.extraFields["MY_SIG_INFO"] = "AU-0001"; first.sigInfo = "US-0001"
        first.extraFields["APP_MIXED_WEIGHT"] = "12.50"; first.extraFields["LEVEL"] = "A"
        first.adifFieldMetadata = ADIFFieldMetadata(extensions: [
            "APP_MIXED_WEIGHT": .init(kind: "APP", attributes: ["PROGRAMID": "Mixed", "FIELDNAME": "Weight", "TYPE": "N"]),
            "LEVEL": .init(kind: "USERDEF", attributes: ["FIELDNAME": "Level"], declaration: ["FIELDID": "7", "TYPE": "E", "ENUM": "{A,B}"])
        ])
        var second = first; second.id = UUID(); second.start = first.start.addingTimeInterval(60)
        second.extraFields["APP_MIXED_WEIGHT"] = "12"
        second.adifFieldMetadata!.extensions["APP_MIXED_WEIGHT"]!.attributes["TYPE"] = "I"
        second.adifFieldMetadata!.extensions["LEVEL"]!.declaration!["ENUM"] = "{A,C}"
        let snapshot = ADIFExportSnapshot(contacts: [first, second], scope: .all)
        let preview = try POTAExportPreview.prepare(snapshot: snapshot, now: now)
        #expect(preview.issues.isEmpty); #expect(preview.files.count == 2); #expect(preview.derivedRecords == 2)
        #expect(preview.files.contains { $0.text.contains("<USERDEF7:11:E>Level,{A,B}") && $0.text.contains("<APP_Mixed_Weight:5:N>12.50") })
        #expect(preview.files.contains { $0.text.contains("<USERDEF7:11:E>Level,{A,C}") && $0.text.contains("<APP_Mixed_Weight:2:I>12") })
        for file in preview.files {
            #expect(file.text.contains("<Level:1:E>A"))
            #expect(ADIFImportPreview(text: file.text).issues.isEmpty)
            #expect(ADIFParser().records(in: file.text).first?["LEVEL"] == "A")
        }
        #expect(first.extraFields["APP_MIXED_WEIGHT"] == "12.50")
        #expect(first.adifFieldMetadata!.extensions["LEVEL"]!.declaration?["ENUM"] == "{A,B}")
    }
}

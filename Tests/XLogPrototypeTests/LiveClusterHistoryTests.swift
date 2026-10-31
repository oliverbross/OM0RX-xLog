import Foundation
import Testing
#if canImport(SQLite3)
import SQLite3
#else
import CSQLitePrototype
#endif
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif
@testable import XLogPrototypeSupport

@Suite("Integrated cluster contact history")
struct LiveClusterHistoryTests {
    @Test("PJ classification preserves stored DXCC overrides without modifying contacts")
    func pjStoredEntityOverride() throws {
        let resolver = try CTYResolver.bundled()
        let explicit = QSO(call: "PJ6Y", band: "20m", mode: "CW", dxcc: 305)
        let inferred = QSO(call: "PJ6A", band: "40m", mode: "CW")
        let contacts = [explicit, inferred]
        let saba = LocalContactHistory.project(contacts: contacts, call: "PJ6Y", adif: 519, resolver: resolver)
        let override = LocalContactHistory.project(contacts: contacts, call: "PJ6Y", adif: 305, resolver: resolver)
        #expect(saba["dxcc_contact_count"] as? Int == 1)
        #expect(override["dxcc_contact_count"] as? Int == 1)
        #expect(explicit.dxcc == 305)
        #expect(inferred.dxcc == nil)
    }

    @Test("Confirmed totals use every nondeleted contact, not the 20-row page or band matrix")
    func fullHistoryConfirmationAndLatestDXCC() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let database = try LogbookDatabase(url: root.appendingPathComponent("history.sqlite"))
        let base = Date(timeIntervalSince1970: 1_767_225_600) // 2026-01-01 UTC

        for index in 0..<25 {
            let qso = QSO(call: "K1ABC", start: base.addingTimeInterval(Double(index) * 86_400),
                          band: "20m", mode: "CW", dxcc: 291,
                          qslReceived: index < 3 ? "Y" : index == 5 ? "V" : "N",
                          lotwReceived: index == 4 ? "X" : "N")
            try database.save(qso)
        }
        try database.save(QSO(call: "K1XYZ", start: base.addingTimeInterval(30 * 86_400),
                              band: "40m", mode: "SSB", dxcc: 291, qslReceived: "Y"))
        try database.save(QSO(call: "K3XYZ", start: base.addingTimeInterval(29 * 86_400),
                              band: "80m", mode: "FT8", dxcc: 291, lotwReceived: "X"))
        let latest = QSO(call: "K2XYZ", start: base.addingTimeInterval(31 * 86_400),
                         band: "30m", mode: "CW", dxcc: 291, qslReceived: "N")
        try database.save(latest)
        let deleted = QSO(call: "K1ABC", start: base.addingTimeInterval(40 * 86_400),
                          band: "15m", mode: "CW", dxcc: 291, qslReceived: "Y")
        try database.save(deleted)
        try database.softDelete(deleted)
        try database.save(QSO(call: "W7OTHER", start: base.addingTimeInterval(50 * 86_400),
                              band: "10m", mode: "CW", dxcc: 110, qslReceived: "Y"))

        let history = LocalContactHistory.project(
            contacts: try database.fetchAll(), call: "k1abc", adif: 291)
        #expect(history["call"] as? String == "K1ABC")
        #expect(history["previous_count"] as? Int == 25)
        #expect(history["previous_confirmed_count"] as? Int == 4)
        #expect((history["previous"] as? [[String: Any]])?.count == 20)
        #expect((history["previous"] as? [[String: Any]])?.allSatisfy { $0["confirmed"] as? Bool == false } == true)
        #expect(history["dxcc_contact_count"] as? Int == 28)
        #expect(history["dxcc_confirmed_count"] as? Int == 6)
        let last = try #require(history["last_dxcc_qso"] as? [String: String])
        #expect(last["id"] == latest.id.uuidString)
        #expect(last["call"] == "K2XYZ")
        #expect(last["band"] == "30m")
        #expect(last["mode"] == "CW")
        #expect(last["date"] == ISO8601DateFormatter().string(from: latest.start))
    }

    @Test("Unknown entity has no DXCC totals or invented latest QSO")
    func missingEntity() {
        let qso = QSO(call: "K1ABC", band: "20m", mode: "CW", qslReceived: "Y")
        let history = LocalContactHistory.project(contacts: [qso], call: "K1ABC", adif: nil)
        #expect(history["previous_count"] as? Int == 1)
        #expect(history["previous_confirmed_count"] as? Int == 1)
        #expect(history["dxcc_contact_count"] as? Int == 0)
        #expect(history["dxcc_confirmed_count"] as? Int == 0)
        #expect(history["last_dxcc_qso"] is NSNull)
    }

    @Test("Contact history publishes effective CTY overrides without replacing stored DXCC")
    func effectiveCountryOverride() throws {
        let csv = "ZZ,Fixture,999,EU,5,8,48.00,-17.00,-1.0,ZZ(3)[7];\n"
        let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".csv")
        defer { try? FileManager.default.removeItem(at: file) }
        try csv.write(to: file, atomically: true, encoding: .utf8)
        let resolver = try CTYResolver(csvURL: file)
        let historical = QSO(call: "ZZ1OLD", start: Date(timeIntervalSince1970: 1),
                             band: "20m", mode: "CW", dxcc: 123)
        let result = LocalContactHistory.project(contacts: [historical], call: "ZZ1ABC",
                                                 adif: 999, resolver: resolver)
        #expect(result["country"] as? String == "FIXTURE")
        #expect(result["cq_zone"] as? Int == 3)
        #expect(result["dxcc_contact_count"] as? Int == 0)
        #expect(historical.dxcc == 123)
    }

    @Test("Portable operating suffixes share previous-QSO history without rewriting stored calls")
    func portableCallHistory() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let database = try LogbookDatabase(url: root.appendingPathComponent("history.sqlite"))
        try database.save(QSO(call: "UN7CFI", band: "15m", mode: "SSB", dxcc: 130))
        try database.save(QSO(call: "UN7CFI/M", band: "20m", mode: "CW", dxcc: 130))
        try database.save(QSO(call: "UN7CFI/4", band: "40m", mode: "CW", dxcc: 130))
        try database.save(QSO(call: "DL/UN7CFI/P", band: "10m", mode: "CW", dxcc: 230))

        let history = LocalContactHistory.project(rows: try database.historyRows(call: "UN7CFI/P", adif: 130),
                                                  call: "UN7CFI/P", adif: 130)
        #expect(history["previous_count"] as? Int == 2)
        #expect((history["previous"] as? [[String: Any]])?.compactMap { $0["call"] as? String }.sorted() == ["UN7CFI", "UN7CFI/M"])
        #expect(try database.previous(call: "UN7CFI/P").map(\.call).sorted() == ["UN7CFI", "UN7CFI/M"])
        #expect(try database.previous(call: "UN7CFI").map(\.call).sorted() == ["UN7CFI", "UN7CFI/M"])
        #expect(try database.bandModeMatrix(call: "UN7CFI/P").map(\.band).sorted() == ["15m", "20m"])
    }

    @Test("Indexed candidates preserve full history and reflect saves and deletes immediately")
    func indexedCandidatesAndMutation() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let database = try LogbookDatabase(url: root.appendingPathComponent("history.sqlite"))
        let resolver = try CTYResolver.bundled()
        let base = Date(timeIntervalSince1970: 1_767_225_600)
        for index in 0..<30 {
            try database.save(QSO(call: "K1ABC", start: base.addingTimeInterval(Double(index) * 60),
                                  band: "20m", mode: "CW", dxcc: 291,
                                  qslReceived: index.isMultiple(of: 3) ? "Y" : "N"))
        }
        // A historical contact without stored DXCC must still be resolved at its QSO date.
        try database.save(QSO(call: "K2OTHER", start: base.addingTimeInterval(2_000),
                              band: "40m", mode: "SSB", qslReceived: "Y"))
        try database.save(QSO(call: "DL1OTHER", start: base.addingTimeInterval(3_000),
                              band: "10m", mode: "FT8", dxcc: 230, qslReceived: "Y"))

        func projection(_ contacts: [QSO]) -> [String: Any] {
            LocalContactHistory.project(contacts: contacts, call: "K1ABC", adif: 291,
                                                 resolver: resolver)
        }
        func assertEquivalent() throws {
            let full = projection(try database.fetchAll())
            let selected = projection(try database.historyCandidates(call: "K1ABC", adif: 291))
            let thin = LocalContactHistory.project(rows: try database.historyRows(call: "K1ABC", adif: 291),
                                                   call: "K1ABC", adif: 291, resolver: resolver)
            #expect(try JSONSerialization.data(withJSONObject: full, options: .sortedKeys)
                    == JSONSerialization.data(withJSONObject: selected, options: .sortedKeys))
            #expect(try JSONSerialization.data(withJSONObject: full, options: .sortedKeys)
                    == JSONSerialization.data(withJSONObject: thin, options: .sortedKeys))
        }
        try assertEquivalent()

        let added = QSO(call: "K1ABC", start: base.addingTimeInterval(4_000),
                        band: "15m", mode: "CW", dxcc: 291, qslReceived: "Y")
        try database.save(added)
        #expect(projection(try database.historyCandidates(call: "K1ABC", adif: 291))["previous_count"] as? Int == 31)
        try assertEquivalent()
        try database.softDelete(added)
        #expect(projection(try database.historyCandidates(call: "K1ABC", adif: 291))["previous_count"] as? Int == 30)
        try assertEquivalent()
    }

    @Test("Thin history preserves exact dates, Unicode, embedded NUL and all selected fields")
    func scalarHistoryProjection() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let database = try LogbookDatabase(url: root.appendingPathComponent("history.sqlite"))
        let date = Date(timeIntervalSinceReferenceDate: 815_123_456.1234567)
        let contact = QSO(call: "K1ABC/P", start: date, band: "20m", mode: "DATA", submode: "FT8",
            rstSent: "-07", rstReceived: "5\0é", gridSquare: "FN31", dxcc: 291,
            comment: String(repeating: "Unrelated comment ä", count: 500),
            qslReceived: "V", lotwSent: "Y", lotwReceived: "N",
            extraFields: ["APP_ARBITRARY": String(repeating: "Retained unrelated ADIF", count: 500)])
        try database.save(contact)
        try database.save(QSO(call: "K1ABC/4", band: "40m", mode: "CW", dxcc: 230))
        try database.save(QSO(call: "K2UNKNOWN", band: "15m", mode: "SSB"))
        for adif in [nil, 291] as [Int?] {
            let thin = try database.historyRows(call: "k1abc", adif: adif)
            let full = try database.historyCandidates(call: "k1abc", adif: adif).map(ContactHistoryRow.init)
            #expect(thin.count == full.count)
            for (actual, expected) in zip(thin, full) {
                #expect(actual.id == expected.id && actual.call == expected.call)
                #expect(actual.start == expected.start)
                if actual.id == contact.id { #expect(actual.start == date) }
                #expect(actual.band == expected.band && actual.mode == expected.mode && actual.submode == expected.submode)
                #expect(actual.dxcc == expected.dxcc && actual.gridSquare == expected.gridSquare)
                #expect(actual.qslReceived == expected.qslReceived && actual.lotwReceived == expected.lotwReceived)
                #expect(actual.lotwSent == expected.lotwSent && actual.rstSent == expected.rstSent)
                #expect(actual.rstReceived == expected.rstReceived)
                #expect(actual.deletedAt == expected.deletedAt)
            }
        }
        #expect(try database.historyRows(call: "K1ABC", adif: nil).map(\.call) == ["K1ABC/P"])
    }

    @Test("Thin history preserves NUL positions and literal escape text in every selected string",
          arguments: ["\0é", "5\0é", "trailing\0", "literal\\u0000"])
    func scalarHistoryNULStrings(value: String) throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let database = try LogbookDatabase(url: root.appendingPathComponent("history.sqlite"))
        defer { try? database.close(); try? FileManager.default.removeItem(at: root) }
        let contact = QSO(call: "K1ABC" + value, start: Date(timeIntervalSinceReferenceDate: 815_123_456.1234567),
            band: "20m" + value, mode: "DATA" + value, submode: value,
            rstSent: value, rstReceived: value, gridSquare: value, dxcc: 291,
            qslReceived: value, lotwSent: value, lotwReceived: value)
        try database.save(contact)
        let actual = try #require(database.historyRows(call: "K1ABC", adif: 291).first)
        let full = try #require(database.historyCandidates(call: "K1ABC", adif: 291).first)
        let expected = ContactHistoryRow(full)
        #expect(actual.id == expected.id)
        #expect(actual.start == expected.start)
        #expect(actual.deletedAt == expected.deletedAt)
        #expect(actual.dxcc == expected.dxcc)
        #expect([actual.call, actual.band, actual.mode, actual.submode, actual.gridSquare,
                 actual.rstSent, actual.rstReceived, actual.qslReceived, actual.lotwSent, actual.lotwReceived]
             == [expected.call, expected.band, expected.mode, expected.submode, expected.gridSquare,
                 expected.rstSent, expected.rstReceived, expected.qslReceived, expected.lotwSent, expected.lotwReceived])
        #expect(actual.rstReceived == value)
    }

    @Test("Thin history retains strict JSON numeric field validation", arguments: ["59", "5\0é"])
    func scalarHistoryRejectsMalformedNumbers(rstReceived: String) throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let database = try LogbookDatabase(url: root.appendingPathComponent("history.sqlite"))
        let contact = QSO(call: "K1ABC", band: "20m", mode: "CW", rstReceived: rstReceived, dxcc: 291)
        var raw: OpaquePointer?
        #expect(sqlite3_open(database.url.path, &raw) == SQLITE_OK)
        defer { sqlite3_close(raw) }
        for field in ["start", "dxcc", "deletedAt"] {
            try database.save(contact)
            var object = try #require(JSONSerialization.jsonObject(with: JSONEncoder().encode(contact)) as? [String: Any])
            object[field] = true
            let malformed = try JSONSerialization.data(withJSONObject: object)
            #expect(throws: (any Error).self) { try JSONDecoder().decode(ContactHistoryRow.self, from: malformed) }
            #expect(sqlite3_exec(raw, "UPDATE qsos SET record_json=json_set(record_json,'$.\(field)',json('true'));", nil, nil, nil) == SQLITE_OK)
            #expect(throws: LogbookDatabaseError.self) { try database.historyRows(call: "K1ABC", adif: nil) }
        }
        try database.save(contact)
        #expect(sqlite3_exec(raw, "UPDATE qsos SET record_json=json_set(record_json,'$.dxcc',291.0);", nil, nil, nil) == SQLITE_OK)
        #expect(try database.historyRows(call: "K1ABC", adif: nil).first?.dxcc == 291)
    }
}

#if os(macOS)
import Foundation
import Testing
import XLogCore
@testable import XLogPrototypeSupport

@Suite("Integrated cluster contact history")
struct LiveClusterHistoryTests {
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

        let history = LiveClusterMethods.historyProjection(
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
        let history = LiveClusterMethods.historyProjection(contacts: [qso], call: "K1ABC", adif: nil)
        #expect(history["previous_count"] as? Int == 1)
        #expect(history["previous_confirmed_count"] as? Int == 1)
        #expect(history["dxcc_contact_count"] as? Int == 0)
        #expect(history["dxcc_confirmed_count"] as? Int == 0)
        #expect(history["last_dxcc_qso"] is NSNull)
    }
}
#endif

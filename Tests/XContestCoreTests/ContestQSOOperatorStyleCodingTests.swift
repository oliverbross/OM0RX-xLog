import Foundation
import Testing
@testable import XContestCore

struct ContestQSOOperatorStyleCodingTests {
    private let legacyJSON = #"{"band":"20m","callsign":"K1ABC","exchange":{"normalizedReceived":"14","normalizedSent":"15","rawReceived":"14","rawSent":"15"},"frequencyHz":14025000,"id":"20000000-0000-4000-8000-000000000001","mode":"CW","operatorCallsign":"OM0RX","provenance":{"source":"operatorEntry"},"rstReceived":"599","rstSent":"599","sessionID":"10000000-0000-4000-8000-000000000001","stationLocation":"JN98","timestampUTC":0}"#

    @Test("Legacy QSO bytes decode and re-encode without an operator-style key")
    func legacyBytes() throws {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .millisecondsSince1970
        let qso = try decoder.decode(ContestQSO.self, from: Data(legacyJSON.utf8))
        #expect(qso.operatorStyle == nil)
        #expect(try encode(qso) == Data(legacyJSON.utf8))
    }

    @Test("Known operator style is encoded as one optional canonical key")
    func styledBytes() throws {
        let qso = ContestQSO(
            id: UUID(uuidString: "20000000-0000-4000-8000-000000000001")!,
            sessionID: UUID(uuidString: "10000000-0000-4000-8000-000000000001")!,
            timestampUTC: Date(timeIntervalSince1970: 0),
            callsign: "K1ABC", band: "20m", mode: "CW", frequencyHz: 14_025_000,
            rstSent: "599", rstReceived: "599",
            exchange: ContestExchangeSnapshot(rawSent: "15", normalizedSent: "15",
                                              rawReceived: "14", normalizedReceived: "14"),
            entity: nil, operatorCallsign: "OM0RX", stationLocation: "JN98",
            provenance: ContestQSOProvenance(source: .operatorEntry), operatorStyle: .run
        )
        let encoded = try encode(qso)
        let expected = legacyJSON.replacingOccurrences(of: #""operatorCallsign":"OM0RX""#,
                                                        with: #""operatorCallsign":"OM0RX","operatorStyle":"run""#)
        #expect(encoded == Data(expected.utf8))
    }

    private func encode(_ value: ContestQSO) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        encoder.dateEncodingStrategy = .millisecondsSince1970
        return try encoder.encode(value)
    }
}

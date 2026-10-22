import Foundation
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif
import XClusterIntegrationCore

/// Local-only history shared by every desktop platform. No cluster connection,
/// credential store or station service is constructed to answer this query.
enum LocalContactHistory {
    /// Aggregate the full nondeleted contact view, not the bounded 20-row
    /// history page or the band/mode matrix used by spot classification.
    static func project(contacts: [QSO], call: String, adif: Int?,
                                  resolver: CTYResolver? = nil) -> [String: Any] {
        project(rows: contacts.map(ContactHistoryRow.init), call: call, adif: adif, resolver: resolver)
    }

    static func project(rows: [ContactHistoryRow], call: String, adif: Int?,
                        resolver: CTYResolver? = nil) -> [String: Any] {
        let normalizedCall = call.uppercased()
        let entity = resolver?.resolveCountryEndpoint(normalizedCall)
        var previous: [[String: Any]] = []
        var previousCount = 0
        var previousConfirmedCount = 0
        var entityCount = 0
        var entityConfirmedCount = 0
        var lastEntityQSO: ContactHistoryRow?
        var lastGrid = ""
        var matrix: [String: (band: String, mode: String, confirmed: Bool)] = [:]
        let formatter = ISO8601DateFormatter()
        let matrixBands: Set<String> = ["160m", "80m", "60m", "40m", "30m", "20m", "17m", "15m", "12m", "10m", "6m", "2m", "70cm"]
        let matrixModes: Set<String> = ["CW", "SSB", "FT8", "FT4", "FT2", "RTTY", "JTTY", "PSK", "DIGI", "AM", "FM"]
        for qso in rows {
                if qso.deletedAt != nil { continue }
                let mode = SpotLogic.normalizedMode(qso.submode.isEmpty ? qso.mode : qso.submode)
                // Stored operator/historical DXCC remains authoritative. Only
                // absent values use the effective, date-specific CTY endpoint.
                let qsoAdif: Int? = adif == nil ? nil : (qso.dxcc ?? resolver?.resolveCountryEndpoint(qso.call, at: qso.start)?.adif)
                let confirmed = ClusterContact(callsign: qso.call, band: qso.band, mode: mode,
                                               paperQSL: qso.qslReceived, lotwQSL: qso.lotwReceived).isConfirmed
                if NormalLogCallsignIdentity.matches(qso.call, normalizedCall) {
                    previousCount += 1
                    if confirmed { previousConfirmedCount += 1 }
                    if lastGrid.isEmpty { lastGrid = qso.gridSquare }
                    if previous.count < 20 {
                        previous.append(["id": qso.id.uuidString, "date": formatter.string(from: qso.start),
                                         "call": qso.call, "band": qso.band, "mode": mode,
                                         "rstSent": qso.rstSent, "rstReceived": qso.rstReceived,
                                         "grid": qso.gridSquare, "lotwSent": qso.lotwSent,
                                         "lotwReceived": qso.lotwReceived, "confirmed": confirmed])
                    }
                }
                if let adif, matrixBands.contains(qso.band), matrixModes.contains(mode),
                   qsoAdif == adif {
                    let key = "\(qso.band)|\(mode)"
                    let existing = matrix[key]
                    matrix[key] = (qso.band, mode, confirmed || (existing?.confirmed ?? false))
                }
                if let adif, qsoAdif == adif {
                    entityCount += 1
                    if confirmed { entityConfirmedCount += 1 }
                    if lastEntityQSO.map({ qso.start > $0.start }) ?? true {
                        lastEntityQSO = qso
                    }
                }
        }
        let lastDXCC: Any = lastEntityQSO.map { qso -> Any in
            ["id": qso.id.uuidString, "date": formatter.string(from: qso.start),
             "call": qso.call, "band": qso.band,
             "mode": SpotLogic.normalizedMode(qso.submode.isEmpty ? qso.mode : qso.submode)]
        } ?? NSNull()
        return ["call": normalizedCall, "previous_count": previousCount, "previous": previous,
                "previous_confirmed_count": previousConfirmedCount,
                "adif": adif as Any? ?? NSNull(),
                "country": entity?.name ?? "Unknown", "cq_zone": entity?.cqZone as Any? ?? NSNull(),
                "grid": lastGrid, "dxcc_contact_count": entityCount,
                "dxcc_confirmed_count": entityConfirmedCount, "last_dxcc_qso": lastDXCC,
                "matrix": matrix.values.map { ["band": $0.band, "mode": $0.mode,
                                                  "worked": true, "confirmed": $0.confirmed] as [String: Any] }
                    .sorted { String(describing: $0["band"] ?? "") < String(describing: $1["band"] ?? "") }]
    }

}

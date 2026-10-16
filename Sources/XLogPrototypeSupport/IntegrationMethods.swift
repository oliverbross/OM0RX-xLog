import Foundation
import XClusterIntegrationCore
import XStationIntegrationCore

/// P2 pure domain entry points. These methods cannot open files, sockets or devices.
enum IntegrationMethods {
    static func selfTest() throws -> [String: Any] {
        let station = try StationContractDiagnostics.run()
        let stationJSON = try JSONSerialization.jsonObject(with: JSONEncoder().encode(station))
        let line = "DX de DEMO1: 14240.0 W1AW SSB 1200Z"
        guard let raw = ClusterLineParser.parse(line, clusterID: sourceID, clusterName: "Synthetic") else {
            throw WorkerFailure("integration_failed", "Cluster fixture parsing failed.")
        }
        let index = ClusterClassificationIndex(records: [])
        let classification = index.classify(call: raw.callsign, band: "20m", mode: "SSB", adif: 291)
        let clusterPassed = raw.callsign == "W1AW" && classification.callStatus == "New Callsign" && classification.dxccStatus == "New DXCC"
        return ["schema_version": 1, "station": stationJSON, "cluster_passed": clusterPassed,
                "passed": station.passed && clusterPassed, "station_io": false, "file_io": false,
                "history_scope": "synthetic_session"]
    }

    static let sourceID = UUID(uuidString: "00000000-0000-0000-0000-000000000002")!

    static func classify(_ params: [String: Any]) throws -> [String: Any] {
        guard Set(params.keys) == ["spots", "contacts", "history_scope"],
              params["history_scope"] as? String == "synthetic_session",
              let inputs = params["spots"] as? [[String: Any]], inputs.count <= 64,
              let contacts = params["contacts"] as? [[String: Any]], contacts.count <= 128 else {
            throw invalid()
        }
        let records: [ClusterContact] = try contacts.map { item in
            let allowed: Set<String> = ["callsign", "frequency_hz", "mode", "adif", "timestamp", "paper_qsl", "lotw_qsl", "eqsl"]
            guard Set(item.keys).isSubset(of: allowed),
                  let call = item["callsign"] as? String, validCall(call),
                  let mode = item["mode"] as? String, !mode.isEmpty, mode.utf8.count <= 16 else { throw invalid() }
            let frequency = try number(item["frequency_hz"] ?? NSNull())
            guard (1...1_000_000_000_000).contains(frequency), frequency.rounded() == frequency else { throw invalid() }
            let band = SpotLogic.band(for: frequency / 1000)
            let entity = try adif(item["adif"])
            let timestamp = try number(item["timestamp"] ?? 0)
            guard (0...7_258_118_400).contains(timestamp) else { throw invalid() }
            func flag(_ name: String) throws -> String {
                guard let raw = item[name] else { return "" }
                guard let value = raw as? String, value.utf8.count <= 16 else { throw invalid() }
                return value
            }
            return try ClusterContact(callsign: call, band: band, mode: mode, adif: entity ?? 0,
                                      date: Date(timeIntervalSince1970: timestamp),
                                      paperQSL: flag("paper_qsl"), lotwQSL: flag("lotw_qsl"), eqsl: flag("eqsl"))
        }
        let index = ClusterClassificationIndex(records: records)
        var identifiers = Set<String>()
        let projected: [[String: Any]] = try inputs.map { item in
            guard Set(item.keys).isSubset(of: ["id", "line", "adif"]),
                  let id = item["id"] as? String, !id.isEmpty, id.utf8.count <= 64,
                  identifiers.insert(id).inserted,
                  let line = item["line"] as? String, line.utf8.count <= 4096,
                  let raw = ClusterLineParser.parse(line, clusterID: sourceID, clusterName: "Synthetic", at: Date(timeIntervalSince1970: 0)),
                  raw.frequencyKHz.isFinite, raw.frequencyKHz > 0, raw.frequencyKHz <= 1_000_000_000 else { throw invalid() }
            let band = SpotLogic.band(for: raw.frequencyKHz)
            let mode = SpotLogic.mode(comment: raw.comment, band: band, khz: raw.frequencyKHz)
            let classification = index.classify(call: raw.callsign, band: band, mode: mode, adif: try adif(item["adif"]))
            let source = SpotLogic.source(spotter: raw.spotter, comment: raw.comment)
            let (score, reasons) = SpotLogic.score(callStatus: classification.callStatus,
                                                  dxccStatus: classification.dxccStatus, specials: [], source: source)
            return ["id": id, "call": raw.callsign, "frequency_hz": Int64((raw.frequencyKHz * 1_000).rounded()),
                    "band": band, "mode": mode, "source": source,
                    "call_status": classification.callStatus, "dxcc_status": classification.dxccStatus,
                    "score": score, "score_reasons": reasons,
                    "worked_before": classification.workedBefore.map { $0.timeIntervalSince1970 as Any } ?? NSNull()]
        }
        return ["schema_version": 1, "history_scope": "synthetic_session", "spots": projected,
                "contact_count": records.count, "station_io": false,
                "core_source": "XClusterIntegrationCore"]
    }

    private static func invalid() -> WorkerFailure {
        WorkerFailure("invalid_params", "Invalid or oversized synthetic cluster batch.")
    }

    private static func validCall(_ value: String) -> Bool {
        let call = value.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        return (3...32).contains(call.utf8.count) && call.utf8.allSatisfy {
            (65...90).contains($0) || (48...57).contains($0) || $0 == 47 || $0 == 45
        }
    }

    private static func number(_ value: Any) throws -> Double {
        // JSON booleans bridge to NSNumber too; they are not numeric fields.
        guard let n = value as? NSNumber, String(cString: n.objCType) != "c", n.doubleValue.isFinite else { throw invalid() }
        return n.doubleValue
    }

    private static func adif(_ value: Any?) throws -> Int? {
        guard let value, !(value is NSNull) else { return nil }
        let n = try number(value)
        guard (1...9999).contains(n), n.rounded() == n else { throw invalid() }
        return Int(n)
    }
}

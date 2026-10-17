import Foundation

/// Pure in-memory extraction of xCluster's LogbookIndex classification rules.
/// The host owns storage, entity resolution, and all record selection.
public struct ClusterClassificationIndex: Sendable {
    public let recordCount: Int
    private let recordsByCall: [String: [ClusterContact]]
    private let workedCallBandModes: Set<Combination>
    private let confirmedCallBandModes: Set<Combination>
    private let workedDXCCBandModes: Set<Combination>
    private let confirmedDXCCBandModes: Set<Combination>

    // Structured keys avoid delimiter collisions for caller-supplied strings.
    private struct Combination: Hashable, Sendable {
        let identity: String
        let band: String
        let mode: String
    }

    public static let empty = ClusterClassificationIndex(records: [])

    public init(records: [ClusterContact]) {
        var byCall: [String: [ClusterContact]] = [:]
        var workedCallBandModes = Set<Combination>(), confirmedCallBandModes = Set<Combination>()
        var workedDXCCBandModes = Set<Combination>(), confirmedDXCCBandModes = Set<Combination>()
        // Original SQLite readers returned newest records first. Establish that
        // invariant for arbitrary in-memory input, retaining input order on ties.
        let ordered = records.enumerated().sorted {
            $0.element.date == $1.element.date ? $0.offset < $1.offset : $0.element.date > $1.element.date
        }.map(\.element)
        for var record in ordered {
            record.callsign = record.callsign.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
            record.band = record.band.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            record.mode = SpotLogic.classificationMode(record.mode)
            let call = record.callsign
            byCall[call, default: []].append(record)
            let callKey = Combination(identity: call, band: record.band, mode: record.mode)
            workedCallBandModes.insert(callKey)
            if record.isConfirmed { confirmedCallBandModes.insert(callKey) }
            if let adif = record.adif, adif > 0 {
                let dxccKey = Combination(identity: String(adif), band: record.band, mode: record.mode)
                workedDXCCBandModes.insert(dxccKey)
                if record.isConfirmed {
                    confirmedDXCCBandModes.insert(dxccKey)
                }
            }
        }
        recordCount = records.count
        recordsByCall = byCall
        self.workedCallBandModes = workedCallBandModes
        self.confirmedCallBandModes = confirmedCallBandModes
        self.workedDXCCBandModes = workedDXCCBandModes
        self.confirmedDXCCBandModes = confirmedDXCCBandModes
    }

    public func classify(call: String, band: String, mode: String, adif: Int?) -> ClusterClassification {
        let normalizedCall = call.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        let normalizedBand = band.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let normalizedMode = SpotLogic.classificationMode(mode)
        let histories = recordsByCall[normalizedCall] ?? []
        let bandModeKey = Combination(identity: normalizedCall, band: normalizedBand, mode: normalizedMode)
        let callStatus = SpotLogic.callStatus(
            workedBandMode: workedCallBandModes.contains(bandModeKey),
            confirmedBandMode: confirmedCallBandModes.contains(bandModeKey)
        )
        let workedBefore = Self.workedBeforeDate(records: histories, band: normalizedBand, mode: normalizedMode)
        guard let adif, adif > 0 else {
            return ClusterClassification(callStatus: callStatus, dxccStatus: "Unknown", workedBefore: workedBefore)
        }
        let dxccBandModeKey = Combination(identity: String(adif), band: normalizedBand, mode: normalizedMode)
        let dxccStatus = SpotLogic.dxccStatus(
            workedBandMode: workedDXCCBandModes.contains(dxccBandModeKey),
            confirmedBandMode: confirmedDXCCBandModes.contains(dxccBandModeKey))
        return ClusterClassification(callStatus: callStatus, dxccStatus: dxccStatus, workedBefore: workedBefore)
    }

    static func workedBeforeDate(records: [ClusterContact], band: String, mode: String) -> Date? {
        let normalizedBand = band.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let normalizedMode = SpotLogic.classificationMode(mode)
        return records.first(where: { $0.band == normalizedBand && $0.mode == normalizedMode })?.date
            ?? records.first(where: { $0.band == normalizedBand })?.date
    }
}

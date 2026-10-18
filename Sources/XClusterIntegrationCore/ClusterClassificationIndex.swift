import Foundation

/// Pure in-memory extraction of xCluster's LogbookIndex classification rules.
/// The host owns storage, entity resolution, and all record selection.
public struct ClusterClassificationIndex: Sendable {
    public let recordCount: Int
    private let recordsByCall: [String: [ClusterContact]]
    private let callBands: [String: Set<String>]
    private let callModes: [String: Set<String>]
    private let workedCallBandModes: Set<Combination>
    private let confirmedCallBandModes: Set<Combination>
    private let dxccBands: [Int: Set<String>]
    private let dxccModes: [Int: Set<String>]
    private let workedDXCCModes: [Int: Set<String>]
    private let confirmedDXCCModes: [Int: Set<String>]
    private let workedDXCC: Set<Int>
    private let confirmedDXCC: Set<Int>
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
        var callBands: [String: Set<String>] = [:], callModes: [String: Set<String>] = [:]
        var workedCallBandModes = Set<Combination>(), confirmedCallBandModes = Set<Combination>()
        var dxccBands: [Int: Set<String>] = [:], dxccModes: [Int: Set<String>] = [:]
        var workedDXCCModes: [Int: Set<String>] = [:], confirmedDXCCModes: [Int: Set<String>] = [:]
        var workedDXCC = Set<Int>(), confirmedDXCC = Set<Int>()
        var confirmedDXCCBandModes = Set<Combination>()
        // Original SQLite readers returned newest records first. Establish that
        // invariant for arbitrary in-memory input, retaining input order on ties.
        let ordered = records.enumerated().sorted {
            $0.element.date == $1.element.date ? $0.offset < $1.offset : $0.element.date > $1.element.date
        }.map(\.element)
        for var record in ordered {
            record.callsign = record.callsign.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
            record.band = record.band.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            let exactMode = SpotLogic.normalizedMode(record.mode)
            record.mode = SpotLogic.classificationMode(record.mode)
            let call = record.callsign
            byCall[call, default: []].append(record)
            callBands[call, default: []].insert(record.band)
            callModes[call, default: []].insert(record.mode)
            let callKey = Combination(identity: call, band: record.band, mode: record.mode)
            workedCallBandModes.insert(callKey)
            if record.isConfirmed { confirmedCallBandModes.insert(callKey) }
            if let adif = record.adif, adif > 0 {
                workedDXCC.insert(adif)
                dxccBands[adif, default: []].insert(record.band)
                dxccModes[adif, default: []].insert(record.mode)
                if !exactMode.isEmpty { workedDXCCModes[adif, default: []].insert(exactMode) }
                if record.isConfirmed {
                    confirmedDXCC.insert(adif)
                    if !exactMode.isEmpty { confirmedDXCCModes[adif, default: []].insert(exactMode) }
                    confirmedDXCCBandModes.insert(
                        Combination(identity: String(adif), band: record.band, mode: record.mode))
                }
            }
        }
        recordCount = records.count
        recordsByCall = byCall
        self.callBands = callBands
        self.callModes = callModes
        self.workedCallBandModes = workedCallBandModes
        self.confirmedCallBandModes = confirmedCallBandModes
        self.dxccBands = dxccBands
        self.dxccModes = dxccModes
        self.workedDXCCModes = workedDXCCModes
        self.confirmedDXCCModes = confirmedDXCCModes
        self.workedDXCC = workedDXCC
        self.confirmedDXCC = confirmedDXCC
        self.confirmedDXCCBandModes = confirmedDXCCBandModes
    }

    /// Exact local modes worked and confirmed for one DXCC entity. This is a
    /// retained-logbook summary; no network or award-service lookup is involved.
    public func dxccModeHistory(adif: Int) -> (worked: [String], confirmed: [String]) {
        func ordered(_ modes: Set<String>) -> [String] {
            modes.sorted { left, right in
                let leftRank = SpotLogic.modes.firstIndex(of: left) ?? SpotLogic.modes.count
                let rightRank = SpotLogic.modes.firstIndex(of: right) ?? SpotLogic.modes.count
                return leftRank == rightRank ? left < right : leftRank < rightRank
            }
        }
        return (ordered(workedDXCCModes[adif] ?? []), ordered(confirmedDXCCModes[adif] ?? []))
    }

    public func classify(call: String, band: String, mode: String, adif: Int?) -> ClusterClassification {
        let normalizedCall = call.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        let normalizedBand = band.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let normalizedMode = SpotLogic.classificationMode(mode)
        let histories = recordsByCall[normalizedCall] ?? []
        let bandWorked = callBands[normalizedCall]?.contains(normalizedBand) ?? false
        let modeWorked = callModes[normalizedCall]?.contains(normalizedMode) ?? false
        let bandModeKey = Combination(identity: normalizedCall, band: normalizedBand, mode: normalizedMode)
        let callStatus = SpotLogic.callStatus(
            worked: !histories.isEmpty,
            bandWorked: bandWorked,
            modeWorked: modeWorked,
            bandModeWorked: workedCallBandModes.contains(bandModeKey),
            confirmedBandMode: confirmedCallBandModes.contains(bandModeKey)
        )
        let workedBefore = Self.workedBeforeDate(records: histories, band: normalizedBand, mode: normalizedMode)
        guard let adif, adif > 0 else {
            return ClusterClassification(callStatus: callStatus, dxccStatus: "Unknown", workedBefore: workedBefore)
        }
        let dxccStatus = SpotLogic.dxccStatus(
            worked: workedDXCC.contains(adif),
            confirmed: confirmedDXCC.contains(adif),
            newBand: !(dxccBands[adif]?.contains(normalizedBand) ?? false),
            newMode: !(dxccModes[adif]?.contains(normalizedMode) ?? false),
            confirmedBandMode: confirmedDXCCBandModes.contains(
                Combination(identity: String(adif), band: normalizedBand, mode: normalizedMode)))
        return ClusterClassification(callStatus: callStatus, dxccStatus: dxccStatus, workedBefore: workedBefore)
    }

    static func workedBeforeDate(records: [ClusterContact], band: String, mode: String) -> Date? {
        let normalizedBand = band.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let normalizedMode = SpotLogic.classificationMode(mode)
        return records.first(where: { $0.band == normalizedBand && $0.mode == normalizedMode })?.date
            ?? records.first(where: { $0.band == normalizedBand })?.date
    }
}

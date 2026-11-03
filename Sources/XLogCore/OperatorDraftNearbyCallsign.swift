import Foundation

/// Normal callsign entry from a retained spot. This projection has no station
/// capability and deliberately preserves every other field, including MY_*
/// snapshots, times, manual evidence and split receive/transmit frequencies.
public enum OperatorDraftNearbyCallsign {
    public enum AdmissionError: Error { case callsignPresent, invalidCallsign }
    public static func applying(to draft: QSO, callsign: String) throws -> QSO {
        guard draft.call.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw AdmissionError.callsignPresent
        }
        guard (3...32).contains(callsign.utf8.count), callsign.utf8.allSatisfy({ (65...90).contains($0) || (48...57).contains($0) || $0 == 47 || $0 == 45 }) else {
            throw AdmissionError.invalidCallsign
        }
        var result = draft
        result.call = callsign
        return result
    }
}

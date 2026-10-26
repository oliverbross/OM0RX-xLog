// Copyright © 2026 Oliver Bross OM0RX. SPDX-License-Identifier: GPL-3.0-only
import Foundation

public enum CWSpotWire {
    public static func reporter(_ stationCallsign:String) throws -> String {
        let value=stationCallsign.uppercased()
        guard CWTransmittingIdentity.plausible(value),value==stationCallsign else {throw CWContractError.invalidConfiguration}
        return value+"-#"
    }
    public static func line(_ spot:CWConfirmedSpot,stationCallsign:String) throws -> String {
        try spot.validateProvenance()
        let reporter=try reporter(stationCallsign)
        guard CWTransmittingIdentity.plausible(spot.callsign),(100_000...1_000_000_000).contains(spot.frequencyHz),
              spot.observedAt.timeIntervalSince1970.isFinite else {throw CWContractError.invalidSamples}
        var calendar=Calendar(identifier:.gregorian);calendar.timeZone=TimeZone(secondsFromGMT:0)!
        let time=calendar.dateComponents([.hour,.minute],from:spot.observedAt)
        let frequency=String(format:"%.3f",locale:Locale(identifier:"en_US_POSIX"),Double(spot.frequencyHz)/1000)
        // Signal strength and WPM are absent until actually measured. Keep the
        // original observation UTC, including when serving requested history.
        return String(format:"DX de %@: %@  %@  CW Local  %02d%02dZ\r\n",reporter,frequency,spot.callsign,time.hour ?? 0,time.minute ?? 0)
    }
}

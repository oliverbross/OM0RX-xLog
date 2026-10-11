import Foundation

/// Resolves the power written to ADIF `TX_PWR` from station telemetry.
///
/// A non-zero measured output is retained for the current QSO because the
/// station normally returns to zero watts before the operator presses Log QSO.
/// Until RF is observed, the configured radio drive is the best available
/// value. The station-profile default remains the offline fallback.
public struct TransmitPowerCapture: Equatable, Sendable {
    private var peakMeasuredWatts: Double?

    public init() {}

    public mutating func reset() {
        peakMeasuredWatts = nil
    }

    public mutating func resolve(
        measuredOutputWatts: Double?,
        configuredDriveWatts: Int?,
        fallback: String
    ) -> String {
        if let measuredOutputWatts,
           measuredOutputWatts.isFinite,
           measuredOutputWatts > 0.5 {
            peakMeasuredWatts = max(peakMeasuredWatts ?? 0, measuredOutputWatts)
        }

        if let peakMeasuredWatts {
            return Self.format(peakMeasuredWatts)
        }
        if let configuredDriveWatts, configuredDriveWatts > 0 {
            return String(configuredDriveWatts)
        }
        return fallback
    }

    private static func format(_ watts: Double) -> String {
        let rounded = watts.rounded()
        if abs(watts - rounded) < 0.05 {
            return String(Int(rounded))
        }
        return String(format: "%.1f", watts)
    }
}

import Testing
@testable import XLogCore

@Suite("Transmit power capture")
struct TransmitPowerCaptureTests {
    @Test("Drive power is used before RF output is observed")
    func driveFallback() {
        var capture = TransmitPowerCapture()
        #expect(capture.resolve(measuredOutputWatts: 0, configuredDriveWatts: 98, fallback: "100") == "98")
    }

    @Test("Measured output survives the return to receive")
    func measuredOutputIsRetained() {
        var capture = TransmitPowerCapture()
        #expect(capture.resolve(measuredOutputWatts: 487.4, configuredDriveWatts: 65, fallback: "100") == "487.4")
        #expect(capture.resolve(measuredOutputWatts: 0, configuredDriveWatts: 65, fallback: "100") == "487.4")
    }

    @Test("A new QSO resets measured output")
    func resetUsesCurrentDrive() {
        var capture = TransmitPowerCapture()
        _ = capture.resolve(measuredOutputWatts: 500, configuredDriveWatts: 65, fallback: "100")
        capture.reset()
        #expect(capture.resolve(measuredOutputWatts: nil, configuredDriveWatts: 30, fallback: "100") == "30")
    }
}

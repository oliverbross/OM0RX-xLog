import Foundation

public actor SimulatedRadio: RadioControlling {
    public typealias SnapshotHandler = @Sendable (RadioSnapshot) -> Void

    private var value: RadioSnapshot
    private var vfoAFrequencyHz: Int64
    private var vfoBFrequencyHz: Int64?
    private var vfoAMode: String
    private var vfoBMode: String?
    private var speed = 25
    private var cwText = ""
    private let onSnapshot: SnapshotHandler
    private var vfoOffsets: [String: VFOOffset]

    private struct VFOOffset {
        var ritEnabled = false
        var ritOffsetHz = 0
        var xitEnabled = false
        var xitOffsetHz = 0
    }

    public init(
        snapshot: RadioSnapshot = RadioSnapshot(),
        onSnapshot: @escaping SnapshotHandler = { _ in }
    ) {
        value = snapshot
        vfoAFrequencyHz = snapshot.vfo("A")?.frequencyHz ?? snapshot.frequencyHz
        vfoBFrequencyHz = snapshot.vfo("B")?.frequencyHz
        vfoAMode = snapshot.vfo("A")?.mode ?? snapshot.mode
        vfoBMode = snapshot.vfo("B")?.mode
        self.onSnapshot = onSnapshot
        vfoOffsets = [:]
        for vfo in snapshot.vfos {
            vfoOffsets[vfo.letter] = VFOOffset(
                ritEnabled: vfo.ritEnabled,
                ritOffsetHz: vfo.ritOffsetHz,
                xitEnabled: vfo.xitEnabled,
                xitOffsetHz: vfo.xitOffsetHz
            )
        }
    }

    public func snapshot() -> RadioSnapshot {
        value
    }

    public func primaryFrequency() -> Int64? { vfoAFrequencyHz }

    public func setPrimaryFrequency(_ frequencyHz: Int64) throws {
        guard frequencyHz > 0 else { throw XCatError.invalidFrequency }
        vfoAFrequencyHz = frequencyHz
        refreshVFOs()
    }

    public func setFrequency(_ frequencyHz: Int64) throws {
        guard frequencyHz > 0 else { throw XCatError.invalidFrequency }
        if value.slice == "B", vfoBFrequencyHz != nil {
            vfoBFrequencyHz = frequencyHz
        } else {
            vfoAFrequencyHz = frequencyHz
        }
        refreshVFOs()
    }

    public func setMode(_ mode: String) throws {
        let normalized = mode.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard !normalized.isEmpty else { throw XCatError.invalidMode }
        if value.slice == "B", vfoBFrequencyHz != nil {
            vfoBMode = normalized
        } else {
            vfoAMode = normalized
        }
        refreshVFOs()
    }

    public func setTransmit(_ enabled: Bool) {
        value.isTransmitting = enabled
        onSnapshot(value)
    }

    public func secondaryFrequency() -> Int64? { vfoBFrequencyHz }

    public func setSecondaryFrequency(_ frequencyHz: Int64) throws {
        guard frequencyHz > 0 else { throw XCatError.invalidFrequency }
        vfoBFrequencyHz = frequencyHz
        if vfoBMode == nil { vfoBMode = vfoAMode }
        refreshVFOs()
    }

    public func setSplitTransmit(_ enabled: Bool) {
        if enabled, vfoBFrequencyHz == nil {
            vfoBFrequencyHz = vfoAFrequencyHz
            vfoBMode = vfoAMode
        }
        value.transmitSlice = enabled ? "B" : "A"
        refreshVFOs()
    }

    public func setReceiveVFO(_ vfo: Int) throws {
        guard vfo == 0 || (vfo == 1 && vfoBFrequencyHz != nil) else { throw XCatError.unsupported }
        value.slice = vfo == 0 ? "A" : "B"
        refreshVFOs()
    }

    public func cwSpeed() -> Int { speed }

    public func setCWSpeed(_ wordsPerMinute: Int) throws {
        guard (5...100).contains(wordsPerMinute) else { throw XCatError.server("CW speed must be 5 through 100 WPM.") }
        speed = wordsPerMinute
    }

    public func sendCW(_ text: String) { cwText = text }
    public func clearCW() { cwText = "" }
    public func setTransmit(_ mode: CATTransmitMode) {
        value.isTransmitting = true
        onSnapshot(value)
    }

    public func setRIT(enabled: Bool, offsetHz: Int, vfo: String?) throws {
        guard (-9_999...9_999).contains(offsetHz) else { throw XCatError.unsupported }
        let letter = normalizedVFO(vfo)
        var offset = vfoOffsets[letter] ?? VFOOffset()
        offset.ritEnabled = enabled
        offset.ritOffsetHz = offsetHz
        vfoOffsets[letter] = offset
        refreshVFOs()
    }

    public func setXIT(enabled: Bool, offsetHz: Int, vfo: String?) throws {
        guard (-9_999...9_999).contains(offsetHz) else { throw XCatError.unsupported }
        let letter = normalizedVFO(vfo)
        var offset = vfoOffsets[letter] ?? VFOOffset()
        offset.xitEnabled = enabled
        offset.xitOffsetHz = offsetHz
        vfoOffsets[letter] = offset
        refreshVFOs()
    }

    public func setRFPower(_ watts: Int) throws {
        guard watts > 0 else { throw XCatError.unsupported }
        value.rfPowerWatts = watts
        onSnapshot(value)
    }

    private func refreshVFOs() {
        let aOffset = vfoOffsets["A"] ?? VFOOffset()
        var vfos = [RadioVFO(
            letter: "A",
            frequencyHz: vfoAFrequencyHz,
            mode: vfoAMode,
            isReceive: value.slice == "A",
            isTransmit: value.transmitSlice == "A",
            ritEnabled: aOffset.ritEnabled,
            ritOffsetHz: aOffset.ritOffsetHz,
            xitEnabled: aOffset.xitEnabled,
            xitOffsetHz: aOffset.xitOffsetHz
        )]
        if let vfoBFrequencyHz {
            let bOffset = vfoOffsets["B"] ?? VFOOffset()
            vfos.append(RadioVFO(
                letter: "B",
                frequencyHz: vfoBFrequencyHz,
                mode: vfoBMode ?? vfoAMode,
                isReceive: value.slice == "B",
                isTransmit: value.transmitSlice == "B",
                ritEnabled: bOffset.ritEnabled,
                ritOffsetHz: bOffset.ritOffsetHz,
                xitEnabled: bOffset.xitEnabled,
                xitOffsetHz: bOffset.xitOffsetHz
            ))
        }
        value.vfos = vfos
        let receive = value.slice == "B" ? value.vfo("B") : value.vfo("A")
        let transmit = value.transmitSlice == "B" ? value.vfo("B") : value.vfo("A")
        value.frequencyHz = receive?.frequencyHz ?? vfoAFrequencyHz
        value.mode = receive?.mode ?? vfoAMode
        value.transmitFrequencyHz = transmit?.frequencyHz ?? vfoAFrequencyHz
        onSnapshot(value)
    }

    private func normalizedVFO(_ vfo: String?) -> String {
        let normalized = vfo?.uppercased()
        return normalized == "A" || normalized == "B" ? normalized! : value.slice
    }
}

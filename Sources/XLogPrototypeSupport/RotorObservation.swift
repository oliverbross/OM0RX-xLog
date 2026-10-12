import Foundation

/// Motion is derived from telemetry, not from sending a command or animating a needle.
struct RotorObservation {
    private(set) var target: Double?
    private(set) var label = ""
    private(set) var moving: Bool?
    private(set) var direction: String?
    private(set) var status = "Observed"
    private var previous: Double?
    private var stableSamples = 0
    private var lastChange: Date?
    private var requestedAt: Date?

    mutating func request(_ bearing: Double, label: String, now: Date = Date()) {
        target = bearing.truncatingRemainder(dividingBy: 360)
        self.label = label
        requestedAt = now
        // Motion from the previous target must not age the new command's
        // startup grace period. The controller may take time to begin moving.
        lastChange = nil
        moving = nil
        direction = nil
        stableSamples = 0
        status = "Turn requested · waiting for motion"
    }
    mutating func stopRequested() { target = nil; label = ""; status = "Stop requested · awaiting observation" }
    mutating func observe(_ bearing: Double, now: Date = Date()) {
        let delta = previous.map { Self.delta(from: $0, to: bearing) }
        previous = bearing
        if let delta, abs(delta) >= 0.25 {
            moving = true; direction = delta > 0 ? "CW" : "CCW"
            lastChange = now; stableSamples = 0
        } else {
            stableSamples += 1
            if stableSamples >= 2 { moving = false; direction = nil }
        }
        if let target {
            let distance = abs(Self.delta(from: bearing, to: target))
            if distance <= 2 && stableSamples >= 2 {
                status = String(format: "At target · observed %.0f°", bearing)
            } else if moving == true { status = "Turning \(direction ?? "")" }
            else if now.timeIntervalSince(lastChange ?? requestedAt ?? now) > 5 {
                status = "Stopped short of target · check rotor"
            } else { status = "Turn requested · waiting for motion" }
        } else { status = moving == true ? "Moving \(direction ?? "")" : moving == false ? "Stopped" : "Observed" }
    }
    static func delta(from: Double, to: Double) -> Double { (to - from + 540).truncatingRemainder(dividingBy: 360) - 180 }
}

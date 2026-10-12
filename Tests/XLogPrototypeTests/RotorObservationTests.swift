import Foundation
import Testing
@testable import XLogPrototypeSupport

@Suite("Observed rotor motion")
struct RotorObservationTests {
    @Test func northCrossingAndArrival() {
        var rotor = RotorObservation()
        rotor.observe(359)
        rotor.request(5, label: "DX target")
        #expect(rotor.moving != true)
        rotor.observe(1)
        #expect(rotor.direction == "CW")
        #expect(rotor.moving == true)
        rotor.observe(4); rotor.observe(4); rotor.observe(4)
        #expect(rotor.moving == false)
        #expect(rotor.status.hasPrefix("At target"))
        #expect(rotor.target == 5)
        #expect(rotor.label == "DX target")
    }
    @Test func stoppedShortIsNotArrival() {
        var rotor = RotorObservation()
        let now = Date()
        rotor.observe(53, now: now)
        rotor.request(180, label: "Test", now: now)
        rotor.observe(53, now: now.addingTimeInterval(6))
        rotor.observe(53, now: now.addingTimeInterval(7))
        #expect(rotor.status.hasPrefix("Stopped short"))
        rotor.stopRequested()
        #expect(rotor.target == nil)
    }
}
